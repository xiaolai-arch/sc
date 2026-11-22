# 备份与迁移信任调研（iter31 第四轮）

**日期：** 2026-11-22　**作者：** sc-research　**基线：** master `298234c`
**范围：** 题目一（四款笔记应用的备份做法与用户抱怨）、题目二（ASAKI 现有能力落差，只读）、题目三（前几轮未覆盖的受众）。只加本文档，不碰 `package.json` / lock / CHANGELOG / `src`。

## 0. 取数方式与可达性（诚实声明）

- **Obsidian 官方文档**：`help.obsidian.md` / `obsidian.md` 在本机被 WebFetch 域名校验拦截，改从官方文档仓库 `obsidianmd/obsidian-help`（GitHub）读同一份 markdown 源文，内容与 help 站一致；引文给仓库路径 + help 站 URL。
- **Notesnook 官方文档**：读 `streetwriters/notesnook` 仓库内 docs 源文件（`docs/help/contents/backup-and-restore-notes-in-notesnook.md`），与 notesnook.com/help 同源。
- **Logseq 官方文档**：读 `logseq/docs` 仓库 `db-version.md`（2026-04-28 版 DB graph 文档）。
- **Joplin**：官方 FAQ/Note history 站页可直读；Backup 插件读 `JackGruber/joplin-plugin-backup` 源码（`src/settings.ts`、`src/Backup.ts`、README）核对默认值；论坛用 discourse JSON API 读原帖（`discourse.joplinapp.org/t/<id>.json`）。
- **Reddit**：`reddit.com` 直连被拦（同前几轮），走 `arctic-shift.photon-reddit.com` 归档 API 读帖子与评论树，下述每条引用都复核过作者/分数/permalink；URL 为 reddit.com 规范地址。
- **知乎**：仅有搜索摘要可读（正文未逐篇核验），中文语境证据标注强度为「中」，只用于佐证、不作为单独依据。
- 每条引语保留原文，不给 URL 的不引用。

## 1. 题目一：四款应用实际怎么做备份

### 1.1 对照表

| | Obsidian | Notesnook | Logseq（DB 版） | Joplin |
|---|---|---|---|---|
| **内置自动备份** | 无。官方明确推荐用系统级备份（Time Machine 等）+ 两个社区插件（Obsidian Git / Local Backup，官方「承认但不背书」） | 有。手动 Create backup（`.nnbackupz`）+ 可选每日/每周/每月自动备份（桌面/移动端） | 有。桌面端**默认开**：每小时备份到 graph 目录内 `backups/`，保留最近 12 份；浏览器端需先选文件夹后开始 | 核心 app 无自动备份。Backup 插件自 2.14.6 起内置捆绑，但**必须先配置备份路径**才跑；默认每 24h、保留 1 份 |
| **默认开/关** | File Recovery 核心插件（快照）默认开（旧版文档明说，见 1.2）；「备份」本身默认无 | 自动备份默认关，需手动选频率；**备份加密默认开** | 桌面自动备份默认开；浏览器端选文件夹后开 | 插件捆绑但未配置=不跑（默认路径为空）；装好且配好路径后按 24h 间隔跑 |
| **备份内容** | vault 就是普通文件夹；File Recovery 只快照笔记内容，存全局设置目录（vault 之外），≥5 分钟一次、留 7 天 | 笔记+笔记本+标签+颜色+提醒；**附件需登录后恢复**（附件密钥派生自账号）；备份 vs 导出是两个功能 | SQLite .db / SQLite+assets zip / EDN / 标准 Markdown（各选项覆盖范围不同，见 1.3-c） | 笔记本（JEX，**空笔记本不备**）+ settings.json + 快捷键 + userchrome/userstyle + templates + 插件文件（**不含插件设置**）；**不含 note history** |
| **失败告知** | 无（快照静默进行，文档明确「不是完整备份方案」） | 自动备份静默；**登出/改密前的自动备份失败会弹问**（「是否仍然登出」）；用户侧有「自动备份为何没触发」的困惑（1wcsird） | 文档未提及任何失败告知；备份在后台静默 | 插件失败弹错误对话框（源码 `showError`）+ 写 `activeBackup.log`；但核心 app 层面无主动通知——出大事的用户是「备份从未被触发也不自知」（论坛 45236） |
| **恢复语义** | 人工放回文件夹；File Recovery 按笔记路径恢复单文件快照（vault 挪过位置要对上绝对路径） | 就地覆盖：回到备份时点，**备份之后新建的内容保留**；官方教「三明治」恢复法（新备份→旧备份取件→再恢复新备份） | 导入式：SQLite/EDN 导入**目标 graph 已存在则拒绝**（防覆盖）；`graph backup restore` 同样拒绝已存在的 graph | 导入式（File→Import→JEX）：**不查重**（重复导入出 "(1)" 副本）、**ID 全部重发**、单条笔记无法从 JEX 直接恢复（官方教 8 步绕行法） |

