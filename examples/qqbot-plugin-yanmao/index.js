// 烟猫运维助手 - QQBot 市场插件
// 提供工具：yanmao_status, yanmao_sync_rules, yanmao_send_group
// 通过读取主插件的配置和调用 OneBot HTTP API 工作

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readMainConfig() {
  // 主插件的配置通常由 DSH configEditor 持久化；这里尝试从常见位置读取
  // 作为市场插件，我们也接受运行时通过工具参数传入 endpoint/token
  return null;
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
    signal: AbortSignal.timeout(5000),
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + text.slice(0, 200));
  if (j && j.retcode !== undefined && j.retcode !== 0) throw new Error(j.msg || ('retcode ' + j.retcode));
  return j && j.data !== undefined ? j.data : j;
}

function textOut(text) {
  return {
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    render: (_a, v) => [{ type: 'text', text: v.text }],
  };
}

export function apply(ctx, config) {
  const disposers = [];
  const cfg = config || {};
  // 允许在市场插件 config 里预置默认 endpoint/token
  const defaultEndpoint = String(cfg.endpoint || cfg.httpEndpoint || '');
  const defaultToken = String(cfg.token || '');

  if (ctx && ctx.tools && typeof ctx.tools.register === 'function') {
    // 1) yanmao_status - 检查 OneBot 连通性和登录信息
    disposers.push(ctx.tools.register({
      name: 'yanmao_status',
      title: '烟猫状态检查',
      description: '检查烟猫机器人的 OneBot v11 连通性，返回登录账号、昵称和群数量',
      parameters: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', description: 'OneBot HTTP 端点，如 http://100.125.255.91:3000（可留空使用插件配置）' },
          token: { type: 'string', description: '访问 token（可留空）' },
        },
        additionalProperties: false,
      },
      output: textOut(),
      execute: async (args) => {
        const ep = String(args.endpoint || defaultEndpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : defaultToken || '');
        if (!ep) return { text: '❌ 未提供 OneBot 端点。请传入 endpoint 或在插件配置中设置。' };
        try {
          const login = await onebotCall(ep, tk, 'get_login_info', {});
          let groupCount = '?';
          try {
            const groups = await onebotCall(ep, tk, 'get_group_list', {});
            groupCount = Array.isArray(groups) ? groups.length : '?';
          } catch {}
          const qq = login && login.user_id;
          const nick = login && login.nickname;
          return { text: `✅ 烟猫在线\n- QQ: ${qq}\n- 昵称: ${nick}\n- 群数量: ${groupCount}\n- 端点: ${ep}` };
        } catch (e) {
          return { text: `❌ 连接失败: ${String(e && e.message || e)}\n- 端点: ${ep}` };
        }
      },
    }));

    // 2) yanmao_send_group - 发送测试消息
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
        const ep = String(args.endpoint || defaultEndpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : defaultToken || '');
        const gid = String(args.groupId || '').trim();
        const msg = String(args.message || '');
        if (!ep) return { text: '❌ 未提供 OneBot 端点' };
        if (!gid) return { text: '❌ groupId 不能为空' };
        if (!msg) return { text: '❌ message 不能为空' };
        try {
          const data = await onebotCall(ep, tk, 'send_group_msg', {
            group_id: parseInt(gid, 10) || 0,
            message: msg,
            auto_escape: false,
          });
          const mid = data && (data.message_id || data.messageId) || '';
          return { text: `✅ 已发送到群 ${gid}${mid ? ' (message_id=' + mid + ')' : ''}` };
        } catch (e) {
          return { text: `❌ 发送失败: ${String(e && e.message || e)}` };
        }
      },
    }));

    // 3) yanmao_groups - 列出群列表
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
        const ep = String(args.endpoint || defaultEndpoint || '').trim();
        const tk = String(args.token !== undefined ? args.token : defaultToken || '');
        if (!ep) return { text: '❌ 未提供 OneBot 端点' };
        try {
          const groups = await onebotCall(ep, tk, 'get_group_list', {});
          if (!Array.isArray(groups) || groups.length === 0) return { text: '（无群或获取失败）' };
          const lines = groups.map((g) => `- ${g.group_name || '(未命名)'} (${g.group_id})`);
          return { text: `共 ${groups.length} 个群：\n` + lines.join('\n') };
        } catch (e) {
          return { text: `❌ 获取失败: ${String(e && e.message || e)}` };
        }
      },
    }));
  }

  return function () {
    for (const d of disposers) {
      try { d(); } catch {}
    }
  };
}

export default { apply };
