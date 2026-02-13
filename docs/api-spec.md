# API 规格（服务端，开工版）

目标：服务端权威结算 + 存档 + 可回放。客户端只负责“请求与展示”，不参与任何权威计算。

## 版本化与路径

- 所有接口前缀：`/api/v1`
- Content-Type：`application/json; charset=utf-8`

## 鉴权

- 方式：`Authorization: Bearer <token>`
- Token：JWT（MVP），后续可替换为 session/refresh token 方案

## 通用响应与错误

### 成功响应

- 统一为 JSON 对象

### 错误响应（统一结构）

HTTP 状态码为 4xx/5xx 时返回：

```json
{
  "error": {
    "code": "TEAM_NOT_FOUND",
    "message": "Team not found",
    "requestId": "req_abc123"
  }
}
```

字段说明：

- `code`：稳定的机器可读错误码
- `message`：面向开发者的简短描述
- `requestId`：服务端生成，便于排查日志

### 约定状态码

- `200`：成功
- `201`：创建成功
- `400`：参数错误（格式、范围、必填缺失）
- `401`：未登录/Token 无效
- `403`：已登录但无权限
- `404`：资源不存在
- `409`：冲突（用户名重复、版本冲突等）
- `429`：限流（预留）
- `500`：服务端错误

### 通用错误码（MVP）

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `INTERNAL_ERROR`

## ID 规范（建议）

- `userId`：`u_<base62>`
- `teamId`：`t_<base62>`（或固定 `t_main`）
- `battleId`：`b_<base62>`

## 资源模型（DTO 草案）

### HeroSnapshot（战斗快照）

用于“服务端裁决时的输入快照”，必须完整且可复现。

```json
{
  "id": "uh_123",
  "catalogId": "hero_slime_001",
  "name": "Slime",
  "level": 1,
  "stats": { "hp": 120, "atk": 25, "def": 2, "eva": 0.02, "preempt": 0.05, "king": 0.01 },
  "skills": [
    { "id": "s_slash", "name": "Slash+", "kind": "damage", "chance": 0.12, "power": 1.6 }
  ]
}
```

### TeamSnapshot（战斗快照）

```json
{
  "heroes": [ /* length 1..25, ordered */ ]
}
```

## 接口列表（MVP）

### 健康检查

- `GET /api/v1/health`
- Response 200：`{ "ok": true }`

### 注册

- `POST /api/v1/auth/register`
- Body：

```json
{ "username": "foo", "password": "bar" }
```

- Response 201：

```json
{ "token": "<jwt>" }
```

- Errors：
  - 400 `VALIDATION_ERROR`
  - 409 `USERNAME_TAKEN`

### 登录

- `POST /api/v1/auth/login`
- Body：

```json
{ "username": "foo", "password": "bar" }
```

- Response 200：

```json
{ "token": "<jwt>" }
```

- Errors：
  - 400 `VALIDATION_ERROR`
  - 401 `INVALID_CREDENTIALS`

### 获取我的存档概览

- `GET /api/v1/me`
- Auth：Required
- Response 200（示例）：

```json
{
  "userId": "u_123",
  "rosterVersion": 1,
  "teams": [
    { "id": "t_main", "name": "Main", "heroIds": ["uh_1","uh_2"] }
  ]
}
```

### 获取我的英雄列表

- `GET /api/v1/heroes`
- Auth：Required
- Query：
  - `limit`（默认 50，最大 200）
  - `cursor`（可选，分页游标）
- Response 200：

```json
{
  "items": [ { "id": "uh_1", "catalogId": "hero_slime_001", "level": 1 } ],
  "nextCursor": null
}
```

### 创建/更新队伍

- `PUT /api/v1/teams/:teamId`
- Auth：Required
- Body：

```json
{ "name": "Main", "heroIds": ["uh_1","uh_2"] }
```

约束：

- `heroIds.length`：1..25
- 不可重复
- 所有 heroId 必须属于当前用户
- 顺序即站位（front first）

Response 200：

```json
{
  "team": { "id": "t_main", "name": "Main", "heroIds": ["uh_1","uh_2"], "updatedAt": "2026-02-13T00:00:00Z" }
}
```

Errors：

- 400 `VALIDATION_ERROR`
- 404 `TEAM_NOT_FOUND`（如果你不允许创建新 teamId）
- 409 `HERO_NOT_OWNED` 或 `HERO_DUPLICATED`

### 战斗模拟（服务端裁决）

- `POST /api/v1/battles/simulate`
- Auth：Required
- Body（NPC 战示例）：

```json
{
  "teamId": "t_main",
  "enemy": { "kind": "npc", "npcId": "stage_1_boss" },
  "options": { "maxTurns": 200 }
}
```

服务端行为（必须）：

- 读取玩家队伍与英雄实例，组装 `TeamSnapshot`（A）
- 从内容表读取敌方 `TeamSnapshot`（B）
- 生成 `seed`，并记录 `engineVersion`
- 调用 `@am/engine` 计算 `BattleResult`
- 保存 `battle_logs`：输入快照 + seed + 输出摘要（MVP 可存全量 log）

Response 201（示例）：

```json
{
  "battleId": "b_456",
  "seed": 123456789,
  "engineVersion": "git:abcdef0",
  "winner": "A",
  "turns": 37,
  "log": [ { "t": "turn_start", "turn": 1, "side": "A" } ]
}
```

Errors：

- 400 `VALIDATION_ERROR`
- 404 `TEAM_NOT_FOUND`
- 404 `NPC_NOT_FOUND`

### 获取回放

- `GET /api/v1/battles/:battleId`
- Auth：Required
- Response 200：

```json
{
  "battleId": "b_456",
  "createdAt": "2026-02-13T00:00:00Z",
  "seed": 123456789,
  "engineVersion": "git:abcdef0",
  "input": { "teamA": { "heroes": [] }, "teamB": { "heroes": [] }, "config": { "maxTurns": 200 } },
  "result": { "winner": "A", "turns": 37 },
  "log": [ { "t": "turn_start", "turn": 1, "side": "A" } ]
}
```

权限规则（MVP）：

- 只允许 battle 发起者读取（后续 PVP/分享链接再扩展）

## 速率限制与幂等（预留）

- `POST /battles/simulate` 建议支持 `Idempotency-Key`（避免网络重试重复落库）
- 对 `simulate` 做限流（429），避免被刷

