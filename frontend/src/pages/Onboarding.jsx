import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import {
  getSettings,
  updateSettings,
  testLLMConnection,
  testEmbeddingConnection,
} from "../api/interview";
import { Loader2, Server, Boxes, ArrowRight, ArrowLeft, Eye, EyeOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Logo from "../components/Logo";
import LlmHeadersField from "../components/LlmHeadersField";
import { parseLlmHeaders } from "../lib/llmHeaders";

// 首登引导：每个用户都得带自己的 key,这里两步把 LLM + Embedding 配齐。
// Text interviews need only a chat model and an embedding configuration.
export default function Onboarding() {
  const { setNeedsOnboarding, logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showEmbKey, setShowEmbKey] = useState(false);

  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [compatibility, setCompatibility] = useState("generic");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [httpHeaders, setHttpHeaders] = useState("");
  const [embApiBase, setEmbApiBase] = useState("");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embApiModel, setEmbApiModel] = useState("");

  // 保留 training/services/system,保存时不被覆盖
  const [base, setBase] = useState(null);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setApiBase(data.llm?.api_base || "");
        setApiKey(data.llm?.api_key || "");
        setModel(data.llm?.model || "");
        setCompatibility(data.llm?.compatibility || "generic");
        setReasoningEffort(data.llm?.reasoning_effort || "");
        setHttpHeaders(data.llm?.http_headers ? JSON.stringify(data.llm.http_headers, null, 2) : "");
        const emb = data.embedding || {};
        setEmbApiBase(emb.api_base || "");
        setEmbApiKey(emb.api_key || "");
        setEmbApiModel(emb.api_model || "");
        setBase(data);
      })
      .catch((e) => setError("加载失败：" + e.message))
      .finally(() => setLoading(false));
  }, []);

  const llmReady = apiKey.trim() && model.trim();
  const embReady = embApiKey.trim() && embApiModel.trim();

  // 进入下一步前先实测 LLM；连不通就拦住，不让继续。
  async function handleNext() {
    setTesting(true);
    setError("");
    try {
      const r = await testLLMConnection({
        api_base: apiBase.trim(),
        api_key: apiKey.trim(),
        model: model.trim(),
        compatibility,
        reasoning_effort: reasoningEffort,
        http_headers: parseLlmHeaders(httpHeaders),
      });
      if (!r.ok) {
        setError("LLM 连接失败：" + r.error);
        return;
      }
      setStep(2);
    } catch (e) {
      setError("LLM 连接测试失败：" + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleFinish(backend = "api") {
    setSaving(true);
    setError("");
    try {
      if (backend === "api") {
        const r = await testEmbeddingConnection({
          backend: "api",
          api_base: embApiBase.trim(),
          api_key: embApiKey.trim(),
          api_model: embApiModel.trim(),
        });
        if (!r.ok) {
          setError("Embedding 连接失败：" + r.error);
          setSaving(false);
          return;
        }
      }
      await updateSettings({
        llm: {
          api_base: apiBase.trim(),
          api_key: apiKey.trim(),
          model: model.trim(),
          compatibility,
          reasoning_effort: reasoningEffort,
          http_headers: parseLlmHeaders(httpHeaders),
          temperature: base?.llm?.temperature ?? 0.7,
        },
        embedding: {
          backend,
          api_base: embApiBase.trim(),
          api_key: embApiKey.trim(),
          api_model: embApiModel.trim(),
          local_model: backend === "local" ? base?.embedding?.local_model || "Xenova/bge-m3" : "",
          local_path: backend === "local" ? base?.embedding?.local_path || "" : "",
        },
        services: base?.services || {},
        system: base?.system || { allow_registration: false },
        training: base?.training || { num_questions: 10, divergence: 3 },
      });
      setNeedsOnboarding(false);
      navigate("/mock-interview?mode=live", { replace: true });
    } catch (e) {
      setError("保存失败：" + e.message);
      setSaving(false);
    }
  }

  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80";
  const inputClass = "h-12 rounded-2xl bg-card/90";

  const steps = [
    { n: 1, label: "LLM", icon: Server },
    { n: 2, label: "Embedding", icon: Boxes },
  ];

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-primary/8 to-transparent rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <Logo className="w-10 h-10 rounded-xl drop-shadow-sm" />
          <div>
            <div className="text-lg font-display font-bold">先配置你的模型服务</div>
            <div className="text-[13px] text-dim mt-0.5">
              每个账号用自己的 key,不共享。两步配齐 LLM 和 Embedding 即可开始。
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n;
            const done = step > s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors",
                    active ? "bg-primary/12 text-primary font-medium" : done ? "text-primary/70" : "text-dim"
                  )}
                >
                  <Icon size={14} />
                  {s.label}
                </div>
                {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            );
          })}
        </div>

        <Card className="relative overflow-hidden">
          <CardContent className="p-6 md:p-7">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-dim">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : step === 1 ? (
              <div className="space-y-4">
                <div className="text-[13px] text-dim">
                  连接自己的模型服务。填写服务商提供的地址、模型名和 API Key，再选择对应的接口模式。
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Base URL</Label>
                  <Input className={inputClass} placeholder="例：https://api-inference.modelscope.cn/v1" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>Model</Label>
                  <Input className={inputClass} placeholder="例：ZhipuAI/GLM-5" value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API 兼容模式</Label>
                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/75 px-3 py-2.5 text-sm">
                    <span className="shrink-0 text-dim">请求配置</span>
                    <select
                      className="min-w-0 flex-1 bg-transparent text-right text-text outline-none"
                      value={compatibility}
                      onChange={(e) => { setCompatibility(e.target.value); setReasoningEffort(""); }}
                    >
                      <option value="generic">通用 OpenAI 兼容</option>
                      <option value="deepseek">DeepSeek V4</option>
                      <option value="responses">OpenAI Responses</option>
                    </select>
                  </label>
                  <div className="text-[12px] text-dim/70">
                    {compatibility === "deepseek" ? "DeepSeek 官方 API 填 https://api.deepseek.com（不要加 /v1）" : "多数 OpenAI 兼容服务填写包含 /v1 的 Base URL。"}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="llm-reasoning-effort" className={labelClass}>推理强度</Label>
                  <select id="llm-reasoning-effort" value={reasoningEffort} onChange={(e) => setReasoningEffort(e.target.value)}
                    className={cn(inputClass, "w-full border border-border px-3 text-sm text-text outline-none")}>
                    <option value="">跟随上游（默认）</option>
                    {compatibility !== "generic" && <option value="none">关闭推理（none）</option>}
                    <option value="low">轻量（low）</option>
                    {compatibility !== "deepseek" && <option value="medium">标准（medium）</option>}
                    <option value="high">深入（high）</option>
                    {compatibility !== "deepseek" && <option value="xhigh">更深入（xhigh）</option>}
                    {compatibility !== "responses" && <option value="max">最高（max）</option>}
                  </select>
                  {compatibility === "responses" && <p className="text-[12px] text-dim/70">使用 /responses 接口；推理强度需模型和网关支持。</p>}
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Key</Label>
                  <div className="relative">
                    <Input
                      className={cn(inputClass, "pr-11")}
                      masked={!showKey}
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text" onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <LlmHeadersField value={httpHeaders} onChange={setHttpHeaders} />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3 rounded-2xl border border-border/80 bg-background/75 p-4">
                  <div className="text-[13px] text-dim">
                    只配文本 API 也能开始。使用本地向量无需额外 API Key，首次使用向量功能时再下载模型；简历面试直接读取全文。
                  </div>
                  <Button variant="outline" className="w-full" disabled={saving} onClick={() => handleFinish("local")}>
                    {saving && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                    使用本地向量，开始使用
                  </Button>
                </div>
                <div className="text-[13px] text-dim">
                  或填写 Embedding API，用于知识库 / 个人资料库 / 记忆向量化。可与 LLM 用不同服务商。
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Base URL</Label>
                  <Input className={inputClass} placeholder="例：https://api.siliconflow.cn/v1（OpenAI 官方可留空）" value={embApiBase} onChange={(e) => setEmbApiBase(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>Embedding Model</Label>
                  <Input className={inputClass} placeholder="例：BAAI/bge-large-zh-v1.5" value={embApiModel} onChange={(e) => setEmbApiModel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Key</Label>
                  <div className="relative">
                    <Input
                      className={cn(inputClass, "pr-11")}
                      masked={!showEmbKey}
                      placeholder="sk-..."
                      value={embApiKey}
                      onChange={(e) => setEmbApiKey(e.target.value)}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text" onClick={() => setShowEmbKey((v) => !v)}>
                      {showEmbKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-sm">{error}</div>
            )}

            {!loading && (
              <div className="mt-6 flex items-center justify-between gap-3">
                {step === 1 ? (
                  <button onClick={logout} className="flex items-center gap-1.5 text-[13px] text-dim hover:text-text cursor-pointer">
                    <LogOut size={14} /> 退出登录
                  </button>
                ) : (
                  <Button variant="outline" disabled={saving} onClick={() => setStep(1)}>
                    <ArrowLeft size={15} className="mr-1.5" /> 上一步
                  </Button>
                )}

                {step === 1 ? (
                  <Button variant="gradient" disabled={!llmReady || testing} onClick={handleNext}>
                    {testing && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                    {testing ? "测试连接中..." : "下一步"}
                    {!testing && <ArrowRight size={15} className="ml-1.5" />}
                  </Button>
                ) : (
                  <Button variant="gradient" disabled={!embReady || saving} onClick={() => handleFinish("api")}>
                    {saving && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                    {saving ? "测试并保存中..." : "完成,开始使用"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-[12px] text-dim/70 mt-4">
          配置文字模型和资料检索后即可开始面试，无需语音、视频或录音上传服务。
        </div>
      </div>
    </div>
  );
}
