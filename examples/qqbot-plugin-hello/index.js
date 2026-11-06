// QQBot 市场插件示例
// 约定：导出 apply(ctx, config) 函数；返回清理函数（可选）。
// ctx 与主插件相同，可访问 ctx.tools / ctx.get 等能力。
export function apply(ctx, config) {
  const disposers = [];
  if (ctx && ctx.tools && typeof ctx.tools.register === 'function') {
    disposers.push(
      ctx.tools.register({
        name: 'hello_echo',
        title: '回声（示例插件）',
        description: '把输入文本原样返回，用于验证市场插件已加载并注册了工具',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要回显的文本' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
          render: function (_args, value) {
            return [{ type: 'text', text: value.text }];
          },
        },
        execute: async function (args) {
          return { text: 'echo: ' + String(args.text || '') };
        },
      }),
    );
  }
  return function () {
    for (const d of disposers) {
      try { d(); } catch {}
    }
  };
}

export default { apply };
