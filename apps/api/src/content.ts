import type { Db } from "./db.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type CatalogHero = {
  id: string;
  name: string;
  baseStats: { hp: number; atk: number; def: number; eva: number; preempt: number; king: number };
  skills: any[];
  tags?: any[];
};

const FALLBACK_CATALOG: CatalogHero[] = [
  {
    id: "hero_demo_001",
    name: "Swordsman",
    baseStats: { hp: 140, atk: 28, def: 2, eva: 0.01, preempt: 0.05, king: 0.02 },
    skills: [{ id: "slash_plus", name: "Slash+", kind: "damage", chance: 0.12, power: 1.6 }]
  },
  {
    id: "hero_demo_002",
    name: "Rogue",
    baseStats: { hp: 110, atk: 24, def: 1, eva: 0.06, preempt: 0.08, king: 0.01 },
    skills: [{ id: "stab", name: "Stab", kind: "damage", chance: 0.15, power: 1.3 }]
  },
  {
    id: "hero_demo_003",
    name: "Cleric",
    baseStats: { hp: 120, atk: 18, def: 2, eva: 0.01, preempt: 0.04, king: 0.0 },
    skills: [{ id: "first_aid", name: "First Aid", kind: "heal", chance: 0.12, power: 20 }]
  }
];

const FALLBACK_NPC_TEAMS = [
  {
    id: "stage_1_boss",
    name: "Stage 1 Boss",
    teamSnapshot: {
      heroes: [
        {
          id: "npc_boss_1",
          name: "Golem",
          level: 1,
          stats: { hp: 550, atk: 20, def: 2, eva: 0.01, preempt: 0.03, king: 0.02 },
          skills: [{ id: "smash", name: "Smash", kind: "damage", chance: 0.1, power: 1.7 }]
        }
      ]
    }
  }
];

function loadJsonFile<T>(path: string): T | null {
  try {
    const txt = readFileSync(path, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export function seedContent(db: Db, contentDir: string) {
  const now = new Date().toISOString();

  const heroesPath = resolve(process.cwd(), contentDir, "heroes.json");
  const npcTeamsPath = resolve(process.cwd(), contentDir, "npc_teams.json");
  const stagesPath = resolve(process.cwd(), contentDir, "stages.json");

  const catalog = loadJsonFile<CatalogHero[]>(heroesPath) ?? FALLBACK_CATALOG;
  const npcTeams = loadJsonFile<any[]>(npcTeamsPath) ?? FALLBACK_NPC_TEAMS;
  const stages = loadJsonFile<any[]>(stagesPath) ?? [];

  // Upsert so changing json updates DB without wiping user data.
  const upsertCatalog = db.prepare(
    `
    INSERT INTO heroes_catalog (id, name, base_stats_json, skills_json, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_stats_json = excluded.base_stats_json,
      skills_json = excluded.skills_json,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `
  );
  for (const h of catalog) {
    upsertCatalog.run(h.id, h.name, JSON.stringify(h.baseStats), JSON.stringify(h.skills), JSON.stringify(h.tags ?? []), now, now);
  }

  const upsertNpc = db.prepare(
    `
    INSERT INTO npc_teams (id, name, team_snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      team_snapshot_json = excluded.team_snapshot_json,
      updated_at = excluded.updated_at
  `
  );
  for (const t of npcTeams) {
    upsertNpc.run(String(t.id), String(t.name), JSON.stringify((t as any).teamSnapshot), now, now);
  }

  if (stages.length > 0) {
    const upsertStage = db.prepare(
      `
      INSERT INTO stages (id, name, npc_id, gold_per_sec, exp_per_sec, next_stage_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        npc_id = excluded.npc_id,
        gold_per_sec = excluded.gold_per_sec,
        exp_per_sec = excluded.exp_per_sec,
        next_stage_id = excluded.next_stage_id,
        updated_at = excluded.updated_at
    `
    );

    for (const s of stages) {
      upsertStage.run(
        String(s.id),
        String(s.name),
        String(s.npcId),
        Number(s.goldPerSec ?? 0),
        Number(s.expPerSec ?? 0),
        s.nextStageId == null ? null : String(s.nextStageId),
        now,
        now
      );
    }
  }
}

export function starterCatalogIds(): string[] {
  // Give the user 25 heroes by repeating the small demo set.
  const ids = FALLBACK_CATALOG.map((h) => h.id);
  const out: string[] = [];
  while (out.length < 25) out.push(ids[out.length % ids.length]!);
  return out;
}
