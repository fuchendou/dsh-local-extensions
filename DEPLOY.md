# DSH (DeepSeek Harness) 远程 AI 服务部署文档

> 首次部署：2026-10-28 ｜ 能力扩展：2026-10-31 ｜ 服务器：personalai (Ubuntu 24.04)

> 本文中的 `outputs/` 路径是原部署环境的本地记录，不包含在此公开仓库中；引用的交付物、日志和验证记录需在原环境查阅。

## 架构

```
手机微信私聊 ⇄ 微信好友机器人 ⇄ (iLink 长轮询出站, 无需公网入站)
                                    ⇄ dsh-web systemd 服务 (127.0.0.1:3080)
                                        ├─ smart-router 智能路由插件（消息分类 → 自动选模型）
                                        │    ├─ 分类器: MiniMax-M3.1-Flash / low（经 Harness）
                                        │    └─ 挂点: agent/inbox/claimed + agent/request waterfall
                                        ├─ AGENTS.md 全局指导（群聊军师/微信回复规范）
                                        ├─ DeepSeek API: deepseek-flash / deepseek-v4-pro
                                        ├─ MiniMax API: MiniMax-M3.1-Flash（默认模型）
                                        ├─ 渠道插件 (@wsz987/dsh-channels 0.5.2-personalai.1)
                                        ├─ office-assistant（08:55 准备 / 09:00 主动早报，北京时间）
                                        └─ [待启用] Notion MCP（等 integration token）
笔记本浏览器 ⇄ SSH 隧道 ⇄ 127.0.0.1:3080 (管理用)
```

- **手机入口**：微信私聊机器人好友，发消息即指令，Agent 执行后回复
- **管理入口**：SSH 隧道访问 Web UI（见下文）
- **安全**：服务只绑定 127.0.0.1，公网仅开放 22 (SSH)；Web UI 启动时生成登录令牌

## 版本清单（必须配套）

当前发布目录为 `~/.dsh-upgrades/dsh-0.2.1-rc.5-20261103-r1`，其中 `home/` 是 `dsh-web` 的 `DSH_HOME`。2026-11-03 04:23（America/Los_Angeles）完成 DSH 升级；2026-11-04 更新渠道帮助、Web 认证和办公插件并重启；2026-11-09（北京时间）经用户批准上线主动早报与回答质量改进，主模型配置为 MiniMax。

| 组件 | 当前版本 / 位置 |
|---|---|
| 服务 Node.js | `24.22.2`，发布目录的 `runtime/node/` |
| DSH | `0.2.1-rc.5`，发布目录的 `home/profiles/web/node_modules/` |
| 渠道 bundle | 本地构建 `0.5.2-personalai.1`；channel-harness `0.5.2-personalai.9`；channel-weixin `0.5.2-personalai.2`；channel-web `0.5.2-personalai.2` |
| 智能路由 / 历史保护 | `dsh-smart-router 1.2.0` / `dsh-session-guard 1.1.4` |
| 搜索 / 办公 | `dsh-web-search-bing 1.2.3` / `dsh-office-kit 0.4.7-personalai.5` |
| 待办 / 微信办公命令 | `dsh-todo-reminder 0.3.0-personalai.4` / `dsh-office-assistant 1.1.0-personalai.1` |
| pnpm / 服务 | `12.15.0` / `dsh-web.service` |

系统全局 `dsh` 仍是 `0.1.5-rc.2`，供回滚使用；不要用它管理新版 profile。运行时是预发布版本，渠道包为本地适配构建，勿执行未经验证的 `npm update` 或上游插件自动更新。`agent/request` 在当前版本仍受支持。

微信文件和回复修复的产物、完整测试日志及部署脚本位于 `outputs/dsh-weixin-file-reply-fix/`；服务端回滚备份为 `~/.dsh/dsh-channels/deployment-backups/weixin-file-reply-20261105T060512Z/`。回滚只恢复代码和配置，保留会话和办公数据。用户确认微信中重新生成的 Word 文件能够打开，回复不再重复。

## 关键文件

下文 `$DSH_HOME` 指发布目录中的 `home/`，systemd 已设置该变量；普通 SSH shell 不会自动设置。

