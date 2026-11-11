# 部署说明

当前实现使用 TypeScript + Bun + Hono + Electron，不需要 Python。回看上游 `legacy/python-backend` 请用独立 checkout 与数据副本，不得与新版同时写同一份 SQLite 或用户目录。

## 方式一：Electron 桌面客户端

本个人项目尚未发布安装包。Windows 可自行构建；原项目的云客户端和发行包不是本个人版的下载入口。来源见 [NOTICE](../NOTICE.md)。

个人包构建与启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-personal.ps1
.\启动面试练习室.cmd
```

产物位于 `dist/desktop-interview-room/win-unpacked/`，保留完整目录。该入口的数据在 `local_tools/personal-data/`，不进入 Git。内部兼容标识和 exe 文件名保留，显示名称为面试练习室。

### 开发运行

```bash
bun install --frozen-lockfile
bun run dev:desktop
```

### 构建当前平台

```bash
bun run pack:desktop   # 可直接运行的应用目录
bun run dist:desktop   # 安装包/归档
bun run dist:desktop:mac-arm64 # macOS Apple Silicon
bun run dist:desktop:win-x64   # Windows x64
```

产物写入 `dist/desktop/`。配置的目标为：

- macOS：DMG、ZIP
- Windows：NSIS
- Linux：AppImage、DEB

桌面应用内含 Electron、编译后的 Bun/Hono sidecar 和 Web 静态资源，最终用户无需安装 Bun。sidecar 只监听 `127.0.0.1` 的动态端口；Renderer 保持沙箱和最小 Preload 接口。

Electron 使用操作系统标准应用数据目录保存 SQLite、用户文件、模型缓存及每次安装随机生成的 JWT/声纹加密密钥。不要手工把服务端 `data/` 与桌面目录双向同步；迁移数据请使用产品内的导出/导入。

现有配置保留跨平台构建目标，当前个人版只在 Windows 完成桌面流程检查。macOS/Linux、签名和个人版发布工作流尚未验收；历史版本说明不代表已发布个人包。

## 方式二：Bun Web 服务

### 环境要求

- Bun `1.3.14` 或兼容 `1.3.x`
- 可选的 OpenAI-compatible LLM/Embedding 服务；也可以使用本地 ONNX Embedding

### 开发模式

```bash
bun install --frozen-lockfile
cp .env.example .env
# Replace the Auth sample values with unique credentials before starting the API.
bun run dev:api
```

另一个终端运行：

```bash
bun run dev:web
```

浏览器访问 <http://localhost:5173>。

### 单进程静态站点模式

Hono 可以在生产环境同时提供 API 和构建后的 SPA：

```bash
bun install --frozen-lockfile
bun run build:web
TECHSPAR_WEB_DIR=frontend/dist HOST=127.0.0.1 PORT=8000 bun apps/api/src/entry.bun.ts
```

对公网部署时建议仍由反向代理处理 TLS、请求体限制和访问日志。

## 方式三：Docker Compose

```bash
cp .env.example .env
# Edit .env and replace all sample values in the Auth section before startup.
docker compose up --build
```

启动后访问 <http://localhost>。`./data` 会挂载到 API 容器；升级或切换镜像前先备份该目录。

Compose 中 API 只通过容器网络暴露给前端 Nginx；Nginx 会覆盖 `X-Real-IP`，因此 Compose 为登录限流启用了 `TRUST_PROXY=true`。自定义部署默认不信任转发头。只有在 API 无法被客户端绕过代理直接访问，且代理会覆盖 `X-Real-IP` 时，才设置 `TRUST_PROXY=true`；否则攻击者可以伪造来源地址绕过登录限流。

## 启动配置

必须检查的项目：

```env
# Replace all samples; the two encryption keys must be different.
JWT_SECRET=replace-with-a-unique-random-value-at-least-32-characters
VOICEPRINT_ENCRYPTION_KEY=replace-with-a-different-random-value-at-least-32-characters
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=replace-with-a-unique-password-at-least-12-characters
DEFAULT_NAME=Admin
ALLOW_REGISTRATION=false
# 仅当 API 只能经由会覆盖 X-Real-IP 的可信代理访问时启用；Compose 已由内部 Nginx 满足此条件。
TRUST_PROXY=false
HOST=0.0.0.0
PORT=8000
```

可选的数据路径：

```env
TECHSPAR_BASE_DIR=.
TECHSPAR_DATA_DIR=data
DB_PATH=data/interviews.db
TECHSPAR_MODEL_CACHE_DIR=
```

LLM 与 Embedding 凭据默认由每个用户登录后在“模型与设置”中填写，不写入 `.env`。文字模拟不需要语音、OSS 或声纹服务。部署方若要提供共享兜底，只能使用 `.env.example` 中的 `PLATFORM_LLM_*`、`PLATFORM_EMBEDDING_*` 和调用额度配置。

首次启动会在用户表中创建 `DEFAULT_EMAIL`；以后修改 `DEFAULT_PASSWORD` 不会重置已经存在的账号密码。服务端启动会拒绝缺失、过短或仍为示例值的 JWT 密钥和默认密码。可用 `openssl rand -hex 32` 生成密钥；建议使用至少 32 个字符的独立 `VOICEPRINT_ENCRYPTION_KEY`。未配置声纹密钥时会沿用 JWT 密钥，以兼容已有加密数据。

## 本地 Embedding

选择“设置 → Embedding → 本地”后，服务通过 Transformers.js + ONNX 自动下载并缓存模型，默认是 `Xenova/bge-m3`。不需要 Python、PyTorch 或 pip。

服务器可以用 `TECHSPAR_MODEL_CACHE_DIR` 指定缓存目录；该目录应持久化并确保进程可写。首次下载需要访问模型源，离线部署应提前准备对应缓存。

## 项目证据与知识草稿

项目版本位于 `data/users/<id>/project-evidence/`，随个人用户目录导出；不要只备份数据库或只保留 `current.json`，旧面试还依赖哈希命名的不可变版本文件。桌面草稿在 userData 根目录 `knowledge-drafts.json`，当前个人数据归档不包含该文件；需要迁移未保存草稿时正常关闭后连同完整桌面数据目录备份。草稿不是已保存知识，训练只使用保存内容。导入与排错见 [项目证据](project-evidence.md)。

## 备份、升级与回滚

- 普通用户通过“设置 → 数据迁移”导出个人归档；敏感凭据默认不包含。
- 管理员可以导出全站归档；文件会校验路径、链接、tar checksum 和解压上限。
- 全站恢复必须在所有本项目桌面和服务端进程停止后执行；先运行 `bun run restore:system -- --archive=... --data-dir=...` 预检，再增加 `--confirm`。成功切换后旧目录保留为时间戳备份。
- 升级前同时备份 SQLite 和整个用户目录；不要只复制数据库。
- 回滚旧版时必须先停止新版，再使用迁移前的数据副本启动 `legacy/python-backend`。禁止新旧服务并行写入。

更多供应商配置见 [外部服务配置](external-services.md)，开发与验证命令见 [开发者说明](developer.md)。
