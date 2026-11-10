import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { compareAnswer, getTrainingProgress, type TrainingAttempt } from '@/api/interview';
import { readSession } from '@/lib/authSession';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function RetryAnswer({ sessionId, questionId, attempts = [] }: { sessionId: string; questionId: string | number; attempts?: TrainingAttempt[] }) {
  const storageKey = `practice:${readSession()?.user.id || ''}:${sessionId}:${questionId}`;
  const [draft, setDraft] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}') as { text?: string; requestId?: string }; } catch { return {}; } });
  const [saved, setSaved] = useState<TrainingAttempt[]>(attempts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const updateDraft = (value: { text?: string; requestId?: string }) => {
    setDraft(value);
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Session drafts are optional. */ }
  };
  const compare = async () => {
    if (lock.current || !draft.text?.trim()) return;
    lock.current = true; setBusy(true); setError('');
    const requestId = draft.requestId || crypto.randomUUID();
    updateDraft({ ...draft, requestId });
    try {
      const result = await compareAnswer(sessionId, questionId, draft.text, requestId);
      if (!active.current) return;
      setSaved((current) => [...current.filter((item) => item.attempt_id !== result.attempt_id), result]);
      updateDraft({});
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '比较失败，草稿已保留。'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  return <div className="mt-5 border-t border-border pt-4" aria-label="再次作答与对比">
    <h3 className="text-sm font-semibold">再次作答 → 对比改进</h3>
    <p className="my-2 text-xs leading-5 text-dim">先合上参考，用自己的话回答。重答单独保存，不覆盖原回答；受辅助练习不计入模拟面试成绩。</p>
    <Textarea aria-label="再次作答" value={draft.text || ''} maxLength={12000} disabled={busy} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="用 60–90 秒的口述结构再答一次：结论、原因、本人证据、边界。" className="min-h-32" />
    <Button className="mt-3" size="sm" disabled={busy || !draft.text?.trim()} onClick={() => void compare()}>{busy ? '正在对比，记录会保存…' : error ? '重试对比' : '保存并对比'}</Button>
    {error && <p role="alert" className="mt-2 text-sm text-red">{error}</p>}
    {saved.map((attempt, index) => <details key={attempt.attempt_id} open={index === saved.length - 1} className="mt-4 rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">第 {index + 1} 次重答 · {new Date(attempt.created_at).toLocaleString('zh-CN')}</summary>
      <p className="mt-3 whitespace-pre-wrap text-sm">{attempt.answer}</p>
      <div className="md-content mt-3 text-sm"><ReactMarkdown>{attempt.comparison}</ReactMarkdown></div>
      <PracticeGaps attempt={attempt} />
    </details>)}
  </div>;
}

function PracticeGaps({ attempt }: { attempt: TrainingAttempt }) {
  return <div className="mt-3 grid gap-3 sm:grid-cols-2">
    {([['技术缺口', attempt.technical_gaps], ['表达练习', attempt.expression_gaps]] as const).map(([label, gaps]) => <div key={label} className="rounded-lg bg-hover p-3">
      <h4 className="text-xs font-semibold">{label}</h4>
      {!gaps.length && <p className="mt-2 text-xs text-dim">本次没有足够证据记录新缺口。</p>}
      {gaps.map((gap, index) => <div key={index} className="mt-2 text-xs leading-5"><p className="font-medium">{gap.point}</p><p className="text-dim">原话：{gap.evidence}</p><p>下次练法：{gap.exercise}</p></div>)}
    </div>)}
  </div>;
}

export function PracticeProgress() {
  const [items, setItems] = useState<Array<TrainingAttempt & { session_id: string; training_mode: string }>>([]);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; getTrainingProgress().then((value) => { if (active) setItems(value.items); }).catch((cause) => { if (active) setError(cause.message); }); return () => { active = false; }; }, []);
  return <section className="mt-6 rounded-xl border border-border bg-card p-5" aria-label="技术与表达练习记录">
    <h2 className="text-base font-semibold">技术与表达练习记录</h2>
    <p className="mt-1 text-xs leading-5 text-dim">按每次重答保留观察及出处。这里只展示最近练习，不把一次回答变成永久能力标签。</p>
    {error && <p role="alert" className="mt-2 text-sm text-red">{error}</p>}
    {!items.length && !error && <p className="mt-3 text-sm text-dim">完成面试后，在复盘页生成参考答法、再次作答，就会保存到这里。</p>}
    {items.slice(0, 6).map((attempt) => <details key={`${attempt.session_id}:${attempt.attempt_id}`} className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm">{attempt.question} · {new Date(attempt.created_at).toLocaleDateString('zh-CN')}</summary>
      <PracticeGaps attempt={attempt} />
      <Link className="mt-3 inline-block text-xs text-primary" to={`/review/${attempt.session_id}`}>打开原始问答与重答对比</Link>
    </details>)}
  </section>;
}