| 文件 | 用途 |
|---|---|
| `~/.dsh/dsh.env` | systemd 读取的 API Key 环境变量，保持 `0600` |
| `$DSH_HOME/.credentials.yaml` | 当前服务的托管凭据，保持私有权限 |
| `$DSH_HOME/AGENTS.md` | 运行时全局指导语 |
| `$DSH_HOME/profiles/web/` | 当前 profile、锁文件和本地插件产物 |
| `$DSH_HOME/dsh-channels/sessions.json` | 微信会话归属、模型策略与目标意图 |
| `~/.dsh/workspaces/` | 保留的共享工作文件；新 home 的 `workspaces` 指向此处 |
| `/etc/systemd/system/dsh-web.service.d/zz-personalai-dsh-upgrade.conf` | 服务版本与 `DSH_HOME` 切换配置 |

## 智能路由（smart-router 插件）

### 工作原理

每条入站消息被 agent 认领时，经现有 Harness LLM 服务调用
`minimax-cn / MiniMax-M3.1-Flash / low` 做一次轻量分类
（task_type / complexity / confidence），然后在 `agent/request` waterfall 中
按任务类型和复杂度改写本次 LLM 调用的 provider/model/effort。
短追问附带当前会话最近三条用户需求的有限片段；不读取其他会话历史。
**fail-open**：分类失败、超时(4s)、置信度 <0.6 → 不改写，走默认模型。
手动模型策略优先；Office 技能按文档写作处理，普通 `/` 控制命令绕过分类。

### 当前路由映射表

| 分类 | 判据举例 | 路由 |
|---|---|---|
| chat | 闲聊、问候、简单问答 | 默认模型 MiniMax-M3.1-Flash（不改写） |
| quick_task | 查服务器状态、设提醒等单步任务 | MiniMax-M3.1-Flash / low |
| coding | 写代码、调试、脚本 | MiniMax-M3.1-Flash / high；复杂度 3 为 max |
| reply_advice | 转发聊天记录/截图求总结或回复建议 | MiniMax-M3.1-Flash / high；复杂度 3 为 max |
| doc_writing | 写文章、报告、长文案 | MiniMax-M3.1-Flash / high；复杂度 3 为 max |
| research | 复杂分析、方案对比、决策支持 | MiniMax-M3.1-Flash / max |

其他任务复杂度为 2 时使用 high、为 3 时使用 max；带附件的会话保留视觉兼容配置，复杂度至少为 2 时使用 max。早报生成及独立审阅固定使用 MiniMax high。有效配置见 `outputs/dsh-proactive-quality/minimax-profile.json`，由线上 profile 覆盖源码中的兼容默认值。

改映射表：在本地修改 `plugins/dsh-smart-router/index.js` 后重新构建并部署产物；也可在当前 profile 的 `cordis.patch.yml` 中为 `smart-router` 配置覆盖。patch 的 `config` 整体替换原配置，修改前先保留已有值。

### 查看路由决策

```bash
ssh personalai 'tail -20 ~/.dsh-upgrades/dsh-0.2.1-rc.5-20261103-r1/home/profiles/web/node_modules/dsh-smart-router/router.log'
# 示例输出：
# route: type=coding complexity=1 confidence=0.98 -> minimax-cn/MiniMax-M3.1-Flash effort=high
# route: type=research complexity=3 confidence=0.97 -> minimax-cn/MiniMax-M3.1-Flash effort=max
# no-route: type=chat uses default model
```

### 切换到 Jev 分类器（已预留，拿到 key 后两步）

1. `echo 'TYPESAFE_API_KEY=你的key' >> ~/.dsh/dsh.env`（0600 权限）
2. 在 `cordis.patch.yml` 加覆盖（或直接改 index.js DEFAULTS）：
   ```yaml
   - id: smart-router
     name: dsh-smart-router
     config:
       classifier:
         backend: jev
   ```
   然后 `sudo systemctl restart dsh-web`。
   注意：api.typesafe.ai 在大陆有 451 屏蔽风险，不通时改 `jevBaseURL` 走
   OpenRouter 网关（openrouter.ai/api，Decisions API 同构）。

