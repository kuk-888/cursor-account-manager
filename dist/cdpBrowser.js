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
exports.findBrowserPath = findBrowserPath;
exports.launchInjectedBrowser = launchInjectedBrowser;
// 零依赖 Chrome DevTools 驱动：用 --remote-debugging-port 起浏览器，按 DevToolsActivePort 文件拿到实际端口，
// 再用自实现的极简 WebSocket 客户端连 CDP（仅 Node 内置 net/http/crypto，不引任何 npm 包，vsix 出包不带 node_modules）。
// 为什么不用 --remote-debugging-pipe：Windows 上 Node 无法按 Chrome 期望的方式把 fd3/fd4 句柄传给子进程，
// 浏览器一启动就因管道连不上而退出（即"浏览器已退出"）。端口+WebSocket 不依赖 fd 继承，且不怕进程自我交接。
// 用途：起一个隔离的可见浏览器（临时 user-data-dir），注入 Cursor 会话 cookie，再导航到授权页。
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const net = __importStar(require("net"));
const crypto = __importStar(require("crypto"));
// 查找本机 Chrome / Edge / Chromium 可执行文件。找不到返回 ''。
function findBrowserPath() {
    const c = [];
    if (process.platform === 'win32') {
        const pf = process.env['PROGRAMFILES'] || 'C:\\Program Files';
        const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const la = process.env['LOCALAPPDATA'] || '';
        c.push(path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), path.join(la, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(la, 'Microsoft\\Edge\\Application\\msedge.exe'));
    }
    else if (process.platform === 'darwin') {
        c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
    }
    else {
        c.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
    }
    for (const p of c) {
        try {
            if (p && fs.existsSync(p))
                return p;
        }
        catch { }
    }
    return '';
}
function rmDirBestEffort(dir, tries = 5) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        return;
    }
    catch { }
    if (tries > 0)
        setTimeout(() => rmDirBestEffort(dir, tries - 1), 1500);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// 等 Chrome/Edge 把实际调试端口写进 <user-data-dir>/DevToolsActivePort（首行即端口号）。
