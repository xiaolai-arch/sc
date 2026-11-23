# ASAKI iter31：备份从「按钮」变成「状态」——本地信任与迁移（2026-11-23）

**依据：** `docs/superpowers/reports/2026-11-22-backup-migration-trust-research.md`（第四轮，分支 `xiaolai/iter31-research` 提交 `23a365b`，已随本 spec 落在 `xiaolai/iter31-spec` `0afbf6a`）§1–§5；第三轮报告 `2026-11-22-work-process-trust-audiences-research.md` §3、§4
**基线：** `master` @ `3142baf`（派活时最新 master 为 `723b063`；其后 iter39 与 busy-day 两条修复已合入，本 spec 以合并后的 `3142baf` 为基线，全部 file:line 已按它复核）
**状态：** 已定稿待评审。主人 2026-11-22 定「自动备份跟周复盘、默认关」「备份卡只显示上次备份时间」；sc-lead 2026-11-23 定「默认关 + 首次手动备份成功后问一次」「间隔 7 天」「留 12 份」「失败文案三层」。唯一遗留取舍见文末「待主人决定」。

---

## 一句话

四家竞品里做得最好的组合是「Obsidian 的明文目录 + Joplin 插件的失败告知 + Logseq 的默认自动备份」。ASAKI 已经有了最难的部分（明文目录、安全恢复、随包清单），缺的是把备份从「一个按钮」变成「一个状态」：**上次什么时候备的、下次什么时候备、备失败了有没有人告诉我**。Joplin 论坛 45236 那个用户（内置备份插件在机器上躺着、从没跑过、更新后四年的笔记全没）就是这条缺口的完整画像。

## 为什么（实测证据，不是推测）

### 对手怎么做的（报告 §1.1）

| | 自动备份 | 默认 | 失败告知 | 恢复语义 |
| --- | --- | --- | --- | --- |
| Obsidian | 无（官方推荐系统级 + 两个社区插件） | — | 无（快照静默） | 人工放回文件夹 |
| Notesnook | 日/周/月三档 | 关（加密默认开） | 只在登出前问一次 | 就地覆盖，新内容保留 |
| Logseq（DB） | 每小时，留 12 份 | **开** | 文档未提 | 导入式，目标已存在即拒绝 |
| Joplin | 插件捆绑，**必须配路径才跑** | 未配置=不跑 | 插件弹窗 + 日志 | 导入式，ID 重发、出 "(1)" 副本 |

**四家里没有一家做「失败后主动推送」**（报告 §1.4）。反面教材是 Joplin 45236：插件在机器上不等于备份在跑，用户以为「我信任它会有备份」，出事后才知道从未触发。结论：**自动备份必须有「成功状态可见 + 失败主动说」两条，缺一条就退化成 45236。**

### ASAKI 现状（报告 §2.2，行号已按 `3142baf` 复核）

| # | 落差 | 证据 |
| --- | --- | --- |
| G1 | 无自动备份，只能手动点按钮；30 秒 tick 只服务主动检查 | `SettingsPage.tsx:575-598`（仅手动入口）；`src/main/scheduler/app-scheduler.ts:49,65` |
| G2 | 无「上次备份」状态：`backupStatus` 是一次性操作结果，重启即丢；README.txt 只躺在备份文件夹里 | `SettingsPage.tsx:179, 1405-1418`；`src/main/backup.ts:140-156` |
| G3 | 失败只有一行行内提示，设置页没开着就没人知道 | `SettingsPage.tsx:593` |
| G4 | 换机恢复不还原设置：备份里有 `state.json`（含 vaultPath/provider/notifications），`restoreBackup` 设计上不恢复它 | `backup.ts:293-297`（doc comment）；`src/main/state-store.ts:10-13` |
| G5 | 三处文案互相矛盾（见下文「文案口径统一」表） | `SettingsPage.tsx:1378` vs `backup.ts:152-153` vs `SettingsPage.tsx:607` |
| G6 | 无保留策略：每次导出新建时间戳文件夹，永不清理 | `backup.ts:97`（只建不清） |
| G7 | 备份内无完整性信息，README 只有「已包含/已跳过」布尔 | `backup.ts:140-156` |
| G8 | 恢复需重启生效 | `SettingsPage.tsx:622` |

