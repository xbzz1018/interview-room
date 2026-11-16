import { createHash } from 'node:crypto';
import { InputError, object, text } from './model.ts';
import type { Material, Session, Turn, Topic } from './model.ts';
import { Store } from './store.ts';

export type ImportPreview = { fingerprint: string; materials: Material[]; sessions: Session[]; topics: Topic[]; warnings: string[]; duplicates: number };
function stableId(prefix: string, original: string, source: string): string {
  if (source === 'v2' && /^[A-Za-z0-9_-]{1,200}$/.test(original)) return original;
  return `import-${prefix}-${createHash('sha256').update(`${source}:${original}`).digest('hex').slice(0, 24)}`;
}
function date(value: unknown): string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString(); }
function parseJson(value: unknown, fallback: unknown): unknown { if (typeof value !== 'string') return value ?? fallback; try { return JSON.parse(value); } catch { return fallback; } }
function optionalText(value: unknown, max: number): string { return typeof value === 'string' ? value.slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function legacyTurns(item: Record<string, unknown>, id: string, warnings: string[]): Turn[] {
  const questions = parseJson(item.questions, []), transcript = parseJson(item.transcript, []);
  const references = record(parseJson(item.reference_answers, {})), meta = record(parseJson(item.meta, {}));
  const turns: Turn[] = [], keys = new Map<string, Turn>();
  const add = (question: string, key: string): Turn => {
    const turn: Turn = { id: stableId('turn', key, id), question: text(question, '历史问题', 10000), attempts: [] };
    const reference = optionalText(references[key], 160000); if (reference) turn.reference = reference;
    keys.set(key, turn); turns.push(turn); return turn;
  };
  if (!Array.isArray(questions) || !Array.isArray(transcript)) throw new InputError('历史问答格式无效，请保留备份并核对');
  if (questions.length > 200 || transcript.length > 400) throw new InputError('单轮历史问题或消息过多，请拆分备份');
  if (item.mode !== 'resume') for (const [index, raw] of questions.entries()) {
    const question = record(raw), content = typeof raw === 'string' ? raw : optionalText(question.question ?? question.text, 10000);
    if (content) add(content, String(question.id ?? index));
    else warnings.push(`历史面试 ${id} 的第 ${index + 1} 题无法识别，请核对原始备份`);
  }
  let unpaired = 0;
  for (const [index, raw] of transcript.entries()) {
    const entry = record(raw), content = optionalText(entry.content ?? entry.text, 20000);
    if (entry.role !== 'assistant' || !content.trim()) continue;
    let turn: Turn | undefined;
    if (item.mode === 'resume' || questions.length === 0) turn = add(content, `resume-turn-${index + 1}`);
    else turn = turns.find(value => value.question === content && value.answer === undefined);
    const next = record(transcript[index + 1]);
    if (turn && ['user', 'candidate'].includes(String(next.role))) turn.answer = text(next.content ?? next.text, '历史回答', 20000, true);
    else if (!turn) unpaired++;
  }
  // A lone question and answer are unambiguous. Never zip all user messages to a list of questions.
  if (turns.length === 1 && transcript.length === 1 && ['user', 'candidate'].includes(String(record(transcript[0]).role)))
    turns[0].answer = text(record(transcript[0]).content ?? record(transcript[0]).text, '历史回答', 20000, true);
  else for (const [index, raw] of transcript.entries()) if (['user', 'candidate'].includes(String(record(raw).role))
    && (index === 0 || record(transcript[index - 1]).role !== 'assistant')) unpaired++;
  const attempts = Array.isArray(meta.training_attempts) ? meta.training_attempts : [];
  for (const [index, raw] of attempts.slice(0, 100).entries()) {
    const attempt = record(raw), turn = keys.get(String(attempt.question_id));
    if (!turn) { unpaired++; continue; }
    turn.attempts.push({ id: stableId('attempt', String(attempt.attempt_id ?? index), id), text: text(attempt.answer, '历史重答', 20000),
      comparison: optionalText(attempt.comparison, 160000), createdAt: date(attempt.created_at) });
  }
  if (unpaired) warnings.push(`历史面试 ${id} 有 ${unpaired} 条无法可靠配对的消息或重答，未猜测配对；原文仍在备份中`);
  if (!turns.length) warnings.push(`历史面试 ${id} 未识别出问题，请在原版核对`);
  return turns;
}
export function previewImport(value: unknown, store: Store): ImportPreview {
  const body = object(value);
  if (!['interview-room-backup', 'interview-room-legacy-export'].includes(String(body.format))) throw new InputError('不是支持的备份格式，请先使用只读导出工具');
  if ((body.format === 'interview-room-backup' && body.version !== 2) || (body.format === 'interview-room-legacy-export' && body.version !== 1))
    throw new InputError('备份版本不受支持');
  const source = body.format === 'interview-room-backup' ? 'v2' : text(body.sourceId, '导出来源', 200);
  if (!Array.isArray(body.materials) || !Array.isArray(body.sessions) || body.materials.length + body.sessions.length > 2000)
    throw new InputError('备份记录无效或超过 2000 条');
  const result: ImportPreview = { fingerprint: createHash('sha256').update(JSON.stringify(body)).digest('hex'), materials: [], sessions: [], topics: [], warnings: [], duplicates: 0 };
  if (body.topics !== undefined && (!Array.isArray(body.topics) || body.topics.length > 200)) throw new InputError('备份领域格式无效或超过 200 个');
  const topicMap = new Map<string, string>(), topicIds = new Set<string>();
  const existingTopics = store.list<Topic>('topics');
  for (const raw of (body.topics ?? []) as unknown[]) {
    const item = object(raw), original = text(item.id, '领域 ID', 200), name = text(item.name, '领域名称', 80).trim();
    if (topicIds.has(original)) throw new InputError('备份内有重复领域 ID'); topicIds.add(original);
    const existing = existingTopics.find(topic => topic.id === stableId('topic', original, source) || topic.name.toLowerCase() === name.toLowerCase())
      ?? result.topics.find(topic => topic.name.toLowerCase() === name.toLowerCase());
    if (existing) { topicMap.set(original, existing.id); result.duplicates++; continue; }
    const topic: Topic = { id: stableId('topic', original, source), name, description: optionalText(item.description, 400), revision: 1, createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) };
    topicMap.set(original, topic.id); result.topics.push(topic);
  }
  if (Array.isArray(body.warnings)) result.warnings.push(...body.warnings.slice(0, 200).map(value => optionalText(value, 600)).filter(Boolean));
  const materialIds = new Set<string>(), sessionIds = new Set<string>();
  for (const raw of body.materials) {
    const item = object(raw), id = stableId('material', text(item.id, '资料 ID', 200), source);
    if (materialIds.has(id)) throw new InputError('备份内有重复资料 ID'); materialIds.add(id);
    if (store.get('materials', id)) { result.duplicates++; continue; }
    const kind = ['resume', 'project', 'jd', 'notes'].includes(String(item.kind)) ? item.kind as Material['kind'] : 'notes';
    result.materials.push({ id, title: text(item.title, '资料标题', 160), kind, text: text(item.text, '资料正文'), revision: 1,
      createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) });
    if (kind === 'notes' && typeof item.topicId === 'string') {
      const topicId = topicMap.get(item.topicId) ?? (store.get('topics', item.topicId) ? item.topicId : undefined);
      if (topicId) {
        if (item.knowledgeSection !== undefined && !['core', 'questions'].includes(String(item.knowledgeSection))) throw new InputError('备份知识分类无效');
        Object.assign(result.materials.at(-1)!, { topicId, knowledgeSection: item.knowledgeSection ?? 'core' });
      } else result.warnings.push(`知识“${optionalText(item.title, 80)}”的领域未找到，正文保留在未分类笔记中`);
    }
  }
  for (const raw of body.sessions) {
    const item = object(raw), id = stableId('session', text(item.id ?? item.session_id, '面试 ID', 200), source);
    if (sessionIds.has(id)) throw new InputError('备份内有重复面试 ID'); sessionIds.add(id);
    if (store.get('sessions', id)) { result.duplicates++; continue; }
    let turns: Turn[] = [];
    if (Array.isArray(item.turns)) {
      if (item.turns.length > 200) throw new InputError('单轮备份问题超过 200 条');
      for (const [index, rawTurn] of item.turns.entries()) {
        const turn = object(rawTurn);
        turns.push({ id: stableId('turn', String(index), id), question: text(turn.question, '问题', 10000),
          ...(typeof turn.answer === 'string' ? { answer: text(turn.answer, '回答', 20000, true) } : {}),
          ...(typeof turn.reference === 'string' ? { reference: text(turn.reference, '参考答法', 160000, true) } : {}),
          attempts: Array.isArray(turn.attempts) ? turn.attempts.slice(0, 100).map((rawAttempt, n) => {
            const attempt = object(rawAttempt);
            return { id: stableId('attempt', String(n), `${id}:${index}`), text: text(attempt.text, '重答', 20000, true),
              comparison: optionalText(attempt.comparison, 160000), createdAt: date(attempt.createdAt) };
          }) : [] });
      }
    } else {
      turns = legacyTurns(item, id, result.warnings);
      result.warnings.push(`历史面试“${optionalText(item.topic, 80) || id}”按归档导入，请核对问答配对；不会恢复为进行中的新会话`);
    }
    let snapshots: Material[] = [];
    if (Array.isArray(item.materials)) snapshots = item.materials.slice(0, 8).map((rawMaterial, index) => {
      const material = object(rawMaterial);
      return { id: stableId('snapshot', String(index), id), title: text(material.title, '快照标题', 160),
        kind: ['resume', 'project', 'jd', 'notes'].includes(String(material.kind)) ? material.kind as Material['kind'] : 'notes',
        text: text(material.text, '快照正文'), revision: Number.isInteger(material.revision) ? Number(material.revision) : 1,
        createdAt: date(material.createdAt), updatedAt: date(material.updatedAt),
        ...(typeof material.topicId === 'string' ? { topicId: topicMap.get(material.topicId) ?? material.topicId.slice(0, 200) } : {}),
        ...(['core', 'questions'].includes(String(material.knowledgeSection)) ? { knowledgeSection: material.knowledgeSection as Material['knowledgeSection'] } : {}) };
    });
    if (snapshots.reduce((sum, material) => sum + material.text.length, 0) > 60000) throw new InputError('历史面试快照超过 60000 字符');
    result.sessions.push({ id, title: optionalText(item.title ?? item.topic, 160) || '导入的历史面试', role: optionalText(item.role, 200) || '历史记录',
      mode: item.mode === 'coach' || record(parseJson(item.meta, {})).training_mode === 'coach' ? 'coach' : 'strict', status: 'completed', materials: snapshots, turns,
      revision: 1, createdAt: date(item.createdAt ?? item.created_at), updatedAt: date(item.updatedAt ?? item.updated_at),
      review: optionalText(item.review, 160000), imported: true });
    const session = result.sessions.at(-1)!;
    session.focus = optionalText(item.focus, 200); session.preparation = optionalText(item.preparation, 160000);
    if (item.trainingKind === 'topic') { session.trainingKind = 'topic'; session.topicId = topicMap.get(String(item.topicId)) ?? optionalText(item.topicId, 200); session.topicName = optionalText(item.topicName, 80); }
  }
  result.warnings.unshift('导入只追加记录，不覆盖现有资料，不导入 API Key、账号、音视频或向量缓存。请保留原始备份。');
  return result;
}
export function commitImport(value: unknown, fingerprint: unknown, store: Store): ImportPreview {
  const result = previewImport(value, store);
  if (fingerprint !== result.fingerprint) throw new InputError('备份内容与预览不一致，请重新预览', 409);
  store.transaction(() => {
    for (const topic of result.topics) store.put('topics', topic);
    for (const material of result.materials) store.put('materials', material);
    for (const session of result.sessions) store.put('sessions', session);
  });
  return result;
}
