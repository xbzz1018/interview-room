# 项目源码、题卡与参考答法

开始面试 → 实时模拟 →「项目源码与题卡」显示本机导入的项目。勾选本轮需要的项目，最多 6 组；开始时固定版本。生成逐题参考答法时，程序在选定版本中查找相关片段，将最多 4 段发送到已配置的文字模型。未选项目不参与，不会全盘扫描电脑。

## 使用流程

1. 整理明确的源码/Markdown 文件清单，区分当前源码、个人复现、历史自述、运行记录、测试定义、参考材料和学习题卡。
2. 构建并查看项目快照，核对名称、文件、片段、来源性质和版本，再在面试准备页导入 JSON。导入只保存到本机，不调用模型；本轮勾选是允许使用相关片段的选择。
3. 选择简历、JD 与项目资料，再勾选项目证据并开始新一轮。旧面试不会自动加入新证据。
4. 面试结束后生成「参考答法」。正文使用 `[S1]` 等引用；展开「本轮引用依据」查看文件、原始行号、哈希、提交/工作区状态和实际片段。
5. 答法及引用一起保存，刷新直接读取；重答比较沿用同一份依据。更新项目快照仅用于之后的新一轮。

资料足以解释技术，不自动证明本人负责过全部实现。测试定义不等于已经执行；推算参数不等于训练日志；后续个人复现与实习结果分别说明。找不到相关材料时可以给通用解法，但不能补造来源、设备、数字或个人职责。

## 从明确文件清单构建

`build-project-evidence.ts` 输入是本机 JSON：`projects` 数组中每个项目包含 `project_id`、`name`、`aliases`、`primary_root`、`sources`；每个来源提供 `source_id`、绝对 `path`、`source_kind`、可选 `anchor/line/topics/notes`。只读取清单中明确列出的文件，不遍历整个目录。跳过/拒绝密钥名、隐藏文件、依赖、构建物、数据库和链接重定向；清单本身也需自行审阅。

```powershell
bun scripts/build-project-evidence.ts --manifest=C:/private/source-list.json --output=C:/private/project-snapshots.json
```

构建输出的 `projects` 每一项可以单独保存为 JSON，从面试准备页导入。源码片段最多读取锚点前后 180 行、18000 字，保留真实起始行；记录完整来源文件 SHA256 与当前 Git/工作区状态。无 Git 的 Markdown 使用内容哈希，不伪造提交版本。单来源文件上限 2 MB，支持的文本扩展由脚本白名单限定。

导入后的项目含 `sources`，每条有 `source_id/path/kind/sha256/revision/start_line/topics/notes/content`。`path` 是展示用相对路径；API 不根据该字段读取电脑文件。项目最多 80 条来源、1.5 MB；单片段最多 60000 字。原始文件 SHA256 是来源元数据，项目 `version` 则由导入内容计算，能覆盖未提交代码和片段变化。

同时导入题卡时使用本机准备包：

```powershell
bun scripts/import-interview-prep.ts --pack=C:/private/prep-pack.json --data-dir=C:/private/app-data/data --user=ACCOUNT_ID
```

准备包包含 `projects` 和 `topics`；题卡按领域保存成 Markdown。已存在且内容相同的卡跳过，个人编辑不同的卡保留，不静默覆盖。此工具不替换简历、不改模型、不调用模型。可在停止客户端后导入，避免其他进程同时修改领域列表。

## 实现与边界

- API：鉴权后的 `GET /api/project-evidence` 只列摘要；`POST` 验证并导入单项目。无登录 401，结构错误 422，非法路径或业务限制 400，快照缺失 409，模型引用无效 502。
- `ProjectEvidenceService` 拥有格式、版本、选择与检索规则；`FileProjectEvidenceStore` 按账号、项目、哈希存不可变文件。会话 `meta.evidence_projects` 保存版本引用，答法和 `reference_sources:<question>` 在 SQLite 同一事务提交。
- 检索使用问题词项、来源主题和邻近对话中的项目名定位，再选相关完整行。当前是有范围的词项检索，不是新的向量/Reranker 系统，不需要另配 Embedding 模型。
- 模型必须引用真实的本轮 ID；不存在或缺失引用时不保存答法。此校验保证出处编号有效，不能代替逐句技术和事实正确性审阅。
- 当前项目没有自动目录监听；源码或题卡更新后需重新构建/导入。知识库编辑不会自动刷新已有证据版本，历史快照和缓存也不重写。
- 旧会话维持原资料。尚无显式重生成答法版本和项目快照清理界面；备份应包含整个用户目录，不能只留 SQLite。浏览器草稿和桌面草稿的恢复方式见 [知识库](knowledge-base.md)。

## 验证

```powershell
bun test tests-ts/project-evidence.test.ts apps/desktop/src/knowledge-drafts.test.ts
bun run smoke:personal-desktop
node scripts/smoke-appearance-desktop.mjs
```

覆盖账号隔离、同名项目、旧版本冻结、尾部行号、无相关材料、无效引用不缓存、真实文件 HTTP、答法与引用刷新、退出软件后换端口恢复草稿。桌面检查使用隔离合成账号与模拟网关。真实模型评测另运行 `scripts/evaluate-interview-quality.ts --live`；仅读已配置凭据，提交合成场景，不使用私人简历。
