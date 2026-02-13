export type Side = "A" | "B";

export type SkillKind = "damage" | "buff" | "heal";

export type Skill = {
  id: string;
  name: string;
  kind: SkillKind;
  // Probability per team attack opportunity. Use 0..1 (e.g. 0.15 for 15%).
  chance: number;
  // For damage/heal.
  power?: number;
  // For buff.
  stat?: "atk" | "def" | "eva" | "preempt" | "king";
  amount?: number;
  durationTurns?: number;
};

export type Stats = {
  hp: number;
  atk: number;
  def: number; // can be negative
  eva: number; // 0..1
  preempt: number; // 0..1
  king: number; // 0..1
};

export type Hero = {
  id: string;
  name: string;
  level: number;
  stats: Stats;
  skills: Skill[];
};

export type Team = {
  heroes: Hero[]; // length <= 25, order defines priority (front first)
};

export type BattleConfig = {
  seed: number;
  maxTurns?: number;
};

export type BattleResult = {
  winner: Side | "Draw";
  turns: number;
  log: BattleLogEvent[];
  final: {
    A: TeamState;
    B: TeamState;
  };
};

export type TeamState = {
  heroes: HeroState[];
};

export type HeroState = {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  eva: number;
  preempt: number;
  king: number;
  skills: Skill[];
  buffs: BuffState[];
  alive: boolean;
};

export type BuffState = {
  id: string;
  name: string;
  stat: NonNullable<Skill["stat"]>;
  amount: number;
  remainingTurns: number;
  sourceHeroId: string;
};

export type BattleLogEvent =
  | {
      t: "turn_start";
      turn: number;
      side: Side;
    }
  | {
      t: "action";
      turn: number;
      side: Side;
      actorHeroId: string;
      actorName: string;
      action: "normal" | "skill";
      skillId?: string;
      skillName?: string;
      targetHeroId: string;
      targetName: string;
      evaded: boolean;
      damage: number;
      targetHpAfter: number;
    }
  | {
      t: "buff";
      turn: number;
      side: Side;
      actorHeroId: string;
      actorName: string;
      skillId: string;
      skillName: string;
      stat: NonNullable<Skill["stat"]>;
      amount: number;
      durationTurns: number;
    }
  | {
      t: "heal";
      turn: number;
      side: Side;
      actorHeroId: string;
      actorName: string;
      skillId: string;
      skillName: string;
      targetHeroId: string;
      targetName: string;
      amount: number;
      targetHpAfter: number;
    }
  | {
      t: "hero_down";
      turn: number;
      side: Side;
      heroId: string;
      heroName: string;
    }
  | {
      t: "battle_end";
      winner: Side | "Draw";
      turns: number;
    };

