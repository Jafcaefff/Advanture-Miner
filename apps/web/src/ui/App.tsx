import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

type Me = {
  userId: string;
  rosterVersion: number;
  teams: Array<{ id: string; name: string; heroIds: string[]; updatedAt: string; version: number }>;
};

type HeroItem = { id: string; catalogId: string; level: number };
type CatalogHero = { id: string; name: string };

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
  const [catalog, setCatalog] = useState<Record<string, string>>({});

  const [teamId, setTeamId] = useState("t_main");
  const [teamVersion, setTeamVersion] = useState<number | null>(null);
  const [teamName, setTeamName] = useState("Main");
  const [heroIds, setHeroIds] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [battle, setBattle] = useState<SimResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const heroOptions = useMemo(() => {
    return heroes.map((h) => {
      const nm = catalog[h.catalogId] ?? h.catalogId;
      const shortId = h.id.length > 10 ? `${h.id.slice(0, 6)}…${h.id.slice(-4)}` : h.id;
      return { id: h.id, label: `${nm}  Lv${h.level}  (${shortId})` };
    });
  }, [heroes, catalog]);

  async function refreshAll(tk: string) {
    const cat = await apiFetch<{ items: CatalogHero[] }>("/api/v1/catalog/heroes");
    setCatalog(Object.fromEntries(cat.items.map((x) => [x.id, x.name])));

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
        <div className="hud">
          <div className="top">
          <div className="brand">
            <h1>Adventure Miner</h1>
            <div className="sub">/api/v1 · server-authoritative · deterministic battle</div>
          </div>
          <span className="pill">MVP UI</span>
          </div>
        </div>

        <div className="panel" style={{ maxWidth: 520 }}>
          <div className="hd">
            <h2>Auth</h2>
            <div className="pill">
              <button
                onClick={() => setAuthMode("register")}
                disabled={busy}
                className={authMode === "register" ? "primary" : ""}
              >
                注册
              </button>
              <button onClick={() => setAuthMode("login")} disabled={busy} className={authMode === "login" ? "primary" : ""}>
                登录
              </button>
            </div>
          </div>
          <div className="bd">
            <div className="row2">
              <div className="field">
                <label>用户名</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="test_user" />
              </div>
              <div className="field">
                <label>密码</label>
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
              </div>
            </div>
            <div style={{ height: 10 }} />
            <button className="primary" onClick={doAuth} disabled={busy}>
              {authMode === "register" ? "创建账号" : "登录"}
            </button>
            {err ? (
              <div style={{ marginTop: 10 }} className="errorBox mono">
                {err}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="hud">
        <div className="top">
          <div className="brand">
            <h1>Adventure Miner</h1>
            <div className="sub">
              user={me?.userId ?? "…"} · rosterV={me?.rosterVersion ?? "…"} · team={teamId} · heroes={heroes.length}
            </div>
          </div>
          <div className="pill">
            <span className="mono">token</span>
            <button className="danger" onClick={() => setToken("")} disabled={busy}>
              退出
            </button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <div className="hd">
            <h2>Team (25 slots)</h2>
            <div className="pill">version={teamVersion ?? "?"}</div>
          </div>
          <div className="bd">
            <div className="row">
              <div className="field">
                <label>队伍名</label>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </div>
              <div className="stack">
                <button className="primary" onClick={saveTeam} disabled={busy || heroIds.length === 0}>
                  保存队伍
                </button>
                <button className="primary" onClick={fight} disabled={busy || heroIds.length === 0}>
                  挑战 stage_1_boss
                </button>
                <span className="pill mono">站位越靠前越优先</span>
              </div>
              {err ? <div className="errorBox mono">{err}</div> : null}
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
                      ▲
                    </button>
                    <button onClick={() => swap(idx, idx + 1)} disabled={busy || idx === heroIds.length - 1}>
                      ▼
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel">
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
                <div className={`logLine ${e?.t === "battle_end" ? "end" : e?.side === "A" ? "a" : e?.side === "B" ? "b" : ""}`} key={i}>
                  <strong>{String(i + 1).padStart(3, "0")}</strong> {fmtLogLine(e)}
                </div>
              ))}
            </div>
            {battle ? (
              <div style={{ marginTop: 10 }} className="stack">
                <span className="pill mono">seed={battle.seed}</span>
                <span className="pill mono">engine={battle.engineVersion}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bottomNav">
        <div className="bar">
          <div className="tabBtn active" role="button" tabIndex={0}>
            <div className="ic">T</div>
            <div>
              <span className="name">队伍</span>
              <span className="hint">25人站位</span>
            </div>
          </div>
          <div className="tabBtn" role="button" tabIndex={0} aria-disabled="true" style={{ opacity: 0.55 }}>
            <div className="ic">A</div>
            <div>
              <span className="name">冒险</span>
              <span className="hint">待接入</span>
            </div>
          </div>
          <div className="tabBtn" role="button" tabIndex={0} aria-disabled="true" style={{ opacity: 0.55 }}>
            <div className="ic">M</div>
            <div>
              <span className="name">挖矿</span>
              <span className="hint">待接入</span>
            </div>
          </div>
          <div className="tabBtn" role="button" tabIndex={0} aria-disabled="true" style={{ opacity: 0.55 }}>
            <div className="ic">S</div>
            <div>
              <span className="name">设置</span>
              <span className="hint">待接入</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