### 历史验证（2026-10-31 Web UI 实测，旧路由）

- coding 消息 → deepseek-flash（徽章实时切换，confidence 0.98）
- research 消息 → deepseek-v4-pro effort=max（同会话内自适应切换）
- chat 消息 → 默认 MiniMax-M3.1-Flash（no-route，fail-open 生效）

## 群聊军师与转发工作流

**微信插件协议层只有私聊（groups: false 硬编码），无法自动监听群消息。**
替代工作流（已可用）：把群里的内容**转发给机器人好友**——

- 单条消息/文件/截图/语音：直接转发，自动解析（PDF/DOCX/XLSX/TXT 提取器，
  100MB 上限，`read_channel_attachment` 工具）
- 合并转发的聊天记录：可能解析为 unsupported 类型 → 用**逐条转发**或**截图**替代
- 收到后按 AGENTS.md 的军师流程：总结脉络 → 各方立场 → 2-3 条不同语气的建议回复

**多话题隔离**：转发不同群的内容前，先发 `/new`（或 `/new 群A`）开新会话，
上下文彻底切断。`/status` 可查看当前会话用的模型。

### 升级前原版命令（回滚参照）

以下为升级前的命令行为。2026-11-02 已部署下文增强版；微信端效果由用户后续自行验收。

| 命令 | 作用 |
|---|---|
| `/new [标签]` | 结束当前会话，下条消息开全新会话（隔离用） |
| `/model <provider> <model> [effort]` | 手动切换当前会话模型（会同时设为新会话默认） |
| `/models [provider]` | 列出已注册的 provider 和模型 |
| `/status` | 查看会话状态 + 当前模型选择 |
| `/stop` | 停止当前正在进行的回复 |

### 微信会话增强版上线

增强版最初基于 `dsh 0.1.5-rc.2` 和 channels `0.5.1`；现已适配 `0.2.1-rc.5`，使用独立构建的渠道包和本地插件。Notion 不参与此次变更。

源码位置：`vendor/dsh-channels/`、`plugins/dsh-smart-router/`、`plugins/dsh-session-guard/`；交付说明与验证记录在 `outputs/wechat-session-upgrade/`。`awesome-dsh-plugin/` 是独立克隆的目录索引，不承担微信运行时代码。

当前部署：`dsh-0.2.1-rc.5-20261103-r1`。旧部署 `wechat-session-32c845a90ea3` 保留用于回滚。新版的构建、迁移、回滚和部署记录见 `outputs/dsh-upgrade-0.2.1-rc.5/`；真实微信验收结果见 `outputs/dsh-office-daily/COMMAND-TESTS.md`。

在 `channels-harness` 行保留原有配置并增加：

```yaml
sessionControl:
  enabled: true
```

该功能默认关闭以保持原有渠道兼容。DSH patch 的 `config` 是整体替换，不能用单字段覆盖已有自定义配置。新索引默认保存到 `$DSH_HOME/dsh-channels/sessions.json`；旧 V3 日志保留，副本迁移为 V4；仅登记已有绑定和新创建、明确属于当前微信对话的会话，未确认归属的旧会话不会自动列出。

增强模式的 `/bind` 与 `/switch` 使用同一归属校验，仅接受已登记会话；不能通过旧版绑定命令绕过此限制。上线不会清空已有聊天，空白上下文从下一次 `/new` 开始生效。

