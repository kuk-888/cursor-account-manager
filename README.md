# Cursor 账号管理

Cursor 多账号管理插件：一键切号、查看额度、踢设备、Grok Bot 路由加速。

仓库：[github.com/kuk-888/cursor-account-manager](https://github.com/kuk-888/cursor-account-manager)

## 2.3.20 · 接住 Cursor 3.19.13

Cursor 3.19.13 把本地 Agent 内核重写了。旧补丁锚点全断，注入看起来成功，提问照样掉回官方慢路径。

**这一版把 Bot 重新打通：**

- 注入对准 **3.19.13**，卸载继续兼容 **3.18.9 / 3.18.25** 和更早的历史补丁
- 直连流按官方 `Fe()` 的真实结构打包模型元数据（`promptModelInfo` + `useDsv3Harness`），不再「注入了但不能用」
- Grok 4.6 / 4.5 product prompt 互斥，4.6 不再误套旧模板
- 聊天气泡从官方 `Routed to` 改成 **本次使用**，Status 显示真文案

完整条目见 [CHANGELOG](CHANGELOG.md)。

## 界面

账号列表（Ultra / Business，Auto · Other · Grok Bot 三档额度）：

![账号列表](docs/screenshot-accounts.png)

更多菜单：令牌续期、备注、复制 Token、进控制台、查看设备、切号：

![更多菜单](docs/screenshot-more.png)

Grok Bot 未注入：

![Grok Bot 未注入](docs/screenshot-sand-off.png)

一键注入成功（Cursor 3.19.13 · Stream+Task 已齐），必须完整重启：

![Grok Bot 已注入](docs/screenshot-sand.png)

注入后对话上头会写出本次走的模型：

![本次使用](docs/screenshot-route.png)

## 功能

| 功能 | 说明 |
|---|---|
| **切换账号** | 多个 Cursor 账号一键切换，覆盖安装不丢号 |
| **查看额度** | 联网读取 Auto / Other / Bot 用量和重置时间 |
| **浏览器授权** | 一键打开隔离浏览器登录，拿到可自动续期的令牌 |
| **踢设备** | 查看已登录设备，踢掉不用的 |
| **导入导出** | 导出全部账号为 JSON，导入时先预览再确认 |
| **Grok Bot 加速** | 一键注入后走 Bot 额度提问，大幅提升响应速度 |
| **一键卸载** | 还原 Cursor 到注入前的原始状态 |

## Grok Bot 一键注入

> 兼容 **Cursor 3.18.9 / 3.18.25 / 3.19.13**。卸载仍能拆掉更早 Release 打过的补丁。

注入后的效果：
- 提问走 Grok Bot 额度，不消耗 Cursor 订阅额度
- 响应速度大幅提升（消除 Planning 等待）
- 支持子代理 / Task / resume 等完整 Agent 能力
- 聊天气泡把官方 `Routed to` 改成「本次使用」，并显示真实 Status 文案

使用方法：
1. 侧栏「Grok Bot」页面 → 点**一键注入**
2. **完全退出 Cursor**（托盘也退干净），再重新打开
3. 要还原就点**一键卸载**，同样退出再重开

注意事项：
- 注入前会自动备份原始文件，卸载可还原
- 缺补丁或版本不匹配会自动拒绝写入，不会写坏
- 只 Reload 窗口不够，必须完全退出再打开

## 切换账号

1. 推荐用**浏览器授权**加号（可自动续期，不容易掉登录）
2. 切号后必须**完全退出 Cursor 再打开**
3. 导出文件含明文 token，请妥善保管

## 安装

命令面板 → `Extensions: Install from VSIX...` → 选 `.vsix` 文件。侧栏会出现**账号管理**。

## 安全

- 所有 token 只存在本机，不会上传到任何服务器
- 只与 `cursor.com` 和 `api2.cursor.sh`（Cursor 官方）通信
- 不含任何第三方分析/追踪代码
- [源码公开](https://github.com/kuk-888/cursor-account-manager)，欢迎审查
- VSIX 不含账号、token、本机路径；仓库截图里的邮箱已打码
