# Changelog

## 2.3.20

兼容 Cursor 3.18.9 / 3.18.25 / 3.19.13。

### 修复

- **3.19.13 注入失效。** Cursor 3.19.13 重写了本地 Agent 内核，旧补丁锚点全部对不上。界面可显示「已注入」，实际仍走官方 `RunInference`，Bot 额度无法使用。本版按 3.19.13 新锚点重新对齐。
- **直连流模型元数据格式错误。** 3.19 官方读取 `resolvedModelMetadata.promptModelInfo` 与 `useDsv3Harness`。上一版把模型函数整包写入 metadata，触发 `metadata-unavailable`。已改为官方结构；旧注入体自动迁移。
- **Grok 4.6 误用 4.5 product prompt。** 两个模型家族改为互斥。
- **路由提示文案。** 官方 `Routed to` 改为「本次使用」，Status 显示真实消息。卸载可完整还原。

### 兼容范围

| 操作 | 版本 |
|---|---|
| 注入 | Cursor 3.18.9、3.18.25、3.19.13 |
| 卸载 | 上述版本，以及 2.1.0–2.3.11 已打过的历史补丁 |

注入或卸载后须完整退出 Cursor 再打开。

## 2.3.12

首次接 3.19.13 双轨锚点（本地回路 / runtime / 直连流 / resume / Task）。3.19 上能注入，但直连流 metadata 形态还不对，Bot 不稳定。

## 2.3.11

`supportsSelfSummary` 改回 `false`。2.3.10 误开会导致会话串。