| 指令 | 增强版行为 |
|---|---|
| `/new [名称]` | 空白聊天，回执提供短 ID；共享工作文件保留 |
| `/session`、`/status` | 当前会话、实际模型、工作模式与目标状态 |
| `/sessions [页码]` | 每页 10 条本人所属会话，标记当前项 |
| `/switch <短ID>` | 恢复指定会话；后台目标继续运行 |
| `/history [短ID] [页码]` | 分页显示原始聊天，不向当前模型注入；单个页码查询当前会话 |
| `/rename <名称>` | 修改会话名，最长 80 字 |
| `/compact` | 原生上下文压缩；目标会话先暂停，压缩后可 `/goal resume` |
| `/models [provider]` | 模型列表；指定 provider 时附思考强度 |
| `/model`、`/model auto` | 查看策略与最近实际模型，或恢复全自动 |
| `/model <provider> <model> [effort]` | 只锁定当前会话，不改全局默认 |
| `/effort [等级或 auto]` | 查看／设置当前模型强度；设置时锁定当前模型，`auto` 清除强度覆盖 |
| `/plan [需求]`、`/plan off` | 只读规划；`off` 退出但不执行 |
| `/execute` | 执行本会话的已有计划；目标会话恢复目标 |
| `/goal`、`/goal <目标>` | 新建独立目标会话，分别在下一条需求或立即开始 |
| `/goal status\|pause\|resume [短ID]` | 查看、暂停、恢复目标；省略 ID 操作当前会话 |
| `/stop` | 停止当前执行，并暂停当前目标的自动续行 |

`/help` 按会话、模型、规划与目标、状态及其他功能分组，逐项列出用途和用法；发送 `/help goal` 或 `/help /goal` 可查看单项详情。`/effort auto` 仍会锁定当前模型，恢复自动选模应使用 `/model auto`。`/export` 由 Web 浏览器下载，微信中不会触发下载。帮助预览和部署记录见 `outputs/dsh-help-redesign/`；用户已确认微信 `/help` 正常。

目标沿用原生 256 轮上限。普通不确定事项自行做合理假设；目标会话不弹出询问或扩大权限，确需授权、外部条件或执行失败时保留进度并停止。切走后继续执行，完成／阻塞通知标注会话名与短 ID；运行进度可用 `/goal status <短ID>` 查询。通知失败保留待发状态并重试，已确认发送的状态不重复发送；平台不提供事务性确认，因此进程在发送成功与本地确认之间崩溃时仍可能重复通知。

历史保护覆盖渠道模型的文件工具、终端和脚本执行。`protectedDataHomes` 覆盖新旧数据目录，`protectedPaths` 覆盖迁移副本、备份及私有日志；受控 `/history` 和运行时持久化仍由宿主服务读取。目标 Linux 的 Landlock 为 `partial`，针对存档拒读、共享文件读取和只读模式写入限制的验证通过，不宣称完整环境隔离。渠道进程调用不可切到 `danger-full-access` 绕过该边界。

上线前备份 profile、锁文件、插件与会话数据，并确认私有 tarball override 实际生效。版本与哈希以交付 manifest 为准。回滚保留新版数据，但旧服务只能显示切换前的历史；不要用旧备份覆盖新版数据。

部署注意：pnpm 12 的 override 必须合并到 `pnpm-workspace.yaml`，仅写 `package.json.pnpm` 不生效。保护插件停用原 `sandbox` 条目并新增 `channel-history-sandbox`，两者提供同一 sandbox 服务；patch 的 `name` 是匹配条件，不能用来替换插件。隔离启动须使用 `$DSH_HOME/profiles/web` 下的真实目录，符号链接 profile 会导致模块解析失败。将 profile 移到正式目录时，须按新位置换算锁文件内私有 tarball 的相对路径，再执行离线 frozen 安装；包内容与依赖版本保持不变。

### 办公与日常功能

2026-11-04 已部署联网搜索、Office 文件、个人待办和北京时间提醒，并更新 `/help`；DSH 运行时版本未变。交付包与验证记录位于 `outputs/dsh-office-daily/`。使用示例：

```text
/search 关键词
/documents 根据资料制作会议纪要
/spreadsheets 制作预算表
/presentations 制作五页汇报
/pdf 总结刚发送的 PDF
/todo add 周五提交周报
/todo archived
/remind +10m 喝水
/remind daily 09:00 日报
/remind weekly fri 17:00 周报
/reminders
```

发送 `/help 指令名` 查看完整用法。待办和提醒按授权渠道用户隔离；微信命令及 Web 面板的提醒时间均按北京时间，到期只通知，不执行任务。微信文件投递限工作目录内的 DOCX、XLSX、PPTX、PDF，单个文件不超过 20 MiB；投递失败会提示。PDF 扫描件不保证可识别。