已做对、不输竞品的九项（`backup.ts:92` 异目录检查、`:97-110` 时间戳顺延、`:116` symlink 解引用、`:140-156` 随包 README、`:328` restore-safety 快照、`:316` 恢复校验、`:250` swapDirectory 回滚、密钥永不进备份、恢复确认框 `SettingsPage.tsx:607`）**本轮一次都不动**。

### 第三块受众（报告 §3，强度中）

「Windows 上的非技术自学者」：标准答案（git / Syncthing / Duplicati / Time Machine）一个都用不了。证据跨三产品六条（Joplin 45236、r/ObsidianMD 1oxxzp4 183 分、1npds0b 父亲帖、1q40rho RTFM 错位、1o1xy3c「上次备份是几个月前」、r/logseq 1ndo4pc）。**对设计的意义**：纯 opt-in 会恰好错过这批人（他们不会去设置页找开关），静默默认开又会背着用户在磁盘上持续写数据。折中是「默认关 + 首次手动备份成功后问一次」（sc-lead 2026-11-23 已定）。

## 目标（本轮）

- **P0 备份状态可见**：`AppSettings.backup` 持久化最后一次备份的时间、路径与结果；设置卡常驻一行状态；周复盘（opt-in 开关）末尾追加一行年龄事实。
- **P1 每周自动备份**：设置开关（默认关），间隔 7 天，复用 `createBackup`，挂在周复盘链路上后台跑；首次手动备份成功后问一次是否开启；失败按三层原则说一次。本轮**不做删除**（轮换在 P4）。
- **P2 内容与迁移说清楚**：README 补「N 个文件，约 X MB」；导出成功提示列实际包含项；备份卡三行换机步骤；统一三处互相矛盾的「包含/恢复」口径。
- **P3 换机恢复设置（G4，独立小项，可单独先修）**：仅当本机 `state.json` 不存在时，才采用备份内的 `state.json`（新机首次恢复），且把其中的 `vaultPath` 改写为本机当前路径；本机已有则不覆盖。sc-lead 2026-11-23：G4 不依赖本 spec 其余部分，可单独排期先修。
- **P4 自动备份保留 12 份（轮换）**：只在自动备份自己的目标目录里、只删 `study-coach-backup-*` 命名的目录、只在新备份成功后删多余的，保留最近 12 份（对齐 Logseq；Joplin 默认留 1 是反例）。手动导出目录不轮换。

G8（恢复需重启）不在本轮范围，见非目标；它同样不依赖本 spec，可单独排期先修。

## 非目标（本轮）

调研的拒收清单（报告 §2.3），四条共同点是都会破坏「备份是普通文件夹，资源管理器直接能读」这个 vault 明文直读前提：

- **不做加密备份**（Notesnook 模式）：一旦加密，「备份是普通文件夹」消失，还引入密码遗忘=备份作废的死锁（Notesnook 实录：密码=账号密码，忘密码则备份不可用）。备份的安全边界=不含 secrets，已满足。
- **不做单文件专有容器**（JEX tar / .nnbackupz zip）：用户打不开、单条恢复变 8 步绕行（Joplin README 实录）。现在的目录+README.txt 是四家对照里最好的形态。
- **不做云上传 / 同步式「备份」**：Obsidian 官方整节「Syncing is not a backup」；本地优先是产品前提。
- **不做导入式恢复**（重发 ID、不查重）：Joplin 的 "(1)" 副本与 ID 变化是反面教材；保持目录交换 + restore-safety 快照。

其余不做：

- **G8 恢复需重启不改**：Electron 内存态决定，确认框已写清（`SettingsPage.tsx:607,622`），改造成本远大于收益；如要修，单独排期，不在本轮。
- 不做备份校验和 / 恢复演练功能：真实需求存在（r/Notesnook 1wvwsuy）但频率极低；README 文件计数已给用户自查锚点。
- 不做「只提醒不落盘」的备份（Notesnook web 模式）：我们是桌面端，有能力落盘；只提醒=把责任推回用户。
- 不改 `createBackup` 的复制白名单，不改密钥边界（`state.json` 本就不含 secret，API Key 在 safeStorage，从未进备份）。
- 不改 `restoreBackup` 的目录交换、restore-safety 快照与回滚逻辑（`backup.ts:293-390`）——P3 只改「是否采用备份内 `state.json`」这一个决定点。
- 不删除、不覆盖用户自己选的目标目录里任何**不匹配** `study-coach-backup-*` 命名的内容；手动导出目录不轮换（P4 只轮换被设为自动备份目标的那个文件夹）。
- 不引入账号/云、不新增依赖、不联网。

