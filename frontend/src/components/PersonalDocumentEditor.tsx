import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { getDocument, updateDocument, replaceDocument, type DocumentItem } from '@/api/personalAgent';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function PersonalDocumentEditor({ documentId, onSaved, onClose }: { documentId: string; onSaved: (document: DocumentItem) => void; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getDocument>> | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    getDocument(documentId).then((value) => { if (active.current) { setDetail(value); setContent(value.content); } }).catch((cause) => { if (active.current) setError(cause.message); });
    return () => { active.current = false; };
  }, [documentId]);

  const save = async (file?: File) => {
    if (!detail?.document.revision || busy) return;
    setBusy(true); setError('');
    try {
      const document = file ? await replaceDocument(documentId, file, detail.document.revision) : await updateDocument(documentId, { content, revision: detail.document.revision });
      if (active.current) { onSaved(document); onClose(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '保存失败，草稿仍保留，请重试。'); }
    finally { if (active.current) setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(92vw,900px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <Dialog.Title className="font-semibold">{detail?.document.filename || '资料预览与编辑'}</Dialog.Title>
        <Dialog.Description className="text-sm text-dim">文本资料可直接编辑；PDF/Office 可预览提取文本或替换文件。保存后用于下一轮面试，已开始的面试保留原材料。</Dialog.Description>
        {!detail ? <p className="text-sm text-dim">{error ? '资料读取失败' : '正在读取资料…'}</p> : <>
          <Textarea aria-label="资料内容" className="min-h-[45vh] resize-y font-mono text-sm" readOnly={!detail.editable || busy} maxLength={600000} value={content} onChange={(event) => setContent(event.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            {detail.editable && <Button disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? '正在保存与索引…' : '保存资料'}</Button>}
            <label className="text-sm text-dim">替换文件 <input aria-label="替换资料文件" type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save(file); }} /></label>
          </div>
        </>}
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <Button variant="outline" disabled={busy} onClick={onClose}>关闭</Button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
