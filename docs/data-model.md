# 数据模型（草案）

当前阶段目标是：账号 + 英雄收集 + 队伍配置 + 战斗回放可审计。下面是偏“可落库”的最小集合；具体字段可按实现选择 SQLite/Postgres 做微调。

## 表：users

- `id` (PK)
- `username` (unique)
- `password_hash`
- `created_at`

## 表：heroes_catalog（内容表）

用于定义“英雄模板”（类似图鉴），由策划/内容驱动。

- `id` (PK) 例：`hero_slime_001`
- `name`
- `base_stats_json`（hp/atk/def/eva/preempt/king）
- `skills_json`（技能数组）
- `tags_json`（阵营/稀有度/合体组等，后续用）

## 表：user_heroes（玩家拥有的英雄实例）

如果你希望英雄有等级/觉醒/宝具等成长，建议“实例表”与“内容表”分离。

- `id` (PK) 例：`uh_123`
- `user_id` (FK users.id)
- `catalog_id` (FK heroes_catalog.id)
- `level`
- `awakens`
- `stats_override_json`（可选：宝具/觉醒/羁绊叠加后的最终数值缓存）
- `created_at`

> MVP 也可以简化为：玩家只保存 `catalog_id` 列表，等级先不做实例化。

## 表：teams

- `id` (PK) 例：`t_main`
- `user_id` (FK)
- `name`
- `hero_ids_json`：有序数组，长度 1..25（站位顺序）
- `updated_at`

## 表：battle_logs

用于回放与审计（强烈建议存“输入快照 + seed + 引擎版本”）。

- `id` (PK) 例：`b_456`
- `user_id` (FK)（发起者）
- `kind`：`npc|pvp`
- `seed` (int)
- `engine_version`（例如 git commit hash 或 semver）
- `input_snapshot_json`：
  - `teamA`（英雄属性/技能/顺序的完整快照）
  - `teamB`（同上）
  - `config`（maxTurns 等）
- `result_summary_json`：winner/turns/最终血量摘要等
- `log_json`（MVP 可直接存完整 log；后续可压缩/分段）
- `created_at`

## 后续：推图/挂机/挖矿（占位）

当扩展到核心玩法循环后，通常会新增：

- `adventure_state`：当前关卡、挂机开始时间、离线收益倍率等
- `inventory`：金币/钻石/材料
- `mine_state`：矿区地图、深度、镐子耐久、工坊工程队列
- `pvp_state`：分数/段位、匹配池、对手快照

