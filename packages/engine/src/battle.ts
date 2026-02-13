import { makeRng } from "./rng.js";
import type {
  BattleConfig,
  BattleResult,
  BuffState,
  Hero,
  HeroState,
  Side,
  Skill,
  Team,
  TeamState
} from "./types.js";

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function toState(team: Team): TeamState {
  return {
    heroes: team.heroes.slice(0, 25).map((h) => ({
      id: h.id,
      name: h.name,
      level: h.level,
      maxHp: Math.max(1, Math.floor(h.stats.hp)),
      hp: Math.max(1, Math.floor(h.stats.hp)),
      atk: Math.max(0, Math.floor(h.stats.atk)),
      def: Math.floor(h.stats.def),
      eva: clamp01(h.stats.eva),
      preempt: clamp01(h.stats.preempt),
      king: clamp01(h.stats.king),
      skills: h.skills ?? [],
      buffs: [],
      alive: true
    }))
  };
}

function teamAlive(t: TeamState): boolean {
  return t.heroes.some((h) => h.alive);
}

function frontAliveIndex(t: TeamState): number {
  for (let i = 0; i < t.heroes.length; i++) {
    if (t.heroes[i]!.alive) return i;
  }
  return -1;
}

function getEffectiveStat(hero: HeroState, stat: keyof Pick<HeroState, "atk" | "def" | "eva" | "preempt" | "king">): number {
  const base = hero[stat];
  let add = 0;
  for (const b of hero.buffs) {
    if (b.stat === stat) add += b.amount;
  }
  if (stat === "eva" || stat === "preempt" || stat === "king") return clamp01(base + add);
  return base + add;
}

function tickBuffs(team: TeamState) {
  for (const h of team.heroes) {
    if (!h.alive) continue;
    if (h.buffs.length === 0) continue;
    for (const b of h.buffs) b.remainingTurns -= 1;
    h.buffs = h.buffs.filter((b) => b.remainingTurns > 0);
  }
}

type SkillEntry = {
  hero: HeroState;
  skill: Skill;
};

function buildSkillTable(team: TeamState): SkillEntry[] {
  const out: SkillEntry[] = [];
  for (const h of team.heroes) {
    if (!h.alive) continue;
    for (const s of h.skills) {
      const chance = Number(s.chance);
      if (!Number.isFinite(chance) || chance <= 0) continue;
      out.push({ hero: h, skill: { ...s, chance: clamp01(chance) } });
    }
  }
  return out;
}

// "概率叠加 + 站位优先级"：
// - 将队伍里所有存活角色技能按队伍顺序扁平化，形成技能表
// - 概率直接相加；若总和 >= 1，则永远不会平A
// - 技能选择使用“加权抽取 + 表顺序为优先级”：越靠前的技能越早占据概率区间
function pickSkillOrNormal(r01: number, table: SkillEntry[]): { kind: "normal" } | { kind: "skill"; entry: SkillEntry } {
  let total = 0;
  for (const e of table) total += e.skill.chance;

  if (total <= 0) return { kind: "normal" };

  if (total < 1) {
    if (r01 >= total) return { kind: "normal" };
    // Map into [0, total) to pick a skill by its raw chance segments.
    r01 = r01;
  } else {
    // Ensure "no normal attack" once total >= 1
    // Scale the roll into [0, total)
    r01 = r01 * total;
  }

  let x = r01;
  for (const e of table) {
    if (x < e.skill.chance) return { kind: "skill", entry: e };
    x -= e.skill.chance;
  }

  // Numerical edge case.
  return { kind: "skill", entry: table[table.length - 1]! };
}

function computeDamage(attacker: HeroState, defender: HeroState, mult: number): number {
  const atk = getEffectiveStat(attacker, "atk");
  const king = getEffectiveStat(attacker, "king");
  const def = getEffectiveStat(defender, "def");

  const base = Math.floor(atk * (1 + king) * mult);
  const dmg = base - def; // def can be negative -> more damage
  return Math.max(1, dmg);
}

function applyDamage(target: HeroState, damage: number): { actual: number; down: boolean } {
  const d = Math.max(0, Math.floor(damage));
  target.hp = Math.max(0, target.hp - d);
  if (target.hp <= 0) {
    target.alive = false;
    return { actual: d, down: true };
  }
  return { actual: d, down: false };
}

function pickTarget(team: TeamState): HeroState | null {
  const idx = frontAliveIndex(team);
  if (idx < 0) return null;
  return team.heroes[idx]!;
}

