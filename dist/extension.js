"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const cdpBrowser_1 = require("./cdpBrowser");

const sandPatcher = require('./sandPatcher');
let provider;
let extensionContext;
let accountUsage = null;
let accountLoading = false;
let accountTokenRefreshTimer = null;
let currentCursorUserIdCache = '';
let currentCursorEmailCache = '';
let sqliteModuleCache;
let sandStatusBar;

const VIEW_ID = 'cursor-account-manager.sidePanel';
const CONTAINER_ID = 'cursor-account-manager';
const CMD_OPEN = 'cursor-account-manager.openPanel';
const CMD_SAND_APPLY = 'cursor-account-manager.sandApply';
const CMD_SAND_RESTORE = 'cursor-account-manager.sandRestore';
const ACCOUNTS_KEY = 'cursorAccountManager.accounts';
const ACCOUNTS_KEY_LEGACY = 'keepchat.accounts';
const CFG_SECTION = 'cursorAccountManager';
const CFG_LEGACY = 'keepchat';
const UA = 'Mozilla/5.0 (CursorAccountManager)';

function cfgGet(key) {
    const neu = vscode.workspace.getConfiguration(CFG_SECTION);
    const inspected = neu.inspect(key);
    if (inspected && (inspected.globalValue !== undefined || inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined))
        return neu.get(key);
    const legacy = vscode.workspace.getConfiguration(CFG_LEGACY).get(key);
    if (legacy !== undefined)
        return legacy;
    return neu.get(key);
}
async function cfgUpdate(key, value, target) {
    try { await vscode.workspace.getConfiguration(CFG_SECTION).update(key, value, target); } catch { }
    try { await vscode.workspace.getConfiguration(CFG_LEGACY).update(key, value, target); } catch { }
}

const CURSOR_AUTH_CACHE_KEYS = [
    'telemetry.currentSessionDate',
    'workbench.auxiliarybar.pinnedPanels',
    'notifications.perSourceDoNotDisturbMode',
    'vscode.typescript-language-features',
    'editorFontInfo',
    'workbench.auxiliarybar.placeholderPanels',
    'workbench.panel.placeholderPanels',
    'editorOverrideService.cache',
    'extensionsAssistant/recommendations',
    'cursorai/serverConfig',
    '__$__targetStorageMarker'
];
const CURSOR_AUTH_ALIAS_KEYS = [
    'workos.sessionToken',
    'cursor.accessToken',
    'cursor.email',
    'cursor.auth.token',
    'cursor.auth.userId',
    'cursor.auth.email',
    'cursor.auth.lastLogin',
    'cursor.auth.subscriptionType',
    'cursor.currentAccount',
    'cursor.lastAccountSwitch',
    'cursor.appliedByKeepChat',
    'cursor.appliedAt'
];

function now() { return new Date().toISOString(); }

function runElevated(cliPath, args) {
    if (process.platform === 'win32') return runElevatedWin32(cliPath, args);
    if (process.platform === 'darwin') return runElevatedDarwin(cliPath, args);
    return runElevatedLinux(cliPath, args);
}

