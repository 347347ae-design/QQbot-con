// 直接以 Node 加载 index.js，用 mock ctx 跑市场接口端到端测试
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL('D:/Anno tokoy/qqbot-skillpack-plugin/index.js').href);
const apply = mod.apply;
if (typeof apply !== 'function') {
  console.error('FAIL: apply not exported');
  process.exit(1);
}

const tools = [];
const handlerRef = { fn: null };

const ctx = {
  tools: {
    register(def) {
      tools.push(def.name);
      return () => {
        const i = tools.indexOf(def.name);
        if (i >= 0) tools.splice(i, 1);
      };
    },
  },
  effect(cb) { return cb(); },
  get(name) {
    if (name === 'webServer') {
      return { register(route) { handlerRef.fn = route.handler; return () => {}; } };
    }
    return undefined; // configEditor 不可用，持久化会跳过
  },
};

const dispose = apply(ctx, {});
if (typeof dispose !== 'function') {
  console.error('FAIL: apply did not return disposer');
  process.exit(1);
}
if (!handlerRef.fn) {
  console.error('FAIL: webServer handler not registered');
  process.exit(1);
}

async function call(body) {
  const chunks = [Buffer.from(JSON.stringify(body), 'utf-8')];
  const req = {
    method: 'POST',
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
  };
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s; },
  };
  await handlerRef.fn(req, res);
  try { return JSON.parse(res.body); } catch { return { ok: false, error: 'non-json: ' + res.body, _code: res.statusCode }; }
}

let failed = 0;
const check = (label, cond, extra) => {
  if (cond) console.log('PASS ' + label);
  else { console.log('FAIL ' + label + (extra ? ' -> ' + JSON.stringify(extra) : '')); failed += 1; }
};

// 1) 空列表
let r = await call({ action: 'market_list' });
check('market_list 初始为空', r.ok === true && Array.isArray(r.plugins) && r.plugins.length === 0, r);

// 2) 本地目录安装示例插件
r = await call({ action: 'market_install', spec: 'examples/qqbot-plugin-hello' });
check('market_install 本地目录安装成功', r.ok === true && r.plugin && r.plugin.id === 'qqbot-plugin-hello', r);
check('安装后立即加载（无需重启）', r.loaded === true, r);
check('插件工具已注册 hello_echo', tools.includes('hello_echo'), tools);

// 3) 重复安装被拒绝
r = await call({ action: 'market_install', spec: 'examples/qqbot-plugin-hello' });
check('重复安装被拒绝', r.ok === false, r);

// 4) 列表包含已安装且已启用
r = await call({ action: 'market_list' });
const inst = (r.plugins || []).find((p) => p.id === 'qqbot-plugin-hello');
check('列表出现已安装插件', !!inst && inst.enabled === true, r);

// 5) 禁用 -> 工具应被清理
r = await call({ action: 'market_toggle', id: 'qqbot-plugin-hello', enabled: false });
check('禁用成功', r.ok === true && r.enabled === false, r);
check('禁用后工具已注销', !tools.includes('hello_echo'), tools);

// 6) 启用 -> 工具重新注册
r = await call({ action: 'market_toggle', id: 'qqbot-plugin-hello', enabled: true });
check('启用成功', r.ok === true && r.enabled === true, r);
check('启用后工具重新注册', tools.includes('hello_echo'), tools);

// 7) 卸载 -> 记录与工具都消失
r = await call({ action: 'market_remove', id: 'qqbot-plugin-hello' });
check('卸载成功', r.ok === true && r.removed === true, r);
check('卸载后工具已注销', !tools.includes('hello_echo'), tools);
r = await call({ action: 'market_list' });
check('卸载后列表为空', r.ok === true && (r.plugins || []).length === 0, r);

// 8) 未知路径安装给出明确错误
r = await call({ action: 'market_install', spec: 'examples/not-exists' });
check('不存在路径返回错误', r.ok === false && /不存在/.test(r.error || ''), r);

dispose();
console.log(failed === 0 ? '\nALL TESTS PASSED' : '\n' + failed + ' TEST(S) FAILED');
process.exit(failed === 0 ? 0 : 2);
