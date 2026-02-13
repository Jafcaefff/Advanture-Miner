# Advanture-Miner (Web Prototype)

这是一个“冒险与挖矿”同类玩法的网页原型项目（服务端 + 前端 + 共享战斗引擎），当前重点是先把 **25 人概率叠加战斗** 做成可复现、可服务端裁决的最小闭环。

## 目录

- `docs/`：开发文档与规格
- `packages/engine/`：共享战斗引擎（TypeScript，可被前端/后端复用）
- `apps/api/`：服务端（占位，后续实现）
- `apps/web/`：网页前端（占位，后续实现）

## 开发

环境：Node.js v22+（本机目前是 v22.18.0）

安装依赖：

```bash
npm install
```

构建引擎：

```bash
npm run build -w @am/engine
```

类型检查：

```bash
npm run typecheck -w @am/engine
```

更多规格见 `docs/overview.md`。

