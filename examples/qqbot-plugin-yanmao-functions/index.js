// 烟猫功能整合包 - QQBot 市场插件
// 把烟猫 AstrBot 的核心功能性插件封装为 DSH 市场插件工具：
//   Steam 播报/绑定/库查、课表提醒、VJudge 赛况/题单进度、
//   免@聊天、闭嘴开关、身份标识、分条发送。
//
// 安装后即可在 DSH 对话中调用这些工具，无需重启 AstrBot。
// 通过 OneBot v11 HTTP 调用远程/本地机器人，所有持久化状态
// 存放于本插件目录下的 data/ 子目录。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(PLUGIN_DIR, 'data');
const BINDS_FILE = path.join(DATA_DIR, 'steam_binds.json');
const STATES_FILE = path.join(DATA_DIR, 'steam_states.json');
const CLASS_VAC_FILE = path.join(DATA_DIR, 'class_vacations.json');
const CLASS_IMP_FILE = path.join(DATA_DIR, 'class_schedules.json');
const VJ_CONTEST_FILE = path.join(DATA_DIR, 'vjudge_contest_state.json');
const VJ_PROGRESS_FILE = path.join(DATA_DIR, 'vjudge_progress_roster.json');
const VJ_SNAPSHOT_FILE = path.join(DATA_DIR, 'vjudge_progress_snapshot.json');
const SHUTUP_FILE = path.join(DATA_DIR, 'yan_shutup.json');

