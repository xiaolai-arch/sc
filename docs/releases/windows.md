# Windows 发布

## 本地构建

需要 Windows 10/11、Node.js 24 LTS（最低 22）。

```powershell
npm ci
npm run package:win   # 快速验证：dist/win-unpacked/ASAKI.exe
npm run dist:win      # 分发产物：NSIS 安装包 + 便携版（x64）
```

产物：

- `dist/win-unpacked/ASAKI.exe`：未打包目录，最快的本地运行方式
- `dist/ASAKI-<version>-x64-setup.exe`：NSIS 安装包，可选择安装目录，创建桌面和开始菜单快捷方式
- `dist/ASAKI-<version>-x64-portable.exe`：免安装便携版

当前只构建 x64。Windows on ARM 可以通过系统模拟运行 x64 版本，尚未提供原生 arm64 包。

## 未签名与 SmartScreen

仓库没有 Windows 代码签名证书，`npm run dist:win` 会跳过签名。未签名安装包在其他机器上首次运行可能出现 SmartScreen「Windows 已保护你的电脑」提示；本机开发不受影响。

## 签名

需要代码签名证书（`.pfx`/`.p12`）。electron-builder 通过环境变量读取：

```powershell
$env:CSC_LINK = "C:\absolute\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "pfx password"
npm run dist:win
```

也可以把证书安装到 Windows 证书存储，并用 `CSC_NAME` 指定。签名后可用 `signtool verify /pa /v "dist\ASAKI-1.0.0-x64-setup.exe"` 验证。

## 图标

- 源文件：`build/icon.svg`
- 1024 PNG：`build/icon.png`（`electron-builder.yml` 里 Windows 直接使用它，构建时自动转成 `.ico`）
- macOS 图标：`build/icon.icns`

需要手工调整 Windows 图标时，放置 `build/icon.ico`（至少包含 256×256）即可覆盖自动转换结果。

## 提示与后台

安装包创建的开始菜单快捷方式带有 `com.studycoach.desktop` 的 AppUserModelID，应用启动时也会调用 `app.setAppUserModelId`，因此到点提醒和管家通知能正常显示。

关闭主窗口后应用留在系统托盘继续运行，便于接收提醒；从托盘菜单选择「退出」才会真正结束进程。便携版没有安装开始菜单快捷方式，Windows 通知的可靠性不如安装版。

设置里的「开机自启」会写入 Windows 登录项：安装版指向安装后的 `ASAKI.exe`，便携版指向便携启动器本身，而不是运行时解压的临时副本。

## 版本与 tag

`package.json` 的 version 是唯一版本源；发布前更新 version、更新 README/CHANGELOG，然后打 tag。