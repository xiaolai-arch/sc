# Study Coach

本地优先的**个人管家与学习工作台**。

它可以当老师、做规划、做记录、做督促。考研只是它服务的一个 workspace，英语、项目、生活同样适用。

- **老师**：讲解、答疑、练习、根据记录指出薄弱点
- **规划**：目标 → 周计划 → 今日任务
- **记录**：笔记、日志、复盘、可见的个人画像
- **督促**：提醒、打卡、连续反馈

所有数据本地优先：无账号、无服务器、无遥测；知识库是纯 markdown，Obsidian 可以直接打开。

## 现在能看什么

Web 原型已经是一个三栏工作台：

- **管家**：每日简报、管家对话、建议提问、连续复盘提醒
- **计划**：目标、今日任务、完成进度、跨 workspace 安排
- **记录**：Obsidian 风格笔记、标签、关联笔记
- **学习**：练习题、答题反馈、错题记录
- **复盘**：三个复盘问题、画像与记忆、督促提醒
- **设置**：模型、预算、通知、启动
- **工作区切换**：全部 / 考研 / 英语 / 项目 / 生活

考研是最完整的示例 workspace；英语、项目、生活用来验证“不只是考研”。

## Web 原型

```bash
npm install
npm run dev:web
```

打开终端里打印的地址（默认 `http://localhost:5173`）。Onboarding 点「先看看示例」可以直接进入工作台。

原型说明：

- 当前工作台数据是 demo 数据，存在浏览器内存/localStorage；真实 vault、agent 工具和调度仍在接入。
- API Key 只保存在当前页面内存，刷新即消失，不会写入浏览器存储或发送到服务器。
- 原型不发起网络请求；界面和类型定义与后续 Electron 版共用。

## 开发

```bash
npm test          # Vitest
npm run typecheck # TypeScript strict
npm run build:web # 浏览器原型静态构建（out/web）
npm run build     # Electron 构建
```

## 设计文档

- 新方向：`docs/superpowers/specs/2026-10-31-personal-butler-workspace.md`
- 原 M1 考研后端计划：`docs/superpowers/plans/2026-10-31-study-coach-m1-foundation.md`
- Web 原型实施计划：`docs/superpowers/plans/2026-10-31-study-coach-web-prototype.md`

## 状态

M1 的共享类型、日期工具、markdown 解析已完成；Web 工作台已经是可点击的六面原型。真实 vault、模型调用、agent 工具调用、提醒调度和 Electron IPC 仍在继续。

## License

MIT
