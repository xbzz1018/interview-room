# 参与贡献

欢迎参与面试练习室。修复问题、补充测试、改进文档和完善功能都欢迎参与。

个人修改范围与保留的来源见 [NOTICE](NOTICE.md)。问题与改进请提交到 [xbzz1018/interview-room](https://github.com/xbzz1018/interview-room)，请勿将个人版问题发到上游。

## 开始之前

- 遇到 bug 或有产品建议，请在当前仓库创建 Issue，请说明运行方式、平台、复现步骤以及期望和实际结果。
- 小型修复和文档改进可以直接提交 PR。
- 新功能、架构调整或破坏兼容性的改动，建议先通过 Issue 对齐范围。

## 开发环境

项目主线全部使用 TypeScript、Bun 和 Hono，不需要 Python、pip 或 FastAPI。

要求 Bun `1.3.14` 或兼容的 `1.3.x`。首次安装：

```bash
# 进入当前仓库根目录
bun install --frozen-lockfile
cp .env.example .env
```

首次启动 Web API 前，请先修改 `.env` 中的 `JWT_SECRET`、`VOICEPRINT_ENCRYPTION_KEY` 和 `DEFAULT_PASSWORD`，不要保留示例占位值。`JWT_SECRET` 至少需要 32 个字符的随机值，`DEFAULT_PASSWORD` 至少需要 12 个字符。

Web 开发使用两个终端：

```bash
bun run dev:api
bun run dev:web
```

Electron 开发由一个命令启动 Vite、Hono sidecar 和桌面进程：

```bash
bun run dev:desktop
```

全新服务端开发环境初始化后，使用 `.env` 中的 `DEFAULT_EMAIL` 和自行设置的 `DEFAULT_PASSWORD` 登录；服务端不提供固定默认密码。Electron 会为本机生成随机凭证并自动进入，不使用固定默认密码。

## 项目结构

```text
apps/api/             Hono 应用、REST/SSE/WebSocket 路由和 Bun 入口
apps/desktop/         Electron 主进程、Preload、sidecar 监督与打包配置
packages/contracts/   Zod 请求/响应协议和生成的 OpenAPI
packages/core/        纯 TypeScript 用例、状态机和端口
packages/db/          SQLite repositories
packages/platform/    文件、认证、配置与归档适配器
packages/providers/   LLM、Embedding、ASR、搜索和语音服务适配器
packages/testing/     测试替身与共享 fixtures
frontend/             React Web 与桌面 Renderer
tests-ts/             跨模块、HTTP 和旧版契约兼容测试
```

依赖方向是 `apps -> adapters -> core/contracts`。`packages/core` 不得依赖 Hono、Bun、Electron、数据库驱动或供应商 SDK；`bun run check:boundaries` 会验证这些约束。

## 代码约定

### API 与业务代码

- Hono 路由只负责鉴权、Zod 校验、请求上下文和传输映射；业务规则放在 `packages/core`。
- 新能力先定义由业务层拥有的端口，再在 `packages/db`、`packages/platform` 或 `packages/providers` 实现适配器。
- 用户 ID、取消信号和 provider 配置必须显式传递，避免依赖可变的全局“当前用户”。
- SQLite 和文件操作必须保持用户隔离；长任务要持久化状态并能在重启后恢复或明确失败。
- 兼容错误使用现有 `AppError` 和集中式 HTTP 映射，不在各路由复制响应格式。

### OpenAPI 与前端

- 传输协议使用 `packages/contracts` 中的 Zod schema；路由通过 `@hono/zod-openapi` 声明。
- 修改请求、响应或路由后必须重新生成并提交 OpenAPI 与前端类型：

  ```bash
  bun run gen:api
  git diff -- packages/contracts/openapi.json frontend/src/api/schema.d.ts
  ```

- 不要手工编辑 `packages/contracts/openapi.json` 或 `frontend/src/api/schema.d.ts`。
- 前端新增的共享逻辑、API 和桌面桥接代码使用 TypeScript；修改现有 JSX 页面时保持类型边界清晰。
- Electron Renderer 必须保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；新增 IPC 要校验来源并保持最小能力。

## 测试与构建

提交前运行常规检查：

```bash
bun run check
```

它覆盖 Bun/Node 类型检查、架构边界、后端与前端测试、前端 TypeScript/ESLint，以及 API、Web、Electron 主进程和编译 sidecar 构建。

根据改动范围补充运行：

```bash
bun run test:contracts       # OpenAPI 与旧版 FastAPI 契约兼容
bun run smoke:desktop        # Electron 与本地 Hono 启动链路
bun run smoke:local-embedding
bun run pack:desktop         # 当前平台的完整未安装应用目录
```

测试应覆盖真实边界，而不只调用内部函数。例如 HTTP 契约应通过 Hono `app.request()` 验证状态码和响应体，文件格式应包含正常样例与恶意输入。

系统全量归档恢复必须先 dry-run，不能在运行中的服务上直接覆盖数据：

```bash
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data
# 预检通过后停止所有本项目桌面与服务端进程
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data --confirm
```

确认恢复时原数据会被保留为同级的时间戳备份目录。归档文件必须位于目标 `data/` 之外；测试或排障也不要跳过预检。

## 发布维护

当前只有 `.github/workflows/ci.yml`，没有个人版发布工作流；创建 tag 不会自动发布安装包。Windows 个人目录包的构建与验证见 [部署说明](docs/deployment.md)。

公开发布前先完成 [改进计划](docs/project-roadmap.md) 的 P0，再添加版本校验、目标平台实测、许可证资源核对、安装包校验和及所需签名。证书与凭据不进入仓库。

## 提交与 PR

- 提交信息使用 `类型(范围): 描述`，类型可选 `feat`、`fix`、`chore`、`refactor`、`test`、`docs`。
- 每个提交完成一个可独立验证的改动，避免混入无关格式化或生成文件。
- PR 描述写清动机、行为变化、验证命令和兼容性影响；界面变化请附截图。
- 不要提交 `.env`、密钥、令牌、真实简历、录音、用户画像、运行数据库或 `data/` 下的个人数据。

## License

根目录保留 [AGPL-3.0](LICENSE)。新增贡献应与相应模块许可兼容，不擅自重许可继承代码。

`frontend/src/resume/` 移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume)，保留该目录中的原始协议和附加商业限制。该组合的分发兼容性尚未核定，需在公开分发前核定许可或替换复制实现，详见 [NOTICE](NOTICE.md)。
