# DSH 本地扩展

本仓库保存 DeepSeek Harness 的本地插件、配套部署说明，以及适配后的第三方插件源码快照。

- `plugins/`：智能路由、会话历史保护和办公助手。
- `vendor/`：第三方项目的源码快照，包含基于下列上游版本的本地改动；各项目保留自己的许可证。
- `DEPLOY.md`：部署和维护记录。
- `scripts/`：本机访问 DSH Web 的示例脚本。

| 快照 | 上游仓库 | 上游基线 commit |
|---|---|---|
| `vendor/dsh-channels` | [wsz987/dsh-channels](https://github.com/wsz987/dsh-channels) | `8401caaa340cc0ec5b29e473569993e49d2b3a5b` |
| `vendor/dsh-office-kit` | [hairyf/dsh-office-kit](https://github.com/hairyf/dsh-office-kit) | `178c4839194eabe131b088fdc8decfb8bb9a851c` |
| `vendor/dsh-todo-reminder` | [Meltllsy/dsh-todo-reminder](https://github.com/Meltllsy/dsh-todo-reminder) | `cc9cfb24c220af6a49c05252475ec331bdeed6d2` |
| `vendor/dsh-web-search-bing` | [godchen520/dsh-web-search-bing](https://github.com/godchen520/dsh-web-search-bing) | `631c95189304c02749c5c0501ff84229c8018f7c` |

原始独立仓库的 Git 历史不包含在本仓库中。本地生成的 `outputs/`、依赖目录和运行数据不纳入版本控制。
