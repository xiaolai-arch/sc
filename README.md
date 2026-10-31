# Study Coach

本地优先的 AI 学习教练，为考研这样的长期目标安排每天的任务，你只负责执行。

- **本地优先**：无账号、无服务器、无遥测；知识库是纯 markdown，Obsidian 可以直接打开。
- **Agent 负责计划**：根据考试日期、科目、每天可用时间生成每日计划，晚上复盘后调整下一步。
- **桌面应用**：Electron + React + TypeScript；当前先提供浏览器 UI 原型，之后再接 Electron 主进程。

## Web 原型

当前分支包含一个可点击的浏览器 UI 原型，覆盖 Onboarding、今日计划、晚间复盘和设置。

```bash
npm install
npm run dev:web
```

打开终端里打印的地址（默认 `http://localhost:5173`）。在 Onboarding 点“先看看示例”可以跳过填写，直接查看今日页。

原型说明：

- 数据保存在浏览器 `localStorage`，只用于演示，不写入真实 vault。
- API Key 只保存在当前页面内存，刷新即消失，不会写入浏览器存储或发送到服务器。
- 原型不发起任何网络请求；界面和类型定义与后续 Electron 版共用。

## 开发

```bash
npm test          # Vitest
npm run typecheck # TypeScript strict
npm run build:web # 浏览器原型静态构建（out/web）
npm run build     # Electron 构建
```

设计规范见：

- `docs/superpowers/specs/2026-10-31-study-coach-design.md`
- `docs/superpowers/plans/2026-10-31-study-coach-web-prototype.md`

## 状态

M1 的基础部分（共享类型、日期工具、markdown 解析）已完成；Web 原型覆盖 M1 的主要界面。真实 vault、模型调用、调度器、托盘和 Electron IPC 仍按 M1 计划继续接入。

## License

MIT
