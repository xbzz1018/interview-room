import React, { useEffect, useRef, useState } from 'react';
import type { Job, KnowledgeSection, Material, Topic } from '../src/model.ts';
import { api, base64 } from './api.ts';

type Act = <T>(action: () => Promise<T>, message?: string) => Promise<T | undefined>;
type Props = {
  topics: Topic[]; materials: Material[]; busy: boolean; act: Act; onRefresh: () => Promise<void>; onTrain: (id: string) => void;
  editor: (material: Material | null, topicId: string, section: KnowledgeSection, onClose: () => void) => React.ReactNode;
  prose: (text: string) => React.ReactNode;
};
function savedTopic(fallback: string): string { try { return localStorage.getItem('ir-knowledge-topic') ?? fallback; } catch { return fallback; } }

export function Knowledge({ topics, materials, busy, act, onRefresh, onTrain, editor, prose }: Props) {
  const [selected, setSelected] = useState(() => savedTopic(topics[0]?.id ?? ''));
  const [section, setSection] = useState<KnowledgeSection>('core');
  const [query, setQuery] = useState(''), [editing, setEditing] = useState<Material | null | undefined>();
  const [readingId, setReadingId] = useState('');
  const [topicForm, setTopicForm] = useState<{ id?: string; name: string; description: string; revision?: number }>();
  const [jobs, setJobs] = useState<Job[]>([]), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('');
  const upload = useRef<HTMLInputElement>(null), refreshed = useRef(''), viewVersion = useRef(0);
  const reader = useRef<HTMLDivElement>(null), previousFiles = useRef<{ scope: string; ids: Set<string> }>({ scope: '', ids: new Set() });
  const topic = topics.find(item => item.id === selected);
  const notes = materials.filter(item => item.kind === 'notes');
  const scoped = notes.filter(item => selected ? item.topicId === selected && (item.knowledgeSection ?? 'core') === section : !item.topicId);
  const visible = scoped.filter(item => `${item.title}\n${item.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const reading = visible.find(item => item.id === readingId) ?? visible.find(item => item.id === `starter-${selected.replace(/^topic-/, '')}-${section}`) ?? visible[0];
  useEffect(() => {
    const scope = `${selected}:${section}`, ids = new Set(scoped.map(item => item.id));
    if (previousFiles.current.scope === scope) {
      const added = scoped.find(item => !previousFiles.current.ids.has(item.id));
      if (added) setReadingId(added.id);
    }
    previousFiles.current = { scope, ids };
  }, [materials, selected, section]);
  useEffect(() => { reader.current?.scrollTo(0, 0); }, [reading?.id]);
  const running = jobs.find(job => job.status === 'running'), recent = jobs[0];
  function select(value: string) { viewVersion.current++; setSelected(value); setReadingId(''); setEditing(undefined); setQuery(''); setUploadError(''); setJobs([]); try { localStorage.setItem('ir-knowledge-topic', value); } catch {} }
  useEffect(() => () => { viewVersion.current++; }, []);
  useEffect(() => { if (selected && !topics.some(item => item.id === selected)) select(topics[0]?.id ?? ''); }, [topics, selected]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const values = await api<Job[]>(`/topics/${selected}/jobs`);
        if (cancelled) return;
        setJobs(values);
        const success = values.find(job => job.status === 'succeeded');
        if (success && refreshed.current !== success.id) { refreshed.current = success.id; await onRefresh(); }
      } catch { /* Mutations report errors through act; transient polling keeps saved content visible. */ }
      if (!cancelled) timer = setTimeout(poll, 1000);
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [selected, onRefresh]);
  async function importFiles(files: File[]) {
    const topicId = selected, targetSection = section, version = viewVersion.current; setUploading(true); setUploadError('');
    const failed: string[] = []; let imported = 0;
    try {
      for (const file of files) {
        try {
          if (file.size > 8000000) throw new Error('文件不能超过 8 MB');
          let content: string;
          if (/\.(md|markdown|txt)$/i.test(file.name)) content = await file.text();
          else if (/\.(pdf|docx)$/i.test(file.name)) content = (await api<{ text: string }>('/extract', 'POST', { type: /\.pdf$/i.test(file.name) ? 'pdf' : 'docx', base64: await base64(file) })).text;
          else throw new Error('支持 MD、TXT、文字 PDF 和 DOCX');
          await api('/materials', 'POST', { title: file.name.replace(/\.[^.]+$/, '').slice(0, 160), kind: 'notes', text: content, topicId, knowledgeSection: targetSection }); imported++;
        } catch (error) { failed.push(`${file.name}：${(error as Error).message}`); }
      }
      await onRefresh();
      if (version === viewVersion.current) setUploadError([imported ? `已导入 ${imported} 份文件。` : '', ...failed].filter(Boolean).join('\n'));
    } catch { if (version === viewVersion.current) setUploadError('文件已处理，但列表刷新失败，请重新打开该领域核对，避免重复导入。');
    } finally { setUploading(false); }
  }
  return <>
    <div className="page-title"><div><div className="eyebrow">按领域整理与训练</div><h1>备面知识库</h1><p>先梳理原理，再练习回答。知识文件可编辑、导入，并带入本轮专项训练。</p></div><button className="primary" disabled={busy} onClick={() => setTopicForm({ name: '', description: '' })}>新建领域</button></div>
    {topicForm && <form className="panel topic-form" onSubmit={async event => {
      event.preventDefault();
      const value = await act(() => api<Topic>(`/topics${topicForm.id ? `/${topicForm.id}` : ''}`, topicForm.id ? 'PUT' : 'POST', topicForm), '训练领域已保存');
      if (value) { select(value.id); setTopicForm(undefined); }
    }}><h2>{topicForm.id ? '编辑领域' : '新建训练领域'}</h2><div className="two-fields"><label>领域名称<input autoFocus required maxLength={80} value={topicForm.name} onChange={event => setTopicForm({ ...topicForm, name: event.target.value })} placeholder="例如：模型训练与部署" /></label><label>领域说明<input maxLength={400} value={topicForm.description} onChange={event => setTopicForm({ ...topicForm, description: event.target.value })} /></label></div><div className="button-row"><button className="primary" disabled={busy || !topicForm.name.trim()}>保存领域</button><button type="button" onClick={() => setTopicForm(undefined)}>取消</button></div></form>}
    <div className="knowledge-layout">
      <aside className="panel domain-rail" aria-label="知识领域"><h2>训练领域 <span className="tag">{topics.length}</span></h2><div className="domain-list">{topics.map(item => <button key={item.id} aria-pressed={selected === item.id} className={selected === item.id ? 'domain-entry selected-domain' : 'domain-entry'} onClick={() => select(item.id)}><span>{item.name}</span><small>{notes.filter(note => note.topicId === item.id).length}</small></button>)}<button aria-pressed={!selected} className={!selected ? 'domain-entry selected-domain' : 'domain-entry'} onClick={() => select('')}><span>未分类笔记</span><small>{notes.filter(note => !note.topicId).length}</small></button></div></aside>
      <section className="knowledge-main">
        <section className="panel knowledge-heading"><div><div className="eyebrow">{topic ? '训练资料' : '原有资料保留'}</div><h2>{topic?.name ?? '未分类笔记'}</h2><p className="muted">{topic?.description || '可编辑笔记并指定领域，正文和已有面试快照保持保留。'}</p></div><div className="button-row">{topic && <><button className="primary" onClick={() => onTrain(topic.id)}>练这个领域 →</button><button onClick={() => setTopicForm({ ...topic })}>编辑领域</button><button className="subtle" disabled={busy || Boolean(running)} onClick={() => { if (confirm(`删除领域“${topic.name}”？文件会保留到未分类笔记，历史训练不变。`)) void act(() => api(`/topics/${topic.id}`, 'DELETE'), '领域已删除，知识正文保留在未分类笔记'); }}>删除领域</button></>}</div></section>
        {topic && <div className="session-tabs knowledge-tabs" role="tablist" aria-label="知识分类">{([['core', '核心知识库'], ['questions', '高频题库']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active-tab' : ''} onClick={() => { viewVersion.current++; setSection(key); setEditing(undefined); setQuery(''); setUploadError(''); }}>{label}<small>{notes.filter(item => item.topicId === selected && (item.knowledgeSection ?? 'core') === key).length}</small></button>)}</div>}
        <div className="knowledge-tools"><label>搜索知识<input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索本领域标题与正文" /></label><div className="button-row"><button onClick={() => setEditing(null)}>新增文件</button><button disabled={busy || uploading} onClick={() => upload.current?.click()}>{uploading ? '正在导入…' : '导入文档'}</button>{topic && <button disabled={busy || Boolean(running)} onClick={async () => {
          if (!confirm('使用当前已保存的模型补充学习内容？会发送该领域已有知识并产生一次 API 请求，结果新建文件，不覆盖现有内容。')) return;
          const version = viewVersion.current;
          const value = await act(() => api<Job>(`/topics/${selected}/jobs`, 'POST', { section, requestId: crypto.randomUUID() })); if (value && version === viewVersion.current) setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]);
        }}>AI 补充{section === 'core' ? '知识' : '题目'}</button>}<input ref={upload} hidden type="file" multiple accept=".md,.markdown,.txt,.pdf,.docx" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files); }} /></div></div>
        {uploadError && <p role="status" className="import-notice">{uploadError}</p>}
        {recent && <section className="panel knowledge-job" role="status"><div className="section-head"><h3>{recent.status === 'running' ? '正在补充学习材料' : recent.status === 'succeeded' ? '已新建 AI 学习文件，请核对内容' : '生成尚未完成'}</h3><button disabled={busy} onClick={() => {
          if (recent.status === 'running') void act(() => api(`/jobs/${recent.id}/cancel`, 'POST', {}));
          else if (recent.status !== 'succeeded') void act(() => api(`/topics/${selected}/jobs`, 'POST', { section: recent.input.section, requestId: recent.requestId }));
        }} hidden={recent.status === 'succeeded'}>{recent.status === 'running' ? '取消生成' : '重试生成'}</button></div><p className="muted">{recent.model} · {recent.effort} {recent.error && `· ${recent.error}`}</p>{recent.draft && <details><summary>查看生成片段</summary>{prose(recent.draft)}</details>}</section>}
        {editing !== undefined && editor(editing, selected, section, () => setEditing(undefined))}
        {visible.length > 1 && <label className="knowledge-picker">阅读文件 <span className="muted">{visible.length} 份{query.trim() ? '匹配' : '可选'}</span><select value={reading?.id ?? ''} onChange={event => setReadingId(event.target.value)} aria-label="阅读文件">{visible.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        {reading ? <div className="knowledge-files" ref={reader}><article className="panel knowledge-file" key={reading.id}><div className="section-head"><div><h3>{reading.title}</h3><small className="muted">v{reading.revision} · {reading.text.length.toLocaleString()} 字符</small></div><button onClick={() => setEditing(reading)}>编辑文件</button><button className="subtle" disabled={busy} onClick={() => { if (confirm('删除这份知识文件？历史面试快照不变。')) void act(() => api(`/materials/${reading.id}`, 'DELETE'), '知识文件已删除'); }}>删除文件</button></div>{prose(reading.text)}</article></div> : <div className="empty"><h3>{query.trim() ? '没有找到匹配的知识' : '当前分类还没有文件'}</h3><p>{query.trim() ? '试试缩短搜索词，或切换知识分类。' : '可以新增文件、批量导入文档，或使用当前模型补充学习内容。'}</p></div>}
        <p className="knowledge-footnote">编辑草稿只在当前浏览器暂存；保存后可用于新训练。</p>
      </section>
    </div>
  </>;
}
