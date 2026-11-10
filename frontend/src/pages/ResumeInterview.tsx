import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  History,
  Loader2,
  MessageCircle,
  Play,
  Sparkles,
} from "lucide-react";
import { getHistory, getProfile, getResumeStatus, inferTargetRole, startInterview } from "../api/interview";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getDocuments, type DocumentItem } from '@/api/personalAgent';
import { PracticeProgress } from '@/components/InterviewPractice';
import useTaskStatus from "../hooks/useTaskStatus";

const INTERVIEW_STEPS = [
  { title: "自我介绍", desc: "建立候选人画像" },
  { title: "项目深挖", desc: "围绕真实经历动态追问" },
  { title: "能力考察", desc: "结合岗位要求探测边界" },
  { title: "总结反馈", desc: "生成评分与改进建议" },
];

interface ResumeInterviewProps {
  embedded?: boolean;
}

interface ResumeFile {
  filename: string;
  size: number;
}

interface ResumeStatus {
  has_resume: boolean;
  filename?: string;
  size?: number;
}

interface ProfileResponse {
  target_role?: string;
}

interface HistorySession {
  session_id: string;
  status?: string;
  created_at?: string;
  avg_score?: number;
}

interface HistoryResponse {
  items?: HistorySession[];
}

interface StartInterviewResponse {
  session_id: string;
  [key: string]: unknown;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ScorePill({ score }: { score?: number | null }) {
  if (score == null) {
    return (
      <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
        未评分
      </Badge>
    );
  }
  const tone = score >= 8
    ? "border-green/20 bg-green/10 text-green"
    : score >= 6
      ? "border-primary/20 bg-primary/10 text-primary"
      : score >= 4
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : "border-red/20 bg-red/10 text-red";
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", tone)}>
      {score}/10
    </Badge>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function ResumeInterview({ embedded = false }: ResumeInterviewProps) {
  const navigate = useNavigate();
  const [resumeFile, setResumeFile] = useState<ResumeFile | null>(null);
  const [resumeSelected, setResumeSelected] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [targetRole, setTargetRole] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [resumeDocumentId, setResumeDocumentId] = useState('');
  const [jdDocumentId, setJdDocumentId] = useState('');
  const [trainingMode, setTrainingMode] = useState<'strict' | 'coach'>('strict');
  const [materialError, setMaterialError] = useState('');
  const [jobDescription, setJobDescription] = useState("");
  const [jdOpen, setJdOpen] = useState(false);
  const [targetRoleInferring, setTargetRoleInferring] = useState(false);
  const { creatingSessionMode, setCreatingSessionMode } = useTaskStatus();
  const loading = creatingSessionMode === "resume";
  const hasMaterials = Boolean((resumeFile && resumeSelected) || resumeDocumentId || materialIds.length);
  const ready = Boolean(hasMaterials && targetRole.trim() && !targetRoleInferring);

  const autoInferRole = async () => {
    setTargetRoleInferring(true);
    try {
      const { target_role } = (await inferTargetRole()) as { target_role?: string };
      if (target_role) setTargetRole(target_role);
    } catch {
      // 用户仍可手动输入岗位，推断失败不阻断页面。
    } finally {
      setTargetRoleInferring(false);
    }
  };

  useEffect(() => {
    Promise.all([
      getResumeStatus().catch(() => ({ has_resume: false })),
      getProfile().catch(() => ({})),
    ]).then(([statusResponse, profileResponse]) => {
      const status = statusResponse as ResumeStatus;
      const profile = profileResponse as ProfileResponse;
      if (status.has_resume) {
        setResumeFile({
          filename: status.filename || "resume.pdf",
          size: status.size || 0,
        });
        setResumeSelected(true);
      }
      const existingRole = (profile.target_role || "").trim();
      if (existingRole) {
        setTargetRole(existingRole);
      } else if (status.has_resume) {
        void autoInferRole();
      }
    }).finally(() => setPageLoading(false));

    getDocuments().then((data) => setDocuments(data.items.filter((item) => item.status === 'ready'))).catch((error) => setMaterialError(error.message));
    getHistory(3, 0, "resume")
      .then((data) => setHistory((data as HistoryResponse).items || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  const handleStart = async () => {
    if (!ready) return;
    setCreatingSessionMode("resume");
    try {
      const data = (await startInterview("resume", null, {
        targetRole: targetRole.trim(),
        trainingMode,
        materialDocumentIds: materialIds,
        resumeDocumentId: resumeDocumentId || undefined,
        jdDocumentId: jdDocumentId || undefined,
        useResume: resumeSelected && !resumeDocumentId,
        jobDescription: jobDescription.trim() || undefined,
      })) as StartInterviewResponse;
      navigate(`/interview/${data.session_id}`, { state: data });
    } catch (error) {
      alert("启动失败: " + errorMessage(error));
    } finally {
      setCreatingSessionMode(null);
    }
  };

  return (
    <div className={cn(
      "personal-preparation w-full animate-in fade-in duration-300",
      embedded ? "pb-10 pt-4" : "mx-auto max-w-[1180px] px-4 py-8 md:px-7 xl:px-8"
    )}>
      {!embedded && (
        <header className="mb-6">
          <h1 className="text-3xl font-display font-bold tracking-tight text-text">实时模拟</h1>
          <p className="mt-2 text-sm leading-6 text-dim">补充面试资料，开始一轮会根据回答动态追问的完整模拟。</p>
        </header>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="personal-preparation-sheet overflow-hidden border-border bg-card shadow-none">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col gap-2 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text">准备这一轮</h2>
                  <p className="mt-1 text-[13px] leading-5 text-dim">选择简历或项目资料，再确认本轮要练的岗位。</p>
                </div>
              </div>
              <Badge variant={hasMaterials ? "success" : "secondary"} className="self-start rounded-full">
                {hasMaterials ? "已选择材料" : "请选择材料"}
              </Badge>
            </div>

            <section className="pt-5">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <label className="text-[13px] font-semibold text-text">本次面试简历</label>
                <button
                  type="button"
                  onClick={() => navigate("/resume-manager")}
                  className="flex items-center gap-1 text-[12px] font-medium text-dim transition-colors hover:text-primary"
                >
                  简历管理 <ArrowUpRight size={13} />
                </button>
              </div>

              {pageLoading ? (
                <Skeleton className="h-[104px] w-full rounded-2xl" />
              ) : resumeFile ? (
                <label className={cn(
                  "flex cursor-pointer items-center gap-3.5 rounded-lg border p-4 transition-colors",
                  resumeSelected
                    ? "border-primary/35 bg-primary/5"
                    : "border-border bg-background/45 hover:border-primary/25"
                )}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={resumeSelected}
                    onChange={(event) => setResumeSelected(event.target.checked)}
                  />
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card text-primary">
                    <FileText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">{resumeFile.filename}</div>
                    <div className="mt-1 text-[12px] text-dim">
                      {(resumeFile.size / 1024).toFixed(0)} KB · {resumeSelected ? "用于本次面试" : "未选中"}
                    </div>
                  </div>
                  <CheckCircle2 size={18} className={resumeSelected ? "text-primary" : "text-dim/40"} />
                </label>
              ) : (
                <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-border/80 bg-background/35 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-text">还没有面试简历</div>
                    <div className="mt-1 text-[12px] leading-5 text-dim">可上传 PDF，也可在下方选择资料库里的简历或项目说明。</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate("/resume-manager")}>
                    上传简历
                  </Button>
                </div>
              )}
            </section>

            <section className="mt-5 border-t border-border/60 pt-5" aria-label="本轮材料与模式">
              <h3 className="text-sm font-semibold">项目资料与训练方式</h3>
              <p className="mt-1 text-xs leading-5 text-dim">本轮使用的资料会保留版本，之后修改不影响这次面试。</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">训练模式<select aria-label="训练模式" value={trainingMode} onChange={(event) => setTrainingMode(event.target.value as 'strict' | 'coach')} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"><option value="strict">严格模拟 · 面试中不提示答案</option><option value="coach">教练练习 · 可请求提示与讲解</option></select></label>
                <label className="text-sm">简历版本<select aria-label="简历版本" value={resumeDocumentId} onChange={(event) => setResumeDocumentId(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"><option value="">使用上方勾选的简历</option>{documents.map((item) => <option key={item.document_id} value={item.document_id}>{item.filename}</option>)}</select></label>
                <label className="text-sm sm:col-span-2">JD 资料<select aria-label="JD 资料" value={jdDocumentId} onChange={(event) => setJdDocumentId(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"><option value="">仅使用下方填写的 JD</option>{documents.map((item) => <option key={item.document_id} value={item.document_id}>{item.filename}</option>)}</select></label>
              </div>
              <fieldset className="mt-4"><legend className="text-sm font-medium">项目说明 / 练习资料</legend>
                {documents.filter((item) => ![resumeDocumentId, jdDocumentId].includes(item.document_id)).map((item) => <label key={item.document_id} className="flex cursor-pointer items-center gap-3 border-b border-border/60 py-3 text-sm last:border-0"><input type="checkbox" className="h-4 w-4 shrink-0" checked={materialIds.includes(item.document_id)} onChange={(event) => setMaterialIds((current) => event.target.checked ? [...current, item.document_id] : current.filter((id) => id !== item.document_id))} /><span className="min-w-0 break-all">{item.filename}</span></label>)}
                {!documents.length && !materialError && <p className="mt-2 text-xs leading-6 text-dim">还没有项目说明，可先到资料库添加，再回来选择。</p>}
              </fieldset>
              {materialError && <p role="alert" className="mt-2 text-xs text-red">资料库读取失败：{materialError}</p>}
              <Button variant="link" size="sm" onClick={() => navigate('/personal-agent')}>管理、编辑与替换资料</Button>
              <p className="mt-2 text-xs text-dim">{trainingMode === 'coach' ? '主动说“给我一个提示”或“讲解后让我重答”。练习观察会保留，受帮助的回答不进入独立作答分数趋势。' : '面试中只提问，不展示参考答法。结束后查看复盘，再进行重答练习。'}</p>
            </section>

            <section className="mt-5 border-t border-border/60 pt-5">
              <div className="mb-2.5 flex items-center gap-2">
                <Briefcase size={14} className="text-dim" />
                <label className="text-[13px] font-semibold text-text">本次面试目标岗位</label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value)}
                  placeholder={targetRoleInferring ? "正在根据简历推断..." : "如：AI 应用开发工程师"}
                  disabled={targetRoleInferring}
                  className="h-11 flex-1 rounded-xl bg-background/55"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl"
                  disabled={!resumeFile || targetRoleInferring}
                  onClick={autoInferRole}
                  title="根据简历推断岗位"
                >
                  {targetRoleInferring ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                </Button>
              </div>
            </section>

            <section className="mt-5 border-t border-border/60 pt-5">
              <button type="button" aria-expanded={jdOpen} aria-controls="interview-jd-editor" onClick={() => setJdOpen(open => !open)} className="flex w-full items-center justify-between gap-3 text-left text-sm text-dim hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="font-medium">{jobDescription ? '已填写目标岗位 JD' : '补充目标岗位 JD'}<span className="ml-2 text-xs font-normal">选填</span></span><ChevronRight size={16} className={cn('shrink-0 transition-transform', jdOpen && 'rotate-90')} />
              </button>
              <div id="interview-jd-editor" hidden={!jdOpen}>
              <div className="mb-2.5 mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <label className="text-[13px] font-semibold text-text">目标岗位 JD</label>
                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">选填</Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-dim">粘贴职责、要求和技术栈，追问会更贴近真实岗位。</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-dim">{jobDescription.length} 字</span>
              </div>
              <Textarea
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                maxLength={12000}
                placeholder="粘贴完整 JD，包括岗位职责、任职要求、业务背景和加分项。"
                className="min-h-[140px] resize-y rounded-lg bg-background/55 px-4 py-3.5 leading-6"
              />
              </div>
            </section>
          </CardContent>
        </Card>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="personal-note mb-5 rounded-lg px-6 py-6">
            <p className="personal-note-muted text-xs">这一轮，只专注一件事</p>
            <h2 className="mt-4 text-[23px] font-medium leading-relaxed">把真实经历<br />讲出自己的判断。</h2>
            <p className="personal-note-muted mt-5 text-xs leading-6">先回答 → 看复盘 → 再重答</p>
          </div>
          <Card className="overflow-hidden border-border bg-card shadow-none">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/70">实时模拟</div>
                  <h2 className="mt-1 text-lg font-semibold text-text">本轮面试流程</h2>
                </div>
                <Badge variant={ready ? "success" : "secondary"} className="rounded-full">
                  {ready ? "可以开始" : "待完善"}
                </Badge>
              </div>

              <div className="mt-5 space-y-2.5">
                {INTERVIEW_STEPS.map((step, index) => (
                  <div key={step.title} className="flex items-start gap-3 border-b border-border/70 py-3 last:border-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text">{step.title}</div>
                      <div className="mt-0.5 text-[12px] leading-5 text-dim">{step.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-border/65 pt-5">
                <Button
                  variant="gradient"
                  size="lg"
                  className="h-11 w-full rounded-lg font-semibold"
                  disabled={!ready || loading}
                  onClick={handleStart}
                >
                  {loading ? (
                    <><Loader2 size={17} className="animate-spin" /> 正在创建面试...</>
                  ) : (
                    <><Play size={17} className="fill-current" /> 开始实时模拟</>
                  )}
                </Button>
                <p className="mt-2.5 text-center text-[11px] leading-5 text-dim">
                  开始前请确认简历和目标岗位信息准确。
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <PracticeProgress />

      <Card className="mt-5 border-border/80 bg-card/55">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-dim">
                <History size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-text">最近面试</h2>
                <p className="mt-0.5 text-[11px] text-dim">继续未完成的面试，或查看最近复盘。</p>
              </div>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => navigate("/history")}
                className="flex items-center gap-1 text-[12px] font-medium text-dim transition-colors hover:text-primary"
              >
                查看全部 <ChevronRight size={13} />
              </button>
            )}
          </div>

          <div className="mt-4">
            {historyLoading ? (
              <div className="grid gap-3 lg:grid-cols-3">
                {[1, 2, 3].map((item) => <Skeleton key={item} className="h-[92px] rounded-2xl" />)}
              </div>
            ) : history.length === 0 ? (
              <div className="flex min-h-[112px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/25 px-5 text-center">
                <MessageCircle size={20} className="text-dim/60" />
                <div className="mt-2 text-sm font-medium text-text">完成第一轮面试后，复盘会显示在这里</div>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-3">
                {history.map((session) => {
                  const reviewed = (session.status || "reviewed") === "reviewed";
                  const showReport = reviewed || ['ended', 'reviewing', 'review_failed'].includes(session.status || '');
                  const title = reviewed
                    ? "实时模拟"
                    : session.status === "review_failed"
                      ? "复盘生成失败"
                      : session.status === "reviewing"
                        ? "正在生成复盘"
                        : "面试未完成";
                  return (
                    <button
                      key={session.session_id}
                      type="button"
                      className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 p-3.5 text-left transition-all hover:border-primary/30 hover:bg-card"
                      onClick={() => navigate(showReport ? `/review/${session.session_id}` : `/interview/${session.session_id}`)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-card text-dim transition-colors group-hover:text-primary">
                        <Clock size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-text">{title}</div>
                        <div className="mt-1 text-[11px] tabular-nums text-dim">{formatDate(session.created_at)}</div>
                      </div>
                      <ScorePill score={session.avg_score} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