部署脚本核对包哈希、基线和锁文件，在服务器隔离目录使用固定哈希的离线 Python wheels 验证四种格式的创建与渲染、中文 PDF 表单和盖章后，创建正式 Office 运行时并切换 profile。首次部署备份位于 `~/.dsh/dsh-channels/deployment-backups/office-daily-20261105T043647Z/`，后续修复的备份分别位于同目录的 `todo-timezone-20261105T045427Z/`、`office-remedy-20261105T051434Z/` 和 `weixin-file-reply-20261105T060512Z/`；回滚仅恢复代码和配置，保留 Office、待办及会话数据。首次部署脚本拒绝覆盖已有 `$DSH_HOME/office`。部署后真实模型在 Web 创建并交付 Word，微信发送接口已确认一次性提醒；用户确认微信 `/help`、`/search`、`/todo` 正常，新生成的 Word 文件可以打开且回复不重复。

### 主动早报与回答质量（已上线）

2026-11-09（北京时间）已部署：smart-router `1.2.0`、office-assistant `1.1.0-personalai.1`、channel-harness `0.5.2-personalai.9`、todo-reminder `0.3.0-personalai.4`，并开启唯一所有者的早报订阅。发布记录、测试及部署脚本位于 `outputs/dsh-proactive-quality/`，实际部署和验收进度见该目录 `DEPLOYMENT.md`。

新增 `/brief on|off|status|now`，以及 `/brief topics 主题1,主题2`。早报默认关注 AI 模型、Agent/开发工具和部署实践，按北京时间 08:55 准备、09:00 投递本人待办与最多三条已核验的官方新消息。开启订阅即授权按订阅读取本人待办，修改待办仍须用户要求；提醒时间不等于截止日期。普通 `/remind` 的语义保持不变。

后台会话由 channel-harness 持有，当前聊天绑定保持原样。订阅、生成与投递记录保存到 `$DSH_HOME/dsh-channels/briefings/state.json`，权限 0600，属于历史保护范围。生成失败会重试，到发送时间仍不可用则发待办摘要；通知按业务日期去重并保留分段发送进度。投递失败可用 `/brief status` 查询，达到重试上限后可 `/brief now` 重新生成。

路由修复复杂度未参与选模、Office 技能绕过与定时消息遗留旧决策，并增加当前会话追问上下文和回答质量指导。按用户要求，测试和线上配置使用现有 `minimax-cn / MiniMax-M3.1-Flash`：分类与简单工具任务 low，文档、一般编码和简报 high，高复杂度与研究 max。分类改走 Harness LLM 服务，使用现有托管凭据；配置中不写入密钥。

固定 20 题评估为 18 胜、1 负、1 次评估客户端超时（计失败），达到至少 15 题改善的门槛。评审者为模型，题集曾用于调优，结果不替代真实用户及微信验收。原始输出、失败记录和完整口径见该目录 `REVIEW.md`、`quality-summary.json`。

用户已批准部署、启用早报并发送验收消息。部署脚本验证基线、包哈希、依赖图与隔离运行时后完成 profile 切换，备份位于 `~/.dsh/dsh-channels/deployment-backups/proactive-quality-20261109T044124Z/`。回滚保留新产生的用户数据，并停止本次创建的早报调度。

首次真实早报于北京时间 2026-11-09 12:47:45 获平台发送确认，用户已回复“已收到，内容可见”。本次没有检索到过去 24 小时可核验的官方资讯，未编造新闻，且未触发待办摘要降级。下一次自动投递为北京时间 2026-11-10 09:00（洛杉矶 11-09 17:00）。连续三天 11-10、11-11、11-12 的定时投递及 48 小时无互动送达仍在观察，尚未通过；只读观察记录在 `delivery-window.jsonl`，无互动和后续微信可见性仍需用户确认。

## Notion 接入（待用户 token，历史记录）

> 本节是旧版操作记录；当前 profile 路径以本文件前述 `$DSH_HOME` 为准。

mcp.notion.com 从上海服务器直连可达（实测 0.6s）。启用步骤：

