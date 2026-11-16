import { createHash, randomUUID } from 'node:crypto';
import { InputError, object, text } from './model.ts';
import type { Material, Topic } from './model.ts';
import { Store } from './store.ts';
import { studyDetails } from './study-content.ts';

// General revision outlines; candidate-specific materials are imported separately.
const starters = [
  ['java', 'Java', '集合、并发与 JVM', '语言基础、集合与泛型、并发、JVM、异常与 IO；关注实现机制和使用场景。', 'HashMap 和并发容器如何选择？\nvolatile、锁和原子类分别保证什么？\n接口变慢时怎样区分 GC、锁等待与 IO？'],
  ['python', 'Python', '语言机制与异步工程', '容器与对象、函数、生成器、异步、GIL；结合小例子理解语言行为。', 'list、dict、set 的访问与修改有什么区别？\n生成器和协程如何执行、何时释放资源？\n线程、进程和异步分别适合什么负载？'],
  ['javascript', 'JavaScript', '运行时与异步控制', '类型、作用域、原型、this、事件循环与 Promise；区分浏览器和 Node 环境。', '微任务和其他任务按什么顺序执行？\n原型链与 this 绑定怎样影响调用？\nPromise 失败后如何处理取消和并发？'],
  ['go', 'Go', '并发与服务生命周期', 'slice、map、接口、goroutine、channel、context 与内存分配。', 'slice 赋值、拷贝与扩容有何不同？\nchannel 阻塞或关闭时会发生什么？\n请求结束后怎样避免 goroutine 泄漏？'],
  ['algorithms', '数据结构与算法', '建模、复杂度与边界', '常用结构、搜索排序、遍历、双指针、动态规划；从约束推导解法。', '为什么选择这种结构，复杂度是多少？\n二分、窗口和递归的边界如何验证？\n动态规划的状态和转移从哪里来？'],
  ['sql', 'SQL', '索引、事务与查询诊断', '连接、聚合、窗口函数、索引、事务与执行计划；兼顾查询正确性和性能。', '连接与聚合会不会重复计数？\n组合索引为什么没有达到预期效果？\n隔离级别、MVCC 与锁怎样影响并发？'],
  ['react', 'React', '状态、渲染与副作用', '组件、Hooks、状态共享、渲染与副作用；从具体更新解释界面行为。', '一次状态更新会触发哪些组件工作？\neffect 的依赖、清理和旧值如何处理？\n列表 key 与组件状态复用有什么关系？'],
  ['spring', 'Spring', '容器、代理与事务', '依赖注入、Bean、AOP、事务、MVC 与自动配置；沿真实调用链理解框架。', 'Bean 怎样创建并完成依赖注入？\n事务代理在哪些调用路径上生效？\n配置没有生效时从哪里查证？'],
  ['rag', 'RAG', '检索、证据与效果验证', '切分、索引、召回、重排、上下文和评估；分清检索问题与生成问题。', '切块大小与结构怎样影响召回？\n关键词、向量与过滤如何组合？\n有引用却答错时怎样定位原因？'],
  ['agent', 'Agent', '工具、状态与可靠执行', '工作流、工具调用、规划、记忆与评估；先说明自主决策带来的收益。', '固定工作流和 Agent 分别适合什么任务？\n工具调用失败后能否安全重试？\n记忆如何更新，怎样避免无关上下文干扰？'],
  ['middleware_distributed', '中间件与分布式', '缓存、消息与一致性', '缓存、消息、复制、协调与一致性；结合故障窗口分析方案。', '热点与集中失效时怎样保护数据库？\n消息重复、丢失和乱序如何处理？\n租约过期或网络分区后还能保证什么？'],
  ['microservices', '微服务', '边界、调用与可观测性', '服务边界、通信、配置、容错、数据一致性与发布排障。', '拆分的收益能否覆盖部署与调用成本？\n调用链如何分配超时和重试预算？\n跨服务写入失败后怎样恢复和对账？'],
] as const;

// Exact hashes of the previous shipped outlines. Edited or imported content never matches.
const previousOutlineHashes: Record<string, string> = {
  java: 'bfa8115c62567888acf55a371b544efaf87f737d060d0726af62a3444b6e893c',
  python: 'a53e3e4094739555d1f5e1ba3aacca60468c2d66be3047c6c051fc8a527dbec3',
  javascript: '708c95884df41b56b1d13d5ba7e8a5a040481440137e5b3c546c0cc074fca98b',
  go: '927b942436bb3a824ac0e34b10124d84925985ff444299fe377790cd458e7d17',
  algorithms: '7bbcdc53c08364932c095c0116c56c78fe94dcd498c3ee50b6d0fa88991b9e9b',
  sql: '5b702ecc144b66e1ba48ec0eec33f2e750fcb8e03be9a10b5672f7e218c355ec',
  react: '3f2b78d5f774e443d10d1a44d110f0cccbe6218bd8763c04bb4162bddd4efbc4',
  spring: '19992c3c97a07785da23375e900dbf95446e427d827b00cf957841ac5e06abb6',
  rag: 'd37b1fcd7c4d0fe38039d6b6c2a2f9cb6bf8e241e4ace980f243e1d4a9bce0c9',
  agent: '0ec34ca831c38731b9a7297d19bb131c2d9af5679ad798173c88f648f39dc673',
  middleware_distributed: '971e11b9475991a2baa077b41e275c3297e375ac42fc4874c525c1d272d65ae9',
  microservices: '7bf25905223167efe3e83c59574ad9796130f6a8264e4cb0eee2aff979f70c0b',
};
function outline(key: string): string {
  const [, name, , overview, followUps] = starters.find(([id]) => id === key)!;
  return `# ${name}\n\n## 常考内容\n${overview}\n\n## 追问方向\n${followUps.split('\n').map(question => `- ${question}`).join('\n')}\n\n## 知识提纲\n${studyDetails[key].sections.map(([heading, content], index) => `### ${index + 1}. ${heading}\n${content}`).join('\n\n')}`;
}