function runElevatedWin32(cliPath, args) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const tmpOut = path.join(os.tmpdir(), 'cam_sand_' + process.pid + '.json');
        const tmpCmd = path.join(os.tmpdir(), 'cam_sand_' + process.pid + '.cmd');
        let nodePath;
        try {
            const { execSync } = require('child_process');
            nodePath = execSync('where node', { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0];
        } catch { nodePath = 'node'; }
        const cmdContent = `@echo off\r\n"${nodePath}" "${cliPath}" ${args.map(a => `"${a}"`).join(' ')} > "${tmpOut}" 2>&1\r\n`;
        fs.writeFileSync(tmpCmd, cmdContent);
        const ps = `Start-Process -FilePath '${tmpCmd.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
        execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true, timeout: 30000 }, (err) => {
            try { fs.unlinkSync(tmpCmd); } catch {}
            if (err) {
                try { fs.unlinkSync(tmpOut); } catch {}
                return reject(new Error('提权执行失败（用户可能取消了 UAC）: ' + (err.message || err)));
            }
            try {
                const out = fs.readFileSync(tmpOut, 'utf8').trim();
                fs.unlinkSync(tmpOut);
                if (!out) return resolve({ changed: true });
                return resolve(JSON.parse(out));
            } catch (e) {
                try {
                    const raw = fs.readFileSync(tmpOut, 'utf8').trim();
                    fs.unlinkSync(tmpOut);
                    if (raw.includes('error') || raw.includes('Error')) return reject(new Error(raw));
                } catch {}
                return resolve({ changed: true });
            }
        });
    });
}

function runElevatedDarwin(cliPath, args) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const tmpOut = path.join(os.tmpdir(), 'cam_sand_' + process.pid + '.json');
        let nodePath;
        try {
            const { execSync } = require('child_process');
            nodePath = execSync('which node', { encoding: 'utf8' }).trim();
        } catch { nodePath = '/usr/local/bin/node'; }
        const shellCmd = `"${nodePath}" "${cliPath}" ${args.map(a => `"${a}"`).join(' ')} > "${tmpOut}" 2>&1`;
        const escaped = shellCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const osa = `do shell script "${escaped}" with administrator privileges`;
        execFile('osascript', ['-e', osa], { timeout: 30000 }, (err) => {
            if (err) {
                try { fs.unlinkSync(tmpOut); } catch {}
                return reject(new Error('提权执行失败（用户可能取消了密码输入）: ' + (err.message || err)));
            }
            try {
                const out = fs.readFileSync(tmpOut, 'utf8').trim();
                fs.unlinkSync(tmpOut);
                if (!out) return resolve({ changed: true });
                return resolve(JSON.parse(out));
            } catch (e) {
                try {
                    const raw = fs.readFileSync(tmpOut, 'utf8').trim();
                    fs.unlinkSync(tmpOut);
                    if (raw.includes('error') || raw.includes('Error')) return reject(new Error(raw));
                } catch {}
                return resolve({ changed: true });
            }
        });
    });
}

function runElevatedLinux(cliPath, args) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const tmpOut = path.join(os.tmpdir(), 'cam_sand_' + process.pid + '.json');
        let nodePath;
        try {
            const { execSync } = require('child_process');
            nodePath = execSync('which node', { encoding: 'utf8' }).trim();
        } catch { nodePath = 'node'; }
        const shellCmd = `"${nodePath}" "${cliPath}" ${args.map(a => `"${a}"`).join(' ')} > "${tmpOut}" 2>&1`;
        execFile('pkexec', ['bash', '-c', shellCmd], { timeout: 30000 }, (err) => {
            if (err) {
                try { fs.unlinkSync(tmpOut); } catch {}
                return reject(new Error('提权执行失败: ' + (err.message || err)));
            }
            try {
                const out = fs.readFileSync(tmpOut, 'utf8').trim();
                fs.unlinkSync(tmpOut);
                if (!out) return resolve({ changed: true });
                return resolve(JSON.parse(out));
            } catch (e) {
                try {
                    const raw = fs.readFileSync(tmpOut, 'utf8').trim();
                    fs.unlinkSync(tmpOut);
                    if (raw.includes('error') || raw.includes('Error')) return reject(new Error(raw));
                } catch {}
                return resolve({ changed: true });
            }
        });
    });
}

function extensionVersion() {
    return String(extensionContext?.extension?.packageJSON?.version || 'unknown');
}

function cleanupLegacyKeepchatMcp() {
    const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json');
    try {
        if (fs.existsSync(mcpPath)) {
            const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
            if (cfg && cfg.mcpServers && cfg.mcpServers.keepchat) {
                delete cfg.mcpServers.keepchat;
                fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2));
            }
        }
    } catch { }
    try {
        const leftover = path.join(os.homedir(), '.cursor', 'keepchat', 'keepchat-mcp.cjs');
        if (fs.existsSync(leftover))
            fs.unlinkSync(leftover);
    } catch { }
}

function activate(context) {
    extensionContext = context;
    cleanupLegacyKeepchatMcp();
    provider = new AccountProvider(context.extensionUri);
    const openPanel = () => vscode.commands.executeCommand('workbench.view.extension.' + CONTAINER_ID);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand(CMD_OPEN, openPanel));
    context.subscriptions.push(vscode.commands.registerCommand('keepchat.openPanel', openPanel));
    const sandApply = async () => {
        try {
            const result = await applySandPatchFromUi();
            if (result && result.changed === false)
                vscode.window.showInformationMessage('账号管理：Sand 已经是注入状态');
            else
                promptSandRestart('apply');
        }
        catch (e) {
            vscode.window.showErrorMessage('账号管理：注入 Sand 失败 - ' + (e && e.message || e));
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand(CMD_SAND_APPLY, sandApply));
    context.subscriptions.push(vscode.commands.registerCommand('keepchat.sandApply', sandApply));
    const sandRestore = async () => {
        const ok = await vscode.window.showWarningMessage('确定卸载 Sand 补丁并还原 Cursor 原文件？需要完整退出再打开。', { modal: true }, '卸载');
        if (ok !== '卸载')
            return;
        try {
            await restoreSandPatchFromUi();
            promptSandRestart('restore');
        }
        catch (e) {
            vscode.window.showErrorMessage('账号管理：卸载 Sand 失败 - ' + (e && e.message || e));
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand(CMD_SAND_RESTORE, sandRestore));
    context.subscriptions.push(vscode.commands.registerCommand('keepchat.sandRestore', sandRestore));
    sandStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
    context.subscriptions.push(sandStatusBar);
    sandStatusBar.show();
    refreshSandStatusBar();
    if (accountUsageEnabled())
        setTimeout(() => { fetchCursorUsage().catch(() => { }); }, 2500);
    setTimeout(() => { importPendingTokenIfAny().catch(() => { }); }, 1800);
    setTimeout(() => { refreshCurrentUserId().catch(() => { }); }, 2600);
    setTimeout(() => { refreshAllAccountTokens().catch(() => { }); }, 30000);
    accountTokenRefreshTimer = setInterval(() => { refreshAllAccountTokens().catch(() => { }); }, 600000);
    context.subscriptions.push({ dispose: () => { try { clearInterval(accountTokenRefreshTimer); } catch { } } });
}

function deactivate() { }

function clientState() {
    return {
        account: buildAccount(0, 0, 0),
        accounts: accountsForClient(),
        version: extensionVersion(),
        sand: sandStatusForClient()
    };
}

class AccountProvider {
    constructor(extUri) {
        this.extUri = extUri;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.title = `账号管理 v${extensionVersion()}`;
        view.webview.options = { enableScripts: true, localResourceRoots: [this.extUri] };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage(async (msg) => this.handle(msg));
        this.postState();
    }
    postState() { const st = { type: 'state', state: clientState() }; this.view?.webview.postMessage(st); }
    post(payload) { this.view?.webview.postMessage(payload); }
    async handle(msg) {
        try {
            if (msg.type === 'ready') {
                this.postState();
                return;
            }
            if (msg.type === 'refreshAccount') {
                fetchCursorUsage();
            }
            if (msg.type === 'refreshAccounts') {
                refreshCurrentUserId();
                fetchCursorUsage();
            }
            if (msg.type === 'openDashboard') {
                vscode.env.openExternal(vscode.Uri.parse('https://cursor.com/dashboard/spending'));
            }
            if (msg.type === 'reloadWindow') {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            if (msg.type === 'restartCursor') {
                const rr = scheduleCursorRestart();
                if (!rr.ok)
                    vscode.window.showErrorMessage('账号管理：自动重启失败 - ' + (rr.error || '') + '。请完整退出并重新打开 Cursor。');
            }
            if (msg.type === 'accountAddCurrent') {
                const r = await addAccountFromCurrentLogin();
                if (r.ok) {
                    vscode.window.showInformationMessage('账号管理：已新增本机 Token 账号记录（未切换）');
                    fetchCursorUsage();
                }
                else
                    vscode.window.showErrorMessage('账号管理：导入失败 - ' + (r.error || ''));
                this.postState();
            }
            if (msg.type === 'accountAddToken') {
                const probe = parseCursorSessionInput(String(msg.token || ''));
                const hasRealRefresh = !!(probe.refreshToken && probe.refreshToken !== probe.accessToken);
                const isWebToken = !hasRealRefresh && probe.accessToken && tokenMetaOf(probe.accessToken).tokenType === 'web';
                if (isWebToken) {
                    const pick = await vscode.window.showWarningMessage('这是 web 网页令牌，切过去发消息可能弹登录框。可先「仅导入额度」看 Auto/Other/Bot；要可续期请用无痕浏览器注入换真令牌。', { modal: true }, '仅导入额度', '无痕浏览器注入');
                    if (pick === '无痕浏览器注入') {
                        const injUserId = normUserId(probe.userId) || normUserId(String((decodeJwtPayload(probe.accessToken) || {}).sub || '').replace(/^auth0\|/, ''));
                        const cookieValue = injUserId && probe.accessToken ? injUserId + '%3A%3A' + probe.accessToken : '';
                        const r = cookieValue ? await deepLoginViaInjectedBrowser(cookieValue) : await startCursorDeepLogin();
                        if (r.cancelled) {
                            this.postState();
                            return;
                        }
                        if (!r.ok || !r.accessToken || !r.refreshToken) {
                            vscode.window.showErrorMessage('账号管理：浏览器登录失败 - ' + (r.error || '未获取到令牌'));
                            this.postState();
                            return;
                        }
                        if (cookieValue) {
                            const loginUserId = normUserId(String((decodeJwtPayload(r.accessToken) || {}).sub || '').replace(/^auth0\|/, ''));
                            if (injUserId && loginUserId && loginUserId !== injUserId) {
                                vscode.window.showErrorMessage('账号管理：授权拿到的是另一个账号（…' + loginUserId.slice(-8) + '），未添加。请确认粘贴的 token 有效后重试。');
                                this.postState();
                                return;
                            }
                        }
                        const add = await addAccountFromDeepLogin(r.accessToken, r.refreshToken, r.authId || '');
                        if (add.ok)
                            vscode.window.showInformationMessage('账号管理：已通过浏览器登录添加可续期账号' + (add.duplicate ? '（已更新同账号令牌）' : ''));
                        else
                            vscode.window.showErrorMessage('账号管理：添加失败 - ' + (add.error || ''));
                        this.postState();
                        return;
                    }
                    if (pick !== '仅导入额度') {
                        this.postState();
                        return;
                    }
                }
                const r = await addAccountFromToken(String(msg.token || ''));
                if (r.ok) {
                    this.postState();
                    if (r.tokenType === 'web') {
                        vscode.window.showWarningMessage('账号管理：已记录该 web 令牌账号（只能本地读取用量；切过去发消息会报鉴权）。要正常使用请改用「浏览器授权」。');
                    }
                    else {
                        vscode.window.showInformationMessage(r.error ? '账号管理：已新增可续期 token 账号记录，但读取额度失败 - ' + r.error : '账号管理：已新增可续期 token 账号记录（未切换）');
                    }
                }
                else
                    vscode.window.showErrorMessage('账号管理：添加失败 - ' + (r.error || ''));
            }
            if (msg.type === 'accountDeepLogin') {
                const r = await startCursorDeepLogin();
                if (r.cancelled) {
                    this.postState();
                    return;
                }
                if (!r.ok || !r.accessToken || !r.refreshToken) {
                    vscode.window.showErrorMessage('账号管理：浏览器登录失败 - ' + (r.error || '未获取到令牌'));
                    this.postState();
                    return;
                }
                const add = await addAccountFromDeepLogin(r.accessToken, r.refreshToken, r.authId || '');
                if (add.ok)
                    vscode.window.showInformationMessage('账号管理：已通过浏览器登录添加可续期账号' + (add.duplicate ? '（已更新同账号令牌）' : '') + (add.error ? '，但读取额度失败 - ' + add.error : ''));
                else
                    vscode.window.showErrorMessage('账号管理：添加失败 - ' + (add.error || ''));
                this.postState();
            }
            if (msg.type === 'accountUpgradeToken') {
                const acc = getAccounts().find(a => a.id === msg.id);
                if (!acc) {
                    vscode.window.showErrorMessage('账号管理：未找到该账号');
                    this.postState();
                    return;
                }
                const targetUserId = normUserId(acc.userId);
                const blob = (acc.authBlob || {});
                let cookieValue = unquote(blob['cursorAuth/cachedWorkosSessionToken'] || blob['cursorAuth/workosCursorSessionToken'] || '');
                if (!cookieValue) {
                    const at = unquote(blob['cursorAuth/accessToken'] || '');
                    if (targetUserId && at)
                        cookieValue = targetUserId + '%3A%3A' + at;
                }
                if (!cookieValue) {
                    vscode.window.showErrorMessage('账号管理：该账号缺少会话令牌，无法升级');
                    this.postState();
                    return;
                }
                const ok = await vscode.window.showInformationMessage('将打开一个隔离浏览器并自动以 ' + (acc.email || '该账号') + ' 的身份登录 Cursor。\n若页面出现「Authorize」按钮，点一下即可；拿到可续期令牌后会替换这条账号。', { modal: true }, '开始升级');
                if (ok !== '开始升级') {
                    this.postState();
                    return;
                }
                const r = await deepLoginViaInjectedBrowser(cookieValue);
                if (r.cancelled) {
                    this.postState();
                    return;
                }
                if (!r.ok || !r.accessToken || !r.refreshToken) {
                    vscode.window.showErrorMessage('账号管理：升级授权失败 - ' + (r.error || '未获取到令牌'));
                    this.postState();
                    return;
                }
                const payload = decodeJwtPayload(r.accessToken) || {};
                const loginUserId = normUserId(String(payload.sub || '').replace(/^auth0\|/, ''));
                if (targetUserId && loginUserId && loginUserId !== targetUserId) {
                    vscode.window.showErrorMessage('账号管理：授权拿到的是另一个账号（…' + loginUserId.slice(-8) + '），未升级。请确认该账号 cookie 仍有效后重试。');
                    this.postState();
                    return;
                }
                const add = await addAccountFromDeepLogin(r.accessToken, r.refreshToken, r.authId || '');
                if (!add.ok) {
                    vscode.window.showErrorMessage('账号管理：升级失败 - ' + (add.error || ''));
                    this.postState();
                    return;
                }
                const list = getAccounts();
                const upId = loginUserId || targetUserId;
                const up = list.find(a => normUserId(a.userId) === upId) || list.find(a => a.id === acc.id);
                if (up) {
                    up.source = 'upgraded';
                    await saveAccounts(list);
                }
                vscode.window.showInformationMessage('账号管理：已升级为可续期账号' + (add.error ? '，但读取额度失败 - ' + add.error : ''));
                this.postState();
            }
            if (msg.type === 'accountRefreshToken') {
                const r = await accountRefreshToken(String(msg.id || ''));
                if (r.ok)
                    vscode.window.showInformationMessage('账号管理：账号令牌已续期');
                else
                    vscode.window.showWarningMessage('账号管理：续期失败 - ' + (r.error || ''));
                this.postState();
            }
            if (msg.type === 'accountRemove') {
                await removeAccount(String(msg.id || ''));
                this.postState();
            }
            if (msg.type === 'accountRefreshOne') {
                const r = await refreshAccountInfo(String(msg.id || ''));
                if (!r.ok)
                    vscode.window.showWarningMessage('账号管理：刷新账号失败 - ' + (r.error || ''));
                else if (r.error)
                    vscode.window.showWarningMessage('账号管理：账号已刷新，但联网读取失败 - ' + r.error);
                this.postState();
            }
            if (msg.type === 'accountSwitch') {
                if (msg.confirmed === true) {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在切换 Cursor 账号...', cancellable: false }, async (progress) => {
                        progress.report({ message: '写入登录态' });
                        const r = await switchCursorAccount(String(msg.id || ''));
                        if (r.ok) {
                            await refreshCurrentUserId();
                            fetchCursorUsage();
                            this.postState();
                            const swAcc = getAccounts().find(a => a.id === msg.id);
                            const webWarn = (swAcc && (swAcc.tokenType === 'web' || swAcc.noRefresh === true)) ? ' 注意：该账号为 web token，无法自动续期，Cursor 可能稍后提示重新登录，建议用「浏览器授权」重新添加。' : '';
                            this.post({
                                type: 'retryNeedsRestart',
                                message: '账号登录态已写入，完整重启一次 Cursor 即可生效。' + webWarn,
                                action: 'accountSwitch',
                                restartCommand: 'restartCursor'
                            });
                        }
                        else
                            vscode.window.showErrorMessage('账号管理：切换失败 - ' + (r.error || ''));
                    });
                    return;
                }
                const acc = getAccounts().find(a => a.id === msg.id);
                const ok = await vscode.window.showWarningMessage('确定切换 Cursor 全局登录账号到 ' + (acc && acc.email || msg.id) + ' 吗？\n这会纯净替换 Cursor 登录态（state.vscdb + storage.json，已自动备份）。写入成功后需完整重启一次 Cursor 才会生效。', { modal: true }, '切换账号');
                if (ok === '切换账号') {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在切换 Cursor 账号…', cancellable: false }, async (progress) => {
                        progress.report({ message: '写入登录态并校验' });
                        const r = await switchCursorAccount(String(msg.id || ''));
                        if (r.ok) {
                            await refreshCurrentUserId();
                            fetchCursorUsage();
                            this.postState();
                            const swAcc2 = getAccounts().find(a => a.id === msg.id);
                            const webWarn2 = (swAcc2 && (swAcc2.tokenType === 'web' || swAcc2.noRefresh === true)) ? ' 注意：该账号为 web token，无法自动续期，Cursor 可能稍后提示重新登录，建议用「浏览器授权」重新添加。' : '';
                            this.post({
                                type: 'retryNeedsRestart',
                                message: '账号登录态已写入，完整重启一次 Cursor 即可生效。' + webWarn2,
                                action: 'accountSwitch',
                                restartCommand: 'restartCursor'
                            });
                        }
                        else
                            vscode.window.showErrorMessage('账号管理：切换失败 - ' + (r.error || '') + '（已备份 state.vscdb，可手动恢复 .bak）');
                    });
                }
            }
            if (msg.type === 'accountSetHardLimit') {
                const mode = String(msg.mode || 'fixed');
                const limit = mode === 'fixed' ? 10000 : (typeof msg.hardLimit === 'number' ? msg.hardLimit : undefined);
                const r = await setHardLimitForAccount(String(msg.id || ''), mode, limit);
                if (r.ok) {
                    vscode.window.showInformationMessage('账号管理：该账号超额设置已提交');
                    this.postState();
                }
                else
                    vscode.window.showErrorMessage('账号管理：超额设置失败 - ' + (r.error || ''));
            }
            if (msg.type === 'accountListSessions') {
                const r = await listAccountSessions(String(msg.id || ''));
                this.post({ type: 'sessions', accountId: String(msg.id || ''), email: r.email || '', sessions: r.sessions || [], error: r.ok ? '' : (r.error || '读取设备失败') });
            }
            if (msg.type === 'accountRevokeSession') {
                const r = await revokeAccountSession(String(msg.id || ''), String(msg.sessionId || ''));
                if (!r.ok)
                    this.post({ type: 'sessions', accountId: String(msg.id || ''), email: '', sessions: [], error: r.error || '踢下线失败' });
                else {
                    const listed = await listAccountSessions(String(msg.id || ''));
                    this.post({ type: 'sessions', accountId: String(msg.id || ''), email: listed.email || '', sessions: listed.sessions || [], error: listed.ok ? '' : (listed.error || ''), toast: '已提交踢下线，最多约 10 分钟生效' });
                    this.postState();
                }
            }
            if (msg.type === 'sandRefresh') {
                refreshSandStatusBar();
                this.postState();
            }
            if (msg.type === 'sandApply') {
                try {
                    const result = await applySandPatchFromUi();
                    if (result && result.changed === false)
                        this.post({ type: 'toast', text: 'Sand 已经是注入状态' });
                    else
                        promptSandRestart('apply');
                }
                catch (e) {
                    vscode.window.showErrorMessage('账号管理：注入 Sand 失败 - ' + (e && e.message || e));
                }
                this.postState();
            }
            if (msg.type === 'sandRestore') {
                try {
                    await restoreSandPatchFromUi();
                    promptSandRestart('restore');
                }
                catch (e) {
                    vscode.window.showErrorMessage('账号管理：卸载 Sand 失败 - ' + (e && e.message || e));
                }
                this.postState();
            }
            if (msg.type === 'sandCopyCommand') {
                try {
                    const cmds = sandManualCommands();
                    const which = String(msg.which || 'restore');
                    const text = cmds[which] || cmds.restore || '';
                    if (!text)
                        throw new Error('没有可复制的命令');
                    await vscode.env.clipboard.writeText(text);
                    this.post({ type: 'toast', text: '已复制' + (which === 'apply' ? '注入' : '卸载') + '命令' });
                }
                catch (e) {
                    this.post({ type: 'toast', text: '复制失败：' + (e && e.message || e) });
                }
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(e.message || String(e));
        }
    }
    html(webview) {
        const nonce = Math.random().toString(36).slice(2);
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri, 'media', 'webview.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extUri, 'media', 'webview.js'));
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} data:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}' ${webview.cspSource}`
        ].join('; ');
        return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>账号管理</title></head><body><div id="app"></div><script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function accountUsageEnabled() { return cfgGet('accountUsageEnabled') !== false; }