1. **用户侧（2 分钟）**：notion.so/my-integrations → New integration →
   复制 token（ntf_...）→ 到要让机器人读的页面/数据库 → 右上 `···` →
   Connections → 连接刚建的 integration
2. **服务器侧**：
   ```bash
   ssh personalai
   echo 'NOTION_API_KEY=ntf_你的token' >> ~/.dsh/dsh.env   # 保持 0600
   cat >> ~/.dsh/profiles/web/cordis.patch.yml << 'EOF'
   - id: mcp-notion
     name: '@deepseek-ai/dsh-mcp-client'
     config:
       serverName: notion
       transport: streamable-http
       url: https://mcp.notion.com/mcp
       headers:
         Authorization: "Bearer ntf_你的token"
   EOF
   sudo systemctl restart dsh-web
   ```
   （不想把 token 写进 yml 的话，header 值可用 `!!js` 表达式从
   process.env.NOTION_API_KEY 取。）
3. **验证**：微信发「搜一下我 Notion 里关于 XX 的笔记并总结」，
   Agent 应出现 mcp__notion__* 工具调用。
   备选：若 hosted MCP 连不上，退 stdio 本地方案
   （`npx -y @notionhq/notion-mcp-server`，走 npmmirror）。

## 日常运维

```bash
# 服务状态 / 日志
ssh personalai 'systemctl status dsh-web'
# 当前服务使用的 DSH 版本（系统全局 dsh 是旧版）
ssh personalai 'r=~/.dsh-upgrades/dsh-0.2.1-rc.5-20261103-r1; DSH_HOME="$r/home" "$r/runtime/node/bin/node" "$r/home/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js" --version'
ssh personalai 'sudo journalctl -u dsh-web -f'          # 实时日志
ssh personalai 'sudo journalctl -u dsh-web -n 100'      # 最近日志

# 路由决策日志
ssh personalai 'tail -20 ~/.dsh-upgrades/dsh-0.2.1-rc.5-20261103-r1/home/profiles/web/node_modules/dsh-smart-router/router.log'

# 重启 / 停止
ssh personalai 'sudo systemctl restart dsh-web'

# 获取当前 Web UI 访问令牌（每次重启都会变）
ssh personalai 'sudo journalctl -u dsh-web -n 30 --no-pager | grep -oE "token=[A-Za-z0-9_-]+" | tail -1'
```

### 从笔记本访问 Web UI（管理/扫码用）

本机已配置登录后自动启动的 SSH 隧道，浏览器访问 `http://127.0.0.1:3080/`。
初次访问或浏览器登录失效时，双击 [open-dsh-web.command](scripts/open-dsh-web.command)，
脚本通过 SSH 获取当前服务的登录令牌并打开浏览器，不将令牌保存到文件。
浏览器登录 Cookie 有效期由 DSH 管理，默认 30 天。

隧道由 `~/Library/LaunchAgents/com.fuchen.personalai.dsh-web-tunnel.plist` 管理，
只绑定本机 `127.0.0.1:3080`，断线后会自动重连。查询状态：

```bash
launchctl list | grep com.fuchen.personalai.dsh-web-tunnel
```

也可在未启用自动隧道时手动建立临时隧道；两者不能同时占用本机 3080 端口：

```bash
# 终端 1：建隧道
ssh -L 3080:127.0.0.1:3080 personalai
# 终端 2：取令牌（上一节命令），浏览器打开：
# http://127.0.0.1:3080/?token=<令牌>
```

## 配置 API Key

```bash
ssh personalai
echo 'DEEPSEEK_API_KEY=sk-你的key' >> ~/.dsh/dsh.env    # 首次用 > 创建，追加用 >>
chmod 600 ~/.dsh/dsh.env
sudo systemctl restart dsh-web
```

（MiniMax 的 key 在 Web UI 中配置，当前写入 `$DSH_HOME/.credentials.yaml`；systemd 仍读取旧目录下的 `~/.dsh/dsh.env`。）

## 微信绑定（已完成 2026-10-29）

