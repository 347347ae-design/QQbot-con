import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

// Load Schemastery from the running dsh installation so the settings system can
// serve this plugin's configuration (Client `configForms` needs a served namespace).
async function loadSchema() {
  try {
    const { pathToFileURL } = await import('node:url');
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs'));
      candidates.push(path.join(process.resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs'));
    }
    candidates.push(path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs'));
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const mod = await import(pathToFileURL(p).href);
        if (mod && (mod.Schema || mod.default)) return mod.Schema || mod.default;
      } catch {}
    }
    const mod = await import('@deepseek-ai/schemastery');
    return mod.Schema || mod.default;
  } catch {
    return undefined;
  }
}

const Schema = await loadSchema();

const GroupRule = Schema ? Schema.object({
  groupId: Schema.string().default(''),
  mode: Schema.string().default('at'),
  probability: Schema.number().default(0.2),
  mentionProbability: Schema.number().default(0.85),
  cooldownSec: Schema.number().default(900),
  muteKeywords: Schema.array(Schema.string()).default(['闭嘴']),
}) : undefined;

export const Config = Schema ? Schema.object({
  enabled: Schema.boolean().default(true),
  bot: Schema.object({
    name: Schema.string().default('烟猫'),
    selfQQ: Schema.number().default(0),
    httpEndpoint: Schema.string().default(''),
    workspacePath: Schema.string().default(''),
    token: Schema.string().default(''),
  }).default({}),
  autoAdapt: Schema.object({ enabled: Schema.boolean().default(false) }).default({}),
  remote: Schema.object({
    host: Schema.string().default(''),
    user: Schema.string().default('root'),
    port: Schema.number().default(22),
    keyPath: Schema.string().default(''),
    jsonPath: Schema.string().default('/opt/astrbot/data/qqbot_groups.json'),
  }).default({}),
  groups: Schema.array(GroupRule).default([]),
}) : undefined;


const FEATURE_NAMES = ['steam', 'classReminder', 'vjudgeContest', 'vjudgeProgress', 'freechat', 'shutup'];

const DEFAULTS = {
  enabled: true,
  bot: { name: '烟猫', workspacePath: '', httpEndpoint: '', selfQQ: 0, token: '' },
  autoAdapt: { enabled: false },
  remote: { host: '', user: 'root', port: 22, keyPath: '', jsonPath: '/opt/astrbot/data/qqbot_groups.json' },
  groups: [],
  steam: { enabled: false, apiKey: '', watchList: {}, privateList: {}, reportGroup: 0, bindGroups: [], dealsIntervalSec: 1800, summaryWeekday: 1, summaryHour: 20 },
  classReminder: { enabled: false, groupId: 0, leadMin: 10, week1Monday: '2026-08-31', schedules: {}, builtinHolidays: [['2026-10-01', '2026-10-07', '国庆节'], ['2027-01-01', '2027-01-03', '元旦']] },
  vjudgeContest: { enabled: false, contestId: '848881', targetUmo: '', monitorEnabled: false, pollIntervalSec: 60, reportIntervalSec: 600 },
  vjudgeProgress: { enabled: false, workbookId: '20406', totalProblems: 50, rosterIntervalSec: 1800, missThreshold: 2, guardRatio: 0.5 },
  freechat: { enabled: false, groups: [], probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, mentionCooldownSec: 300 },
  shutup: { enabled: false, muteSeconds: 600, triggerKeywords: ['闭嘴', '别说了', '安静'] },
};

function mergeDefaults(user, defs) {
  const out = { ...defs };
  for (const k of Object.keys(user || {})) {
    if (user[k] && typeof user[k] === 'object' && !Array.isArray(user[k]) && defs[k] && typeof defs[k] === 'object' && !Array.isArray(defs[k])) {
      out[k] = mergeDefaults(user[k], defs[k]);
    } else {
      out[k] = user[k];
    }
  }
  return out;
}

function featureLabel(key) {
  const labels = {
    steam: 'Steam 监控',
    classReminder: '课表提醒',
    vjudgeContest: 'VJudge 比赛监控',
    vjudgeProgress: 'VJudge 题单进度',
    freechat: '免@自动聊天',
    shutup: '闭嘴开关',
  };
  return labels[key] || key;
}

function makeOutput() {
  return {
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    render: function (_args, value) {
      return [{ type: 'text', text: value.text }];
    },
  };
}

// ---------- 工作区扫描：识别机器人并提取可回填字段 ----------

function readTextSafe(file, maxLen = 200000) {
  try {
    const text = fs.readFileSync(file, 'utf-8');
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  } catch {
    return '';
  }
}

function firstMatch(text, re) {
  const m = re.exec(text);
  return m ? String(m[1] || '').trim() : '';
}

async function astrbotAccountInfo(baseDir) {
  const out = { selfQQ: 0, name: '', endpoint: '' };
  let base = baseDir;
  for (const sub of ['AstrBot', 'astrbot']) {
    const candidate = path.join(baseDir, sub);
    if (fs.existsSync(candidate)) { base = candidate; break; }
  }
  try {
    const text = readTextSafe(path.join(base, 'data', 'cmd_config.json'));
    if (!text) return out;
    const m = text.match(/"id"\s*:\s*"qq_(\d{5,12})"/);
    if (m) out.selfQQ = Number(m[1]);
    const ws = text.match(/"ws_reverse_host"\s*:\s*"([^"]+)"[\s\S]{0,200}?"ws_reverse_port"\s*:\s*(\d+)/);
    if (ws) out.endpoint = 'ws://' + ws[1] + ':' + ws[2];
    const persona = (text.match(/"default_personality"\s*:\s*"([^"]+)"/) || [])[1] || '';
    if (persona) {
      try {
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(base, 'data', 'data_v4.db');
        if (fs.existsSync(dbPath)) {
          const db = new DatabaseSync(dbPath, { readOnly: true });
          const row = db.prepare('select system_prompt from personas where persona_id = ? limit 1').get(persona);
          // Persona text describes a role, not the QQ account's current nickname; keep it only as a hint.
          if (row && row.system_prompt) out.personaHint = persona;
          db.close();
        }
      } catch (e) {
        // node:sqlite unavailable or DB locked; identity falls back to other sources.
      }
    }
  } catch {}
  return out;
}

async function findNameNearQQ(root, qq) {
  if (!qq) return '';
  const dirs = [root];
  for (const sub of ['docs', 'doc', '说明', '文档']) {
    const p = path.join(root, sub);
    if (fs.existsSync(p)) dirs.push(p);
  }
  const qqStr = String(qq);
  let checked = 0;
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (checked >= 40) return '';
      if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name)) continue;
      checked += 1;
      const text = readTextSafe(path.join(dir, entry.name), 256000);
      if (!text || !text.includes(qqStr)) continue;
      const m = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,12})机器人/);
      if (m) return m[1];
      const line = text.split(/\r?\n/).find((l) => l.includes(qqStr) && /机器人|bot/i.test(l));
      if (line) {
        const m2 = line.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,12})\s*(?:机器人|bot)/i);
        if (m2) return m2[1];
      }
    }
  }
  return '';
}

function likelyGroupId(id) {
  const gid = String(id || '');
  if (!/^\d{6,12}$/.test(gid)) return false;
  if (/^(\d)\1+$/.test(gid)) return false; // 111111111
  if (gid === '123456789') return false;
  if (gid.startsWith('7656119')) return false; // SteamID64
  if (gid === String(currentConfig.bot && currentConfig.bot.selfQQ)) return false;
  return true;
}

