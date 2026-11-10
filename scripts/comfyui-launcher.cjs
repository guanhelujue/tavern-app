/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

function normaliseBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim();
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.port !== '8188' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return DEFAULT_BASE_URL;
}

function isLoopback(value) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function requestOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  return origin || `http://${req.headers?.host || 'localhost:8081'}`;
}

function securityError(req, { requireOrigin = false } = {}) {
  const socket = req.socket || req.connection;
  if (!socket || !isLoopback(socket.remoteAddress)) return '只允许本机浏览器请求。';
  const host = String(req.headers?.host || '');
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return '请求 Host 无效。';
  const hostPort = host.match(/:(\d+)$/)?.[1] || '80';
  if (socket.localPort && Number(hostPort) !== Number(socket.localPort)) return '请求端口无效。';
  const origin = String(req.headers?.origin || '').trim();
  if (requireOrigin && !origin) return '缺少本地页面 Origin。';
  if (origin) {
    if (origin !== `http://${host}`) return '请求来源不是本地酒馆页面。';
  }
  if (String(req.headers?.['x-tavern-local-launch'] || '') !== '1') return '缺少本地启动标记。';
  if (String(req.headers?.['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return '拒绝跨站启动请求。';
  return null;
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding?.('utf8');
    let oversized = false;
    req.on('data', (chunk) => {
      if (oversized) return;
      body += chunk;
      if (body.length > 4096) { oversized = true; body = ''; reject(new Error('请求体过大。')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function createLocalComfyLauncher(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');
  const scriptPath = path.join(projectRoot, 'scripts', 'start-comfyui.ps1');
  const logPath = path.join(projectRoot, 'output', 'comfy-api-server', 'launcher.log');
  const probe = options.probe || (async (baseUrl) => {
    const response = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data && typeof data.system?.comfyui_version === 'string' && data.system.comfyui_version.trim());
  });
  const spawnProcess = options.spawnProcess || ((args) => spawn('powershell.exe', args, { windowsHide: true, shell: false, cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] }));
  let state = { state: 'stopped', message: 'ComfyUI 尚未启动。' };
  let starting = null;

  function snapshot() { return { ...state, ...(state.logPath ? { logPath: state.logPath } : {}) }; }

  async function check(baseUrl) {
    try { return await probe(baseUrl); } catch { return false; }
  }

  function start(origin) {
    if (starting) return starting;
    state = { state: 'starting', message: '正在后台启动 ComfyUI…', logPath };
    starting = (async () => {
      if (await check(DEFAULT_BASE_URL)) {
        state = { state: 'ready', message: 'ComfyUI 已在运行。' };
        return;
      }
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Starting local ComfyUI\n`);
      const append = (chunk) => {
        try { fs.appendFileSync(logPath, chunk); }
        catch { state = { state: 'failed', message: '无法写入启动日志，请检查日志目录权限。', logPath }; }
      };
      let child;
      try { child = spawnProcess([
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
        '-Listen', '127.0.0.1', '-Port', '8188', '-CorsOrigin', origin,
      ]); } catch (error) {
        append(`Launch error: ${error.message}\n`);
        state = { state: 'failed', message: 'ComfyUI 启动失败，请检查启动日志。', logPath }; return;
      }
      child.stdout?.on?.('data', append); child.stderr?.on?.('data', append);
      const result = await new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        let timer;
        const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
        child.once('error', (error) => { append(`Launch error: ${error.message}\n`); finish({ error }); });
        child.once('close', (code) => finish({ code, timedOut }));
        timer = setTimeout(() => { timedOut = true; state = { state: 'failed', message: 'ComfyUI 启动超时，请检查启动日志。', logPath }; }, options.timeoutMs ?? 190000);
        timer.unref?.();
      });
      if (!result.error && await check(DEFAULT_BASE_URL)) {
        state = { state: 'ready', message: 'ComfyUI 已启动并就绪。' };
      } else if (state.state !== 'failed' || !result.timedOut) {
        state = { state: 'failed', message: result.timedOut ? 'ComfyUI 启动超时，请检查启动日志。' : 'ComfyUI 启动失败，请检查启动日志。', logPath };
      }
      return snapshot();
    })().catch((error) => { state = { state: 'failed', message: error.message || 'ComfyUI 启动失败，请检查启动日志。', logPath }; return snapshot(); }).finally(() => { starting = null; });
    return starting;
  }

  return {
    async handle(req, res, next) {
      let url;
      try { url = new URL(req.url || '/', 'http://localhost:8081'); }
      catch { return writeJson(res, 400, { error: '请求地址无效。' }); }
      if (url.pathname !== '/api/local-comfy') return next();
      const security = securityError(req, { requireOrigin: req.method === 'POST' });
      if (security) return writeJson(res, 403, { error: security });
      const baseUrl = normaliseBaseUrl(req.method === 'GET' ? url.searchParams.get('baseUrl') : DEFAULT_BASE_URL);
      if (!baseUrl) return writeJson(res, 400, { error: '仅支持本机 ComfyUI 地址 http://127.0.0.1:8188。' });
      if (req.method === 'GET') {
        if (await check(baseUrl)) state = { state: 'ready', message: 'ComfyUI 已在运行。' };
        else if (state.state === 'ready') state = { state: 'stopped', message: 'ComfyUI 当前未运行。' };
        return writeJson(res, 200, snapshot());
      }
      if (req.method !== 'POST') return writeJson(res, 405, { error: '仅支持 GET 或 POST。' });
      try {
        const raw = await readBody(req);
        if (raw) {
          const body = JSON.parse(raw);
          if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'baseUrl') || (body.baseUrl !== undefined && (typeof body.baseUrl !== 'string' || !normaliseBaseUrl(body.baseUrl)))) return writeJson(res, 400, { error: '请求体只能包含合法的 baseUrl。' });
        }
      }
      catch (error) { return writeJson(res, 400, { error: error.message || '请求体无效。' }); }
      start(requestOrigin(req));
      return writeJson(res, 202, snapshot());
    },
    snapshot,
    normaliseBaseUrl,
  };
}

module.exports = { createLocalComfyLauncher, normaliseBaseUrl, securityError };
