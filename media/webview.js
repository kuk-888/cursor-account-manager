(function () {
  const vscode = acquireVsCodeApi();
  let state = null;
  let dialog = null;
  let toast = '';
  let toastTimer = null;
  let retryRestart = null;
  let lastRenderSig = '';

  const app = document.getElementById('app');
  app.innerHTML = '<div class="empty"><div><strong>正在加载账号</strong><span>请稍候...</span></div></div>';

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'state') {
      const incoming = data.state;
      const sig = renderSig(incoming);
      if (state && sig === lastRenderSig) { state = incoming; return; }
      state = incoming;
      lastRenderSig = sig;
      render();
    } else if (data && data.type === 'retryNeedsRestart') {
      retryRestart = {
        message: String(data.message || '需要重启 Cursor 才能生效。'),
        action: String(data.action || 'accountSwitch'),
        restartCommand: String(data.restartCommand || 'restartCursor')
      };
      render();
    } else if (data && data.type === 'toast') {
      showToast(String(data.text || ''));
    } else if (data && data.type === 'sessions') {
      dialog = {
        type: 'sessions',
        accountId: String(data.accountId || (dialog && dialog.accountId) || ''),
        email: data.email || (dialog && dialog.email) || '',
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        error: data.error || '',
        loading: false,
        confirmKick: ''
      };
      if (data.toast) showToast(String(data.toast));
      else render();
    }
  });

  function post(type, data) { vscode.postMessage(Object.assign({ type }, data || {})); }
  function currentAccountId() {
    const hit = ((state && state.accounts) || []).find((x) => x.isCurrent);
    return hit ? hit.id : '';
  }

  function renderSig(s) {
    if (!s) return '∅';
    const acc = s.account || {};
    const accts = (s.accounts || []).map((x) => [
      x.id, x.isCurrent ? 1 : 0, x.email || '', x.type || '', x.partial ? 1 : 0,
      x.noRefresh ? 1 : 0, x.userTail || '', x.used == null ? '' : x.used,
      x.limit == null ? '' : x.limit, String(x.usageBased), x.usageError || '',
      x.autoPercent, x.otherPercent, x.botPercent, x.sessionCount, x.cycleEnd || '', x.botResetAt || ''
    ].join('|')).join(';');
    return [
      acc.email || '', acc.plan || '', acc.planLabel || '', acc.usageShort || '',
      acc.usageText || '', acc.error || '', acc.loading ? 1 : 0, acc.usagePct || 0,
      String(acc.usageBased), String(acc.enabled), accts, s.version || '',
      (s.sand && s.sand.patched) ? 1 : 0, (s.sand && s.sand.sand) || 0, (s.sand && s.sand.unpatched) || 0,
      (s.sand && s.sand.error) || '', (s.sand && s.sand.auto) ? 1 : 0,
      (s.sand && s.sand.commands && s.sand.commands.restore) || ''
    ].join('¶');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  }
  function attr(value) { return esc(value).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function rel(value) {
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '';
    if (ms < 1000) return '刚刚';
    if (ms < 60000) return Math.max(1, Math.floor(ms / 1000)) + '秒前';
    if (ms < 3600000) return Math.floor(ms / 60000) + '分钟前';
    if (ms < 86400000) return Math.floor(ms / 3600000) + '小时前';
    return Math.floor(ms / 86400000) + '天前';
  }
  function isFreePlan(x) { return String(x.type || '').toLowerCase().includes('free'); }
  function pctCls(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    const v = Number(n);
    if (v >= 100) return ' full';
    if (v >= 80) return ' hot';
    return '';
  }
  function resetHint(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(t)) return '';
    if (t <= 0) return '今日重置';
    const d = Math.floor(t / 86400000);
    const h = Math.floor((t % 86400000) / 3600000);
    if (d >= 1) return d + '天后重置';
    if (h >= 1) return h + '小时后重置';
    return '即将重置';
  }
  function quotaBar(label, value, hint) {
    if (value == null || !Number.isFinite(Number(value))) {
      return '<div class="qItem"><div class="qRow"><span>' + esc(label) + '</span><i class="muted">—</i></div><div class="qBar"><b style="width:0%"></b></div></div>';
    }
    const n = Math.max(0, Math.min(100, Number(value)));
    const shown = (Math.round(n * 10) / 10) + '%';
    return '<div class="qItem"><div class="qRow"><span>' + esc(label) + '</span><i>' + shown + '</i>'
      + (hint ? '<em>' + esc(hint) + '</em>' : '') + '</div>'
      + '<div class="qBar' + pctCls(n) + '"><b style="width:' + n + '%"></b></div></div>';
  }
  function acctQuotaBox(x) {
    if (x.usageError) return '<div class="acctLine2"><span class="muted">⚠ ' + esc(x.usageError) + '</span></div>';
    const has = x.autoPercent != null || x.otherPercent != null || x.botPercent != null;
    if (!has) return '<div class="acctLine2"><span class="muted">点「刷新」读取 Auto / Other / Bot</span>' + acctAddedText(x) + '</div>';
    return '<div class="quotaBox">'
      + quotaBar('Auto', x.autoPercent, resetHint(x.cycleEnd))
      + quotaBar('Other', x.otherPercent, '')
      + (x.botHasLimit || x.botPercent != null ? quotaBar('Bot', x.botPercent, resetHint(x.botResetAt)) : quotaBar('Bot', null, '无周额度'))
      + (x.userTail || x.addedAt ? '<div class="qMeta"><span class="uidTail">' + esc(x.userTail || '?') + '</span>' + acctAddedText(x) + '</div>' : '')
      + '</div>';
  }
  function acctIconBtn(action, id, icon, title, cls, disabled) {
    return '<button class="btn sm ic' + (cls ? ' ' + cls : '') + '" data-action="' + action + '" data-id="' + attr(id) + '" title="' + attr(title) + '" aria-label="' + attr(title) + '"' + (disabled ? ' disabled' : '') + '>' + icon + '</button>';
  }
  function acctPlanBadge(x) {
    const p = String((x && (x.type || x.plan || x.planLabel)) || '').toLowerCase();
    if (!p) return '';
    let label = x.type || x.planLabel || x.plan, cls = 'other';
    if (p.includes('free')) { label = 'Free'; cls = 'free'; }
    else if (p.includes('ultra')) { label = 'Ultra'; cls = 'ultra'; }
    else if (p.includes('pro')) { label = 'Pro'; cls = 'pro'; }
    else if (p.includes('business') || p.includes('team') || p.includes('enterprise')) { label = 'Business'; cls = 'biz'; }
    return '<span class="tag plan ' + cls + '">' + esc(label) + '</span>';
  }
  function acctAddedText(x) {
    if (!x.addedAt) return '';
    const t = rel(x.addedAt);
    return t ? '<span class="acctAdded" title="添加时间">' + esc(t) + '导入</span>' : '';
  }
  function acctOverageToggle(x) {
    if (isFreePlan(x)) return '';
    const on = x.usageBased === true;
    const label = on ? '超额开' : '超额关';
    const title = on ? '点击关闭超额' : '点击开启无限超额';
    return '<button class="acctOverage' + (on ? ' on' : '') + '" data-action="acctOverageToggle" data-id="' + attr(x.id) + '" data-mode="' + (on ? 'disabled' : 'unlimited') + '" title="' + attr(title) + '"><span></span>' + label + '</button>';
  }

  function currentBar() {
    const account = (state && state.account) || {};
    return '<div class="account">'
      + '<span class="avatar sm">' + esc((account.email || account.label || 'L').slice(0, 1).toUpperCase()) + '</span>'
      + '<b class="acctEmail" title="' + attr(account.email || account.label || '') + '">' + esc(account.email || account.label || '本地用户') + '</b>'
      + '<span class="tag' + (account.plan ? ' plan' : '') + '">' + esc(account.planLabel || account.plan || '本地模式') + '</span>'
      + (account.error ? '<span class="acctMini err" title="' + attr(account.error) + '">⚠</span>' : (account.usageShort ? '<span class="acctMini" title="' + attr(account.usageText || '') + '">' + esc(account.usageShort) + '</span>' : ''))
      + '<span class="topSpacer"></span>'
      + '<button class="acctRefresh" data-action="refreshAccount" title="刷新当前账号用量"' + (account.loading ? ' disabled' : '') + '>' + (account.loading ? '…' : '↻') + '</button>'
      + (currentAccountId() ? '<button class="acctBtn" data-action="acctSessions" data-id="' + attr(currentAccountId()) + '" title="查看当前账号登录设备">设备</button>' : '')
      + '<button class="acctBtn" data-action="openDashboard" title="打开 cursor.com/dashboard/spending">控制台</button>'
      + '</div>';
  }

  function accountCards() {
    const accts = (state && state.accounts) || [];
    if (!accts.length) return '<div class="acctEmpty">暂无账号。用上方三个按钮添加。</div>';
    return accts.map(function (x) {
      const isWeb = (x.tokenType === 'web' || x.noRefresh) && x.source !== 'currentLogin';
      return '<div class="acctCard compact' + (x.isCurrent ? ' cur' : '') + '">'
        + '<div class="acctMain">'
          + '<div class="acctLine1"><b title="' + attr(x.email || '') + '">' + esc(x.email || '(未知邮箱)') + '</b>'
            + acctPlanBadge(x)
            + (x.isCurrent ? '<span class="usingPill">使用中</span>' : '')
          + '</div>'
          + acctQuotaBox(x)
          + (isWeb ? '<div class="acctWarn">Web 令牌只读、无法续期，发消息可能弹登录框，建议改用「浏览器授权」</div>' : '')
        + '</div>'
        + '<div class="acctOps">'
          + acctOverageToggle(x)
          + '<div class="acctBtnRow">'
            + acctIconBtn('acctSessions', x.id, '◎', '登录设备 / 踢下线' + (x.sessionCount != null ? '（' + x.sessionCount + '）' : ''), '', false)
            + acctIconBtn('acctRefreshOne', x.id, '↻', '刷新该账号额度', '', false)
            + (x.noRefresh || x.tokenType === 'web' ? acctIconBtn('acctUpgradeToken', x.id, '↑', '升级为可续期账号', '', false) : acctIconBtn('acctRefreshToken', x.id, '⟳', '续期该账号令牌', '', false))
            + (x.isCurrent ? acctIconBtn('', x.id, '✓', '当前 Cursor 登录账号', 'ghost on', true) : acctIconBtn('acctSwitch', x.id, '⇄', '切换为 Cursor 全局登录', 'primary', false))
            + acctIconBtn('acctRemove', x.id, '✕', '从列表移除', 'danger', false)
          + '</div>'
        + '</div></div>';
    }).join('');
  }

  function sandCmdBlock(which, title, hint, cmd) {
    return '<div class="cmdBlock">'
      + '<div class="cmdHead"><b>' + esc(title) + '</b>'
      + '<button class="btn sm" data-action="sandCopy" data-which="' + attr(which) + '">复制</button></div>'
      + '<p class="dialogHint">' + esc(hint) + '</p>'
      + '<pre class="sandCmd">' + esc(cmd || '（还没有生成命令，先点一次刷新状态）') + '</pre>'
      + '</div>';
  }
  function dialogHtml() {
    if (!dialog) return '';
    if (dialog.type === 'confirmSandApply') {
      return '<div class="modal" data-action="cancelDialog"><div class="dialog" data-stop="1"><h3>注入 Sand</h3>'
        + '<p class="restartMsg">会改 Cursor 安装目录里的请求头 <code>x-cursor-client-type</code> 为 <code>sand</code>，先备份再写。写完必须完整退出再打开，Reload 不够。</p>'
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">取消</button><button class="btn primary" data-action="sandApplyConfirm">一键注入</button></div></div></div>';
    }
    if (dialog.type === 'confirmSandRestore') {
      return '<div class="modal" data-action="cancelDialog"><div class="dialog" data-stop="1"><h3>卸载 Sand</h3>'
        + '<p class="restartMsg">会 <code>restore --force</code>，并自动找独立插件备份目录 <code>leila-local.cursor-sand-router</code>。卸完必须完整退出再打开。也可复制命令到终端手动跑。</p>'
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">取消</button><button class="btn danger" data-action="sandRestoreConfirm">一键卸载</button></div></div></div>';
    }
    if (dialog.type === 'sandCmds') {
      const cmds = (state && state.sand && state.sand.commands) || {};
      return '<div class="modal" data-action="cancelDialog"><div class="dialog wide" data-stop="1"><h3>手动命令</h3>'
        + '<p class="dialogHint">和面板一键按钮做的是同一件事。复制后打开「终端」粘贴回车，跑完必须完整退出 Cursor 再打开（Reload 不够）。</p>'
        + sandCmdBlock('apply', '注入命令', '等价于「一键注入」。把 Cursor 请求头改成 sand，走 Bot 池。先备份再写。', cmds.apply)
        + sandCmdBlock('restore', '卸载命令', '等价于「一键卸载」。带 --force，并指向有备份的目录（含独立插件 leila-local.cursor-sand-router）。', cmds.restore)
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">关闭</button></div></div></div>';
    }
    if (dialog.type === 'confirmSwitch') {
      return '<div class="modal" data-action="cancelDialog"><div class="dialog" data-stop="1"><h3>切换账号</h3>'
        + '<p class="restartMsg">确定切换 Cursor 全局登录账号到 ' + esc(dialog.email || dialog.id || '') + ' 吗？会自动备份并替换登录态，完成后需要完整重启 Cursor。</p>'
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">取消</button><button class="btn primary" data-action="confirmAccountSwitch">切换账号</button></div></div></div>';
    }
    if (dialog.type === 'acctImport') {
      return '<div class="modal" data-action="cancelDialog"><div class="dialog wide" data-stop="1"><h3>Token 导入账号</h3>'
        + '<p class="dialogHint">粘贴 <code>userId::accessToken</code> 或 <code>WorkosCursorSessionToken=...</code>。带第三段 <code>refreshToken</code> 的可自动续期。</p>'
        + '<textarea id="acctImportText" rows="7" placeholder="userId::accessToken::refreshToken 或 WorkosCursorSessionToken=...">' + esc(dialog.draft || '') + '</textarea>'
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">取消</button><button class="btn primary" data-action="acctImportConfirm">导入账号</button></div></div></div>';
    }
    if (dialog.type === 'sessions') {
      const rows = dialog.sessions || [];
      const kick = dialog.confirmKick;
      const list = dialog.loading
        ? '<p class="dialogHint">正在读取登录设备…</p>'
        : (dialog.error ? '<p class="dialogHint err">' + esc(dialog.error) + '</p>' : '')
          + (rows.length ? rows.map(function (s) {
            return '<div class="sessRow">'
              + '<div><b>' + esc(s.typeLabel || s.type || '设备') + '</b>'
              + '<span>' + esc(s.createdAt ? (rel(s.createdAt) + '创建') : '') + '</span></div>'
              + '<button class="btn sm danger" data-action="acctRevokeAsk" data-sid="' + attr(s.sessionId) + '">踢下线</button>'
              + '</div>';
          }).join('') : (!dialog.error && !dialog.loading ? '<p class="dialogHint">当前没有登录设备</p>' : ''));
      const confirm = kick ? '<div class="kickWarn"><p>确定踢掉这台设备？踢下线最多约 10 分钟生效。'
        + (rows.length <= 1 ? ' 这可能是当前网页会话，踢掉后额度接口会失效，需重新导入。' : '')
        + '</p><div class="dialogActions"><button class="btn" data-action="acctRevokeCancel">取消</button>'
        + '<button class="btn danger" data-action="acctRevokeConfirm" data-sid="' + attr(kick) + '">确认踢下线</button></div></div>' : '';
      return '<div class="modal" data-action="cancelDialog"><div class="dialog wide" data-stop="1"><h3>登录设备</h3>'
        + '<p class="dialogHint">' + esc(dialog.email || '') + ' · ' + rows.length + ' 台</p>'
        + list + confirm
        + '<p class="dialogHint">对应 dashboard Settings → Active Sessions。踢下线后最多 10 分钟生效。</p>'
        + '<div class="dialogActions"><button class="btn" data-action="cancelDialog">关闭</button></div></div></div>';
    }
    return '';
  }

  function sandCard() {
    const s = (state && state.sand) || {};
    const on = !!s.patched && !s.error;
    const badge = s.error ? '异常' : (on ? '已注入' : ((s.sand || 0) > 0 ? '部分注入' : '未注入'));
    const badgeCls = s.error ? 'err' : (on ? 'on' : ((s.sand || 0) > 0 ? 'warn' : 'off'));
    const detail = s.error
      ? esc(s.error)
      : (on
        ? ('当前已注入：Cursor ' + esc(s.version || '?') + '，' + esc(s.sand || 0) + ' 处请求头都是 sand')
        : ((s.sand || 0) > 0
          ? ('部分注入：Cursor ' + esc(s.version || '?') + '，已改 ' + esc(s.sand || 0) + ' / 未改 ' + esc(s.unpatched || 0))
          : ('当前未注入：Cursor ' + esc(s.version || '?') + '，还有 ' + esc(s.unpatched || 0) + ' 处是 ide')));
    return '<div class="sandCard' + (on ? ' on' : '') + '">'
      + '<div class="sandHead"><h4>Sand 路由</h4><span class="sandBadge ' + badgeCls + '">' + badge + '</span></div>'
      + '<p class="sandHint">右上角徽章就是注入状态。平时点一键即可；要自己在终端跑，用「手动命令」。</p>'
      + '<div class="sandBtns">'
        + '<button class="btn primary" data-action="sandApplyAsk"' + (on ? ' disabled' : '') + '>一键注入</button>'
        + '<button class="btn danger" data-action="sandRestoreAsk">一键卸载</button>'
        + '<button class="btn" data-action="sandRefresh">刷新状态</button>'
      + '</div>'
      + '<div class="sandBtns">'
        + '<button class="btn sm" data-action="sandCmdsAsk">手动命令</button>'
      + '</div>'
      + '<div class="sandMeta">' + detail + '</div>'
      + '</div>';
  }
  function retryRestartHtml() {
    if (!retryRestart) return '';
    const restartTitle = (retryRestart.action === 'sandPatch') ? '需要完整重启' : '切换成功';
    return '<div class="modal restartModal" data-stop="1"><div class="dialog restartDialog" data-stop="1"><h3>' + restartTitle + '</h3>'
      + '<p class="restartMsg">' + esc(retryRestart.message || '需要重启 Cursor 才能生效。') + '</p>'
      + '<p class="dialogHint">立即重启不会弹出终端。也可以自己 ⌘Q 再点 Dock 打开。Reload Window 不够。</p>'
      + '<div class="dialogActions restartActions"><button class="btn" data-action="retryRestartLater">稍后自己退出</button><button class="btn primary" data-action="retryRestartNow">立即重启</button></div></div></div>';
  }

  function render() {
    if (!state) return;
    const accts = state.accounts || [];
    app.innerHTML = '<div class="app">'
      + '<div class="page">'
        + '<div class="acctAddRow">'
          + '<button class="btn primary acctAddBtn" data-action="acctDeepLogin">浏览器授权</button>'
          + '<button class="btn acctAddBtn" data-action="acctTokenDialog">Token 导入</button>'
          + '<button class="btn acctAddBtn" data-action="acctAddCurrent" title="读取本机 Cursor 当前登录态">导入本机</button>'
        + '</div>'
        + '<p class="acctAddHint">推荐「浏览器授权」，拿到可续期令牌。切换账号会写入 Cursor 登录态，完整重启一次即可生效。</p>'
        + sandCard()
        + '<div class="acctSecHead"><h4>账号列表</h4><span class="acctCount">' + accts.length + '</span>'
          + '<span class="ver">' + esc(state.version || '') + '</span></div>'
        + '<div class="acctList compact">' + accountCards() + '</div>'
      + '</div>'
      + dialogHtml()
      + retryRestartHtml()
      + (toast ? '<div class="toast">' + esc(toast) + '</div>' : '')
      + '</div>';
    bind();
  }

  function bind() {
    const acctImportText = document.getElementById('acctImportText');
    if (acctImportText) acctImportText.addEventListener('input', (e) => {
      if (dialog && dialog.type === 'acctImport') dialog.draft = String(e.target.value || '');
    });
    document.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', (e) => {
      const action = el.getAttribute('data-action');
      const stop = e.target.closest && e.target.closest('[data-stop]');
      if ((action === 'cancelDialog') && stop && e.target !== el) return;
      e.stopPropagation();
      handleAction(action, el);
    }));
  }

  function handleAction(action, el) {
    switch (action) {
      case 'refreshAccount': post('refreshAccount'); showToast('正在刷新当前用量...'); break;
      case 'openDashboard': post('openDashboard'); break;
      case 'acctTokenDialog': dialog = { type: 'acctImport', draft: '' }; render(); break;
      case 'acctImportConfirm': {
        const t = document.getElementById('acctImportText');
        const latest = t ? String(t.value || '').trim() : '';
        if (!latest) { showToast('请粘贴 token'); break; }
        post('accountAddToken', { token: latest });
        showToast('正在导入账号...');
        dialog = null;
        render();
      } break;
      case 'acctDeepLogin': post('accountDeepLogin', {}); showToast('即将打开浏览器登录 Cursor...'); break;
      case 'acctUpgradeToken': post('accountUpgradeToken', { id: el.getAttribute('data-id') }); showToast('即将打开浏览器升级该账号...'); break;
      case 'acctAddCurrent': post('accountAddCurrent', {}); showToast('正在读取本机 Cursor 登录态...'); break;
      case 'acctRefreshToken': post('accountRefreshToken', { id: el.getAttribute('data-id') }); showToast('正在续期该账号令牌...'); break;
      case 'acctSwitch': {
        const id = el.getAttribute('data-id');
        const acc = (state.accounts || []).find((x) => x.id === id) || {};
        dialog = { type: 'confirmSwitch', id, email: acc.email || '' };
        render();
      } break;
      case 'confirmAccountSwitch':
        if (dialog && dialog.type === 'confirmSwitch') {
          post('accountSwitch', { id: dialog.id, confirmed: true });
          showToast('正在切换账号...');
        }
        dialog = null;
        render();
        break;
      case 'acctRemove': post('accountRemove', { id: el.getAttribute('data-id') }); showToast('已移除账号'); break;
      case 'acctRefreshOne': post('accountRefreshOne', { id: el.getAttribute('data-id') }); showToast('正在联网刷新该账号...'); break;
      case 'acctSessions': {
        const id = el.getAttribute('data-id') || currentAccountId();
        const acc = (state.accounts || []).find((x) => x.id === id) || {};
        dialog = { type: 'sessions', accountId: id, email: acc.email || '', sessions: [], loading: true, error: '', confirmKick: '' };
        post('accountListSessions', { id });
        render();
      } break;
      case 'acctRevokeAsk':
        if (dialog && dialog.type === 'sessions') { dialog.confirmKick = el.getAttribute('data-sid') || ''; render(); }
        break;
      case 'acctRevokeCancel':
        if (dialog && dialog.type === 'sessions') { dialog.confirmKick = ''; render(); }
        break;
      case 'acctRevokeConfirm':
        if (dialog && dialog.type === 'sessions') {
          const sid = el.getAttribute('data-sid') || dialog.confirmKick || '';
          dialog.loading = true;
          dialog.confirmKick = '';
          post('accountRevokeSession', { id: dialog.accountId, sessionId: sid });
          showToast('正在踢下线...');
          render();
        }
        break;
      case 'sandApplyAsk': dialog = { type: 'confirmSandApply' }; render(); break;
      case 'sandApplyConfirm': dialog = null; post('sandApply'); showToast('正在注入 Sand...'); render(); break;
      case 'sandRestoreAsk': dialog = { type: 'confirmSandRestore' }; render(); break;
      case 'sandRestoreConfirm': dialog = null; post('sandRestore'); showToast('正在卸载 Sand...'); render(); break;
      case 'sandRefresh': post('sandRefresh'); showToast('正在读取 Sand 状态...'); break;
      case 'sandCmdsAsk': dialog = { type: 'sandCmds' }; render(); break;
      case 'sandCopy': {
        const which = el.getAttribute('data-which') || 'restore';
        const text = (state && state.sand && state.sand.commands && state.sand.commands[which]) || '';
        if (text) copyText(text);
        showToast(which === 'apply' ? '已复制注入命令' : '已复制卸载命令');
        post('sandCopyCommand', { which });
      } break;
      case 'acctOverageToggle': post('accountSetHardLimit', { id: el.getAttribute('data-id'), mode: el.getAttribute('data-mode') || 'unlimited' }); showToast(el.getAttribute('data-mode') === 'disabled' ? '正在关闭超额...' : '正在开启无限超额...'); break;
      case 'cancelDialog': dialog = null; render(); break;
      case 'retryRestartLater': retryRestart = null; render(); break;
      case 'retryRestartNow': { const cmd = retryRestart && retryRestart.restartCommand === 'restartCursor' ? 'restartCursor' : 'reloadWindow'; retryRestart = null; post(cmd); } break;
    }
  }

  function copyText(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text || '');
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch { }
  }
  function showToast(text) {
    toast = text;
    render();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; render(); }, 2200);
  }

  post('ready');
})();