export class KnowledgeLibrary {
  store: Store;
  constructor(store: Store) { this.store = store; }
  list(): Topic[] {
    const order = starters.map(([key]) => `topic-${key}`);
    return this.store.list<Topic>('topics').sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name);
    });
  }
  initialize(): void {
    this.refreshStarterCopy();
    this.refreshOutlines();
    if (this.store.get('meta', 'knowledge-starters-v1')) return;
    this.store.transaction(() => {
      const now = new Date().toISOString();
      for (const [key, name, description] of starters) {
        const id = `topic-${key}`;
        if (this.store.get('topics', id)) continue;
        this.store.put<Topic>('topics', { id, name, description, revision: 1, createdAt: now, updatedAt: now });
        for (const section of ['core', 'questions'] as const) {
          const details = studyDetails[key];
          const body = section === 'core' ? outline(key)
            : `# ${name}\n\n先独立回答，再核对参考要点，最后练习追问。这里提供答题思路，可结合本轮岗位与自己的材料补充。\n\n${details.questions.map(([question, answer, followUp], index) => `## ${index + 1}. ${question}\n**参考答题要点**\n${answer}\n\n**继续追问**\n${followUp}`).join('\n\n')}`;
          this.store.put<Material>('materials', { id: `starter-${key}-${section}`, title: `${name} · ${section === 'core' ? '快速提纲' : '问答与追问'}`, kind: 'notes', topicId: id, knowledgeSection: section,
            text: body, revision: 1, createdAt: now, updatedAt: now });
        }
      }
      this.store.put('meta', { id: 'knowledge-starters-v1', initializedAt: now });
    });
  }
  private refreshOutlines(): void {
    this.store.transaction(() => {
      for (const [key, name] of starters) {
        const current = this.store.get<Material>('materials', `starter-${key}-core`);
        if (!current || current.kind !== 'notes' || current.topicId !== `topic-${key}` || current.knowledgeSection !== 'core'
          || current.title !== `${name} · 快速提纲` || !this.store.get('topics', current.topicId)
          || createHash('sha256').update(current.text).digest('hex') !== previousOutlineHashes[key]) continue;
        this.store.put('materials', { ...current, text: outline(key), revision: current.revision + 1, updatedAt: new Date().toISOString() });
      }
    });
  }
  private refreshStarterCopy(): void {
    // Remove only the former generated prefix; preserve the rest of each saved note verbatim.
    this.store.transaction(() => {
      for (const [key, name] of starters) for (const section of ['core', 'questions'] as const) {
        const current = this.store.get<Material>('materials', `starter-${key}-${section}`);
        const prefix = `# ${name}\n性质：内置学习提纲，不代表本人实习或项目经历；可继续编辑补充。\n\n`;
        if (!current || current.kind !== 'notes' || !current.text.startsWith(prefix)) continue;
        this.store.put('materials', { ...current, text: `# ${name}\n\n${current.text.slice(prefix.length)}`,
          revision: current.revision + 1, updatedAt: new Date().toISOString() });
      }
    });
  }
  topic(input: unknown, id?: string): Topic {
    const body = object(input), current = id ? this.store.require<Topic>('topics', id) : undefined;
    const name = text(body.name, '领域名称', 80).trim();
    if (this.store.list<Topic>('topics').some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new InputError('已有同名训练领域', 409);
    if (current && body.revision !== current.revision) throw new InputError('领域已更新，请刷新后重试', 409);
    const now = new Date().toISOString();
    const topic: Topic = { id: id ?? randomUUID(), name, description: text(body.description ?? '', '领域说明', 400, true).trim(), revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now };
    this.store.put('topics', topic); return topic;
  }
  remove(id: string): void {
    this.store.require('topics', id);
    if (this.store.running(`knowledge:${id}`)) throw new InputError('请先取消该领域的生成任务', 409);
    this.store.transaction(() => {
      for (const material of this.store.list<Material>('materials')) if (material.topicId === id) {
        delete material.topicId; delete material.knowledgeSection;
        material.revision++; material.updatedAt = new Date().toISOString(); this.store.put('materials', material);
      }
      this.store.delete('topics', id);
    });
  }
}
