import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
function option(name: string): string { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? ''; }
const database = option('--db'), userId = option('--user'), output = option('--out');
if (!database || !userId || !output) {
  console.log('关闭旧应用后使用：npm run export:legacy -- --db "旧数据库路径" --user "账号ID" --out "本机备份.json"');
  console.log('仅以只读模式读取所选账号的文字资料与面试。不会读取密钥、音视频、模型设置或向量。输出含私人资料，请保存在 Git 忽略的 data/ 或其他私人目录。');
  process.exit(0);
}
const dbPath = resolve(database), outPath = resolve(output);
if (dbPath === outPath) throw new Error('导出目标不能覆盖原数据库');
if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new Error('账号 ID 格式无效');
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const sessions = tables.has('sessions') ? db.prepare("SELECT * FROM sessions WHERE user_id=? AND mode IN ('resume','topic','topic_drill','jd_prep')").all(userId) : [];
  const documents = tables.has('personal_documents') ? db.prepare('SELECT * FROM personal_documents WHERE user_id=?').all(userId) : [];
  const materials: {id: string; title: string; kind: string; text: string; topicId?: string; knowledgeSection?: 'core' | 'questions'}[] = [], warnings: string[] = [];
  const topics: { id: string; name: string; description: string }[] = [];
  const root = resolve(dirname(dbPath), 'users', userId, 'library');
  for (const document of documents) {
    const storedName = String(document.stored_name ?? '');
    if (!/^[\w.-]+$/.test(storedName)) { warnings.push(`跳过无法安全读取的资料：${document.filename}`); continue; }
    const path = resolve(root, storedName);
    if (!path.startsWith(root + sep)) continue;
    try {
      const content = readFileSync(path);
      if (content.length > 300000) { warnings.push(`资料过大未导入：${document.filename}`); continue; }
      const extension = String(document.extension ?? '').toLowerCase().replace(/^\./, '');
      if (!['txt', 'md', 'markdown'].includes(extension)) { warnings.push(`请在新版重新上传 PDF/其他资料：${document.filename}`); continue; }
      materials.push({ id: String(document.document_id), title: String(document.filename).slice(0, 160), kind: 'notes', text: content.toString('utf8').slice(0, 60000) });
    } catch { warnings.push(`资料未读取，请手动重新导入：${document.filename}`); }
  }
  if (args.includes('--with-knowledge')) {
    const accountRoot = resolve(dirname(dbPath), 'users', userId), knowledgeRoot = resolve(accountRoot, 'knowledge');
    const allowedRoot = existsSync(accountRoot) ? realpathSync(accountRoot) : accountRoot;
    const definitions = new Map<string, { name: string; dir: string }>();
    const metadata = resolve(accountRoot, 'topics.json');
    if (existsSync(metadata) && !lstatSync(metadata).isSymbolicLink() && realpathSync(metadata).startsWith(allowedRoot + sep)) {
      try {
        const bytes = readFileSync(metadata); if (bytes.length > 200000) throw new Error('large');
        const value = JSON.parse(bytes.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) throw new Error('format');
        for (const [key, raw] of Object.entries(value)) {
          const item = raw as { name?: unknown; dir?: unknown };
          if (!/^[\w-]+$/.test(key) || !item || typeof item.name !== 'string' || typeof item.dir !== 'string' || !/^[\w-]+$/.test(item.dir)) continue;
          definitions.set(key, { name: item.name.slice(0, 80), dir: item.dir });
        }
      } catch { warnings.push('领域配置未识别，将按安全目录名保留知识分类'); }
    }
    const ensureTopic = (key: string, name: string) => {
      const id = `legacy-topic-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
      if (!topics.some(item => item.id === id)) topics.push({ id, name: name.slice(0, 80), description: '从旧版知识库只读导入' });
      return id;
    };
    for (const [key, item] of definitions) ensureTopic(key, item.name);
    const readNote = (filename: string, prefix: string, topicId: string, section: 'core' | 'questions') => {
      if (lstatSync(filename).isSymbolicLink() || !realpathSync(filename).startsWith(allowedRoot + sep)) return;
      const bytes = readFileSync(filename);
      if (bytes.length > 200000 || materials.length >= 1500) { warnings.push(`知识文件过大或数量超限：${prefix}`); return; }
      const content = bytes.toString('utf8');
      if (content.length > 60000) { warnings.push(`知识文件超过 60000 字符，请拆分：${prefix}`); return; }
      if (content.trim()) materials.push({ id: `knowledge:${prefix}`, title: prefix.slice(0, 160), kind: 'notes', text: content, topicId, knowledgeSection: section });
    };
    const readNotes = (directory: string, prefix: string, topicId: string) => {
      if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !realpathSync(directory).startsWith(allowedRoot + sep)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/\.md$/i.test(entry.name)) continue;
        readNote(resolve(directory, entry.name), `${prefix}/${entry.name}`, topicId, 'core');
      }
    };
    if (existsSync(knowledgeRoot) && !lstatSync(knowledgeRoot).isSymbolicLink()) for (const entry of readdirSync(knowledgeRoot, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const match = [...definitions].find(([, item]) => item.dir === entry.name), key = match?.[0] ?? entry.name;
        if (!/^[\w-]+$/.test(key)) { warnings.push('跳过无法安全映射的知识目录'); continue; }
        readNotes(resolve(knowledgeRoot, entry.name), entry.name, ensureTopic(key, match?.[1].name ?? entry.name));
      }
    const highRoot = resolve(accountRoot, 'high_freq');
    if (existsSync(highRoot) && !lstatSync(highRoot).isSymbolicLink() && realpathSync(highRoot).startsWith(allowedRoot + sep))
      for (const entry of readdirSync(highRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[\w-]+\.md$/i.test(entry.name)) continue;
        const key = entry.name.slice(0, -3);
        readNote(resolve(highRoot, entry.name), `高频题/${entry.name}`, ensureTopic(key, definitions.get(key)?.name ?? key), 'questions');
      }
  }
  const exportedSessions = sessions.map(row => {
    let meta: Record<string, unknown> = {}, state: Record<string, unknown> = {};
    try { const parsed = JSON.parse(String(row.meta ?? '{}')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed; } catch { warnings.push(`面试 ${row.session_id} 的附加记录损坏，请在旧版核对`); }
    if (tables.has('resume_interview_state')) {
      const saved = db.prepare('SELECT state FROM resume_interview_state WHERE session_id=? AND user_id=?').get(String(row.session_id), userId);
      try { const parsed = JSON.parse(String(saved?.state ?? '{}')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed; } catch { warnings.push(`面试 ${row.session_id} 的冻结材料未识别`); }
    }
    const snapshots = [];
    if (typeof state.resume_context === 'string' && state.resume_context.trim()) {
      if (state.resume_context.length > 60000) warnings.push(`面试 ${row.session_id} 的历史材料截取了前 60000 字符，请保留旧数据库`);
      snapshots.push({ title: '本轮历史材料', kind: 'notes', text: state.resume_context.slice(0, 60000) });
    } else warnings.push(`面试 ${row.session_id} 缺少可识别的历史材料快照，新版不会用当前资料冒充当时依据`);
    return { id: row.session_id, topic: row.topic, mode: row.mode, questions: row.questions,
      transcript: row.transcript, reference_answers: row.reference_answers, review: row.review,
      meta: { training_mode: meta?.training_mode, training_attempts: meta?.training_attempts },
      role: state?.target_role ?? meta?.target_role, materials: snapshots, created_at: row.created_at, updated_at: row.updated_at };
  });
  const result = { format: 'interview-room-legacy-export', version: 1,
    sourceId: createHash('sha256').update(`${dbPath}:${userId}`).digest('hex').slice(0, 20), materials,
    sessions: exportedSessions, topics, warnings };
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`已只读导出 ${materials.length} 份文字资料、${sessions.length} 轮面试；${warnings.length} 项需手动核对。`);
} finally { db.close(); }
