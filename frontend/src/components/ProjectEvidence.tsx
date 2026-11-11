import { useEffect, useState } from 'react';
import { getEvidenceProjects, importEvidenceProject, type EvidenceHit, type EvidenceProjectSummary } from '@/api/projectEvidence';

export function ProjectEvidencePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [projects, setProjects] = useState<EvidenceProjectSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let current = true;
    void getEvidenceProjects().then(data => { if (current) { setProjects(data.items); setError(''); } }).catch(error => { if (current) setError(String(error.message)); });
    return () => { current = false; };
  }, [reload]);
  return <fieldset className="mt-4 border-t border-border/60 pt-4" aria-label="项目源码与题卡">
    <legend className="text-sm font-medium">项目源码与题卡</legend>
    <p className="mt-1 text-xs leading-5 text-dim">选中后冻结项目版本；生成参考答法时，会将相关片段发送到你配置的模型。未勾选的项目不会参与。</p>
    {projects.map(project => <label key={project.project_id} className="flex items-start gap-3 border-b border-border/60 py-3 text-sm last:border-0">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={selected.includes(project.project_id)} disabled={!selected.includes(project.project_id) && selected.length >= 6} onChange={event => onChange(event.target.checked ? [...selected, project.project_id] : selected.filter(id => id !== project.project_id))} />
      <span className="min-w-0 break-words">{project.name}<span className="mt-1 block text-xs text-dim">{project.source_count} 份来源 · 版本 {project.version.slice(0, 8)}</span></span>
    </label>)}
    {!projects.length && !error && <p className="mt-2 text-xs text-dim">暂无项目证据，可导入已整理的项目快照 JSON。</p>}
    <label className="mt-3 inline-flex cursor-pointer rounded-md border border-border px-3 py-2 text-xs">{busy ? '正在导入…' : '导入项目快照 JSON'}<input aria-label="导入项目快照" type="file" accept=".json" className="sr-only" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      setBusy(true); setError(''); setNotice('');
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('项目快照不能超过 2 MB。');
        const imported = await importEvidenceProject(JSON.parse(await file.text()));
        setNotice(`已导入 ${imported.name}。勾选后用于新一轮面试。`); setReload(value => value + 1);
      } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { setBusy(false); }
    }} /></label>
    {notice && <p role="status" className="mt-2 text-xs text-dim">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red">{error}<button type="button" className="ml-2 underline" onClick={() => setReload(value => value + 1)}>重新加载</button></p>}
  </fieldset>;
}

export function ReferenceEvidence({ sources }: { sources?: EvidenceHit[] }) {
  if (!sources?.length) return null;
  return <section aria-label="参考答法的源码依据" className="mt-4 space-y-2">
    <h4 className="text-sm font-medium">本轮引用依据</h4>
    {sources.map(source => <details key={source.citation_id} className="rounded-lg border border-border p-3 text-xs">
      <summary className="cursor-pointer break-words leading-5">[{source.citation_id}] {source.project_name} · {source.path}:{source.start_line}–{source.end_line}</summary>
      <p className="mt-2 leading-5 text-dim">{source.kind_label}{source.notes ? `；${source.notes}` : ''}</p>
      <p className="mt-1 break-all leading-5 text-dim">快照 {source.version.slice(0, 12)} · 文件 SHA256 {source.sha256.slice(0, 12)} · {source.revision || '未提供提交版本'}</p>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-hover p-3 text-xs leading-6">{source.text}</pre>
    </details>)}
  </section>;
}
