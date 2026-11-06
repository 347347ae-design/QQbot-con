// 验证 烟猫功能整合包 市场插件的 apply 能否正常注册工具
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL('D:/Anno tokoy/qqbot-skillpack-plugin/examples/qqbot-plugin-yanmao-functions/index.js').href);
const apply = mod.apply;
if (typeof apply !== 'function') {
  console.error('FAIL: apply not exported');
  process.exit(1);
}

const tools = [];
const disposers = [];
const ctx = {
  tools: {
    register(def) {
      tools.push(def.name);
      const d = () => { const i = tools.indexOf(def.name); if (i >= 0) tools.splice(i, 1); };
      disposers.push(d);
      return d;
    },
  },
  effect(cb) {
    const ret = cb();
    if (ret && typeof ret === 'function') disposers.push(ret);
  },
};

const config = {
  endpoint: 'http://100.125.255.91:3000',
  token: 'dshqq_9f3c1a7b2e4d6f80',
  steam: { apiKey: '', watchList: {}, reportGroup: 0 },
  classReminder: { groupId: 0, leadMin: 10, week1Monday: '2026-08-31', schedules: {} },
  vjudgeContest: { contestId: '848881', monitorEnabled: false },
  vjudgeProgress: { workbookId: '20406', totalProblems: 50 },
  freechat: { groups: [], probability: 0.2 },
  shutup: { muteSeconds: 600, triggerKeywords: ['闭嘴', '别说了', '安静'] },
};

const dispose = apply(ctx, config);
if (typeof dispose !== 'function') {
  console.error('FAIL: apply did not return disposer');
  process.exit(1);
}

const expected = [
  'yanmao_status', 'yanmao_groups', 'yanmao_send_group',
  'yanmao_steam_status', 'yanmao_steam_bind', 'yanmao_steam_library', 'yanmao_steam_menu',
  'yanmao_class_timetable', 'yanmao_class_reminder', 'yanmao_class_import', 'yanmao_class_vacation',
  'yanmao_vjudge_contest', 'yanmao_vjudge_progress', 'yanmao_vjudge_left', 'yanmao_vjudge_done',
  'yanmao_freechat_config', 'yanmao_shutup', 'yanmao_identifier', 'yanmao_split',
];

let failed = 0;
for (const name of expected) {
  if (tools.includes(name)) console.log('PASS 工具已注册: ' + name);
  else { console.log('FAIL 工具缺失: ' + name); failed += 1; }
}

// 验证 dispose 能清理
dispose();
for (const name of expected) {
  if (tools.includes(name)) { console.log('FAIL dispose 未清理: ' + name); failed += 1; }
}

console.log(failed === 0 ? `\nALL ${expected.length} TOOLS PASSED` : `\n${failed} TOOL(S) FAILED`);
process.exit(failed === 0 ? 0 : 2);
