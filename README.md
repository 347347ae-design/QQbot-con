# QQbot-con

DeepSeek Harness（DSH）插件：可视化配置 OneBot v11 QQ 机器人，按群管理触发参数，并同步到本机或远程 AstrBot 即时生效。

## 功能

- **一键绑定**：选择工作区自动识别机器人（QQBot_SkillPack / NapCat / AstrBot），或直接连接 OneBot v11 HTTP 端点，自动读取 QQ、昵称、头像和全部群聊
- **机器人属性**：昵称、QQ 号、OneBot HTTP 端点、访问 Token、工作区路径
- **按群参数**：每个群可独立设置
  - `at`：必须 @ 才响应
  - `freechat`：免@按概率响应（免@概率 / 点名概率 / 冷却秒数 / 闭嘴词）
  - `off`：完全静默（连 @ 也不回）
- **保存即生效**：保存群设置后自动同步
  - 本机 AstrBot：直接写 `data/qqbot_groups.json`，必要时自动安装控制插件
  - 远程服务器：通过 SSH 写规则文件
- **发送测试消息**：设置页选群号 + 输入内容，直接通过 OneBot HTTP 发消息验证连通性
- **机器人插件市场**：从 Git 仓库或本地目录安装第三方 QQBot 插件，支持启用/禁用/卸载，**安装即生效无需重启**
- **自动检查更新**：设置页可检查 GitHub 仓库最新版本

## 机器人插件市场

### 使用

设置页 →「机器人插件市场」：

- 粘贴 Git 地址（如 `https://github.com/you/qqbot-plugin-foo.git`）或本地目录，点「安装插件」
- 已安装插件可「禁用 / 启用 / 卸载」
- 「同步远程市场」拉取目录（`catalog.json`）里可安装的插件

安装目录：插件自身目录下的 `market/<pluginId>/`；已安装清单在 `market/index.json`。

### 开发自己的插件

1. 建一个仓库（或本地目录），根目录放 `manifest.json`：

```json
{
  "id": "qqbot-plugin-foo",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "这个插件做什么",
  "author": "你的名字",
  "entry": "index.js"
}
```

2. 入口文件导出 `apply(ctx, config)`，返回清理函数（可选）：

```js
export function apply(ctx, config) {
  const dispose = ctx.tools.register({
    name: 'foo_tool',
    title: '示例工具',
    description: '做点什么',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_a, v) => [{ type: 'text', text: v.text }],
    },
    execute: async () => ({ text: 'hello from foo' }),
  });
  return () => dispose();
}
export default { apply };
```

3. 参考完整示例：[examples/qqbot-plugin-hello](examples/qqbot-plugin-hello)

4. 想让别人在市场里一键安装，把插件登记到本仓库根目录的 `catalog.json`（提交 PR 即可）：

```json
{
  "plugins": [
    { "id": "qqbot-plugin-foo", "name": "示例插件", "version": "1.0.0",
      "description": "这个插件做什么", "author": "你的名字",
      "source": "https://github.com/you/qqbot-plugin-foo.git" }
  ]
}
```

> 市场插件以宿主同权限运行，请只安装可信来源的插件。

## 安装（DSH）

1. 把本目录放到一个本地路径，例如 `D:\plugins\qqbot-skillpack-plugin`
2. 在 DSH 中用插件管理器安装该目录（Profile → 插件 → 安装本地 bundle）
3. 重启或刷新后，设置页出现「QQBot 技能包」

也可以直接把仓库地址交给 DSH 插件管理器：

```
https://github.com/347347ae-design/QQbot-con.git
```

## 服务端（AstrBot）

远程生效需要 AstrBot 端安装控制插件：

```bash
scp -r server/astrbot_plugin_dsh_control root@你的服务器:/opt/astrbot/data/plugins/
systemctl restart astrbot
```

控制插件会实时读取同目录的 `qqbot_groups.json`（放在 AstrBot 的 `data/` 下），文件变化即生效，无需重启。

## 配置说明

| 字段 | 说明 |
|---|---|
| `bot.httpEndpoint` | OneBot v11 HTTP 端点，如 `http://127.0.0.1:3000` |
| `bot.token` | 访问 Token（可留空） |
| `bot.selfQQ` | 机器人 QQ（连接后自动填写） |
| `remote.host/user/port/keyPath/jsonPath` | 远程同步用 SSH 信息 |
| `groups[]` | 每个群的触发参数 |

## 适配范围

通过标准 OneBot v11 HTTP 接口工作，适用于任何开启 OneBot v11 HTTP 服务的机器人平台（NapCat、AstrBot、SnowLuma 等）：

- `POST /get_login_info`
- `GET /get_group_list`
- `POST /send_group_msg`

## License

MIT
