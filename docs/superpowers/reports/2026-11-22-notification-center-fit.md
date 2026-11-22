# 通知中心与对话列宽度：e2e 失败定位与修复（2026-11-22）

**分支：** `xiaolai/iter29a-notification-center-fit`（基于 master `23080a3`，未推送）
**失败用例：** `e2e/viewport-layout.spec.ts` › `the notification center opens over the chat without squeezing it`，1366×768 与 1440×900 两个视口都在 `:235` 断言失败。
**结论：** **测试问题，不是产品缺陷。** 面板本身没有挤占对话列；失败是因为 `before` 探针在 Windows 把 `setContentSize` 的帧取整修正延迟落地之前测了旧视口，两次探针之间的**视口本身差了 1px**。

---

## 1. 实测数字（修复前，1366×768 用例）

在失败用例里临时打印了 `probeLayout` 的原始结果（已移除）：

```text
before viewport  { width: 1367, height: 769 }
after  viewport  { width: 1366, height: 768 }

before scroll    documentScrollWidth 1367 / clientWidth 1367
after  scroll    documentScrollWidth 1366 / clientWidth 1366

before columns   侧栏 width 279.9999694824219 | 内容列 width 1087.22216796875
after  columns   侧栏 width 279.9999694824219 | 内容列 width 1086.111083984375
```

- 侧栏宽度完全没变（279.999… 两边相同）。
- 内容列只少了 **1.111 px**，而视口正好少了 **1 px**（1367→1366），其余是子像素取整。
- `closeTo(after, before, 1)`：差值 1.111 > 1 → 失败。

也就是说：**打开面板后内容列并没有被“挤”**，它只是跟着视口一起按比例缩了 1px；断言把“视口移动”误判成了“布局被挤压”。

## 2. 根因

`setContentPaneSize`（`e2e/viewport-layout.spec.ts:64-111`）先 `win.setContentSize(目标)`，再读取实际内容尺寸并补调一次：

```ts
win.setContentSize(size.width, size.height);          // 落地为 +1：1367×769
const [actualWidth, actualHeight] = win.getContentSize();
win.setContentSize(size.width - (actualWidth - size.width), ...); // 补调为 1365×767
```

Windows 的帧取整让第一次调用落到 1367×769；补调请求 1365×767，期望内容区回到 1366×768。补调**异步**生效：现有轮询只要求 `window.innerWidth` 与目标差 ≤ 1px，于是在 1367 时就提前通过。随后补调在下一轮窗口消息里落地，视口变成 1366×768。

失败用例的时序恰好是：`before` 在 1367 时测量 → 点击铃铛 → 补调落地 → `after` 在 1366 时测量。两次测量跨了一个仍在变化的视口。

## 3. 为什么不是产品缺陷（DOM 实测）

同时打印了 DOM 结构（已移除）：

```text
row children:  ASIDE.fixed inset-y-0 left-0 z-40 flex w-[260px] max-w-[…
               DIV.flex min-h-0 min-w-0 flex-1

panel chain:   DIV.flex max-h-[70vh] w-full max-w-sm …   ← 面板
               DIV.fixed inset-0 z-50 flex items-end …  ← 遮罩
               DIV.flex h-screen flex-col …             ← 应用根节点
               DIV → BODY → HTML
```

- 面板的挂载点是应用根节点下、外壳行（`aside.parentElement`）的**兄弟**，不是外壳行的子元素，也不是内容列的子元素——所以 `rowColumns.length === 2`、`contentPaneCount === 1` 都通过。
- 遮罩与面板都是 `position: fixed; inset: 0`，不参与流内布局；侧栏是 `position: fixed`，内容列仍是行内唯一的流内子元素。
- 打开面板只新增一次根节点下的 fixed 子树，浏览器布局宽度不可能因此重算。

产品侧不需要改。

## 4. 修的是测试

`e2e/viewport-layout.spec.ts` 两处改动：

1. **`setContentPaneSize` 末尾等待视口稳定**（新增，`:97-111`）：先保留原有“≤1px 即通过”的轮询（某些系统确实只能到 ±1），再最多等 5 秒，逐 100ms 检查，直到 `window.innerWidth/innerHeight` **恰好**等于目标；能到精确值就立即返回，到不了则沿用 ±1 的既有容差继续。这样后续的 before/after 测量共享同一个视口，不再和 Windows 的延迟补调赛跑。
2. **断言前置条件**（`before`/`after` 探针之间新增，`:248-250`）：

   ```ts
   expect(after.viewport, 'the viewport is the same before and after the panel opens')
     .toEqual(before.viewport);
   ```

   如果窗口又被移动，失败信息会直接指向“视口变了”（测试环境问题），而不是含糊地报“对话列宽度变了”。

修复后同一用例的实测（1366×768）：

```text
before viewport  { width: 1366, height: 768 }
after  viewport  { width: 1366, height: 768 }
before columns   侧栏 279.9999694824219 | 内容列 1086.111083984375
after  columns   侧栏 279.9999694824219 | 内容列 1086.111083984375
```

内容列前后完全一致。验收语义没有放松：仍然要求面板打开前后外壳只有两列、内容列只有一个 pane、对话列宽度差 ≤ 1px；新增的视口相等断言只是把“在同一个窗口尺寸下比较”这个隐含前提写成了显式检查。

## 5. 四条门禁（本分支实测）

```text
> npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）
```

```text
> npx vitest run --maxWorkers=4
 Test Files  195 passed (195)
      Tests  1910 passed | 2 skipped (1912)
  Duration  65.03s
```

```text
> npm run build
out/renderer/assets/react-dom-BOxPwYkh.js  530.47 kB
✓ built in 248ms
（退出码 0）
```

```text
> npm run test:e2e
  ok 14 e2e\viewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1366x768 (1.4s)
  ok 15 e2e\viewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1440x900 (1.4s)

  15 passed (32.4s)
```

## 6. 改动文件

- `e2e/viewport-layout.spec.ts` — 视口稳定等待 + before/after 视口相等断言；无产品代码改动。
- `docs/superpowers/reports/2026-11-22-notification-center-fit.md` — 本报告。

未触碰：`src/shared/workspace.ts` 的 goalId 部分、`create-workspace-service.ts`、`records/tasks.ts`、`ProjectSections.tsx` 的目标标签；`package.json` / `package-lock.json` / `CHANGELOG.md`。