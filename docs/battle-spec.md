# 战斗规格（25 人概率叠加）

本文定义“25 人队伍 + 概率叠加技能 + 站位优先级”的可实现、可复现版本（MVP）。后续若要更贴近原作，可在不破坏“确定性/服务端权威”的前提下迭代。

## 术语

- 队伍：最多 25 名角色，存在 **固定顺序**（站位）。
- 前排：队伍顺序中第一个存活角色。
- 机会（attack opportunity）：每个回合（或每次行动）产生一次“要不要触发技能/平A”的抽取。
- seed：战斗随机种子；所有随机（先手、技能触发、闪避）都来自 seed RNG。

## 属性（MVP）

- `hp`：生命值
- `atk`：攻击
- `def`：防御（允许为负）
- `eva`：闪避概率（0..1）
- `preempt`：先攻值（0..1，决定先手）
- `king`：王者（0..1，影响伤害倍率）

## 目标选择（MVP）

- 攻击目标为对方 **前排存活角色**。

> 后续可扩展：随机目标、最低血、嘲讽、AOE 等。

## 回合与先手（MVP）

1. 根据双方前排的 `preempt` 决定先手：更高者先手；相同则用 RNG 抛硬币。
2. 轮到某方行动时，先对该方角色身上的 buff 进行回合扣减（`remainingTurns -= 1`，到 0 移除）。
3. 进行一次“技能/平A”抽取并结算。
4. 交换行动方。

## 技能数据结构（MVP）

每个技能：

- `chance`：触发概率（0..1），在一次“机会”内参与概率叠加
- `kind`：`damage | buff | heal`
- `power/stat/amount/durationTurns`：不同类型的参数

## 概率叠加与站位优先级（核心）

### 1) 构建技能表

在某方行动时，收集该方所有 **存活角色** 的技能，按“队伍顺序从前到后”扁平化成技能表：

```
[ (Hero1.Skill1, Hero1.Skill2, ...),
  (Hero2.Skill1, ...),
  ...
]
```

技能表顺序即 **优先级**（越靠前越优先）。

### 2) 概率直接相加

令总概率：

```
P = sum(skill.chance for all skills in table)
```

规则：

- 若 `P < 1`：以概率 `P` 触发某个技能；以概率 `1-P` 平A。
- 若 `P >= 1`：**永远不会平A**（只会触发技能）。

### 3) 技能选择（加权区间 + 顺序优先）

使用一个 `r`（均匀随机）来决定具体技能：

- 当 `P < 1` 且 `r >= P`：平A
- 其余情况：把 `r` 映射到区间并按技能表顺序“吃掉区间”：

伪代码：

```ts
if (P < 1 && r >= P) return normal;
let x = (P < 1) ? r : (r * P); // P>=1 时缩放，确保不出 normal
for (skill of table in order) {
  if (x < skill.chance) return skill;
  x -= skill.chance;
}
return lastSkill; // 数值边界
```

这个机制同时满足：

- “概率叠加”：全队技能概率直接相加
- “站位优先级”：技能表顺序决定谁更容易先被抽中（在相同 chance 下，靠前者占据更靠前的概率区间）

## 闪避（MVP）

若目标闪避成功，则本次伤害为 0（技能与平A都可被闪避，MVP 统一处理）。

```
evaded = rand() < target.eva
```

## 伤害公式（MVP）

对 `damage` 类动作（平A 或伤害技能）：

```
base = floor(atk * (1 + king) * mult)
damage = max(1, base - def)
```

说明：

- `mult`：平A 为 1；技能用 `power` 作为倍率（例如 1.6）
- `def` 允许为负：负防御会导致更高伤害

## Buff/Heal（MVP）

- `buff`：给己方前排存活角色添加一个 buff（对某个属性加成，持续 N 回合）
- `heal`：治疗己方前排存活角色，生命不超过 `maxHp`

> 后续可扩展：群体 buff、指定目标、驱散、叠层等。

## 可复现与回放

一次战斗的“可复现输入”至少包含：

- 双方队伍完整快照（角色属性、技能、站位顺序）
- `seed`
- `config`（如 `maxTurns`）

输出：

- `winner / turns`
- `log`：按时间序列记录每次行动（技能/平A、目标、是否闪避、伤害/治疗、阵亡）

## 现有实现位置

对应当前实现（M0）：

- 引擎：`packages/engine/src/battle.ts`
- 类型：`packages/engine/src/types.ts`
- RNG：`packages/engine/src/rng.ts`

