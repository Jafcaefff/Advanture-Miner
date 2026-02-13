import type { Db } from "./db.js";

type CatalogHero = {
  id: string;
  name: string;
  baseStats: { hp: number; atk: number; def: number; eva: number; preempt: number; king: number };
  skills: any[];
  tags?: any[];
};

const CATALOG: CatalogHero[] = [
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

const NPC_TEAMS = [
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

export function seedContent(db: Db) {
  const now = new Date().toISOString();

  const countCatalog = db.prepare("SELECT COUNT(1) AS n FROM heroes_catalog").get() as any;
  if (Number(countCatalog?.n ?? 0) === 0) {
    const ins = db.prepare(
      "INSERT INTO heroes_catalog (id, name, base_stats_json, skills_json, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const h of CATALOG) {
      ins.run(h.id, h.name, JSON.stringify(h.baseStats), JSON.stringify(h.skills), JSON.stringify(h.tags ?? []), now, now);
    }
  }

  const countNpc = db.prepare("SELECT COUNT(1) AS n FROM npc_teams").get() as any;
  if (Number(countNpc?.n ?? 0) === 0) {
    const ins = db.prepare("INSERT INTO npc_teams (id, name, team_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const t of NPC_TEAMS) {
      ins.run(t.id, t.name, JSON.stringify(t.teamSnapshot), now, now);
    }
  }
}

export function starterCatalogIds(): string[] {
  // Give the user 25 heroes by repeating the small demo set.
  const ids = CATALOG.map((h) => h.id);
  const out: string[] = [];
  while (out.length < 25) out.push(ids[out.length % ids.length]!);
  return out;
}

