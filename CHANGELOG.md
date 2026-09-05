# Changelog

## 2.3.20 — 接住 Cursor 3.19.13

Cursor **3.19.13** 不是换皮。官方一天连发六个小版本，把本地 Agent 内核整段重写：`cursor-agent-host` 路由、feature gate、子代理、后台唤醒全部换了锚点。旧补丁对不上号，看起来「注入成功」，一提问就掉回 `RunInference`，Bot 额度白看着。

这一版把注入重新对准 3.19.13，同时**卸载继续兼容 3.18.9 / 3.18.25 和更早的历史补丁**。升 Cursor 的人能用，没升的人也能卸干净。

### 为什么这一刀必须打

- **内核换了，字面量全废。** 3.18 的 `checkFeatureGate` / `675.js` / `oe.xyI` 在 3.19 里已经不在原来的位置。不跟版本走，注入就是半成品。
- **「注入了但不能用」的真凶。** 3.19 官方 `Fe()` 读的是 `resolvedModelMetadata.promptModelInfo`，不是把模型函数直接塞进去。上一版把 `oe()` 当 metadata 整包塞进去，结果 `metadata-unavailable`，模型族认不出来。2.3.20 改成：

```js
resolvedModelMetadata: { promptModelInfo: oe(meta, mid), useDsv3Harness: false }
```

旧注入体会自动迁到新体，不用先卸再打。

- **Grok 4.6 不再误走 4.5 的 product prompt。** 两个家族互斥，避免 4.6 被套进旧模板。

### 聊天气泡也修好了

3.19 官方气泡是 `Routed to …` + 死文案 `Status update`。旧补丁往 `handleTextDelta` 塞 markdown 引用，竖杠和正文叠在一起。

现在：

- `Routed to` → **本次使用**
- Status 显示真实 `message`，不再只有一句 Status update
- 卸载能把 `ROUTE_HINT_V1` / `ROUTE_LABEL_V1` 拆干净

效果就是对话上头那一行：`本次使用 kimi-k3`。

### 兼容面

| | 注入 | 卸载 |
|---|---|---|
| Cursor 3.19.13 | ✅ 新锚点 + 新 metadata | ✅ |
| Cursor 3.18.25 / 3.18.9 | ✅ 旧字面量 | ✅ |
| 2.1.0–2.3.11 历史标记 | — | ✅ 全部能拆 |

半补丁预检仍在：对不上就拒写，不会把 Cursor 打残。`supportsSelfSummary` 继续关着，避免会话串。

注入或卸载后必须**完整退出 Cursor 再打开**，Reload Window 不会重载主进程。

## 2.3.12

首次接 3.19.13 双轨锚点（本地回路 / runtime / 直连流 / resume / Task）。3.19 上能注入，但直连流 metadata 形态还不对，Bot 不稳定。

## 2.3.11

`supportsSelfSummary` 改回 `false`。2.3.10 误开会导致会话串。
