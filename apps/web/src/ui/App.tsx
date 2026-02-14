import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

type Me = {
  userId: string;
  rosterVersion: number;
  gold?: number;
  exp?: number;
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

type AdventureState = {
  stage: { id: string; name: string; npcId: string; goldPerSec: number; expPerSec: number; nextStageId: string | null };
  startedAt: string;
  lastClaimedAt: string;
  balances: { gold: number; exp: number };
  claimPreview: { seconds: number; gold: number; exp: number };
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

  const [tab, setTab] = useState<"team" | "adventure" | "mine" | "settings">("team");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("test_user2");
  const [password, setPassword] = useState("password123");

  const [me, setMe] = useState<Me | null>(null);
  const [heroes, setHeroes] = useState<HeroItem[]>([]);
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [adv, setAdv] = useState<AdventureState | null>(null);

  const [teamId, setTeamId] = useState("t_main");
  const [teamVersion, setTeamVersion] = useState<number | null>(null);
  const [teamName, setTeamName] = useState("Main");
  const [heroIds, setHeroIds] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number>(0); // 0-based

  const [busy, setBusy] = useState(false);
  const [battle, setBattle] = useState<SimResult | null>(null);
  const [visibleLog, setVisibleLog] = useState(0);
  const [playSpeed, setPlaySpeed] = useState<"slow" | "normal" | "fast">("normal");
  const [playing, setPlaying] = useState(false);
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
    const adv = await apiFetch<AdventureState>("/api/v1/adventure", { token: tk });
    setAdv(adv);
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
      setSelectedSlot((s) => Math.min(s, Math.max(0, team.heroIds.length - 1)));
    }
  }

  useEffect(() => {
    setErr(null);
    if (!token) return;
    refreshAll(token).catch((e) => setErr(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!battle) return;
    setVisibleLog(0);
    setPlaying(true);
  }, [battle?.battleId]);

  useEffect(() => {
    if (!battle || !playing) return;
    const total = battle.log.length;
    if (visibleLog >= total) return;
    const ms = playSpeed === "slow" ? 240 : playSpeed === "fast" ? 50 : 110;
    const t = window.setInterval(() => {
      setVisibleLog((v) => Math.min(total, v + 1));
    }, ms);
    return () => window.clearInterval(t);
  }, [battle, playing, playSpeed, visibleLog]);

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

  async function advClaim() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/api/v1/adventure/claim", { method: "POST", token, body: {} });
      await refreshAll(token);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function advFightBoss() {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<any>("/api/v1/adventure/fightBoss", { method: "POST", token, body: { teamId: "t_main" } });
      setBattle(r.battle as SimResult);
      await refreshAll(token);
      setTab("team");
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

  function setHeroAt(slot: number, heroId: string) {
    setHeroIds((xs) => {
      if (slot < 0 || slot >= xs.length) return xs;
      const next = xs.slice();
      next[slot] = heroId;
      return next;
    });
  }

  function getHeroLabelById(heroId: string): string {
    const h = heroes.find((x) => x.id === heroId);
    if (!h) return heroId;
    const nm = catalog[h.catalogId] ?? h.catalogId;
    return `${nm} Lv${h.level}`;
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
          <div className="stack">
            <span className="pill mono">gold={adv?.balances.gold ?? me?.gold ?? 0}</span>
            <span className="pill mono">exp={adv?.balances.exp ?? me?.exp ?? 0}</span>
            <div className="pill">
              <span className="mono">token</span>
              <button className="danger" onClick={() => setToken("")} disabled={busy}>
                退出
              </button>
            </div>
          </div>
        </div>
      </div>

      {tab === "adventure" ? (
        <div className="grid">
          <div className="panel panelTall">
            <div className="hd">
              <h2>Adventure</h2>
              <div className="pill mono">{adv ? adv.stage.id : "..."}</div>
            </div>
            <div className="bd">
              <div className="row">
                <div className="pill mono">关卡: {adv ? `${adv.stage.name} (${adv.stage.id})` : "..."}</div>
                <div className="pill mono">收益: +{adv?.stage.goldPerSec ?? 0}g/s · +{adv?.stage.expPerSec ?? 0}exp/s</div>
                <div className="pill mono">
                  可领取: +{adv?.claimPreview.gold ?? 0}g · +{adv?.claimPreview.exp ?? 0}exp (sec={adv?.claimPreview.seconds ?? 0})
                </div>
                <div className="stack">
                  <button className="primary" onClick={advClaim} disabled={busy}>
                    领取收益
                  </button>
                  <button className="primary" onClick={advFightBoss} disabled={busy}>
                    打 Boss
                  </button>
                </div>
                {err ? <div className="errorBox mono">{err}</div> : null}
              </div>
            </div>
          </div>

          <div className="panel panelTall">
            <div className="hd">
              <h2>Tips</h2>
              <div className="pill mono">MVP</div>
            </div>
            <div className="bd">
              <div className="row">
                <div className="pill mono">Boss 战仍用 25 人概率叠加引擎裁决</div>
                <div className="pill mono">胜利会推进到下一关（如果有 nextStageId）</div>
                <div className="pill mono">离线收益上限 12 小时（MVP）</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid">
          <div className="panel panelTall">
            <div className="hd">
              <h2>Team (25 slots)</h2>
              <div className="pill">version={teamVersion ?? "?"}</div>
            </div>
            <div className="bd">
              <div className="teamFixed">
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
                    <span className="pill mono">Shift+点格子: 交换</span>
                  </div>
                  {err ? <div className="errorBox mono">{err}</div> : null}
                </div>
                <div style={{ height: 12 }} />
              </div>

              <div className="teamScroll">
                <div className="formationWrap">
                  <div className="formation">
                    {Array.from({ length: Math.min(25, heroIds.length) }, (_, idx) => {
                      const hid = heroIds[idx]!;
                      const label = getHeroLabelById(hid);
                      const sel = idx === selectedSlot;
                      return (
                        <button
                          key={`${idx}-${hid}`}
                          className={`tile ${sel ? "sel" : ""} ${idx === 0 ? "front" : ""}`}
                          disabled={busy}
                          onClick={(e) => {
                            if ((e as any).shiftKey && selectedSlot !== idx) swap(selectedSlot, idx);
                            setSelectedSlot(idx);
                          }}
                          title={label}
                        >
                          <span className="n">{String(idx + 1).padStart(2, "0")}</span>
                          <span className="nm">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="editor">
                    <div className="pill mono">
                      slot={String(selectedSlot + 1).padStart(2, "0")} ·{" "}
                      {heroIds[selectedSlot] ? getHeroLabelById(heroIds[selectedSlot]!) : "-"}
                    </div>
                    <div className="row">
                      <div className="field">
                        <label>选择英雄</label>
                        <select
                          value={heroIds[selectedSlot] ?? ""}
                          onChange={(e) => setHeroAt(selectedSlot, e.target.value)}
                          disabled={busy || heroIds.length === 0}
                        >
                          {heroOptions.map((o) => (
                            <option value={o.id} key={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="stack">
                        <button onClick={() => swap(selectedSlot, selectedSlot - 1)} disabled={busy || selectedSlot === 0}>
                          前移 ▲
                        </button>
                        <button
                          onClick={() => swap(selectedSlot, selectedSlot + 1)}
                          disabled={busy || selectedSlot >= heroIds.length - 1}
                        >
                          后移 ▼
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel panelTall">
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
              <div className="battleBody">
                <div className="stack" style={{ marginBottom: 10 }}>
                  <button onClick={() => setPlaying((p) => !p)} disabled={!battle}>
                    {playing ? "暂停" : "播放"}
                  </button>
                  <button onClick={() => setVisibleLog(battle ? battle.log.length : 0)} disabled={!battle}>
                    跳到结尾
                  </button>
                  <select value={playSpeed} onChange={(e) => setPlaySpeed(e.target.value as any)} disabled={!battle}>
                    <option value="slow">慢</option>
                    <option value="normal">中</option>
                    <option value="fast">快</option>
                  </select>
                  <span className="pill mono">
                    {battle ? `${visibleLog}/${battle.log.length}` : "0/0"}
                  </span>
                </div>

                <div className="log">
                  {(battle?.log ?? []).slice(0, visibleLog).map((e, i) => (
                    <div
                      className={`logLine ${e?.t === "battle_end" ? "end" : e?.side === "A" ? "a" : e?.side === "B" ? "b" : ""}`}
                      key={i}
                    >
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
        </div>
      )}

      <div className="bottomNav">
        <div className="bar">
          <div className={`tabBtn ${tab === "team" ? "active" : ""}`} role="button" tabIndex={0} onClick={() => setTab("team")}>
            <div className="ic">T</div>
            <div>
              <span className="name">队伍</span>
              <span className="hint">25人站位</span>
            </div>
          </div>
          <div
            className={`tabBtn ${tab === "adventure" ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => setTab("adventure")}
          >
            <div className="ic">A</div>
            <div>
              <span className="name">冒险</span>
              <span className="hint">{adv ? adv.stage.id : "..."}</span>
            </div>
          </div>
          <div className={`tabBtn ${tab === "mine" ? "active" : ""}`} role="button" tabIndex={0} onClick={() => setTab("mine")}>
            <div className="ic">M</div>
            <div>
              <span className="name">挖矿</span>
              <span className="hint">待接入</span>
            </div>
          </div>
          <div className={`tabBtn ${tab === "settings" ? "active" : ""}`} role="button" tabIndex={0} onClick={() => setTab("settings")}>
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
