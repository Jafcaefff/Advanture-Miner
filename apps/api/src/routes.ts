import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { randomInt } from "node:crypto";

import { ApiError } from "./http-errors.js";
import type { Db } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { makeId } from "./ids.js";
import { starterCatalogIds } from "./content.js";

import { simulateBattle } from "@am/engine";

type AuthedReq = FastifyRequest & { user: { userId: string } };

function requireAuth(req: FastifyRequest): asserts req is AuthedReq {
  if (!(req as any).user?.userId) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
}

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, "username must be [a-zA-Z0-9_]+"),
  password: z.string().min(6).max(128)
});

const LoginSchema = RegisterSchema;

const PutTeamSchema = z.object({
  name: z.string().min(1).max(32).default("Main"),
  heroIds: z.array(z.string().min(1)).min(1).max(25),
  ifVersion: z.number().int().positive().optional()
});

const SimulateSchema = z.object({
  teamId: z.string().min(1),
  enemy: z.object({
    kind: z.literal("npc"),
    npcId: z.string().min(1)
  }),
  options: z
    .object({
      maxTurns: z.number().int().min(1).max(2000).optional()
    })
    .optional()
});

const StartAdventureSchema = z.object({
  stageId: z.string().min(1).optional()
});

const ClaimAdventureSchema = z.object({});

const FightBossSchema = z.object({
  teamId: z.string().min(1).default("t_main"),
  options: z
    .object({
      maxTurns: z.number().int().min(1).max(2000).optional()
    })
    .optional()
});

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function nowIso(): string {
  return new Date().toISOString();
}

function dtSeconds(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

async function signToken(app: FastifyInstance, userId: string): Promise<string> {
  return app.jwt.sign({ userId });
}

function getEngineVersion(): string {
  // For MVP: rely on env override, otherwise a static marker. We can later inject git sha at build time.
  return process.env.ENGINE_VERSION ? String(process.env.ENGINE_VERSION) : "dev";
}

function loadHeroSnapshotForUser(db: Db, userId: string, userHeroId: string) {
  const row = db
    .prepare(
      `
      SELECT uh.id AS id, uh.catalog_id AS catalogId, uh.level AS level, hc.name AS name,
             hc.base_stats_json AS baseStatsJson, hc.skills_json AS skillsJson
      FROM user_heroes uh
      JOIN heroes_catalog hc ON hc.id = uh.catalog_id
      WHERE uh.user_id = ? AND uh.id = ?
    `
    )
    .get(userId, userHeroId) as any;

  if (!row) return null;
  const stats = JSON.parse(row.baseStatsJson);
  const skills = JSON.parse(row.skillsJson);
  return {
    id: row.id,
    catalogId: row.catalogId,
    name: row.name,
    level: row.level,
    stats,
    skills
  };
}

function loadNpcTeamSnapshot(db: Db, npcId: string) {
  const row = db.prepare("SELECT team_snapshot_json AS js FROM npc_teams WHERE id = ?").get(npcId) as any;
  if (!row) return null;
  return JSON.parse(row.js);
}

function loadStage(db: Db, stageId: string) {
  const row = db
    .prepare("SELECT id, name, npc_id AS npcId, gold_per_sec AS goldPerSec, exp_per_sec AS expPerSec, next_stage_id AS nextStageId FROM stages WHERE id = ?")
    .get(stageId) as any;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    npcId: String(row.npcId),
    goldPerSec: Number(row.goldPerSec),
    expPerSec: Number(row.expPerSec),
    nextStageId: row.nextStageId == null ? null : String(row.nextStageId)
  };
}

function ensureAdventureState(db: Db, userId: string, defaultStageId: string) {
  const row = db.prepare("SELECT user_id AS userId FROM adventure_state WHERE user_id = ?").get(userId) as any;
  if (row) return;
  const now = nowIso();
  db.prepare("INSERT INTO adventure_state (user_id, stage_id, started_at, last_claimed_at) VALUES (?, ?, ?, ?)").run(
    userId,
    defaultStageId,
    now,
    now
  );
}

