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
- **自动检查更新**：设置页可检查 GitHub 仓库最新版本

## 安装（DSH）

1. 把本目录放到一个本地路径，例如 `D:\plugins\qqbot-skillpack-plugin`
2. 在 DSH 中用插件管理器安装该目录（Profile → 插件 → 安装本地 bundle）
3. 重启或刷新后，设置页出现「QQBot 技能包」

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
- `POST /send_group_msg`（后续消息收发用）

## License

MIT
