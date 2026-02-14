import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

type Me = {
  userId: string;
  rosterVersion: number;
  teams: Array<{ id: string; name: string; heroIds: string[]; updatedAt: string; version: number }>;
};

type HeroItem = { id: string; catalogId: string; level: number };

type SimResult = {
  battleId: string;
  seed: number;
  engineVersion: string;
  winner: "A" | "B" | "Draw";
  turns: number;
  log: any[];
};

function useLocalStorageState(key: string, init: string) {
  const [v, setV] = useState(() => localStorage.getItem(key) ?? init);
  useEffect(() => {
    localStorage.setItem(key, v);
  }, [key, v]);
  return [v, setV] as const;
}

function fmtLogLine(e: any): string {
  if (!e || typeof e !== "object") return String(e);
  if (e.t === "turn_start") return `T${e.turn} ${e.side}: start`;
  if (e.t === "action") {
    const head = `T${e.turn} ${e.side}: ${e.actorName}`;
    if (e.action === "normal") {
      return `${head} normal -> ${e.targetName} ${e.evaded ? "(evaded)" : `-${e.damage}`} (hp=${e.targetHpAfter})`;
    }
    return `${head} skill[${e.skillName}] -> ${e.targetName} ${e.evaded ? "(evaded)" : `-${e.damage}`} (hp=${e.targetHpAfter})`;
  }
  if (e.t === "heal") return `T${e.turn} ${e.side}: ${e.actorName} heal[${e.skillName}] -> ${e.targetName} +${e.amount} (hp=${e.targetHpAfter})`;
  if (e.t === "buff") return `T${e.turn} ${e.side}: ${e.actorName} buff[${e.skillName}] ${e.stat} ${e.amount} (${e.durationTurns}t)`;
  if (e.t === "hero_down") return `T${e.turn} ${e.side}: ${e.heroName} down`;
  if (e.t === "battle_end") return `END: winner=${e.winner} turns=${e.turns}`;
  return JSON.stringify(e);
}

