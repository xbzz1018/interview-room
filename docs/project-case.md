# 让一次模拟面试进入复盘和重练

## 问题与范围

只连续提问和最终打分，用户读完建议仍可能不会表达。同一问题的参考答法、自己的重答及改进证据需要放在一起，练习才有下一步。

本版本在已有业务和桌面基础上扩展个人训练。基础架构不是本轮从零搭建，来源见 [NOTICE](../NOTICE.md)。下面只讲个人方向的修改。

## 材料版本决定这一轮的依据

开始前选择简历、JD 和项目说明，把内容与版本冻结在会话中。原文档后来更新，旧报告仍按当时的材料解释，不用新内容覆盖历史依据。

编辑先提取文本和生成向量，再写新文件，通过 SQLite 事务比较 revision 并提交元数据与向量。旧 revision 返回冲突，解析、Embedding 或事务失败保留原资料。文件与数据库没有统一事务，因此失败时需要补偿清理新文件，旧文件暂留。

代码入口：

- `packages/core/src/personal-agent/personal-agent-service.ts`：编辑、替换用例。
- `packages/platform/src/personal-document-store.ts`：版本文件存储。
- `packages/db/src/personal-agent-repository.ts`：版本比较与向量事务。
- `packages/core/src/interview/interview-service.ts`：选材与快照。
- `tests-ts/personal-agent.test.ts`：冲突、失败时原数据保留。

## 参考答法之后，还要再答一次

保留原问答，按题生成并缓存答法。重答以请求 UUID 标识操作；同内容重试读取成功结果，不重复累计练习。改变内容需要新的请求标识。

比较把技术与表达分开，每个缺口需要引用原答或重答的连续原文。服务端核对引用是否存在，避免无法回到原回答验证的薄弱标签。比较是学习记录，不重写原问答或分数。

严格模拟先独立回答，结束后学习；教练模式可请求帮助，观察保留但不混入独立作答成绩。

代码入口：

- `packages/core/src/interview/training.ts`：重答类型与证据规则。
- `packages/core/src/interview/interview-service.ts`：答法、比较与进度。
- `frontend/src/components/InterviewPractice.tsx`：逐题学习、重答与进度。
- `tests-ts/interview.test.ts`、`frontend/tests/training-stage.test.tsx`：请求重放、证据和界面恢复。

## 等待与恢复边界

报告正文持续保存，页面区分等待首段、正文生成、画像同步和失败。完整正文先读，画像后台继续；画像失败只重试画像。普通/流式调用共用配置，保留用户所选模型与强度。

这改善可见性，没有证明推理更快。未完成报告在进程重启后重新生成，不接续原 token。重答仍为同步请求，没有后台恢复语义。同进程锁也不等于跨实例锁。

## 桌面交付的两个具体问题

1. 本地服务随机端口使 origin 改变，主题不能只靠 localStorage。主进程写独立文件，串行原子替换；启动读取，退出等待写入。存储测试与桌面脚本覆盖实际进程重启。
2. PowerShell 7 下设置 null 可能留下空变量，Electron 仍进入 Node 模式并提前退出。启动入口显式移除变量，并固定打开当前构建，避免回退旧包。`scripts/start-personal.ps1 -CheckOnly` 可只读查看目标。

## 验证方法

单元/契约测试覆盖规则与失败分支，隔离 Electron 脚本验证打包资源、资料选择、问答恢复、答法缓存和重答保存。模拟网关只证明接口和流程，不代表真实回答准确；测试数量不能替代固定问题集评估。

运行 README 中的类型、边界、后端、前端与桌面检查。下一步先补固定场景和检索回归，再做来源关联及可恢复重答任务，见 [改进计划](project-roadmap.md)。