function claimAdventure(db: Db, userId: string): { gainedGold: number; gainedExp: number; stage: any; totals: any } {
  const st = db
    .prepare("SELECT stage_id AS stageId, started_at AS startedAt, last_claimed_at AS lastClaimedAt FROM adventure_state WHERE user_id = ?")
    .get(userId) as any;
  if (!st) throw new ApiError(500, "INTERNAL_ERROR", "Missing adventure_state");

  const stage = loadStage(db, String(st.stageId));
  if (!stage) throw new ApiError(500, "INTERNAL_ERROR", "Invalid stage in adventure_state");

  const now = nowIso();
  const dt = Math.min(dtSeconds(String(st.lastClaimedAt), now), 12 * 3600); // cap 12h offline for MVP
  const gainedGold = Math.max(0, Math.floor(dt * stage.goldPerSec));
  const gainedExp = Math.max(0, Math.floor(dt * stage.expPerSec));

  db.transaction(() => {
    db.prepare("UPDATE users SET gold = gold + ?, exp = exp + ? WHERE id = ?").run(gainedGold, gainedExp, userId);
    db.prepare("UPDATE adventure_state SET last_claimed_at = ? WHERE user_id = ?").run(now, userId);
  })();

  const totals = db.prepare("SELECT gold, exp FROM users WHERE id = ?").get(userId) as any;
  return { gainedGold, gainedExp, stage, totals: { gold: Number(totals.gold), exp: Number(totals.exp) } };
}