反功能（沿用第三轮格式）：

- ❌ 不做进度条/假备份动画：备份是秒级目录拷贝，如实显示「正在导出…」。
- ❌ 不把「从未备份过」做成红色警告或 badge：是事实行不是愧疚行；失败通知也只陈述「没有成功+怎么办」。
- ❌ 不显示备份份数（主人 2026-11-22 已定）：设置卡只有「上次备份」事实行。

## 数据与契约

### 设置字段（命名采用报告 §4.1，不另起一套）

```ts
export interface BackupSettings {
  /** 周复盘末尾追加「上次备份 N 天前」；缺省 false（P0）。 */
  ageLineEnabled?: boolean;
  /** 缺省 false，只有 true 序列化（P1）。 */
  autoEnabled?: boolean;
  /** 首次询问已经出现过（无论用户选了哪边）；只有 true 序列化（P1）。 */
  autoBackupAsked?: boolean;
  /** 1 | 7 | 30，缺省 7（P1）。 */
  autoIntervalDays?: 1 | 7 | 30;
  /** 备份目标目录（绝对路径）。自动备份必须有它，否则不跑（P1）。 */
  autoDestination?: string;
  /** 最后一次成功备份的本地时间，格式 YYYY-MM-DDTHH:mm:ss（naive local ISO，不带时区）；手动与自动共用（P0）。 */
  lastBackupAt?: string;
  /** 最后一次成功备份的文件夹绝对路径（P0）。 */
  lastBackupPath?: string;
  /** 最后一次结果。'failed' 只用于显示，不会阻止下次尝试（P0）。 */
  lastBackupOutcome?: 'ok' | 'failed';
  /** 最近一次失败的人话原因；读过一次即清（P1）。 */
  lastBackupError?: string;
}
```

- 报告 §4.1 给了五个键（`autoEnabled/autoIntervalDays/lastBackupAt/lastBackupPath/lastBackupOutcome`），本稿补三个：`autoDestination`——「以后每周自动备份到**同一个文件夹**吗」这个问句必须有目标目录可存，首次询问确认时写入本次导出的父目录，之后可在设置里改；`lastBackupError`——「失败只说一次」需要它记住还没说过的那句话；`autoBackupAsked`——「已询问且用户拒绝」这个事实必须有键承载（评审阻断 1）：`autoEnabled` 缺省不序列化，无法表达「问过且暂不」，没有这个键，builder 只能要么每次重启重复弹询问、要么被迫序列化 `autoEnabled=false` 破坏逐字节基线。
- `lastBackupAt` 一律存 naive local ISO（`YYYY-MM-DDTHH:mm:ss`），到期判定取它的本地日期直接配套；禁止混用 UTC 或带 offset 的写法（评审建议）。
- 分批边界：**先做 P0/P2 时只落地 P0 那四个键**（`ageLineEnabled/lastBackupAt/lastBackupPath/lastBackupOutcome`）；`autoEnabled/autoBackupAsked/autoIntervalDays/autoDestination/lastBackupError` 等 P1 实现时再加，避免半套字段。
- 挂在 `AppSettings`（`src/shared/types.ts:98`），沿 `strictMastery`（`:112`）与 `accountabilityName`（`:120`）的先例：**缺省不序列化**，旧 settings 写回逐字节不变。
- `normalizeBackup` 对齐 `normalizeSettings`（`src/main/settings/settings-service.ts:65-77`）：非法间隔回落 7、非法日期丢弃、非布尔丢弃、非绝对路径丢弃。
- `updateSettings` 校验：`autoEnabled` 必须是布尔；`autoIntervalDays` 必须是 1/7/30；`autoDestination` 必须是绝对路径；不合规给中文错误，不半写。

### 到期判定（不加后台定时器，P1）

