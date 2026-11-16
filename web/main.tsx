import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Job, KnowledgeSection, Material, MaterialKind, Session, Settings, Topic, Turn } from '../src/model.ts';
import type { ImportPreview } from '../src/migration.ts';
import { api, base64, download } from './api.ts';
import './style.css';
import './workspace.css';
import { Knowledge } from './knowledge.tsx';
import { ModelSettings } from './models.tsx';

type Page = 'workspace' | 'materials' | 'history' | 'resume' | 'topic' | 'progress' | 'knowledge' | 'settings';
const pages: Record<Page, string> = { workspace: '开始面试', history: '复盘与重练', materials: '资料与学习', resume: '我的简历', topic: '专项练习', progress: '能力记录', knowledge: '备面知识库', settings: '模型与设置' };
type PublicSettings = Omit<Settings, 'apiKey'> & { hasApiKey: boolean };
const kinds = { resume: '简历', project: '项目', jd: '岗位 JD', notes: '知识笔记' };
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const id = () => crypto.randomUUID();
function stored<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function remember(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Navigation still works when browser storage is unavailable. */ } }
function useDraft(key: string, initial: string) {
  const [value, setValue] = useState(() => { const saved = stored<unknown>(key, initial); return typeof saved === 'string' ? saved : initial; });
  const [warning, setWarning] = useState('');
  const change = (next: string) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setWarning(''); }
    catch { setWarning('浏览器草稿保存失败。请复制当前内容，正式保存后才会进入本机数据库。'); }
  };
  return [value, change, warning] as const;
}
function Prose({ children, citations = true }: { children?: string; citations?: boolean }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[M\d+\])/g).map((part, index) => {
    if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (citations && /^\[M\d+\]$/.test(part)) return <button className="citation-link" key={index} aria-label={`查看材料 ${part.slice(1, -1)}`} onClick={() => {
      const target = document.querySelector<HTMLDetailsElement>(`details[data-citation="${part.slice(1, -1)}"]`);
      if (target) { target.open = true; target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.querySelector('summary')?.focus(); }
    }}>{part}</button>;
    return part;
  });
  const lines = (children ?? '').split('\n'), blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], heading = line.match(/^#{1,4}\s+(.+)/);
    if (line.startsWith('```')) {
      const code: string[] = []; while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      blocks.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (heading) blocks.push(<h4 key={i}>{inline(heading[1])}</h4>);
    else if (/^\s*(?:[-*+] |\d+[.)] )/.test(line)) {
      const ordered = /^\s*\d/.test(line), items: React.ReactNode[] = [], pattern = ordered ? /^\s*\d+[.)]\s+(.+)/ : /^\s*[-*+]\s+(.+)/;
      for (; i < lines.length && pattern.test(lines[i]); i++) items.push(<li key={i}>{inline(lines[i].replace(pattern, '$1'))}</li>);
      blocks.push(ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>); i--;
    } else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="prose">{blocks}</div>;
}
function App() {
  const [page, setPage] = useState<Page>(() => { const saved = stored('ir-page', 'workspace'); return Object.hasOwn(pages, saved) ? saved as Page : 'workspace'; });
  const [sessionId, setSessionId] = useState<string>(() => { const saved = stored('ir-session', ''); return typeof saved === 'string' ? saved : ''; });
  const [materials, setMaterials] = useState<Material[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]), [trainingTopic, setTrainingTopic] = useState('');
  const [settings, setSettings] = useState<PublicSettings | null>(null), [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { content.current?.scrollTo(0, 0); }, [page, sessionId]);
  const session = sessions.find(item => item.id === sessionId);
  const running = jobs.find(job => job.status === 'running');
  const navigate = (next: Page) => { setPage(next); remember('ir-page', next); };
  const choose = (value: string) => { setSessionId(value); remember('ir-session', value); navigate('workspace'); };
  const refresh = useCallback(async () => {
    const [m, s, config, t] = await Promise.all([api<Material[]>('/materials'), api<Session[]>('/sessions'), api<PublicSettings>('/settings'), api<Topic[]>('/topics')]);
    setTopics(t); setMaterials(m); setSessions(previous => s.map(latest => { const current = previous.find(item => item.id === latest.id); return current && current.revision > latest.revision ? current : latest; })); setSettings(config); document.documentElement.dataset.theme = config.theme; setReady(true);
  }, []);
  useEffect(() => { void refresh().catch(error => setError(String(error.message))); }, [refresh]);
  useEffect(() => {
    if (!sessionId) { setJobs([]); return; }
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const values = await api<Job[]>(`/sessions/${sessionId}/jobs`);
        if (cancelled) return;
        setJobs(values);
        const latest = await api<Session>(`/sessions/${sessionId}`);
        if (!cancelled) setSessions(previous => previous.map(item => item.id === latest.id && latest.revision >= item.revision ? latest : item));
      } catch (error) { if (!cancelled) setError((error as Error).message); }
      if (!cancelled) timer = setTimeout(poll, 1200);
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [sessionId]);
  async function act<T>(action: () => Promise<T>, message?: string): Promise<T | undefined> {
    setError(''); setNotice(''); setBusy(true);
    try { const value = await action(); await refresh(); if (message) setNotice(message); return value; }
    catch (error) { setError((error as Error).message); return undefined; } finally { setBusy(false); }
  }
  async function startJob(kind: Job['input']['kind'], turnId?: string, answer?: string, requestId: string = id()) {
    const value = await act(() => api<Job>(`/sessions/${sessionId}/jobs`, 'POST', { kind, turnId, answer, requestId }));
    if (value) setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]);
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('workspace'); }}><span className="brand-mark">IR<span>.</span></span><span>面试练习室<small>INTERVIEW ROOM</small></span></a>
      <div className="rail-label">我的训练</div>
      <nav aria-label="主导航">{([['workspace', '01', '开始面试'], ['history', '02', '复盘与重练'], ['materials', '03', '资料与学习'], ['resume', '04', '我的简历'], ['topic', '05', '专项练习'], ['progress', '06', '能力记录'], ['knowledge', '07', '备面知识库']] as const).map(([name, num, label]) =>
        <button key={name} aria-current={page === name ? 'page' : undefined} className={page === name ? 'nav-item active' : 'nav-item'} onClick={() => navigate(name)}><span>{num}</span>{label}{name === 'history' && <b>{sessions.length}</b>}</button>)}</nav>
      <div className="rail-note"><span className="status-dot" />本机工作区<p>练清楚，再答一次。</p></div>
      <button aria-current={page === 'settings' ? 'page' : undefined} className={`settings-entry ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>模型与设置 <span>↗</span></button>
      <div className="sidebar-footer"><div className="theme-switch" aria-label="配色">{(['ink', 'forest'] as const).map(theme => <button key={theme} title={{ ink: '雾白墨蓝', forest: '深灰青绿' }[theme]} aria-label={{ ink: '雾白墨蓝', forest: '深灰青绿' }[theme]} aria-pressed={settings?.theme === theme} className={`swatch ${theme} ${settings?.theme === theme ? 'selected' : ''}`} onClick={() => {
        if (settings) void act(() => api('/theme', 'PUT', { theme }));
      }} />)}</div><span>xbzz1018 <small>v2 · 本地优先</small></span></div>
    </aside>
    <main>
      <header className="topbar"><span>我的练习空间 <span className="slash">/</span> {pages[page]}</span><span className="model-pill"><span className="status-dot" />{settings?.model || '模型待配置'}</span></header>
      <div className="content" data-page={page} ref={content}>
        {error && <div role="alert" className="banner error">{error}<button onClick={() => setError('')} aria-label="关闭错误提示">关闭</button></div>}
        {notice && <div role="status" className="banner success">{notice}<button onClick={() => setNotice('')}>关闭</button></div>}
        {!ready ? <div className="empty"><h2>正在连接本机工作区</h2><p>若服务未启动，请运行项目中的启动脚本。</p><button onClick={() => void refresh().catch(error => setError(error.message))}>重新连接</button></div> : <>
          {(page === 'workspace' || page === 'topic') && (page === 'workspace' && session ? <SessionView key={session.id} session={session} jobs={jobs} busy={busy} onNew={() => choose('')} onJob={startJob}
            onCancel={jobId => void act(() => api(`/jobs/${jobId}/cancel`, 'POST', {}))}
            onAnswer={async (turnId, answer) => Boolean(await act(() => api(`/sessions/${session.id}/answer`, 'POST', { turnId, answer, revision: session.revision }), '回答已保存'))}
            onComplete={() => void act(() => api(`/sessions/${session.id}/complete`, 'POST', {}), '本轮已结束，原问答已保留，可以开始复盘')}
          /> : <Setup key={`${page}-${trainingTopic}`} topics={topics} initialTopic={trainingTopic} onKnowledge={() => navigate('knowledge')} variant={page === 'topic' ? 'topic' : 'interview'} materials={materials} settings={settings!} busy={busy} onMaterials={() => navigate('materials')} onSettings={() => navigate('settings')} onCreate={async input => {
            const value = await act(() => api<Session>('/sessions', 'POST', input)); if (value) { choose(value.id); }
          }} />)}
          {(['materials', 'resume'] as Page[]).includes(page) && <Materials key={page} topics={topics} initialKind={page === 'resume' ? 'resume' : undefined} materials={materials} busy={busy} act={act} />}
          {page === 'knowledge' && <Knowledge topics={topics} materials={materials} busy={busy} act={act} onRefresh={refresh} onTrain={id => { setTrainingTopic(id); navigate('topic'); }} prose={text => <Prose citations={false}>{text}</Prose>} editor={(material, topicId, section, onClose) => <MaterialEditor key={material?.id ?? `new-knowledge-${topicId}-${section}`} material={material} defaultKind="notes" defaultTopic={topicId} defaultSection={section} topics={topics} busy={busy} act={act} onClose={onClose} />} />}
          {page === 'progress' && <Progress sessions={sessions} onOpen={choose} onTopic={() => navigate('topic')} />}
          {page === 'history' && <><PageTitle eyebrow="PRACTICE ARCHIVE" title="每一次表达，都有下一次。" description="问答、复盘与重答分别保留。更新资料不会改变过去那轮面试的依据。" />
            {sessions.length ? <div className="history-list">{sessions.map(item => <article className="history-row" key={item.id}><div className="date-tile">{new Date(item.createdAt).getDate()}<small>{new Date(item.createdAt).getMonth() + 1} 月</small></div><button className="history-open" onClick={() => choose(item.id)}><h3>{item.title}</h3><p>{item.role} · {item.turns.filter(turn => turn.answer !== undefined).length} 题已答 · {item.mode === 'strict' ? '严格模拟' : '教练练习'}{item.imported ? ' · 历史导入' : ''}</p></button><span className={`tag ${item.status === 'active' ? 'live' : ''}`}>{item.status === 'active' ? '进行中' : '已结束'}</span><button className="subtle" onClick={() => { if (confirm('删除这轮练习？资料库不受影响。')) void act(async () => { const result = await api(`/sessions/${item.id}`, 'DELETE'); if (sessionId === item.id) choose(''); return result; }, '练习已删除'); }}>删除</button></article>)}</div>
            : <Empty title="还没有练习记录" description="从一轮围绕你真实项目的问答开始。" action="开始第一轮" onAction={() => choose('')} />}</>}
          {page === 'settings' && <SettingsView settings={settings!} busy={busy} act={act} />}
        </>}
      </div>
    </main>
    {running && page !== 'workspace' && <button className="floating-job" onClick={() => navigate('workspace')}>正在生成 · 返回查看进度</button>}
  </div>;
}
function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function Empty({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="empty"><span className="empty-label">YOUR NEXT STEP</span><h3>{title}</h3><p>{description}</p>{action && <button className="primary" onClick={onAction}>{action}</button>}</div>;
}
function Setup({ variant, materials, settings, busy, onCreate, onMaterials, onSettings, topics, initialTopic, onKnowledge }: {
  variant: 'interview' | 'topic'; materials: Material[]; settings: PublicSettings; busy: boolean; onCreate: (input: unknown) => Promise<void>; onMaterials: () => void; onSettings: () => void;
  topics: Topic[]; initialTopic: string; onKnowledge: () => void;
}) {
  const topic = variant === 'topic', draftKey = topic ? 'ir-setup-topic' : 'ir-setup';
  const [saved] = useState(() => { const value = stored<unknown>(draftKey, {}); return value && typeof value === 'object' ? value as Record<string, unknown> : {}; });
  const [title, setTitle] = useState(typeof saved.title === 'string' ? saved.title : topic ? '我的专项练习' : '我的面试练习'), [role, setRole] = useState(typeof saved.role === 'string' ? saved.role : '');
  const [selected, setSelected] = useState<string[]>(Array.isArray(saved.selected) ? saved.selected.filter((value): value is string => typeof value === 'string') : []), [mode, setMode] = useState<'strict' | 'coach'>(saved.mode === 'coach' ? 'coach' : 'strict');
  const [resumeId, setResumeId] = useState(typeof saved.resumeId === 'string' ? saved.resumeId : ''), [jdId, setJdId] = useState(typeof saved.jdId === 'string' ? saved.jdId : '');
  const [focus, setFocus] = useState(typeof saved.focus === 'string' ? saved.focus : '');
  const [topicId, setTopicId] = useState(initialTopic || (typeof saved.topicId === 'string' ? saved.topicId : ''));
  const [pickingTopic, setPickingTopic] = useState(false);
  const [omitted, setOmitted] = useState<string[]>(Array.isArray(saved.omitted) ? saved.omitted.filter((item): item is string => typeof item === 'string') : []);
  const selectedTopic = topics.find(item => item.id === topicId);
  const domainNotes = topic && selectedTopic ? materials.filter(item => item.kind === 'notes' && item.topicId === topicId) : [];
  const knowledgeIds = domainNotes.filter(item => !omitted.includes(item.id)).map(item => item.id);
  useEffect(() => { remember(draftKey, { title, role, selected, mode, resumeId, jdId, focus, topicId, omitted }); }, [draftKey, title, role, selected, mode, resumeId, jdId, focus, topicId, omitted]);
  const [supplementQuery, setSupplementQuery] = useState('');
  const currentResumeId = materials.some(material => material.id === resumeId && material.kind === 'resume') ? resumeId : '';
  const currentJdId = materials.some(material => material.id === jdId && material.kind === 'jd') ? jdId : '';
  const [includeKnowledge, setIncludeKnowledge] = useState(false);
  const supplements = materials.filter(item => ['project', 'notes'].includes(item.kind) && (!item.topicId || (!topic && (includeKnowledge || selected.includes(item.id)))));
  const chosen = [...new Set([currentResumeId, currentJdId, ...selected.filter(value => supplements.some(material => material.id === value))].filter(Boolean))];
  const domainGroups = (['core', 'questions'] as const).map(section => domainNotes.filter(item => (item.knowledgeSection ?? 'core') === section && knowledgeIds.includes(item.id) && !chosen.includes(item.id)));
  const total = materials.filter(material => chosen.includes(material.id)).reduce((sum, material) => sum + material.text.length, 0) + domainGroups.reduce((sum, group) => sum + group.map(item => `## ${item.title} / v${item.revision}\n${item.text}`).join('\n\n').length, 0);
  const count = chosen.length + domainGroups.filter(group => group.length).length;
  return <><PageTitle eyebrow={topic ? '技术与表达训练' : '个人模拟面试'} title={topic ? '专项训练' : '开始一轮面试'} description={topic ? '选择领域，使用对应的核心知识和高频题逐层追问。个人项目可自行添加后选用，也可以只练通用技术。' : '以简历、目标岗位和 JD 为主线。先独立回答，复盘后用自己的话再答一次。'} action={topic ? <button onClick={onKnowledge}>管理训练领域 ↗</button> : undefined} />
    {topic && (!selectedTopic || pickingTopic) && <section className="panel topic-picker"><div className="section-head"><h2>选择训练领域</h2><span className="tag">{topics.length} 个领域</span>{selectedTopic && <button onClick={() => setPickingTopic(false)}>返回准备</button>}</div><div className="topic-grid">{topics.map(item => <button key={item.id} aria-pressed={topicId === item.id} className={topicId === item.id ? 'topic-choice selected-domain' : 'topic-choice'} onClick={() => { setTopicId(item.id); setOmitted([]); setPickingTopic(false); }}><strong>{item.name}</strong><p>{item.description}</p><small>{materials.filter(note => note.topicId === item.id && (note.knowledgeSection ?? 'core') === 'core').length} 份知识 · {materials.filter(note => note.topicId === item.id && note.knowledgeSection === 'questions').length} 份题库</small></button>)}</div></section>}
    {topic && selectedTopic && !pickingTopic && <section className="panel domain-selection"><div className="section-head"><div><h2>本轮领域：{selectedTopic.name}</h2></div><button onClick={() => setPickingTopic(true)}>更换领域</button><button onClick={onKnowledge}>编辑知识库</button></div><details><summary>调整本轮知识文件 · 已选 {knowledgeIds.length} / {domainNotes.length}</summary>{domainNotes.length ? domainNotes.map(item => <label key={item.id} className="check-label"><input type="checkbox" checked={!omitted.includes(item.id)} onChange={event => setOmitted(previous => event.target.checked ? previous.filter(id => id !== item.id) : [...previous, item.id])} />{item.knowledgeSection === 'questions' ? '高频题' : '核心知识'} · {item.title}</label>) : <p className="muted">该领域暂无知识，可先添加或练习一般原理。</p>}</details></section>}
    {topic && (!selectedTopic || pickingTopic) ? <p className="muted topic-prompt">先选择一个训练领域，再设置本轮岗位、材料和练习方式。</p> : <div className="setup-grid"><section className="panel setup-main"><div className="setup-fields"><div className="section-head"><span className="step-no">01</span><div><h2>确定这轮的方向</h2></div></div>
      <div className="two-fields"><label>练习名称<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label><label>目标岗位<input value={role} onChange={event => setRole(event.target.value)} maxLength={200} placeholder="填写本轮目标岗位" /></label></div>
      {topic ? <label className="focus-field">本轮专项重点（可选）<input value={focus} onChange={event => setFocus(event.target.value)} maxLength={200} placeholder="留空练所选领域，或缩小到事务隔离、重试等重点" /></label> : <details className="focus-options"><summary>指定练习重点{focus ? ` · ${focus}` : '（可选）'}</summary><label>专项重点（可选）<input value={focus} onChange={event => setFocus(event.target.value)} maxLength={200} placeholder="例如：数据库事务、异步编程、系统设计" /></label></details>}
      <div className="section-head spaced"><span className="step-no">02</span><div><h2>简历与岗位要求</h2><p>开始后冻结版本，后续编辑不会改变本轮依据。</p></div><button className="text-button" onClick={onMaterials}>管理资料 ↗</button></div>
      <div className="two-fields"><label>本轮简历<select aria-label="本轮简历" value={currentResumeId} onChange={event => setResumeId(event.target.value)}><option value="">暂不使用简历</option>{materials.filter(material => material.kind === 'resume').map(material => <option key={material.id} value={material.id}>{material.title} · v{material.revision}</option>)}</select></label><label>本轮岗位 JD<select aria-label="本轮岗位 JD" value={currentJdId} onChange={event => setJdId(event.target.value)}><option value="">暂未提供 JD，按岗位通用要求练</option>{materials.filter(material => material.kind === 'jd').map(material => <option key={material.id} value={material.id}>{material.title} · v{material.revision}</option>)}</select></label></div>
      {(!currentResumeId || !currentJdId) && <p className="basis-note">{!currentResumeId ? '尚未选择简历，不会推测你的完整经历。' : ''}{!currentJdId ? '尚未选择 JD，本轮按目标岗位的通用要求练习。' : ''} 在“资料与学习”中添加并分类后即可选择。</p>}
      <h3 className="supplement-title">补充项目与知识笔记</h3>
      {!topic && <button className="text-button knowledge-toggle" aria-pressed={includeKnowledge} onClick={() => setIncludeKnowledge(value => !value)}>{includeKnowledge ? '收起通用领域知识' : '从通用知识库补充（可选）'}</button>}
      {supplements.length > 6 && <input className="supplement-search" aria-label="搜索补充材料" placeholder="按名称筛选项目或题卡" value={supplementQuery} onChange={event => setSupplementQuery(event.target.value)} />}
      {supplements.length ? <div className="material-options">{supplements.filter(material => material.title.toLowerCase().includes(supplementQuery.toLowerCase())).map(material => <label className={`material-choice ${selected.includes(material.id) ? 'checked' : ''}`} key={material.id}><input type="checkbox" checked={selected.includes(material.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, material.id] : previous.filter(id => id !== material.id))} /><div><span className="tag">{kinds[material.kind]}</span><strong>{material.title}</strong><small>v{material.revision} · {material.text.length.toLocaleString()} 字符</small></div></label>)}</div> : <div className="inline-empty"><p>个人项目由你自行添加；通用专项不要求上传项目。</p><button onClick={onMaterials}>添加自己的资料</button></div>}
      <div className="selection-count">已选 {count} / 8 份 · 合计 {total.toLocaleString()} / 60,000 字符{topic && ' · 领域知识按核心与题库合并为快照'}</div>
      <div className="section-head spaced"><span className="step-no">03</span><div><h2>选择练习方式</h2></div></div>
      <div className="mode-options"><button aria-pressed={mode === 'strict'} className={mode === 'strict' ? 'mode selected-mode' : 'mode'} onClick={() => setMode('strict')}><h3>严格模拟</h3><p>先独立回答，结束后解锁参考答法。</p></button><button aria-pressed={mode === 'coach'} className={mode === 'coach' ? 'mode selected-mode' : 'mode'} onClick={() => setMode('coach')}><h3>教练练习</h3><p>边练边看答法，再次作答加深理解。</p></button></div>
      </div><div className="panel-footer"><span>资料只发送给你配置的模型接口</span><button className="primary" disabled={busy || !title.trim() || !role.trim() || (topic && !selectedTopic) || count > 8 || total > 60000} onClick={() => void onCreate({ title, role, focus, materialIds: chosen, mode, trainingKind: topic ? 'topic' : 'interview', ...(topic ? { topicId, knowledgeIds } : {}) })}>创建本轮练习 <span>→</span></button></div>
    </section><aside className="setup-aside"><section className="note-card"><div className="eyebrow">本轮练习</div><h2>先回答，再复盘。</h2><ol><li><b>01</b><div>独立表达<p>讲清自己的工作与设计取舍。</p></div></li><li><b>02</b><div>对照材料<p>核对项目证据，补上理解缺口。</p></div></li><li><b>03</b><div>再次作答<p>重新组织表达，比较两次回答。</p></div></li></ol></section>
      <section className="connection-card"><span className="eyebrow">本轮使用的模型</span><h3>{settings.model}</h3><p>{settings.protocol === 'responses' ? 'Responses API' : settings.protocol === 'anthropic' ? 'Anthropic Messages' : 'Chat Completions'} · {settings.effort || '默认强度'}</p><span className={`tag ${settings.hasApiKey ? 'live' : ''}`}>{settings.hasApiKey ? '已配置 API Key' : '需要填写 API Key'}</span><button className="text-button" onClick={onSettings}>模型设置 ↗</button></section>
    </aside></div>}</>;
}
type Act = <T>(action: () => Promise<T>, message?: string) => Promise<T | undefined>;
function Materials({ initialKind, materials, busy, act, topics }: { initialKind?: MaterialKind; materials: Material[]; busy: boolean; act: Act; topics: Topic[] }) {
  const [editing, setEditing] = useState<Material | null | undefined>(undefined);
  const [filter, setFilter] = useState(''), [query, setQuery] = useState('');
  const category = initialKind ?? filter;
  const scoped = materials.filter(material => !category || material.kind === category);
  const visible = scoped.filter(material => `${material.title}\n${material.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const heading = initialKind === 'resume'
    ? { eyebrow: 'MY RESUMES', title: '让每段经历，经得起追问。', description: '导入并编辑简历正文，保留多个岗位版本。开始面试时选择本轮版本，历史问答的依据不会变化。', action: '添加简历' }
    : initialKind === 'notes'
    ? { eyebrow: 'MY KNOWLEDGE', title: '把不会的，变成下一次会的。', description: '整理题卡、技术原理与复盘笔记，按标题和正文搜索。开始面试或专项练习时，选择相关笔记作为补充材料。', action: '添加知识笔记' }
    : { eyebrow: 'YOUR EVIDENCE', title: '好的追问，从真实材料开始。', description: '简历、项目、JD 和知识笔记。每次保存形成新版本，旧面试保持原来的快照。', action: '新建资料' };
  return <><PageTitle {...heading} action={<button className="primary" onClick={() => setEditing(null)}>＋ {heading.action}</button>} />
    {editing !== undefined && <MaterialEditor key={editing?.id ?? `new-${initialKind ?? 'project'}`} material={editing} defaultKind={initialKind} topics={topics} busy={busy} act={act} onClose={() => setEditing(undefined)} />}
    <div className="library-tools">{initialKind ? <div className="library-scope"><span className="eyebrow">{kinds[initialKind]}</span><strong>{scoped.length} 份已保存</strong></div> : <label>资料分类<select aria-label="资料分类" value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部资料 · {materials.length}</option>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label} · {materials.filter(material => material.kind === kind).length}</option>)}</select></label>}<label>搜索资料<input value={query} onChange={event => setQuery(event.target.value)} placeholder={initialKind === 'resume' ? '搜索简历名称、岗位或经历' : '搜索资料标题或正文'} /></label></div>
    {visible.length ? <div className="material-grid">{visible.map(material => <article className="material-card" key={material.id}><div className="card-top"><span className="tag">{kinds[material.kind]}</span><small>v{material.revision}</small></div><h3>{material.title}</h3><p className="excerpt">{material.text.slice(0, 190)}</p><div className="card-meta">{material.text.length.toLocaleString()} 字符 · {time(material.updatedAt)}</div><div className="card-actions"><button onClick={() => setEditing(material)}>编辑资料</button><button className="subtle" onClick={() => { if (confirm('删除资料？历史面试中的快照会保留。')) void act(() => api(`/materials/${material.id}`, 'DELETE'), '资料已删除'); }}>删除</button></div></article>)}</div>
    : editing === undefined && <Empty title={query.trim() ? '没有找到符合条件的资料' : initialKind === 'resume' ? '先放入一份本轮要用的简历' : initialKind === 'notes' ? '从一张有用的题卡开始' : '把你真正做过的事情放进来'} description={query.trim() ? '试着缩短搜索词，或调整资料分类。' : initialKind === 'resume' ? '支持文字 PDF、Markdown、TXT 和图片识别，提取后可以继续编辑正文。' : initialKind === 'notes' ? '记录问题、思路、易错点和自己的解释。学习笔记与真实项目经历要分别说明。' : '先添加简历和一个代表项目，知识笔记可以在练习中逐步补充。'} action={query.trim() ? undefined : heading.action} onAction={() => setEditing(null)} />}</>;
}
function MaterialEditor({ material, defaultKind = 'project', defaultTopic = '', defaultSection = 'core', topics, busy, act, onClose }: { material: Material | null; defaultKind?: MaterialKind; defaultTopic?: string; defaultSection?: KnowledgeSection; topics: Topic[]; busy: boolean; act: Act; onClose: () => void }) {
  const [savedId, setSavedId] = useState(material?.id);
  const draftKey = `ir-material-${material?.id ?? (defaultKind === 'project' ? 'new' : `new-${defaultKind}${defaultTopic ? `-${defaultTopic}-${defaultSection}` : ''}`)}`;
  const initial = { title: material?.title ?? '', kind: material?.kind ?? defaultKind, text: material?.text ?? '', revision: material?.revision, recordId: material?.id ?? '', topicId: material?.topicId ?? defaultTopic, knowledgeSection: material?.knowledgeSection ?? defaultSection };
  const [draft, change, warning] = useDraft(draftKey, JSON.stringify(initial));
  let value = initial, corruptDraft = false;
  try {
    const parsed = JSON.parse(draft);
    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.text !== 'string' || !Object.hasOwn(kinds, parsed.kind)) throw new Error('invalid draft');
    value = { ...initial, ...parsed };
  } catch { corruptDraft = true; }
  const [extracting, setExtracting] = useState(false), [extractError, setExtractError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    editor.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape' && !extracting && !busy) onClose(); };
    document.addEventListener('keydown', dismiss); return () => document.removeEventListener('keydown', dismiss);
  }, [onClose, extracting, busy]);
  const update = (patch: Partial<typeof value>) => change(JSON.stringify({ ...value, ...patch }));
  async function load(file: File) {
    setExtracting(true); setExtractError('');
    try {
      if (file.size > 8000000) throw new Error('文件不能超过 8 MB');
      let content: string;
      if (/\.(md|markdown|txt)$/i.test(file.name)) content = await file.text();
      else {
        const image = /\.(png|jpe?g|webp)$/i.test(file.name);
        if (image && !confirm('将这张图片发送给模型设置中的 API 提取文字？提取结果需要你核对后才能保存。')) return;
        if (!image && !/\.(pdf|docx)$/i.test(file.name)) throw new Error('支持 MD、TXT、文字 PDF、DOCX 和 PNG/JPEG/WebP 图片');
        const result = await api<{ text: string }>('/extract', 'POST', { type: image ? 'image' : /\.docx$/i.test(file.name) ? 'docx' : 'pdf', base64: await base64(file), mime: file.type, confirmed: image });
        content = result.text;
      }
      if (content.length > 60000) throw new Error('资料超过 60000 字符，请拆分');
      if (value.text.trim() && !confirm('提取完成。是否用新内容替换当前编辑区？已保存的资料此时不变。')) return;
      update({ text: content, title: value.title || file.name.replace(/\.[^.]+$/, '') });
    } catch (error) { setExtractError((error as Error).message); } finally { setExtracting(false); }
  }
  return <section ref={editor} className="panel editor-panel" role="dialog" aria-label={material ? '编辑资料' : '准备一份新资料'}><div className="section-head"><h2>{material ? '编辑资料' : '准备一份新资料'}</h2><button className="subtle" onClick={onClose}>收起</button></div><div className="editor-fields">
    <div className="two-fields"><label>标题<input value={value.title} maxLength={160} onChange={event => update({ title: event.target.value })} /></label><label>类型<select aria-label="类型" value={value.kind} onChange={event => update({ kind: event.target.value as MaterialKind })}>{Object.entries(kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
    {value.kind === 'notes' && <div className="two-fields"><label>所属领域<select value={value.topicId} onChange={event => update({ topicId: event.target.value })}><option value="">未分类笔记</option>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><label>知识分类<select value={value.knowledgeSection} onChange={event => update({ knowledgeSection: event.target.value as KnowledgeSection })}><option value="core">核心知识库</option><option value="questions">高频题库</option></select></label></div>}
    <div className="editor-toolbar"><button disabled={extracting} onClick={() => input.current?.click()}>{extracting ? '正在提取，请稍候…' : '从文件提取文字'}</button><span>PDF 在本地解析 · 图片经确认后发给模型</span><input ref={input} hidden type="file" accept=".md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void load(file); }} /></div>
    {extractError && <p role="alert" className="field-error">{extractError}</p>}
    <label>资料正文<textarea className="material-text" value={value.text} maxLength={60000} onChange={event => update({ text: event.target.value })} placeholder={{ resume: '填写个人经历、职责与技能，或从简历文件提取。', jd: '粘贴岗位职责、技能要求与招聘说明。', project: '说明项目背景、本人职责、方案与已验证结果。', notes: '记录概念、机制、例子或待复习的要点。' }[value.kind]} /></label>
    {(warning || corruptDraft) && <p className="field-error">{warning || '浏览器草稿格式损坏，已显示正式保存的版本；编辑后可重新保存。'}</p>}
    </div><div className="panel-footer"><span>{value.text.length.toLocaleString()} / 60,000 字符 · 编辑草稿自动保存在当前浏览器</span><button className="primary" disabled={busy || extracting || !value.title.trim() || !value.text.trim()} onClick={async () => {
      const submitted = draft;
      const targetId = savedId || value.recordId;
      const result = await act(() => api<Material>(`/materials${targetId ? `/${targetId}` : ''}`, targetId ? 'PUT' : 'POST', value), '资料已保存，后续面试可选择新版本');
      if (result) {
        const latest = stored(draftKey, submitted);
        if (latest === submitted) { try { localStorage.removeItem(draftKey); } catch {} onClose(); }
        else { setSavedId(result.id); try { const newer = JSON.parse(latest); change(JSON.stringify({ ...newer, revision: result.revision, recordId: result.id })); } catch {} }
      }
    }}>保存资料</button></div></section>;
}
function SessionView({ session, jobs, busy, onNew, onJob, onCancel, onAnswer, onComplete }: {
  session: Session; jobs: Job[]; busy: boolean; onNew: () => void;
  onJob: (kind: Job['input']['kind'], turnId?: string, answer?: string, requestId?: string) => Promise<void>;
  onCancel: (id: string) => void; onAnswer: (id: string, answer: string) => Promise<boolean>; onComplete: () => void;
}) {
  const [tab, setTab] = useState<'interview' | 'review' | 'prepare'>('interview');
  const [selectedId, setSelectedId] = useState(session.turns.at(-1)?.id ?? '');
  const latestId = session.turns.at(-1)?.id;
  useEffect(() => { if (latestId) setSelectedId(latestId); }, [latestId]);
  const selected = session.turns.find(turn => turn.id === selectedId) ?? session.turns.at(-1);
  const running = jobs.find(job => job.status === 'running'), recent = jobs[0];
  const disabled = busy || Boolean(running);
  return <><PageTitle eyebrow={`${session.mode === 'strict' ? 'STRICT INTERVIEW' : 'COACH PRACTICE'} / ${session.status === 'active' ? 'IN PROGRESS' : 'COMPLETED'}`} title={session.title} description={`${session.role} · ${time(session.createdAt)} · ${session.turns.filter(turn => turn.answer !== undefined).length} 题已答`} action={<button onClick={onNew}>新的一轮</button>} />
    <div className="session-tabs"><button className={tab === 'interview' ? 'active-tab' : ''} onClick={() => setTab('interview')}>面试与重答</button><button className={tab === 'review' ? 'active-tab' : ''} onClick={() => setTab('review')}>本轮复盘</button>{(session.turns.length === 0 || session.status === 'completed' || session.mode === 'coach') && <button className={tab === 'prepare' ? 'active-tab' : ''} onClick={() => setTab('prepare')}>备面分析</button>}<span>{session.status === 'active' ? '问答自动保存，离开后可继续' : '原始问答已冻结'}</span></div>
    {recent?.status === 'succeeded' && <p className="generation-meta">最近生成：{({ prepare: '备面分析', next: '面试追问', reference: '参考答法', review: '本轮复盘', compare: '重答比较', knowledge: '知识补充' })[recent.input.kind]} · {recent.model} / {recent.effort || '默认强度'} · 首段 {((recent.firstTokenMs ?? 0) / 1000).toFixed(1)} 秒 · 完整 {((recent.elapsedMs ?? 0) / 1000).toFixed(1)} 秒</p>}
    {recent && recent.status !== 'succeeded' && <section className={`job-status ${recent.status === 'running' ? '' : 'job-error'}`} role="status"><div><strong>{({ prepare: '正在分析简历与岗位要求', next: '面试官正在准备追问', reference: '正在整理本题参考答法', review: '正在生成本轮复盘', compare: '正在比较两次表达', knowledge: '正在补充学习材料' })[recent.input.kind]}</strong><small>{recent.model} · {recent.effort || '默认强度'}{recent.elapsedMs ? ` · ${(recent.elapsedMs / 1000).toFixed(1)} 秒` : ''}</small><p>{recent.error || '可以离开页面，生成状态保存在本机。再次进入可查看结果。'}</p></div><button disabled={busy} onClick={() => recent.status === 'running' ? onCancel(recent.id) : void onJob(recent.input.kind, recent.input.turnId, recent.input.answer, recent.requestId)}>{recent.status === 'running' ? '取消生成' : '重新生成'}</button>{recent.draft && <details open><summary>查看已生成片段</summary><Prose>{recent.draft}</Prose></details>}</section>}
    <div className="practice-grid"><section className="panel practice-main">
      {tab === 'prepare' ? <><div className="section-head"><h2>简历 × 岗位 × JD</h2>{session.turns.length === 0 && session.status === 'active' && <button disabled={disabled} onClick={() => void onJob('prepare')}>{session.preparation ? '重新分析' : '生成备面分析'}</button>}</div>{session.preparation ? <Prose>{session.preparation}</Prose> : <Empty title="先看要求与经历能否对应" description="按需分析岗位重点、已有证据和待补充材料。不生成匹配分数，也不把 JD 要求当作你的经历。" />}</>
      : tab === 'review' ? <><div className="section-head"><h2>本轮复盘</h2>{session.status === 'completed' && <button disabled={disabled} onClick={() => void onJob('review')}>{session.review ? '重新生成复盘' : '生成复盘'}</button>}</div>{session.review ? <Prose>{session.review}</Prose> : <Empty title={session.status === 'active' ? '先完成这一轮表达' : '把这轮练习，变成下次的进步'} description={session.status === 'active' ? '结束面试后生成复盘，严格模拟中不会提前泄露答法。' : '复盘会引用真实回答，分别整理技术缺口与表达练法。'} />}</>
      : selected ? <QuestionPanel key={selected.id} turn={selected} number={session.turns.indexOf(selected) + 1} session={session} disabled={disabled} onAnswer={onAnswer} onJob={onJob} />
      : <Empty title="准备好了，从第一题开始" description="材料已冻结。围绕简历、岗位与 JD 追问；项目事实和数字需要根据证据核对。" action="生成第一题" onAction={() => { if (!disabled) void onJob('next'); }} />}
      {tab === 'interview' && session.status === 'active' && session.turns.length > 0 && <div className="panel-footer"><button disabled={disabled || !session.turns.some(turn => turn.answer !== undefined)} onClick={onComplete}>结束本轮面试</button><button className="primary" disabled={disabled || !session.turns.at(-1)?.answer} onClick={() => void onJob('next')}>继续下一题 →</button></div>}
    </section><aside className="practice-aside"><section className="panel question-index"><div className="section-head"><h3>问题目录</h3><span className="tag">{session.turns.length} 题</span></div>{session.turns.length ? session.turns.map((turn, index) => <button key={turn.id} className={selected?.id === turn.id ? 'question-link current' : 'question-link'} onClick={() => { setSelectedId(turn.id); setTab('interview'); }}><span>{String(index + 1).padStart(2, '0')}</span><div>{turn.question.slice(0, 70)}<small>{turn.answer !== undefined ? '已回答' : '待回答'}{turn.reference ? ' · 有参考' : ''}{turn.attempts.length ? ` · ${turn.attempts.length} 次重答` : ''}</small></div></button>) : <p className="muted">生成问题后会在这里保留目录。</p>}</section>
      <section className="panel evidence-panel"><div className="eyebrow">FROZEN EVIDENCE</div><h3>本轮材料</h3><p className="muted">点击答法中的引用编号，定位到本轮实际使用的内容。</p>{session.materials.map((material, index) => <details key={material.id} data-citation={`M${index + 1}`}><summary><span className="citation">M{index + 1}</span>{material.title}<small>v{material.revision}</small></summary><div className="evidence-text">{material.text}</div></details>)}{!session.materials.length && <p className="muted">本轮未选择资料，仅练习一般技术。</p>}</section>
    </aside></div></>;
}
function QuestionPanel({ turn, number, session, disabled, onAnswer, onJob }: {
  turn: Turn; number: number; session: Session; disabled: boolean; onAnswer: (id: string, answer: string) => Promise<boolean>;
  onJob: (kind: Job['input']['kind'], turnId?: string, answer?: string) => Promise<void>;
}) {
  const [answer, setAnswer, warning] = useDraft(`ir-answer-${session.id}-${turn.id}`, '');
  const [retry, setRetry, retryWarning] = useDraft(`ir-retry-${session.id}-${turn.id}`, '');
  const learn = session.status === 'completed' || session.mode === 'coach';
  return <><div className="question-heading"><span className="eyebrow">QUESTION {String(number).padStart(2, '0')}</span><h2>{turn.question}</h2></div>
    {turn.answer === undefined && session.status === 'active' ? <div className="answer-editor"><label htmlFor={`answer-${turn.id}`}>你的回答</label><textarea id={`answer-${turn.id}`} value={answer} maxLength={20000} onChange={event => setAnswer(event.target.value)} placeholder="围绕问题说明你的理解、思路和例子；不确定的地方可以直接说明。" /><div className="answer-footer"><span>{warning || '草稿自动保留，提交后原回答不再覆盖。'}</span><button className="primary" disabled={disabled || !answer.trim()} onClick={async () => { if (await onAnswer(turn.id, answer)) { setAnswer(''); } }}>提交回答</button></div></div>
    : <div className="saved-answer"><span className="eyebrow">YOUR ORIGINAL ANSWER</span><Prose>{turn.answer ?? '本题未作答'}</Prose></div>}
    {learn ? <div className="learning"><div className="section-head"><div><span className="eyebrow">LEARN & RETRY</span><h3>看懂之后，用自己的话再答一次。</h3></div>{!turn.reference && <button disabled={disabled} onClick={() => void onJob('reference', turn.id)}>生成参考答法</button>}</div>
      {turn.reference && <><details className="reference" open><summary>参考答法</summary><Prose>{turn.reference}</Prose></details><label>再次作答<textarea value={retry} maxLength={20000} onChange={event => setRetry(event.target.value)} placeholder="重新组织答案，补上遗漏的原理、依据或例子。" /></label><div className="answer-footer"><span>{retryWarning || (turn.answer === undefined ? '本题没有原回答，不能进行两次回答比较。' : '重答单独保存，不改原回答。')}</span><button className="primary" disabled={disabled || !retry.trim() || turn.answer === undefined} onClick={() => void onJob('compare', turn.id, retry)}>保存并比较</button></div></>}
      {turn.attempts.map((attempt, index) => <details className="attempt" key={attempt.id}><summary>重答 {index + 1} · {time(attempt.createdAt)}</summary><div className="eyebrow">重新组织的回答</div><Prose>{attempt.text}</Prose><div className="eyebrow">改进比较</div><Prose>{attempt.comparison}</Prose></details>)}
    </div> : <p className="strict-note">严格模拟中先独立表达，结束后再解锁参考答法和重答。</p>}</>;
}
function Progress({ sessions, onOpen, onTopic }: { sessions: Session[]; onOpen: (id: string) => void; onTopic: () => void }) {
  const turns = sessions.flatMap(session => session.turns);
  const answered = turns.filter(turn => turn.answer !== undefined).length;
  const attempts = turns.reduce((sum, turn) => sum + turn.attempts.length, 0);
  const reviewed = sessions.filter(session => session.review).length;
  const records = sessions.flatMap(session => [
    ...(session.review ? [{ id: `review-${session.id}`, sessionId: session.id, kind: '本轮复盘', title: session.title, date: session.updatedAt, text: session.review, answer: '' }] : []),
    ...session.turns.flatMap(turn => turn.attempts.map(attempt => ({ id: attempt.id, sessionId: session.id, kind: '重答比较', title: turn.question, date: attempt.createdAt, text: attempt.comparison ?? '本次重答尚无比较结果。', answer: attempt.text }))),
  ]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  return <><PageTitle eyebrow="训练进展" title="能力记录" description="回看真实回答、重答比较与复盘，找到下一轮需要练习的重点。" action={<button className="primary" onClick={onTopic}>开始专项练习 →</button>} />
    <div className="progress-metrics" aria-label="训练统计">{[
      ['已练轮次', sessions.length, '含导入的历史记录'], ['原始回答', answered, '保留当时的独立表达'], ['再次作答', attempts, '与原回答分别保存'], ['已有复盘', reviewed, '按需生成后保留'],
    ].map(([label, value, description]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{description}</small></article>)}</div>
    {sessions.length ? <section className="panel progress-sessions"><div className="section-head"><div><h2>各轮训练记录</h2><p>参考答法 {turns.filter(turn => turn.reference).length} 题 · 统计来自本机已保存内容</p></div></div><div className="table-scroll"><table><thead><tr><th>训练方向</th><th>已答</th><th>参考</th><th>重答</th><th>复盘</th><th><span className="sr-only">查看记录</span></th></tr></thead><tbody>{sessions.map(session => <tr key={session.id}><th scope="row"><span>{session.title}</span><small>{session.focus || '综合面试'} · {time(session.createdAt)}</small></th><td>{session.turns.filter(turn => turn.answer !== undefined).length}</td><td>{session.turns.filter(turn => turn.reference).length}</td><td>{session.turns.reduce((sum, turn) => sum + turn.attempts.length, 0)}</td><td>{session.review ? '已生成' : '待复盘'}</td><td><button onClick={() => onOpen(session.id)}>回看本轮</button></td></tr>)}</tbody></table></div></section>
      : <Empty title="先完成一轮，留下第一份记录" description="提交回答、生成复盘或再次作答后，可以在这里查看。练习重点由你的真实回答决定。" action="选择专项重点" onAction={onTopic} />}
    {records.length > 0 && <section className="panel progress-recent"><div className="section-head"><div><h2>最近的改进记录</h2><p>展示最近 {records.length} 条复盘与重答比较。回到原轮次可查看引用对应的材料。</p></div></div>{records.map(record => <details key={record.id}><summary><span className="tag">{record.kind}</span><span>{record.title}</span><small>{time(record.date)}</small></summary>{record.answer && <><h3>再次作答</h3><Prose citations={false}>{record.answer}</Prose></>}<h3>{record.kind}</h3><Prose citations={false}>{record.text}</Prose><button onClick={() => onOpen(record.sessionId)}>回看原始问答</button></details>)}</section>}
  </>;
}
function SettingsView({ settings, busy, act }: { settings: PublicSettings; busy: boolean; act: Act }) {
  const [tab, setTab] = useState<'models' | 'backup' | 'about'>('models');
  const [importValue, setImportValue] = useState<unknown>(), [preview, setPreview] = useState<ImportPreview | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return <><PageTitle eyebrow="本机工作区" title="模型与设置" description="保存多个国内外模型配置，分别管理协议和 Key。按需测试与启用，面试、答法和复盘沿用你选择的模型。" />
    <div className="session-tabs settings-tabs" role="tablist" aria-label="设置分类">{([['models', '模型连接'], ['backup', '备份与迁移'], ['about', '关于']] as const).map(([key, label]) => <button role="tab" key={key} aria-selected={tab === key} className={tab === key ? 'active-tab' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div className="settings-body" hidden={tab !== 'models'}><ModelSettings settings={settings} busy={busy} act={act} /></div>
    <section className="panel settings-panel backup-panel" hidden={tab !== 'backup'}><div className="section-head"><h2>备份与迁移</h2></div><p className="muted">备份包含私人材料与问答，请放在安全的本机目录。导入先预览，再追加；不覆盖现有记录。</p>
      <div className="button-row"><button onClick={() => void act(async () => { download(`interview-room-${new Date().toISOString().slice(0, 10)}.json`, await api('/export')); return true; }, '备份已导出；API Key 未包含其中')}>导出全部文字记录</button><button onClick={() => input.current?.click()}>选择备份并预览</button><input hidden ref={input} type="file" accept=".json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void act(async () => { if (file.size > 10000000) throw new Error('备份不能超过 10 MB'); const backup = JSON.parse(await file.text()); const result = await api<ImportPreview>('/import/preview', 'POST', { backup }); setImportValue(backup); setPreview(result); return true; }); }} /></div>
      {preview && <div className="import-preview"><h3>导入预览</h3><p>{preview.topics.length} 个领域 · {preview.materials.length} 份资料 · {preview.sessions.length} 轮历史面试 · 跳过 {preview.duplicates} 条已导入记录</p>{preview.warnings.slice(0, 20).map((warning, index) => <p className="muted" key={index}>{warning}</p>)}<button className="primary" disabled={busy} onClick={() => void act(async () => { const result = await api('/import/commit', 'POST', { backup: importValue, fingerprint: preview.fingerprint }); setPreview(null); setImportValue(undefined); return result; }, '历史记录已追加导入，原数据保持不变')}>确认追加导入</button><button className="subtle" onClick={() => { setPreview(null); setImportValue(undefined); }}>取消</button></div>}
    </section><section className="panel about" hidden={tab !== 'about'}><h2>面试练习室 · Interview Room</h2><span>产品设计与维护：xbzz1018</span><p>围绕简历、岗位与 JD 的文字面试练习，支持复盘、参考答法和再次作答。</p><details><summary>软件许可</summary><p>产品代码采用 MIT 许可。基础依赖继续遵循各自许可证，完整信息见项目 LICENSE 与 DEPENDENCIES.md。</p></details></section>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
