import test from "node:test";
import assert from "node:assert/strict";

import { makeRng, simulateBattle } from "../dist/index.js";

function mkTeamWithTwoHighChanceSkills() {
  return {
    heroes: [
      {
        id: "A-h1",
        name: "A1",
        level: 1,
        stats: { hp: 100, atk: 10, def: 0, eva: 0, preempt: 0.9, king: 0 },
        skills: [{ id: "s1", name: "S1", kind: "damage", chance: 0.9, power: 1 }]
      },
      {
        id: "A-h2",
        name: "A2",
        level: 1,
        stats: { hp: 100, atk: 10, def: 0, eva: 0, preempt: 0.9, king: 0 },
        skills: [{ id: "s2", name: "S2", kind: "damage", chance: 0.9, power: 1 }]
      }
    ]
  };
}

function mkWeakEnemy() {
  return {
    heroes: [
      {
        id: "B-h1",
        name: "B1",
        level: 1,
        stats: { hp: 1000, atk: 1, def: 0, eva: 0, preempt: 0.1, king: 0 },
        skills: []
      }
    ]
  };
}

test("determinism: same seed yields identical log", () => {
  const teamA = mkTeamWithTwoHighChanceSkills();
  const teamB = mkWeakEnemy();

  const r1 = simulateBattle(teamA, teamB, { seed: 123, maxTurns: 5 });
  const r2 = simulateBattle(teamA, teamB, { seed: 123, maxTurns: 5 });

  assert.equal(r1.winner, r2.winner);
  assert.equal(r1.turns, r2.turns);
  assert.equal(JSON.stringify(r1.log), JSON.stringify(r2.log));
});

test("no normal attacks when total skill chance >= 1", () => {
  const teamA = mkTeamWithTwoHighChanceSkills(); // total = 1.8
  const teamB = mkWeakEnemy();

  const r = simulateBattle(teamA, teamB, { seed: 42, maxTurns: 20 });
  const actions = r.log.filter((e) => e.t === "action" && e.side === "A");
  assert.ok(actions.length > 0);
  assert.ok(actions.every((a) => a.action === "skill"));
});

test("priority truncation when total >= 1: later skills only trigger if roll is in leftover interval", () => {
  // With S1=0.9, S2=0.9 (total 1.8):
  // - S1 triggers when r in [0, 0.9)
  // - S2 triggers when r in [0.9, 1.0)
  const findSeed = (predicate) => {
    for (let seed = 1; seed < 500000; seed++) {
      const r = makeRng(seed).float01();
      if (predicate(r)) return seed;
    }
    throw new Error("seed not found");
  };

  const seedS1 = findSeed((r) => r < 0.9);
  const seedS2 = findSeed((r) => r >= 0.9);

  const teamA = mkTeamWithTwoHighChanceSkills();
  const teamB = mkWeakEnemy();

  const r1 = simulateBattle(teamA, teamB, { seed: seedS1, maxTurns: 1 });
  const firstAction1 = r1.log.find((e) => e.t === "action");
  assert.ok(firstAction1);
  assert.equal(firstAction1.actorHeroId, "A-h1");
  assert.equal(firstAction1.skillId, "s1");

  const r2 = simulateBattle(teamA, teamB, { seed: seedS2, maxTurns: 1 });
  const firstAction2 = r2.log.find((e) => e.t === "action");
  assert.ok(firstAction2);
  assert.equal(firstAction2.actorHeroId, "A-h2");
  assert.equal(firstAction2.skillId, "s2");
});
