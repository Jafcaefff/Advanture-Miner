# 数据模型（开工版，MVP）

目标：账号 + 英雄内容/实例 + 25 人队伍配置 + 战斗回放可审计。

本文以“可用 SQLite 先跑、可平滑迁移 Postgres”为前提，字段类型以伪 SQL 表达。

## 设计约定

- 时间：ISO8601 字符串（应用层）或 DB `timestamp`（存储层）
- JSON：SQLite 用 `TEXT` 存 JSON；Postgres 用 `jsonb`
- 引擎版本：建议记录 `git:<shortsha>` 或 `semver`

## users

用途：账号体系（MVP 用户名密码）。

字段：

- `id` TEXT PK（例：`u_xxx`）
- `username` TEXT NOT NULL UNIQUE
- `password_hash` TEXT NOT NULL
- `created_at` TEXT NOT NULL

索引：

- unique(`username`)

## heroes_catalog

用途：内容表（图鉴/模板），由内容文件导入 DB 或直接读取文件（MVP 两种都行）。

字段：

- `id` TEXT PK（例：`hero_slime_001`）
- `name` TEXT NOT NULL
- `base_stats_json` TEXT NOT NULL
- `skills_json` TEXT NOT NULL
- `tags_json` TEXT NOT NULL DEFAULT `[]`
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束（应用层校验即可）：

- `base_stats_json` 必须包含 `hp/atk/def/eva/preempt/king`
- `skills_json[].chance` 必须在 0..1

## user_heroes

用途：玩家拥有的英雄实例。即便 MVP 不做升级，也建议保留该表，后续成长系统更顺滑。

字段：

- `id` TEXT PK（例：`uh_xxx`）
- `user_id` TEXT NOT NULL FK(users.id)
- `catalog_id` TEXT NOT NULL FK(heroes_catalog.id)
- `level` INTEGER NOT NULL DEFAULT 1
- `awakens` INTEGER NOT NULL DEFAULT 0
- `stats_override_json` TEXT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

索引：

- index(`user_id`)
- index(`catalog_id`)
- unique(`user_id`, `id`)（可选）

说明：

- `stats_override_json` 用于缓存“最终战斗数值”（宝具/觉醒/羁绊叠加后）。MVP 可为空，由服务端实时合成。

## teams

用途：保存 25 人队伍配置（有序）。

字段：

- `id` TEXT PK（例：`t_main` 或 `t_xxx`）
- `user_id` TEXT NOT NULL FK(users.id)
- `name` TEXT NOT NULL
- `hero_ids_json` TEXT NOT NULL（有序数组，长度 1..25，元素为 `user_heroes.id`）
- `version` INTEGER NOT NULL DEFAULT 1（乐观锁/防并发覆盖）
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

索引：

- unique(`user_id`, `id`)
- index(`user_id`)

约束（应用层）：

- `hero_ids_json` 不可重复
- 所有 heroId 必须属于 `user_id`

## npc_teams（可选但推荐）

用途：服务端裁决时读取敌方队伍快照；MVP 可以先写死在文件里，这张表是“可落库的方向”。

字段：

- `id` TEXT PK（例：`stage_1_boss`）
- `name` TEXT NOT NULL
- `team_snapshot_json` TEXT NOT NULL（即 `TeamSnapshot`）
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

## battle_logs

用途：回放与审计。强烈建议存“输入快照 + seed + 引擎版本”。日志可先全量存，后续再优化为分段/压缩。

字段：

- `id` TEXT PK（例：`b_xxx`）
- `user_id` TEXT NOT NULL FK(users.id)
- `kind` TEXT NOT NULL（`npc`/`pvp`）
- `seed` INTEGER NOT NULL
- `engine_version` TEXT NOT NULL
- `input_snapshot_json` TEXT NOT NULL
- `result_summary_json` TEXT NOT NULL
- `log_json` TEXT NOT NULL
- `created_at` TEXT NOT NULL

索引：

- index(`user_id`, `created_at`)
- index(`kind`, `created_at`)

输入快照结构（建议）：

```json
{
  "teamA": { "heroes": [ /* HeroSnapshot */ ] },
  "teamB": { "heroes": [ /* HeroSnapshot */ ] },
  "config": { "maxTurns": 200 }
}
```

结果摘要结构（建议）：

```json
{ "winner": "A", "turns": 37 }
```

## 迁移策略（建议）

- MVP 用 SQLite：`data/app.db`
- 使用迁移工具（例如自写简单迁移表 `schema_migrations`，或 later 上 prisma/kysely）
- 任何会影响回放一致性的字段变更，都要同步 `engine_version` 记录与回放读取逻辑