- 只跟随**周复盘**链路（`ProactiveCheckInService.check`，`src/main/check-ins/proactive-check-in-service.ts:168`；weekly 数据读取在 `:213-215`）。主人 2026-11-22 已定：自动备份跟周复盘走，不新增独立调度点。
- `overdue = lastBackupAt 的本地日期 + autoIntervalDays <= 今天`；无 `lastBackupAt` 时视为到期。
- 不新增 marker 文件、不加 tick 定时器：`autoEnabled` + `autoDestination` + 到期判定全部落在 settings 里。
- `weeklyEnabled=false` 时自动备份不运行，设置页给一句事实说明这条依赖。
- 自动备份在后台执行，周复盘消息**不等它**（见验收 8）。

### 失败怎么说（三层，报告 §4.4，sc-lead 2026-11-23 已定文案）

1. **没成功**：`自动备份没有成功（<人话原因>）。`
2. **数据没动**：`你的数据没有被动过；`
3. **怎么办**：`可以稍后重试，或在「设置 → 数据与备份」手动导出。`

- errno 映射成人话（目录不可写 / 磁盘满 / 被其他程序占用），**不透出堆栈、不说「备份损坏」「数据可能丢失」**——45236 开帖人的语气（"devastating … I trusted Joplin"）就是被吓出来的。
- 只说一次：失败后 `lastBackupOutcome='failed'` + `lastBackupError` 落盘；下一次周复盘把整句说出来之后清空 `lastBackupError`（`outcome` 保留，供设置卡显示状态）。**不重试、不连续报**。
- 通道默认走「下一条周复盘 + 设置卡状态行」，不新增通知类型；是否加 OS 通知见文末「待主人决定」。

### 保留 12 份（轮换契约，P4）

- 触发时机：一次**自动备份成功后**，且仅对 `autoDestination` 目录。
- 只删同时满足三条的目录：名字匹配 `study-coach-backup-*`、位于 `autoDestination` 内、排在最新 12 份之外（按备份时间戳排序，含目录名后缀顺延的）。
- 三条硬约束：**刚创建的这份直接从删除集合排除、不参与排名**（时钟回拨时新份的 stamp 字典序可能最小，纯按排名排它排第一也保不住，必须显式排除）；删失败不使备份失败（清理是尽力而为，删不掉下次再试）；`autoDestination` 之外的任何目录（包括手动导出的）永不清理。
- 手动导出不触发轮换，即使它写进了 `autoDestination`——轮换只发生在自动备份完成之后。

## 界面

### 设置 → 数据与备份（`SettingsPage.tsx:1373` 起）

- 现有两个按钮不动；按钮下方新增常驻状态行（报告 §4.2 原句）：
  - `上次备份：今天 14:32` / `上次备份：6 天前` / `从未备份过。`
  - 失败态（手动或自动，`lastBackupOutcome='failed'`）：第一行 `上次备份没有成功（<人话原因>）。`；有上次成功时第二行 `上次成功：N 天前。`，没有则只有第一行。
  - 不显示目标目录里已有几份备份（主人 2026-11-22 已定），不用红色、不用 badge。
- 开关 `每周自动备份`，描述：`把项目、记录和对话复制到你选的文件夹。备份是普通文件夹，不含 API Key，用文件管理器就能直接打开。`
- 目录行：当前 `autoDestination`，未选时 `未选择目录，自动备份不会运行` + 「选择目录…」。
- `weeklyEnabled=false` 时开关下方追加一句：`周复盘关闭时不会自动备份。`
- 「换机」三行固定展示，不折叠：
  1. `在新电脑安装 ASAKI。`
  2. `把整个备份文件夹复制过去，在「数据与备份 → 从备份恢复…」选择它。`
  3. 分两版，以 P3 是否合入为准（评审阻断 3：P2 单独交付时不得承诺还不存在的行为）：
     - **P2 版（P3 未合入前）**：`恢复会带回项目、记录、对话和用量；恢复不改动设置，换机后设置和 API Key 需要重新填写（API Key 从未进入备份）。`
     - **P3 版（P3 合入后替换）**：`恢复会带回项目、记录、对话和用量；新机器上没有设置时，备份里的设置会一起还原，API Key 需要重新填写（它从未进入备份）。`