export function simulateBattle(teamA: Team, teamB: Team, config: BattleConfig): BattleResult {
  const rng = makeRng(config.seed);
  const maxTurns = config.maxTurns ?? 200;

  const A = toState(teamA);
  const B = toState(teamB);

  // Decide first side based on front hero preempt (cheap + clear for MVP).
  const aFront = A.heroes[frontAliveIndex(A)] ?? null;
  const bFront = B.heroes[frontAliveIndex(B)] ?? null;
  const aPre = aFront ? getEffectiveStat(aFront, "preempt") : 0;
  const bPre = bFront ? getEffectiveStat(bFront, "preempt") : 0;
  let side: Side = aPre === bPre ? (rng.float01() < 0.5 ? "A" : "B") : aPre > bPre ? "A" : "B";

  const log: BattleResult["log"] = [];

  let turn = 0;
  while (teamAlive(A) && teamAlive(B) && turn < maxTurns) {
    turn += 1;
    log.push({ t: "turn_start", turn, side });

    const self = side === "A" ? A : B;
    const foe = side === "A" ? B : A;

    // Buffs tick down at the start of the acting side's turn.
    tickBuffs(self);

    const target = pickTarget(foe);
    if (!target) break;

    const skillTable = buildSkillTable(self);
    const pick = pickSkillOrNormal(rng.float01(), skillTable);

    // Default actor for normal attack: front alive hero.
    const actorIdx = frontAliveIndex(self);
    const actor = actorIdx >= 0 ? self.heroes[actorIdx]! : null;
    if (!actor) break;

    if (pick.kind === "normal") {
      const evaded = rng.float01() < getEffectiveStat(target, "eva");
      const damage = evaded ? 0 : computeDamage(actor, target, 1);
      const { down } = applyDamage(target, damage);

      log.push({
        t: "action",
        turn,
        side,
        actorHeroId: actor.id,
        actorName: actor.name,
        action: "normal",
        targetHeroId: target.id,
        targetName: target.name,
        evaded,
        damage: evaded ? 0 : damage,
        targetHpAfter: target.hp
      });

      if (down) log.push({ t: "hero_down", turn, side: side === "A" ? "B" : "A", heroId: target.id, heroName: target.name });
    } else {
      const { hero: skillOwner, skill } = pick.entry;
      if (skill.kind === "damage") {
        const mult = Math.max(0, Number(skill.power ?? 1));
        const evaded = rng.float01() < getEffectiveStat(target, "eva");
        const damage = evaded ? 0 : computeDamage(skillOwner, target, mult);
        const { down } = applyDamage(target, damage);

        log.push({
          t: "action",
          turn,
          side,
          actorHeroId: skillOwner.id,
          actorName: skillOwner.name,
          action: "skill",
          skillId: skill.id,
          skillName: skill.name,
          targetHeroId: target.id,
          targetName: target.name,
          evaded,
          damage: evaded ? 0 : damage,
          targetHpAfter: target.hp
        });

        if (down) log.push({ t: "hero_down", turn, side: side === "A" ? "B" : "A", heroId: target.id, heroName: target.name });
      } else if (skill.kind === "heal") {
        const healTargetIdx = frontAliveIndex(self);
        const healTarget = healTargetIdx >= 0 ? self.heroes[healTargetIdx]! : null;
        if (healTarget) {
          const amount = Math.max(0, Math.floor(Number(skill.power ?? 0)));
          healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + amount);
          log.push({
            t: "heal",
            turn,
            side,
            actorHeroId: skillOwner.id,
            actorName: skillOwner.name,
            skillId: skill.id,
            skillName: skill.name,
            targetHeroId: healTarget.id,
            targetName: healTarget.name,
            amount,
            targetHpAfter: healTarget.hp
          });
        }
      } else if (skill.kind === "buff") {
        const stat = skill.stat ?? "atk";
        const amount = Number(skill.amount ?? 0);
        const durationTurns = Math.max(1, Math.floor(Number(skill.durationTurns ?? 1)));
        const buff: BuffState = {
          id: `${skill.id}:${turn}`,
          name: skill.name,
          stat,
          amount,
          remainingTurns: durationTurns,
          sourceHeroId: skillOwner.id
        };
        // MVP: buff the front alive hero only (easy to reason about).
        const targetIdx = frontAliveIndex(self);
        const buffTarget = targetIdx >= 0 ? self.heroes[targetIdx]! : null;
        if (buffTarget) buffTarget.buffs.push(buff);

        log.push({
          t: "buff",
          turn,
          side,
          actorHeroId: skillOwner.id,
          actorName: skillOwner.name,
          skillId: skill.id,
          skillName: skill.name,
          stat,
          amount,
          durationTurns
        });
      }
    }

    side = side === "A" ? "B" : "A";
  }

  const winner: Side | "Draw" = teamAlive(A) && !teamAlive(B) ? "A" : !teamAlive(A) && teamAlive(B) ? "B" : "Draw";
  log.push({ t: "battle_end", winner, turns: turn });

  return { winner, turns: turn, log, final: { A, B } };
}

export function makeDemoTeam(side: Side): Team {
  const mkHero = (i: number): Hero => {
    const baseHp = 120 + i * 3;
    const baseAtk = 25 + i;
    return {
      id: `${side}-h${i}`,
      name: `${side}-Hero${i}`,
      level: 1,
      stats: {
        hp: baseHp,
        atk: baseAtk,
        def: i % 5 === 0 ? -2 : 2,
        eva: (i % 7) * 0.01,
        preempt: side === "A" ? 0.06 : 0.04,
        king: (i % 10) * 0.01
      },
      skills:
        i % 6 === 0
          ? [
              { id: `s${i}-slash`, name: "Slash+", kind: "damage", chance: 0.12, power: 1.6 },
              { id: `s${i}-rage`, name: "Rage", kind: "buff", chance: 0.06, stat: "atk", amount: 5, durationTurns: 2 }
            ]
          : i % 9 === 0
          ? [{ id: `s${i}-heal`, name: "First Aid", kind: "heal", chance: 0.08, power: 18 }]
          : [{ id: `s${i}-poke`, name: "Poke", kind: "damage", chance: 0.05, power: 1.2 }]
    };
  };

  return { heroes: Array.from({ length: 25 }, (_, i) => mkHero(i + 1)) };
}

