import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { BookOpen, BriefcaseBusiness, Sparkles, RotateCcw } from "lucide-react";
import { getReview, getReferenceAnswer, startInterview, startJobPrep, retryReview } from "../api/interview";
import useAuth from "../hooks/useAuth";
import { jobPrepDraftKey } from "../lib/jobPrepAccount";
import { jobPrepRestartRequest, clearJobPrepRestart } from "../lib/jobPrepRestart";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RetryAnswer } from '@/components/InterviewPractice';

function getScoreColor(score) {
  if (score >= 8) return { bg: "rgba(34,197,94,0.15)", color: "var(--success)" };
  if (score >= 6) return { bg: "rgba(245,158,11,0.15)", color: "var(--ai-glow)" };
  if (score >= 4) return { bg: "rgba(253,203,110,0.2)", color: "#e2b93b" };
  return { bg: "rgba(239,68,68,0.15)", color: "var(--destructive)" };
}

const RESUME_DIMENSION_LABELS = {
  technical_depth: "技术深度",
  project_articulation: "项目表达",
  communication: "表达能力",
  problem_solving: "问题解决",
};

const JOB_PREP_DIMENSION_LABELS = {
  role_fit: "岗位匹配",
  technical_depth: "技术深度",
  project_relevance: "项目相关性",
  engineering_quality: "工程质量",
  communication: "表达能力",
};

function ScorePill({ score }) {
  if (score == null) return <Badge variant="secondary">--</Badge>;
  const sc = getScoreColor(score);
  return (
    <Badge variant="outline" className="min-w-[52px] justify-center font-semibold text-[13px]" style={{ background: sc.bg, borderColor: "transparent", color: sc.color }}>
      {score}/10
    </Badge>
  );
}

