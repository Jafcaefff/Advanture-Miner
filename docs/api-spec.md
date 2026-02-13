# API 规格（服务端）

目标：服务端权威结算 + 存档 + 可回放。

## 约定

- Base URL：`/api`
- 认证：Bearer JWT（MVP）。所有涉及存档/战斗的接口要求登录。
- 所有战斗结算由服务端执行；客户端不上传“战斗结果”，只上传“意图”（例如使用哪个队伍、挑战谁）。

## MVP 接口

### 健康检查

- `GET /api/health`
- Response：`{ ok: true }`

### 注册

- `POST /api/auth/register`
- Body：`{ username: string, password: string }`
- Response：`{ token: string }`

### 登录

- `POST /api/auth/login`
- Body：`{ username: string, password: string }`
- Response：`{ token: string }`

### 获取存档概览

- `GET /api/me`
- Response（示例）：

```json
{
  "userId": "u_123",
  "rosterVersion": 7,
  "teams": [
    { "id": "t_main", "name": "Main", "heroIds": ["h1","h2"] }
  ]
}
```

### 保存队伍配置

- `PUT /api/teams/:teamId`
- Body：`{ name?: string, heroIds: string[] }`（长度 1..25）
- 校验：heroIds 必须属于当前用户；不可重复；顺序即站位。
- Response：`{ ok: true, team: ... }`

### 战斗模拟（服务端结算）

- `POST /api/battle/simulate`
- Body：

```json
{
  "teamId": "t_main",
  "enemy": {
    "kind": "npc",
    "npcId": "stage_1_boss"
  }
}
```

- 服务端行为：
  - 从 DB 读取玩家队伍（英雄属性/技能快照）
  - 从内容表读取敌方队伍快照
  - 生成 `seed`（并记录到 battle_log）
  - 调用 `@am/engine` 进行模拟
  - 返回结果（以及回放 id）

- Response（示例）：

```json
{
  "battleId": "b_456",
  "seed": 123456789,
  "winner": "A",
  "turns": 37,
  "log": [ { "t": "turn_start", "turn": 1, "side": "A" } ]
}
```

### 获取回放

- `GET /api/battles/:battleId`
- Response：包含 battle 输入快照与输出日志（或输出的压缩摘要 + 分页拉取）。

## 后续扩展

- PVP 异步：
  - `POST /api/pvp/enqueue`
  - `GET /api/pvp/matches/:id`
- 挂机收益：
  - `POST /api/adventure/claim`
- 挖矿：
  - `POST /api/mine/dig`
  - `POST /api/mine/golem/fight`