function discoverGroups(root) {
  const map = new Map();
  const add = (id, name, source) => {
    const gid = String(id || '').trim();
    if (!likelyGroupId(gid)) return;
    if (!map.has(gid)) map.set(gid, { id: gid, name: name || '', sources: [source] });
    else {
      const e = map.get(gid);
      if (name && !e.name) e.name = name;
      if (!e.sources.includes(source)) e.sources.push(source);
    }
  };
  const parent = path.dirname(root);
  const docDirs = [root, path.join(root, 'docs'), parent];
  const logDirs = [
    path.join(parent, '机器人文件', 'AstrBot', 'data', 'logs'),
    path.join(parent, '机器人文件'),
    parent,
    root,
    path.join(root, 'data', 'logs'),
    path.join(root, 'logs'),
  ].filter((p) => fs.existsSync(p));

  const docs = [];
  for (const dir of docDirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) docs.push(path.join(dir, entry.name));
      }
    } catch {}
  }
  for (const file of docs.slice(0, 40)) {
    const text = readTextSafe(file, 256000);
    if (!text) continue;
    for (const m of text.matchAll(/群\s*(?:号|id|ID)?\s*[：:]\s*(\d{6,12})/g)) add(m[1], '', path.basename(file));
    for (const m of text.matchAll(/群\s+(\d{6,12})/g)) add(m[1], '', path.basename(file));
  }

  const logs = [];
  for (const dir of logDirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.log$/i.test(entry.name)) logs.push(path.join(dir, entry.name));
      }
    } catch {}
  }
  for (const file of logs.slice(0, 20)) {
    let text = '';
    try {
      const size = fs.statSync(file).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(Math.max(0, size - start));
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/GroupMessage:(\d{6,12})/g)) add(m[1], '', path.basename(file));
  }
  return Array.from(map.values());
}

function hostFromEndpoint(endpoint) {
  const text = String(endpoint || '').trim();
  if (!text) return '';
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : 'http://' + text).hostname;
  } catch {
    return '';
  }
}

function isLoopbackHost(host) {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
}

function findLocalAstrbotData(workspacePath) {
  const candidates = [];
  if (workspacePath) {
    const parent = path.dirname(workspacePath);
    candidates.push(path.join(parent, '机器人文件', 'AstrBot', 'data'));
    candidates.push(path.join(parent, 'AstrBot', 'data'));
    candidates.push(path.join(workspacePath, 'AstrBot', 'data'));
  }
  candidates.push('D:\\Anno tokoy\\机器人文件\\AstrBot\\data');
  candidates.push(path.join(os.homedir(), 'astrbot', 'data'));
  candidates.push('/opt/astrbot/data');
  for (const dir of candidates) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'cmd_config.json'))) return dir;
      if (dir && fs.existsSync(path.join(dir, 'plugins'))) return dir;
    } catch {}
  }
  return '';
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 25000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || stdout || err.message).trim()));
      else resolve(String(stdout || stderr || '').trim());
    });
  });
}

async function onebotCall(endpoint, token, action, params = {}) {
  const base = /^https?:\/\//i.test(endpoint) ? endpoint : 'http://' + endpoint;
  const url = base.replace(/\/+$/, '') + '/' + action;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(3500),
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (j && j.retcode !== undefined && j.retcode !== 0) throw new Error(j.msg || 'retcode ' + j.retcode);
  return j && j.data !== undefined ? j.data : j;
}

async function fetchGroupList(endpoint) {
  if (!endpoint) return [];
  const base = /^https?:\/\//i.test(endpoint) ? endpoint : 'http://' + endpoint;
  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/get_group_list', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const j = await r.json();
    const list = (j && j.data) || [];
    if (!Array.isArray(list)) return [];
    return list.map((g) => ({ id: String(g.group_id), name: String(g.group_name || ''), sources: ['onebot'] }));
  } catch {
    return [];
  }
}

function discoverEndpoints(root) {
  const urls = new Set();
  const hosts = new Set();
  const ports = [3000, 3001, 6700, 5700, 8080];
  if (currentConfig.bot && currentConfig.bot.httpEndpoint) urls.add(String(currentConfig.bot.httpEndpoint).trim());
  const parent = root ? path.dirname(root) : '';
  const dirs = [root, parent, path.join(parent, '机器人文件'), path.join(parent, '机器人文件', 'AstrBot', 'data'), path.join(parent, '机器人文件', 'NapCatNode', 'napcat', 'config')].filter((p) => p && fs.existsSync(p));
  const files = [];
  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && /\.(md|txt|json|ya?ml)$/i.test(entry.name)) files.push(path.join(dir, entry.name));
      }
    } catch {}
  }
  const localHosts = ['127.0.0.1'];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const item of list || []) {
        if (item && item.address && item.family === 'IPv4' && !item.internal) localHosts.push(item.address);
      }
    }
  } catch {}
  for (const file of files.slice(0, 60)) {
    const text = readTextSafe(file, 200000);
    if (!text) continue;
    for (const m of text.matchAll(/https?:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/g)) urls.add(m[0]);
    for (const m of text.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)) hosts.add(m[1]);
  }
  for (const h of hosts) for (const p of ports) urls.add('http://' + h + ':' + p);
  for (const h of localHosts) for (const p of ports) urls.add('http://' + h + ':' + p);
  const list = Array.from(urls);
  list.sort((a, b) => {
    const localA = /127\.0\.0\.1|localhost/.test(a) ? 1 : 0;
    const localB = /127\.0\.0\.1|localhost/.test(b) ? 1 : 0;
    if (localA !== localB) return localA - localB;
    return a.localeCompare(b);
  });
  return list.slice(0, 24);
}

async function scanWorkspaceDetails(root) {
  const picked = pickBestWorkspace(root);
  const candidates = picked.candidates;
  const chosen = picked.chosen;
  const basePath = chosen ? chosen.path : root;
  const type = chosen ? chosen.type : 'unknown';
  const pkg = readJsonFile(path.join(basePath, 'package.json'), {});
  const notes = [];
  const fields = {};
  if (basePath !== root) notes.push('所选目录下发现机器人子目录，已自动定位到 ' + basePath);

  if (type === 'qqbot-skillpack-ts') {
    const idx = readTextSafe(path.join(basePath, 'src', 'index.ts')) || readTextSafe(path.join(basePath, 'src', 'index.js'));
    const endpoint = firstMatch(idx, /httpEndpoint\s*:\s*['"]([^'"]+)['"]/);
    const ws = firstMatch(idx, /wsEndpoint\s*:\s*['"]([^'"]+)['"]/);
    const selfQQ = firstMatch(idx, /selfQQ\s*:\s*(\d+)/);
    if (endpoint) fields.httpEndpoint = endpoint;
    if (ws) notes.push('检测到 WebSocket 端点：' + ws);
    if (selfQQ && Number(selfQQ) > 0) fields.selfQQ = Number(selfQQ);

    const cfgDir = path.join(basePath, 'config');
    try {
      for (const f of fs.readdirSync(cfgDir)) {
        if (f.endsWith('.example') || f.endsWith('.sample')) continue;
        const text = readTextSafe(path.join(cfgDir, f));
        if (!text) continue;
        if (!fields.selfQQ) {
          const qq = firstMatch(text, /self_?qq\s*:\s*['"]?(\d{5,12})/i);
          if (qq) fields.selfQQ = Number(qq);
        }
        if (!fields.name) {
          const nick = firstMatch(text, /bot_?name\s*:\s*['"]([^'"]+)['"]/i);
          if (nick) fields.name = nick;
        }
        if (f.includes('freechat')) {
          const ids = Array.from(text.matchAll(/^\s*-\s*(\d{5,12})\s*$/gm)).map((x) => x[1]);
          if (ids.length) fields.groupIds = ids;
        }
      }
    } catch {}

    if (pkg.description) notes.push(String(pkg.description).slice(0, 120));
  } else if (type === 'napcat') {
    const napcatDir = fs.existsSync(path.join(basePath, 'napcat')) ? path.join(basePath, 'napcat') : path.join(basePath, 'NapCat');
    const qq = scanDirForQQ(path.join(napcatDir, 'config'));
    if (qq) fields.selfQQ = qq;
    notes.push('NapCat 工作区：已尝试从 config 读取 QQ 账号');
  } else if (type === 'astrbot-python') {
    const dataDir = path.join(basePath, 'data');
    const cmdText = readTextSafe(path.join(dataDir, 'cmd_config.json'));
    if (cmdText) {
      const qq = firstMatch(cmdText, /"?(?:qq|qq_account|uin|account)"?\s*[:=]\s*"?(\d{5,12})/i);
      if (qq) fields.selfQQ = Number(qq);
    }
    const qq2 = scanDirForQQ(dataDir);
    if (!fields.selfQQ && qq2) fields.selfQQ = qq2;
    notes.push('AstrBot 工作区：已尝试从 data/cmd_config.json 读取登录账号');
  } else if (type === 'qqbot-package') {
    notes.push('该目录是 QQ 机器人相关包，但未找到可识别的 src/plugins 结构');
  }

  if (!fields.name) fields.name = '';
  fields.workspacePath = basePath;

  // Merge account identity from sibling robot runtimes (AstrBot / NapCat) even when
  // the selected directory itself is the SkillPack codebase.
  for (const candidate of candidates) {
    if (candidate.type !== 'astrbot-python') continue;
    const info = await astrbotAccountInfo(candidate.path);
    if (!fields.selfQQ && info.selfQQ) {
      fields.selfQQ = info.selfQQ;
      notes.push('从 AstrBot 配置识别到登录账号 ' + info.selfQQ + (info.endpoint ? '（反向 WS ' + info.endpoint + '）' : ''));
    }
    break;
  }

  // The QQ account nickname is not stored in local configs; look for a handover
  // document that pairs the number with a bot name (e.g. "烟猫机器人 / QQ 3601...").
  if (!fields.name && fields.selfQQ) {
    const nm = await findNameNearQQ(root, fields.selfQQ);
    if (nm) {
      fields.name = nm;
      notes.push('从交接文档识别到名称「' + nm + '」');
    }
  }

  return { type, fields, notes, candidates };
}

function rankType(type) {
  if (type === 'qqbot-skillpack-ts') return 0;
  if (type === 'napcat') return 1;
  if (type === 'astrbot-python') return 2;
  if (type === 'qqbot-package') return 3;
  return 4;
}

function pickBestWorkspace(root) {
  const candidates = [];
  const directType = detectWorkspaceType(root);
  if (directType !== 'unknown') candidates.push({ path: root, type: directType });
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const type = detectWorkspaceType(dir);
      if (type !== 'unknown') candidates.push({ path: dir, type });
    }
  } catch {}
  candidates.sort((a, b) => rankType(a.type) - rankType(b.type));
  return { chosen: candidates[0] || null, candidates };
}

function scanDirForQQ(dir, depth = 2) {
  if (!dir || depth < 0) return 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) {
          const nested = scanDirForQQ(full, depth - 1);
          if (nested) return nested;
        }
        continue;
      }
      if (!/\.(json|ya?ml|txt|conf)$/i.test(entry.name)) continue;
      const text = readTextSafe(full);
      if (!text) continue;
      const qq = firstMatch(text, /"?(?:qq|qq_account|uin|account|self_id)"?\s*[:=]\s*"?(\d{5,12})/i);
      if (qq) return Number(qq);
    }
  } catch {}
  return 0;
}