### 首次成功导出后的一次询问（P1）

- 首次手动导出成功、`backup.autoBackupAsked` 未设置过时，显示一次性询问：`以后每周自动备份到同一个文件夹吗？可以随时在设置里改。`［每周备份］［暂不］。
- 选「每周备份」→ `autoEnabled=true`、`autoDestination` = 本次导出父目录；选「暂不」→ `autoEnabled` 保持缺省、不序列化。**两边都写 `autoBackupAsked=true`**，跨重启不再问（**不静默开启**——默认关是主人已定的原则，询问不能把它绕过去；报告 §3-1 建议预选「开」，不采纳）。
- 询问不出现在自动备份流程里，只在手动导出成功后。

### 周复盘消息（P0 年龄行 / P1 失败行）

- opt-in 开关（`backup.ageLineEnabled`，默认关；这是本节唯一新增的开关）打开后，在周复盘消息的诚实回执之后、可用时间问题之前追加一行：
  - 无记录：`还没有导出过备份。`
  - N ≥ 1：`上次导出备份是 N 天前（M 月 D 日）。`
  - N = 0：不追加。
- 有待说的失败（`lastBackupError` 非空）时，同一位置追加三层失败文案一次，随后清空 `lastBackupError`；两行同时在时，年龄行在前、失败行在后。
- 确定性文案，不交给模型；模型文本已含「上次备份」则不重复追加（沿用 `promiseLine` 做法，`proactive-check-in-service.ts:382-389`）。

### 文案口径统一（G5，P2）

三处必须一致，且都写成「备份里有副本 / 恢复动什么」两层：

| 位置 | 新文案 |
| --- | --- |
| 设置卡说明（`SettingsPage.tsx:1378`） | `备份包含项目、记录、对话、设置和用量的副本。恢复会覆盖项目、记录和对话；当前设置与 API Key 保持不变。` |
| README.txt 恢复提示（`backup.ts:152-153`） | `也可以手动将 vault/ 放回原 vault 路径；state.json 和 usage.json 可放回应用数据目录。`（保留原文，与设置卡不再矛盾——它说的是手动放回，不是自动恢复） |
| 恢复确认框（`SettingsPage.tsx:607`） | 保留现有句子，补一句 `新机器上没有设置时，备份里的设置会一起还原。`（P3 落地后） |

另：README.txt 追加一行完整性事实（G7）：`本次备份包含 <N> 个文件，约 <X> MB。`——N/X 与本次实际复制一致，不做校验和。

## 验收标准（可测）

**P0 状态可见**

1. 新装/旧 settings 文件：`backup` 块不出现，写回后与 `3142baf` 逐字节相同；设置卡显示 `从未备份过。`。
2. 手动导出成功：`backup.lastBackupAt`（ISO 本地时间）、`lastBackupPath`、`lastBackupOutcome='ok'` 落盘；设置卡立刻显示 `上次备份：今天 HH:mm`；重启应用后仍显示。
3. 导出失败：`lastBackupOutcome='failed'` 且不写 `lastBackupAt`；设置卡状态行显示失败态 `上次备份没有成功（<人话原因>）。`（有上次成功时附第二行 `上次成功：N 天前。`），不把失败当成「从没备份」，不出「损坏」「可能丢失」字样。
4. 周复盘年龄行开关打开、`lastBackupAt` 为 3 天前：消息里出现 `上次导出备份是 3 天前（M 月 D 日）。`，位置在诚实回执之后、可用时间问题之前，只一行。
5. 开关打开但 `lastBackupAt` 是今天：不追加任何备份年龄行。
6. 开关关闭 / `notifications.weeklyEnabled=false`：周复盘与 `3142baf` 逐字节相同。

**P1 自动备份**

