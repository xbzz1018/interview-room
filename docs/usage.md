# 使用与构建

## 启动

源码开发和构建需要 Node.js 24.15+，首次运行 `npm ci`。

| 方式 | 命令或入口 |
| --- | --- |
| 独立桌面窗口 | `npm run desktop`，或双击 `启动面试练习室.cmd` |
| 本机网页 | `npm run build` 后 `npm start`，或双击 `启动网页版.cmd` |
| 前端热更新 | `npm run dev`，页面端口 5178 |
| Windows x64 文件夹版 | `npm run package:desktop` |

网页版默认地址 `http://127.0.0.1:4318`，运行时保留服务窗口。新启动网页 CMD 会先检查并构建源码；若已有同一工作区服务，则直接打开。

桌面 CMD 优先打开 `release/Interview Room-win32-x64/Interview Room.exe`，尚未打包时构建并打开开发桌面。文件夹版自带运行时，无需另装 Node；分发时保留整个文件夹。当前没有安装器、签名和自动更新。

## 模型

在“模型与设置”填写配置名称、服务商地址、协议、模型 ID 和 Key，保存后测试，再启用。提供 GPT、DeepSeek、Grok、Claude、Qwen、GLM、Kimi 及自定义网关模板；模型 ID 与参数以实际接口为准。

支持 Responses、Chat Completions 和原生 Anthropic Messages。Chat 输出上限可选 `max_tokens` 或 `max_completion_tokens`；不支持推理参数的模型选择“接口默认”。自定义认证头放在高级设置，Key 填写在专用输入框。

新环境没有预填个人网关、模型或 Key；已有配置保持原值。编辑时 Key 留空表示保留，清除需要勾选。不同配置不共享 Key，切换只影响新任务，主题切换不更改连接。

连接测试发送一次不含个人材料的短请求，正常计入接口用量。服务商模板只帮助填写，不能保证账号权限、模型和视觉能力可用。材料长度、推理强度与网关排队都会影响速度。

## 材料与练习

资料支持 MD、TXT、文字 PDF、DOCX。PDF 和 DOCX 在本地提取正文；扫描 PDF 可先转文字或图片。PNG/JPEG/WebP 经确认后交给配置的视觉模型识别，需核对结果再保存。DOCX 不保留排版。

每轮选择一份简历、一份 JD 与所需项目或笔记，最多 8 份、60000 字符。不需要额外 Embedding。没有 JD 时按目标岗位的一般要求练习；专项练习先选领域，再调整带入的知识文件。

严格模拟先独立作答，结束后查看参考和重答；教练练习允许边练边看。参考、复盘和重答比较按需生成，保留原始问答。取消或重启后的未完成任务需手动重试。

## 工作区与备份

项目内启动使用 `data/interview-room.db`。单独打开发行 exe 默认使用 `%APPDATA%/interview-room-v2/data`；可传 `--data-dir=绝对目录` 指定已有工作区。

桌面菜单“工作区 → 在浏览器打开”连接同一服务。两端共用已保存的材料、模型配置与记录，未保存草稿分别位于各自的 localStorage。换浏览器、改端口或清浏览器数据可能无法恢复草稿。

“模型与设置 → 备份与迁移”可导出文字备份，导入先预览再追加，不覆盖同 ID 的已有内容。文字备份不含模型配置、Key、生成任务或未保存草稿。整库包含凭据，复制整库前先退出服务，勿公开上传。

| 环境变量 | 用途 |
| --- | --- |
| `INTERVIEW_DATA_DIR` | 项目启动时指定数据目录 |
| `INTERVIEW_PORT` | 指定本机端口，默认 4318 |
| `INTERVIEW_NO_BROWSER=1` | 网页启动时不自动打开浏览器 |
| `INTERVIEW_DESKTOP_EXE` | 桌面检查使用已打包 exe |

## 开发检查

```powershell
npm run check
npm run test:ui
npm run build:desktop
npm run test:desktop
npm run licenses
```

检查打包产物时，先设置 `$env:INTERVIEW_DESKTOP_EXE` 为完整 exe 路径，再运行桌面检查。浏览器检查使用本机 Microsoft Edge。

`npm run screenshots` 使用独立的合成工作区生成四张展示图，检查流程状态与内容，再写入 `images/`。不会读取个人工作区或调用外部模型。
