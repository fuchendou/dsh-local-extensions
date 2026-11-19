# PersonalAI DSH 部署

## 当前版本

| 组件 | 版本 |
| --- | --- |
| DeepSeek Harness 和 Web | 0.2.2-rc.5 |
| Node.js / 生产 profile 安装器 | 24.22.2 / pnpm 12.15.0 |
| 渠道 bundle / Harness 适配 | 0.5.2-personalai.2 / 0.5.2-personalai.10 |
| 微信 / 渠道文件 | 0.5.2-personalai.3 / 0.5.2-personalai.2 |
| Super-agent / 会话保护 | 0.1.0-personalai.2 / 1.1.6 |
| 智能路由 / 办公助手 | 1.3.0 / 1.1.0-personalai.2 |
| Office Kit / 待办提醒 | 0.4.7-personalai.5 / 0.3.0-personalai.4 |

Web 设置页读取官方客户端构建的版本元数据。渠道的 \`/version\` 同时显示渠道包版本和对应的 Harness 基线。

## 服务与数据

- \`dsh-web.service\` 运行 Web、微信入口、模型调用与投递。服务监听 \`127.0.0.1:3080\`，本机通过现有 SSH 隧道访问。
- 活动 \`DSH_HOME\` 由 systemd 配置指定。其 \`profiles/web\` 保存对应的包清单、锁文件和 Cordis 补丁。\`workspaces\` 指向用户的数据目录。
- 会话、附件、微信绑定和游标、待办与提醒、订阅与投递状态归入持久数据。凭据由 \`dsh.env\` 和凭据存储提供，文件权限保持 \`0600\`。
- \`dsh-superagent-isolation.socket\` 和对应服务通过 Unix socket 验证 DSH 主进程身份。个人执行者在独立 systemd 单元中执行文件、shell、作业和办公解析。隔离不可用时调用失败。普通会话、目标和早报使用 Landlock，并通过会话保护绕开持久数据目录。

## 运维

\`\`\`bash
ssh personalai 'dsh --version && systemctl is-active dsh-web.service dsh-superagent-isolation.service dsh-superagent-isolation.socket'
ssh personalai 'curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/api/todo/state'
\`\`\`

匿名请求预期返回 \`401\`。在已配置 macOS SSH 隧道的环境运行 \`scripts/open-dsh-web.command\` 打开浏览器，再到「设置 → 通用设置」查看版本。

智能路由沿用现有模型配置，保留 Web 和渠道手动选模。搜索使用 Bing，网页提取使用公网地址检查。主配置放在当前 profile，补丁加载时使用 [版本兼容配置](scripts/dsh-0.2.2-rc.5/profile.patch.yml)。

安装 profile 后，把 [会话控制器入口](scripts/dsh-0.2.2-rc.5/personalai-session-controller.mjs) 复制到该 profile 的 `node_modules/@deepseek-ai/dsh-api-session-controller/`。该入口加载自定义路由控制器，并通过所属包的元数据发布官方 Web 会话模块。

## 微信使用

- \`/help\` 查看命令，\`/model\` 切换模型，\`/sessions\` 和 \`/switch\` 管理自己的会话。
- \`/goal\`、\`/plan\` 与 \`/execute\` 管理后台目标和规划。会话切换时以微信绑定的所有者为准。
- \`/documents\`、\`/spreadsheets\`、\`/presentations\`、\`/pdf\` 使用办公技能，文件沿现有微信回送链路发送。
- \`/todo\`、\`/remind\` 和 \`/brief\` 管理待办、提醒与早报。早报按现有订阅和北京时间调度。
- \`/super on\` 开启个人 Super-agent。命令式文本进入待确认流程，用本次的 \`/super confirm <确认码>\` 授权。用 \`/tasks\` 查看本人任务，用 \`/stop\` 停止工作或取消待确认，用 \`/super off\` 返回普通聊天。

## 构建、切换与检查

1. 通过渠道仓库的 \`pnpm ci:check\`、Super-agent 的 \`pnpm typecheck\`、\`pnpm build\`、\`pnpm test\` 及本地插件测试后打包。按冻结锁文件安装 profile，核对上游包的完整性和私有包的 SHA-256。
2. 用独立 Linux profile 运行模拟模型和微信适配器，验证隔离代理、确认和重启恢复、中文办公生成、附件和四种文件的投递。模型配置和测试文件留在验证实例内。
3. 等待现网目标、任务及未结投递排空。停止 DSH 和隔离代理，从同一停机快照复制持久数据，保持工作区链接、微信游标和已完成的送达状态。保护目录覆盖当前数据与切换期间的复制件。
4. 先启动隔离 socket 与代理，再启动 DSH。核对 CLI、Web 页和渠道基线、匿名访问、原会话与微信绑定。无需在现网生成验收文件。
5. 新版启动失败且持久状态未推进时可恢复切换前版本。若已收到真实消息或产生投递，先保全新写入并核对游标和回执。验收通过后清理过期安装、备份和验证实例。
