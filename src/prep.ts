import { createHash } from 'node:crypto';
import { InputError, object, text } from './model.ts';
import type { Material, Topic } from './model.ts';

// Converts explicitly supplied snapshots. It never follows source paths or reads a repository.
export function convertPreparation(input: unknown) {
  const pack = object(input);
  if (!Array.isArray(pack.projects) || !Array.isArray(pack.topics) || pack.projects.length > 12 || pack.topics.length > 30)
    throw new InputError('准备包需要 projects 和 topics 数组');
  const materials: Material[] = [];
  const topics: Topic[] = [];
  function add(title: string, kind: Material['kind'], chunks: string[]) {
    let content = '', part = 1;
    const flush = () => {
      if (!content.trim()) return;
      const hash = createHash('sha256').update(`${title}:${kind}:${content}`).digest('hex');
      materials.push({ id: `prep-${hash.slice(0, 32)}`, title: `${title.slice(0, 140)} · ${part++}`, kind, text: content,
        revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      content = '';
    };
    for (const chunk of chunks) {
      if (chunk.length > 55000) throw new InputError('单个片段超过 55000 字符，请在准备包中拆分');
      if (content.length + chunk.length + 2 > 55000) flush();
      content += chunk + '\n\n';
    }
    flush();
  }
  for (const raw of pack.topics) {
    const topic = object(raw);
    const name = text(topic.name, '题卡领域', 80), now = new Date().toISOString();
    const topicId = `prep-topic-${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
    if (!topics.some(item => item.id === topicId)) topics.push({ id: topicId, name, description: '从明确提供的准备包导入', revision: 1, createdAt: now, updatedAt: now });
    const first = materials.length;
    if (!Array.isArray(topic.cards) || topic.cards.length > 100) throw new InputError('题卡格式或数量无效');
    add(text(topic.name, '题卡领域', 160), 'notes', topic.cards.map(rawCard => {
      const card = object(rawCard);
      return `## ${text(card.filename, '题卡名', 160)}\n性质：学习题卡；不能作为本人已完成工作的证明。\n${text(card.content, '题卡内容', 50000)}`;
    }));
    for (const item of materials.slice(first)) { item.topicId = topicId; item.knowledgeSection = 'questions'; }
  }
  for (const raw of pack.projects) {
    const project = object(raw);
    if (!Array.isArray(project.sources) || project.sources.length > 100) throw new InputError('项目来源格式或数量无效');
    const chunks: string[] = [];
    for (const rawSource of project.sources) {
      const source = object(rawSource), start = Number(source.start_line ?? 1);
      if (!Number.isSafeInteger(start) || start < 1) throw new InputError('来源起始行无效');
      const path = text(source.path, '来源显示路径', 500), content = text(source.content, '来源片段', 60000);
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index += 100) {
        const block = lines.slice(index, index + 100);
        chunks.push(`## ${path}:${start + index}\n性质：${text(source.kind ?? 'reference', '来源性质', 100)}\n来源标识（由导入包提供，未读取文件核验）：${String(source.sha256 ?? '未提供').slice(0, 100)}\n${block.map((line, n) => `${start + index + n}: ${line}`).join('\n')}`);
      }
    }
    add(text(project.name, '项目名称', 160), 'project', chunks);
  }
  return { format: 'interview-room-backup', version: 2, materials, topics, sessions: [],
    warnings: ['题卡和源码来自明确提供的准备包，不扫描电脑。来源哈希是导入元数据，不能当作已执行测试或本人职责证明。每轮仍需选择需要的资料。'] };
}
