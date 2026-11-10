import { consumeInterviewStream, consumeIndexRebuildStream, type ChatStreamCallbacks, type RebuildIndexCallbacks } from './events';
import { responseErrorText } from './errors';
import {
  API_BASE,
  authFetch,
  type ApiRequestBody,
  type ApiResponse,
} from "./client";

// 兼容旧引用:authFetch 历史上从本模块导出
export { authFetch } from "./client";

export async function getTopics(): Promise<ApiResponse<"/api/topics", "get">> {
  const res = await authFetch(`${API_BASE}/topics`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function createTopic(
  name: string,
  icon = "📝"
): Promise<ApiResponse<"/api/topics", "post">> {
  const res = await authFetch(`${API_BASE}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function deleteTopic(
  key: string
): Promise<ApiResponse<"/api/topics/{key}", "delete">> {
  const res = await authFetch(`${API_BASE}/topics/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

// ── Resume ──

export async function getResumeStatus(): Promise<
  ApiResponse<"/api/resume/status", "get">
> {
  const res = await authFetch(`${API_BASE}/resume/status`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function uploadResume(
  file: File
): Promise<ApiResponse<"/api/resume/upload", "post">> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(`${API_BASE}/resume/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getResumePdfBlob(): Promise<Blob> {
  const res = await authFetch(`${API_BASE}/resume/file`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.blob();
}

export async function deleteUploadedResume(): Promise<
  ApiResponse<"/api/resume", "delete">
> {
  const res = await authFetch(`${API_BASE}/resume`, { method: "DELETE" });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function parseUploadedResume(): Promise<
  ApiResponse<"/api/resume/parse", "post">
> {
  const res = await authFetch(`${API_BASE}/resume/parse`, { method: "POST" });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

// ── Interview ──

type StartInterviewBody = ApiRequestBody<"/api/interview/start", "post">;
type InterviewMode = StartInterviewBody["mode"];
type JobPrepPreviewBody = ApiRequestBody<"/api/job-prep/preview", "post">;
type JobPrepStartBody = ApiRequestBody<"/api/job-prep/start", "post">;
type EndInterviewBody = ApiRequestBody<
  "/api/interview/end/{session_id}",
  "post"
>;
type DraftInterviewBody = ApiRequestBody<
  "/api/interview/draft/{session_id}",
  "post"
>;
type InterviewAnswers = NonNullable<EndInterviewBody["answers"]>;

interface StartInterviewOptions {
  numQuestions?: StartInterviewBody["num_questions"];
  divergence?: StartInterviewBody["divergence"];
  targetRole?: StartInterviewBody["target_role"];
  jobDescription?: StartInterviewBody["job_description"];
  trainingMode?: "strict" | "coach";
  materialDocumentIds?: string[];
  resumeDocumentId?: string;
  jdDocumentId?: string;
  useResume?: boolean;
}

export async function startInterview(
  mode: InterviewMode,
  topic: StartInterviewBody["topic"] = null,
  { numQuestions, divergence, targetRole, jobDescription, trainingMode, materialDocumentIds, resumeDocumentId, jdDocumentId, useResume }: StartInterviewOptions = {}
): Promise<ApiResponse<"/api/interview/start", "post">> {
  const body: StartInterviewBody = { mode, topic };
  if (numQuestions != null) body.num_questions = numQuestions;
  if (divergence != null) body.divergence = divergence;
  if (targetRole != null) body.target_role = targetRole;
  if (jobDescription != null) body.job_description = jobDescription;
  if (trainingMode != null) body.training_mode = trainingMode;
  if (materialDocumentIds != null) body.material_document_ids = materialDocumentIds;
  if (resumeDocumentId) body.resume_document_id = resumeDocumentId;
  if (jdDocumentId) body.jd_document_id = jdDocumentId;
  if (useResume != null) body.use_resume = useResume;
  const res = await authFetch(`${API_BASE}/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function inferTargetRole(): Promise<
  ApiResponse<"/api/profile/infer-target-role", "post">
> {
  const res = await authFetch(`${API_BASE}/profile/infer-target-role`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function previewJobPrep(
  payload: JobPrepPreviewBody
): Promise<ApiResponse<"/api/job-prep/preview", "post">> {
  const res = await authFetch(`${API_BASE}/job-prep/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function startJobPrep(
  payload: JobPrepStartBody
): Promise<ApiResponse<"/api/job-prep/start", "post">> {
  const res = await authFetch(`${API_BASE}/job-prep/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<ApiResponse<"/api/interview/chat", "post">> {
  const res = await authFetch(`${API_BASE}/interview/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function sendMessageStream(
  sessionId: string,
  message: string,
  { onToken, onDone, onError }: ChatStreamCallbacks
): Promise<void> {
  const res = await authFetch(`${API_BASE}/interview/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));

  await consumeInterviewStream(res, { onToken, onDone, onError });
}

export async function endInterview(
  sessionId: string,
  answers: InterviewAnswers | null = null
): Promise<ApiResponse<"/api/interview/end/{session_id}", "post">> {
  const options: RequestInit = { method: "POST" };
  if (answers) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ answers });
  }
  const res = await authFetch(`${API_BASE}/interview/end/${sessionId}`, options);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function saveDraftAnswers(
  sessionId: string,
  answers: NonNullable<DraftInterviewBody["answers"]>
): Promise<ApiResponse<"/api/interview/draft/{session_id}", "post">> {
  const res = await authFetch(`${API_BASE}/interview/draft/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getReview(
  sessionId: string
): Promise<ApiResponse<"/api/interview/review/{session_id}", "get">> {
  const res = await authFetch(`${API_BASE}/interview/review/${sessionId}`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function retryReview(
  sessionId: string
): Promise<ApiResponse<"/api/interview/review/{session_id}/generate", "post">> {
  const res = await authFetch(
    `${API_BASE}/interview/review/${sessionId}/generate`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getResumableSession(
  sessionId: string
): Promise<ApiResponse<"/api/interview/session/{session_id}/resume", "get">> {
  const res = await authFetch(
    `${API_BASE}/interview/session/${sessionId}/resume`
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getTaskStatus(
  taskId: string
): Promise<ApiResponse<"/api/tasks/{task_id}", "get">> {
  const res = await authFetch(`${API_BASE}/tasks/${taskId}`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getReferenceAnswer(
  sessionId: string,
  questionId: ApiRequestBody<
    "/api/interview/reference-answer",
    "post"
  >["question_id"]
): Promise<ApiResponse<"/api/interview/reference-answer", "post">> {
  const res = await authFetch(`${API_BASE}/interview/reference-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export type TrainingAttempt = { attempt_id: string; question_id: string; question: string; answer: string; original_answer: string; comparison: string; technical_gaps: Array<{ point: string; evidence: string; exercise: string }>; expression_gaps: Array<{ point: string; evidence: string; exercise: string }>; created_at: string; assisted: true };

export async function compareAnswer(sessionId: string, questionId: string | number, answer: string, requestId: string): Promise<TrainingAttempt> {
  const res = await authFetch(`${API_BASE}/interview/compare-answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: sessionId, question_id: questionId, answer, request_id: requestId }) });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getTrainingProgress(): Promise<{ items: Array<TrainingAttempt & { session_id: string; training_mode: string }> }> {
  const res = await authFetch(`${API_BASE}/interview/training-progress`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getHistory(
  limit = 20,
  offset = 0,
  mode: InterviewMode | null = null,
  topic: string | null = null
): Promise<ApiResponse<"/api/interview/history", "get">> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (mode) params.set("mode", mode);
  if (topic) params.set("topic", topic);
  const res = await authFetch(`${API_BASE}/interview/history?${params}`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function deleteSession(
  sessionId: string
): Promise<ApiResponse<"/api/interview/session/{session_id}", "delete">> {
  const res = await authFetch(`${API_BASE}/interview/session/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getInterviewTopics(): Promise<
  ApiResponse<"/api/interview/topics", "get">
> {
  const res = await authFetch(`${API_BASE}/interview/topics`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

// ── Profile & Retrospective ──

export async function getProfile(): Promise<ApiResponse<"/api/profile", "get">> {
  const res = await authFetch(`${API_BASE}/profile`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function markProfileViewed(): Promise<
  ApiResponse<"/api/profile/viewed", "post">
> {
  const res = await authFetch(`${API_BASE}/profile/viewed`, { method: "POST" });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function sendPatternFeedback(
  point: ApiRequestBody<
    "/api/profile/pattern/feedback",
    "post"
  >["point"],
  verdict: ApiRequestBody<
    "/api/profile/pattern/feedback",
    "post"
  >["verdict"]
): Promise<ApiResponse<"/api/profile/pattern/feedback", "post">> {
  const res = await authFetch(`${API_BASE}/profile/pattern/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ point, verdict }),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getTopicRetrospective(
  topic: string
): Promise<ApiResponse<"/api/profile/topic/{topic}/retrospective", "post">> {
  const res = await authFetch(
    `${API_BASE}/profile/topic/${topic}/retrospective`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getTopicHistory(
  topic: string
): Promise<ApiResponse<"/api/profile/topic/{topic}/history", "get">> {
  const res = await authFetch(`${API_BASE}/profile/topic/${topic}/history`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

// ── Knowledge management ──

export async function getCoreKnowledge(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core", "get">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function updateCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "put">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function deleteCoreKnowledge(
  topic: string,
  filename: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "delete">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function createCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core", "post">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content }),
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function uploadKnowledgeDoc(
  topic: string,
  file: File
): Promise<ApiResponse<"/api/knowledge/{topic}/upload", "post">> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/upload`,
    {
      method: "POST",
      body: form,
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function generateKnowledge(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/generate", "post">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/generate`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function getHighFreq(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/high_freq", "get">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function updateHighFreq(
  topic: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/high_freq", "put">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

// ── Settings ──

export async function getSettings(): Promise<
  ApiResponse<"/api/settings", "get">
> {
  const res = await authFetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function updateSettings(
  payload: ApiRequestBody<"/api/settings", "put">
): Promise<ApiResponse<"/api/settings", "put">> {
  const res = await authFetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

type LLMConnectionPayload = ApiRequestBody<"/api/settings/test-llm", "post">;

// 连接测试：探测「表单里当前填的」配置（尚未保存也能测），返回 { ok, error }
export async function testLLMConnection(
  payload: LLMConnectionPayload
): Promise<
  ApiResponse<"/api/settings/test-llm", "post">
> {
  const res = await authFetch(`${API_BASE}/settings/test-llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function testEmbeddingConnection(
  payload: ApiRequestBody<"/api/settings/test-embedding", "post">
): Promise<ApiResponse<"/api/settings/test-embedding", "post">> {
  const res = await authFetch(`${API_BASE}/settings/test-embedding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await responseErrorText(res));
  return res.json();
}

export async function rebuildEmbeddingIndex({
  onProgress,
  onDone,
  onError,
}: RebuildIndexCallbacks = {}): Promise<void> {
  const res = await authFetch(`${API_BASE}/settings/rebuild-index`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await responseErrorText(res));

  await consumeIndexRebuildStream(res, { onProgress, onDone, onError });
}