for (const d of [DATA_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch {}
}

// ============ OneBot HTTP 调用 ============
async function onebotCall(cfg, action, params = {}) {
  const ep = String(cfg.endpoint || '').trim();
  if (!ep) throw new Error('未配置 OneBot HTTP 端点（endpoint）');
  const base = /^https?:\/\//i.test(ep) ? ep : 'http://' + ep;
  const url = base.replace(/\/+$/, '') + '/' + action;
  const headers = { 'content-type': 'application/json' };
  if (cfg.token) headers.authorization = 'Bearer ' + cfg.token;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error('HTTP ' + r.status + (text ? ': ' + text.slice(0, 200) : ''));
  if (j && j.retcode !== undefined && j.retcode !== 0) throw new Error(j.msg || ('retcode ' + j.retcode));
  return j && j.data !== undefined ? j.data : j;
}

function groupIdFromUmo(umo) {
  const m = String(umo || '').match(/GroupMessage:(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function textOut(text) {
  return {
    schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    render: (_a, v) => [{ type: 'text', text: v.text }],
  };
}

// ============ Steam 配置（移植自 steam_monitor） ============
const STEAM_DEFAULTS = {
  apiKey: '',
  watchList: {},
  privateList: {},
  reportGroup: 0,
  bindGroups: [],
  dealsIntervalSec: 1800,
  summaryWeekday: 1,
  summaryHour: 20,
};

const GAME_JABS = [
  [/monster hunter|怪物猎人|mhw|mhrise|mhr/i, ['狩猎愉快，素材刷够了吗', '猫车几次了老实交代', '又是为了一个宝玉肝到半夜？']],
  [/helldivers|绝地潜兵|地狱潜兵/i, ['管理式民主发完就跑？虫族还没清干净呢', '才这点任务奖励，不够买一把新枪的']],
  [/celeste|蔚蓝/i, ['草莓收集了几颗就退出来了', 'B面又卡关了吧，C面更是想都别想']],
  [/warframe|星际战甲/i, ['仓斗刷了多少，白金攒够了吗', '紫卡洗出词条了吗就跑']],
  [/witcher|巫师3|巫师/i, ['昆特牌打完了吗就退出', '支线清了多少，强迫症呢']],
  [/elden ring|艾尔登|nightreign|黑夜君临/i, ['又去受苦了吧，被 boss 教育完记得早点睡', '刷了多少卢恩，够交一次赎罪的吗']],
  [/dark souls|黑暗之魂|只狼|sekiro|黑神话|wukong|black myth/i, ['受苦辛苦了，明天继续', '又死在同一个地方了吧，我早说了绕路']],
  [/silksong|丝之歌|黄蜂女/i, ['念珠攒够了吗，针还没升级吧', '黄蜂女比你会飞，也比你能打']],
  [/hollow knight|空洞骑士/i, ['地图开到百分之几了就跑', '神居刷满了吗，筛子虫还在等你']],
  [/dota|cs2|csgo|counter-strike|apex|valorant|无畏契约|league of legends|英雄联盟|overwatch|守望先锋|rainbow six|彩虹六号/i, ['上分了吗，还是又掉了一颗星', '连跪几把了？说实话']],
  [/minecraft|我的世界|terraria|泰拉瑞亚|starbound/i, ['挖到第几层了，钻石没见着吧', '房子盖一半就跑，烂尾工程']],
  [/palworld|幻兽帕鲁|rust|valheim|enshrouded|lethal company|致命公司|ark: survival|方舟:生存/i, ['帕鲁还在替你打工，你就下班了', '夜里的怪可不讲道理，你倒是睡了']],
  [/world of warcraft|魔兽世界|ff14|final fantasy xiv|最终幻想14|剑网3|逆水寒|destiny|命运2|guild wars|激战2|black desert|黑色沙漠/i, ['日常清完了吗，周常还没动呢', '副本 CD 转好了你人呢']],
  [/genshin|原神|honkai|崩坏|star rail|星穹铁道|绝区零|wuthering waves|鸣潮|blue archive|蔚蓝档案/i, ['体力清完了吗就退', '该抽的抽到了吗，歪了吧']],
  [/hades|哈迪斯|dead cells|死亡细胞|binding of isaac|以撒的结合|vampire survivors|吸血鬼幸存者|balatro|小丑牌|slay the spire|杀戮尖塔|risk of rain/i, ['又一把没忍住是吧', '肉鸽的尽头是天亮']],
  [/civ|文明|europa|stellaris|群星|ck3|eu4|crusader kings|hearts of iron|钢铁雄心|xcom|幽浮|into the breach|陷阵之志/i, ['再玩一回合……然后就天亮了', '地图涂色进度如何']],
  [/stardew|星露谷|animal crossing|动物森友会|factorio|异星工厂|satisfactory|幸福工厂|oxygen not included|缺氧|cities skylines|城市天际线/i, ['农场/岛又荒废了吧', '流水线刚铺开就跑，传送带在哭']],
  [/cyberpunk|赛博朋克|baldur|博德之门|skyrim|上古卷轴|fallout|辐射|mass effect|质量效应|dragon age|god of war|战神|spider-man|蜘蛛侠|ghost of tsushima|对马岛|red dead|荒野大镖客|grand theft auto|horizon zero dawn|地平线零之曙光/i, ['支线做完了吗，地图上还一堆问号', '剧情推进到哪了，别跟我说刚过序章']],
  [/osu|arcaea|phigros|maimai|节奏大师|音游/i, ['全连了吗就退出来', '这曲子你打了几遍才过']],
  [/wallpaper engine/i, ['……这玩意儿也算游戏？', '行吧，动态壁纸也是壁纸']],
];
const GENERIC_JABS = [
  '玩了{dur}就撤，《{game}》进度条才拉一半',
  '{dur}的《{game}》，存档点找到了吗',
  '退出《{game}》，{dur}够干什么的',
  '行吧，{dur}就把《{game}》撂这儿了',
];
const NON_GAME_RE = /(benchmark|demo|launcher|config|configurator|editor|sdk|server|redist|directx|vcredist|steamworks common|跑分|试玩|启动器|编辑器|配置器|运行库)/i;

function fmtDuration(minutes) {
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} 小时` + (m ? ` ${m} 分` : '');
}
function sessionTease(game, minutes) {
  const name = (game || '').trim();
  const low = name.toLowerCase();
  if (NON_GAME_RE.test(low)) {
    return GENERIC_JABS[Math.floor(Math.random() * GENERIC_JABS.length)];
  }
  for (const [re, lines] of GAME_JABS) {
    if (re.test(low)) return lines[Math.floor(Math.random() * lines.length)];
  }
  const dur = minutes != null ? fmtDuration(minutes) : '未知时长';
  return GENERIC_JABS[Math.floor(Math.random() * GENERIC_JABS.length)]
    .replace('{dur}', dur).replace('{game}', name || '这游戏');
}

const STATE_MAP = { 0: '离线', 1: '在线', 2: '忙碌', 3: '挂机', 4: '想找交易', 5: '想找玩伴' };

async function steamStatus(cfg, sCfg) {
  const watchList = sCfg.watchList || {};
  const ids = Object.keys(watchList).join(',');
  if (!ids) return { text: '⚠️ Steam 监控名单为空，请先在配置里填写 watchList（steamid64 -> 显示名）' };
  const data = await onebotCall(cfg, 'ISteamUser/GetPlayerSummaries/v0002/', { steamids: ids });
  // onebotCall 返回的是 data；这里需要特殊处理：Steam Web API 不是 OneBot，需走原始 HTTP
  return { text: 'Steam Web API 需单独代理，暂未在 OneBot 代理下实现，请改用 yanmao_status 检查连通性' };
}

async function steamBind(cfg, groupId, text) {
  const mUrl = text.match(/https?:\/\/\S+/);
  const mId = text.match(/7656119\d{10}/);
  const arg = mUrl ? mUrl[0] : (mId ? mId[0] : '');
  if (!arg) {
    return { text: '不知道自己的 Steam ID？发：@机器人 steam绑定 7656119xxxx（数字或整个链接都行）' };
  }
  const qq = String(globalThis._lastSenderQQ || 0);
  const binds = loadJSON(BINDS_FILE, {});
  const sid = mId ? mId[0] : arg;
  binds[qq] = { steamid: sid, nick: '', bindTs: Date.now(), bindGroups: [groupId] };
  saveJSON(BINDS_FILE, binds);
  return { text: `✅ 绑定成功！↔ Steam 账号（${sid}）` };
}

async function steamLibrary(cfg, groupId) {
  const qq = String(globalThis._lastSenderQQ || 0);
  const binds = loadJSON(BINDS_FILE, {});
  if (!binds[qq]) {
    return { text: '先绑定 Steam 再查喵：@机器人 steam绑定 <你的资料链接>' };
  }
  const sid = binds[qq].steamid;
  const sCfg = mergeSteam(cfg);
  const data = await onebotCall(cfg, 'IPlayerService/GetOwnedGames/v0001/', {
    steamid: sid, include_appinfo: 1, include_played_free_games: 1, key: sCfg.apiKey,
  });
  const games = data.games || [];
  if (!games.length) {
    return { text: '没查到游戏列表（可能游戏详情设了仅好友可见）。' };
  }
  games.sort((a, b) => b.playtime_forever - a.playtime_forever);
  const totalMin = games.reduce((s, g) => s + g.playtime_forever, 0);
  const lines = [`🎮 ${binds[qq].nick || '你'} 的 Steam 库（共 ${games.length} 款 · 累计 ${Math.floor(totalMin / 60)} 小时）`];
  for (let i = 0; i < Math.min(games.length, 15); i++) {
    const g = games[i];
    const mins = g.playtime_forever;
    lines.push(`${i + 1}. ${g.name} — ${mins >= 60 ? Math.floor(mins / 60) + 'h' : mins + 'm'}`);
  }
  return { text: lines.join('\n') };
}

function mergeSteam(cfg) {
  return { ...STEAM_DEFAULTS, ...((cfg && cfg.steam) || {}) };
}

async function steamMenu() {
  const menu = `🐱 Steam 功能菜单
steam状态 — 在线面板（需 Steam API Key）
steam绑定 <链接/ID> — 绑定 Steam 账号
我的游戏库 — 查游戏列表+时长
我的成就 — 查成就进度（开发中）
解绑 — 解除 Steam 绑定`;
  return { text: menu };
}

// ============ 课表提醒（移植自 class_reminder） ============
const CLASS_DEFAULTS = {
  groupId: 0,
  leadMin: 10,
  week1Monday: '2026-08-31',
  schedules: {},
  builtinHolidays: [],
};
const WEEK_KEY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function classTodayKey() {
  const d = new Date();
  const wd = d.getDay(); // 0=周日
  const idx = wd === 0 ? 6 : wd - 1;
  return WEEK_KEY[idx];
}
function teachingWeek(week1Monday, day = new Date()) {
  const start = new Date(week1Monday);
  const n = Math.floor((day.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1;
  return n >= 1 ? n : null;
}
function weeksOk(spec, week) {
  if (!spec || week === null) return true;
  for (const part of String(spec).replace('，', ',').split(',')) {
    const p = part.replace('周', '').trim();
    if (!p) continue;
    if (p.includes('-')) {
      const [a, b] = p.split('-', 1);
      const ai = parseInt(a, 10), bi = parseInt(b, 10);
      if (!isNaN(ai) && !isNaN(bi) && ai <= week && week <= bi) return true;
    } else {
      const v = parseInt(p, 10);
      if (!isNaN(v) && v === week) return true;
    }
  }
  return false;
}
function iterDay(info, dayKey, week) {
  const items = (info[dayKey] || []);
  const out = [];
  for (const item of items) {
    if (!weeksOk(item[4], week)) continue;
    out.push(item);
  }
  return out;
}
function inVacation(qq, config, day = new Date()) {
  try {
    const vac = loadJSON(CLASS_VAC_FILE, {});
    for (const r of (vac[qq] || [])) {
      const sd = new Date(r[0] + 'T00:00:00');
      const ed = new Date(r[1] + 'T23:59:59');
      if (day >= sd && day <= ed) return `本人假期 ${r[0]}~${r[1]}`;
    }
  } catch {}
  const info = SCHEDULES_CACHE[qq];
  if (info?.cnHoliday) {
    for (const [s, e, note] of (config.builtinHolidays || [])) {
      const sd = new Date(s + 'T00:00:00');
      const ed = new Date(e + 'T23:59:59');
      if (day >= sd && day <= ed) return note;
    }
  }
  return '';
}
let SCHEDULES_CACHE = {};
function classConfig(cfg) {
  return { ...CLASS_DEFAULTS, ...((cfg && cfg.classReminder) || {}) };
}

async function classTimetable(cfg, groupId, qqOrName) {
  const c = classConfig(cfg);
  SCHEDULES_CACHE = { ...c.schedules };
  const qq = qqOrName ? resolveTarget(qqOrName) : null;
  if (!qq) return { text: '没找到这份课表。先用「导入课表」加入自己的课表，或直接说「课表」查自己的。' };
  const info = SCHEDULES_CACHE[qq];
  if (!info) return { text: '课表提醒只覆盖内置名单，先用「导入课表」加入自己的课表。' };
  const lines = [`📅 ${info.name} 的课表（${info.tzNote ?? '北京时间'}）`];
  for (const wk of WEEK_KEY) {
    const items = iterDay(info, wk, null);
    if (!items.length) continue;
    lines.push(`【${WEEK_CN[WEEK_KEY.indexOf(wk)]}】`);
    for (const [course, st, et, place, spec] of items) {
      const loc = place !== '无' ? ` @${place}` : '';
      const wj = spec ? ` [${spec}周]` : '';
      lines.push(`  ${st}-${et} ${course}${loc}${wj}`);
    }
  }
  const vac = inVacation(qq, c);
  lines.push(vac ? `（${vac}，暂停提醒）` : `提前 ${c.leadMin ?? 10} 分钟提醒`);
  return { text: lines.join('\n') };
}
function resolveTarget(arg) {
  const a = arg.toLowerCase();
  if (SCHEDULES_CACHE[a]) return a;
  for (const [qq, info] of Object.entries(SCHEDULES_CACHE)) {
    if (a === info.name.toLowerCase() || a.includes(info.name.toLowerCase()) || info.name.toLowerCase().includes(a)) return qq;
  }
  return null;
}
async function classReminder(cfg, groupId) {
  const c = classConfig(cfg);
  const days = 2;
  const now = new Date();
  const lines = [`⏰ 未来 ${days} 天的提醒（提前 ${c.leadMin ?? 10} 分钟 @你）`];
  let count = 0;
  for (let off = 0; off < days; off++) {
    const d = new Date(now); d.setDate(d.getDate() + off);
    const wd = d.getDay(); const wk = WEEK_KEY[wd === 0 ? 6 : wd - 1];
    const week = teachingWeek(c.week1Monday, d);
    const label = off === 0 ? '今天' : off === 1 ? '明天' : '';
    lines.push(`【${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${WEEK_CN[wd]}${label ? ' · ' + label : ''}】`);
    for (const [qq, info] of Object.entries(SCHEDULES_CACHE)) {
      if (inVacation(qq, c, d)) continue;
      for (const [course, st, _et, place, _spec] of iterDay(info, wk, week)) {
        const [h, m] = st.split(':').map(Number);
        const clsStart = new Date(d); clsStart.setHours(h, m, 0, 0);
        const ping = new Date(clsStart.getTime() - (c.leadMin ?? 10) * 60000);
        if (ping < now) continue;
        count++;
        const loc = place !== '无' ? ` @${place}` : '';
        lines.push(`  ✅ ${ping.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} @${info.name} ${course}（${st} 开始${loc}）`);
      }
    }
    if (count === 0) lines.push('  （这天没有待发的提醒）');
  }
  return { text: lines.join('\n') };
}
async function classImport(cfg, groupId, senderQQ, text) {
  const body = text.replace(/导入课表|添加课表|录入课表/g, '').trim();
  if (!body) {
    return { text: '📥 课表导入用法：\n@机器人 导入课表 ＜粘贴课表文字＞\n格式示例：\n姓名: 张三\n节假日: 是\n周一\n08:00-09:35 课程名 @教室' };
  }
  const entry = { name: '', tzNote: '北京时间', cnHoliday: true };
  for (const wk of WEEK_KEY) entry[wk] = [];
  let cur = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/：/g, ':').replace(/－/g, '-');
    if (!line) continue;
    const mName = line.match(/^(姓名|名字)\s*[:=]\s*(.+)$/);
    if (mName) { entry.name = mName[2].trim().slice(0, 12); continue; }
    const mDay = line.match(/^(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (mDay) {
      const map = {'一':'mon','二':'tue','三':'wed','四':'thu','五':'fri','六':'sat','日':'sun','天':'sun','1':'mon','2':'tue','3':'wed','4':'thu','5':'fri','6':'sat','7':'sun'};
      cur = map[mDay[1]];
      continue;
    }
    if (!cur) continue;
    const mTime = line.match(/(\d{1,2})\s*:\s*(\d{1,2})\s*[-~—–]\s*(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!mTime) continue;
    const s = parseInt(mTime[1], 10) * 60 + parseInt(mTime[2], 10);
    const e = parseInt(mTime[3], 10) * 60 + parseInt(mTime[4], 10);
    const rest = line.slice(0, mTime.index) + ' ' + line.slice(mTime.index + mTime[0].length);
    const pm = rest.split(/[@＠]/, 2);
    const place = pm.length === 2 ? (pm[1].trim() || '无') : '无';
    let name = pm[0].replace(/\d+\s*[-~]\s*\d+\s*节/g, '').replace(/第?\s*\d+\s*节/g, '').replace(/[|｜,，;；]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!name) continue;
    entry[cur].push([name, `${Math.floor(s / 60)}:${s % 60}`, `${Math.floor(e / 60)}:${e % 60}`, place]);
  }
  const total = WEEK_KEY.reduce((s, wk) => s + (entry[wk] || []).length, 0);
  if (total === 0) return { text: '❌ 一条课都没解析出来，格式可能不对。' };
  const imp = loadJSON(CLASS_IMP_FILE, {});
  imp[senderQQ] = entry;
  saveJSON(CLASS_IMP_FILE, imp);
  SCHEDULES_CACHE[senderQQ] = entry;
  const lines = [`✅ 已导入 ${total} 节课（${entry.name || senderQQ}）`];
  for (const wk of WEEK_KEY) {
    for (const it of (entry[wk] || [])) {
      lines.push(`  ${WEEK_CN[WEEK_KEY.indexOf(wk)]} ${it[1]}-${it[2]} ${it[0]}${it[3] !== '无' ? ` @${it[3]}` : ''}`);
    }
  }
  return { text: lines.join('\n') };
}
async function classVacation(cfg, groupId, senderQQ, text) {
  const qq = senderQQ;
  const vac = loadJSON(CLASS_VAC_FILE, {});
  const cur = vac[qq] || [];
  const t = text.toLowerCase();
  if (['清除', '清空', '删除', '取消'].some(k => t.includes(k))) {
    delete vac[qq];
    saveJSON(CLASS_VAC_FILE, vac);
    return { text: '✅ 已清除你的全部假期，恢复正常提醒。' };
  }
  const dates = [];
  const re = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/g;
  let m;
  const ds = [];
  while ((m = re.exec(text))) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    ds.push(d);
  }
  if (ds.length >= 2) {
    ds.sort((a, b) => a.getTime() - b.getTime());
    dates.push([ds[0].toISOString().slice(0, 10), ds[1].toISOString().slice(0, 10)]);
  }
  if (dates.length > 0) {
    vac[qq] = [...cur, ...dates];
    saveJSON(CLASS_VAC_FILE, vac);
    return { text: `✅ 已添加假期：${dates.map(d => `${d[0]} ~ ${d[1]}`).join('\n  ')}` };
  }
  if (!cur.length) return { text: `${SCHEDULES_CACHE[qq]?.name || qq} 目前没有设置假期。` };
  return { text: `📋 假期：\n${cur.map(r => `  ${r[0]} ~ ${r[1]}`).join('\n')}` };
}

// ============ VJudge 比赛（移植自 vjudge_contest） ============
const VJ_CONTEST_DEFAULTS = {
  contestId: '848881',
  targetUmo: '',
  monitorEnabled: false,
  pollIntervalSec: 60,
  reportIntervalSec: 600,
};
function vjContestConfig(cfg) {
  return { ...VJ_CONTEST_DEFAULTS, ...((cfg && cfg.vjudgeContest) || {}) };
}
async function vjFetchRank(contestId) {
  const url = `https://vjudge.net/contest/rank/single/${contestId}`;
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://vjudge.net/contest/${contestId}#rank` };
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`vjudge 状态码 ${r.status}`);
  return await r.json();
}
function vjParseRank(data) {
  const names = {};
  for (const [uid, info] of Object.entries(data.participants || {})) {
    names[String(uid)] = info.nickname || info.name || String(uid);
  }
  const subs = [];
  for (const row of data.submissions || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    subs.push({ uid: String(row[0]), prob: Number(row[1]), status: Number(row[2]), run: Number(row[3]) });
  }
  return { names, subs, begin: Number(data.begin || 0), length: Number(data.length || 0), title: data.title };
}
function vjSolvedCounts(subs) {
  const per = {};
  for (const s of subs) {
    if (s.status === 1) {
      if (!per[s.uid]) per[s.uid] = new Set();
      per[s.uid].add(s.prob);
    }
  }
  const out = {};
  for (const [uid, set] of Object.entries(per)) out[uid] = set.size;
  return out;
}
function vjLeaderboard(names, solved) {
  const rows = Object.keys(names).map(uid => [uid, solved[uid] || 0]);
  for (const [uid, n] of Object.entries(solved)) {
    if (!rows.some(r => r[0] === uid)) rows.push([uid, n]);
  }
  rows.sort((a, b) => b[1] - a[1] || (names[a[0]] || a[0]).localeCompare(names[b[0]] || b[0]));
  const lines = [];
  let lastSolved = -1, lastRank = 0;
  for (let i = 0; i < rows.length; i++) {
    const [uid, n] = rows[i];
    const rank = n === lastSolved ? lastRank : (i + 1);
    lastRank = rank; lastSolved = n;
    lines.push(`${rank}. ${names[uid] || uid}（${n}题）`);
  }
  return lines;
}
async function vjContestStatus(cfg, groupId) {
  const c = vjContestConfig(cfg);
  try {
    const data = await vjFetchRank(c.contestId);
    const { names, subs, begin, length, title } = vjParseRank(data);
    const solved = vjSolvedCounts(subs);
    const totalAc = Object.values(solved).reduce((a, b) => a + b, 0);
    const nowMs = Date.now();
    let when = '进行中';
    if (begin && length) {
      if (nowMs < begin) when = `未开始（${new Date(begin).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 开始）`;
      else if (nowMs > begin + length) when = '已结束';
      else {
        const left = Math.floor((begin + length - nowMs) / 60000);
        when = `进行中，剩余约 ${left} 分钟`;
      }
    }
    const lb = vjLeaderboard(names, solved);
    return { text: `📊「${title || c.contestId}」\n${when} · 参赛 ${Object.keys(names).length} 人 · 共通过 ${totalAc} 题\n\n${lb.join('\n') || '暂无通过记录'}` };
  } catch (e) {
    return { text: `拉取比赛排名失败：${String(e && e.message || e)}` };
  }
}

let vjContestState = loadJSON(VJ_CONTEST_FILE, { contestId: '848881', seen: {}, lastSolved: {}, participants: {}, pending: { ac: [], fail: [], join: [] }, lastReport: 0, startedNotified: false, endedNotified: false, baselineDone: false });
let vjContestTask = null;

function vjStartContestLoop(cfg, sendGroupMsg) {
  const c = vjContestConfig(cfg);
  if (!c.monitorEnabled) return;
  if (vjContestTask) clearInterval(vjContestTask);
  vjContestTask = setInterval(async () => {
    try {
      const data = await vjFetchRank(c.contestId);
      const { names, subs, begin, length, title } = vjParseRank(data);
      vjContestState.title = title || `比赛 ${c.contestId}`;
      vjContestState.begin = begin;
      vjContestState.length = length;
      const prevNames = { ...vjContestState.participants };
      const newUids = Object.keys(names).filter(u => !(u in prevNames));
      vjContestState.participants = { ...prevNames, ...names };
      if (!vjContestState.baselineDone) {
        vjContestState.seen = Object.fromEntries(subs.map(s => [s.run, s.status]));
        vjContestState.lastSolved = vjSolvedCounts(subs);
        vjContestState.baselineDone = true;
        vjContestState.lastReport = Date.now() / 1000;
        saveJSON(VJ_CONTEST_FILE, vjContestState);
        return;
      }
      const seen = { ...vjContestState.seen };
      const pending = vjContestState.pending;
      for (const s of subs) {
        const run = String(s.run);
        const old = seen[run];
        if (old === s.status) continue;
        seen[run] = s.status;
        const name = names[s.uid] || s.uid;
        if (s.status === 1) pending.ac.push({ uid: s.uid, prob: s.prob, name });
        else if (old === undefined) pending.fail.push({ uid: s.uid, prob: s.prob, name });
      }
      for (const uid of newUids) pending.join.push({ uid, name: names[uid] || uid });
      vjContestState.seen = seen;
      vjContestState.lastSolved = vjSolvedCounts(subs);
      const now = Date.now() / 1000;
      const pendingCount = pending.ac.length + pending.fail.length + pending.join.length;
      const due = now - (vjContestState.lastReport || 0);
      if (pendingCount > 0 && due >= (c.reportIntervalSec ?? 600)) {
        const digest = vjBuildDigest(names);
        if (digest && sendGroupMsg) await sendGroupMsg(groupIdFromUmo(c.targetUmo), digest);
        vjContestState.pending = { ac: [], fail: [], join: [] };
        vjContestState.lastReport = now;
        saveJSON(VJ_CONTEST_FILE, vjContestState);
      }
      if (begin && length && Date.now() > begin + length) {
        if (!vjContestState.endedNotified) {
          const tail = vjBuildDigest(names);
          if (tail && sendGroupMsg) await sendGroupMsg(groupIdFromUmo(c.targetUmo), tail);
          vjContestState.pending = { ac: [], fail: [], join: [] };
          vjContestState.endedNotified = true;
          const lb = vjLeaderboard(vjContestState.participants, vjContestState.lastSolved);
          if (sendGroupMsg) await sendGroupMsg(groupIdFromUmo(c.targetUmo), `🏁「${vjContestState.title || c.contestId}」已结束，最终榜单：\n${lb.join('\n') || '暂无'}`);
        }
        clearInterval(vjContestTask);
        vjContestTask = null;
      }
      saveJSON(VJ_CONTEST_FILE, vjContestState);
    } catch (e) {
      console.warn('[vjudge_contest] 轮询异常:', e);
    }
  }, (c.pollIntervalSec ?? 60) * 1000);
}
function vjBuildDigest(names) {
  const pending = vjContestState.pending;
  const ac = pending.ac, fail = pending.fail, join = pending.join;
  if (!ac.length && !fail.length && !join.length) return '';
  const solved = vjContestState.lastSolved;
  const start = vjContestState.lastReport || 0;
  const span = `${new Date(start * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}-${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  const parts = [`📣 赛况播报（${span}）`];
  if (join.length) parts.push(`🙋 新参赛：${join.map(j => j.name).join('、')}`);
  if (ac.length) {
    parts.push(`—— 通过（${ac.length}）——`);
    for (const e of ac.slice(0, 8)) parts.push(`🎉 ${e.name} 通过了第 ${e.prob + 1} 题（已通过 ${solved[e.uid] || 0} 题）`);
    if (ac.length > 8) parts.push(`…另有 ${ac.length - 8} 次通过`);
  }
  if (fail.length) {
    if (fail.length <= 4) {
      parts.push('—— 未通过 ——');
      parts.push(...fail.map(e => `❌ ${e.name} 第 ${e.prob + 1} 题 未通过`));
    } else {
      parts.push(`—— 未通过：共 ${fail.length} 次提交 ——`);
    }
  }
  const lb = vjLeaderboard(vjContestState.participants, solved);
  if (lb.length) {
    parts.push(`—— 当前榜单（共 ${Object.keys(vjContestState.participants).length} 人）——`);
    parts.push(...lb.slice(0, 30));
    if (lb.length > 30) parts.push(`…还有 ${lb.length - 30} 人未列出`);
  }
  return parts.join('\n');
}

// ============ VJudge 题单进度（移植自 vjudge_progress） ============
const VJ_PROGRESS_DEFAULTS = {
  workbookId: '20406',
  totalProblems: 50,
  rosterIntervalSec: 1800,
  missThreshold: 2,
  guardRatio: 0.5,
};
function vjProgressConfig(cfg) {
  return { ...VJ_PROGRESS_DEFAULTS, ...((cfg && cfg.vjudgeProgress) || {}) };
}
async function vjFetchMembers(workbookId) {
  const url = `https://vjudge.net/workbook/${workbookId}/members?category=all&groupId=`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`vjudge 状态码 ${r.status}`);
  const data = await r.json();
  const members = [];
  for (const item of data) {
    if (!Array.isArray(item) || item.length < 8) continue;
    members.push({ username: String(item[1] || ''), nickname: String(item[2] || item[1] || ''), ac_cnt: Number(item[7] || 0) });
  }
  return members;
}
async function vjProgressBoard(cfg) {
  const c = vjProgressConfig(cfg);
  let members;
  try { members = await vjFetchMembers(c.workbookId); }
  catch (e) { return { text: `拉取失败：${String(e && e.message || e)}` }; }
  members.sort((a, b) => b.ac_cnt - a.ac_cnt);
  const total = c.totalProblems;
  const snap = loadJSON(VJ_SNAPSHOT_FILE, { time: 0, members: {} });
  const prev = snap.members || {};
  const prevTime = snap.time || Date.now() / 1000;
  const ago = (Math.floor((Date.now() / 1000 - prevTime) / 60)) + ' 分钟前';
  const deltas = {};
  const newNames = new Set();
  const nameOf = {};
  for (const m of members) {
    nameOf[m.username] = m.nickname || m.username;
    const prevAc = prev[m.username]?.ac || 0;
    if (m.ac_cnt > prevAc) deltas[m.username] = m.ac_cnt - prevAc;
    if (!(m.username in prev)) newNames.add(m.username);
  }
  const newlyFinished = members.filter(m => m.ac_cnt >= total && (!prev[m.username] || prev[m.username].ac < total)).map(m => nameOf[m.username]);
  const totalDelta = Object.values(deltas).reduce((a, b) => a + b, 0);
  const left = Object.keys(prev).filter(u => !nameOf[u]).map(u => prev[u].name || u);
  const parts = [`距上次查询（${ago}）总AC ${totalDelta >= 0 ? '+' : ''}${totalDelta} 题`];
  const movers = Object.entries(deltas).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (movers.length) parts.push('进步：' + movers.map(([u, d]) => `${nameOf[u] || u} +${d}`).join('、'));
  if (newNames.size) {
    const nn = Array.from(newNames).slice(0, 5).map(u => nameOf[u] || u);
    parts.push(`新加入 ${newNames.size} 人（${nn.join('、')}）`);
  }
  if (left.length) parts.push(`退出 ${left.length} 人`);
  if (newlyFinished.length) parts.push(`🎉 新完赛：${newlyFinished.slice(0, 5).join('、')}`);
  if (!deltas && !newNames.size && !left.length) parts.push('暂无变化 😴');
  const newSnap = {};
  for (const m of members) newSnap[m.username] = { name: m.nickname || m.username, ac: m.ac_cnt };
  saveJSON(VJ_SNAPSHOT_FILE, { time: Date.now() / 1000, members: newSnap });
  const top3 = members.slice(0, 3);
  const topTxt = top3.map(m => `${m.nickname || m.username} ${m.ac_cnt}/${total}`).join('，') || '暂无';
  const lines = [`📊 题单进度（共 ${members.length} 人，${total} 题）`, `📈 ${parts.join('；')}`, `⭐ 前三：${topTxt}`];
  for (let i = 0; i < members.length; i++) {
    lines.push(`${i + 1}. ${members[i].nickname || members[i].username} — ${members[i].ac_cnt}/${total} 题`);
  }
  return { text: lines.join('\n') };
}
async function vjProgressLeft(cfg) {
  const c = vjProgressConfig(cfg);
  const roster = loadJSON(VJ_PROGRESS_FILE, { baselineAt: 0, updatedAt: 0, members: {}, left: [] });
  const left = (roster.left || []).filter((r) => r.username);
  if (!left.length) {
    const tracked = Object.keys(roster.members || {}).length;
    const base = roster.baselineAt ? new Date(roster.baselineAt * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    let msg = `✅ 目前没有检测到有人退出题单。\n正在监控 ${tracked} 人`;
    if (base) msg += `，监控起始 ${base}`;
    msg += '。\n（有人退出会自动记录，再问一次就能看到名单）';
    return { text: msg };
  }
  left.sort((a, b) => (b.leftAt || 0) - (a.leftAt || 0));
  const lines = [`🚪 已退出题单名单（共 ${left.length} 人）`];
  for (let i = 0; i < left.length; i++) {
    lines.push(`${i + 1}. ${left[i].name || left[i].username} — 退出前 ${left[i].ac || 0}/${c.totalProblems} 题（${new Date(left[i].leftAt * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）`);
  }
  return { text: lines.join('\n') };
}
async function vjProgressDone(cfg) {
  const c = vjProgressConfig(cfg);
  let members;
  try { members = await vjFetchMembers(c.workbookId); }
  catch (e) { return { text: `拉取失败：${String(e && e.message || e)}` }; }
  const done = members.filter(m => m.ac_cnt >= c.totalProblems);
  if (!done.length) return { text: `🏁 目前还没有人完成 ${c.totalProblems} 题。` };
  done.sort((a, b) => (a.nickname || a.username).localeCompare(b.nickname || b.username));
  const lines = [`🏁 已完成 ${c.totalProblems} 题（共 ${done.length} 人）：`];
  for (let i = 0; i < done.length; i++) lines.push(`${i + 1}. ${done[i].nickname || done[i].username}`);
  return { text: lines.join('\n') };
}

// ============ 免@自动聊天（移植自 yan_freechat） ============
const FREECHAT_DEFAULTS = {
  groups: [],
  probability: 0.20,
  mentionProbability: 0.85,
  cooldownSec: 900,
  mentionCooldownSec: 300,
};
function freechatConfig(cfg) {
  return { ...FREECHAT_DEFAULTS, ...((cfg && cfg.freechat) || {}) };
}
const freechatLastReply = {};
async function freechatShouldReply(cfg, gid, text, now) {
  const c = freechatConfig(cfg);
  if (!c.groups.includes(Number(gid))) return false;
  const last = freechatLastReply[gid] ?? 0;
  const mentioned = text.includes('烟猫') || text.includes('机器人');
  const cooldown = mentioned ? c.mentionCooldownSec : c.cooldownSec;
  if (now - last < cooldown) return false;
  const prob = mentioned ? c.mentionProbability : c.probability;
  return Math.random() < prob;
}

// ============ 闭嘴开关（移植自 yan_shutup） ============
const SHUTUP_DEFAULTS = { muteSeconds: 600, triggerKeywords: ['闭嘴', '别说了', '安静'] };
function shutupConfig(cfg) {
  return { ...SHUTUP_DEFAULTS, ...((cfg && cfg.shutup) || {}) };
}
function isMuted(gid, cfg) {
  const d = loadJSON(SHUTUP_FILE, {});
  return Date.now() < (d[gid] ?? 0);
}
function realAtBot(event, selfQQ) {
  return event.message.some(seg => seg.type === 'at' && String(seg.data.qq || seg.data.qq || '') === String(selfQQ));
}

// ============ 身份标识 / 分条发送 ============
const ALREADY_RE = /^<[^>]{1,32}>\s/;
const SPLIT_RE = /\s*\|\s*/;
const MAX_PARTS = 4;
const WORD_RE = /[\w\u4e00-\u9fff]/;
function senderName(event) {
  try {
    const sender = event.sender;
    let name = (sender && sender.card) ? String(sender.card).trim() : '';
    if (!name) name = (sender && sender.nickname) ? String(sender.nickname).trim() : '';
    if (!name) name = String(event.user_id);
    return name.replace(/</g, '＜').replace(/>/g, '＞').slice(0, 24);
  } catch { return String(event.user_id); }
}
function identifierPrepare(event, prompt) {
  if (event.message_type !== 'group') return prompt;
  if (!prompt || typeof prompt !== 'string') return prompt;
  if (ALREADY_RE.test(prompt)) return prompt;
  return `<${senderName(event)}> ${prompt}`;
}
function splitReply(text) {
  if (!text.includes('|')) return null;
  const parts = text.split(SPLIT_RE).map(p => p.trim()).filter(p => WORD_RE.test(p));
  if (parts.length <= 1) return null;
  if (parts.length > MAX_PARTS) {
    parts.splice(MAX_PARTS - 1, parts.length - (MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join('，'));
  }
  return parts;
}

// ============ 市场插件入口 ============
let backgroundStarted = false;

export function apply(ctx, config) {
  const disposers = [];
  const cfg = config || {};
  // 合并端点/token 到 config，方便子模块读取
  const fullCfg = { ...cfg };

  // 背景任务：VJudge 比赛监控（若启用）
  if (!backgroundStarted) {
    backgroundStarted = true;
    if (typeof ctx.effect === 'function') {
      disposers.push(ctx.effect(() => {
        const sendGroupMsg = (gid, text) => {
          // 尽力发送；endpoint/token 来自 cfg
          return onebotCall(fullCfg, 'send_group_msg', { group_id: parseInt(gid, 10) || 0, message: text, auto_escape: false }).catch(() => {});
        };
        vjStartContestLoop(fullCfg, sendGroupMsg);
        return () => {
          if (vjContestTask) { clearInterval(vjContestTask); vjContestTask = null; }
        };
      }));
    }
  }

  if (ctx && ctx.tools && typeof ctx.tools.register === 'function') {
    // ---------- 基础 ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_status',
      title: '烟猫状态检查',
      description: '检查烟猫机器人的 OneBot v11 连通性，返回登录账号、昵称和群数量',
      parameters: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'OneBot HTTP 端点（可留空使用插件配置）' },
          token: { type: 'string', description: '访问 token（可留空）' },
        },
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const ep = String(args.endpoint || fullCfg.endpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : (fullCfg.token || ''));
        if (!ep) return { text: '❌ 未提供 OneBot 端点。请在插件配置中设置 endpoint，或传入 endpoint 参数。' };
        try {
          const login = await onebotCall({ endpoint: ep, token: tk }, 'get_login_info', {});
          let groupCount = '?';
          try {
            const groups = await onebotCall({ endpoint: ep, token: tk }, 'get_group_list', {});
            groupCount = Array.isArray(groups) ? groups.length : '?';
          } catch {}
          return { text: `✅ 烟猫在线\n- QQ: ${login && login.user_id}\n- 昵称: ${login && login.nickname}\n- 群数量: ${groupCount}\n- 端点: ${ep}` };
        } catch (e) {
          return { text: `❌ 连接失败: ${String(e && e.message || e)}\n- 端点: ${ep}` };
        }
      },
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_groups',
      title: '烟猫群列表',
      description: '获取烟猫机器人已加入的群列表',
      parameters: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'OneBot HTTP 端点（可留空使用插件配置）' },
          token: { type: 'string', description: '访问 token（可留空）' },
        },
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const ep = String(args.endpoint || fullCfg.endpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : (fullCfg.token || ''));
        if (!ep) return { text: '❌ 未提供 OneBot 端点' };
        try {
          const groups = await onebotCall({ endpoint: ep, token: tk }, 'get_group_list', {});
          if (!Array.isArray(groups) || groups.length === 0) return { text: '（无群或获取失败）' };
          const lines = groups.map((g) => `- ${g.group_name || '(未命名)'} (${g.group_id})`);
          return { text: `共 ${groups.length} 个群：\n` + lines.join('\n') };
        } catch (e) {
          return { text: `❌ 获取失败: ${String(e && e.message || e)}` };
        }
      },
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_send_group',
      title: '烟猫发群消息',
      description: '通过 OneBot HTTP 向指定群发送一条消息（用于测试或运维通知）',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '目标群号' },
          message: { type: 'string', description: '消息内容' },
          endpoint: { type: 'string', description: 'OneBot HTTP 端点（可留空使用插件配置）' },
          token: { type: 'string', description: '访问 token（可留空）' },
        },
        required: ['groupId', 'message'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const ep = String(args.endpoint || fullCfg.endpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : (fullCfg.token || ''));
        const gid = String(args.groupId || '').trim();
        const msg = String(args.message || '');
        if (!ep) return { text: '❌ 未提供 OneBot 端点' };
        if (!gid) return { text: '❌ groupId 不能为空' };
        if (!msg) return { text: '❌ message 不能为空' };
        try {
          const data = await onebotCall({ endpoint: ep, token: tk }, 'send_group_msg', {
            group_id: parseInt(gid, 10) || 0, message: msg, auto_escape: false,
          });
          const mid = data && (data.message_id || data.messageId) || '';
          return { text: `✅ 已发送到群 ${gid}${mid ? ' (message_id=' + mid + ')' : ''}` };
        } catch (e) {
          return { text: `❌ 发送失败: ${String(e && e.message || e)}` };
        }
      },
    }));

    // ---------- Steam ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_steam_status',
      title: '烟猫Steam状态',
      description: '查看被监控 Steam 好友的在线面板（需配置 steam.apiKey 和 watchList）',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOut(),
      execute: async () => steamStatus(fullCfg, mergeSteam(fullCfg)),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_steam_bind',
      title: '烟猫Steam绑定',
      description: '绑定本人的 Steam 账号（@机器人 steam绑定 <链接/ID> 的市场等价调用）',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '绑定参数，如 steam绑定 7656119xxxx 或完整链接' },
          groupId: { type: 'string', description: '当前群号' },
        },
        required: ['text', 'groupId'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        globalThis._lastSenderQQ = args.qq || 0;
        return steamBind(fullCfg, String(args.groupId || ''), String(args.text || ''));
      },
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_steam_library',
      title: '烟猫Steam游戏库',
      description: '查询绑定后的 Steam 游戏库与累计时长',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'string', description: '当前群号' } },
        required: ['groupId'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => steamLibrary(fullCfg, String(args.groupId || '')),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_steam_menu',
      title: '烟猫Steam菜单',
      description: 'Steam 功能菜单说明',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: textOut(),
      execute: steamMenu,
    }));

    // ---------- 课表 ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_class_timetable',
      title: '烟猫课表',
      description: '查看某人的课表（参数为姓名或 QQ 号，留空查自己的导入课表）',
      parameters: {
        type: 'object',
        properties: {
          qqOrName: { type: 'string', description: '姓名或 QQ 号，留空则按发送者' },
          groupId: { type: 'string', description: '当前群号' },
        },
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => classTimetable(fullCfg, String(args.groupId || ''), args.qqOrName || undefined),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_class_reminder',
      title: '烟猫课表提醒',
      description: '查看未来两天的课表提醒',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'string', description: '当前群号' } },
        required: ['groupId'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => classReminder(fullCfg, String(args.groupId || '')),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_class_import',
      title: '烟猫导入课表',
      description: '导入自己的课表文本',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '课表文本' },
          groupId: { type: 'string', description: '当前群号' },
          qq: { type: 'string', description: '发送者 QQ 号' },
        },
        required: ['text', 'groupId', 'qq'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => classImport(fullCfg, String(args.groupId || ''), String(args.qq || ''), String(args.text || '')),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_class_vacation',
      title: '烟猫假期设置',
      description: '设置/查看/清除自己的假期',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '假期文本（如“清除”或日期范围）' },
          groupId: { type: 'string', description: '当前群号' },
          qq: { type: 'string', description: '发送者 QQ 号' },
        },
        required: ['text', 'groupId', 'qq'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => classVacation(fullCfg, String(args.groupId || ''), String(args.qq || ''), String(args.text || '')),
    }));

    // ---------- VJudge ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_vjudge_contest',
      title: '烟猫VJudge比赛',
      description: '查看 VJudge 比赛 Rank 赛况',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'string', description: '当前群号' } },
        required: ['groupId'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => vjContestStatus(fullCfg, String(args.groupId || '')),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_vjudge_progress',
      title: '烟猫VJudge进度',
      description: '查看 VJudge 题单做题进度榜',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOut(),
      execute: async () => vjProgressBoard(fullCfg),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_vjudge_left',
      title: '烟猫VJudge退出名单',
      description: '查看已退出题单的人员名单',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOut(),
      execute: async () => vjProgressLeft(fullCfg),
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_vjudge_done',
      title: '烟猫VJudge完成名单',
      description: '查看已完赛（全题 AC）的人员名单',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output: textOut(),
      execute: async () => vjProgressDone(fullCfg),
    }));

    // ---------- 免@ ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_freechat_config',
      title: '烟猫免@配置',
      description: '查看/设置免@自动聊天的群号与概率',
      parameters: {
        type: 'object',
        properties: {
          groups: { type: 'string', description: '群号，逗号分隔（可选）' },
          probability: { type: 'number', description: '常规概率（可选）' },
        },
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const c = freechatConfig(fullCfg);
        const lines = [`⚙️ 免@自动聊天配置：\n- 免@群：${c.groups.join('、') || '(无)'}\n- 常规概率：${c.probability}\n- 点名概率：${c.mentionProbability}\n- 常规冷却：${c.cooldownSec} 秒\n- 点名冷却：${c.mentionCooldownSec} 秒`];
        if (args.groups) {
          c.groups = args.groups.split(',').map(s => Number(s.trim())).filter(n => n);
          // 注意：运行时只改内存，重启后恢复；如需持久化可写入 data/
        }
        if (args.probability !== undefined) c.probability = args.probability;
        return { text: lines.join('\n') };
      },
    }));

    // ---------- 闭嘴 ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_shutup',
      title: '烟猫闭嘴开关',
      description: '闭嘴期内拦截免@消息，真 @ 不受影响',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: '群号' },
          muteSeconds: { type: 'number', description: '闭嘴时长（秒）' },
          enable: { type: 'boolean', description: 'true=开启闭嘴，false=解除' },
        },
        required: ['groupId', 'enable'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const gid = String(args.groupId);
        const d = loadJSON(SHUTUP_FILE, {});
        if (args.enable === true) {
          d[gid] = Date.now() + ((args.muteSeconds ?? shutupConfig(fullCfg).muteSeconds) * 1000);
          saveJSON(SHUTUP_FILE, d);
          return { text: `好，闭嘴 ${Math.round((args.muteSeconds ?? shutupConfig(fullCfg).muteSeconds) / 60)} 分钟喵。` };
        } else {
          delete d[gid];
          saveJSON(SHUTUP_FILE, d);
          return { text: '✅ 已解除闭嘴。' };
        }
      },
    }));

    // ---------- 身份标识 / 分条发送（供 LLM 管道调用） ----------
    disposers.push(ctx.tools.register({
      name: 'yanmao_identifier',
      title: '烟猫身份标识',
      description: '给 LLM prompt 加发送者身份前缀（<昵称> 内容）',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '原始 prompt' },
          user_id: { type: 'number', description: '发送者 QQ' },
          nickname: { type: 'string', description: '昵称（可选）' },
          card: { type: 'string', description: '群名片（可选）' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const event = { message_type: 'group', user_id: args.user_id, sender: { nickname: args.nickname, card: args.card } };
        return { text: identifierPrepare(event, String(args.prompt || '')) };
      },
    }));

    disposers.push(ctx.tools.register({
      name: 'yanmao_split',
      title: '烟猫分条发送',
      description: '把 LLM 回复里用 \| 分隔的片段拆成多条',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '待拆分文本' } },
        required: ['text'],
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const parts = splitReply(String(args.text || ''));
        return { text: parts ? parts.join('\n') : String(args.text || '') };
      },
    }));
  }

  return function () {
    for (const d of disposers) {
      try { d(); } catch {}
    }
    if (vjContestTask) { clearInterval(vjContestTask); vjContestTask = null; }
    backgroundStarted = false;
  };
}

export default { apply };