// ---------- 工作区识别 ----------

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function detectWorkspaceType(dir) {
  const pkgPath = path.join(dir, 'package.json');
  const hasPkg = fs.existsSync(pkgPath);
  const pkg = hasPkg ? readJsonFile(pkgPath, {}) : {};
  const name = String(pkg.name || '');

  const hasSrcPlugins = fs.existsSync(path.join(dir, 'src', 'plugins'));
  const hasIndexTs = fs.existsSync(path.join(dir, 'src', 'index.ts'));
  const hasIndexJs = fs.existsSync(path.join(dir, 'src', 'index.js'));
  const hasNapcat = fs.existsSync(path.join(dir, 'napcat')) || fs.existsSync(path.join(dir, 'NapCat'));
  const hasAstrbot = fs.existsSync(path.join(dir, 'AstrBot')) || fs.existsSync(path.join(dir, 'astrbot'));

  if (hasSrcPlugins && (hasIndexTs || hasIndexJs)) return 'qqbot-skillpack-ts';
  if (hasNapcat) return 'napcat';
  if (hasAstrbot) return 'astrbot-python';
  if (/qqbot|skillpack|onebot/i.test(name)) return 'qqbot-package';
  return 'unknown';
}

function scanWorkspaces(workDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(workDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(workDir, entry.name);
      const type = detectWorkspaceType(dir);
      if (type !== 'unknown') {
        results.push({
          name: entry.name,
          path: dir,
          type,
          package: readJsonFile(path.join(dir, 'package.json'), {}).name || '',
        });
      }
    }
  } catch {}
  return results;
}

let currentConfig = mergeDefaults({}, DEFAULTS);
const runtime = {};
for (const key of FEATURE_NAMES) {
  runtime[key] = { enabled: false, started: false };
}

