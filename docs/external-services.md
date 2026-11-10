# 外部服务配置

外部服务凭据默认按用户隔离。登录后进入“设置”，填写并用页面上的测试操作确认连通；不要把个人密钥写进仓库或普通日志。

## 功能组合

| 目标能力 | 必需配置 | 不配置时 |
| --- | --- | --- |
| 训练、简历/JD 面试、复盘 | OpenAI-compatible LLM | 依赖模型的生成能力不可用 |
| RAG/个人资料检索 | Embedding API，或本地 ONNX 模型 | 无法建立和查询向量索引 |
| Copilot 文本建议 | LLM + Embedding | 无法生成策略、建议或匹配策略树 |
| Copilot 实时字幕 | DashScope API Key | 仍可手动输入 HR 问题 |
| Copilot 公司搜索 | Tavily API Key | 跳过联网公司情报，其余准备流程继续 |
| 长录音自动转写 | DashScope + 阿里云 OSS | 可以先粘贴人工逐字稿做复盘 |
| 自动区分对方/自己 | 桌面端系统音频 + 麦克风，分别实时转写 | 使用手动角色切换 |

## LLM

在“设置 → LLM”填写：

- API Base
- API Key
- Model
- Temperature

接口支持 OpenAI-compatible Chat Completions 和 Responses，按网关选择兼容模式。Responses 会发送 `stream: true`、`store: false` 和用户选择的推理强度；普通调用聚合流式正文。模型名必须是当前账号真实可调用的 ID；不同供应商对 Base URL 是否包含 `/v1` 的要求不同，以供应商文档为准。

保存前先点击测试。保存后训练、面试、复盘与个人 Agent 使用这套用户配置。个人启动入口清除 Copilot 专用环境配置，因此 Copilot 也沿用用户设置；其它部署若配置 `COPILOT_LLM_*`，Copilot 优先读取该配置。

## Embedding

### API 模式

填写 Base URL、API Key、模型名和批大小。系统会把完整的 `.../v1/embeddings` 地址归一化为 API Base；批请求若收到明确的 400 兼容错误，会回退为逐条请求并记住能力。

### 本地模式

本地模式通过 Transformers.js + ONNX 运行，默认模型为 `Xenova/bge-m3`。首次测试会自动下载模型并写入模型缓存，不需要 Python、PyTorch 或 pip。

个人电脑处理中文资料可选择较小的 `Xenova/bge-small-zh-v1.5`，Windows 编译后端已实际验证该模型的下载和推理。模型文件约 95 MB，模型缓存还包含 tokenizer/config。文本模型与 Embedding 各司其职：简历模拟直接读取 PDF 全文，知识库向量检索、个人助手与长期记忆需要 Embedding；本地模式无需额外向量 API Key。

桌面包必须保留 `backend/pdf-runtime/`、`backend/transformers-runtime/` 等整个后端目录，单独复制 `techspar-api.exe` 会丢失 PDF worker、canvas 或 ONNX 动态依赖。PDF 需包含可复制文字，扫描件应先做 OCR。

切换模型后，现有派生索引会失效。保存并执行“重建索引”，等待 SSE 进度完成后再判断检索效果。

## DashScope

用户服务配置中的 DashScope API Key 同时用于：

- 答题时的短音频转写；
- Copilot 的 `qwen-audio-3.1-asr-flash-streaming` 双路实时字幕；
- 录音复盘的长音频异步转写。

配置后先用短音频或 Copilot 实时字幕验证。缺少 key 时，文本输入和人工逐字稿路径仍然可用。

Copilot 使用北京地域。可填写百炼业务空间 ID（如 `llm-...`）以使用专属域名；不填则使用北京公共入口。这里填写 ID，不是完整 URL。ASR 使用 WebSocket `run-task` / 二进制 PCM / `finish-task` 协议；已收到 `task-started` 才开始采集传输。其他短音频和录音复盘接口保持原有配置。

## Tavily

Tavily API Key 只用于 Copilot Prep 的公司联网搜索。配置后，用真实公司名和岗位创建一次 Prep；结果中能出现联网公司情报即表示连通。不配置不会让整个 Prep 失败。

## 阿里云 OSS

长录音异步转写需要 DashScope 能访问一个临时公网 URL，因此还要填写：

- Access Key ID
- Access Key Secret
- Bucket
- Endpoint

Bucket 可以保持私有。适配器上传文件后生成短期签名 URL，并在任务结束后清理临时对象。短音频和 Copilot 实时字幕不需要 OSS。

## 旧声纹数据

桌面 Copilot 已按音频来源区分角色，不需要腾讯云 VPR。旧声纹数据和兼容接口暂时保留供历史数据迁移，设置页不再提供注册入口。

## 平台共享兜底

个人版页面不提供共享额度选择，个人启动入口会清除这类环境变量。继承的后端仍保留兼容字段；其它自建部署可以在 `.env` 中设置 `PLATFORM_LLM_*`、`PLATFORM_EMBEDDING_*` 和 `PLATFORM_DAILY_CALL_LIMIT`，为未填写个人模型配置的用户提供共享额度。已经配置个人 key 的用户继续使用自己的配置，不占平台限额。

共享平台 key 会产生集中成本和滥用风险。公开部署必须设置额度、保护 `.env`，并避免把响应或请求头中的密钥写入日志。

启动、Docker、桌面数据目录和备份策略见 [部署说明](deployment.md)。