export function App() {
  const [token, setToken] = useLocalStorageState("am_token", "");

  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("test_user2");
  const [password, setPassword] = useState("password123");

  const [me, setMe] = useState<Me | null>(null);
  const [heroes, setHeroes] = useState<HeroItem[]>([]);

  const [teamId, setTeamId] = useState("t_main");
  const [teamVersion, setTeamVersion] = useState<number | null>(null);
  const [teamName, setTeamName] = useState("Main");
  const [heroIds, setHeroIds] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [battle, setBattle] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const heroOptions = useMemo(() => {
    return heroes.map((h) => ({ id: h.id, label: `${h.id}  (${h.catalogId}, Lv${h.level})` }));
  }, [heroes]);

  async function refreshAll(tk: string) {
    const me = await apiFetch<Me>("/api/v1/me", { token: tk });
    setMe(me);
    const items: HeroItem[] = [];
    let cursor: string | null | undefined = undefined;
    while (items.length < 200) {
      const q = new URLSearchParams({ limit: "200" });
      if (cursor) q.set("cursor", cursor);
      const page = await apiFetch<{ items: HeroItem[]; nextCursor: string | null }>(`/api/v1/heroes?${q.toString()}`, { token: tk });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    setHeroes(items);

    const team = me.teams.find((t) => t.id === teamId) ?? me.teams[0] ?? null;
    if (team) {
      setTeamId(team.id);
      setTeamName(team.name);
      setHeroIds(team.heroIds);
      setTeamVersion(team.version);
    }
  }

  useEffect(() => {
    setErr(null);
    if (!token) return;
    refreshAll(token).catch((e) => setErr(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function doAuth() {
    setBusy(true);
    setErr(null);
    try {
      const path = authMode === "register" ? "/api/v1/auth/register" : "/api/v1/auth/login";
      const r = await apiFetch<{ token: string }>(path, { method: "POST", body: { username, password } });
      setToken(r.token);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const body: any = { name: teamName, heroIds };
      if (teamVersion) body.ifVersion = teamVersion;
      const r = await apiFetch<{ team: { id: string; name: string; heroIds: string[]; updatedAt: string; version: number } }>(
        `/api/v1/teams/${encodeURIComponent(teamId)}`,
        { method: "PUT", token, body }
      );
      setTeamVersion(r.team.version);
      setHeroIds(r.team.heroIds);
      await refreshAll(token);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function fight() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    setBattle(null);
    try {
      const r = await apiFetch<SimResult>("/api/v1/battles/simulate", {
        method: "POST",
        token,
        body: { teamId, enemy: { kind: "npc", npcId: "stage_1_boss" }, options: { maxTurns: 200 } }
      });
      setBattle(r);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function swap(i: number, j: number) {
    setHeroIds((xs) => {
      if (i < 0 || j < 0 || i >= xs.length || j >= xs.length) return xs;
      const next = xs.slice();
      const t = next[i]!;
      next[i] = next[j]!;
      next[j] = t;
      return next;
    });
  }

  if (!token) {
    return (
      <div className="wrap">
        <div className="top">
          <div className="brand">
            <h1>Adventure Miner</h1>
            <div className="sub">/api/v1 · server-authoritative · deterministic battle</div>
          </div>
          <span className="pill">MVP UI</span>
        </div>

        <div className="card" style={{ maxWidth: 520 }}>
          <div className="hd">
            <h2>Auth</h2>
            <div className="pill">
              <button
                onClick={() => setAuthMode("register")}
                disabled={busy}
                className={authMode === "register" ? "primary" : ""}
              >
                Register
              </button>
              <button onClick={() => setAuthMode("login")} disabled={busy} className={authMode === "login" ? "primary" : ""}>
                Login
              </button>
            </div>
          </div>
          <div className="bd">
            <div className="row2">
              <div className="field">
                <label>username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="test_user" />
              </div>
              <div className="field">
                <label>password</label>
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
              </div>
            </div>
            <div style={{ height: 10 }} />
            <button className="primary" onClick={doAuth} disabled={busy}>
              {authMode === "register" ? "Create account" : "Login"}
            </button>
            {err ? <div style={{ marginTop: 10 }} className="bad mono">{err}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand">
          <h1>Adventure Miner</h1>
          <div className="sub">user={me?.userId ?? "…"} · team={teamId} · heroes={heroes.length}</div>
        </div>
        <div className="pill">
          <span className="mono">token</span>
          <button className="danger" onClick={() => setToken("")} disabled={busy}>
            Logout
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="hd">
            <h2>Team (25 slots)</h2>
            <div className="pill">version={teamVersion ?? "?"}</div>
          </div>
          <div className="bd">
            <div className="row">
              <div className="field">
                <label>teamName</label>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </div>
              <div className="pill">
                <button className="primary" onClick={saveTeam} disabled={busy || heroIds.length === 0}>
                  Save Team
                </button>
                <button className="primary" onClick={fight} disabled={busy || heroIds.length === 0}>
                  Challenge stage_1_boss
                </button>
              </div>
              {err ? <div className="bad mono">{err}</div> : null}
            </div>
            <div style={{ height: 12 }} />
            <div className="teamList">
              {heroIds.map((hid, idx) => (
                <div className="slot" key={`${idx}-${hid}`}>
                  <div className="idx">{String(idx + 1).padStart(2, "0")}</div>
                  <div>
                    <select
                      value={hid}
                      onChange={(e) => {
                        const v = e.target.value;
                        setHeroIds((xs) => xs.map((x, i) => (i === idx ? v : x)));
                      }}
                    >
                      {heroOptions.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ctl">
                    <button onClick={() => swap(idx, idx - 1)} disabled={busy || idx === 0}>
                      Up
                    </button>
                    <button onClick={() => swap(idx, idx + 1)} disabled={busy || idx === heroIds.length - 1}>
                      Down
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="hd">
            <h2>Battle Log</h2>
            <div className="pill">
              {battle ? (
                <>
                  <span className="mono">battleId={battle.battleId}</span>
                  <span className={battle.winner === "A" ? "ok" : battle.winner === "B" ? "bad" : ""}>winner={battle.winner}</span>
                  <span className="mono">turns={battle.turns}</span>
                </>
              ) : (
                <span className="mono">no battle yet</span>
              )}
            </div>
          </div>
          <div className="bd">
            <div className="log">
              {(battle?.log ?? []).map((e, i) => (
                <div className="logLine" key={i}>
                  <strong>{String(i + 1).padStart(3, "0")}</strong> {fmtLogLine(e)}
                </div>
              ))}
            </div>
            {battle ? (
              <div style={{ marginTop: 10 }} className="pill">
                <span className="mono">seed={battle.seed}</span>
                <span className="mono">engine={battle.engineVersion}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

