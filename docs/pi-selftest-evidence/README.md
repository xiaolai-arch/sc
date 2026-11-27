# 验收 11（P2 打包自测）证据归档 — F6 补档（2026-11-28）

> 背景（item 61 P4 批，sc-lead F6 裁定）：P2 批的打包实跑证据 JSON 与手测记录
> 从未入库（git 全历史无）。本目录随 P4 批补档：证据 JSON（本目录
> `pi-selftest-result-2026-11-28.json`）+ 本手测记录。

## 补档时实跑记录（逐字）

- 日期：2026-11-28（P4 批内补档，非 P2 当时回溯）
- 分支：`xiaolai/agent-runtime-p4`（P4 批工作区）
- 运行形态：**Electron 主进程实跑**（`process.versions.electron = 45.2.1`、内置
  Node `24.22.1`，自测 JSON 的 `packagedElectron: true` 即由
  `Boolean(process.versions.electron)` 判定），执行的是 electron-vite 构建产物
  `out/main/index.js`（`npm run build` 后 `npx electron .`）。**不是**
  electron-builder/NSIS 安装产物——打包器只是把同一份 `out/` 与 node_modules
  装进壳，执行路径相同；如实标注，不冒充安装产物实跑。
- 进入方式：env 钩子（`src/main/index.ts`）`ASAKI_RUNTIME_PI_SELFTEST=1`，
  输出 `ASAKI_RUNTIME_PI_SELFTEST_OUT` 指向本目录 JSON，然后进程按成败退出
  （exit code 0）。
- 结果：三步全 PASS（load / stream+tool / cancel），逐字见
  `pi-selftest-result-2026-11-28.json`；控制台输出：
  - `[pi-selftest] ok=true node=24.22.1 electron=45.2.1`
  - `[pi-selftest] load: PASS — engine-pi 动态加载器在打包主进程加载 Pi 包成功（Agent=function）`
  - `[pi-selftest] stream+tool: PASS — 终态=completed；流式 delta 与 plan_preview 提交齐备`
  - `[pi-selftest] cancel: PASS — 终态=cancelled；取消后无工具提交=true`

## 补档前发现的通道缺陷（如实记录，不粉饰）

P2 批交付的自测通道**按当时提交的代码在打包产物里无法启动**：
`engine-pi/pi-fake-model.ts` 对 ESM-only 的 `@earendil-works/pi-ai` 做了**值导入**
（`import { createAssistantMessageEventStream }`）。electron-vite 的
externalizeDepsPlugin 把它降级为 CJS `require`，Electron 主进程装载 pi-selftest
chunk 时即抛 `No "exports" main defined`。这意味着 P2 当时若真跑过该通道，用的
不是入库时的代码形态；入库证据缺失与此缺陷互为印证（P4 批 F6 实跑复现了该错）。

P4 批的修复（最小、与 pi-engine.ts 同法）：pi-fake-model.ts 改为唯一动态
`import()` + 模块级缓存（`loadStreamFactory`），类型引用保持 `import type`。
修复后本目录的实跑证据为**真实产出**，非转抄。

## 手测清单（验收 11 三步口径，spec :114）

1. **一次流式响应**：stream+tool 步的 `text.delta("我来为今天生成计划。")` 与
   `text.delta("预览完成（自测不再提交）。")`（缝③ done-only 补发路径）。
2. **一次工具调用**：`tool.committed(plan_preview)`（查询级网关直执行）。
3. **一次取消**：cancel 步终态 `cancelled`、取消后无工具提交。
4. 临时 vault 写在 os 临时目录，不碰用户数据；进程按成败退出码收口。

## 遗留

- 自测 env 钩子（`src/main/index.ts`）按原注应在 P3 正式装配时移除；P4 批按
  F6 需求保留（本证据即经它产出），移除与否留 sc-review 在证据归档后裁定。
- NSIS 安装产物级实跑（electron-builder 产物内点击进入）仍未做过；如 sc-review
  认为验收 11 的「打包后的 Windows Electron」必须指安装产物，需补一次安装产物
  实跑并把 JSON 追加进本目录。
