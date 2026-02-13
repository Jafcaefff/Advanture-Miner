# 错误码清单（MVP）

目的：让前端/后端对齐可稳定依赖的错误码（不依赖 message 文案）。

## 认证与权限

- `UNAUTHORIZED`：缺少/无效 Token
- `FORBIDDEN`：已登录但无权限访问资源

## 参数校验

- `VALIDATION_ERROR`：通用参数错误

## 账号

- `USERNAME_TAKEN`
- `INVALID_CREDENTIALS`

## 资源不存在

- `NOT_FOUND`
- `TEAM_NOT_FOUND`
- `BATTLE_NOT_FOUND`
- `NPC_NOT_FOUND`

## 冲突

- `CONFLICT`
- `HERO_DUPLICATED`
- `HERO_NOT_OWNED`
- `TEAM_VERSION_CONFLICT`：乐观锁冲突（可选）

## 服务端

- `INTERNAL_ERROR`