7. `autoEnabled=true`、`autoDestination` 有效、距上次 ≥ 7 天：周复盘那条 `check('weekly')` 触发一次 `createBackup`，目标目录出现 `study-coach-backup-*`；`lastBackupOutcome='ok'`，`lastBackupAt` 更新。到期公式边界（注入 `now` 即可测，不需要也不存在每日触发点，评审阻断 2）：`autoIntervalDays=1` 且 `lastBackupAt` 为昨天 → 到期；`autoIntervalDays=30` 且为 29 天前 → 未到期、30 天前 → 到期。
8. **不阻塞消息**：自动备份执行期间周复盘消息照常返回（用可控延迟的替身证明先后，不用真实大文件）。
9. 距上次成功 < 7 天：不启动第二次。
10. 自动备份失败（目标在 vault 内 / 无权限 / 磁盘满）：不向渲染层抛异常；`lastBackupOutcome='failed'`、`lastBackupError` 是人话（无堆栈、无「数据可能丢失」）；**下一条**周复盘末尾出现三层文案且只有一次；再下一条不再出现，`lastBackupError` 已清空；设置卡状态行显示失败态与上一次成功时间。
11. `autoEnabled=true` 但无 `autoDestination`：不尝试导出、不报错；设置页显示 `未选择目录，自动备份不会运行`。
12. `weeklyEnabled=false`：自动备份不运行，设置页给出依赖说明。
13. 首次手动导出成功后出现一次性询问；选「暂不」后写 `autoBackupAsked=true`、`autoEnabled` 保持缺省（不序列化），**重启后仍不再出现**；选「每周备份」后同样写 `autoBackupAsked=true`，且 `autoEnabled=true`、`autoDestination` 等于本次导出父目录。询问只在手动导出后出现，自动备份流程里永不出现。
14. **P1 不做任何删除**：连续多次自动备份在目标目录累积，P1 实现不删除任何已有备份。

**P2 内容与迁移**

15. README.txt 追加一行 `本次备份包含 <N> 个文件，约 <X> MB。`，N/X 与本次实际复制一致；现有断言（`tests/main/backup.test.ts:81-89` 的 `toContain`）仍通过。
16. 导出成功提示第一行仍是 `已导出到 <path>`；第二行按 `BackupResult.copied` 实际布尔生成，缺项自动省略。
17. 备份卡只出现三行换机步骤；第三行版本与交付对齐（评审阻断 3）：只做 P0–P2 时必须是 P2 版（**不得**出现「设置会一起还原」这类 P3 才有的承诺）；P3 合入后切换为 P3 版。两版都**不得**出现「设置不在备份里」这类与 `state.json` 事实相反的话。
18. 设置卡说明、README 恢复提示、恢复确认框三处对新读者不矛盾：同一问题（备份里有没有设置）在三处答案一致。

**P3 换机恢复设置（G4，独立小项）**

19. 目标机器**没有** `state.json`：恢复后采用备份内 `state.json` 的设置（provider、notifications 等），且 `vaultPath` 改写为本机当前 vault 路径（不能指向旧机器的路径）。
20. 目标机器**已有** `state.json`：恢复不动它，与 `3142baf` 行为逐字节一致。
21. P3 与 P0–P2 可以分开交付：只做 P0–P2 时，验收 1–18 全过（换机第三行用 P2 版）、19–20 不适用。

**P4 保留 12 份**

22. `autoDestination` 里已有 14 份 `study-coach-backup-*`，自动备份成功后：目录里恰好剩 12 份，最老的两份被删，刚创建的这份在 12 份之内。
23. 只删匹配 `study-coach-backup-*` 的目录：同目录下的用户自建文件夹、手动导出后改名的目录一个都不动；`autoDestination` 之外的任何目录不清理。
24. 轮换失败（某目录被占用删不掉）：本次备份仍算成功，`lastBackupOutcome='ok'`；下次自动备份成功后再试。
25. 手动导出永不触发轮换，即使导出目标就是 `autoDestination`。
26. 时钟回拨反证：新份目录名的 stamp 字典序最小（如系统时间回拨）时，自动备份成功后新份仍在，删除只发生在其余目录中最老的部分——「本次创建的 target 不参与排名」这条由测试直接锁住。

## 测试点