export function apply(ctx, config) {
  currentConfig = mergeDefaults(config || {}, DEFAULTS);
  for (const key of FEATURE_NAMES) {
    runtime[key].enabled = !!(currentConfig[key] && currentConfig[key].enabled);
  }

  const disposers = [];

  // ---- 现有功能开关工具 ----
  for (const key of FEATURE_NAMES) {
    const toggle = {
      name: 'qqbot_' + key + '_toggle',
      title: '切换 ' + featureLabel(key),
      description: '启用或禁用 ' + featureLabel(key) + ' 功能',
      parameters: {
        type: 'object',
        properties: {
          enable: { type: 'boolean', description: 'true=启用，false=禁用' },
        },
        required: ['enable'],
        additionalProperties: false,
      },
      output: makeOutput(),
      execute: async function (args) {
        const enable = args.enable === true;
        runtime[key].enabled = enable;
        currentConfig = mergeDefaults(
          { ...currentConfig, [key]: { ...(currentConfig[key] || {}), enabled: enable } },
          DEFAULTS,
        );
        return {
          text: enable ? ('✅ ' + featureLabel(key) + ' 已启用') : ('⏹️ ' + featureLabel(key) + ' 已禁用'),
        };
      },
    };
    if (typeof ctx.tools.register === 'function') {
      disposers.push(ctx.tools.register(toggle));
    }
  }

  // ---- 新增：检测 QQ 机器人工作区 ----
  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_detect_workspace',
        title: '检测 QQ 机器人工作区',
        description: '扫描指定目录，识别 QQBot_SkillPack、NapCat、AstrBot 等 QQ 机器人工作区',
        parameters: {
          type: 'object',
          properties: {
            workDir: { type: 'string', description: '要扫描的工作区目录，留空则使用 DSH 当前工作目录' },
          },
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const workDir = args.workDir || process.cwd();
          const found = scanWorkspaces(workDir);
          if (found.length === 0) {
            return { text: '❌ 在 ' + workDir + ' 中未发现 QQ 机器人工作区' };
          }
          const lines = ['✅ 发现 ' + found.length + ' 个 QQ 机器人工作区：'];
          for (const f of found) {
            lines.push('  • ' + f.name + ' (' + f.type + ') → ' + f.path);
          }
          return { text: lines.join('\n') };
        },
      }),
    );
  }

  // ---- 新增：一键自动适配 QQ 机器人 ----
  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_auto_adapt',
        title: '一键自动适配 QQ 机器人',
        description: '自动识别工作区里的 QQ 机器人，并写入工作区路径，启用自动适配',
        parameters: {
          type: 'object',
          properties: {
            workDir: { type: 'string', description: '要扫描的工作区目录，留空则使用 DSH 当前工作目录' },
            autoEnable: { type: 'boolean', description: '是否自动启用 autoAdapt，默认 true' },
          },
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const workDir = args.workDir || process.cwd();
          const found = scanWorkspaces(workDir);
          if (found.length === 0) {
            return { text: '❌ 在 ' + workDir + ' 中未发现 QQ 机器人工作区，无法自动适配' };
          }

          found.sort((a, b) => {
            const rank = (t) => (t === 'qqbot-skillpack-ts' ? 0 : t === 'napcat' ? 1 : t === 'astrbot-python' ? 2 : 3);
            return rank(a.type) - rank(b.type);
          });
          const best = found[0];

          const next = JSON.parse(JSON.stringify(currentConfig));
          next.bot.workspacePath = best.path;
          next.autoAdapt = { enabled: args.autoEnable !== false };
          currentConfig = mergeDefaults(next, DEFAULTS);

          const lines = ['✅ 已自动适配：' + best.name + ' (' + best.type + ')'];
          lines.push('  工作区：' + best.path);
          lines.push('  自动适配：' + (next.autoAdapt.enabled ? '已启用' : '未启用'));
          lines.push('  ⚠️ 请在设置页补充 bot.httpEndpoint 和 bot.selfQQ，随后可启用各功能');
          return { text: lines.join('\n') };
        },
      }),
    );
  }

  // ---- 机器人属性 & 固定群触发规则 ----
  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_set_bot',
        title: '修改机器人属性',
        description: '修改机器人昵称、QQ 号、OneBot v11 HTTP 端点、工作区路径和自动适配开关',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '机器人昵称' },
            selfQQ: { type: 'number', description: '机器人自身 QQ 号' },
            httpEndpoint: { type: 'string', description: 'OneBot v11 HTTP 端点，如 http://127.0.0.1:5099' },
            workspacePath: { type: 'string', description: 'QQ 机器人工作区路径' },
            autoAdapt: { type: 'boolean', description: '是否启用自动适配' },
          },
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const bot = currentConfig.bot || {};
          if (args.name !== undefined) bot.name = String(args.name);
          if (args.selfQQ !== undefined) bot.selfQQ = Number(args.selfQQ) || 0;
          if (args.httpEndpoint !== undefined) bot.httpEndpoint = String(args.httpEndpoint);
          if (args.workspacePath !== undefined) bot.workspacePath = String(args.workspacePath);
          currentConfig.bot = bot;
          if (args.autoAdapt !== undefined) currentConfig.autoAdapt = { enabled: args.autoAdapt === true };
          const lines = ['✅ 机器人属性已更新：'];
          lines.push('  昵称：' + (bot.name || '(未设置)'));
          lines.push('  QQ：' + (bot.selfQQ || '(未设置)'));
          lines.push('  端点：' + (bot.httpEndpoint || '(未设置)'));
          lines.push('  工作区：' + (bot.workspacePath || '(未设置)'));
          lines.push('  自动适配：' + (currentConfig.autoAdapt && currentConfig.autoAdapt.enabled ? '开' : '关'));
          return { text: lines.join('\n') };
        },
      }),
    );

    disposers.push(
      ctx.tools.register({
        name: 'qqbot_list_group_rules',
        title: '查看固定群触发规则',
        description: '列出所有已配置的固定群及其触发方式（at / freechat / off）',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: makeOutput(),
        execute: async function () {
          const groups = Array.isArray(currentConfig.groups) ? currentConfig.groups : [];
          if (groups.length === 0) return { text: '当前没有固定群触发规则，可用 qqbot_set_group_rule 添加。' };
          const lines = ['固定群触发规则（' + groups.length + ' 个）：'];
          for (const g of groups) {
            lines.push('  • 群 ' + g.groupId + ' → ' + (g.mode || 'at') +
              ' | 普通概率 ' + (g.probability ?? 0.2) +
              ' | 点名概率 ' + (g.mentionProbability ?? 0.85) +
              ' | 冷却 ' + (g.cooldownSec ?? 900) + 's' +
              ' | 闭嘴词 ' + ((g.muteKeywords || []).join('/') || '(无)'));
          }
          return { text: lines.join('\n') };
        },
      }),
    );

    disposers.push(
      ctx.tools.register({
        name: 'qqbot_set_group_rule',
        title: '设置固定群触发方式',
        description: '新增或更新一个固定群的触发方式：at=必须@；freechat=免@按概率；off=完全静默',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
            mode: { type: 'string', enum: ['at', 'freechat', 'off'], description: '触发方式' },
            probability: { type: 'number', description: '免@普通回复概率，默认 0.2' },
            mentionProbability: { type: 'number', description: '被点名时回复概率，默认 0.85' },
            cooldownSec: { type: 'number', description: '回复冷却秒数，默认 900' },
            muteKeywords: { type: 'array', items: { type: 'string' }, description: '闭嘴触发词列表' },
          },
          required: ['groupId'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId || '').trim();
          if (!gid) return { text: '❌ groupId 不能为空' };
          const groups = Array.isArray(currentConfig.groups) ? currentConfig.groups.slice() : [];
          const idx = groups.findIndex((g) => String(g.groupId) === gid);
          const prev = idx >= 0 ? groups[idx] : { groupId: gid, mode: 'at', probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ['闭嘴'] };
          const nextRule = {
            groupId: gid,
            mode: args.mode || prev.mode || 'at',
            probability: args.probability ?? prev.probability ?? 0.2,
            mentionProbability: args.mentionProbability ?? prev.mentionProbability ?? 0.85,
            cooldownSec: args.cooldownSec ?? prev.cooldownSec ?? 900,
            muteKeywords: args.muteKeywords ?? prev.muteKeywords ?? ['闭嘴'],
          };
          if (idx >= 0) groups[idx] = nextRule; else groups.push(nextRule);
          currentConfig.groups = groups;
          return { text: '✅ 群 ' + gid + ' 触发方式已设为 ' + nextRule.mode + '（免@概率 ' + nextRule.probability + '，点名概率 ' + nextRule.mentionProbability + '，冷却 ' + nextRule.cooldownSec + 's）' };
        },
      }),
    );

    disposers.push(
      ctx.tools.register({
        name: 'qqbot_remove_group_rule',
        title: '删除固定群触发规则',
        description: '删除指定群的触发方式配置',
        parameters: {
          type: 'object',
          properties: { groupId: { type: 'string', description: '群号' } },
          required: ['groupId'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId || '').trim();
          const groups = Array.isArray(currentConfig.groups) ? currentConfig.groups.filter((g) => String(g.groupId) !== gid) : [];
          currentConfig.groups = groups;
          return { text: '✅ 已删除群 ' + gid + ' 的触发规则' };
        },
      }),
    );

    disposers.push(
      ctx.tools.register({
        name: 'qqbot_resolve_trigger',
        title: '判定群消息是否应触发',
        description: '按固定群规则判定一条群消息是否应让机器人响应，以及用哪种方式响应',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
            mentioned: { type: 'boolean', description: '消息是否真的 @ 了机器人' },
            text: { type: 'string', description: '消息文本（用于闭嘴词与点名判断）' },
          },
          required: ['groupId', 'mentioned'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId || '');
          const mentioned = args.mentioned === true;
          const text = String(args.text || '');
          const groups = Array.isArray(currentConfig.groups) ? currentConfig.groups : [];
          const rule = groups.find((g) => String(g.groupId) === gid);
          if (!rule) {
            return { text: mentioned ? '未配置该群，按默认规则：被 @ 时响应（mode=at）' : '未配置该群，默认不响应免@消息' };
          }
          const mode = rule.mode || 'at';
          const keywords = Array.isArray(rule.muteKeywords) ? rule.muteKeywords : [];
          const hitKeyword = keywords.some((k) => k && text.includes(k));
          if (mode === 'off') return { text: '群 ' + gid + ' 为 off：不响应' };
          if (hitKeyword && !mentioned) return { text: '命中闭嘴词：免@消息静默' };
          if (mode === 'at') {
            return { text: mentioned ? '群 ' + gid + ' 为 at：被 @，应响应' : '群 ' + gid + ' 为 at：未 @，不响应' };
          }
          // freechat
          let p = mentioned ? (rule.mentionProbability ?? 0.85) : (rule.probability ?? 0.2);
          const roll = Math.random();
          return {
            text: (roll < p ? '✅ 应响应' : '⏭️ 不响应') + '：群 ' + gid + ' 为 freechat，' +
              (mentioned ? '点名' : '免@') + ' 概率 ' + p + '，本次随机 ' + roll.toFixed(3) +
              '，冷却 ' + (rule.cooldownSec ?? 900) + 's',
          };
        },
      }),
    );
  }

  // ---- 状态工具 ----
  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_status',
        title: 'QQBot 状态',
        description: '查看 QQBot SkillPack 各功能启用/运行状态',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: makeOutput(),
        execute: async function () {
          const lines = [currentConfig.enabled ? 'QQBot SkillPack 总开关：已启用' : 'QQBot SkillPack 总开关：已禁用'];
          lines.push('  机器人工作区：' + (currentConfig.bot.workspacePath || '(未配置)'));
          lines.push('  自动适配：' + (currentConfig.autoAdapt.enabled ? '启用' : '未启用'));
          lines.push('  HTTP 端点：' + (currentConfig.bot.httpEndpoint || '(未配置)'));
          lines.push('  机器人 QQ：' + (currentConfig.bot.selfQQ || '(未配置)'));
          for (const key of FEATURE_NAMES) {
            const r = runtime[key];
            const on = r.enabled && currentConfig.enabled;
            lines.push('  ' + featureLabel(key) + '：' + (on ? '启用' : '禁用') + ' ' + (r.started ? '(已运行)' : '(未启动)'));
          }
          return { text: lines.join('\n') };
        },
      }),
    );

    disposers.push(
      ctx.tools.register({
        name: 'qqbot_set_config',
        title: '设置 QQBot 配置',
        description: '更新 QQBot SkillPack 的配置项（通过 Loader 持久化）',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '配置键，如 steam.apiKey 或 classReminder.groupId 或 bot.workspacePath' },
            value: { description: '新值' },
          },
          required: ['key', 'value'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const next = JSON.parse(JSON.stringify(currentConfig));
          const parts = args.key.split('.');
          let cur = next;
          for (let i = 0; i < parts.length - 1; i++) {
            cur[parts[i]] = cur[parts[i]] || {};
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = args.value;
          try {
            currentConfig = mergeDefaults(next, DEFAULTS);
            for (const k of FEATURE_NAMES) {
              runtime[k].enabled = !!(currentConfig[k] && currentConfig[k].enabled);
            }
            return { text: '✅ 配置已更新：' + args.key };
          } catch (e) {
            return { text: '❌ 配置无效：' + e.message };
          }
        },
      }),
    );
  }

  // ---- 新增：身份标识（移植 yan_identifier）----
  // 给发给 LLM 的文本加上发送者身份前缀，让模型知道是谁在说话
  const IDENTIFIER_RE = /^<[^>]{1,32}>\s/;

  function buildSenderName(userId, nickname, card) {
    const name = (card || nickname || String(userId || '')).replace(/</g, '＜').replace(/>/g, '＞').slice(0, 24);
    return name || String(userId || '');
  }

  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_identifier_prepare',
        title: '身份标识前缀',
        description: '给 LLM 提示词加上发送者身份前缀（<昵称> 内容）',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要发送给 LLM 的原始文本' },
            senderName: { type: 'string', description: '发送者昵称/群名片，留空则不加前缀' },
            userId: { type: 'string', description: '发送者 QQ 号，兜底用' },
            groupCard: { type: 'string', description: '群名片，优先于昵称' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const text = args.text || '';
          if (!text || typeof text !== 'string') return { text: '' };
          if (IDENTIFIER_RE.test(text)) return { text };
          const name = buildSenderName(args.userId, args.senderName, args.groupCard);
          if (!name) return { text };
          return { text: '<' + name + '> ' + text };
        },
      }),
    );
  }

  // ---- 新增：分条发送（移植 yan_split）----
  // 把 LLM 回复里的 | 分隔符拆成多条连续发送，像真人聊天
  const SPLIT_RE = /\s*\|\s*/;
  const MAX_PARTS = 4;
  const WORD_RE = /[\w\u4e00-\u9fff]/;

  function splitReplyText(text) {
    if (!text || !text.includes('|')) return null;
    const parts = text.split(SPLIT_RE).map(p => p.trim()).filter(p => WORD_RE.test(p));
    if (parts.length <= 1) return null;
    if (parts.length > MAX_PARTS) {
      parts.splice(MAX_PARTS - 1, parts.length - (MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join('，'));
    }
    return parts;
  }

  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_split_reply',
        title: '分条发送',
        description: '把 LLM 回复里的 | 分隔拆成多条，返回要连续发送的片段列表',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'LLM 原始回复文本' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              parts: { type: 'array', items: { type: 'string' }, description: '拆分后的消息片段' },
              count: { type: 'number', description: '片段数量' },
            },
            required: ['parts', 'count'],
            additionalProperties: false,
          },
          render: function (_args, value) {
            return [{ type: 'text', text: '共 ' + value.count + ' 条：\n' + value.parts.map((p, i) => (i + 1) + '. ' + p).join('\n') }];
          },
        },
        execute: async function (args) {
          const parts = splitReplyText(args.text || '');
          if (!parts) return { parts: [], count: 0 };
          return { parts, count: parts.length };
        },
      }),
    );
  }

  // ---- 新增：闭嘴闸门（移植 yan_shutup 的 gateLLM）----
  // 闭嘴期内拦截免@消息；真 @ 机器人的定向问答不受影响
  const SHUTUP_STATE_FILE = path.join(process.cwd(), 'data', 'qqbot_shutup.json');

  function ensureShutupDir() {
    try { fs.mkdirSync(path.dirname(SHUTUP_STATE_FILE), { recursive: true }); } catch {}
  }
  function loadShutup() {
    try { return JSON.parse(fs.readFileSync(SHUTUP_STATE_FILE, 'utf-8')); } catch { return {}; }
  }
  function saveShutup(d) {
    ensureShutupDir();
    try { fs.writeFileSync(SHUTUP_STATE_FILE + '.tmp', JSON.stringify(d), 'utf-8'); fs.renameSync(SHUTUP_STATE_FILE + '.tmp', SHUTUP_STATE_FILE); } catch {}
  }

  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_shutup_gate',
        title: '闭嘴闸门判定',
        description: '判定当前消息是否应被闭嘴拦截（闭嘴期内免@消息拦截，真 @ 定向问答不受影响）',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
            mentionedBot: { type: 'boolean', description: '消息中是否有真 @ 机器人' },
          },
          required: ['groupId'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId);
          const d = loadShutup();
          const muted = Date.now() < (d[gid] ?? 0);
          if (!muted) return { text: '未闭嘴，不拦截' };
          if (args.mentionedBot === true) return { text: '真 @ 机器人，不拦截' };
          const remain = Math.max(0, Math.ceil((d[gid] - Date.now()) / 1000));
          return { text: '闭嘴中，还剩 ' + remain + ' 秒，已拦截免@消息' };
        },
      }),
    );
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_shutup_trigger',
        title: '触发闭嘴',
        description: '记录一个群进入闭嘴时长（秒），期间拦截免@消息',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
            seconds: { type: 'number', description: '闭嘴秒数，默认 600' },
          },
          required: ['groupId'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId);
          const seconds = Number(args.seconds) || 600;
          const d = loadShutup();
          d[gid] = Date.now() + seconds * 1000;
          saveShutup(d);
          return { text: '✅ 群 ' + gid + ' 已闭嘴 ' + Math.floor(seconds / 60) + ' 分钟' };
        },
      }),
    );
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_shutup_clear',
        title: '解除闭嘴',
        description: '解除指定群的闭嘴状态',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
          },
          required: ['groupId'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId);
          const d = loadShutup();
          d[gid] = 0;
          saveShutup(d);
          return { text: '✅ 群 ' + gid + ' 已解除闭嘴' };
        },
      }),
    );
  }

  // ---- 新增：免@自动聊天判定（移植 yan_freechat）----
  // 指定群免@自动回复，冷却+概率控制活跃度，点名提高概率
  const FREECHAT_LAST = new Map();

  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_freechat_should_reply',
        title: '免@聊天判定',
        description: '判定指定群当前消息是否应触发免@自动回复（基于冷却与概率）',
        parameters: {
          type: 'object',
          properties: {
            groupId: { type: 'string', description: '群号' },
            text: { type: 'string', description: '原始消息文本' },
            groups: { type: 'array', items: { type: 'string' }, description: '允许免@的群号列表，留空则使用配置' },
            probability: { type: 'number', description: '普通回复概率，默认 0.20' },
            mentionProbability: { type: 'number', description: '点名回复概率，默认 0.85' },
            cooldownSec: { type: 'number', description: '普通冷却秒数，默认 900' },
            mentionCooldownSec: { type: 'number', description: '点名冷却秒数，默认 300' },
          },
          required: ['groupId', 'text'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          const gid = String(args.groupId);
          const text = String(args.text || '').trim();
          if (!text) return { text: '空消息，不回复' };

          const cfg = currentConfig.freechat || {};
          const allowed = args.groups || cfg.groups || [];
          if (!allowed.includes(gid)) return { text: '群不在免@名单，不回复' };

          const now = Date.now();
          const last = FREECHAT_LAST.get(gid) ?? 0;
          const mentioned = /烟猫|机器人/.test(text);
          const cooldown = mentioned ? (args.mentionCooldownSec ?? cfg.mentionCooldownSec ?? 300) : (args.cooldownSec ?? cfg.cooldownSec ?? 900);
          if (now - last < cooldown * 1000) {
            return { text: '冷却中，不回复' };
          }
          const prob = mentioned ? (args.mentionProbability ?? cfg.mentionProbability ?? 0.85) : (args.probability ?? cfg.probability ?? 0.2);
          if (Math.random() >= prob) {
            FREECHAT_LAST.set(gid, now);
            return { text: '概率未命中，不回复' };
          }
          FREECHAT_LAST.set(gid, now);
          return { text: '✅ 触发免@自动回复，建议接 LLM 管道生成真实回复' };
        },
      }),
    );
  }

  if (typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'qqbot_bind_onebot',
        title: '绑定 OneBot 机器人',
        description: '连接 OneBot v11 HTTP 端点，读取登录账号、昵称和全部群，并写入插件配置',
        parameters: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', description: 'OneBot v11 HTTP 端点，如 http://127.0.0.1:3000' },
            token: { type: 'string', description: '访问 token，可留空' },
            importAllGroups: { type: 'boolean', description: '是否把所有群加入触发规则，默认 false' },
            groupIds: { type: 'array', items: { type: 'string' }, description: '要加入规则的群号列表' },
          },
          required: ['endpoint'],
          additionalProperties: false,
        },
        output: makeOutput(),
        execute: async function (args) {
          try {
            const r = await bindOneBotAndFill(String(args.endpoint), String(args.token || ''), args.groupIds || [], args.importAllGroups === true);
            const lines = ['✅ 已绑定 OneBot：' + (r.login.name || '(无名)') + ' · QQ ' + (r.login.selfQQ || '?')];
            lines.push('  群列表：' + r.groups.length + ' 个');
            if (r.added.length) lines.push('  已加入规则：' + r.added.map((g) => (g.name ? g.name + '(' + g.id + ')' : g.id)).join('、'));
            lines.push('  持久化：' + (r.persisted ? '已保存' : '未保存'));
            return { text: lines.join('\n') };
          } catch (e) {
            return { text: '❌ 绑定失败：' + String((e && e.message) || e) };
          }
        },
      }),
    );
  }

  // ---- 同源 HTTP 接口：供设置页“绑定工作区后自动识别” ----
  const findEditorEntry = () => {
    const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : ctx.configEditor;
    if (!editor || typeof editor.entries !== 'function') return null;
    const entry = editor.entries().find((e) => {
      const bag = [e && e.id, e && e.patchId, e && e.name, e && e.entryId].filter(Boolean).join(' ');
      return bag.includes('qqbot-skillpack');
    });
    return entry ? { editor, entry } : null;
  };
  const persistConfig = async () => {
    const found = findEditorEntry();
    if (!found) return false;
    await found.editor.edit(found.entry, (current) => ({
      ...(current || {}),
      bot: currentConfig.bot,
      autoAdapt: currentConfig.autoAdapt,
      groups: currentConfig.groups || [],
    }));
    return true;
  };

  const buildRulesPayload = () => {
    const groups = {};
    for (const g of Array.isArray(currentConfig.groups) ? currentConfig.groups : []) {
      const gid = String(g.groupId || '').trim();
      if (!/^\d{5,12}$/.test(gid)) continue;
      groups[gid] = {
        mode: g.mode || 'at',
        probability: Number(g.probability ?? 0.2),
        mentionProbability: Number(g.mentionProbability ?? 0.85),
        cooldownSec: Number(g.cooldownSec ?? 900),
        mentionCooldownSec: Number(g.mentionCooldownSec ?? 300),
        muteKeywords: Array.isArray(g.muteKeywords) ? g.muteKeywords : [],
      };
    }
    return { updatedAt: new Date().toISOString(), groups };
  };

  const syncGroupRules = async () => {
    const payload = buildRulesPayload();
    const endpointHost = hostFromEndpoint(currentConfig.bot && currentConfig.bot.httpEndpoint);
    const remoteCfg = { ...DEFAULTS.remote, ...(currentConfig.remote || {}) };
    const targetHost = remoteCfg.host || endpointHost;
    const useRemote = !isLoopbackHost(targetHost);
    if (!useRemote) {
      const dataDir = findLocalAstrbotData(currentConfig.bot && currentConfig.bot.workspacePath);
      if (!dataDir) return { ok: false, mode: 'local', error: '未找到本机 AstrBot 数据目录' };
      const dest = path.join(dataDir, 'qqbot_groups.json');
      let installed = false;
      try {
        fs.writeFileSync(dest, JSON.stringify(payload, null, 2), 'utf-8');
        const pluginsDir = path.join(dataDir, 'plugins');
        const targetDir = path.join(pluginsDir, 'astrbot_plugin_dsh_control');
        if (fs.existsSync(pluginsDir) && !fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          const srcDir = path.join(PLUGIN_DIR, 'server', 'astrbot_plugin_dsh_control');
          for (const file of ['main.py', 'metadata.yaml']) fs.copyFileSync(path.join(srcDir, file), path.join(targetDir, file));
          installed = true;
        }
        return { ok: true, mode: 'local', target: dest, groups: Object.keys(payload.groups).length, installed };
      } catch (e) {
        return { ok: false, mode: 'local', error: String(e.message || e) };
      }
    }
    const user = remoteCfg.user || 'root';
    const port = String(remoteCfg.port || 22);
    const keyArgs = remoteCfg.keyPath ? ['-i', remoteCfg.keyPath] : [];
    const sshOpts = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=8'];
    const jsonPath = remoteCfg.jsonPath || '/opt/astrbot/data/qqbot_groups.json';
    const tmp = path.join(os.tmpdir(), 'qqbot_groups.json');
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      await runCommand('scp', ['-P', port, ...keyArgs, ...sshOpts, tmp, user + '@' + targetHost + ':' + jsonPath]);
      const verify = await runCommand('ssh', ['-p', port, ...keyArgs, ...sshOpts, user + '@' + targetHost, 'wc -c ' + jsonPath]);
      return { ok: true, mode: 'remote', target: user + '@' + targetHost, jsonPath, groups: Object.keys(payload.groups).length, verify };
    } catch (e) {
      return { ok: false, mode: 'remote', target: user + '@' + targetHost, error: String(e.message || e) };
    }
  };

  const bindOneBotAndFill = async (endpoint, token, groupIds, importAll) => {
    const login = await onebotCall(endpoint, token, 'get_login_info');
    const groupsRaw = await onebotCall(endpoint, token, 'get_group_list');
    const groups = (Array.isArray(groupsRaw) ? groupsRaw : []).map((g) => ({
      id: String(g.group_id),
      name: String(g.group_name || ''),
    }));
    const selfQQ = Number(login && login.user_id) || 0;
    const nickname = String((login && login.nickname) || '');
    currentConfig.bot = {
      ...(currentConfig.bot || {}),
      httpEndpoint: endpoint,
      token: token || '',
      selfQQ: selfQQ || (currentConfig.bot && currentConfig.bot.selfQQ) || 0,
      name: nickname || (currentConfig.bot && currentConfig.bot.name) || '',
    };
    const wanted = new Set((groupIds || []).map((x) => String(x)));
    const added = [];
    if (importAll === true || wanted.size > 0) {
      const cur = Array.isArray(currentConfig.groups) ? currentConfig.groups.slice() : [];
      for (const g of groups) {
        if (importAll !== true && !wanted.has(g.id)) continue;
        if (cur.some((x) => String(x.groupId) === g.id)) continue;
        cur.push({ groupId: g.id, mode: 'at', probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ['闭嘴'] });
        added.push(g);
      }
      currentConfig.groups = cur;
    }
    let persisted = false;
    try { persisted = await persistConfig(); } catch {}
    return { login: { selfQQ, name: nickname }, groups, added, persisted };
  };
  try {
    const server = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer;
    if (server && typeof server.register === 'function') {
      disposers.push(server.register({
        kind: 'exact',
        path: '/qqbot-skillpack/api/v18',
        handler: async (req, res) => {
          const send = (code, payload) => {
            try {
              res.statusCode = code;
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.setHeader('cache-control', 'no-store');
              res.end(JSON.stringify(payload));
            } catch {}
          };
          if (req.method !== 'POST') {
            send(405, { ok: false, error: 'method not allowed' });
            return;
          }
          let raw = '';
          try {
            for await (const chunk of req) {
              raw += chunk;
              if (raw.length > 65536) {
                send(413, { ok: false, error: 'body too large' });
                return;
              }
            }
          } catch {
            send(400, { ok: false, error: 'read failed' });
            return;
          }
          let body = {};
          try { body = raw ? JSON.parse(raw) : {}; } catch {
            send(400, { ok: false, error: 'invalid json' });
            return;
          }
          const action = String(body.action || 'scan');
          if (action === 'state') {
            send(200, {
              ok: true,
              state: {
                bot: currentConfig.bot || {},
                autoAdapt: currentConfig.autoAdapt || { enabled: false },
                remote: currentConfig.remote || {},
                groups: Array.isArray(currentConfig.groups) ? currentConfig.groups : [],
              },
            });
            return;
          }
          if (action === 'set') {
            const pathArr = Array.isArray(body.path) ? body.path : [];
            if (pathArr.length === 0) {
              send(400, { ok: false, error: 'path required' });
              return;
            }
            let cursor = currentConfig;
            for (let i = 0; i < pathArr.length - 1; i += 1) {
              const key = pathArr[i];
              if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
                cursor[key] = typeof pathArr[i + 1] === 'number' ? [] : {};
              }
              cursor = cursor[key];
            }
            cursor[pathArr[pathArr.length - 1]] = body.value;
            currentConfig = mergeDefaults(currentConfig, DEFAULTS);
            let persisted = false;
            try { persisted = await persistConfig(); } catch {}
            let sync = null;
            if (pathArr[0] === 'groups') {
              try { sync = await syncGroupRules(); } catch (e) { sync = { ok: false, error: String((e && e.message) || e) }; }
            }
            send(200, {
              ok: true,
              persisted,
              sync,
              state: {
                bot: currentConfig.bot || {},
                autoAdapt: currentConfig.autoAdapt || { enabled: false },
                remote: currentConfig.remote || {},
                groups: Array.isArray(currentConfig.groups) ? currentConfig.groups : [],
              },
            });
            return;
          }
          if (action === 'apply_remote') {
            const result = await syncGroupRules();
            send(200, result);
            return;
          }
          if (action === 'onebot') {
            const endpoint = String(body.endpoint || (currentConfig.bot && currentConfig.bot.httpEndpoint) || '').trim();
            const token = String(body.token !== undefined ? body.token : (currentConfig.bot && currentConfig.bot.token) || '');
            if (!endpoint) {
              send(400, { ok: false, error: '请先填写 OneBot HTTP 端点' });
              return;
            }
            try {
              const r = await bindOneBotAndFill(endpoint, token, [], false);
              let sync = null;
              try { sync = await syncGroupRules(); } catch {}
              send(200, {
                ok: true,
                sync,
                ...r,
                state: {
                  bot: currentConfig.bot || {},
                  autoAdapt: currentConfig.autoAdapt || { enabled: false },
                  remote: currentConfig.remote || {},
                  groups: Array.isArray(currentConfig.groups) ? currentConfig.groups : [],
                },
              });
            } catch (e) {
              send(200, { ok: false, error: '连接 OneBot 失败：' + String((e && e.message) || e) });
            }
            return;
          }
          if (action === 'bind_prompt') {
            const prompt = String(body.prompt || '');
            if (!prompt.trim()) {
              send(400, { ok: false, error: '请先输入绑定提示词' });
              return;
            }
            const mUrl = prompt.match(/https?:\/\/[^\s，,；;]+/);
            let explicitEndpoint = mUrl ? mUrl[0].trim() : '';
            if (!explicitEndpoint) {
              const m = prompt.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/);
              if (m) explicitEndpoint = 'http://' + m[0];
            }
            const mTok = prompt.match(/token\s*[:：=]?\s*([A-Za-z0-9_\-]{4,})/i);
            const explicitToken = mTok ? mTok[1] : '';
            const importAll = /全部群|所有群|全部群聊|导入全部/.test(prompt);
            const rootPath = String(body.path || (currentConfig.bot && currentConfig.bot.workspacePath) || '').trim();
            const ids = Array.from(prompt.matchAll(/\b(\d{6,12})\b/g))
              .map((x) => x[1])
              .filter((id) => !explicitEndpoint.includes(id));

            const endpoints = explicitEndpoint
              ? [explicitEndpoint]
              : discoverEndpoints(rootPath).filter((ep) => !ep.includes(':6099'));
            if (endpoints.length === 0) {
              send(200, { ok: false, error: '没有找到可用的 OneBot 端点，请确认 NapCat 已开启 HTTP 服务' });
              return;
            }
            const tokenCandidates = [];
            if (explicitToken) tokenCandidates.push(explicitToken);
            if (currentConfig.bot && currentConfig.bot.token) tokenCandidates.push(String(currentConfig.bot.token));
            tokenCandidates.push('');
            const uniqueTokens = tokenCandidates.filter((v, i, a) => a.indexOf(v) === i);

            let lastError = '';
            const tried = [];
            for (const ep of endpoints) {
              for (const tk of uniqueTokens) {
                tried.push(ep + (tk ? ' (token)' : ''));
                try {
                  const r = await bindOneBotAndFill(ep, tk, ids, importAll);
                  let sync = null;
                  try { sync = await syncGroupRules(); } catch {}
                  send(200, {
                    ok: true,
                    sync,
                    parsed: { endpoint: ep, token: tk ? '***' : '', autoDiscovered: !explicitEndpoint, tried },
                    ...r,
                    state: {
                      bot: currentConfig.bot || {},
                      autoAdapt: currentConfig.autoAdapt || { enabled: false },
                      groups: Array.isArray(currentConfig.groups) ? currentConfig.groups : [],
                    },
                  });
                  return;
                } catch (e) {
                  lastError = String((e && e.message) || e);
                }
              }
            }
            send(200, {
              ok: false,
              error: '自动查找没有连上 OneBot（最后错误：' + lastError + '）。请确认 NapCat 已开启 HTTP 服务；也可以直接写 http://IP:端口 token xxx。',
              tried,
            });
            return;
          }
          if (action === 'groups') {
            const rootPath = String(body.path || (currentConfig.bot && currentConfig.bot.workspacePath) || '').trim();
            const local = rootPath && fs.existsSync(rootPath) ? discoverGroups(rootPath) : [];
            const endpoint = String(body.endpoint || (currentConfig.bot && currentConfig.bot.httpEndpoint) || '').trim();
            const remote = await fetchGroupList(endpoint);
            const merged = new Map();
            for (const g of local) merged.set(g.id, { id: g.id, name: g.name || '', sources: (g.sources || []).slice() });
            for (const g of remote) {
              if (merged.has(g.id)) {
                const hit = merged.get(g.id);
                if (!hit.name) hit.name = g.name;
                if (!hit.sources.includes('onebot')) hit.sources.push('onebot');
              } else {
                merged.set(g.id, { id: g.id, name: g.name || '', sources: ['onebot'] });
              }
            }
            send(200, { ok: true, groups: Array.from(merged.values()), endpointTried: endpoint });
            return;
          }
          if (action === 'check_update') {
            try {
              const info = await checkUpdate();
              send(200, {
                ok: true,
                currentVersion: info.currentVersion,
                latestVersion: info.latestVersion,
                updateAvailable: info.updateAvailable,
                downloadUrl: info.downloadUrl,
                changelog: info.changelog,
                error: info.error,
              });
            } catch (e) {
              send(200, { ok: false, error: '检查更新失败：' + String((e && e.message) || e) });
            }
            return;
          }
          if (action === 'send_group_msg') {
            const endpoint = String(body.endpoint || (currentConfig.bot && currentConfig.bot.httpEndpoint) || '').trim();
            const token = String(body.token !== undefined ? body.token : (currentConfig.bot && currentConfig.bot.token) || '');
            const groupId = body.groupId !== undefined ? String(body.groupId).trim() : '';
            const message = String(body.message || '');
            if (!endpoint) {
              send(400, { ok: false, error: '请先填写 OneBot HTTP 端点' });
              return;
            }
            if (!groupId) {
              send(400, { ok: false, error: 'groupId 不能为空' });
              return;
            }
            if (!message) {
              send(400, { ok: false, error: 'message 不能为空' });
              return;
            }
            try {
              const data = await onebotCall(endpoint, token, 'send_group_msg', {
                group_id: parseInt(groupId, 10) || 0,
                message,
                auto_escape: false,
              });
              send(200, { ok: true, data });
            } catch (e) {
              send(200, { ok: false, error: '发送失败：' + String((e && e.message) || e) });
            }
            return;
          }
          const target = String(body.path || '').trim();
          if (!target) {
            send(400, { ok: false, error: 'path required' });
            return;
          }
          try {
            if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
              send(400, { ok: false, error: 'not a directory: ' + target });
              return;
            }
          } catch {
            send(400, { ok: false, error: 'cannot access: ' + target });
            return;
          }

          const detection = await scanWorkspaceDetails(target);
          const endpoint = String(body.endpoint || detection.fields.httpEndpoint || '').trim();
          if (endpoint) {
            const base = /^https?:\/\//i.test(endpoint) ? endpoint : 'http://' + endpoint;
            const url = base.replace(/\/+$/, '') + '/get_login_info';
            try {
              const r = await fetch(url, { signal: AbortSignal.timeout(1800) });
              if (r.ok) {
                const j = await r.json();
                const d = (j && (j.data || j)) || {};
                if (d.user_id) {
                  detection.fields.selfQQ = Number(d.user_id) || detection.fields.selfQQ;
                  detection.notes.push('OneBot 当前登录账号：' + d.user_id + (d.nickname ? '（' + d.nickname + '）' : ''));
                  if (d.nickname) detection.fields.name = String(d.nickname);
                }
              }
            } catch {
              detection.notes.push('OneBot 端点未连接，未能读取当前登录账号');
            }
          }
          if (action === 'scan') {
            send(200, { ok: true, ...detection });
            return;
          }
          if (action === 'bind') {
            const patch = {};
            for (const [k, v] of Object.entries(detection.fields)) {
              if (k === 'groupIds') continue;
              if (v !== undefined && v !== '' && v !== 0) patch[k] = v;
            }
            currentConfig.bot = { ...(currentConfig.bot || {}), ...patch };
            currentConfig.autoAdapt = { enabled: true };
            const groups = Array.isArray(currentConfig.groups) ? currentConfig.groups.slice() : [];
            for (const gid of detection.fields.groupIds || []) {
              if (!groups.some((g) => String(g.groupId) === String(gid))) {
                groups.push({ groupId: String(gid), mode: 'freechat', probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ['闭嘴', '别说了', '安静'] });
              }
            }
            currentConfig.groups = groups;

            let persisted = false;
            try {
              const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : ctx.configEditor;
              if (editor && typeof editor.entries === 'function' && typeof editor.edit === 'function') {
                const entry = editor.entries().find((e) => {
                  const bag = [e && e.id, e && e.patchId, e && e.name, e && e.entryId].filter(Boolean).join(' ');
                  return bag.includes('qqbot-skillpack');
                });
                if (entry) {
                  await editor.edit(entry, (current) => {
                    const next = { ...(current || {}) };
                    next.bot = { ...(next.bot || {}), ...patch };
                    next.autoAdapt = { ...(next.autoAdapt || {}), enabled: true };
                    const curGroups = Array.isArray(next.groups) ? next.groups.slice() : [];
                    for (const gid of detection.fields.groupIds || []) {
                      if (!curGroups.some((g) => String(g.groupId) === String(gid))) {
                        curGroups.push({ groupId: String(gid), mode: 'freechat', probability: 0.2, mentionProbability: 0.85, cooldownSec: 900, muteKeywords: ['闭嘴', '别说了', '安静'] });
                      }
                    }
                    next.groups = curGroups;
                    return next;
                  });
                  persisted = true;
                } else {
                  detection.notes.push('未找到本插件配置条目，未能持久化');
                }
              } else {
                detection.notes.push('configEditor 不可用，未能持久化');
              }
            } catch (e) {
              detection.notes.push('持久化失败：' + String((e && e.message) || e));
            }

            // 自动尝试连接 OneBot（如果识别到端点）
            let autoConnect = null;
            const ep = currentConfig.bot && currentConfig.bot.httpEndpoint;
            const tk = currentConfig.bot && currentConfig.bot.token;
            if (ep) {
              try {
                const r = await bindOneBotAndFill(ep, tk, [], false);
                autoConnect = { ok: true, login: r.login, groups: r.groups || [] };
              } catch (e) {
                autoConnect = { ok: false, error: String((e && e.message) || e) };
              }
            }

            send(200, { ok: true, ...detection, applied: true, persisted, autoConnect });
            return;
          }
          send(400, { ok: false, error: 'unknown action: ' + action });
        },
      }));
    }
  } catch {}

  // ---- 生命周期 effect ----
  disposers.push(
    ctx.effect(function () {
      for (const key of FEATURE_NAMES) {
        const shouldRun = currentConfig.enabled && runtime[key].enabled;
        if (shouldRun && !runtime[key].started) {
          runtime[key].started = true;
          console.log('[qqbot-skillpack] ' + featureLabel(key) + ' 启用');
        } else if (!shouldRun && runtime[key].started) {
          runtime[key].started = false;
          console.log('[qqbot-skillpack] ' + featureLabel(key) + ' 禁用');
        }
      }
      return function () {
        for (const key of FEATURE_NAMES) {
          runtime[key].started = false;
        }
      };
    }),
  );

  return function () {
    for (const d of disposers) {
      try { d(); } catch {}
    }
  };
}