1. 笔记本按上文建隧道并打开 Web UI
2. 设置 → 渠道 → 微信 → 生成二维码，手机微信扫码确认
3. **必做**：渠道 → 安全访问 → 只允许自己的微信账号（✅ 已配置）
4. 手机微信给机器人好友发「你好」验证 ✅

## 部署过程中踩过的坑（复装时必读）

1. **Node 版本**：npmmirror 的 `latest-v22.x` 目录返回的是 v22.0.0（错误），必须查
   完整版本列表 `sort -V | tail -1` 取真实最新；当前服务固定 Node 24.22.2
2. **pnpm 12 构建拦截**：`ERR_PNPM_IGNORED_BUILDS` 硬报错。pnpm-workspace.yaml 的
   `onlyBuiltDependencies` 对 pnpm 12 **不生效**，正确做法：
   `pnpm approve-builds <包名> --yes`（protobufjs、koffi 都遇到过；状态存
   node_modules 里，删 node_modules 重装后会丢，需重新执行）
3. **dsh plugin add 中途失败不回滚**：依赖进了 package.json 的 dependencies 但
   `dsh.profile.bundles` 没注册，导致插件不挂载。手动把包名加进 bundles 数组
4. **运行时与插件版本错位**：上游 channels 0.5.1 只适配旧版 DSH；新版必须使用本项目的 `0.5.2-personalai` 构建及配套锁文件。
5. **profile 与数据格式按版本隔离**：旧版无法直接读取新版 V4 会话；恢复时使用专用回滚 profile，保留两个数据目录，不删除或覆盖现有会话。
6. **嵌套依赖解析不到**：当前 profile 显式依赖 `dsh-sandbox-local` 和 `dsh-agent-preset-registry`；必须与 DSH 版本一致。
7. **systemd 下 HMR 崩溃**：web 模板默认 `patchReload: "live"`，无 TTY 环境 HMR
   起不来 → `package.json` 里 `dsh.profile.patchReload` 改为 `"startup"`
   （代价：cordis.patch.yml 改动需重启生效，可接受）
8. **本地插件必须走官方 bundle 机制**：手写 `{id, name: 绝对路径}` 进
   cordis.patch.yml 会触发 patch-layer watching → HMR 崩溃。正确做法：插件
   package.json 声明 `dsh.bundle.patch`，然后
   `dsh plugin --profile web add link:/绝对路径`（reconcilePlugins 自动并入 bundles）
9. **运行时只显示 warning 级日志**：journalctl 里看不到 info（如插件加载成功）。
   自定义插件的关键日志要同时写文件（smart-router 的 router.log 即此用途）

## 安全清单

- [x] Web UI 仅绑 127.0.0.1；首页无令牌访问返回 401
- [x] 渠道 v1/v2 API 匿名请求返回 401，登录后可访问；跨 Origin 与不可信 Host 返回 403。服务器与本机转发端口均只监听 `127.0.0.1`。
- [x] API Key 文件权限 0600
- [x] 微信「安全访问」owner-only 白名单（其他好友私信被拦截，不进模型）
- [x] 会话隔离：每个微信会话独立持久会话（bindingStore 落盘）
- [x] AGENTS.md 安全条款：破坏性命令先确认；不外泄服务器配置/密钥
- [ ] 可选加固：dsh-budget（限额）、permission-rules（高危命令审批）、defend（防注入）
- 提醒：当前分类器会把本条消息及当前会话有限的用户需求片段发给已配置的 MiniMax API；若另行切换 Jev 后端，则改发给 TypeSafe。

## 备份与回滚

升级前备份位于 `~/.dsh/dsh-channels/deployment-backups/dsh-upgrade-0.2.1-rc.5-20261103T122336Z/`，保留旧数据目录和旧运行时。确认需要回滚并处理正在运行的目标后，在服务器执行：

```bash
python3 ~/.dsh-upgrades/dsh-0.2.1-rc.5-20261103-r1/rollback-upgrade.py
```

回滚使用旧数据与专用保护插件，自动目标恢复被禁用；核对进度后可手动恢复。新版目录和上线后记录仍保留，但旧版不能直接读取 V4 记录。回滚失败时脚本尝试恢复新版服务。