function DimensionScores({ dimensionScores, avgScore, labels }) {
  if (!dimensionScores) return null;
  const entries = Object.entries(labels || {}).filter(([k]) => dimensionScores[k] != null);
  if (!entries.length) return null;

  return (
    <Card className="mb-6">
      <CardContent className="p-5 md:p-7">
        <div className="text-lg font-semibold mb-4">
          维度评分
          {avgScore != null && (
            <span className="text-sm font-normal text-dim ml-3">综合 <ScorePill score={avgScore} /></span>
          )}
        </div>
        {entries.map(([key, label]) => {
          const score = dimensionScores[key];
          const color = score >= 8 ? "var(--success)" : score >= 6 ? "var(--ai-glow)" : score >= 4 ? "#e2b93b" : "var(--destructive)";
          return (
            <div key={key} className="flex items-center gap-3 mb-2.5">
              <div className="w-[90px] md:w-[110px] text-[13px] text-dim text-right shrink-0">{label}</div>
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500 ease-in-out" style={{ width: `${score * 10}%`, background: color }} />
              </div>
              <div className="w-9 text-sm font-semibold text-right shrink-0" style={{ color }}>{score}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PointList({ title, items, tone = "red" }) {
  if (!items?.length) return null;
  const boxClass = tone === "green"
    ? "bg-green/8 border-green/20"
    : tone === "blue"
      ? "bg-blue-500/8 border-blue-500/20"
      : "bg-red/8 border-red/20";

  return (
    <div className="mb-6">
      <div className="text-base font-semibold mb-3 text-text">{title}</div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className={`px-3 py-2 rounded-lg text-[13px] text-text border animate-fade-in ${boxClass}`}>
            {typeof item === "string" ? item : item.point || JSON.stringify(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchivedReview({ topicsCovered, overall }) {
  const avgScore = overall?.avg_score || "-";
  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="text-lg font-semibold mb-3">整体评价</div>
          <div>
            <span className="inline-block text-[32px] font-bold mr-2" style={{ color: typeof avgScore === "number" ? getScoreColor(avgScore).color : "var(--foreground)" }}>
              {avgScore}
            </span>
            <span className="text-base text-dim">/10</span>
          </div>
          {overall?.summary && (
            <div className="mt-4 text-[15px] leading-[1.8] text-text">{overall.summary}</div>
          )}
        </CardContent>
      </Card>

      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      {topicsCovered?.length > 0 && (
        <div className="mb-6">
          <div className="text-base font-semibold mb-3 text-text">涉及知识点</div>
          <div className="flex flex-col gap-4">
            {topicsCovered.map((t, i) => (
              <Card key={i} className="animate-fade-in">
                <CardContent className="p-4 md:p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[15px] font-medium">{t.topic || "未知知识点"}</span>
                    <ScorePill score={t.score} />
                  </div>
                  {t.assessment && <div className="text-sm leading-[1.7] text-text mb-2">{t.assessment}</div>}
                  {t.understanding && <div className="text-[13px] text-dim italic mb-1">理解程度: {t.understanding}</div>}
                  {t.errors?.length > 0 && <div className="text-[13px] text-red leading-normal">错误: {t.errors.join("、")}</div>}
                  {t.missing?.length > 0 && <div className="text-[13px] text-dim leading-normal">遗漏: {t.missing.join("、")}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {(overall?.communication_observations || overall?.thinking_patterns) && (
        <Card className="mb-6">
          <CardContent className="p-5 md:p-7">
            {overall.communication_observations && (
              <div className="mb-4">
                <div className="text-base font-semibold mb-3">沟通表达</div>
                {overall.communication_observations.style_update && (
                  <div className="text-sm leading-[1.7] text-text mb-2">{overall.communication_observations.style_update}</div>
                )}
                {overall.communication_observations.new_habits?.length > 0 && (
                  <div className="text-[13px] text-dim mb-1">表达习惯: {overall.communication_observations.new_habits.join("、")}</div>
                )}
                {overall.communication_observations.new_suggestions?.length > 0 && (
                  <div className="mt-2">
                    {overall.communication_observations.new_suggestions.map((s, i) => (
                      <div key={i} className="px-3 py-2 rounded-lg text-[13px] text-text border bg-blue-500/8 border-blue-500/20 mb-1.5">{s}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {overall.thinking_patterns && (
              <div>
                <div className="text-base font-semibold mb-3">思维模式</div>
                {overall.thinking_patterns.new_strengths?.length > 0 && (
                  <div className="text-[13px] text-text mb-1">
                    <span className="text-dim">优势: </span>{overall.thinking_patterns.new_strengths.join("、")}
                  </div>
                )}
                {overall.thinking_patterns.new_gaps?.length > 0 && (
                  <div className="text-[13px] text-text">
                    <span className="text-dim">待提升: </span>{overall.thinking_patterns.new_gaps.join("、")}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function DrillReview({ scores, overall, questions, answers, topic, sessionId, initialRefAnswers }) {
  const answerMap = {};
  for (const a of (answers || [])) answerMap[a.question_id] = a.answer;
  const scoreMap = {};
  for (const s of (scores || [])) scoreMap[s.question_id] = s;
  const [refAnswers, setRefAnswers] = useState(initialRefAnswers || {});
  const [refLoading, setRefLoading] = useState({});

  const handleRefAnswer = async (qId) => {
    if (refAnswers[qId]) return;
    setRefLoading((p) => ({ ...p, [qId]: true }));
    try {
      const data = await getReferenceAnswer(sessionId, qId);
      setRefAnswers((p) => ({ ...p, [qId]: data.reference_answer }));
    } catch (e) {
      setRefAnswers((p) => ({ ...p, [qId]: "生成失败: " + e.message }));
    }
    setRefLoading((p) => ({ ...p, [qId]: false }));
  };

  const avgScore = overall?.avg_score || "-";

  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="text-lg font-semibold mb-3">整体评价</div>
          <div className="flex items-center gap-1 mb-2">
            <span className="inline-block text-[32px] font-bold" style={{ color: typeof avgScore === "number" ? getScoreColor(avgScore).color : "var(--foreground)" }}>
              {avgScore}
            </span>
            <span className="text-base text-dim">/10</span>
          </div>
          {overall?.summary && (
            <div className="mt-4 text-[15px] leading-[1.8] text-text">{overall.summary}</div>
          )}
          <div className="flex flex-wrap gap-3 mt-4">
            <Badge variant="secondary">共 {questions?.length || 0} 题</Badge>
            <Badge variant="secondary">已答 {answers?.filter((a) => a.answer).length || 0} 题</Badge>
          </div>
        </CardContent>
      </Card>

      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      <div className="text-base font-semibold mb-3 text-text">逐题复盘</div>
      <div className="flex flex-col gap-4">
        {(questions || []).map((q) => {
          const s = scoreMap[q.id] || {};
          const answer = answerMap[q.id];
          const isSkipped = !answer;

          if (isSkipped) {
            return (
              <Card key={q.id} className="opacity-50">
                <CardContent className="p-3 md:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    <span className="text-sm text-dim">{q.question.slice(0, 50)}{q.question.length > 50 ? "..." : ""}</span>
                  </div>
                  <span className="text-[13px] text-dim">未作答</span>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={q.id} className="animate-fade-in">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    {q.focus_area && <Badge variant="secondary">{q.focus_area}</Badge>}
                  </div>
                  <ScorePill score={s.score} />
                </div>

                <div className="text-[15px] font-medium leading-relaxed mb-3">{q.question}</div>

                <div className="bg-hover rounded-lg px-3 py-3 md:px-4 mb-3">
                  <div className="text-xs font-semibold text-dim mb-1.5 opacity-70">你的回答</div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
                </div>

                {s.assessment && s.assessment !== "未作答" && (
                  <div className="text-sm leading-[1.7] text-text mb-2">
                    <strong className="text-xs opacity-60">点评: </strong>{s.assessment}
                  </div>
                )}

                {s.improvement && (
                  <div className="text-sm leading-[1.7] text-primary bg-primary/8 rounded-lg px-3 py-2.5 mb-2">
                    <strong className="text-xs opacity-70">改进建议: </strong>{s.improvement}
                  </div>
                )}

                {s.understanding && s.understanding !== "未作答" && (
                  <div className="text-[13px] text-dim italic mt-1">理解程度: {s.understanding}</div>
                )}

                {s.key_missing?.length > 0 && (
                  <div className="text-[13px] text-red leading-normal">遗漏关键点: {s.key_missing.join("、")}</div>
                )}

                {topic && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {refAnswers[q.id] ? (
                      <div className="text-sm leading-[1.8]">
                        <div className="text-xs font-semibold text-dim mb-2 flex items-center gap-1.5">
                          <BookOpen size={13} /> 参考答案
                        </div>
                        <div className="md-content bg-hover rounded-lg px-3.5 py-3">
                          <ReactMarkdown>{refAnswers[q.id]}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary"
                        onClick={() => handleRefAnswer(q.id)}
                        disabled={refLoading[q.id]}
                      >
                        <BookOpen size={13} />
                        {refLoading[q.id] ? "正在生成参考答案..." : "查看参考答案"}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(overall?.communication_observations || overall?.thinking_patterns) && (
        <Card className="mb-6">
          <CardContent className="p-5 md:p-7">
            {overall.communication_observations && (
              <div className="mb-4">
                <div className="text-base font-semibold mb-3">沟通表达</div>
                {overall.communication_observations.style_update && (
                  <div className="text-sm leading-[1.7] text-text mb-2">{overall.communication_observations.style_update}</div>
                )}
                {overall.communication_observations.new_habits?.length > 0 && (
                  <div className="text-[13px] text-dim mb-1">表达习惯: {overall.communication_observations.new_habits.join("、")}</div>
                )}
                {overall.communication_observations.new_suggestions?.length > 0 && (
                  <div className="mt-2">
                    {overall.communication_observations.new_suggestions.map((s, i) => (
                      <div key={i} className="px-3 py-2 rounded-lg text-[13px] text-text border bg-blue-500/8 border-blue-500/20 mb-1.5">{s}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {overall.thinking_patterns && (
              <div>
                <div className="text-base font-semibold mb-3">思维模式</div>
                {overall.thinking_patterns.new_strengths?.length > 0 && (
                  <div className="text-[13px] text-text mb-1">
                    <span className="text-dim">优势: </span>{overall.thinking_patterns.new_strengths.join("、")}
                  </div>
                )}
                {overall.thinking_patterns.new_gaps?.length > 0 && (
                  <div className="text-[13px] text-text">
                    <span className="text-dim">待提升: </span>{overall.thinking_patterns.new_gaps.join("、")}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function JobPrepReview({ scores, overall, questions, answers, meta }) {
  const answerMap = {};
  for (const a of (answers || [])) answerMap[a.question_id] = a.answer;
  const scoreMap = {};
  for (const s of (scores || [])) scoreMap[s.question_id] = s;
  const avgScore = overall?.avg_score || "-";

  return (
    <>
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <BriefcaseBusiness size={18} className="text-blue-400" />
                <span className="text-lg font-semibold">
                  {meta?.company ? `${meta.company} · ` : ""}{meta?.position || "目标岗位"}
                </span>
              </div>
              {meta?.preview?.role_summary && (
                <div className="text-sm text-dim leading-relaxed">{meta.preview.role_summary}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-[32px] font-bold" style={{ color: typeof avgScore === "number" ? getScoreColor(avgScore).color : "var(--foreground)" }}>
                {avgScore}
              </div>
              <div className="text-sm text-dim">/10</div>
            </div>
          </div>

          {overall?.summary && (
            <div className="text-[15px] leading-[1.8] text-text mb-4">{overall.summary}</div>
          )}
          {overall?.role_fit_summary && (
            <div className="rounded-xl bg-blue-500/8 border border-blue-500/15 px-4 py-3 text-sm leading-relaxed">
              <div className="text-[13px] font-semibold text-blue-300 mb-1.5">岗位匹配判断</div>
              {overall.role_fit_summary}
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <Badge variant="secondary">共 {questions?.length || 0} 题</Badge>
            <Badge variant="secondary">已答 {answers?.filter((a) => a.answer).length || 0} 题</Badge>
            <Badge variant={meta?.use_resume ? "blue" : "secondary"}>{meta?.use_resume ? "JD + 简历联动" : "仅 JD"}</Badge>
          </div>
        </CardContent>
      </Card>

      <DimensionScores
        dimensionScores={overall?.dimension_scores}
        avgScore={overall?.avg_score}
        labels={JOB_PREP_DIMENSION_LABELS}
      />

      <PointList title="高风险追问点" items={overall?.interviewer_hotspots} tone="blue" />
      <PointList title="面试前优先补强" items={overall?.prep_priorities} />
      <PointList title="薄弱点" items={overall?.new_weak_points} />
      <PointList title="亮点" items={overall?.new_strong_points} tone="green" />

      <div className="text-base font-semibold mb-3 text-text">逐题复盘</div>
      <div className="flex flex-col gap-4">
        {(questions || []).map((q) => {
          const s = scoreMap[q.id] || {};
          const answer = answerMap[q.id];
          const isSkipped = !answer;

          return (
            <Card key={q.id} className={isSkipped ? "opacity-60" : "animate-fade-in"}>
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-primary border-primary/30">Q{q.id}</Badge>
                    {q.category && <Badge variant="blue">{q.category}</Badge>}
                    {q.focus_area && <Badge variant="secondary">{q.focus_area}</Badge>}
                  </div>
                  <ScorePill score={isSkipped ? null : s.score} />
                </div>

                <div className="text-[15px] font-medium leading-relaxed mb-3">{q.question}</div>

                {q.intent && (
                  <div className="mb-3 rounded-lg bg-hover px-3.5 py-3 text-sm text-dim leading-relaxed">
                    <span className="font-medium text-text">面试官在看什么：</span> {q.intent}
                  </div>
                )}

                {isSkipped ? (
                  <div className="text-[13px] text-dim">未作答</div>
                ) : (
                  <>
                    <div className="bg-hover rounded-lg px-3 py-3 md:px-4 mb-3">
                      <div className="text-xs font-semibold text-dim mb-1.5 opacity-70">你的回答</div>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
                    </div>

                    {s.role_expectation && (
                      <div className="text-sm leading-[1.7] text-dim mb-2">
                        <strong className="text-xs opacity-60">岗位在看什么: </strong>{s.role_expectation}
                      </div>
                    )}
                    {s.assessment && (
                      <div className="text-sm leading-[1.7] text-text mb-2">
                        <strong className="text-xs opacity-60">点评: </strong>{s.assessment}
                      </div>
                    )}
                    {s.improvement && (
                      <div className="text-sm leading-[1.7] text-primary bg-primary/8 rounded-lg px-3 py-2.5 mb-2">
                        <strong className="text-xs opacity-70">改进建议: </strong>{s.improvement}
                      </div>
                    )}
                    {s.understanding && (
                      <div className="text-[13px] text-dim italic mb-1">理解程度: {s.understanding}</div>
                    )}
                    {s.key_missing?.length > 0 && (
                      <div className="text-[13px] text-red leading-normal">遗漏关键点: {s.key_missing.join("、")}</div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function inferAnswers(questions, transcript) {
  if (!questions?.length || !transcript?.length) return [];
  return questions.map((q) => {
    const turn = /^resume-turn-(\d+)$/.exec(String(q.id));
    const qIdx = turn ? Number(turn[1]) - 1 : transcript.findIndex((m) => m.role === "assistant" && m.content === q.question);
    const next = qIdx >= 0 ? transcript[qIdx + 1] : null;
    return { question_id: q.id, answer: next?.role === "user" ? next.content : "" };
  });
}

export function ResumeReferenceAnswers({ sessionId, questions, transcript, initialAnswers, attempts = [] }) {
  const [references, setReferences] = useState(initialAnswers || {});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const active = useRef(new Set());
  const answers = inferAnswers(questions, transcript);

  const generate = async (id) => {
    if (references[id] || active.current.has(id)) return;
    active.current.add(id);
    setLoading((previous) => ({ ...previous, [id]: true }));
    setErrors((previous) => ({ ...previous, [id]: "" }));
    try {
      const data = await getReferenceAnswer(sessionId, id);
      setReferences((previous) => ({ ...previous, [id]: data.reference_answer }));
    } catch (error) {
      setErrors((previous) => ({ ...previous, [id]: error.message || "生成失败，请重试。" }));
    } finally {
      active.current.delete(id);
      setLoading((previous) => ({ ...previous, [id]: false }));
    }
  };

  if (!questions?.length) return null;
  return (
    <section className="mb-6" aria-label="逐题参考答法">
      <h2 className="text-base font-semibold mb-2">逐题参考答法</h2>
      <p className="mb-4 text-sm leading-6 text-dim">结合这轮问答和简历生成回答框架、口述示例与后续追问。按需生成并保存；项目细节需要以你的真实经历核实。</p>
      <div className="flex flex-col gap-4">
        {questions.map((question, index) => (
          <Card key={question.id}>
            <CardContent className="p-4 md:p-6">
              <div className="text-[15px] font-medium leading-relaxed mb-3">{index + 1}. {question.question}</div>
              <div className="rounded-lg bg-hover px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap mb-3">
                <div className="text-xs text-dim mb-1">你的回答</div>
                {answers.find(answer => String(answer.question_id) === String(question.id))?.answer || "未作答"}
              </div>
              {references[question.id] ? (
                <div className="md-content text-sm leading-[1.8]"><ReactMarkdown>{references[question.id]}</ReactMarkdown></div>
              ) : (
                <Button variant="outline" size="sm" disabled={loading[question.id]} onClick={() => generate(question.id)}>
                  <BookOpen size={13} />{loading[question.id] ? "正在生成参考答法…" : errors[question.id] ? "重试生成参考答法" : "生成参考答法"}
                </Button>
              )}
              {errors[question.id] && <p role="alert" className="mt-2 text-sm text-red">{errors[question.id]}</p>}
              {references[question.id] && <RetryAnswer key={`${sessionId}:${question.id}`} sessionId={sessionId} questionId={question.id} attempts={attempts.filter((item) => item.question_id === String(question.id))} />}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function Review() {
  const { sessionId } = useParams();
  return <ReviewSession key={sessionId} />;
}

function ReviewSession() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const stateData = location.state || {};

  const [review, setReview] = useState(stateData.review || null);
  const [scores, setScores] = useState(stateData.scores || null);
  const [overall, setOverall] = useState(stateData.overall || null);
  const [questions, setQuestions] = useState(stateData.questions || []);
  const [answers, setAnswers] = useState(stateData.answers || []);
  const [messages, setMessages] = useState(stateData.messages || []);
  const [mode, setMode] = useState(stateData.mode || null);
  const [topic, setTopic] = useState(stateData.topic || null);
  const [topicsCovered, setTopicsCovered] = useState(stateData.topics_covered || []);
  const [meta, setMeta] = useState(stateData.meta || {});
  const [referenceAnswers, setReferenceAnswers] = useState(stateData.reference_answers || {});
  const [showTranscript, setShowTranscript] = useState(false);
  const [loading, setLoading] = useState(!review && !scores);
  const [restarting, setRestarting] = useState(false);
  const [reportStatus, setReportStatus] = useState('');
  const [reportError, setReportError] = useState('');
  const [retryingReport, setRetryingReport] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const { token } = useAuth();
  const restartOperation = useRef(null);
  const restartBusy = useRef(false);
  const restartKey = `${jobPrepDraftKey(token)}:restart:${sessionId}`;

  const handleRestart = async () => {
    const currentMode = mode || stateData.mode;
    if (!currentMode || (currentMode === "recording" || currentMode === "copilot") || restartBusy.current) return;
    if (currentMode === "resume") { navigate('/mock-interview?mode=live'); return; }
    restartBusy.current = true;
    setRestarting(true);
    try {
      let data;
      if (currentMode === "jd_prep") {
        const m = meta || stateData.meta || {};
        if (restartOperation.current?.key !== restartKey) {
          restartOperation.current = { key: restartKey, id: crypto.randomUUID() };
        }
        const requestId = jobPrepRestartRequest(window.sessionStorage, restartKey, restartOperation.current.id);
        restartOperation.current.id = requestId;
        data = await startJobPrep({
          request_id: requestId,
          jd_text: m.jd_text || m.jd_excerpt,  // jd_excerpt: 兼容修复前创建的旧会话
          company: m.company,
          position: m.position,
          use_resume: m.use_resume,
          preview_data: m.preview,             // 复用已有分析,省掉一次 LLM 拆解
        });
      } else {
        data = await startInterview(currentMode, topic || stateData.topic);
      }
      if (currentMode === "jd_prep") {
        clearJobPrepRestart(window.sessionStorage, restartKey);
        restartOperation.current = null;
      }
      navigate(`/interview/${data.session_id}`, { state: { ...data, mode: currentMode, topic: topic || stateData.topic, meta: data.meta || meta || stateData.meta } });
    } catch (err) {
      alert("启动失败: " + err.message);
    } finally {
      restartBusy.current = false;
      setRestarting(false);
    }
  };

  useEffect(() => {
    let cancelled = false; let timer;
    const load = async () => {
      try {
        const data = await getReview(sessionId);
        if (cancelled) return;
        setReview(data.review || '');
        setScores(data.scores || []);
        setQuestions(data.questions || []);
        setMessages(data.transcript || []);
        setMode(data.mode);
        setTopic(data.topic);
        setOverall(data.overall || {});
        setTopicsCovered(data.overall?.topics_covered || []);
        setMeta(data.meta || {});
        setReferenceAnswers(data.reference_answers || {});
        setReportStatus(data.status);
        setReportError(data.review_error || '');
        setAnswers(inferAnswers(data.questions || [], data.transcript || []));
        if (!['recording', 'copilot'].includes(data.mode) && (data.status === 'reviewing' || data.meta?.profile_sync_pending)) timer = window.setTimeout(load, 1500);
      } catch (error) { if (!cancelled) { setReportError(error.message || '读取报告失败'); timer = window.setTimeout(load, 3000); } }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId, reloadCount]);

  const retryReport = async () => {
    if (retryingReport) return;
    setRetryingReport(true);
    try { await retryReview(sessionId); setReloadCount((value) => value + 1); }
    catch (error) { setReportError(error.message); }
    finally { setRetryingReport(false); }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-15 text-dim">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.2s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.4s]" />
          </div>
          <span className="text-sm">加载复盘报告中...</span>
        </div>
      </div>
    );
  }

  const currentMode = mode || stateData.mode;
  const isCopilot = currentMode === "copilot";
  const isRecording = currentMode === "recording";
  const isJobPrep = currentMode === "jd_prep";
  const showDrill = currentMode === "topic_drill";
  const archived = isCopilot || isRecording;
  const title = isCopilot ? "历史辅助记录" : isRecording ? "历史导入记录" : isJobPrep ? "JD 备面复盘" : showDrill ? "训练复盘" : "面试复盘";

  return (
    <div className="flex-1 px-4 py-8 md:px-6 md:py-10 max-w-3xl mx-auto w-full">
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-2 mb-2">
          {isJobPrep && <BriefcaseBusiness size={18} className="text-blue-400" />}
          {showDrill && !isJobPrep && !isRecording && <Sparkles size={18} className="text-primary" />}
          {isRecording && <BookOpen size={18} className="text-primary" />}
          <div className="text-2xl md:text-[28px] font-display font-bold">{title}</div>
        </div>
        <div className="text-sm text-dim">Session: {sessionId}</div>
      </div>

      {archived && <p className="mb-5 rounded-xl border border-border bg-card p-4 text-sm text-dim">这是已停用功能的历史记录，仅展示已保存内容。新的练习请从“开始面试”进入。</p>}
      {!archived && (currentMode === 'resume' || reportError) && <section aria-label="复盘进度" className="mb-5 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-medium">{meta.review_stage === 'generating' ? (review ? '正在生成报告，内容会逐段保存…' : '模型正在分析，等待报告首段…') : meta.profile_sync_pending ? '报告已保存，可先阅读；画像正在后台同步…' : meta.profile_extract_failed ? '报告已保存，画像同步失败，可单独重试' : reportStatus === 'review_failed' ? '报告生成中断，已保存的内容仍可查看' : reportStatus === 'reviewed' ? '报告已完成' : '正在读取复盘状态'}</p>
        {meta.training_mode === 'coach' && <p className="mt-1 text-xs text-dim">本轮为教练练习，受帮助的回答不计入严格模拟分数趋势。</p>}
        {Array.isArray(meta.selected_materials) && meta.selected_materials.length > 0 && <p className="mt-1 text-xs text-dim">本轮材料快照：{meta.selected_materials.map((item) => `${item.filename}（${item.role}）`).join('、')}</p>}
        {meta.review_first_token_at && meta.review_started_at && <p className="mt-1 text-xs text-dim">报告首次内容：{Math.max(0, (Date.parse(meta.review_first_token_at) - Date.parse(meta.review_started_at)) / 1000).toFixed(1)} 秒{meta.review_report_ready_at ? ` · 正文完成：${Math.max(0, (Date.parse(meta.review_report_ready_at) - Date.parse(meta.review_started_at)) / 1000).toFixed(1)} 秒` : ''}</p>}
        {reportError && <p role="alert" className="mt-2 text-red">{reportError}</p>}
        {(reportStatus === 'review_failed' || meta.profile_extract_failed || (reportError && !meta.profile_sync_pending)) && <Button className="mt-3" variant="outline" size="sm" disabled={retryingReport} onClick={() => void retryReport()}>{retryingReport ? '正在提交…' : review && reportStatus === 'reviewed' ? '只重试画像同步' : '重试生成报告'}</Button>}
      </section>}

      <div className="stagger-children">
        {archived ? (
          <>
            <ArchivedReview topicsCovered={topicsCovered} overall={overall} />
            <Card className="mb-6"><CardContent className="p-5 md:p-8 md-content">
              <ReactMarkdown>{review || "此历史记录没有已保存的报告正文。"}</ReactMarkdown>
            </CardContent></Card>
            {messages.length > 0 && <Card><CardContent className="p-5">
              <h2 className="mb-3 font-semibold">已保存的问答</h2>
              {messages.map((message, index) => <p key={index} className="mb-3 whitespace-pre-wrap text-sm leading-7"><strong>{message.role === "user" ? "你" : "面试官"}：</strong>{message.content}</p>)}
            </CardContent></Card>}
          </>
        ) : isJobPrep ? (
          <JobPrepReview scores={scores} overall={overall} questions={questions} answers={answers} meta={meta} />
        ) : showDrill ? (
          <DrillReview scores={scores} overall={overall} questions={questions} answers={answers} topic={topic} sessionId={sessionId} initialRefAnswers={referenceAnswers} />
        ) : (
          <>
            <DimensionScores
              dimensionScores={stateData.dimension_scores || overall?.dimension_scores}
              avgScore={stateData.avg_score ?? overall?.avg_score}
              labels={RESUME_DIMENSION_LABELS}
            />
            <Card className="mb-6">
              <CardContent className="p-5 md:p-8 leading-[1.8] text-[15px]">
                <div className="md-content">
                  <ReactMarkdown>{review || ""}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>

            {currentMode === "resume" && (
              <ResumeReferenceAnswers key={sessionId} sessionId={sessionId} questions={questions} transcript={messages} initialAnswers={referenceAnswers} attempts={Array.isArray(meta.training_attempts) ? meta.training_attempts : []} />
            )}

            {messages.length > 0 && (
              <div className="mb-6">
                <Button variant="outline" onClick={() => setShowTranscript(!showTranscript)} className="mr-3">
                  {showTranscript ? "收起面试记录" : "查看面试记录"}
                </Button>
                {showTranscript && (
                  <Card className="mt-4">
                    <CardContent className="p-4 md:p-6 max-h-[500px] overflow-y-auto">
                      {messages.map((msg, i) => (
                        <div key={i} className="py-2 border-b border-border text-sm leading-relaxed last:border-0">
                          <strong style={{ color: msg.role === "user" ? "var(--ai-glow)" : "var(--success)" }}>
                            {msg.role === "user" ? "你" : "面试官"}:
                          </strong>{" "}
                          {msg.content}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 mt-6">
        {currentMode && currentMode !== "recording" && !isCopilot && (
          <Button variant="gradient" onClick={handleRestart} disabled={restarting}>
            <RotateCcw size={15} className={restarting ? "animate-spin" : ""} />
            {restarting ? "正在生成题目..." : currentMode === 'resume' ? "选择资料再练一轮" : "再次练习"}
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate("/")}>
          返回首页
        </Button>
      </div>
    </div>
  );
}