| 层 | 文件 | 要证明的行为 |
| --- | --- | --- |
| main | `tests/main/settings-service.test.ts`（扩展；对齐 `fills behind-schedule defaults for settings written before the feature`（:183）） | `backup` 默认不序列化、旧文件往返不变、非法间隔/非绝对路径/非布尔被拒、`lastBackupError` 读后即清 |
| main | `tests/main/backup.test.ts`（扩展；现有 `copies the vault…without secrets`（:53）、`skips missing sources…`（:94）、README 断言（:81-89）保持通过） | README 文件数与体积行、`copied` 布尔仍准确 |
| main | `tests/main/backup-state.test.ts`（新；或并入 `settings-service.test.ts`，以 builder 判断为准） | `lastBackupAt/Path/Outcome/Error` 的写入时机（成功 vs 失败）、坏日期视为无记录 |
| main | `tests/main/backup.test.ts`（P4） | 轮换五条验收：留 12、只删匹配命名、删失败不失败、手动导出不触发、回拨时新份（字典序最小）仍保留 |
| main | `tests/main/check-in-prompt.test.ts`（扩展；现有「no stats leaves the weekly prompt byte-identical」必须仍通过） | 无记录/N 天/0 天/关闭 四种周复盘字节；年龄行与失败行的位置与唯一性 |
| main | `tests/main/proactive-check-in.test.ts`（扩展，**P1**） | 7 天到期才跑、不阻塞消息、失败三层文案只出现一次并清空、`weeklyEnabled=false` 不跑 |
| main | `tests/main/ipc-preload.test.ts`（扩展） | `chooseBackupDirectory` 新通道在尾部、参数透传 |
| main | `tests/main/backup.test.ts`（P3） | 无 `state.json` 时采用备份内设置并改写 `vaultPath`；有则不动 |
| renderer | `tests/renderer/settings-backup.test.tsx`（扩展；现有 `exports a backup and shows the destination`（:43）随第二行提示更新断言） | 状态行三态与换机三行（**P0/P2 可先行**）；开关、目录未选提示、依赖说明、首次询问（**P1**） |
| e2e | `e2e/feature-smoke.spec.ts`（扩展，可选） | 手动导出 → 状态行变「今天」→ 询问出现；注入 3 天前的 `lastBackupAt` 后周复盘出现「3 天前」 |

## 依赖与冲突

- **与 iter30 无文件重叠（已合入）**：iter30 已在 `723b063` 合入 master；本 spec 以 `3142baf` 为基线，行号全部按它复核过。
- **与 item 45（同源清理台账）并行**（sc-lead 2026-11-23）：item 45 的四处 `isIsoDate` 收编、`prompt.ts` 本地副本、tasks 读取端修复可与本 spec 的 **P0/P2/P3** 并行排队。P1（自动备份）同改 `check-ins/prompt.ts` 与 `proactive-check-in-service.ts`，与 item 45 的 prompt.ts 清理撞文件——两者不并行，先合先得，后来者 rebase。P4 只动 `backup.ts` 轮换，与谁都不撞。
- **本机内存约束**（sc-lead 排期提醒）：长期只剩 0.5–1.2GB，不要同时开两条实现线；实现顺序建议 P0 → P2 → P3（独立小项）→ P1 → P4，一条一条来。
- G4（P3）与 G8 都不依赖本 spec 其余部分，可单独排期先修（sc-lead 2026-11-23）；G8 修法（恢复后免重启生效）属于 Electron 内存态改造，体量不小，单独立项评估。
- `state.json` 里存设置这个既有事实（`state-store.ts:10-13`）是 P3 的前提；P3 只改 `restoreBackup` 的「是否采用」，不改存储位置。

## 主要文件（预计）

```
src/shared/types.ts                      + BackupSettings、AppSettings.backup        （P0 起）
src/shared/ipc.ts                        + chooseBackupDirectory?()、BackupState 读取 （P1 的选目录通道）
src/main/settings/defaults.ts            + backup 缺省值（不写进 settings 文件）      （P0 起）
src/main/settings/settings-service.ts    + normalizeBackup / updateSettings 校验      （P0 起）
src/main/backup.ts                       + 成功后写 backup 字段（P0）、README 计数行（P2）、
                                           P3 的 state.json 采用规则、P4 的轮换
src/main/check-ins/prompt.ts             + 周复盘年龄行（诚实回执之后）                （P0）
src/main/check-ins/proactive-check-in-service.ts  + 到期判定、后台执行、失败三层文案（P1）
src/main/index.ts                        + chooseBackupDirectory 选择器通道          （P1）
src/main/ipc.ts                          + 新通道与校验                               （P1）
src/renderer/settings/SettingsPage.tsx   + 状态行（P0）、换机三行与统一口径（P2）、开关/目录行/首次询问（P1）
tests/…                                  + 见测试点
```