async function waitForDevToolsPort(userDataDir, timeoutMs) {
    const file = path.join(userDataDir, 'DevToolsActivePort');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const txt = fs.readFileSync(file, 'utf8');
            const port = Number(String(txt).split('\n')[0].trim());
            if (port > 0)
                return port;
        }
        catch { }
        await sleep(150);
    }
    return 0;
}
// GET http://127.0.0.1:<port>/json 等，返回解析后的 JSON。
function httpGetJson(port, pathname, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', timeout: timeoutMs }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => raw += c);
            res.on('end', () => { try {
                resolve(JSON.parse(raw));
            }
            catch (e) {
                reject(e);
            } });
        });
        req.on('timeout', () => req.destroy(new Error('http 超时')));
        req.on('error', reject);
        req.end();
    });
}
// 极简 WebSocket(RFC6455) 客户端：仅文本帧，客户端发送帧带掩码，处理分片与 ping。
class WsCdp {
    constructor(sock) {
        this.buf = Buffer.alloc(0);
        this.msgBuf = Buffer.alloc(0);
        this.nextId = 1;
        this.pending = new Map();
        this.closed = false;
        this.sock = sock;
        sock.on('data', d => this.onData(d));
        sock.on('close', () => this.fail(new Error('浏览器连接已关闭')));
        sock.on('error', () => this.fail(new Error('浏览器连接错误')));
    }
    static connect(wsUrl, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const m = /^ws:\/\/([^:/]+):(\d+)(\/.*)$/.exec(wsUrl);
            if (!m) {
                reject(new Error('非法 ws 地址: ' + wsUrl));
                return;
            }
            const host = m[1], port = Number(m[2]), reqPath = m[3];
            const key = crypto.randomBytes(16).toString('base64');
            const sock = net.connect(port, host);
            let settled = false;
            let hbuf = Buffer.alloc(0);
            const done = (err, inst) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(to);
                sock.removeListener('data', onHandshake);
                sock.removeListener('error', onErr);
                if (err) {
                    try {
                        sock.destroy();
                    }
                    catch { }
                    reject(err);
                }
                else
                    resolve(inst);
            };
            const to = setTimeout(() => done(new Error('ws 握手超时')), timeoutMs);
            const onErr = (e) => done(e instanceof Error ? e : new Error(String(e)));
            const onHandshake = (d) => {
                hbuf = Buffer.concat([hbuf, d]);
                const idx = hbuf.indexOf('\r\n\r\n');
                if (idx < 0)
                    return;
                const statusLine = hbuf.slice(0, idx).toString('utf8').split('\r\n')[0];
                if (!/\b101\b/.test(statusLine)) {
                    done(new Error('ws 握手失败: ' + statusLine));
                    return;
                }
                const rest = hbuf.slice(idx + 4);
                const inst = new WsCdp(sock);
                done(null, inst);
                if (rest.length)
                    inst.onData(rest);
            };
            sock.on('connect', () => {
                sock.write('GET ' + reqPath + ' HTTP/1.1\r\n' +
                    'Host: ' + host + ':' + port + '\r\n' +
                    'Upgrade: websocket\r\n' +
                    'Connection: Upgrade\r\n' +
                    'Sec-WebSocket-Key: ' + key + '\r\n' +
                    'Sec-WebSocket-Version: 13\r\n\r\n');
            });
            sock.on('data', onHandshake);
            sock.on('error', onErr);
        });
    }
    send(method, params = {}, timeoutMs = 15000) {
        if (this.closed)
            return Promise.reject(new Error('连接已关闭'));
        const id = this.nextId++;
        const frame = this.encodeFrame(Buffer.from(JSON.stringify({ id, method, params }), 'utf8'), 0x1);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.sock.write(frame);
            }
            catch (e) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(e);
            }
        });
    }
    // opcode: 0x1 文本 / 0x8 关闭 / 0xA pong。客户端帧必须带 4 字节掩码。
    encodeFrame(payload, opcode) {
        const len = payload.length;
        const mask = crypto.randomBytes(4);
        let header;
        if (len < 126) {
            header = Buffer.from([0x80 | opcode, 0x80 | len]);
        }
        else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(len, 2);
        }
        else {
            header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
            header.writeUInt32BE(len >>> 0, 6);
        }
        const masked = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++)
            masked[i] = payload[i] ^ mask[i & 3];
        return Buffer.concat([header, mask, masked]);
    }
    onData(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        while (!this.closed) {
            const frame = this.tryParseFrame();
            if (!frame)
                break;
            const { fin, opcode, payload } = frame;
            if (opcode === 0x8) {
                this.fail(new Error('浏览器发送关闭帧'));
                return;
            }
            if (opcode === 0x9) {
                try {
                    this.sock.write(this.encodeFrame(payload, 0xA));
                }
                catch { }
                continue;
            } // ping → pong
            if (opcode === 0xA)
                continue; // pong
            // 0x1 文本 / 0x0 续帧
            this.msgBuf = Buffer.concat([this.msgBuf, payload]);
            if (fin) {
                const text = this.msgBuf.toString('utf8');
                this.msgBuf = Buffer.alloc(0);
                this.handleMessage(text);
            }
        }
    }
    tryParseFrame() {
        const b = this.buf;
        if (b.length < 2)
            return null;
        const fin = (b[0] & 0x80) !== 0;
        const opcode = b[0] & 0x0f;
        const masked = (b[1] & 0x80) !== 0;
        let len = b[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
            if (b.length < 4)
                return null;
            len = b.readUInt16BE(2);
            offset = 4;
        }
        else if (len === 127) {
            if (b.length < 10)
                return null;
            len = b.readUInt32BE(2) * 2 ** 32 + b.readUInt32BE(6);
            offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (b.length < offset + maskLen + len)
            return null;
        let payload;
        if (masked) {
            const mkey = b.slice(offset, offset + 4);
            const start = offset + 4;
            payload = Buffer.allocUnsafe(len);
            for (let i = 0; i < len; i++)
                payload[i] = b[start + i] ^ mkey[i & 3];
        }
        else {
            payload = b.slice(offset, offset + len);
        }
        this.buf = b.slice(offset + maskLen + len);
        return { fin, opcode, payload };
    }
    handleMessage(text) {
        let msg;
        try {
            msg = JSON.parse(text);
        }
        catch {
            return;
        }
        if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error)
                p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            else
                p.resolve(msg.result);
        }
    }
    fail(err) {
        if (this.closed)
            return;
        this.closed = true;
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
        try {
            this.sock.destroy();
        }
        catch { }
    }
    close() { if (!this.closed) {
        this.closed = true;
        try {
            this.sock.destroy();
        }
        catch { }
    } }
}
// 起隔离浏览器、注入 cookie、导航到授权页。成功返回 close()（轮询结束后调用以关浏览器+清临时目录）。
async function launchInjectedBrowser(opts) {
    const noop = () => { };
    const exe = findBrowserPath();
    if (!exe)
        return { ok: false, error: '未找到 Chrome/Edge 浏览器，请安装后重试', close: noop };
    let userDataDir = '';
    try {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-account-manager-cdp-'));
    }
    catch (e) {
        return { ok: false, error: '创建临时目录失败：' + String(e && e.message || e), close: noop };
    }
    const args = [
        '--remote-debugging-port=0', // 0 = 让浏览器自选空闲端口，写入 DevToolsActivePort
        '--user-data-dir=' + userDataDir, // 独立临时配置：干净环境、独立 cookie，效果等同无痕
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--new-window',
        'about:blank' // 先开空白页，便于注入 cookie 后再导航
    ];
    let proc;
    try {
        proc = (0, child_process_1.spawn)(exe, args, { stdio: 'ignore', windowsHide: false });
    }
    catch (e) {
        rmDirBestEffort(userDataDir);
        return { ok: false, error: '启动浏览器失败：' + String(e && e.message || e), close: noop };
    }
    const cleanup = () => { try {
        proc.kill();
    }
    catch { } rmDirBestEffort(userDataDir); };
    try {
        const port = await waitForDevToolsPort(userDataDir, 15000);
        if (!port) {
            cleanup();
            return { ok: false, error: '浏览器调试端口未就绪（DevToolsActivePort 未生成）', close: noop };
        }
        // 找一个可调试的页面 target（about:blank），拿它的 webSocketDebuggerUrl。
        let wsUrl = '';
        for (let i = 0; i < 40; i++) {
            try {
                const list = await httpGetJson(port, '/json');
                const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
                if (page) {
                    wsUrl = String(page.webSocketDebuggerUrl);
                    break;
                }
            }
            catch { }
            await sleep(200);
        }
        if (!wsUrl) {
            cleanup();
            return { ok: false, error: '未找到可调试页面（调试端口已起但无 page target）', close: noop };
        }
        const cdp = await WsCdp.connect(wsUrl, 15000);
        await cdp.send('Network.enable', {});
        // 注入会话 cookie（domain 形式，与页面上下文无关）。值即 userId%3A%3AaccessToken。
        await cdp.send('Network.setCookie', { name: 'WorkosCursorSessionToken', value: opts.cookieValue, domain: '.cursor.com', path: '/', secure: true });
        // 已登录态下打开授权页 → 服务端自动回调或仅需点一下「Authorize」；扩展侧轮询 /auth/poll 拿令牌。
        await cdp.send('Page.navigate', { url: opts.loginUrl });
        return { ok: true, close: () => { try {
                cdp.close();
            }
            catch { } cleanup(); } };
    }
    catch (e) {
        cleanup();
        return { ok: false, error: 'CDP 注入失败：' + String(e && e.message || e), close: noop };
    }
}
