# 面试练习室：界面开发

React / TypeScript / Vite 界面，同时服务浏览器与 Electron Renderer。完整安装和个人包启动方式见 [项目首页](../README.md)，来源与个人增量见 [NOTICE](../NOTICE.md)。

从仓库根目录执行：

```bash
bun install --frozen-lockfile
bun run dev:web
bun run check:frontend
bun run test:web
bun run build:web
```

开发 Web 还需单独运行 API；桌面联调使用 `bun run dev:desktop`。API 类型由 `bun run gen:api` 生成，不手写 `src/api/schema.d.ts`。

主要入口为面试准备、复盘重练、资料库、简历、专项和能力记录。三主题共用语义颜色变量；桌面偏好通过最小 IPC 持久化，避免随机端口导致设置丢失。核心实现说明见 [项目案例](../docs/project-case.md)。

历史 JSX 页面可逐步迁移，新增共享逻辑与 API 使用 TypeScript。不要把真实简历、问答、网关凭据或本机截图放进公共 fixture。