function cursorGlobalStorageDir() {
    try {
        if (extensionContext?.globalStorageUri?.fsPath)
            return path.dirname(extensionContext.globalStorageUri.fsPath);
    }
    catch { }
    const home = os.homedir();
    if (process.platform === 'win32')
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage');
    if (process.platform === 'darwin')
        return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
    return path.join(home, '.config', 'Cursor', 'User', 'globalStorage');
}
function findCursorExecutable() {
    if (process.platform === 'win32') {
        const roots = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Cursor', 'Cursor.exe'),
            path.join(process.env.ProgramFiles || '', 'Cursor', 'Cursor.exe'),
            path.join(process.env['ProgramFiles(x86)'] || '', 'Cursor', 'Cursor.exe')
        ];
        return roots.find(p => p && fs.existsSync(p)) || 'Cursor.exe';
    }
    if (process.platform === 'darwin')
        return '/Applications/Cursor.app';
    return 'cursor';
}
function scheduleCursorRestart() {
    try {
        if (process.platform === 'darwin') {
            (0, child_process_1.spawn)('osascript', ['-e', 'tell application "Cursor" to quit', '-e', 'delay 2', '-e', 'tell application "Cursor" to activate'], { detached: true, stdio: 'ignore' }).unref();
            return { ok: true };
        }
        if (process.platform === 'win32') {
            const exe = findCursorExecutable();
            const ps = 'Start-Sleep -Seconds 2; Stop-Process -Name Cursor -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Start-Process -FilePath ' + JSON.stringify(exe);
            (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
            return { ok: true };
        }
        const exe = findCursorExecutable();
        (0, child_process_1.spawn)('/bin/sh', ['-c', 'sleep 2; pkill -x cursor || pkill -f cursor || true; sleep 1; nohup ' + JSON.stringify(exe) + ' >/dev/null 2>&1 &'], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
function loadCursorSqlite() {
    if (sqliteModuleCache !== undefined)
        return sqliteModuleCache;
    sqliteModuleCache = null;
    const roots = [];
    try {
        if (vscode.env.appRoot)
            roots.push(vscode.env.appRoot);
    }
    catch { }
    try {
        roots.push(path.join(path.dirname(process.execPath), 'resources', 'app'));
    }
    catch { }
    const rels = [
        ['node_modules', '@vscode', 'sqlite3'],
        ['node_modules.asar.unpacked', '@vscode', 'sqlite3'],
        ['node_modules', 'better-sqlite3'],
        ['node_modules.asar.unpacked', 'better-sqlite3'],
        ['node_modules', 'sqlite3'],
        ['node_modules', 'vscode-sqlite3']
    ];
    for (const root of roots) {
        for (const rel of rels) {
            const p = path.join(root, ...rel);
            try {
                if (!fs.existsSync(p))
                    continue;
                const mod = require(p);
                sqliteModuleCache = { mod, kind: rel.includes('better-sqlite3') ? 'better' : 'sqlite3' };
                return sqliteModuleCache;
            }
            catch { }
        }
    }
    return sqliteModuleCache;
}
async function querySqliteItemTable(dbPath, keys) {
    const loaded = loadCursorSqlite();
    if (!loaded)
        return null;
    try {
        if (loaded.kind === 'better') {
            const Database = (loaded.mod.default || loaded.mod);
            const db = new Database(dbPath, { readonly: true, fileMustExist: true });
            try {
                const stmt = db.prepare('SELECT key, value FROM ItemTable WHERE key = ?');
                const out = {};
                for (const k of keys) {
                    const r = stmt.get(k);
                    if (r && r.value != null)
                        out[k] = Buffer.isBuffer(r.value) ? r.value.toString('utf8') : String(r.value);
                }
                return out;
            }
            finally {
                try {
                    db.close();
                }
                catch { }
            }
        }
        const sqlite3 = (loaded.mod.verbose ? loaded.mod.verbose() : loaded.mod);
        const Database = sqlite3.Database || (sqlite3.default && sqlite3.default.Database);
        if (!Database)
            return null;
        const READONLY = sqlite3.OPEN_READONLY != null ? sqlite3.OPEN_READONLY : 1;
        return await new Promise(resolve => {
            const db = new Database(dbPath, READONLY, (err) => { if (err)
                resolve(null); });
            const placeholders = keys.map(() => '?').join(',');
            db.all(`SELECT key, value FROM ItemTable WHERE key IN (${placeholders})`, keys, (err, rows) => {
                const out = {};
                if (!err && Array.isArray(rows))
                    for (const r of rows) {
                        if (r && r.value != null)
                            out[r.key] = Buffer.isBuffer(r.value) ? r.value.toString('utf8') : String(r.value);
                    }
                try {
                    db.close();
                }
                catch { }
                resolve(err ? null : out);
            });
        });
    }
    catch {
        return null;
    }
}
async function querySqliteLike(dbPath, pattern) {
    const loaded = loadCursorSqlite();
    if (!loaded)
        return null;
    try {
        if (loaded.kind === 'better') {
            const Database = (loaded.mod.default || loaded.mod);
            const db = new Database(dbPath, { readonly: true, fileMustExist: true });
            try {
                const rows = db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?').all(pattern);
                const out = {};
                for (const r of rows) {
                    if (r && r.value != null)
                        out[r.key] = Buffer.isBuffer(r.value) ? r.value.toString('utf8') : String(r.value);
                }
                return out;
            }
            finally {
                try {
                    db.close();
                }
                catch { }
            }
        }
        const sqlite3 = (loaded.mod.verbose ? loaded.mod.verbose() : loaded.mod);
        const Database = sqlite3.Database || (sqlite3.default && sqlite3.default.Database);
        if (!Database)
            return null;
        const READONLY = sqlite3.OPEN_READONLY != null ? sqlite3.OPEN_READONLY : 1;
        return await new Promise(resolve => {
            const db = new Database(dbPath, READONLY, (e) => { if (e)
                resolve(null); });
            db.all('SELECT key, value FROM ItemTable WHERE key LIKE ?', [pattern], (err, rows) => {
                const out = {};
                if (!err && Array.isArray(rows))
                    for (const r of rows) {
                        if (r && r.value != null)
                            out[r.key] = Buffer.isBuffer(r.value) ? r.value.toString('utf8') : String(r.value);
                    }
                try {
                    db.close();
                }
                catch { }
                resolve(err ? null : out);
            });
        });
    }
    catch {
        return null;
    }
}
async function deleteSqliteKeysLike(dbPath, pattern) {
    const loaded = loadCursorSqlite();
    if (!loaded)
        return { ok: false, error: '未找到可用的 sqlite 模块' };
    try {
        if (loaded.kind === 'better') {
            const Database = (loaded.mod.default || loaded.mod);
            const db = new Database(dbPath, { fileMustExist: true });
            try {
                try {
                    db.pragma('busy_timeout = 45000');
                }
                catch { }
                db.prepare('DELETE FROM ItemTable WHERE key LIKE ?').run(pattern);
                return { ok: true };
            }
            finally {
                try {
                    db.close();
                }
                catch { }
            }
        }
        const sqlite3 = (loaded.mod.verbose ? loaded.mod.verbose() : loaded.mod);
        const Database = sqlite3.Database || (sqlite3.default && sqlite3.default.Database);
        if (!Database)
            return { ok: false, error: 'sqlite3 模块异常' };
        const READWRITE = sqlite3.OPEN_READWRITE != null ? sqlite3.OPEN_READWRITE : 2;
        return await new Promise(resolve => {
            const db = new Database(dbPath, READWRITE, (e) => { if (e)
                resolve({ ok: false, error: String(e.message || e) }); });
            db.serialize(() => {
                db.run('PRAGMA busy_timeout = 45000');
                db.run('DELETE FROM ItemTable WHERE key LIKE ?', [pattern], (err) => {
                    try {
                        db.close();
                    }
                    catch { }
                    resolve(err ? { ok: false, error: String(err.message || err) } : { ok: true });
                });
            });
        });
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
async function deleteCursorLoginKeys(dbPath) {
    const loaded = loadCursorSqlite();
    if (!loaded)
        return { ok: false, error: '未找到可用的 sqlite 模块' };
    try {
        if (loaded.kind === 'better') {
            const Database = (loaded.mod.default || loaded.mod);
            const db = new Database(dbPath, { fileMustExist: true });
            try {
                try {
                    db.pragma('busy_timeout = 45000');
                }
                catch { }
                db.prepare("DELETE FROM ItemTable WHERE key LIKE 'cursorAuth/%' OR key LIKE 'cursor.%'").run();
                const delKey = db.prepare('DELETE FROM ItemTable WHERE key = ?');
                for (const key of CURSOR_AUTH_CACHE_KEYS.concat(CURSOR_AUTH_ALIAS_KEYS))
                    delKey.run(key);
                return { ok: true };
            }
            finally {
                try {
                    db.close();
                }
                catch { }
            }
        }
        const sqlite3 = (loaded.mod.verbose ? loaded.mod.verbose() : loaded.mod);
        const Database = sqlite3.Database || (sqlite3.default && sqlite3.default.Database);
        if (!Database)
            return { ok: false, error: 'sqlite3 模块异常' };
        const READWRITE = sqlite3.OPEN_READWRITE != null ? sqlite3.OPEN_READWRITE : 2;
        return await new Promise(resolve => {
            const db = new Database(dbPath, READWRITE, (e) => { if (e)
                resolve({ ok: false, error: String(e.message || e) }); });
            db.serialize(() => {
                db.run('PRAGMA busy_timeout = 45000');
                db.run("DELETE FROM ItemTable WHERE key LIKE 'cursorAuth/%' OR key LIKE 'cursor.%'", [], (err) => {
                    if (err) {
                        try {
                            db.close();
                        }
                        catch { }
                        ;
                        resolve({ ok: false, error: String(err.message || err) });
                        return;
                    }
                    const stmt = db.prepare('DELETE FROM ItemTable WHERE key = ?');
                    let err0 = null;
                    for (const key of CURSOR_AUTH_CACHE_KEYS.concat(CURSOR_AUTH_ALIAS_KEYS))
                        stmt.run(key, (e) => { if (e && !err0)
                            err0 = e; });
                    stmt.finalize((e) => {
                        if (e && !err0)
                            err0 = e;
                        try {
                            db.close();
                        }
                        catch { }
                        resolve(err0 ? { ok: false, error: String(err0.message || err0) } : { ok: true });
                    });
                });
            });
        });
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
function syncStorageJsonAuth(dir, blob) {
    const p = path.join(dir, 'storage.json');
    try {
        let obj = {};
        if (fs.existsSync(p))
            obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const k of Object.keys(obj)) {
            if (CURSOR_AUTH_CACHE_KEYS.includes(k) || CURSOR_AUTH_ALIAS_KEYS.includes(k))
                delete obj[k];
        }
        const entries = buildCursorAuthWriteEntries(blob);
        for (const k of Object.keys(entries))
            obj[k] = entries[k];
        fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
function buildCursorAuthWriteEntries(blob) {
    const out = {};
    const accessToken = unquote(blob['cursorAuth/accessToken'] || '');
    const refreshToken = unquote(blob['cursorAuth/refreshToken'] || '');
    const userId = normUserId(blob['cursorAuth/userId'] || blob['cursorAuth/cachedUserId'] || '');
    const email = normEmail(blob['cursorAuth/cachedEmail'] || blob['cursorAuth/email'] || '');
    const plan = unquote(blob['cursorAuth/stripeMembershipType'] || '');
    const subscriptionStatus = unquote(blob['cursorAuth/stripeSubscriptionStatus'] || '');
    const signUpType = unquote(blob['cursorAuth/cachedSignUpType'] || '');
    if (accessToken) {
        out['cursorAuth/accessToken'] = accessToken;
        out['cursor.accessToken'] = accessToken;
    }
    if (refreshToken)
        out['cursorAuth/refreshToken'] = refreshToken;
    if (userId) {
        out['cursorAuth/authId'] = userId;
        out['cursorAuth/cachedUserId'] = userId;
        out['cursorAuth/userId'] = userId;
    }
    out['cursorAuth/isAuthenticated'] = 'true';
    out['cursorAuth/isAuthorized'] = 'true';
    out['cursorAuth/isLoggedIn'] = 'true';
    if (email) {
        out['cursorAuth/cachedEmail'] = email;
        out['cursorAuth/email'] = email;
        out['cursor.email'] = email;
        if (userId)
            out['cursorAuth/user'] = JSON.stringify({ email, id: userId, sub: userId });
    }
    if (plan)
        out['cursorAuth/stripeMembershipType'] = plan;
    if (subscriptionStatus)
        out['cursorAuth/stripeSubscriptionStatus'] = subscriptionStatus;
    if (signUpType)
        out['cursorAuth/cachedSignUpType'] = signUpType;
    return out;
}
function expandCursorAuthEntries(blob) {
    const out = { ...blob };
    const userId = normUserId(blob['cursorAuth/userId'] || blob['cursorAuth/cachedUserId'] || '');
    const accessToken = unquote(blob['cursorAuth/accessToken'] || '');
    const email = normEmail(blob['cursorAuth/cachedEmail'] || blob['cursorAuth/email'] || '');
    const plan = unquote(blob['cursorAuth/stripeMembershipType'] || '');
    const nowIso = new Date().toISOString();
    const rawSession = userId && accessToken ? (userId + '::' + accessToken) : unquote(blob['cursorAuth/workosCursorSessionToken'] || '');
    const encodedSession = userId && accessToken ? (userId + '%3A%3A' + accessToken) : (blob['cursorAuth/workosCursorSessionToken'] || '');
    if (accessToken) {
        out['cursorAuth/accessToken'] = accessToken;
        out['cursor.accessToken'] = accessToken;
    }
    if (userId) {
        out['cursorAuth/userId'] = userId;
        out['cursorAuth/cachedUserId'] = userId;
        out['cursor.auth.userId'] = userId;
    }
    if (email) {
        out['cursorAuth/cachedEmail'] = email;
        out['cursorAuth/email'] = email;
        out['cursorAuth/user'] = JSON.stringify({ email, id: userId, sub: userId });
        out['cursor.email'] = email;
        out['cursor.auth.email'] = email;
        out['cursor.currentAccount'] = email;
    }
    if (rawSession) {
        out['workos.sessionToken'] = rawSession;
        out['cursor.auth.token'] = rawSession;
    }
    if (encodedSession) {
        out['cursorAuth/workosCursorSessionToken'] = encodedSession;
        out['cursorAuth/cachedWorkosSessionToken'] = encodedSession;
    }
    out['cursor.auth.lastLogin'] = nowIso;
    if (plan)
        out['cursor.auth.subscriptionType'] = plan;
    out['cursor.lastAccountSwitch'] = nowIso;
    out['cursor.appliedByKeepChat'] = 'true';
    out['cursor.appliedAt'] = nowIso;
    return out;
}
function backupCursorStateDb(dbPath) {
    try {
        const stat = fs.statSync(dbPath);
        if (stat.size > 512 * 1024 * 1024)
            return { ok: true, skipped: true };
        fs.copyFileSync(dbPath, dbPath + '.cursor-account-manager-' + Date.now() + '.bak');
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
async function writeSqliteItemTable(dbPath, entries) {
    const loaded = loadCursorSqlite();
    if (!loaded)
        return { ok: false, error: '未找到可用的 sqlite 模块（无法写入 Cursor 登录态）' };
    const keys = Object.keys(entries);
    if (!keys.length)
        return { ok: false, error: '无可写入的键' };
    try {
        if (loaded.kind === 'better') {
            const Database = (loaded.mod.default || loaded.mod);
            const db = new Database(dbPath, { fileMustExist: true });
            try {
                try {
                    db.pragma('busy_timeout = 45000');
                }
                catch { }
                const stmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
                const tx = db.transaction((es) => { for (const k of Object.keys(es))
                    stmt.run(k, es[k]); });
                tx(entries);
                const read = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
                const mismatches = [];
                for (const k of keys) {
                    const got = read.get(k);
                    const raw = got && got.value != null ? got.value : '';
                    const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
                    if (value !== String(entries[k]))
                        mismatches.push(k + ':len(' + value.length + '/' + String(entries[k]).length + ')');
                }
                if (mismatches.length)
                    return { ok: false, error: 'readback failed after writing Cursor auth: ' + mismatches.join(', ') + '. Please fully quit Cursor and retry.' };
                return { ok: true };
            }
            finally {
                try {
                    db.close();
                }
                catch { }
            }
        }
        const sqlite3 = (loaded.mod.verbose ? loaded.mod.verbose() : loaded.mod);
        const Database = sqlite3.Database || (sqlite3.default && sqlite3.default.Database);
        if (!Database)
            return { ok: false, error: 'sqlite3 模块异常' };
        const READWRITE = sqlite3.OPEN_READWRITE != null ? sqlite3.OPEN_READWRITE : 2;
        return await new Promise(resolve => {
            const db = new Database(dbPath, READWRITE, (e) => { if (e)
                resolve({ ok: false, error: String(e.message || e) }); });
            db.serialize(() => {
                db.run('PRAGMA busy_timeout = 45000');
                const stmt = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
                let err0 = null;
                for (const k of keys)
                    stmt.run(k, entries[k], (e) => { if (e && !err0)
                        err0 = e; });
                stmt.finalize((e) => {
                    if (e && !err0)
                        err0 = e;
                    if (err0) {
                        try {
                            db.close();
                        }
                        catch { }
                        ;
                        resolve({ ok: false, error: String(err0.message || err0) });
                        return;
                    }
                    const mismatches = [];
                    let left = keys.length;
                    for (const k of keys) {
                        db.get('SELECT value FROM ItemTable WHERE key = ?', [k], (err, row) => {
                            if (err)
                                mismatches.push(k + ':select-err');
                            else {
                                const raw = row && row.value != null ? row.value : '';
                                const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
                                if (value !== String(entries[k]))
                                    mismatches.push(k + ':len(' + value.length + '/' + String(entries[k]).length + ')');
                            }
                            left--;
                            if (left === 0) {
                                try {
                                    db.close();
                                }
                                catch { }
                                resolve(mismatches.length ? { ok: false, error: 'readback failed after writing Cursor auth: ' + mismatches.join(', ') + '. Please fully quit Cursor and retry.' } : { ok: true });
                            }
                        });
                    }
                });
            });
        });
    }
    catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}
function isSqliteBusyError(error) {
    return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|locked|EBUSY|unable to open database file/i.test(String(error || ''));
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function writeSqliteItemTableWithRetry(dbPath, entries) {
    const delays = [0, 300, 600, 1200, 2400, 4000];
    let last = { ok: false, error: '' };
    for (const ms of delays) {
        if (ms)
            await delay(ms);
        last = await writeSqliteItemTable(dbPath, entries);
        if (last.ok)
            return last;
        if (!isSqliteBusyError(last.error))
            return last;
    }
    return { ok: false, error: (last.error || 'write failed') + ' (retried; please fully quit Cursor and retry)' };
}
function readCursorAuthFromStorageJson(dir) {
    try {
        const obj = JSON.parse(fs.readFileSync(path.join(dir, 'storage.json'), 'utf8'));
        const accessToken = String(obj['cursorAuth/accessToken'] || '').trim();
        if (!accessToken)
            return null;
        let email = String(obj['cursorAuth/cachedEmail'] || '').trim();
        if (!email) {
            try {
                email = JSON.parse(obj['cursorAuth/user'] || '{}').email || '';
            }
            catch { }
        }
        return { accessToken, userId: String(obj['cursorAuth/userId'] || '').trim(), email };
    }
    catch {
        return null;
    }
}
async function readCursorAuthFromVscdb(dir) {
    const dbPath = path.join(dir, 'state.vscdb');
    if (!fs.existsSync(dbPath))
        return null;
    const rows = await querySqliteLike(dbPath, 'cursorAuth/%');
    if (!rows)
        return null;
    const accessToken = unquote(rows['cursorAuth/accessToken'] || '').trim();
    if (!accessToken)
        return null;
    let email = normEmail(rows['cursorAuth/cachedEmail'] || rows['cursorAuth/email'] || '');
    if (!email) {
        try {
            email = normEmail(JSON.parse(rows['cursorAuth/user'] || '{}').email || '');
        }
        catch { }
    }
    const userId = normUserId(rows['cursorAuth/userId'] || rows['cursorAuth/cachedUserId'] || '');
    return { accessToken, userId, email };
}
async function readCursorAuth() {
    const manual = String(cfgGet('manualCursorToken') || '').trim();
    if (manual) {
        let userId = '', accessToken = manual;
        const sep = manual.includes('::') ? '::' : (manual.includes('%3A%3A') ? '%3A%3A' : '');
        if (sep) {
            const i = manual.indexOf(sep);
            userId = manual.slice(0, i);
            accessToken = manual.slice(i + sep.length);
        }
        if (accessToken.trim())
            return { accessToken: accessToken.trim(), userId: userId.trim(), email: '' };
    }
    const dir = cursorGlobalStorageDir();
    try {
        const a = await readCursorAuthFromVscdb(dir);
        if (a)
            return a;
    }
    catch { }
    return readCursorAuthFromStorageJson(dir);
}
function cursorApi(method, pathname, cookie, body, timeoutMs = 8000) {
    return new Promise(resolve => {
        try {
            const data = body != null ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : null;
            const headers = {
                Cookie: cookie,
                'User-Agent': UA,
                Accept: 'application/json',
                Origin: 'https://cursor.com',
                Referer: 'https://cursor.com/dashboard'
            };
            if (data) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = String(data.length);
            }
            const req = https.request({ hostname: 'cursor.com', path: pathname, method, headers }, res => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', c => { raw += c; if (raw.length > 2000000)
                    req.destroy(); });
                res.on('end', () => { let json = null; try {
                    json = JSON.parse(raw);
                }
                catch { } resolve({ status: res.statusCode || 0, json, raw }); });
            });
            req.on('error', () => resolve({ status: 0, json: null, raw: '' }));
            req.setTimeout(timeoutMs, () => { try {
                req.destroy();
            }
            catch { } resolve({ status: -1, json: null, raw: '' }); });
            if (data)
                req.write(data);
            req.end();
        }
        catch {
            resolve({ status: 0, json: null, raw: '' });
        }
    });
}
function buildCookie(auth) {
    return 'WorkosCursorSessionToken=' + encodeURIComponent(auth.userId) + '%3A%3A' + auth.accessToken;
}
function parseCursorSessionInput(input) {
    let raw = String(input || '').trim();
    if (!raw)
        return { userId: '', accessToken: '', refreshToken: '', rawSession: '' };
    const cookieMatch = /(?:^|[;\s])WorkosCursorSessionToken=([^;\s]+)/i.exec(raw);
    if (cookieMatch)
        raw = cookieMatch[1].trim();
    raw = raw.replace(/^["']|["']$/g, '').trim();
    try {
        raw = decodeURIComponent(raw);
    }
    catch { }
    raw = raw.replace(/%3A%3A/gi, '::');
    // 支持 userId::accessToken::refreshToken（带真 refreshToken 的可续期账号），也兼容旧的 userId::accessToken 和纯 token。
    const segs = raw.split('::').map(s => s.trim());
    let userId = '', accessToken = raw, refreshToken = '';
    if (segs.length >= 3) {
        userId = segs[0];
        accessToken = segs[1];
        refreshToken = segs.slice(2).join('::').trim();
    }
    else if (segs.length === 2) {
        userId = segs[0];
        accessToken = segs[1];
    }
    return { userId: normUserId(userId), accessToken: accessToken.trim(), refreshToken, rawSession: userId && accessToken ? (userId + '::' + accessToken) : raw };
}
function cursorApiHost(method, host, pathname, headers, body, timeoutMs = 8000) {
    return new Promise(resolve => {
        try {
            const data = body != null ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : null;
            const reqHeaders = { ...headers };
            if (data) {
                reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
                reqHeaders['Content-Length'] = String(data.length);
            }
            const req = https.request({ hostname: host, path: pathname, method, headers: reqHeaders }, res => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', c => { raw += c; if (raw.length > 2000000)
                    req.destroy(); });
                res.on('end', () => { let json = null; try {
                    json = JSON.parse(raw);
                }
                catch { } resolve({ status: res.statusCode || 0, json, raw }); });
            });
            req.on('error', () => resolve({ status: 0, json: null, raw: '' }));
            req.setTimeout(timeoutMs, () => { try {
                req.destroy();
            }
            catch { } resolve({ status: -1, json: null, raw: '' }); });
            if (data)
                req.write(data);
            req.end();
        }
        catch {
            resolve({ status: 0, json: null, raw: '' });
        }
    });
}
function cursorBearerUsage(accessToken) {
    return cursorApiHost('GET', 'api2.cursor.sh', '/auth/usage-summary', {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
        'User-Agent': UA
    });
}
// Cursor 桌面端登录用的固定 OAuth client_id（与八戒一致）；提为配置项，便于 Cursor 改 id 时不重打包。
function cursorOAuthClientId() {
    const v = String(cfgGet('cursorOAuthClientId') || '').trim();
    return v || 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB';
}
// 用真 refreshToken 走 Cursor 官方续期换新 accessToken。web/cookie token 不是合法 refresh_token，会拿到 shouldLogout。
async function refreshCursorAccessToken(refreshToken) {
    const rt = String(refreshToken || '').trim();
    if (!rt)
        return { ok: false, error: 'empty_refresh_token' };
    const body = JSON.stringify({ grant_type: 'refresh_token', client_id: cursorOAuthClientId(), refresh_token: rt });
    const r = await cursorApiHost('POST', 'api2.cursor.sh', '/oauth/token', {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    }, body, 15000);
    if (r.status === 401 || r.status === 403)
        return { ok: false, error: 'refresh_token_invalid', status: r.status, shouldLogout: true };
    if (r.status !== 200)
        return { ok: false, error: r.status === -1 ? '请求超时' : ('http_error_' + (r.status || 0)), status: r.status };
    const j = r.json || {};
    // 服务端对失效 refresh_token 也可能回 200 但 access_token 空 + shouldLogout:true
    if (j.shouldLogout === true)
        return { ok: false, error: 'refresh_token_invalid', status: 200, shouldLogout: true };
    const accessToken = typeof j.access_token === 'string' ? j.access_token.trim() : '';
    if (!accessToken)
        return { ok: false, error: 'missing_access_token', status: 200, shouldLogout: j.shouldLogout === true };
    const newRefresh = typeof j.refresh_token === 'string' && j.refresh_token.trim() ? j.refresh_token.trim() : rt;
    const expiresIn = typeof j.expires_in === 'number' && Number.isFinite(j.expires_in) ? j.expires_in : undefined;
    return { ok: true, accessToken, refreshToken: newRefresh, expiresIn };
}
// 轮询深度登录结果：用户在浏览器登录后，api2 用 uuid+verifier 换回真 client token 对。
function pollCursorDeepLogin(uuid, verifier) {
    return new Promise(resolve => {
        const path = '/auth/poll?uuid=' + encodeURIComponent(uuid) + '&verifier=' + encodeURIComponent(verifier);
        const req = https.request({ hostname: 'api2.cursor.sh', path, method: 'GET', headers: { Accept: 'application/json', 'User-Agent': UA } }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => { raw += c; if (raw.length > 1000000)
                req.destroy(); });
            res.on('end', () => {
                if (res.statusCode !== 200)
                    return resolve(null);
                try {
                    const j = JSON.parse(raw);
                    if (j && j.accessToken && j.refreshToken)
                        return resolve({ accessToken: String(j.accessToken), refreshToken: String(j.refreshToken), authId: String(j.authId || '') });
                }
                catch { }
                resolve(null);
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(15000, () => { try {
            req.destroy();
        }
        catch { } resolve(null); });
        req.end();
    });
}
// 浏览器深度登录（PKCE）：开 cursor.com/loginDeepControl，用户登录后轮询 /auth/poll 拿真 token 对。
async function startCursorDeepLogin() {
    const { loginUrl, uuid, verifier } = buildDeepLoginUrl();
    const pick = await vscode.window.showInformationMessage('账号管理：将打开浏览器登录 Cursor 以获取可自动续期的账号令牌。登录完成后回到这里，插件会自动捕获。', { modal: true }, '打开浏览器', '复制登录链接');
    if (pick === '复制登录链接') {
        await vscode.env.clipboard.writeText(loginUrl);
        vscode.window.showInformationMessage('登录链接已复制，请在浏览器中打开并完成 Cursor 登录。');
    }
    else if (pick === '打开浏览器') {
        await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
    }
    else {
        return { ok: false, cancelled: true };
    }
    return await pollDeepLoginWithProgress(uuid, verifier, '已打开浏览器，请完成 Cursor 登录…');
}
// 生成一次性 PKCE 登录链接（verifier/challenge/uuid）。
function buildDeepLoginUrl() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const uuid = crypto.randomUUID();
    const loginUrl = 'https://cursor.com/loginDeepControl?challenge=' + challenge + '&uuid=' + uuid + '&mode=login';
    return { loginUrl, uuid, verifier };
}
// 共享轮询核心：带进度条、可取消，最多 ~150×2s 轮询 /auth/poll，拿到真 token 对即返回。
async function pollDeepLoginWithProgress(uuid, verifier, startMsg, onTick) {
    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Cursor 登录', cancellable: true }, async (progress, token) => {
        progress.report({ message: startMsg });
        for (let i = 0; i < 150; i++) {
            if (token.isCancellationRequested)
                return { ok: false, cancelled: true };
            const got = await pollCursorDeepLogin(uuid, verifier);
            if (got)
                return { ok: true, accessToken: got.accessToken, refreshToken: got.refreshToken, authId: got.authId };
            if (i > 0 && i % 15 === 0)
                progress.report({ message: '等待登录中…（' + Math.round(2 * i) + 's）' });
            await new Promise(r => setTimeout(r, 2000));
        }
        return { ok: false, error: '登录超时（5 分钟未完成），请重试' };
    });
}
// 隔离浏览器升级：起临时无痕浏览器、注入指定账号的会话 cookie、打开授权页，再走共享轮询拿真 token 对。
async function deepLoginViaInjectedBrowser(cookieValue) {
    const { loginUrl, uuid, verifier } = buildDeepLoginUrl();
    const launched = await (0, cdpBrowser_1.launchInjectedBrowser)({ cookieValue, loginUrl });
    if (!launched.ok)
        return { ok: false, error: launched.error || '启动隔离浏览器失败' };
    try {
        return await pollDeepLoginWithProgress(uuid, verifier, '已在隔离浏览器打开授权页，若出现「Authorize」请点一下…');
    }
    finally {
        try {
            launched.close();
        }
        catch { }
    }
}
function cursorHardLimitBody(mode, limitDollars) {
    if (mode === 'disabled')
        return {
            hardLimit: 0,
            noUsageBasedAllowed: true,
            preserveHardLimitPerUser: false,
            perUserMonthlyLimitDollars: 0,
            clearPerUserMonthlyLimitDollars: false,
            isDynamicTeamLimit: false,
            clearConflictingPolicy: false
        };
    if (mode === 'unlimited')
        return {
            isUnlimited: true,
            hardLimit: 10000,
            noUsageBasedAllowed: false,
            preserveHardLimitPerUser: false,
            perUserMonthlyLimitDollars: 0,
            clearPerUserMonthlyLimitDollars: false,
            isDynamicTeamLimit: false,
            clearConflictingPolicy: false
        };
    const n = Math.min(10000, Math.max(1, Math.floor(typeof limitDollars === 'number' && limitDollars > 0 ? limitDollars : 100)));
    return {
        hardLimit: n,
        hardLimitPerUser: n,
        noUsageBasedAllowed: false,
        preserveHardLimitPerUser: false,
        perUserMonthlyLimitDollars: 0,
        clearPerUserMonthlyLimitDollars: false,
        isDynamicTeamLimit: false,
        clearConflictingPolicy: false
    };
}
function planLabelOf(plan) {
    const p = String(plan || '').toLowerCase();
    if (!p)
        return '';
    if (p.includes('free'))
        return 'Free';
    if (p.includes('ultra'))
        return 'Ultra';
    if (p.includes('pro'))
        return 'Pro';
    if (p.includes('business') || p.includes('team') || p.includes('enterprise'))
        return 'Business';
    return plan;
}
async function fetchCursorUsage() {
    if (!accountUsageEnabled() || accountLoading)
        return;
    accountLoading = true;
    provider?.postState();
    try {
        const auth = await readCursorAuth();
        if (!auth || !auth.accessToken) {
            accountUsage = { error: '未读取到 Cursor 登录态（设置→关于 可填手动 token）', fetchedAt: Date.now(), source: 'none' };
            return;
        }
        const cookie = buildCookie(auth);
        const [planInfo, usage, stripe, me, hard, period, sand] = await Promise.all([
            cursorApi('POST', '/api/dashboard/get-plan-info', cookie, '{}'),
            cursorApi('GET', '/api/usage-summary', cookie),
            cursorApi('GET', '/api/auth/stripe', cookie),
            cursorApi('GET', '/api/auth/me', cookie),
            cursorApi('POST', '/api/dashboard/get-hard-limit', cookie, '{}'),
            cursorApi('POST', '/api/dashboard/get-current-period-usage', cookie, '{}'),
            cursorApi('POST', '/api/dashboard/get-sand-usage-status', cookie, '{}')
        ]);
        const probes = [planInfo, usage, stripe, me];
        if (!probes.some(r => r.status === 200 && r.json)) {
            const codes = probes.map(r => r.status);
            const diag = codes.includes(401) || codes.includes(403) ? '登录态无效(401/403)，请重新登录 Cursor 或填手动 token'
                : codes.every(c => c === -1) ? '请求超时（网络慢或无法访问 cursor.com）'
                    : codes.every(c => c === 0) ? '网络错误（连不上 cursor.com）'
                        : '返回异常(' + codes.join('/') + ')';
            accountUsage = { email: auth.email, error: 'cursor.com ' + diag, fetchedAt: Date.now(), source: 'cursor.com' };
            return;
        }
        const email = (me.json && me.json.email) || auth.email || '';
        const plan = (stripe.json && stripe.json.membershipType) || (planInfo.json && (planInfo.json.membershipType || planInfo.json.plan)) || '';
        const up = (usage.json && usage.json.individualUsage && usage.json.individualUsage.plan) || (planInfo.json && planInfo.json.individualUsage && planInfo.json.individualUsage.plan) || null;
        const used = up && typeof up.used === 'number' ? up.used : (planInfo.json && typeof planInfo.json.used === 'number' ? planInfo.json.used : 0);
        const limit = up && typeof up.limit === 'number' ? up.limit : (planInfo.json && typeof planInfo.json.limit === 'number' ? planInfo.json.limit : 0);
        const hj = hard.status === 200 ? hard.json : null;
        const hardLimit = hj && typeof hj.hardLimit === 'number' ? hj.hardLimit : undefined;
        const usageBased = hj ? !(hj.noUsageBasedAllowed === true) : undefined;
        const qTop = extractDashboardQuotas(period && period.json, usage && usage.json, sand && sand.json);
        accountUsage = { email, plan, planLabel: planLabelOf(plan), used, limit, hardLimit, usageBased, fetchedAt: Date.now(), source: 'cursor.com', ...qTop };
    }
    catch (e) {
        accountUsage = { error: '读取用量异常：' + (e && e.message || String(e)), fetchedAt: Date.now(), source: 'error' };
    }
    finally {
        accountLoading = false;
        provider?.postState();
    }
}
// 用某账号自己的 token 联网拉邮箱/套餐/用量/超额（供 token 导入与每账号刷新复用；只读，不写凭证）
async function fetchAccountInfoByToken(userId, accessToken) {
    if (!accessToken)
        return { error: 'token 为空' };
    const cookie = buildCookie({ userId, accessToken });
    const [api2, me, stripe, usage, planInfo, hard, period, sand, sessions] = await Promise.all([
        cursorBearerUsage(accessToken),
        cursorApi('GET', '/api/auth/me', cookie),
        cursorApi('GET', '/api/auth/stripe', cookie),
        cursorApi('GET', '/api/usage-summary', cookie),
        cursorApi('POST', '/api/dashboard/get-plan-info', cookie, '{}'),
        cursorApi('POST', '/api/dashboard/get-hard-limit', cookie, '{}'),
        cursorApi('POST', '/api/dashboard/get-current-period-usage', cookie, '{}'),
        cursorApi('POST', '/api/dashboard/get-sand-usage-status', cookie, '{}'),
        cursorApi('GET', '/api/auth/sessions', cookie)
    ]);
    if (![api2, me, stripe, usage, planInfo].some(r => r.status === 200 && r.json)) {
        const codes = [api2, me, stripe, usage, planInfo].map(r => r.status);
        return { error: codes.includes(401) || codes.includes(403) ? '登录态无效(401/403)' : codes.every(c => c === -1) ? '请求超时' : codes.every(c => c === 0) ? '网络错误' : '返回异常(' + codes.join('/') + ')' };
    }
    const resolvedUserId = normUserId((me.json && (me.json.sub || me.json.id || me.json.authId || me.json.userId)) || userId || '');
    const email = (me.json && me.json.email) || (api2.json && (api2.json.email || api2.json.usageSummaryEmail)) || (stripe.json && stripe.json.email) || '';
    const pi = planInfo.json && planInfo.json.planInfo && typeof planInfo.json.planInfo === 'object' ? planInfo.json.planInfo : (planInfo.json || {});
    const plan = (stripe.json && stripe.json.membershipType) || (api2.json && (api2.json.membershipType || api2.json.planName || api2.json.plan)) || (pi && (pi.membershipType || pi.planName || pi.plan)) || '';
    const up = (usage.json && usage.json.individualUsage && usage.json.individualUsage.plan) || (api2.json && api2.json.individualUsage && api2.json.individualUsage.plan) || null;
    const used = up && typeof up.used === 'number' ? up.used : 0;
    const limit = up && typeof up.limit === 'number' ? up.limit : 0;
    const hj = hard.status === 200 ? hard.json : null;
    const hardLimit = hj && typeof hj.hardLimit === 'number' ? hj.hardLimit : undefined;
    const usageBased = hj ? !(hj.noUsageBasedAllowed === true) : undefined;
    const billingCycleEnd = typeof pi.billingCycleEnd === 'number' ? pi.billingCycleEnd : undefined;
    const q = extractDashboardQuotas(period && period.json, usage && usage.json, sand && sand.json);
    const sessionCount = (sessions && sessions.status === 200 && sessions.json && Array.isArray(sessions.json.sessions)) ? sessions.json.sessions.length : null;
    return { userId: resolvedUserId, email, plan, used, limit, hardLimit, usageBased, billingCycleEnd, sessionCount, source: api2.status === 200 ? 'api2+cursor.com' : 'cursor.com', ...q };
}
async function setCursorHardLimit(opts) {
    const auth = await readCursorAuth();
    if (!auth || !auth.accessToken)
        return { ok: false, error: '未读取到 Cursor 登录态' };
    const body = {};
    if (typeof opts.hardLimit === 'number')
        body.hardLimit = opts.hardLimit;
    if (typeof opts.noUsageBasedAllowed === 'boolean')
        body.noUsageBasedAllowed = opts.noUsageBasedAllowed;
    const r = await cursorApi('POST', '/api/dashboard/set-hard-limit', buildCookie(auth), JSON.stringify(body));
    if (r.status === 200)
        return { ok: true };
    return { ok: false, status: r.status, error: r.status === 401 || r.status === 403 ? '登录态无效' : (r.status === -1 ? '请求超时' : ('HTTP ' + r.status)) };
}
function buildAccount(messages, chats, waiting) {
    const localLabel = os.userInfo().username || 'local';
    if (!accountUsageEnabled()) {
        return { label: localLabel, plan: '', planLabel: '本地模式', usageText: `${messages} msgs / ${chats} chats`, usageShort: '', usagePct: Math.min(100, messages % 101), waiting, loading: false, error: '', enabled: false };
    }
    const a = accountUsage;
    if (a && !a.error && (a.email || a.plan || a.limit)) {
        const used = a.used || 0, limit = a.limit || 0;
        const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : Math.min(100, messages % 101);
        const qShort = [typeof a.autoPercent === 'number' ? ('A' + Math.round(a.autoPercent)) : '', typeof a.otherPercent === 'number' ? ('O' + Math.round(a.otherPercent)) : '', typeof a.botPercent === 'number' ? ('B' + Math.round(a.botPercent)) : ''].filter(Boolean).join(' ');
        const usageText = qShort || (limit > 0 ? `用量 ${used}/${limit}` : (used > 0 ? `用量 ${used}` : `${messages} msgs / ${chats} chats`));
        const usageShort = qShort || (limit > 0 ? `${used}/${limit}` : (used > 0 ? String(used) : ''));
        return { label: localLabel, email: a.email || '', plan: a.plan || '', planLabel: a.planLabel || a.plan || '', used, limit, usageText, usageShort, usagePct: pct, waiting, loading: accountLoading, error: '', enabled: true, hardLimit: typeof a.hardLimit === 'number' ? a.hardLimit : null, usageBased: typeof a.usageBased === 'boolean' ? a.usageBased : null, autoPercent: a.autoPercent, otherPercent: a.otherPercent, botPercent: a.botPercent, botHasLimit: !!a.botHasLimit, botResetAt: a.botResetAt || '', cycleEnd: a.cycleEnd || '' };
    }
    return { label: localLabel, email: (a && a.email) || '', plan: '', planLabel: accountLoading ? '加载中…' : '本地模式', usageText: `${messages} msgs / ${chats} chats`, usageShort: '', usagePct: Math.min(100, messages % 101), waiting, loading: accountLoading, error: (a && a.error) || '', enabled: true };
}
// ── 多账号管理（参考八戒：导入/列表/切换=写回 state.vscdb 全局登录态/超额三态）──
function acctId() { return 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function getAccounts() { try {
    const v = extensionContext?.globalState.get(ACCOUNTS_KEY);
    if (Array.isArray(v) && v.length)
        return v;
    const legacy = extensionContext?.globalState.get(ACCOUNTS_KEY_LEGACY);
    return Array.isArray(legacy) ? legacy : [];
}
catch {
    return [];
} }
async function saveAccounts(list) { try {
    await extensionContext?.globalState.update(ACCOUNTS_KEY, list);
    await extensionContext?.globalState.update(ACCOUNTS_KEY_LEGACY, list);
}
catch { } }
function unquote(v) { const s = String(v == null ? '' : v); if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
        return String(JSON.parse(s));
    }
    catch { }
} return s; }
function normEmail(v) { return unquote(v).toLowerCase().trim(); }
function normUserId(v) { return unquote(v).trim(); }
function decodeJwtPayload(token) {
    try {
        const part = String(token || '').split('.')[1];
        if (!part)
            return null;
        const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    }
    catch {
        return null;
    }
}
// 从 JWT 推导 token 类型与过期：type==='web' 是 cookie/网页令牌，不能用作 refresh_token；其它（client/session 等）视为可续期。
function tokenMetaOf(accessToken) {
    const p = decodeJwtPayload(accessToken) || {};
    const t = String(p.type || '').toLowerCase();
    const exp = typeof p.exp === 'number' ? p.exp : (Number(p.exp) || 0);
    return { tokenType: t === 'web' ? 'web' : 'client', accessTokenExp: exp };
}
function emailFromJwt(token, userId = '') {
    const payload = decodeJwtPayload(token) || {};
    const sub = String(payload.sub || '');
    if (sub.includes('@'))
        return normEmail(sub.split('|').find((p) => p.includes('@')) || sub);
    if (sub.includes('|')) {
        const part = sub.split('|').find((p) => p.startsWith('user_')) || '';
        if (part)
            return normEmail(part.replace(/^user_/, '') + '@cursor.local');
    }
    if (userId)
        return normEmail(userId.replace(/^user_/, '') + '@cursor.local');
    return '';
}
function findAccountIndex(list, acc) {
    const uid = normUserId(acc.userId);
    const email = normEmail(acc.email);
    return list.findIndex(a => (uid && normUserId(a.userId) === uid) || (email && normEmail(a.email) === email));
}
function resolveCurrentAccountId() {
    const list = getAccounts();
    const liveUid = normUserId(currentCursorUserIdCache);
    const liveEmail = normEmail(currentCursorEmailCache);
    if (liveEmail) {
        const hits = list.filter(a => normEmail(a.email) === liveEmail);
        const hit = newestAccount(hits);
        if (hit)
            return hit.id;
    }
    if (liveUid) {
        const hits = list.filter(a => normUserId(a.userId) === liveUid);
        const hit = newestAccount(hits);
        if (hit)
            return hit.id;
    }
    return '';
}
function newestAccount(list) {
    if (!list.length)
        return null;
    return list.slice().sort((a, b) => {
        const ta = Date.parse(a.lastSwitchedAt || a.addedAt || '') || 0;
        const tb = Date.parse(b.lastSwitchedAt || b.addedAt || '') || 0;
        return tb - ta;
    })[0];
}
function normalizeAuthBlobForWrite(acc) {
    const raw = Object.fromEntries(Object.entries(acc.authBlob || {}).filter(([k]) => String(k).startsWith('cursorAuth/')));
    const userId = normUserId(raw['cursorAuth/userId'] || raw['cursorAuth/cachedUserId'] || acc.userId || '');
    const accessToken = unquote(raw['cursorAuth/accessToken'] || '');
    const email = normEmail(raw['cursorAuth/cachedEmail'] || raw['cursorAuth/email'] || acc.email || '');
    // 优先用真 refreshToken（深度登录拿到的，可自动续期）。web/无真 refresh 的账号：对齐八戒——回退把 accessToken 当 refreshToken 写，
    // 让 Cursor 重启后仍能读到完整登录态（access+refresh 都在），切号生效到 token 过期为止；而不是留空导致重启即掉登录。
    // 代价：token 过期后 Cursor 续期会失败弹登录（八戒同此），但换来"先能切换正常用"。
    const isWeb = acc.tokenType === 'web' || acc.noRefresh === true;
    const rawRefresh = unquote(acc.refreshToken || raw['cursorAuth/refreshToken'] || '');
    const realRefresh = (!isWeb && rawRefresh && rawRefresh !== accessToken) ? rawRefresh : '';
    const refreshToken = realRefresh || accessToken;
    const plan = unquote(raw['cursorAuth/stripeMembershipType'] || acc.type || '');
    const subStatus = unquote(raw['cursorAuth/stripeSubscriptionStatus'] || 'active');
    const signUpType = unquote(raw['cursorAuth/cachedSignUpType'] || 'Auth_0');
    const sess = userId ? (userId + '%3A%3A' + accessToken) : accessToken;
    const blob = {};
    if (accessToken) {
        blob['cursorAuth/accessToken'] = accessToken;
    }
    if (userId) {
        blob['cursorAuth/userId'] = userId;
        blob['cursorAuth/cachedUserId'] = userId;
        blob['cursorAuth/authId'] = userId;
        blob['cursorAuth/openIdUserId'] = userId;
    }
    if (refreshToken)
        blob['cursorAuth/refreshToken'] = refreshToken;
    if (email) {
        blob['cursorAuth/cachedEmail'] = email;
        blob['cursorAuth/email'] = email;
        blob['cursorAuth/user'] = JSON.stringify({ email, id: userId, sub: userId });
    }
    if (sess) {
        blob['cursorAuth/workosCursorSessionToken'] = sess;
        blob['cursorAuth/cachedWorkosSessionToken'] = sess;
    }
    blob['cursorAuth/isLoggedIn'] = 'true';
    blob['cursorAuth/isAuthenticated'] = 'true';
    blob['cursorAuth/isAuthorized'] = 'true';
    if (plan)
        blob['cursorAuth/stripeMembershipType'] = plan;
    blob['cursorAuth/stripeSubscriptionStatus'] = subStatus;
    blob['cursorAuth/cachedSignUpType'] = signUpType;
    return blob;
}
function makeAccountFromBlob(blob, hint) {
    const email = normEmail(blob['cursorAuth/cachedEmail'] || blob['cursorAuth/email'] || (hint && hint.email) || '');
    const userId = normUserId(blob['cursorAuth/userId'] || blob['cursorAuth/cachedUserId'] || (hint && hint.userId) || '');
    const type = unquote(blob['cursorAuth/stripeMembershipType'] || '');
    if (email && userId && !blob['cursorAuth/user'])
        blob['cursorAuth/user'] = JSON.stringify({ email, id: userId, sub: userId });
    return { id: acctId(), email, userId, type, addedAt: now(), authBlob: blob, partial: false };
}
async function upsertAccount(acc) {
    acc.userId = normUserId(acc.userId);
    acc.email = normEmail(acc.email) || acc.email || '';
    const list = getAccounts();
    const idx = findAccountIndex(list, acc);
    if (idx >= 0) {
        const prev = list[idx];
        acc.id = prev.id;
        list[idx] = { ...prev, ...acc, id: prev.id, addedAt: prev.addedAt || acc.addedAt };
        await saveAccounts(list);
        return { acc: list[idx], duplicate: true };
    }
    list.push(acc);
    await saveAccounts(list);
    return { acc, duplicate: false };
}
async function appendAccount(acc) {
    acc.id = acctId();
    acc.userId = normUserId(acc.userId);
    acc.email = normEmail(acc.email) || acc.email || '';
    acc.addedAt = now();
    const list = getAccounts();
    list.push(acc);
    await saveAccounts(list);
    return { acc };
}
async function addAccountFromCurrentLogin() {
    await refreshCurrentUserId();
    const blob = await querySqliteLike(path.join(cursorGlobalStorageDir(), 'state.vscdb'), 'cursorAuth/%');
    if (!blob || !blob['cursorAuth/accessToken'])
        return { ok: false, error: '未读取到当前 Cursor 登录态（需本机已登录 Cursor 且 sqlite 可用）' };
    await appendAccount(makeAccountFromBlob(blob));
    return { ok: true, duplicate: false };
}
async function addAccountFromToken(token) {
    const parsed = parseCursorSessionInput(token);
    let userId = parsed.userId, accessToken = parsed.accessToken;
    if (!accessToken)
        return { ok: false, error: 'token 为空' };
    const meta = tokenMetaOf(accessToken);
    // 若粘贴了第三段 refreshToken，且它不等于 accessToken，则视为可续期 client 账号（和浏览器登录等价）。
    let pastedRefresh = parsed.refreshToken && parsed.refreshToken !== accessToken ? parsed.refreshToken : '';
    const isClient = !!pastedRefresh;
    const metaFinal = meta;
    const info = await fetchAccountInfoByToken(userId, accessToken);
    if (info.userId)
        userId = info.userId;
    const parsedEmail = normEmail(info.email || emailFromJwt(accessToken, userId));
    const sess = userId ? (userId + '%3A%3A' + accessToken) : accessToken;
    // 写全键集（对齐八戒：补 isLoggedIn/isAuthenticated/isAuthorized='true' + 联网拿到的 email/plan），让切换尽量生效。
    // 注意：cookie/token 导入天生无真 refreshToken —— 绝不再把 accessToken 当 refreshToken 写（那会让 Cursor 续期收到 shouldLogout 并弹登录框）。
    const blob = {
        'cursorAuth/accessToken': accessToken,
        'cursorAuth/userId': userId,
        'cursorAuth/cachedUserId': userId,
        'cursorAuth/workosCursorSessionToken': sess,
        'cursorAuth/cachedWorkosSessionToken': sess,
        'cursorAuth/isLoggedIn': 'true',
        'cursorAuth/isAuthenticated': 'true',
        'cursorAuth/isAuthorized': 'true'
    };
    if (pastedRefresh)
        blob['cursorAuth/refreshToken'] = pastedRefresh;
    if (parsedEmail) {
        blob['cursorAuth/cachedEmail'] = parsedEmail;
        blob['cursorAuth/email'] = parsedEmail;
        blob['cursorAuth/user'] = JSON.stringify({ email: parsedEmail, id: userId, sub: userId });
    }
    if (info.plan)
        blob['cursorAuth/stripeMembershipType'] = info.plan;
    if (userId) {
        blob['cursorAuth/userId'] = userId;
        blob['cursorAuth/cachedUserId'] = userId;
        blob['cursorAuth/authId'] = userId;
    }
    const acc = makeAccountFromBlob(blob);
    acc.partial = !isClient;
    acc.tokenType = isClient ? 'client' : metaFinal.tokenType;
    acc.accessTokenExp = metaFinal.accessTokenExp;
    acc.noRefresh = !isClient;
    acc.refreshToken = pastedRefresh;
    acc.source = isClient ? 'token' : 'cookie';
    if (parsedEmail)
        acc.email = parsedEmail;
    if (info.userId)
        acc.userId = normUserId(info.userId);
    if (info.plan)
        acc.type = info.plan;
    acc.usage = usageFromInfo(info);
    const saved = await upsertAccount(acc);
    return { ok: true, duplicate: saved.duplicate, error: info.error, tokenType: acc.tokenType, accId: saved.acc.id, userId, accessToken };
}
// 浏览器深度登录拿到真 client token 对后入列：存真 refreshToken，可自动续期、切号后不会弹登录框。
async function addAccountFromDeepLogin(accessToken, refreshToken, authId) {
    if (!accessToken || !refreshToken)
        return { ok: false, error: '深度登录未返回完整令牌' };
    const meta = tokenMetaOf(accessToken);
    const payload = decodeJwtPayload(accessToken) || {};
    let userId = normUserId(String(payload.sub || '').replace(/^auth0\|/, '') || (authId && !authId.includes('@') ? authId : ''));
    const info = await fetchAccountInfoByToken(userId, accessToken);
    if (info.userId)
        userId = info.userId;
    const email = normEmail(info.email || (authId && authId.includes('@') ? authId : '') || emailFromJwt(accessToken, userId));
    const sess = userId ? (userId + '%3A%3A' + accessToken) : accessToken;
    const blob = {
        'cursorAuth/accessToken': accessToken,
        'cursorAuth/refreshToken': refreshToken,
        'cursorAuth/userId': userId,
        'cursorAuth/cachedUserId': userId,
        'cursorAuth/workosCursorSessionToken': sess,
        'cursorAuth/cachedWorkosSessionToken': sess,
        'cursorAuth/isLoggedIn': 'true',
        'cursorAuth/isAuthenticated': 'true',
        'cursorAuth/isAuthorized': 'true'
    };
    if (email) {
        blob['cursorAuth/cachedEmail'] = email;
        blob['cursorAuth/email'] = email;
        blob['cursorAuth/user'] = JSON.stringify({ email, id: userId, sub: userId });
    }
    if (info.plan)
        blob['cursorAuth/stripeMembershipType'] = info.plan;
    if (userId)
        blob['cursorAuth/authId'] = userId;
    const acc = makeAccountFromBlob(blob);
    acc.partial = false;
    acc.tokenType = 'client';
    acc.accessTokenExp = meta.accessTokenExp;
    acc.noRefresh = false;
    acc.refreshToken = refreshToken;
    acc.source = 'deeplogin';
    if (email)
        acc.email = email;
    if (info.userId)
        acc.userId = normUserId(info.userId);
    if (info.plan)
        acc.type = info.plan;
    acc.usage = usageFromInfo(info);
    const saved = await upsertAccount(acc);
    return { ok: true, duplicate: saved.duplicate, error: info.error };
}
async function refreshCurrentUserId() {
    try {
        const rows = await querySqliteLike(path.join(cursorGlobalStorageDir(), 'state.vscdb'), 'cursorAuth/%');
        if (rows) {
            currentCursorUserIdCache = normUserId(rows['cursorAuth/userId'] || rows['cursorAuth/cachedUserId'] || '');
            currentCursorEmailCache = normEmail(rows['cursorAuth/cachedEmail'] || rows['cursorAuth/email'] || '');
            if (currentCursorUserIdCache && currentCursorEmailCache)
                await backfillCurrentAccountEmail(currentCursorUserIdCache, currentCursorEmailCache, rows);
        }
        provider?.postState();
    }
    catch { }
}
async function backfillCurrentAccountEmail(userId, email, rows) {
    const list = getAccounts();
    const candidates = list.filter(a => normUserId(a.userId) === userId || (normEmail(a.email).endsWith('@cursor.local') && String(a.userId || '').slice(-8) === userId.slice(-8)));
    const acc = newestAccount(candidates);
    if (!acc || normEmail(acc.email) === normEmail(email))
        return;
    acc.email = normEmail(email);
    acc.authBlob = acc.authBlob || {};
    acc.authBlob['cursorAuth/cachedEmail'] = normEmail(email);
    acc.authBlob['cursorAuth/email'] = normEmail(email);
    acc.authBlob['cursorAuth/user'] = (rows && rows['cursorAuth/user']) || JSON.stringify({ email: normEmail(email), id: userId, sub: userId });
    await saveAccounts(list);
}
async function refreshAccountInfo(id) {
    const list = getAccounts();
    const acc = list.find(a => a.id === id);
    if (!acc)
        return { ok: false, error: '账号不存在' };
    const blob = acc.authBlob || {};
    const accessToken = unquote(blob['cursorAuth/accessToken'] || '');
    const userId = acc.userId || unquote(blob['cursorAuth/userId'] || '');
    if (!accessToken)
        return { ok: false, error: '该账号无 accessToken，无法联网刷新' };
    const info = await fetchAccountInfoByToken(userId, accessToken);
    if (info.email)
        acc.email = normEmail(info.email);
    if (info.userId)
        acc.userId = normUserId(info.userId);
    if (info.plan)
        acc.type = info.plan;
    acc.usage = usageFromInfo(info);
    if (info.email || info.plan || info.userId) {
        acc.authBlob = acc.authBlob || {};
        if (info.email) {
            acc.authBlob['cursorAuth/cachedEmail'] = info.email;
            acc.authBlob['cursorAuth/email'] = info.email;
            acc.authBlob['cursorAuth/user'] = JSON.stringify({ email: info.email, id: info.userId || acc.userId, sub: info.userId || acc.userId });
            delete acc.authBlob['cursor.email'];
        }
        if (info.plan)
            acc.authBlob['cursorAuth/stripeMembershipType'] = info.plan;
        if (info.userId) {
            acc.authBlob['cursorAuth/userId'] = info.userId;
            acc.authBlob['cursorAuth/cachedUserId'] = info.userId;
            acc.authBlob['cursorAuth/authId'] = info.userId;
        }
    }
    await saveAccounts(list);
    return { ok: true, error: info.error };
}
// 把续期拿到的新 token 写回账号对象（accessToken/refreshToken/exp/authBlob），并持久化。
function applyRefreshedTokenToAccount(acc, accessToken, refreshToken) {
    acc.refreshToken = refreshToken || acc.refreshToken || '';
    const meta = tokenMetaOf(accessToken);
    acc.tokenType = 'client';
    acc.noRefresh = false;
    acc.accessTokenExp = meta.accessTokenExp;
    acc.authBlob = acc.authBlob || {};
    acc.authBlob['cursorAuth/accessToken'] = accessToken;
    if (acc.refreshToken)
        acc.authBlob['cursorAuth/refreshToken'] = acc.refreshToken;
    const uid = normUserId(acc.userId || unquote(acc.authBlob['cursorAuth/userId'] || ''));
    if (uid)
        acc.authBlob['cursorAuth/workosCursorSessionToken'] = uid + '%3A%3A' + accessToken;
}
// 切前/定时调用：仅对 client（有真 refreshToken）账号生效。accessToken 失效或临近过期则续期；web 账号直接跳过。
async function ensureFreshAccessToken(acc) {
    if (!acc || acc.tokenType === 'web' || acc.noRefresh === true)
        return { refreshed: false };
    const refreshToken = unquote(acc.refreshToken || (acc.authBlob && acc.authBlob['cursorAuth/refreshToken']) || '');
    const accessToken = unquote((acc.authBlob && acc.authBlob['cursorAuth/accessToken']) || '');
    if (!refreshToken || refreshToken === accessToken)
        return { refreshed: false };
    // 判断是否需要续期：accessToken 缺失、已过期、或 5 分钟内过期。
    const exp = acc.accessTokenExp || tokenMetaOf(accessToken).accessTokenExp;
    const soon = !accessToken || !exp || (exp - Math.floor(Date.now() / 1000) < 300);
    if (!soon)
        return { refreshed: false };
    const r = await refreshCursorAccessToken(refreshToken);
    if (!r.ok || !r.accessToken)
        return { refreshed: false, error: r.error };
    applyRefreshedTokenToAccount(acc, r.accessToken, r.refreshToken || refreshToken);
    return { refreshed: true };
}
// 每账号「刷新 Token」按钮：client 账号强制走 OAuth 续期换新 token；web 账号明确提示无法续期。
async function accountRefreshToken(id) {
    const list = getAccounts();
    const acc = list.find(a => a.id === id);
    if (!acc)
        return { ok: false, error: '账号不存在' };
    if (acc.tokenType === 'web' || acc.noRefresh === true)
        return { ok: false, error: '该账号为 web/cookie token，无法自动续期。请用「浏览器登录」重新添加可续期账号。' };
    const refreshToken = unquote(acc.refreshToken || (acc.authBlob && acc.authBlob['cursorAuth/refreshToken']) || '');
    if (!refreshToken)
        return { ok: false, error: '该账号无 refreshToken，无法续期。请用「浏览器登录」重新添加。' };
    const r = await refreshCursorAccessToken(refreshToken);
    if (!r.ok || !r.accessToken) {
        if (r.shouldLogout) {
            acc.noRefresh = true;
            await saveAccounts(list);
        }
        return { ok: false, error: r.error || '续期失败', shouldLogout: r.shouldLogout };
    }
    applyRefreshedTokenToAccount(acc, r.accessToken, r.refreshToken || refreshToken);
    // 顺带刷新一次额度/邮箱
    const info = await fetchAccountInfoByToken(acc.userId || '', r.accessToken);
    if (info.email)
        acc.email = normEmail(info.email);
    if (info.plan)
        acc.type = info.plan;
    acc.usage = usageFromInfo(info);
    await saveAccounts(list);
    return { ok: true, refreshed: true };
}
// 后台定时续期：对所有 client 账号做一次「临期才续」的检查（受 autoRefreshAccountTokens 控制）。
async function refreshAllAccountTokens() {
    if (cfgGet('autoRefreshAccountTokens') === false)
        return;
    const list = getAccounts();
    let changed = false;
    for (const acc of list) {
        try {
            const r = await ensureFreshAccessToken(acc);
            if (r.refreshed)
                changed = true;
        }
        catch { }
    }
    if (changed) {
        await saveAccounts(list);
        provider?.postState();
    }
}
async function switchCursorAccount(id) {
    const list = getAccounts();
    const acc = list.find(a => a.id === id);
    if (!acc)
        return { ok: false, error: '账号不存在' };
    // 切前续期：client 账号若 accessToken 已失效且有真 refreshToken，先换新 token 再写入，避免写过期 token。
    await ensureFreshAccessToken(acc);
    await saveAccounts(list);
    const blob = normalizeAuthBlobForWrite(acc);
    if (!blob['cursorAuth/accessToken'])
        return { ok: false, error: '该账号无 accessToken，请用「导入本机 Token」重新添加' };
    if (!blob['cursorAuth/userId'])
        return { ok: false, error: '该账号 userId 缺失，请删除后重新用「导入 userId::Token」或在该账号登录时用「导入本机 Token」' };
    const dir = cursorGlobalStorageDir();
    const dbPath = path.join(dir, 'state.vscdb');
    if (!fs.existsSync(dbPath))
        return { ok: false, error: '未找到 state.vscdb' };
    const backup = backupCursorStateDb(dbPath);
    if (!backup.ok)
        return { ok: false, error: '备份 state.vscdb 失败：' + (backup.error || 'unknown') };
    const entries = buildCursorAuthWriteEntries(blob);
    const wr = await writeSqliteItemTableWithRetry(dbPath, entries);
    if (!wr.ok)
        return wr;
    const sync = syncStorageJsonAuth(dir, blob);
    if (!sync.ok)
        return sync;
    acc.authBlob = blob;
    acc.userId = normUserId(blob['cursorAuth/userId']);
    acc.email = normEmail(blob['cursorAuth/cachedEmail'] || acc.email || '');
    acc.lastSwitchedAt = now();
    await saveAccounts(list);
    await refreshCurrentUserId();
    const diskAuth = await readCursorAuthFromVscdb(dir);
    const expectEmail = normEmail(acc.email);
    const writtenEmail = normEmail((diskAuth && diskAuth.email) || currentCursorEmailCache);
    if (expectEmail && writtenEmail && expectEmail !== writtenEmail) {
        return { ok: false, error: '写入后校验失败：数据库邮箱仍为 ' + writtenEmail + '，目标为 ' + expectEmail + '。请用「导入本机 Token」重新添加该账号。' };
    }
    const expectUid = normUserId(acc.userId);
    const writtenUid = normUserId((diskAuth && diskAuth.userId) || currentCursorUserIdCache);
    if (expectUid && writtenUid && expectUid !== writtenUid) {
        return { ok: false, error: '写入后校验失败：数据库 userId 仍为 ' + writtenUid.slice(-8) + '，目标为 ' + expectUid.slice(-8) + '。请用「导入本机 Token」重新添加该账号。' };
    }
    try {
        await cfgUpdate('manualCursorToken', '', vscode.ConfigurationTarget.Global);
    }
    catch { }
    accountUsage = null;
    // 账号已写入 state.vscdb。Cursor 在运行时把鉴权缓存在内存里，必须完整重启才会重新从库读取并生效。
    return { ok: true, needsRestart: true };
}
async function setHardLimitForAccount(id, mode, limitDollars) {
    const acc = getAccounts().find(a => a.id === id);
    if (!acc)
        return { ok: false, error: '账号不存在' };
    const blob = acc.authBlob || {};
    const accessToken = unquote(blob['cursorAuth/accessToken'] || '');
    const userId = acc.userId || unquote(blob['cursorAuth/userId'] || '');
    if (!accessToken)
        return { ok: false, error: '该账号无 accessToken' };
    let body;
    body = cursorHardLimitBody(mode, limitDollars);
    const r = await cursorApi('POST', '/api/dashboard/set-hard-limit', buildCookie({ userId, accessToken }), JSON.stringify(body));
    if (r.status !== 200)
        return { ok: false, error: r.status === 401 || r.status === 403 ? '登录态无效' : (r.status === -1 ? '请求超时' : ('HTTP ' + r.status)) };
    await refreshAccountInfo(id);
    return { ok: true };
}
async function removeAccount(id) { await saveAccounts(getAccounts().filter(a => a.id !== id)); }
function accountsForClient() {
    const currentId = resolveCurrentAccountId();
    return getAccounts().map(a => {
        const u = a.usage || null;
        const hasRealRefresh = !!(a.refreshToken || (a.authBlob && a.authBlob['cursorAuth/refreshToken']));
        const tokenType = a.tokenType || (a.partial ? 'web' : (hasRealRefresh ? 'client' : 'web'));
        return {
            id: a.id, email: a.email || '(未知邮箱)', userTail: String(a.userId || '').slice(-8), type: a.type || '', partial: !!a.partial,
            tokenType,
            accessTokenExp: typeof a.accessTokenExp === 'number' ? a.accessTokenExp : 0,
            addedAt: a.addedAt || '',
            source: a.source || (a.partial ? 'cookie' : 'currentLogin'),
            noRefresh: !!(a.noRefresh || tokenType === 'web' || !hasRealRefresh),
            isCurrent: !!currentId && a.id === currentId,
            used: u && typeof u.used === 'number' ? u.used : null,
            limit: u && typeof u.limit === 'number' ? u.limit : null,
            hardLimit: u && typeof u.hardLimit === 'number' ? u.hardLimit : null,
            usageBased: u && typeof u.usageBased === 'boolean' ? u.usageBased : null,
            usageError: u && u.error ? u.error : '',
            autoPercent: u && typeof u.autoPercent === 'number' ? u.autoPercent : null,
            otherPercent: u && typeof u.otherPercent === 'number' ? u.otherPercent : null,
            totalPercent: u && typeof u.totalPercent === 'number' ? u.totalPercent : null,
            botPercent: u && typeof u.botPercent === 'number' ? u.botPercent : null,
            botHasLimit: !!(u && u.botHasLimit),
            botResetAt: (u && u.botResetAt) || '',
            cycleEnd: (u && u.cycleEnd) || '',
            sessionCount: u && typeof u.sessionCount === 'number' ? u.sessionCount : null
        };
    });
}
async function setCursorHardLimitMode(mode, limitDollars) {
    let body;
    body = cursorHardLimitBody(mode, limitDollars);
    const auth = await readCursorAuth();
    if (!auth || !auth.accessToken)
        return { ok: false, error: '未读取到 Cursor 登录态' };
    const r = await cursorApi('POST', '/api/dashboard/set-hard-limit', buildCookie(auth), JSON.stringify(body));
    if (r.status === 200)
        return { ok: true };
    return { ok: false, status: r.status, error: r.status === 401 || r.status === 403 ? '登录态无效' : (r.status === -1 ? '请求超时' : ('HTTP ' + r.status)) };
}

function pickFinite() {
    for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (typeof v === 'number' && Number.isFinite(v))
            return v;
    }
    return null;
}
function parseAnyDate(v) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'number' && Number.isFinite(v))
        return new Date(v > 1e12 ? v : v * 1000).toISOString();
    const s = String(v).trim();
    if (/^\d{13}$/.test(s))
        return new Date(Number(s)).toISOString();
    if (/^\d{10}$/.test(s))
        return new Date(Number(s) * 1000).toISOString();
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}
function extractDashboardQuotas(period, usage, sand) {
    const pu = (period && period.planUsage) || (usage && usage.individualUsage && usage.individualUsage.plan) || {};
    const sandOk = !!(sand && sand.hasNonZeroIncludedLimit);
    return {
        autoPercent: pickFinite(pu.autoPercentUsed),
        otherPercent: pickFinite(pu.apiPercentUsed),
        totalPercent: pickFinite(pu.totalPercentUsed),
        botPercent: sandOk ? pickFinite(sand.usagePercent) : null,
        botHasLimit: sandOk,
        botResetAt: sandOk ? parseAnyDate(sand.nextResetTimestampUtc) : '',
        cycleEnd: parseAnyDate((period && period.billingCycleEnd) || (usage && usage.billingCycleEnd))
    };
}
function usageFromInfo(info) {
    if (!info)
        return { error: '空结果', fetchedAt: now() };
    if (info.error)
        return { error: info.error, fetchedAt: now() };
    return {
        used: info.used,
        limit: info.limit,
        hardLimit: info.hardLimit,
        usageBased: info.usageBased,
        plan: info.plan,
        autoPercent: info.autoPercent,
        otherPercent: info.otherPercent,
        totalPercent: info.totalPercent,
        botPercent: info.botPercent,
        botHasLimit: !!info.botHasLimit,
        botResetAt: info.botResetAt || '',
        cycleEnd: info.cycleEnd || '',
        sessionCount: typeof info.sessionCount === 'number' ? info.sessionCount : null,
        fetchedAt: now()
    };
}
function sessionTypeLabel(t) {
    const x = String(t || '').toUpperCase();
    if (x.includes('WEB'))
        return 'Web';
    if (x.includes('CLIENT') || x.includes('DESKTOP') || x.includes('APP') || x.includes('IDE'))
        return 'Cursor 桌面';
    if (x.includes('MOBILE'))
        return '手机';
    return String(t || '').replace(/^SESSION_TYPE_/, '') || '未知设备';
}
function accountAuthPair(id) {
    const acc = getAccounts().find(a => a.id === id);
    if (!acc)
        return null;
    const blob = acc.authBlob || {};
    const accessToken = unquote(blob['cursorAuth/accessToken'] || '');
    const userId = acc.userId || unquote(blob['cursorAuth/userId'] || '');
    if (!accessToken)
        return null;
    return { acc, userId, accessToken, cookie: buildCookie({ userId, accessToken }) };
}
async function listAccountSessions(id) {
    const pair = accountAuthPair(id);
    if (!pair)
        return { ok: false, error: '账号不存在或无令牌' };
    const r = await cursorApi('GET', '/api/auth/sessions', pair.cookie);
    if (r.status !== 200 || !r.json)
        return { ok: false, error: r.status === 401 || r.status === 403 ? '登录态无效' : (r.status === -1 ? '请求超时' : ('HTTP ' + (r.status || 0))) };
    const sessions = (Array.isArray(r.json.sessions) ? r.json.sessions : []).map(s => ({
        sessionId: String(s.sessionId || ''),
        type: String(s.type || ''),
        typeLabel: sessionTypeLabel(s.type),
        createdAt: s.createdAt || '',
        expiresAt: s.expiresAt || ''
    })).filter(s => s.sessionId);
    return { ok: true, email: pair.acc.email || '', sessions };
}
async function revokeAccountSession(id, sessionId) {
    const pair = accountAuthPair(id);
    if (!pair)
        return { ok: false, error: '账号不存在或无令牌' };
    const sid = String(sessionId || '').trim();
    if (!sid)
        return { ok: false, error: 'sessionId 为空' };
    const r = await cursorApi('POST', '/api/auth/sessions/revoke', pair.cookie, JSON.stringify({ sessionId: sid }));
    if (r.status !== 200)
        return { ok: false, error: r.status === 401 || r.status === 403 ? '登录态无效' : (r.status === -1 ? '请求超时' : ('HTTP ' + r.status)) };
    return { ok: true };
}
async function importPendingTokenIfAny() {
    const p = path.join(os.homedir(), '.cursor', 'cursor-account-manager-pending-import.txt');
    const legacyPending = [
        path.join(os.homedir(), '.cursor', 'keepchat-pending-import.txt'),
        path.join(os.homedir(), '.cursor', 'cursor-accounts-pending-import.txt')
    ];
    try {
        if (!fs.existsSync(p)) {
            for (const old of legacyPending) {
                if (fs.existsSync(old)) {
                    fs.renameSync(old, p);
                    break;
                }
            }
        }
    } catch { }
    try {
        if (!fs.existsSync(p))
            return;
        const token = String(fs.readFileSync(p, 'utf8') || '').trim();
        try { fs.unlinkSync(p); } catch { }
        if (!token)
            return;
        const r = await addAccountFromToken(token);
        if (r.ok)
            vscode.window.showInformationMessage('账号管理：已导入待添加账号' + (r.duplicate ? '（同账号已更新）' : '') + (r.error ? '，但读额度失败' : ''));
        else
            vscode.window.showErrorMessage('账号管理：待导入令牌失败 - ' + (r.error || ''));
        provider?.postState();
    }
    catch { }
}


function sandAppRoot() {
    const configured = String(cfgGet('sandAppRoot') || '').trim();
    return configured || (vscode.env && vscode.env.appRoot) || '';
}
function sandStateRoot() {
    return (extensionContext && extensionContext.globalStorageUri && extensionContext.globalStorageUri.fsPath) || sandPatcher.defaultStateRoot();
}
function sandGlobalStorageDir() {
    if (process.platform === 'darwin')
        return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
    if (process.platform === 'win32')
        return path.join(process.env.APPDATA || os.homedir(), 'Cursor', 'User', 'globalStorage');
    return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage');
}
function knownSandStateRoots() {
    const list = [];
    const add = (p) => {
        const n = String(p || '').trim();
        if (n && !list.includes(n))
            list.push(n);
    };
    add(sandStateRoot());
    add(path.join(sandGlobalStorageDir(), 'leila-local.cursor-sand-router'));
    add(sandPatcher.defaultStateRoot());
    try {
        const gs = sandGlobalStorageDir();
        for (const name of fs.readdirSync(gs)) {
            if (/sand-router|sandrouter/i.test(name))
                add(path.join(gs, name));
        }
    }
    catch { }
    return list;
}
function pickRestoreStateRoot(appRoot) {
    const roots = knownSandStateRoots();
    if (appRoot) {
        for (const root of roots) {
            try {
                if (sandPatcher.findLatestManifest(appRoot, root))
                    return root;
            }
            catch { }
        }
    }
    for (const root of roots) {
        try {
            if (fs.existsSync(path.join(root, 'backups')))
                return root;
        }
        catch { }
    }
    return path.join(sandGlobalStorageDir(), 'leila-local.cursor-sand-router');
}
function shellQuote(value) {
    return "'" + String(value || '').replace(/'/g, "'\\''") + "'";
}
function sandCliPath() {
    const ext = extensionContext && extensionContext.extensionPath;
    if (ext)
        return path.join(ext, 'dist', 'sandCli.js');
    return path.join(__dirname, 'sandCli.js');
}
function sandManualCommands() {
    const cli = sandCliPath();
    const app = sandAppRoot() || sandPatcher.defaultAppRoot();
    const applyRoot = sandStateRoot();
    const restoreRoot = pickRestoreStateRoot(app);
    return {
        cli,
        appRoot: app,
        applyStateRoot: applyRoot,
        restoreStateRoot: restoreRoot,
        status: 'node ' + shellQuote(cli) + ' status --app-root ' + shellQuote(app),
        apply: 'node ' + shellQuote(cli) + ' apply --app-root ' + shellQuote(app) + ' --state-root ' + shellQuote(applyRoot),
        restore: 'node ' + shellQuote(cli) + ' restore --force --app-root ' + shellQuote(app) + ' --state-root ' + shellQuote(restoreRoot)
    };
}
function sandStatusForClient() {
    const cmds = (() => { try { return sandManualCommands(); } catch { return { status: '', apply: '', restore: '' }; } })();
    try {
        const root = sandAppRoot();
        if (!root)
            return { patched: false, version: '', sand: 0, unpatched: 0, error: '未找到 Cursor 安装目录', auto: sandAutoPatchEnabled(), commands: cmds };
        const s = sandPatcher.inspect(root);
        return {
            patched: !!s.patched,
            version: s.version || '',
            sand: (s.totals && s.totals.sandAssignments) || 0,
            unpatched: (s.totals && s.totals.unpatchedAssignments) || 0,
            error: '',
            auto: sandAutoPatchEnabled(),
            restoreRoot: cmds.restoreStateRoot || '',
            commands: cmds
        };
    }
    catch (e) {
        return { patched: false, version: '', sand: 0, unpatched: 0, error: (e && e.message) || String(e), auto: sandAutoPatchEnabled(), commands: cmds };
    }
}
function sandAutoPatchEnabled() {
    return cfgGet('sandAutoPatch') === true;
}
function refreshSandStatusBar() {
    if (!sandStatusBar)
        return;
    const s = sandStatusForClient();
    if (s.error) {
        sandStatusBar.text = '$(warning) Sand 异常';
        sandStatusBar.tooltip = s.error;
    }
    else if (s.patched) {
        sandStatusBar.text = '$(check) Sand 已注入';
        sandStatusBar.tooltip = 'x-cursor-client-type = sand\n点击打开账号管理';
    }
    else {
        sandStatusBar.text = '$(circle-slash) Sand 未注入';
        sandStatusBar.tooltip = '点击打开账号管理，一键注入';
    }
    sandStatusBar.command = CMD_OPEN;
}
async function applySandPatchFromUi() {
    const cliPath = path.join(__dirname, 'sandCli.js');
    const appRoot = sandAppRoot();
    const stateRoot = sandStateRoot();
    try {
        const result = sandPatcher.applyPatch({ appRoot, stateRoot });
        refreshSandStatusBar();
        provider?.postState();
        return result;
    } catch (e) {
        if (e && e.code === 'EPERM' || (e.message && e.message.includes('EPERM'))) {
            const args = ['apply', '--app-root', appRoot, '--state-root', stateRoot, '--json'];
            const result = await runElevated(cliPath, args);
            refreshSandStatusBar();
            provider?.postState();
            return result;
        }
        throw e;
    }
}
async function restoreSandPatchFromUi() {
    const appRoot = sandAppRoot();
    const preferred = pickRestoreStateRoot(appRoot);
    const roots = [preferred].concat(knownSandStateRoots().filter((r) => r !== preferred));
    let lastErr = null;
    for (const root of roots) {
        try {
            let result;
            try {
                result = sandPatcher.restoreLatest({ appRoot, stateRoot: root, force: true });
            } catch (e) {
                if (e && (e.code === 'EPERM' || (e.message && e.message.includes('EPERM')))) {
                    const cliPath = path.join(__dirname, 'sandCli.js');
                    const args = ['restore', '--app-root', appRoot, '--state-root', root, '--force', '--json'];
                    result = await runElevated(cliPath, args);
                } else {
                    throw e;
                }
            }
            refreshSandStatusBar();
            provider?.postState();
            return result;
        }
        catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('没有找到可回滚的备份。可用面板里的「复制卸载命令」手动指定 --state-root');
}
function promptSandRestart(kind) {
    provider?.post({
        type: 'retryNeedsRestart',
        message: kind === 'restore'
            ? 'Sand 补丁已卸载（已 --force 还原备份）。必须完整退出 Cursor 再打开，Reload Window 不够。'
            : 'Sand 补丁已写入磁盘。必须完整退出 Cursor 再打开，Reload Window 不会重载主进程。',
        action: 'sandPatch',
        restartCommand: 'restartCursor'
    });
}