export function installRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/v1/health", async () => ({ ok: true }));

  // Public catalog endpoints (MVP): let the web UI render human-friendly names.
  app.get("/api/v1/catalog/heroes", async () => {
    const rows = db
      .prepare("SELECT id, name FROM heroes_catalog ORDER BY id ASC")
      .all()
      .map((r: any) => ({ id: String(r.id), name: String(r.name) }));
    return { items: rows };
  });

  app.post("/api/v1/auth/register", async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const username = body.username;
    const passwordHash = hashPassword(body.password);
    const id = makeId("u");
    const createdAt = nowIso();

    try {
      db.prepare("INSERT INTO users (id, username, password_hash, roster_version, created_at, gold, exp) VALUES (?, ?, ?, 1, ?, 0, 0)").run(
        id,
        username,
        passwordHash,
        createdAt
      );
    } catch (e: any) {
      if (String(e?.message ?? "").includes("UNIQUE")) throw new ApiError(409, "USERNAME_TAKEN", "Username taken");
      throw e;
    }

    // Give starter heroes
    const now = createdAt;
    const ins = db.prepare(
      "INSERT INTO user_heroes (id, user_id, catalog_id, level, awakens, stats_override_json, created_at, updated_at) VALUES (?, ?, ?, 1, 0, NULL, ?, ?)"
    );
    const starter = starterCatalogIds();
    db.transaction(() => {
      for (const catalogId of starter) ins.run(makeId("uh"), id, catalogId, now, now);
      // Create a default team with the first 25 heroes
      const heroIds = db
        .prepare("SELECT id FROM user_heroes WHERE user_id = ? ORDER BY created_at ASC")
        .all(id)
        .map((r: any) => String(r.id));
      db.prepare(
        "INSERT INTO teams (id, user_id, name, hero_ids_json, version, created_at, updated_at) VALUES ('t_main', ?, 'Main', ?, 1, ?, ?)"
      ).run(id, JSON.stringify(heroIds.slice(0, 25)), now, now);

      // Start adventure at stage_1
      ensureAdventureState(db, id, "stage_1");
    })();

    const token = await signToken(app, id);
    reply.code(201).send({ token });
  });

  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const row = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(body.username) as any;
    if (!row) throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    if (!verifyPassword(body.password, row.password_hash)) throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials");
    const token = await signToken(app, String(row.id));
    reply.send({ token });
  });

  app.get("/api/v1/me", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    ensureAdventureState(db, userId, "stage_1");
    const user = db.prepare("SELECT id, roster_version, gold, exp FROM users WHERE id = ?").get(userId) as any;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
    const teams = db
      .prepare("SELECT id, name, hero_ids_json AS heroIdsJson, updated_at AS updatedAt, version FROM teams WHERE user_id = ?")
      .all(userId)
      .map((r: any) => ({
        id: String(r.id),
        name: String(r.name),
        heroIds: JSON.parse(String(r.heroIdsJson)),
        updatedAt: String(r.updatedAt),
        version: Number(r.version)
      }));
    return {
      userId: String(user.id),
      rosterVersion: Number(user.roster_version),
      gold: Number(user.gold ?? 0),
      exp: Number(user.exp ?? 0),
      teams
    };
  });

  app.get("/api/v1/adventure", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    ensureAdventureState(db, userId, "stage_1");

    const st = db
      .prepare("SELECT stage_id AS stageId, started_at AS startedAt, last_claimed_at AS lastClaimedAt FROM adventure_state WHERE user_id = ?")
      .get(userId) as any;
    const stage = loadStage(db, String(st.stageId));
    if (!stage) throw new ApiError(500, "INTERNAL_ERROR", "Invalid stage");

    const totals = db.prepare("SELECT gold, exp FROM users WHERE id = ?").get(userId) as any;
    const now = nowIso();
    const previewDt = Math.min(dtSeconds(String(st.lastClaimedAt), now), 12 * 3600);
    const preview = {
      seconds: previewDt,
      gold: Math.max(0, Math.floor(previewDt * stage.goldPerSec)),
      exp: Math.max(0, Math.floor(previewDt * stage.expPerSec))
    };

    return {
      stage,
      startedAt: String(st.startedAt),
      lastClaimedAt: String(st.lastClaimedAt),
      balances: { gold: Number(totals.gold ?? 0), exp: Number(totals.exp ?? 0) },
      claimPreview: preview
    };
  });

  app.post("/api/v1/adventure/start", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    ensureAdventureState(db, userId, "stage_1");
    const body = StartAdventureSchema.parse(req.body ?? {});

    const current = db.prepare("SELECT stage_id AS stageId FROM adventure_state WHERE user_id = ?").get(userId) as any;
    const nextStageId = body.stageId ?? String(current.stageId);
    const stage = loadStage(db, nextStageId);
    if (!stage) throw new ApiError(404, "NOT_FOUND", "Stage not found");

    const now = nowIso();
    db.prepare("UPDATE adventure_state SET stage_id = ?, started_at = ?, last_claimed_at = ? WHERE user_id = ?").run(nextStageId, now, now, userId);
    return { ok: true, stageId: nextStageId, startedAt: now };
  });

  app.post("/api/v1/adventure/claim", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    ClaimAdventureSchema.parse(req.body ?? {});
    ensureAdventureState(db, userId, "stage_1");
    const r = claimAdventure(db, userId);
    return { gained: { gold: r.gainedGold, exp: r.gainedExp }, balances: r.totals };
  });

  app.post("/api/v1/adventure/fightBoss", async (req, reply) => {
    requireAuth(req);
    const userId = req.user.userId;
    ensureAdventureState(db, userId, "stage_1");
    const body = FightBossSchema.parse(req.body ?? {});

    // Claim first so progression doesn't eat offline gains.
    const claimed = claimAdventure(db, userId);

    const st = db.prepare("SELECT stage_id AS stageId FROM adventure_state WHERE user_id = ?").get(userId) as any;
    const stage = loadStage(db, String(st.stageId));
    if (!stage) throw new ApiError(500, "INTERNAL_ERROR", "Invalid stage");

    // Reuse simulate logic (inline here for MVP).
    const teamRow = db.prepare("SELECT hero_ids_json AS heroIdsJson FROM teams WHERE user_id = ? AND id = ?").get(userId, body.teamId) as any;
    if (!teamRow) throw new ApiError(404, "TEAM_NOT_FOUND", "Team not found");
    const heroIds = JSON.parse(String(teamRow.heroIdsJson)) as string[];
    if (!Array.isArray(heroIds) || heroIds.length < 1 || heroIds.length > 25) throw new ApiError(500, "INTERNAL_ERROR", "Invalid team data");

    const teamA = {
      heroes: heroIds
        .map((hid) => loadHeroSnapshotForUser(db, userId, String(hid)))
        .filter(Boolean)
        .map((h: any) => ({
          id: String(h.id),
          name: String(h.name),
          level: Number(h.level),
          stats: h.stats,
          skills: h.skills
        }))
    };
    if (teamA.heroes.length !== heroIds.length) throw new ApiError(409, "HERO_NOT_OWNED", "Team contains heroes not owned by user");

    const npcTeam = loadNpcTeamSnapshot(db, stage.npcId);
    if (!npcTeam) throw new ApiError(404, "NPC_NOT_FOUND", "NPC not found");
    const teamB = npcTeam;

    const seed = randomInt(1, 2147483647);
    const config = { seed, maxTurns: body.options?.maxTurns ?? 200 };
    const result = simulateBattle(teamA as any, teamB as any, config as any);

    const battleId = makeId("b");
    const engineVersion = getEngineVersion();
    const createdAt = nowIso();

    const inputSnapshot = { teamA, teamB, config };
    const resultSummary = { winner: result.winner, turns: result.turns };
    const scene = {
      player: { name: teamA.heroes[0]?.name ?? "玩家", maxHp: Number(teamA.heroes[0]?.stats?.hp ?? 1) },
      enemy: { name: teamB.heroes?.[0]?.name ?? "敌人", maxHp: Number(teamB.heroes?.[0]?.stats?.hp ?? 1) }
    };

    db.prepare(
      "INSERT INTO battle_logs (id, user_id, kind, seed, engine_version, input_snapshot_json, result_summary_json, log_json, created_at) VALUES (?, ?, 'npc', ?, ?, ?, ?, ?, ?)"
    ).run(
      battleId,
      userId,
      seed,
      engineVersion,
      JSON.stringify(inputSnapshot),
      JSON.stringify(resultSummary),
      JSON.stringify(result.log),
      createdAt
    );

    // Progress on win (A is player).
    let progressed = false;
    let newStageId: string | null = null;
    if (result.winner === "A" && stage.nextStageId) {
      progressed = true;
      newStageId = stage.nextStageId;
      const now = nowIso();
      db.prepare("UPDATE adventure_state SET stage_id = ?, started_at = ?, last_claimed_at = ? WHERE user_id = ?").run(newStageId, now, now, userId);
    }

    reply.code(201).send({
      claimed,
      battle: {
        battleId,
        seed,
        engineVersion,
        winner: result.winner,
        turns: result.turns,
        log: result.log,
        scene
      },
      progressed,
      newStageId
    });
  });

  app.get("/api/v1/heroes", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;

    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().optional()
    });
    const q = querySchema.parse((req as any).query ?? {});

    // MVP cursor: "after id", ordered by created_at then id.
    let rows: any[];
    if (q.cursor) {
      const cur = db.prepare("SELECT created_at AS createdAt FROM user_heroes WHERE user_id = ? AND id = ?").get(userId, q.cursor) as any;
      if (!cur) throw new ApiError(400, "VALIDATION_ERROR", "Invalid cursor");
      rows = db
        .prepare(
          "SELECT id, catalog_id AS catalogId, level, created_at AS createdAt FROM user_heroes WHERE user_id = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT ?"
        )
        .all(userId, String(cur.createdAt), String(cur.createdAt), q.cursor, q.limit) as any[];
    } else {
      rows = db
        .prepare(
          "SELECT id, catalog_id AS catalogId, level, created_at AS createdAt FROM user_heroes WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?"
        )
        .all(userId, q.limit) as any[];
    }

    const items = rows.map((r) => ({ id: String(r.id), catalogId: String(r.catalogId), level: Number(r.level) }));
    const nextCursor = items.length === q.limit ? items[items.length - 1]!.id : null;
    return { items, nextCursor };
  });

  app.put("/api/v1/teams/:teamId", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    const teamId = z.object({ teamId: z.string().min(1) }).parse((req as any).params).teamId;
    const body = PutTeamSchema.parse(req.body);

    const heroIds = body.heroIds.map(String);
    if (uniq(heroIds).length !== heroIds.length) throw new ApiError(409, "HERO_DUPLICATED", "heroIds contains duplicates");

    // Validate ownership
    const placeholders = heroIds.map(() => "?").join(",");
    const owned = db
      .prepare(`SELECT id FROM user_heroes WHERE user_id = ? AND id IN (${placeholders})`)
      .all(userId, ...heroIds)
      .map((r: any) => String(r.id));
    if (owned.length !== heroIds.length) throw new ApiError(409, "HERO_NOT_OWNED", "heroIds contains heroes not owned by user");

    const existing = db.prepare("SELECT version FROM teams WHERE user_id = ? AND id = ?").get(userId, teamId) as any;
    const now = nowIso();

    db.transaction(() => {
      if (existing) {
        if (body.ifVersion && Number(existing.version) !== body.ifVersion) throw new ApiError(409, "TEAM_VERSION_CONFLICT", "Team version conflict");
        const nextVersion = Number(existing.version) + 1;
        db.prepare("UPDATE teams SET name = ?, hero_ids_json = ?, version = ?, updated_at = ? WHERE user_id = ? AND id = ?").run(
          body.name,
          JSON.stringify(heroIds),
          nextVersion,
          now,
          userId,
          teamId
        );
      } else {
        db.prepare(
          "INSERT INTO teams (id, user_id, name, hero_ids_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
        ).run(teamId, userId, body.name, JSON.stringify(heroIds), now, now);
      }

      db.prepare("UPDATE users SET roster_version = roster_version + 1 WHERE id = ?").run(userId);
    })();

    const row = db
      .prepare("SELECT id, name, hero_ids_json AS heroIdsJson, updated_at AS updatedAt, version FROM teams WHERE user_id = ? AND id = ?")
      .get(userId, teamId) as any;
    return {
      team: {
        id: String(row.id),
        name: String(row.name),
        heroIds: JSON.parse(String(row.heroIdsJson)),
        updatedAt: String(row.updatedAt),
        version: Number(row.version)
      }
    };
  });

  app.post("/api/v1/battles/simulate", async (req, reply) => {
    requireAuth(req);
    const userId = req.user.userId;
    const body = SimulateSchema.parse(req.body);

    const teamRow = db.prepare("SELECT hero_ids_json AS heroIdsJson FROM teams WHERE user_id = ? AND id = ?").get(userId, body.teamId) as any;
    if (!teamRow) throw new ApiError(404, "TEAM_NOT_FOUND", "Team not found");
    const heroIds = JSON.parse(String(teamRow.heroIdsJson)) as string[];
    if (!Array.isArray(heroIds) || heroIds.length < 1 || heroIds.length > 25) throw new ApiError(500, "INTERNAL_ERROR", "Invalid team data");

    const teamA = {
      heroes: heroIds
        .map((hid) => loadHeroSnapshotForUser(db, userId, String(hid)))
        .filter(Boolean)
        .map((h: any) => ({
          id: String(h.id),
          name: String(h.name),
          level: Number(h.level),
          stats: h.stats,
          skills: h.skills
        }))
    };
    if (teamA.heroes.length !== heroIds.length) throw new ApiError(409, "HERO_NOT_OWNED", "Team contains heroes not owned by user");

    const npcTeam = loadNpcTeamSnapshot(db, body.enemy.npcId);
    if (!npcTeam) throw new ApiError(404, "NPC_NOT_FOUND", "NPC not found");
    const teamB = npcTeam;

    const seed = randomInt(1, 2147483647);
    const config = { seed, maxTurns: body.options?.maxTurns ?? 200 };
    const result = simulateBattle(teamA as any, teamB as any, config as any);

    const battleId = makeId("b");
    const engineVersion = getEngineVersion();
    const createdAt = nowIso();

    const inputSnapshot = { teamA, teamB, config };
    const resultSummary = { winner: result.winner, turns: result.turns };
    const scene = {
      player: { name: teamA.heroes[0]?.name ?? "玩家", maxHp: Number(teamA.heroes[0]?.stats?.hp ?? 1) },
      enemy: { name: teamB.heroes?.[0]?.name ?? "敌人", maxHp: Number(teamB.heroes?.[0]?.stats?.hp ?? 1) }
    };

    db.prepare(
      "INSERT INTO battle_logs (id, user_id, kind, seed, engine_version, input_snapshot_json, result_summary_json, log_json, created_at) VALUES (?, ?, 'npc', ?, ?, ?, ?, ?, ?)"
    ).run(
      battleId,
      userId,
      seed,
      engineVersion,
      JSON.stringify(inputSnapshot),
      JSON.stringify(resultSummary),
      JSON.stringify(result.log),
      createdAt
    );

    reply.code(201).send({
      battleId,
      seed,
      engineVersion,
      winner: result.winner,
      turns: result.turns,
      log: result.log,
      scene
    });
  });

  app.get("/api/v1/battles/:battleId", async (req) => {
    requireAuth(req);
    const userId = req.user.userId;
    const battleId = z.object({ battleId: z.string().min(1) }).parse((req as any).params).battleId;

    const row = db
      .prepare(
        "SELECT id, created_at AS createdAt, seed, engine_version AS engineVersion, input_snapshot_json AS inputJson, result_summary_json AS resultJson, log_json AS logJson FROM battle_logs WHERE id = ? AND user_id = ?"
      )
      .get(battleId, userId) as any;
    if (!row) throw new ApiError(404, "BATTLE_NOT_FOUND", "Battle not found");

    return {
      battleId: String(row.id),
      createdAt: String(row.createdAt),
      seed: Number(row.seed),
      engineVersion: String(row.engineVersion),
      input: JSON.parse(String(row.inputJson)),
      result: JSON.parse(String(row.resultJson)),
      log: JSON.parse(String(row.logJson))
    };
  });
}
