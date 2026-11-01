# macOS 发布

## 本地构建

```bash
npm run package   # 快速验证：dist/mac-arm64/ASAKI.app
npm run dist      # 分发产物：zip + dmg（arm64）
```

当前仓库没有 Developer ID 证书，构建会跳过签名；本地运行没问题，但对外分发前需要签名和公证。

## 签名 / 公证

需要 Apple Developer Program 的 **Developer ID Application** 证书。

```bash
export CSC_LINK=/absolute/path/to/developer-id.p12
export CSC_KEY_PASSWORD='p12 password'
export APPLE_ID='apple-id@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='app-specific-password'
export APPLE_TEAM_ID='TEAMID'
npm run dist
```

electron-builder 会使用 `build/entitlements.mac.plist`（hardened runtime）并对产物签名/公证。

验证：

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/ASAKI.app"
spctl -a -vv "dist/mac-arm64/ASAKI.app"
```

## 图标

- 源文件：`build/icon.svg`
- 1024 PNG：`build/icon.png`
- macOS 图标：`build/icon.icns`
- 修改图标后重新生成：

```bash
qlmanage -t -s 1024 -o /tmp build/icon.svg
cp /tmp/icon.svg.png build/icon.png
# 用 sips 生成 icon.iconset 的 16/32/128/256/512/@2x，再 iconutil -c icns
```

## 版本与 tag

`package.json` 的 version 是唯一版本源；发布前更新 version、更新 README/CHANGELOG，然后打 tag。