// ---------- 自动检查更新 ----------

const PLUGIN_REPO_OWNER = '347347ae-design';
const PLUGIN_REPO_NAME = 'QQbot-con';
const CURRENT_VERSION = '1.18.3';

function parseVersion(v) {
  const parts = String(v || '0').split('.').map(x => parseInt(x, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function versionGt(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkUpdate() {
  const repoUrl = `https://github.com/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}`;
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/releases/latest`);
    const latestVersion = String(releases.tag_name || releases.name || '').replace(/^v/, '') || '0.0.0';
    const downloadUrl = releases.html_url || `${repoUrl}/releases/latest`;
    const changelog = releases.body || '';
    return {
      currentVersion: CURRENT_VERSION,
      latestVersion,
      updateAvailable: versionGt(latestVersion, CURRENT_VERSION),
      downloadUrl,
      changelog,
    };
  } catch (firstError) {
    // 仓库还没有 release 时，回退到读取 main 分支 package.json 的版本
    try {
      const raw = await fetchJson(`https://raw.githubusercontent.com/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/main/package.json`);
      const latestVersion = String((raw && raw.version) || '0.0.0');
      return {
        currentVersion: CURRENT_VERSION,
        latestVersion,
        updateAvailable: versionGt(latestVersion, CURRENT_VERSION),
        downloadUrl: repoUrl,
        changelog: null,
      };
    } catch (e) {
      return {
        currentVersion: CURRENT_VERSION,
        latestVersion: null,
        updateAvailable: false,
        downloadUrl: repoUrl,
        changelog: null,
        error: String((e && e.message) || (firstError && firstError.message) || e),
      };
    }
  }
}

export const inject = ['tools', 'webServer', 'configEditor'];
