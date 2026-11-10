# 来源、变更与第三方模块

面试练习室（Interview Room）由 xbzz1018 维护个人训练方向的改动。修改时间：2026-11-06 起，当前整理日期 2026-11-10。本文件记录来源，不替换原许可证，也不把复用代码声明为从零原创。

## 源码基础

- 原项目：[AnnaSuSu/TechSpar](https://github.com/AnnaSuSu/TechSpar)。保留原作者与贡献者署名。
- 本地开发基线：`a3098711918e78613a2f265ac48cb44427bf5891`。
- 根许可证保存在 [LICENSE](LICENSE)，原文不改；来源和变更集中记录于本文件。
- 原有账号、知识库、画像、专项训练、Copilot、TypeScript 分层和桌面基础属于沿用部分，不列为本轮个人从零实现。

## 个人方向的修改

- 资料预览、文本编辑、文件替换，revision 冲突与失败保护。
- 每轮选择并冻结简历、JD、项目材料；严格模拟与教练练习。
- 历史问答恢复、参考答法缓存、再次作答和引用原话的改进比较。
- 报告正文与画像分阶段显示，失败分项重试。
- Responses 网关参数、请求头、错误映射与本地 PDF/ONNX 打包修复。
- 个人导航、准备页、商业入口移除、三套主题及 Windows 启动修复。未使用的旧营销页、旧首页、上游 Stars 组件与赞助图标已从活动源码移除，本机留档。

实现与验证见 [项目案例](docs/project-case.md)。历史来源继续沿 Git 记录追溯；这些增量不改变原模块的署名。

## 功能收敛（2026-11-10）

当前生产版本只组装文字面试、资料和训练服务。移除录音复盘、实时语音 Copilot、音视频采集与图谱页面；旧记录可读，兼容测试保留部分旧服务与契约代码。来源记录和历史作者信息不因产品删减而改变。

## 简历编辑模块

`frontend/src/resume/` 来源于 [JOYCEQL/Magic Resume](https://github.com/JOYCEQL/magic-resume)，原说明记录基线为 v2.0.7、commit `33b9b6db1bba480af630951472446feea3e2993b`。保留 [模块说明](frontend/src/resume/README.md) 与 [原始许可证及附加商业限制](frontend/src/resume/LICENSE)。

该模块附加限制与根 AGPL 的分发兼容性尚未核定；保留声明不代表已解决。公开发布前需明确处理：取得所需许可，或以自行实现的简历上传/字段编辑替换该复制模块。本次发布源码，保留该模块原始条款；未重许可或发布个人安装包。后续计划以自己的轻量编辑器替换。

## 其他来源

- Meetily 音量监测计算的 MIT 来源和完整声明见 [第三方说明](docs/third-party/meetily.md)。
- 产品图标采用 Lucide `BookOpenCheck`，由本项目统一配置颜色、边距与多尺寸资源；不是上游标志，也不声明为独占原创图形。完整 [ISC/MIT 声明](docs/third-party/lucide.txt) 随桌面包保留，生成命令为 `node scripts/generate-brand-assets.mjs`。
- Noto 字体通过 `@fontsource` 提供；Lucide 图标与各依赖按其原始许可证使用。
- 感谢原作者、贡献者与 LINUX DO 社区。
