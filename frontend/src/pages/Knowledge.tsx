import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import { Menu, X, Sparkles, Upload, ChevronRight, ChevronDown } from "lucide-react";
import { getTopicIcon } from "../utils/topicIcons";
import {
  getTopics, getCoreKnowledge, updateCoreKnowledge, createCoreKnowledge,
  deleteCoreKnowledge, getHighFreq, updateHighFreq, deleteTopic, generateKnowledge,
  uploadKnowledgeDoc,
} from "../api/interview";
import AddTopicDialog from "../components/AddTopicDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { draftStorageStatus, subscribeDraftStorage, captureSavedDraftCleanup, clearKnowledgeDraft, readKnowledgeDraft, saveKnowledgeDraft } from "../lib/knowledgeDrafts";

interface TopicInfo {
  name?: string;
  icon?: string;
}

type Topics = Record<string, TopicInfo>;

interface CoreFile {
  filename: string;
  content: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Knowledge() {
  const [topics, setTopics] = useState<Topics>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"core" | "high_freq">("core");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [coreFiles, setCoreFiles] = useState<CoreFile[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [coreSaving, setCoreSaving] = useState<string | null>(null);
  const [coreEditing, setCoreEditing] = useState<string | null>(null);

  const [highFreq, setHighFreq] = useState("");
  const [highFreqDraft, setHighFreqDraft] = useState("");
  const [hfSaving, setHfSaving] = useState(false);
  const [hfEditing, setHfEditing] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showAddTopic, setShowAddTopic] = useState(false);
  const [loadedTopic, setLoadedTopic] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [topicsError, setTopicsError] = useState("");
  const [reload, setReload] = useState(0);
  const storageNotice = useSyncExternalStore(subscribeDraftStorage, draftStorageStatus);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [coreSaved, setCoreSaved] = useState<string | null>(null);
  const [hfSaved, setHfSaved] = useState(false);
  // A generation also distinguishes A -> B -> A from the original A view.
  const viewRef = useRef(0);
  const topicRef = useRef<string | null>(null);

  const resetView = () => {
    setLoadedTopic(null); setLoadError(""); setCoreSaving(null); setHfSaving(false);
    setCoreSaved(null); setHfSaved(false); setDraftWarning("");
    setShowNewFile(false); setNewFileName("");
  };
  const selectTopic = (topic: string | null) => {
    if (topic === selected) return;
    resetView(); setSelected(topic);
  };
  const retryLoad = () => { resetView(); setReload(value => value + 1); };

  const refreshTopics = useCallback(async () => {
    const t = (await getTopics()) as unknown as Topics;
    setTopics(t);
    return t;
  }, []);

  useEffect(() => {
    let active = true;
    getTopics()
      .then((data) => {
        if (!active) return;
        const nextTopics = data as unknown as Topics;
        setTopicsError(""); setTopics(nextTopics);
        const keys = Object.keys(nextTopics);
        setSelected((current) => current && nextTopics[current] ? current : (keys[0] ?? null));
      })
      .catch(error => { if (active) setTopicsError(errorMessage(error)); });
    return () => { active = false; };
  }, [reload]);

  const restoreCore = useCallback((topic: string, files: CoreFile[]) => {
    const drafts = files.map(file => ({ file, draft: readKnowledgeDraft(topic, "core", file.filename) }));
    const restored = drafts.find(({ file, draft }) => draft && draft.content !== file.content);
    setCoreFiles(files);
    setExpandedFile(restored?.file.filename ?? files[0]?.filename ?? null);
    setCoreEditing(restored?.file.filename ?? null);
    setEditContent(Object.fromEntries(drafts.map(({ file, draft }) => [file.filename, draft?.content ?? file.content])));
    const conflict = drafts.some(({ file, draft }) => draft && draft.content !== file.content && draft.base !== file.content);
    setDraftNotice(conflict ? "已恢复本机草稿，但服务器内容已变化。保存前请核对；取消可恢复服务器版本。" : restored ? "已恢复本机草稿。点击保存后才会用于训练与检索。" : "");
  }, []);

  const loadCore = useCallback(async (topic: string, view: number) => {
    const files = (await getCoreKnowledge(topic)) as unknown as CoreFile[];
    if (viewRef.current !== view || topicRef.current !== topic) return;
    restoreCore(topic, files);
  }, [restoreCore]);

  useEffect(() => {
    const view = ++viewRef.current;
    topicRef.current = selected;
    if (!selected) return;
    let active = true;
    Promise.all([getCoreKnowledge(selected), getHighFreq(selected)])
      .then(([filesData, highFreqData]) => {
        if (!active || viewRef.current !== view) return;
        restoreCore(selected, filesData as unknown as CoreFile[]);
        const content = (highFreqData as unknown as { content?: string | null }).content || "";
        const draft = readKnowledgeDraft(selected, "high_freq");
        const restored = Boolean(draft && draft.content !== content);
        setHighFreq(content); setHighFreqDraft(draft?.content ?? content); setHfEditing(restored);
        if (restored) setDraftNotice(previous => draft!.base !== content ? "已恢复本机草稿，但服务器内容已变化。保存前请核对；取消可恢复服务器版本。" : previous || "已恢复本机草稿。点击保存后才会用于训练与检索。");
        setLoadedTopic(selected);
      })
      .catch(error => { if (active && viewRef.current === view) setLoadError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, reload, restoreCore]);

  const editCore = (filename: string, content: string) => {
    if (!selected) return;
    setEditContent(previous => ({ ...previous, [filename]: content }));
    setCoreSaved(null);
    const saved = coreFiles.find(file => file.filename === filename)?.content ?? "";
    // Keep the original base after recovering a draft against a newer server version.
    const base = readKnowledgeDraft(selected, "core", filename)?.base ?? saved;
    if (!saveKnowledgeDraft(selected, "core", filename, base, content)) setDraftWarning("草稿暂存失败，请保持页面打开并保存，或先复制内容备份。");
    else { setDraftWarning(""); if (base === saved) setDraftNotice(content !== saved ? "当前为本机草稿，可在正常重启后恢复；点击保存后用于训练与检索。" : ""); }
  };

  const editHighFreq = (content: string) => {
    if (!selected) return;
    setHighFreqDraft(content); setHfSaved(false);
    const base = readKnowledgeDraft(selected, "high_freq")?.base ?? highFreq;
    if (!saveKnowledgeDraft(selected, "high_freq", "", base, content)) setDraftWarning("草稿暂存失败，请保持页面打开并保存，或先复制内容备份。");
    else { setDraftWarning(""); if (base === highFreq) setDraftNotice(content !== highFreq ? "当前为本机草稿，可在正常重启后恢复；点击保存后用于训练与检索。" : ""); }
  };

  const handleSaveCore = async (filename: string) => {
    if (!selected || coreSaving) return;
    const topic = selected, view = viewRef.current, content = editContent[filename] ?? "";
    const saved = coreFiles.find(file => file.filename === filename)?.content;
    const draft = readKnowledgeDraft(topic, "core", filename);
    if (draft && draft.base !== saved && !confirm("服务器内容已变化，确定用当前草稿覆盖吗？取消编辑可查看服务器版本。")) return;
    const discardSavedDraft = captureSavedDraftCleanup(topic, "core", filename, content);
    setCoreSaving(filename);
    try {
      await updateCoreKnowledge(topic, filename, content);
      discardSavedDraft();
      if (viewRef.current !== view) return;
      setCoreFiles(previous => previous.map(file => file.filename === filename ? { ...file, content } : file));
      setCoreEditing(null); setCoreSaved(filename); setDraftNotice("");
    } catch (error) { alert("保存失败: " + errorMessage(error)); }
    finally { if (viewRef.current === view) setCoreSaving(null); }
  };

  const handleSaveHighFreq = async () => {
    if (!selected || hfSaving) return;
    const topic = selected, view = viewRef.current, content = highFreqDraft;
    const draft = readKnowledgeDraft(topic, "high_freq");
    if (draft && draft.base !== highFreq && !confirm("服务器内容已变化，确定用当前草稿覆盖吗？取消编辑可查看服务器版本。")) return;
    const discardSavedDraft = captureSavedDraftCleanup(topic, "high_freq", "", content);
    setHfSaving(true);
    try {
      await updateHighFreq(topic, content);
      discardSavedDraft();
      if (viewRef.current !== view) return;
      setHighFreq(content); setHfEditing(false); setHfSaved(true); setDraftNotice("");
    } catch (error) { alert("保存失败: " + errorMessage(error)); }
    finally { if (viewRef.current === view) setHfSaving(false); }
  };

  const handleCreateFile = async () => {
    if (!selected) return;
    const topic = selected, view = viewRef.current, name = newFileName.trim();
    if (!name) return;
    try {
      await createCoreKnowledge(topic, name.endsWith(".md") ? name : name + ".md", "");
      if (viewRef.current !== view) return;
      setNewFileName(""); setShowNewFile(false);
      await loadCore(topic, view);
    } catch (error) { alert("创建失败: " + errorMessage(error)); }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!selected || !confirm(`确定删除「${filename}」？此操作不可撤销。`)) return;
    const topic = selected, view = viewRef.current;
    try {
      await deleteCoreKnowledge(topic, filename);
      clearKnowledgeDraft(topic, "core", filename);
      if (viewRef.current !== view) return;
      setCoreFiles(previous => previous.filter(file => file.filename !== filename));
      if (expandedFile === filename) setExpandedFile(null);
    } catch (error) { alert("删除失败: " + errorMessage(error)); }
  };

  const handleUploadFiles = async (files: File[]) => {
    if (!selected || files.length === 0) return;
    const topic = selected, view = viewRef.current;
    setUploading(true);
    const failed: string[] = [];
    let lastUploaded: string | null = null;
    try {
      for (const file of files) {
        try { lastUploaded = ((await uploadKnowledgeDoc(topic, file)) as unknown as { filename: string }).filename; }
        catch (error) { failed.push(`${file.name}: ${errorMessage(error)}`); }
      }
      await loadCore(topic, view);
      if (viewRef.current === view && lastUploaded) setExpandedFile(lastUploaded);
      if (failed.length) alert("以下文件导入失败:\n" + failed.join("\n"));
    } catch (error) { alert("刷新失败: " + errorMessage(error)); }
    finally { setUploading(false); }
  };

  const handleGenerate = async () => {
    if (!selected) return;
    const topic = selected, view = viewRef.current;
    setGenerating(true);
    try {
      await generateKnowledge(topic);
      await loadCore(topic, view);
      if (viewRef.current === view) setExpandedFile("README.md");
    } catch (error) { alert("生成失败: " + errorMessage(error)); }
    finally { setGenerating(false); }
  };

  const coreIsEmpty = coreFiles.length === 0 ||
    (coreFiles.length === 1 && coreFiles[0].filename === "README.md" && (coreFiles[0].content?.length || 0) <= 20);

  const handleTopicCreated = async (key: string) => {
    await refreshTopics();
    selectTopic(key);
  };

  const handleDeleteTopic = async (key: string) => {
    if (!confirm(`确定删除「${topics[key]?.name || key}」？`)) return;
    try {
      await deleteTopic(key);
      const t = await refreshTopics();
      const keys = Object.keys(t);
      if (topicRef.current === key) selectTopic(keys.length > 0 ? keys[0] : null);
    } catch (e) { alert("删除失败: " + errorMessage(e)); }
  };

  const topicKeys = Object.keys(topics);

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      <Button
        variant="gradient"
        size="icon"
        className="fixed bottom-4 right-4 z-40 md:hidden rounded-full w-12 h-12"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </Button>

      <div className={cn(
        "fixed inset-y-0 left-0 z-30 w-[200px] border-r border-border bg-bg p-4 flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:shrink-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex justify-between items-center mb-3 px-2">
          <div className="text-[13px] font-semibold text-dim">专项领域</div>
          <Button variant="ghost" size="icon" className="w-6 h-6 text-base" title="新增领域" onClick={() => setShowAddTopic(true)}>+</Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {topicKeys.map((key) => (
            <div key={key} className="relative mb-0.5 group">
              <button
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg text-sm text-left flex items-center gap-2 transition-all cursor-pointer",
                  selected === key ? "bg-hover text-text" : "text-dim hover:bg-hover"
                )}
                onClick={() => { selectTopic(key); setSidebarOpen(false); }}
              >
                <span className="text-dim">{getTopicIcon(topics[key]?.icon, 16)}</span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{topics[key]?.name || key}</span>
              </button>
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-dim text-sm px-1.5 py-1 rounded opacity-0 group-hover:opacity-100 hover:text-red hover:bg-red/10 transition-all cursor-pointer"
                title="删除领域"
                onClick={() => handleDeleteTopic(key)}
              ><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <AddTopicDialog
        open={showAddTopic}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-border px-4 md:px-6 bg-card">
          {(["core", "high_freq"] as const).map((t) => (
            <button
              key={t}
              className={cn(
                "px-4 py-3 md:px-5 text-sm border-b-2 transition-all cursor-pointer",
                tab === t ? "text-text border-b-primary font-medium" : "text-dim border-b-transparent hover:text-text"
              )}
              onClick={() => setTab(t)}
            >
              {t === "core" ? "核心知识库" : "高频题库"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {loadedTopic === selected && (storageNotice || draftWarning || draftNotice) && <p role="status" className="mb-3 text-sm text-dim">{storageNotice || draftWarning || draftNotice}</p>}
          {!selected ? (
            <div className="text-center py-15 text-dim text-sm">
              {topicsError ? <div role="alert"><p>加载失败：{topicsError}</p><Button variant="outline" size="sm" className="mt-3" onClick={retryLoad}>重新加载</Button></div> : "选择一个领域"}
            </div>
          ) : loadedTopic !== selected ? (
            <div role={loadError ? "alert" : "status"} className="py-10 text-center text-sm text-dim">
              {loadError ? <><p>加载失败：{loadError}</p><Button variant="outline" size="sm" className="mt-3" onClick={retryLoad}>重新加载</Button></> : "正在加载知识库…"}
            </div>
          ) : tab === "core" ? (
            <div>
              <div className="text-[13px] text-dim mb-3">
                AI 出题和评分的参考依据，编辑后影响该领域的题目质量。支持 Markdown 编辑，也可导入 md / txt / pdf / docx 文档。
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt,.pdf,.docx"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = "";
                  handleUploadFiles(files);
                }}
              />
              <div className="flex gap-2 mb-4">
                {showNewFile ? (
                  <div className="flex gap-2 flex-1">
                    <Input className="flex-1" placeholder="文件名 (例: 装饰器.md)" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateFile()} />
                    <Button variant="gradient" size="sm" onClick={handleCreateFile}>创建</Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowNewFile(false); setNewFileName(""); }}>取消</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowNewFile(true)}>+ 新增文件</Button>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? "导入中..." : <><Upload size={14} /> 导入文档</>}
                    </Button>
                    {coreIsEmpty && (
                      <Button variant="outline" size="sm" className="border-primary/40 text-primary" onClick={handleGenerate} disabled={generating}>
                        {generating ? "正在生成..." : <><Sparkles size={14} /> AI 生成基础内容</>}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {coreFiles.length === 0 ? (
                <div className="text-center py-15 text-dim text-sm">该领域暂无知识文件</div>
              ) : (
                <div className="flex flex-col gap-3 stagger-children">
                  {coreFiles.map((f) => (
                    <Card key={f.filename} className="overflow-hidden">
                      <div
                        className="flex justify-between items-center px-4 py-3 cursor-pointer text-sm font-medium hover:bg-hover/50 transition-colors"
                        onClick={() => { setExpandedFile(expandedFile === f.filename ? null : f.filename); setCoreEditing(null); }}
                      >
                        <span>{f.filename}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-dim flex items-center gap-1">{expandedFile === f.filename ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {(f.content?.length || 0)} 字</span>
                          <button
                            className="text-dim cursor-pointer p-1 rounded opacity-50 hover:text-red hover:opacity-100 transition-all"
                            title="删除文件"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.filename); }}
                          ><X size={14} /></button>
                        </div>
                      </div>
                      {expandedFile === f.filename && (
                        <div className="border-t border-border p-4 animate-fade-in">
                          {coreEditing === f.filename ? (
                            <>
                              <textarea
                                className="w-full min-h-[300px] p-3 rounded-lg border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                                value={editContent[f.filename] ?? f.content}
                                onChange={(e) => editCore(f.filename, e.target.value)}
                                disabled={coreSaving === f.filename}
                                aria-label="知识内容"
                                autoFocus
                              />
                              <div className="flex gap-2 mt-3 justify-end">
                                <Button variant="outline" size="sm" disabled={coreSaving === f.filename} onClick={() => { clearKnowledgeDraft(selected, "core", f.filename); setEditContent((prev) => ({ ...prev, [f.filename]: f.content })); setCoreEditing(null); setDraftNotice(""); }}>取消</Button>
                                <Button variant="gradient" size="sm" disabled={Boolean(coreSaving)} onClick={() => handleSaveCore(f.filename)}>{coreSaving === f.filename ? "保存中…" : "保存"}</Button>
                              </div>
                            </>
                          ) : (
                            <>
                              {(editContent[f.filename] ?? f.content)?.trim() ? (
                                <div className="md-content text-sm leading-6 text-text">
                                  <ReactMarkdown>{editContent[f.filename] ?? f.content}</ReactMarkdown>
                                </div>
                              ) : (
                                <div className="text-dim text-sm py-6 text-center">空文件，点「编辑」添加内容</div>
                              )}
                              <div className="flex gap-2 mt-3 justify-end items-center">
                                {coreSaved === f.filename && <span className="text-xs text-green mr-1">已保存</span>}
                                <Button variant="outline" size="sm" onClick={() => setCoreEditing(f.filename)}>编辑</Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[13px] text-dim mb-3">
                标记的高频面试考点，出题时会优先覆盖。建议一行一题，或一个「##」标题一题，方便出题精准覆盖。
              </div>
              {hfEditing ? (
                <>
                  <textarea
                    className="w-full min-h-[500px] p-3 rounded-xl border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                    value={highFreqDraft}
                    onChange={(e) => editHighFreq(e.target.value)}
                    disabled={hfSaving}
                    aria-label="高频题内容"
                    placeholder={"# 高频题\n\n## 1. xxx原理是什么？为什么这样设计？\n\n## 2. 实际项目中遇到xxx问题怎么解决？"}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3 justify-end">
                    {hfSaved && <span className="text-xs text-green self-center mr-3">已保存</span>}
                    {highFreqDraft !== highFreq && (
                      <Button variant="outline" size="sm" disabled={hfSaving} onClick={() => { clearKnowledgeDraft(selected, "high_freq"); setHighFreqDraft(highFreq); setDraftNotice(""); }}>撤销修改</Button>
                    )}
                    <Button variant="outline" size="sm" disabled={hfSaving} onClick={() => { clearKnowledgeDraft(selected, "high_freq"); setHighFreqDraft(highFreq); setHfEditing(false); setDraftNotice(""); }}>取消</Button>
                    <Button variant="gradient" size="sm" onClick={handleSaveHighFreq} disabled={hfSaving || highFreqDraft === highFreq}>{hfSaving ? "保存中…" : "保存"}</Button>
                  </div>
                </>
              ) : (
                <>
                  {highFreq.trim() ? (
                    <div className="md-content text-sm leading-6 text-text rounded-xl border border-border bg-bg p-4">
                      <ReactMarkdown>{highFreq}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-dim text-sm py-10 text-center rounded-xl border border-border bg-bg">暂无高频题，点「编辑」添加</div>
                  )}
                  <div className="flex gap-2 mt-3 justify-end items-center">
                    {hfSaved && <span className="text-xs text-green mr-1">已保存</span>}
                    <Button variant="outline" size="sm" onClick={() => setHfEditing(true)}>编辑</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