### 1.2 各家细节与原文

**Obsidian**（官方文档仓库 `obsidianmd/obsidian-help`）
- `en/Getting started/Back up your Obsidian files.md`：「If you haven't backed up your computer yet, start now!」；「local storage can be affected by issues like corruption or data loss. **It is never a matter of if, but when.**」；整节标题「**Syncing is not a backup**」——Obsidian Sync/iCloud/OneDrive/Dropbox 都只算同步。这是四家里把 sync/backup 分得最清楚的官方表态。
- 同页推荐路径：系统级备份（Windows 用 OneDrive/外置盘，Mac 用 Time Machine）+ 两个被点名的社区插件：Obsidian Git（提交到 Git 仓库）、Local Backup（拷贝到本地文件夹）。
- `en/Plugins/File recovery.md`：「File recovery is **not a complete backup solution**, and we recommend also backing up your Obsidian files separately.」默认「snapshots are saved a minimum of 5 minutes from each other, and kept for 7 days」；快照存「Global settings, **outside of the vault**, to account for vault-related data loss」，且绑定**绝对路径**——「If you've moved your vault recently, you may need to move it back to the location where it was when the snapshot was taken.」（换机/挪目录后快照对不上，见 1.3-b）。
- 默认开与否：现行文档不再写默认值；2021 年版官方文档（第三方存档 [demo-obsidian.owenyoung.com](https://demo-obsidian.owenyoung.com/Plugins/File%20recovery/)）明说「File recovery is default to enabled, because it's too late to enable when you've already lost data.」——证据强度：中（旧文档 + 社区通行认知）。

**Notesnook**（`streetwriters/notesnook` docs）
- 备份入口：Settings → Backup & export → Create backup，产物 `.nnbackupz`；「All backups are stored locally encrypted (**unless you turn off backup encryption**) on your device.」「**Encrypted backups are on by default.**」「Backups are always encrypted with your account password.」
- 自动备份：「you can enable daily, weekly or monthly backups」；**web 端没有本地落盘能力，只能提醒**：「On the web app there is no way to automatically save backups to a folder, that is why Notesnook only reminds the users when it's time to create a new backup.」
- 恢复语义（danger 框原文）：「Restoring a backup replaces your current content in-place. Anything that changed since that backup was taken is reverted to how it was in the backup. **Entirely new content — notes you created after the backup — is not touched.**」官方推荐的取回旧笔记方法是「三明治」：先备份现在 → 恢复旧的取件 → 再恢复回新的（等于承认**没有按条恢复**能力）。
- 附件恢复限制：官方 FAQ「Why do I need to log in to restore attachments from a backup?」——笔记等可以离线恢复，**附件不行**（密钥派生自账号）。另外官方 danger 框：忘了账号密码且没有 recovery key，E2EE 下数据不可恢复。
- 失败告知：账号设置文档记载登出/改密前会自动做一次备份，「若该备份失败会询问是否仍要登出」；日常自动备份本身无通知（Reddit 1wcsird 是用户实例）。

**Logseq**（`logseq/docs/db-version.md`，2026-04-28 版）
- 「**For the desktop, backups are automatically enabled** at the `backups` folder inside your graph directory. The last 12 backups are saved.」浏览器端选文件夹后每小时一份、保留 12。
- 导出选项按忠实度分层：`Export SQLite DB`（单文件）、`Export both SQLite DB and assets`（zip）、`Export EDN file`——原文：「This is **the only export type that fully captures a graph's data** and is editable. This export is **not yet recommended as the only means to backup a graph**.」`Export as standard Markdown`——原文：「it **cannot capture all data in a graph**.」（Logseq 自己承认：你天天编辑的 markdown 文件**不是**完整格式。）
- 导入保护：SQLite 导入 / EDN 导入 / `graph backup restore` 在目标 graph 已存在时直接拒绝——用「拒绝」而不是「合并」来防覆盖。
- 失败告知：文档全文未提及（诚实声明：是「文档没有」而非「确认没有」）。

**Joplin**（官方站 + `JackGruber/joplin-plugin-backup` 源码）
- 官方 FAQ 建议备份；Note history（内置修订）：「we save revisions **every 10 minutes**」（[history spec](https://joplinapp.org/help/dev/spec/history/)）。
- Backup 插件（`io.github.jackgruber.backup`）：README「The plugin is **installed as built-in plugin in Joplin version 2.14.6 and newer**」，但「**First configure the Plugin** under Tools > Options > Backup! The plugin must be configured separately for each Joplin profile.」源码默认值（`src/settings.ts`）：`backupInterval` 默认 **24**（小时）、`backupRetention` 默认 **1**（只留 1 份！）、`exportFormat` 默认 `jex`、`singleJexV2` 默认 `true`（label 原文：「Single JEX — Create only one JEX file (**Recommended to prevent the loss of internal note links or folder structure during a restore!**)」）、`createSubfolder` 默认 true（备份落 `<路径>/JoplinBackup/`；Windows 默认位置 `C:\Users\<用户名>\JoplinBackup`，见论坛 45236 官方回复）。
- 「What is backed up」清单：notebooks as JEX（**Empty notebooks are not backed up**）、settings.json、keymap、userchrome.css、userstyle.css、templates、插件文件（**no plugin settings!**）。
- 备份不含历史（FAQ 原文）：「A JEX backup file **does not** contain any note history (revisions).」论坛 8934 作者 Laurent 原话：「Note history is included in sync, but not export. **If you need to preserve history in your backup, you need to backup the sync directory.**」
- 恢复（README 原文）：「**Individual notes cannot be restored from the JEX file!**」「The notes are imported additionally, **no check for duplicates is performed**. If the notebook … already exists … a "(1)" will be appended」；取单条笔记要新建 profile→导入→再导出→切回→再导入，共 8 步；换机导入「all items in the backup will get **new unique IDs**」。
- 失败告知：插件源码有 `showError` 对话框（失败弹窗）+ 文件日志 `activeBackup.log`；但论坛 50272 显示失败形态是「上次的临时备份目录没被清理→这次备份失败」（OneDrive/Google Drive 同步锁临时目录所致）。

### 1.3 用户抱怨的四种具体形态

**a) 丢数据（且当时没有备份）**
- r/ObsidianMD，183 分：「A warning for Obsidian users: make backups and never keep your vault in the app's installation folder」——winget 升级时「can **delete the entire application folder during an update and recreate it from scratch**」，vault 放在安装目录里随之被删；热评 244 分：「Why would anyone do this? … Why would you not have backups?」、178 分：「never ever keep data in an installation folder.. for any app」。— [1oxxzp4](https://www.reddit.com/r/ObsidianMD/comments/1oxxzp4/)
- Joplin 论坛 2025-05，Win11 用户四年笔记：「As soon as I updated to the most recent version, **all of my notes were instantly wiped out** … **without a backup being triggered (as far as I can tell)**. I trusted Joplin as a secure space for my data」；官方回复第一句是问「Anything in the JoplinBackup folder in your home folder?」——内置备份插件在，但没配置=没跑，用户不知道。— [45236](https://discourse.joplinapp.org/t/subject-critical-data-loss-after-joplin-update-all-notes-deleted/45236)
- r/logseq：「Backup before updating! … **I lost half a day's worth of research - again.** I should know better by now!」（"again"——同一个人丢第二次）。— [wyz3j2](https://www.reddit.com/r/logseq/comments/wyz3j2/)；以及「Lost a random set of notes」下 1 分评论「you need to back up your stuff because **Logseq can be flaky like this**」。— [1ndo4pc](https://www.reddit.com/r/logseq/comments/1ndo4pc/)
- 更细的一种：**丢了都不知道**。r/logseq 7 分：「How do you know if you've lost data? There's been a few times where I've suspected data loss but … most of the time I don't review it all often enough to assess the damage.」用户被迫自己写 diff 脚本、md5 全盘比对来发现丢失。— [1mnkvt2](https://www.reddit.com/r/logseq/comments/1mnkvt2/)

**b) 换机 / 迁移**
- Joplin 换机恢复的三个坑（README + 论坛原文）：单条笔记不可恢复（8 步绕行）、重复导入出 "(1)" 副本、「all items … get new unique IDs」→ 论坛 8934 用户 mic704b：「if you restore by importing from backup, **the restored notes don't retain their original id** … it is something to be aware of」；多 JEX 文件导入「Internal Joplin links between notes are lost」。
- Logseq r/logseq 9 分：拷整个文件夹换机后「restoring those files **doesn't fix the broken links**」——文件到了，关系断了。— [x0v0mb](https://www.reddit.com/r/logseq/comments/x0v0mb/)
- Obsidian 的快照绑定绝对路径（1.2 节引文）：vault 挪过位置，「you may need to move it back to the location where it was when the snapshot was taken」——换机=快照基本作废。
- Obsidian 被删库后的求助帖（8 分）：「I lost all of my work in obsidian due to my own user error and making assumptions about how to app worked」，随后问怎么把 Syncing/backups/plugins 组合起来「avoid losing my work again」，自述「I've never used a pluggin before」。— [1q40rho](https://www.reddit.com/r/ObsidianMD/comments/1q40rho/)

**c) 导出格式（哪个才是「真备份」）**
- Logseq 官方文档自己写明：标准 Markdown 导出「cannot capture all data」，EDN「not yet recommended as the only means to backup」——三个选项没有一个是既完整又稳的，用户被迫理解 SQLite/EDN/MD 的差别。
- Joplin：`jex` / `md_frontmatter` / `raw` 三选一，插件把 `singleJexV2` 默认开并写明理由「to prevent the loss of internal note links or folder structure during a restore」；论坛版主原话：「Unless you have deactivated Single JEX, which is **also not recommended**, as all internal links between notes in different notebooks will be lost.」（[13964 p11](https://discourse.joplinapp.org/t/backup-plugin/13964?page=11)）——格式选错=链接全断，而默认值替你挡了这一下。
- Obsidian 反面是「无格式问题但也无格式保障」：回答新人时社区的原话是「**Your vault is just a folder with a bunch of files**」（1reu6oq 评论）、「its all literally just files in a folder … by some measurements its already "backed up"」（1p520ff 评论）——明文目录是它的迁移优势，也是它把备份责任推给 OS 的原因。
- 中文语境（佐证，强度中）：知乎「Obsidian 怎么同步？4 套方案深度对比」结论是「**一套主力同步 + 另一套做备份**」，8 年老用户帖强调换电脑前「确认本地有一台设备保留最新 vault」（[zhihu 2045903393277874929](https://www.zhihu.com/tardis/jm/art/2045903393277874929)、[zhihu 2079175902483706748](https://zhuanlan.zhihu.com/p/2079175902483706748)）——中文社区同样在教用户自己拼装两层方案。

**d) 备份里到底有什么（ surprises ）**
- Joplin 论坛 8934 开帖：「the export I made before the mess started **does not seem to contain all notes**. After import to a fresh installation … I have **736 notes**, while in the encrypted folder there are **more than 2600 md files**」——736 对 2600，用户把「导出」当「全量备份」；作者 Laurent 澄清 JEX 不含历史：「Exported notes are essentially a copy of the notes, so they start with a new history.」— [8934](https://discourse.joplinapp.org/t/export-import-is-not-a-backup/8934)
- Notesnook 备份 vs 导出是两个按钮，用户分不清（1pxrdey「What type of backup is best here?」被回复纠正「It is under the **Backups** header, **not Export** header」）；备份带不带附件是两个选项（1pu80i1 回复：「1. Back **without attachments** … 2. Backup **with attachment** … EVERYTHING」）；且「The encryption password will be your account password. So if you ever forget your password … **you won't be able to use the encrypted backups**」。
- 附件恢复要登录（Notesnook 官方 FAQ，1.2 节）——「备份在手边，附件打不开」是真实发生的形态。
- 对比之下，**内容清单写进备份里**这件事只有 Joplin 插件做了（README 会写清单+`activeBackup.log`），Obsidian/Logseq/Notesnook 都没有「这个备份里有什么」的随包说明。

### 1.4 失败告知小结

四家里把「失败让人知道」做得最主动的竟是社区插件（Joplin Backup 弹窗+日志）；平台级做法要么静默（Obsidian 快照、Logseq 自动备份），要么只在特定动作时问一次（Notesnook 登出前）。**没有一家做「失败后主动推送通知」**。反面教材是 Joplin 45236：内置插件在机器上躺着，用户以为「我信任它会有备份」，出事后才知道从未跑过。结论：**自动备份必须有「成功状态可见 + 失败主动说」两条，缺一条就退化为 45236 的形态。**

## 2. 题目二：ASAKI 现有能力的落差（只读）

### 2.1 已经做对的（对照上面四家，不输的部分）

| 已有能力 | 证据 |
|---|---|
| 备份目标安全检查：拒绝目标在 vault/userData 内，realPath 防 symlink 自拷贝 | `src/main/backup.ts:85-94` |
| 时间戳原子建目录（EEXIST 顺延，上限 1000） | `src/main/backup.ts:97-110` |
| dereference 拷贝：iCloud/Dropbox 软链 vault 拷成真数据（Obsidian 用户的真实翻车点） | `src/main/backup.ts:113-116`（注释即说明） |
| **备份内自带 README.txt 内容清单**（包含项逐项注明/不包含 API Key/恢复提示）——四家里只有 Joplin 插件做到同档 | `src/main/backup.ts:140-156` |
| 恢复前安全快照 `restore-safety/<stamp>`，失败可回 | `src/main/backup.ts:328-343` |
| 恢复校验：非 ASAKI 备份（缺 vault/）直接拒绝；拒绝恢复目录在当前 vault/userData 内 | `src/main/backup.ts:310-321` |
| swapDirectory 回滚 + 失败时「原数据保留在 <路径>」的提示 | `src/main/backup.ts:220-224, 236-256`；对话恢复失败给 safetyPath `:375-377` |
| Secrets 永不进备份（state.json 本就不含 secret，API Key 在 safeStorage） | `src/main/state-store.ts:10-13`；`src/main/context.ts:250-268` |
| 恢复前确认框写清覆盖语义 + 完成提示 + 立即重启按钮 | `src/renderer/settings/SettingsPage.tsx:606-608, 622, 1400-1404` |

### 2.2 落差表（现有能力 vs 上面建议）

| # | 落差 | 证据（file:line） | 对应 §1 证据 | spec 方向 |
|---|---|---|---|---|
| G1 | **无自动备份**。全仓库无 autoBackup/lastBackup；备份只能手动点按钮；调度器 30s tick 只跑主动检查 | grep 全仓库无命中；`SettingsPage.tsx:575-598`（仅手动入口）；`src/main/scheduler/app-scheduler.ts:49,65`（tick 只服务 check-ins） | §1.1 四家全有（唯 Joplin 需配置）；§1.3-a「没备份也不自知」 | `AppSettings.backup` 字段 + 复用 `createBackup` 的定时任务 |
| G2 | **无「上次备份」状态**。backupStatus 是一次性操作结果，重启即丢；README.txt 只存在于备份文件夹里，应用内不可见 | `SettingsPage.tsx:179, 1405-1418`；`backup.ts:140-156` | §1.3-d（随包清单 Joplin 有、我们只进了包没进门） | 持久化 `lastBackupAt/Path/Outcome`，设置卡显示「上次备份：N 天前」 |
| G3 | **失败只有一行行内提示**，无 OS 通知通道 | `SettingsPage.tsx:593`（friendlyErrorMessage → 单行 status） | §1.4（Joplin 插件弹窗+日志是天花板；我们连弹窗都只在设置页开着时才有） | 自动备份失败走系统通知 + 状态行双通道 |
| G4 | **换机恢复不还原设置**。state.json 在备份里（含 vaultPath/provider/notifications），但 restoreBackup 设计上不恢复它 | `backup.ts:289-297`（doc comment：carries the vault path and provider settings…）；`state-store.ts:10-13` | §1.3-b（换机=设置重来）；Joplin 新 ID 问题同型 | 选项 a：恢复时仅当本机 state.json 不存在才采用备份内 state.json（保守合并）；选项 b：README.txt 明示「换机后设置需重配」。倾向 a，另立小项 |
| G5 | **内容清单与恢复语义互相矛盾**。设置卡说「备份包含…设置和用量」，README 说「state.json 可放回应用数据目录」，恢复提示与 UI 却说「当前设置与 API Key 保持不变」——三处说法并存，用户不知道哪句是真的 | `SettingsPage.tsx:1378`；`backup.ts:152-153`；`SettingsPage.tsx:607` | §1.3-d（ahpl 736/2600 的困惑正来自清单与实际不符） | 统一文案：备份**包含** settings 的副本、恢复**不动**当前设置（G4 若做保守合并则改写） |
| G6 | **无备份保留策略**：每次导出新建时间戳文件夹，永不清理 | `backup.ts:97`（只建不清） | §1.1（Logseq 留 12、Joplin 默认留 1——后者是反例：默认留 1 太少） | 可选项：自动备份目录保留最近 12 份；手动导出不管（用户自己选的地方不动） |
| G7 | 备份后无完整性信息：README 只写布尔（已包含/跳过），无文件计数/大小 | `backup.ts:140-156`（copied 布尔） | §1.3-d、Notesnook 用户自发「备份演练」（[1wvwsuy](https://www.reddit.com/r/Notesnook/comments/1wvwsuy/)） | README 追加一行「本次包含 N 个文件，约 X MB」即可，不做校验和（见 §5） |
| G8 | 恢复需重启生效，且恢复期间窗口仍指旧数据 | `SettingsPage.tsx:622`「恢复完成，重启后生效。」 | 对比 Logseq/Obsidian 文件级即时语义 | 保持现状（Electron 内存态决定），但确认框已写清，属可接受差异，仅记录 |

### 2.3 哪些「上面的建议」会破坏 vault 明文直读前提（拒收清单）

1. **加密备份**（Notesnook 模式）：`.nnbackupz` 默认加密且密码=账号密码。一旦采用，「备份是普通文件夹，资源管理器直接能读」消失，且引入密码遗忘=备份作废的死锁（§1.3-d 的原话引文）。**不做。**
2. **单文件专有容器**（JEX tar / .nnbackupz zip）：用户打不开、单条恢复变 8 步绕行（Joplin README 实录）。我们现在的目录+README.txt 是四家对照里最好的形态。**不做。**
3. **云上传 / 同步式「备份」**：Obsidian 官方整节「Syncing is not a backup」；本地优先是产品前提。**不做。**
4. **导入式恢复**（重发 ID、不查重）：Joplin 的 "(1)" 副本与 ID 变化是反面教材；我们保持目录交换 + restore-safety 快照。**不做。**

## 3. 题目三：前几轮未覆盖的受众

**候选：Windows 上的「非技术」自学者——会丢数据、但配不出任何一种社区方案的大多数。**

前三轮覆盖过：理解/保持、提问/测验、启动成本、信任核验、进度可见、问责陪伴、隐私删号、想法多落不了地（创意工具坟场）、本地优先信任（被丢库吓过的人）。**「低技术素养 × Windows」这一交叉从未单独出现**——前三轮引用的丢库者多数自己会修（程序员、git 用户），而下面这组人的共同点是：**求助帖下面的标准答案（git / Syncthing / Duplicati / Time Machine）他们一个都用不了。**

**证据（每条已核验存在与分数）：**
- Win11 + Joplin 四年用户，更新后全没：「all of my notes were instantly wiped out … without a backup being triggered (as far as I can tell)」——内置备份插件在机器上，没配置=没跑，且他不知道。— [Joplin 45236](https://discourse.joplinapp.org/t/subject-critical-data-loss-after-joplin-update-all-notes-deleted/45236)
- Windows + winget 用户，vault 放安装目录被升级连锅端（183 分帖正文）。— [1oxxzp4](https://www.reddit.com/r/ObsidianMD/comments/1oxxzp4/)
- 父亲帖：「Obsidian backups that are easy for a child」——儿子的 Windows 电脑崩溃后笔记「full of squares」（损坏），他自认懂 git 但明确要「一次性配好、孩子不用管」的方案。— [1npds0b](https://www.reddit.com/r/ObsidianMD/comments/1npds0b/)
- 丢失者求助与社区回应的错位（同帖 1q40rho）：发帖人装了 Remotely Save「nothing seemed to transfer … I've never used a pluggin before」；高赞回复是「The best thing … is to **read the manual (RTFM)!**」和「3rd party syncing plugins aren't just install turn on and things magically work. They require some configuration」——**方案存在，但每个方案都有配置门槛，掉队者就地躺下。**
- 非「大 V」的常态自白（11 分帖评论区）：45 分评论「I need to **automate** my back up process. Doing it manually means I sometimes leave it longer than I planned.」；0 分评论「Let's see how long I keep procrastinating actually doing it. **My last backup is several months old** 🙈」——手动备份对多数人=「想起来才做」。— [1o1xy3c](https://www.reddit.com/r/ObsidianMD/comments/1o1xy3c/)
- 对照组（为什么强调 Windows）：同类 Mac 帖（1p520ff「Not Tech Savvy」）下回复清一色「Use Time Machine」——macOS 有系统级兜底，回答到此为止；Windows 帖的回复则是「装这个插件/写个脚本/rsync」——**没有系统级兜底的人被要求自建兜底**。而我们目前只发 Windows x64 包（`docs/releases/windows.md:19`「当前只构建 x64」）。
- Logseq 侧同型：「I'm using the linux version and am **very much a beginner** but … I lost a lecture's worth of notes」（[1ndo4pc](https://www.reddit.com/r/logseq/comments/1ndo4pc/)）；7 分帖自述被迫写 diff 脚本才能发现丢失（1mnkvt2）。

**诚实声明（证据强度：中）：** 样本来自英文社区；没有中国用户的直接引语（知乎仅有「方案教学」型内容，恰好反证：会搜方案的人在学方案，不会搜的人无声）。 「Windows 用户缺少系统级备份兜底」是从回复模式归纳（Mac→Time Machine，Win→装第三方），不是统计结论。但六条独立证据跨三个产品、时间跨度 2016→2026，形态高度一致。

**最小需求（对应 spec，不新增产品面）：**
1. 首次成功导出备份后，问一次「要不要每周自动备份到同一个文件夹？」（预选「开」）——不静默默认开（在用户磁盘上持续写数据需一次明示），也不纯 opt-in（这组人永远不会主动去设置页找开关）。
2. 设置卡常驻一行人话状态：「上次备份：N 天前 / 从未备份过」。
3. 失败必说人话且不吓人（§4 文案）。
4. 一切概念不出现「同步 / 版本库 / 加密 / 快照」字样——这组人不需要懂这些也能被保住。

## 4. 可直接写进 spec 的建议

### 4.1 字段（挂在 `AppSettings`，`src/shared/types.ts:83`；缺省不序列化，沿 `strictMastery` 先例 `:97-103`）

```ts
backup?: {
  autoEnabled?: boolean;        // 缺省=false；首次手动导出成功后弹一次性询问，预选 true
  autoIntervalDays?: 1 | 7 | 30; // 缺省 7（对照：Notesnook daily/weekly/monthly；Joplin 24h 对个人学习场景过密）
  lastBackupAt?: string;        // ISO 本地时间，手动+自动都写
  lastBackupPath?: string;      // 便于「打开备份所在文件夹」
  lastBackupOutcome?: 'ok' | 'failed';
}
```

### 4.2 文案原句（中文，直接可贴）

- 设置卡状态行（常驻，G2）：`上次备份：今天 14:32` / `上次备份：6 天前` / `从未备份过。`
- 自动备份开关：label `每周自动备份`，描述 `把项目、记录和对话复制到你选的文件夹。备份是普通文件夹，不含 API Key，用文件管理器就能直接打开。`
- 一次性询问（首次手动导出成功后）：`以后每周自动备份到同一个文件夹吗？可以随时在设置里改。`［每周备份 / 暂不］
- 失败通知（OS 通知 + 状态行同文，G3）：`自动备份没有成功（<原因>）。你的数据没有被动过；可以稍后重试，或在「设置 → 数据与备份」手动导出。`
- 成功（手动，已存在不动）：`已导出到 ${result.path}`（`SettingsPage.tsx:584-592`）
- README.txt 增补一行（G7）：`本次备份包含 <N> 个文件，约 <X> MB。`
- 统一「包含/恢复」口径（G5，改 `SettingsPage.tsx:1378`）：`备份包含项目、记录、对话、设置和用量的副本。恢复会覆盖项目、记录和对话；当前设置与 API Key 保持不变。`

### 4.3 默认值与理由

- `autoEnabled` 缺省 false，但**首启后首次手动备份成功时问一次**（§3 最小需求 1）：静默默认开=在用户磁盘持续写数据（前轮反功能检查红线）；纯 opt-in=恰好错过最需要的人（45236：有插件没配置）。
- `autoIntervalDays` 缺省 7：学习记录的变更粒度是周（周复盘节奏），每天一次对 SSD/网盘目录是噪音；保留 1/30 档给极端用户。
- 自动备份保留最近 12 份（G6，若做）：对齐 Logseq 的 12；Joplin 默认 retention=1 是反例（`settings.ts` 源码实测）。

### 4.4 失败时的说法原则

- 说「没有成功」+「你的数据没有被动过」+「怎么办」，三层齐；不说「备份损坏」「数据可能丢失」——45236 开帖人的语气（"devastating … I trusted Joplin"）就是被吓出来的。
- 失败原因用 errno 映射成人话（目录不可写/磁盘满/被其他程序占用），不透出堆栈。

## 5. 不做项及理由（连同 §2.3 的四条拒收）

| 不做 | 理由 |
|---|---|
| 加密备份 | 破坏明文直读前提；密码死锁（Notesnook 实录）。备份的安全边界=不含 secrets（已满足） |
| 单文件容器（zip/tar/专有格式） | 单条恢复变难（Joplin 8 步绕行）；用户打不开 |
| 云上传 | 本地优先；Obsidian 官方「Syncing is not a backup」 |
| 导入式恢复 | ID 重发/"(1)" 副本/链接断（Joplin 实录）；现有目录交换+安全快照已更优 |
| 备份校验和 / 恢复演练功能 | 真实需求存在（1wvwsuy）但频率太低；README 文件计数已给用户自查锚点，收益不抵复杂度 |
| 提醒式备份（Notesnook web 模式：只提醒不落盘） | 我们是桌面端，有能力落盘；「只提醒」会把责任推回用户，恰是 §3 受众做不到的事 |

## 6. 反功能复核（沿用第三轮格式）

- ❌ 不做进度条/假备份动画：备份是秒级目录拷贝，如实显示「正在导出…」即可。
- ❌ 不把「从未备份过」做成红色警告或 badge：是事实行不是愧疚行（round-2 §2.5「别让我内疚」同源）；失败通知也只陈述「没有成功+怎么办」。
- ❌ 不自动删除/覆盖用户目录里任何旧备份（G6 仅限自动备份自己的 12 份轮换，手动导出目录不清理）。
- ❌ 不引入账号/云来「帮你备份」：与 §2.3-3 同源。

## 7. 引用清单（按首次出现）

1. Obsidian 官方，Back up your Obsidian files — https://help.obsidian.md/backup （源文 `obsidianmd/obsidian-help` `en/Getting started/Back up your Obsidian files.md`）
2. Obsidian 官方，File recovery — https://help.obsidian.md/plugins/file-recovery （`en/Plugins/File recovery.md`）
3. Obsidian 旧版文档存档（File recovery 默认开）— https://demo-obsidian.owenyoung.com/Plugins/File%20recovery/
4. Notesnook 官方，Backup and restore — https://notesnook.com/help/backup-and-restore-notes-in-notesnook （源文 `streetwriters/notesnook` `docs/help/contents/backup-and-restore-notes-in-notesnook.md`）
5. Notesnook 官方 FAQ，附件恢复需登录 — https://notesnook.com/help/faqs/login-to-restore-attachments-in-backup
6. Notesnook 官方，账号设置（登出前自动备份） — https://notesnook.com/help/account-settings
7. Logseq 官方，DB version（Automated Backup / Export） — https://github.com/logseq/docs/blob/master/db-version.md
8. Joplin 官方，Note history spec — https://joplinapp.org/help/dev/spec/history/
9. Joplin Backup 插件 README — https://github.com/JackGruber/joplin-plugin-backup#readme
10. Joplin Backup 插件 `src/settings.ts`（默认值） — https://github.com/JackGruber/joplin-plugin-backup/blob/master/src/settings.ts
11. Joplin 论坛 8934「Export / Import is not a backup」（含 Laurent 原话） — https://discourse.joplinapp.org/t/export-import-is-not-a-backup/8934
12. Joplin 论坛 45236「Critical Data Loss After Joplin Update」 — https://discourse.joplinapp.org/t/subject-critical-data-loss-after-joplin-update-all-notes-deleted/45236
13. Joplin 论坛 50272「Backup failing because of left over previous backup directory」 — https://discourse.joplinapp.org/t/backup-failing-because-of-left-over-previous-backup-directory-files/50272
14. Joplin 论坛 13964「Backup Plugin」（版主 singleJex 表态） — https://discourse.joplinapp.org/t/backup-plugin/13964
15. r/ObsidianMD 1oxxzp4（winget 删 vault，183 分） — https://www.reddit.com/r/ObsidianMD/comments/1oxxzp4/
16. r/ObsidianMD 1q40rho（丢失后求助、插件门槛） — https://www.reddit.com/r/ObsidianMD/comments/1q40rho/
17. r/ObsidianMD 1p520ff（Mac 新手怎么备份） — https://www.reddit.com/r/ObsidianMD/comments/1p520ff/
18. r/ObsidianMD 1o1xy3c（备份科普帖+拖延自白） — https://www.reddit.com/r/ObsidianMD/comments/1o1xy3c/
19. r/ObsidianMD 1npds0b（父亲为孩子找备份方案） — https://www.reddit.com/r/ObsidianMD/comments/1npds0b/
20. r/ObsidianMD 1reu6oq（「vault 就是文件夹」回答） — https://www.reddit.com/r/ObsidianMD/comments/1reu6oq/
21. r/logseq wyz3j2（升级丢半天，"again"） — https://www.reddit.com/r/logseq/comments/wyz3j2/
22. r/logseq 1ndo4pc（新手随机丢笔记） — https://www.reddit.com/r/logseq/comments/1ndo4pc/
23. r/logseq 1mnkvt2（怎么知道丢了数据） — https://www.reddit.com/r/logseq/comments/1mnkvt2/
24. r/logseq x0v0mb（换机后链接断） — https://www.reddit.com/r/logseq/comments/x0v0mb/
25. r/logseq 1j0t35n（「有没有内置备份？」） — https://www.reddit.com/r/logseq/comments/1j0t35n/
26. r/Notesnook 1wcsird（自动备份为何没触发） — https://www.reddit.com/r/Notesnook/comments/1wcsird/
27. r/Notesnook 1q7rnqe（自动备份在哪） — https://www.reddit.com/r/Notesnook/comments/1q7rnqe/
28. r/Notesnook 1pu80i1（备份带不带附件/加密密码） — https://www.reddit.com/r/Notesnook/comments/1pu80i1/
29. r/Notesnook 1pxrdey（备份 vs 导出分不清） — https://www.reddit.com/r/Notesnook/comments/1pxrdey/
30. r/Notesnook 1wvwsuy（恢复演练需求） — https://www.reddit.com/r/Notesnook/comments/1wvwsuy/
31. 知乎，Obsidian 同步方案对比（中文语境佐证，强度中） — https://zhuanlan.zhihu.com/p/2079175902483706748
32. ASAKI 代码：`src/main/backup.ts`、`src/renderer/settings/SettingsPage.tsx`、`src/main/state-store.ts`、`src/main/context.ts`、`src/main/scheduler/app-scheduler.ts`、`src/shared/types.ts`（行号见 §2）

## 8. 一句话结论

四家里做得最好的组合其实是「Obsidian 的明文目录 + Joplin 插件的失败弹窗 + Logseq 的默认开」；我们已经有了最难的部分（明文目录+安全恢复+随包清单），缺的是把备份从「按钮」变成「状态」——一个持久字段、一行人话、一次首启询问，就能把 45236 那种「信任却裸奔」的用户接住。
