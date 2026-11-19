# 个人 Super-agent 的 systemd 隔离执行

由 DSH 保留模型、微信、用户授权、任务状态及投递回执。`isolatedWorkers: true` 时，后台 Session 的文件和 shell 工具通过本地 Unix socket 交给任务单元。任务单元不可用时，相关工具返回错误。

- `index.js` 连接代理，校验文件传输的大小和 SHA-256，并将隔离端传来的有界 RGB 像素封装成 PNG。
- `server.py` 核对 Unix socket 对端是配置中 DSH 服务的主进程。`broker.py` 只接受预定义操作，按任务和分配序号管理固定 systemd 单元。
- `systemd_task.py` 定义独立 UID、挂载、网络、IPC、设备和进程可见范围。输入以副本只读挂载。工作目录根据该次任务权限挂载。任务停止时由 systemd 清理该单元的全部进程。
- `tool_worker.mjs` 在单元内启动现有 DSH 文件、图片、搜索、shell 和作业工具。`attachment_reader.py` 在同一边界内读取办公附件。
- `file_exchange.py` 用 Linux `openat2` 和文件描述符读取交付文件，拒绝符号链接、硬链接、特殊文件和超过 20 MiB 的文件。`prepare_runtime.py` 根据当前 DSH 发行目录创建只读运行时快照，生成文件清单。

只读任务仍有私有临时目录。任务工作区由代理保存在宿主的根用户专用目录。旧会话工作区继续保留，任务只能读取本任务的副本和运行时。两个并行后台任务和按需解析的路由图片可分别使用独立账号。当前 Linux 运行时无 PowerShell，隔离后台 Session 不提供该工具。

Linux 测试用 `python3 -B -m unittest discover -s plugins/dsh-superagent-isolation`。本地运行 `node --test plugins/dsh-superagent-isolation/raster.test.js` 验证图片交接。`tool_worker.test.mjs` 需要 `DSH_ISOLATION_RUNTIME` 指向配置了 Node 24.22.2 对应 DSH 0.2.1-rc.5 的运行时目录，并在新建的临时工作目录运行。