## 给 builder 的默认决定

- 字段命名一律用报告 §4.1 的五个键 + `autoDestination` + `ageLineEnabled` + `lastBackupError` + `autoBackupAsked`，不另起第二套。
- 到期判定只用 `lastBackupAt + autoIntervalDays`（P1），不写 marker 文件、不加 tick 定时器；自动备份挂在周复盘链路上，不新增独立调度点（主人 2026-11-22 已定）。
- 自动备份在后台跑、消息不等它；失败只说一次、不重试。
- 失败文案严格三层（没成功 / 数据没动 / 怎么办），errno 映射人话，不透出堆栈，不用「损坏」「可能丢失」；默认通道是下一条周复盘 + 设置卡状态行。
- 轮换（P4）三条硬约束优先于「留 12 份」目标本身：刚建的永远保留、删失败不算失败、只动 `autoDestination` 里匹配命名的目录。
- 首次询问只出现一次，且只在**手动**导出成功后；不静默开启，不预选「开」（sc-lead 2026-11-23：默认关）。
- 状态行永远显示事实，不显示份数，不用红色警告或 badge（主人 2026-11-22 已定）。
- 文案口径以本文「文案口径统一」表为准，三处必须一致；换机第三行禁止写「设置不在备份里」。
- 已做对的九项（异目录检查、时间戳顺延、symlink 解引用、随包 README、restore-safety 快照、恢复校验、回滚、密钥边界、恢复确认框）一次都不动。
- 不新增依赖、不联网；所有新文案中文事实句。
- 实现顺序建议：P0 → P2 → P3 → P1 → P4；先做 P0/P2 时 `BackupSettings` 只落地 P0 四个键，避免半套字段。

## 风险

- **settings 往返**：`normalizeSettings` 会对整个对象补齐，容易让旧文件写回时多出 `backup` 键；验收 1 专盯这条。
- **周复盘逐字节断言**：多处精确字符串；新增行只在开关打开且 N≥1 或无记录时出现，并显式断言「关闭/0 天时等于基线」。
- **自动备份在测试里真写盘**：必须注入 `now` 与临时 `destinationRoot`，限制复制体量；禁止用真实 vault。
- **大 vault 耗时**：后台执行是默认决定；若实现成阻塞，周复盘可能延后数分钟——验收 8 用延迟替身锁住。
- **P3 的 `vaultPath` 改写**：备份里 `state.json` 的 `vaultPath` 是旧机器的，直接采用会让应用指向不存在的路径；必须先改写成当前路径再落盘，否则新机器启动即坏。
- **P4 是本轮唯一会删数据的路径**：删除条件（命名 + 位置 + 排名）三条件缺一不删；测试用目录名含空格/中文名/非匹配前缀的邻居目录锁住「不误删」。
- **与 item 45 撞 `check-ins/prompt.ts`**：P1 与 item 45 的 prompt.ts 清理不并行，先合先得。

## 待主人决定

**失败时除了「下一条周复盘 + 设置卡状态行」，要不要再弹一条 OS 通知？**

- 报告建议（§1.4、§4.2）：OS 通知 + 状态行双通道——「沉默等于没做」，自动备份失败时设置页多半没开着。
- 第三轮报告原则（§4）：不新增通知渠道。
- 本稿默认：不加（下一条周复盘说一次 + 状态行常驻，两层已覆盖「可见 + 主动说」）；若主人选「加」，复用现有调度器通知 sink（`tray.ts:222` 的 Electron Notification），遵守免打扰设置，只多一条验收，不动其余结构。

## 已定（不再重开）

1. 自动备份跟周复盘走，默认关；`weeklyEnabled=false` 时不运行（主人 2026-11-22）。
2. 备份卡只显示上次备份时间，不显示份数（主人 2026-11-22）。
3. 默认关 + 首次手动备份成功后问一次是否开启；间隔 7 天；自动备份目录保留最近 12 份；失败文案三层（sc-lead 2026-11-23）。
4. G4 拆独立小项可先修，G8 只记录（sc-lead 2026-11-23）。
