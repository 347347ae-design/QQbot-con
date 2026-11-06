// 用 mock React 实际执行 client.js 的组件渲染，捕获未定义变量等运行时错误
import fs from 'node:fs';
import path from 'node:path';

const file = 'D:/Anno tokoy/qqbot-skillpack-plugin/client.js';
const src = fs.readFileSync(file, 'utf-8');

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(def) { captured = def; },
  },
};

// 执行模块注册代码
const fn = new Function('window', src);
fn(globalThis.window);

if (!captured || typeof captured.factory !== 'function') {
  console.error('FAIL: factory not captured');
  process.exit(1);
}

// mock React：支持 createElement / useState / useEffect
const React = {
  createElement: function (type, props, ...children) {
    return { type, props, children };
  },
  useState: function (init) {
    const v = typeof init === 'function' ? init() : init;
    return [v, function () {}];
  },
  useEffect: function (cb) {
    // 不执行 effect，避免网络请求
  },
};

const moduleObj = { exports: {} };
const result = captured.factory((name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
});

// 取组件：apply 注册时会拿到 QQBotSettingsPage，但我们直接找到它
// factory 内部把 exports.apply 暴露出来，apply 内部注册 QQBotSettingsPage
// 我们改为直接调用 apply，用 mock ctx 抓取组件
let Page = null;
const ctx = {
  effect: () => {},
  locale: {
    register: () => {},
    bind: () => (k) => k,
  },
  slots: {
    inject: (name, cb) => { if (typeof cb === 'function') cb(); },
    register: (meta, comp) => { Page = comp; },
  },
  get: () => undefined,
  uiWorkspace: undefined,
};

result.apply(ctx);
if (!Page) {
  console.error('FAIL: component not captured from slots.register');
  process.exit(1);
}

// 用最小 props 渲染一次
try {
  const tree = Page({ pickDirectory: () => Promise.resolve(null) });
  // 递归统计节点数
  let count = 0;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    count += 1;
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(tree);
  console.log('OK: rendered nodes =', count);
} catch (e) {
  console.error('RENDER ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
  process.exit(2);
}
