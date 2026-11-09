# Repository Guidelines

## 项目结构与模块组织

本目录保存 DSH 服务部署说明、本地插件和渠道源码。

- `plugins/dsh-smart-router/index.js`：分类后端、路由映射、事件处理及辅助函数。
- `plugins/dsh-smart-router/package.json`：ES module 元数据和 bundle 注册入口；`cordis.patch.yml` 负责挂载插件。
- `DEPLOY.md`：版本配套、配置、部署和排障说明。
- `plugins/dsh-session-guard/`：渠道会话存档读取保护与 Linux sandbox 包装。
- `plugins/dsh-office-assistant/`：微信搜索、办公文件交付、待办和提醒命令。
- `vendor/dsh-channels/`：独立 Git 源码仓库，微信会话与命令实现位于 `packages/channel-harness/`；先遵循该仓库的 `AGENTS.md`。
- `vendor/dsh-web-search-bing/`、`vendor/dsh-office-kit/`、`vendor/dsh-todo-reminder/`：独立 Git 插件源码；办公组件先遵循其 `AGENTS.md`。
- `awesome-dsh-plugin/`：独立 Git 插件索引仓库。

本地插件测试与源码同目录；渠道测试在对应包的 `test/`。本文件是贡献指南；部署环境的 `~/.dsh/AGENTS.md` 是运行时指导语，不可互相覆盖。

## 构建、测试与本地开发

本地插件使用 JavaScript，无编译步骤；历史保护复用锁定版本的 DSH API。从仓库根目录执行：

```bash
node --check plugins/dsh-smart-router/index.js
node --test plugins/dsh-smart-router/*.test.js plugins/dsh-session-guard/*.test.js plugins/dsh-office-assistant/*.test.js
```

第一条命令检查语法，第二条运行插件测试。按 `DEPLOY.md` 准备 Node.js ≥24.9 和 `dsh 0.2.1-rc.5`。在独立开发环境中，经确认后注册插件并启动 Web UI：

```bash
dsh plugin --profile web add "link:$PWD/plugins/dsh-smart-router"
dsh web --no-open
```

注册会修改本机 `web` profile。智能路由使用公开的 `agent/inbox/claimed` 和 `agent/request` 事件；手动模型策略不得被自动路由覆盖。

## 代码风格与命名

沿用现有 JavaScript：两空格缩进、单引号、分号、ES module 和 `node:` 内置模块导入。函数与变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`；保留接口字段 `task_type` 等既有命名。未配置 ESLint 或 Prettier。保持改动最小，避免无关重构和格式化。

## 测试要求

本地插件使用 `node:test` 和 `*.test.js`，没有覆盖率门槛。渠道仓库使用 Vitest、TypeScript、Node.js ≥24.9 和 pnpm 9.15.3；修改后在该仓库运行 `pnpm ci:check`。插件测试示例：

```bash
node --test plugins/dsh-smart-router/*.test.js
```

待办仓库运行 `npm run typecheck` 和 `node --test test/*.test.mjs`。办公仓库使用隔离的 `HOME` 和已准备的 Python 运行时，直接运行 `node_modules/.bin/vitest run`；不要在安装时触发上游自动修复脚本。变更后按 `DEPLOY.md` 构建并验证对应产物。

路由修改应验证正常改写、低置信度、超时、分类异常和 `/` 命令绕过。保持 fail-open：分类不可用时保留默认模型。模拟分类请求，避免测试调用付费 API。集成验证应使用模拟模型，检查路由、预设作用域、会话迁移及历史保护，并明确哪些真实渠道场景尚未验证。

## 提交与 Pull Request

根目录没有 `.git`，两个子仓库保留独立历史。渠道仓库采用 Conventional Commits，如 `fix(channel-harness): ...`。PR 应说明目的、行为变化、验证命令与结果，关联已有 issue；路由变更附脱敏日志，配置或版本变更同步更新 `DEPLOY.md`。

## 配置、安全与操作边界

密钥通过 `DEEPSEEK_API_KEY`、`TYPESAFE_API_KEY` 等环境变量提供；部署环境的 `~/.dsh/dsh.env` 保持 `0600` 权限。不要提交密钥、访问令牌、凭据或 `router.log`。历史保护的 `protectedDataHomes` 与 `protectedPaths` 必须同时覆盖线上数据、旧数据和迁移副本。远端写入、删除文件或分支、增删依赖、数据迁移、CI 与密钥变更须先确认。
