# Cursor 账号管理

Cursor 多账号管理：切换账号、管理登录态、查看额度、踢设备、提取本机/浏览器 token。支持在 Cursor 调用 Grok Bot 高级模式额度，突破使用上限。2.3 起一键注入为 Grok Bot 路由模式（Sand Stream），**请先把 Cursor 升级到最新版**再注入。

侧栏名称：**账号管理**。命令面板搜「账号管理」或 `Cursor Account Manager`。

本仓库版本从 **2.1.0** 起算。

| 账号列表 | 更多 · 备注 |
| --- | --- |
| ![账号列表](docs/screenshot-accounts.png) | ![更多与备注](docs/screenshot-more.png) |

业务逻辑对齐 `keepchat-5.3.7-accounts(1).vsix`（文件名写 5.3.7，包内版本是 5.3.6）。这里只改了扩展名和中文包装：id 为 `local.cursor-account-manager`，侧栏「账号管理」，旧 `keepchat.*` 命令/配置仍可用。切号、额度、踢设备、浏览器授权、Sand 补丁与那份安装包一致。

## 能做什么

| 功能 | 说明 |
|---|---|
| **切换账号** | 把选中账号写入 Cursor 登录态。写完后必须完整退出再打开，只 Reload 窗口不够 |
| **管理登录态** | 账号列表存在本扩展本地存储，覆盖安装不会丢号 |
| **查看额度** | 联网读取 Auto / Other / Bot 用量，以及重置时间 |
| **账号备注** | 「更多 → 备注」给账号加短标签，显示在邮箱旁边，只存在本机 |
| **点击复制** | 点邮箱复制邮箱；更多里可复制 Token |
| **踢人** | 查看该账号已登录的设备，可把某台踢下线（最多大约 10 分钟生效） |
| **提取本机 Token** | 「导入本机」读取当前 Cursor 已登录的 token，加入列表（不会自动切换） |
| **浏览器授权提取 Token** | 打开隔离浏览器走官方登录，拿到可自动续期的令牌 |
| **Token / Cookie 导入** | 粘贴 `userId::accessToken`，有第三段 refreshToken 的可以自动续期 |
| **一键导出 / 导入** | 导出全部账号为 JSON（先预览再保存）；导入前先看新增/更新清单。文件含明文 token，只放本机 |
| **Grok Bot 路由模式** | 一键注入按最新 Sand Stream 1.2.6 写（请求头 `sand` + 本机直推 + Task / 子代理）。**需将 Cursor 升级到最新版** |
| **一键卸载** | 从 2.1.0 起的注入都能卸；备份对不上时就地反补丁。写完必须完整退出再打开 |

## 切换账号注意

1. 推荐用 **浏览器授权** 加号。这样有真的续期令牌，切过去不容易过期弹登录框。
2. 网页 Cookie / 只有 web token 的账号可以进列表看额度，但切成全局登录后，Cursor 可能要求重新登录。建议先点「升级授权」。
3. 写入前会备份 `state.vscdb`。切前若 client 账号的 accessToken 已过期，会先续期再写。
4. 写入后校验邮箱和 userId。对不上会报错，不要只 Reload，要完整退出 Cursor 再开。
5. 运行中的 Cursor 把登录态缓存在内存里，必须完整重启才会从库里重新读。

## 本机安装

```bash
npm run package
```

命令面板 → `Extensions: Install from VSIX...` → 选打好的 `.vsix` → 重载窗口。

侧栏会出现 **账号管理**。

## 开发

```bash
npm run build
npm run package
```

源码在 `src/`，构建后复制到 `dist/`。

## 配置

设置里搜「账号管理」或 `Cursor Account Manager`：

- `cursorAccountManager.accountUsageEnabled` — 是否联网读额度
- `cursorAccountManager.autoRefreshAccountTokens` — 后台自动续期
- `cursorAccountManager.sandAppRoot` — 可选，指定 Cursor 安装目录
- `cursorAccountManager.cursorOAuthClientId` — 一般不用改
- `cursorAccountManager.manualCursorToken` — 手动覆盖本机登录态（切号成功后会清空）

早期测试包用过的 `keepchat.*` 配置仍然兼容。

## 说明

- 扩展 id：`local.cursor-account-manager`
- 注入会改 Cursor 安装文件，先备份再写。这是 Grok Bot 路由模式更新，需使用最新版 Cursor；旧版只能改到请求头，没有本机直推
- 要还原用「一键卸载」：从 2.1.0 的无标记请求头到 2.3.2 的 Stream 1.2.6 都能卸
- Token 只存在你这台电脑的扩展存储和 Cursor 自己的登录库里，不会上传到网上
