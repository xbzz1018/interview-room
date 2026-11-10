# 面试练习室：品牌与图标

名称：面试练习室 · Interview Room。个人维护者：xbzz1018。主张是“围绕真实经历练追问，复盘后再答一次”。

## 当前标识

![练习册与勾选](../images/interview-room-mark.svg)

练习册代表材料与积累，勾选代表复盘后完成一次练习。图形来自已使用的 Lucide `BookOpenCheck`，颜色、留白和各入口由本项目统一配置。[图标许可](third-party/lucide.txt) 随资源保留。

界面标识通过 `frontend/src/components/Logo.jsx` 共用，随三套主题使用 primary/primary-foreground。浏览器与桌面使用固定墨蓝 `#294e85`、白色图形，透明圆角之外不铺白底。导航中的功能图标继续表达操作语义，不为了看起来不同而全部替换。

| 入口 | 文件/尺寸 |
| --- | --- |
| 侧栏、移动端页头、登录、引导、欢迎页 | Logo 组件，28–40 px；图形约占 62% |
| 浏览器页签 | `frontend/public/logo-mark.svg`，独立缓存版本 |
| 桌面源图 | `apps/desktop/build/icon.svg` 与 1024 px PNG |
| Windows 应用 | `apps/desktop/build/icon.ico`，16/24/32/48/64/128/256 px |
| 桌面窗口与快捷方式 | 打包图标与 `resources/brand/app-icon.png`；个人快捷方式更新 IconLocation |
| README | `images/interview-room-mark.svg` |

重新生成：

```bash
bun install --frozen-lockfile
node scripts/generate-brand-assets.mjs
```

脚本使用锁定的 Lucide/React 和 PDF.js 已有的可选 canvas 依赖，输出 SVG、PNG、ICO 与完整图标声明。界面图形变更时，同时更新 Logo 使用的图标，重新构建 Web、Electron 并检查实际包。替换图标不改变已有应用数据身份。

## 发布记录

当前入口统一使用个人品牌。历史素材保留作追溯，源码与图标的来源集中在 NOTICE 和第三方说明。
