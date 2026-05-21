import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  FastForward,
  FileText,
  Home,
  KeyRound,
  Loader2,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PackageOpen,
  Pin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Square,
  Sun,
  Timer,
  Trash2,
} from "lucide-react";
import { listModels, type ChatMessage } from "@/lib/api";
import { DEFAULT_CONFIG, type AppConfig } from "@/lib/config";
import { clearConfig, loadConfig, saveConfig } from "@/lib/storage";
import { applyHermesModelConfig, applyHermesReasoningConfig, cancelHermesChatCompletion, checkHermes, checkHermesApiServer, hermesChatCompletion, readChatSessions, readHermesCronCliStatus, readHermesCronOverview, readHermesModelConfig, readHermesNativeMemory, writeChatSessions, type ChatSession, type HermesApiServerStatus, type HermesChatChunk, type HermesChatDone, type HermesChatError, type HermesCronCliStatus, type HermesCronOverview, type HermesModelConfig, type HermesNativeMemoryFile, type HermesNativeMemoryResult, type HermesStatus, type HermesStreamDiagnostics, type HermesToolProgress } from "@/lib/hermes";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { cn, getErrorMessage } from "@/lib/utils";
import { officialSkills, officialCategories, hermesHubSkills, hermesHubCategories, type OfficialSkill, type HermesHubSkill } from "@/data/skills";
import { tutorials } from "@/data/tutorials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, Td, Th } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type RouteId = "home" | "chat" | "engines" | "skills" | "memory" | "tasks" | "usage" | "tutorials" | "about";
type UiChatMessage = ChatMessage & {
  requestId?: string;
  source?: "Hermes Agent";
  elapsedMs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  modelName?: string;
  sessionId?: string | null;
  reasoningContent?: string;
  toolEvents?: string[];
  partial?: boolean;
  warning?: string;
};

const DEBUG_STREAM = false;

type FrontStreamDiagnostics = {
  requestId: string;
  listenRegistered: boolean;
  currentRequestId: string | null;
  frontChunkReceivedCount: number;
  frontChunkAppliedCount: number;
  doneReceivedCount: number;
  errorReceivedCount: number;
  toolProgressReceivedCount: number;
  filteredEventCount: number;
  missingAssistantPlaceholderCount: number;
  doneReceived: boolean;
  rust: Record<string, unknown>;
};

const initialFrontStreamDiagnostics: FrontStreamDiagnostics = {
  requestId: "",
  listenRegistered: false,
  currentRequestId: null,
  frontChunkReceivedCount: 0,
  frontChunkAppliedCount: 0,
  doneReceivedCount: 0,
  errorReceivedCount: 0,
  toolProgressReceivedCount: 0,
  filteredEventCount: 0,
  missingAssistantPlaceholderCount: 0,
  doneReceived: false,
  rust: {}
};

type TypewriterState = {
  contentBuf: string;
  reasoningBuf: string;
  done: boolean;
  skip: boolean;
  rafId: number | null;
  requestId: string;
};

function nowStamp() {
  return String(Math.floor(Date.now() / 1000));
}

function sessionTitleFromMessages(messages: UiChatMessage[]) {
  const first = messages.find((message) => message.role === "user")?.content.trim() ?? "";
  if (!first) return "新对话";
  const hasCjk = /[\u3400-\u9fff]/.test(first);
  const limit = hasCjk ? 20 : 40;
  return first.length > limit ? `${first.slice(0, limit)}…` : first;
}

function messagePreview(messages: UiChatMessage[]) {
  const last = [...messages].reverse().find((message) => message.content?.trim());
  if (!last) return "暂无消息";
  const text = last.content.replace(/\s+/g, " ").trim();
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}

function sessionTotalTokens(messages: UiChatMessage[]) {
  return messages.reduce((sum, message) => sum + (message.role === "assistant" ? message.usage?.total_tokens ?? 0 : 0), 0);
}

function createEmptySession(model = "hermes-agent"): ChatSession {
  const now = nowStamp();
  return { id: crypto.randomUUID(), title: "新对话", createdAt: now, updatedAt: now, messages: [], hermesSessionId: null, model, totalTokens: 0, lastMessagePreview: "暂无消息", pinned: false };
}

function buildHermesMessages(systemPrompt: string, history: UiChatMessage[]): ChatMessage[] {
  const clean = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => typeof message.content === "string" && message.content.trim().length > 0)
    .filter((message) => !(message.role === "assistant" && message.content.trim().startsWith("请求失败：")))
    .map((message) => ({ role: message.role, content: message.content.trim() } as ChatMessage));
  const limited: ChatMessage[] = [];
  let totalChars = 0;
  for (const message of clean.slice(-20).reverse()) {
    const length = message.content.length;
    if (limited.length > 0 && totalChars + length > 20_000) break;
    totalChars += length;
    limited.push(message);
  }
  return [{ role: "system", content: systemPrompt }, ...limited.reverse()];
}

function sortSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.updatedAt) - Number(a.updatedAt));
}

function updateSessionFromMessages(session: ChatSession, messages: UiChatMessage[], extra?: Partial<ChatSession>): ChatSession {
  const updatedAt = nowStamp();
  return {
    ...session,
    ...extra,
    title: session.title === "新对话" ? sessionTitleFromMessages(messages) : session.title,
    updatedAt,
    messages,
    totalTokens: sessionTotalTokens(messages),
    lastMessagePreview: messagePreview(messages)
  };
}

function MarkdownContent({ text }: { text: string }) {
  if (!text) return null;
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const parseInline = (s: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let last = 0;
    let k = 0;
    for (const match of s.matchAll(pattern)) {
      const token = match[0];
      const index = match.index ?? 0;
      if (index > last) parts.push(<span key={k++}>{s.slice(last, index)}</span>);
      if (token.startsWith("`")) {
        parts.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{token.slice(1, -1)}</code>);
      } else if (token.startsWith("**")) {
        parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
      } else {
        parts.push(<em key={k++}>{token.slice(1, -1)}</em>);
      }
      last = index + token.length;
    }
    if (last < s.length) parts.push(<span key={k++}>{s.slice(last)}</span>);
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // closing ```
      const codeText = codeLines.join("\n");
      elements.push(
        <pre key={key} className="group relative my-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-[13px] leading-relaxed text-zinc-100 dark:bg-zinc-900">
          {lang && <div className="mb-1 text-[10px] text-zinc-500">{lang}</div>}
          <code>{codeText}</code>
          <button
            className="absolute right-2 top-2 rounded p-1 text-zinc-500 opacity-0 transition hover:text-zinc-300 group-hover:opacity-100"
            onClick={() => { navigator.clipboard.writeText(codeText); setCopiedIdx(key); setTimeout(() => setCopiedIdx(-1), 2000); }}
          >
            {copiedIdx === key ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </pre>
      );
      key++;
    }

    // heading
    const hMatch = line.trim().match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1]!.length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      elements.push(<Tag key={key++} className={level === 1 ? "mt-4 mb-1 text-base font-semibold" : level === 2 ? "mt-3 mb-1 text-sm font-semibold" : "mt-2 mb-1 text-sm font-medium"}>{parseInline(hMatch[2]!)}</Tag>);
      i++;
      continue;
    }

    // unordered list
    if (/^[\s]*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*]\s+/.test(lines[i] ?? "")) {
        items.push(lines[i]!.replace(/^[\s]*[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((item, idx) => <li key={idx}>{parseInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // ordered list
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(lines[i]!.replace(/^[\s]*\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-1 list-decimal space-y-0.5 pl-5">
          {items.map((item, idx) => <li key={idx}>{parseInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      const qLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
        qLines.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={key++} className="my-1 border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
          {qLines.map((ql, idx) => <p key={idx} className={idx > 0 ? "mt-1" : ""}>{parseInline(ql)}</p>)}
        </blockquote>
      );
      continue;
    }

    // table (GFM)
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s:]*-+[\s:]*\|/.test(lines[i + 1] ?? "")) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|")) {
        tableLines.push(lines[i]!);
        i++;
      }
      const parseRow = (row: string) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const headers = parseRow(tableLines[0]!);
      const dataRows = tableLines.slice(2).map(parseRow);
      elements.push(
        <div key={key++} className="my-2 overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {headers.map((h, hi) => <th key={hi} className="px-3 py-2 text-left font-medium">{parseInline(h)}</th>)}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className="border-b last:border-0">
                  {row.map((cell, ci) => <td key={ci} className="px-3 py-2">{parseInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // hr
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={key++} className="my-3 border-border/50" />);
      i++;
      continue;
    }

    // empty line → paragraph break
    if (line.trim() === "") {
      if (elements.length > 0 && typeof elements[elements.length - 1] === "object") {
        i++;
        continue;
      }
      i++;
      continue;
    }

    // paragraph
    const pLines: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !/^[\s]*[-*]\s+/.test(lines[i] ?? "") && !/^[\s]*\d+\.\s+/.test(lines[i] ?? "") && !(lines[i] ?? "").startsWith(">") && !(lines[i] ?? "").trim().startsWith("```") && !(lines[i] ?? "").trim().match(/^#{1,3}\s+/) && !((lines[i] ?? "").includes("|") && i + 1 < lines.length && /^\|?[\s:]*-+[\s:]*\|/.test(lines[i + 1] ?? "")) && !/^---+$/.test((lines[i] ?? "").trim()) && !/^\*\*\*+$/.test((lines[i] ?? "").trim())) {
      pLines.push(lines[i]!);
      i++;
    }
    elements.push(<p key={key++} className="leading-relaxed">{parseInline(pLines.join("\n"))}</p>);
  }

  return <div className="space-y-1">{elements}</div>;
}

const navItems = [
  { id: "home", label: "首页", icon: Home },
  { id: "chat", label: "Agent 对话", icon: MessageSquare },
  { id: "engines", label: "Hermes 管理", icon: Bot },
  { id: "skills", label: "Skill Center", icon: PackageOpen },
  { id: "memory", label: "Hermes 记忆", icon: FileText },
  { id: "tasks", label: "定时任务", icon: Timer },
  { id: "usage", label: "使用情况", icon: Bot },
  { id: "tutorials", label: "教程", icon: BookOpen },
  { id: "about", label: "关于", icon: KeyRound }
] as const;

function App() {
  const [active, setActive] = useState<RouteId>("home");
  const [chatDraft, setChatDraft] = useState("");
  const [pendingNewSessionTitle, setPendingNewSessionTitle] = useState("");
  const [dark, setDark] = useState(false);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [hermesCli, setHermesCli] = useState<HermesStatus | null>(null);
  const [hermesApi, setHermesApi] = useState<HermesApiServerStatus | null>(null);
  const [hermesModelConfig, setHermesModelConfig] = useState<HermesModelConfig | null>(null);
  const [cronOverview, setCronOverview] = useState<HermesCronOverview | null>(null);
  const [cronCliStatus, setCronCliStatus] = useState<HermesCronCliStatus | null>(null);
  const [cronLastLoadedAt, setCronLastLoadedAt] = useState(0);
  const [ready, setReady] = useState(false);
  const showOnboarding = ready && !config.hasCompletedOnboarding;

  useEffect(() => {
    loadConfig()
      .then(setConfig)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const detect = async () => {
      try {
        const cli = await checkHermes();
        if (!cancelled) setHermesCli(cli);
      } catch { /* ignore */ }
      try {
        const api = await checkHermesApiServer();
        if (!cancelled) setHermesApi(api);
      } catch { /* ignore */ }
      try {
        const modelConfig = await readHermesModelConfig();
        if (!cancelled) setHermesModelConfig(modelConfig);
      } catch { /* ignore */ }
    };
    detect();
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const api = await checkHermesApiServer();
        if (!cancelled) setHermesApi(api);
      } catch { /* ignore */ }
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ready]);

  const updateConfig = async (next: AppConfig) => {
    setConfig(next);
    await saveConfig(next);
  };

  const refreshHermesApi = async () => {
    const status = await checkHermesApiServer();
    setHermesApi(status);
    return status;
  };

  const refreshHermesCli = async () => {
    const status = await checkHermes();
    setHermesCli(status);
    return status;
  };

  const current = navItems.find((item) => item.id === active) ?? navItems[0];

  if (showOnboarding) {
    return <Onboarding config={config} updateConfig={updateConfig} hermesCli={hermesCli} hermesApi={hermesApi} />;
  }

  return (
    <div className="h-screen overflow-hidden bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r bg-card lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 border-b px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">AI Agent Workspace</div>
            <div className="text-xs text-muted-foreground">U 盘交付版</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  selected ? "bg-[#EEF2FF] font-medium text-[#4F46E5] dark:bg-indigo-500/16 dark:text-indigo-300" : "text-muted-foreground hover:bg-[#F1F5F9] hover:text-foreground dark:hover:bg-slate-800"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t p-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 本地桌面 App</div>
          <div className="mt-1 text-[10px] opacity-70">AI Agent Workspace v0.1.1</div>
        </div>
      </aside>

      <div className="flex h-screen min-h-0 flex-col lg:pl-72">
        <header className="shrink-0 z-20 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <select
              className="h-9 rounded-xl border bg-background px-2 text-sm lg:hidden"
              value={active}
              onChange={(event) => setActive(event.target.value as RouteId)}
            >
              {navItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <div className="min-w-0">
            <h1 className="text-lg font-semibold">{current.label}</h1>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={() => setDark(!dark)} title="切换深色模式">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

        <main className={cn("min-h-0 flex-1 p-4 md:p-6", active === "chat" ? "overflow-hidden" : "overflow-y-auto")}>
          {!ready ? (
            <div className="flex h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在加载本地配置</div>
          ) : (
            <Page active={active} setActive={setActive} chatDraft={chatDraft} setChatDraft={setChatDraft} pendingNewSessionTitle={pendingNewSessionTitle} setPendingNewSessionTitle={setPendingNewSessionTitle} config={config} updateConfig={updateConfig} hermesCli={hermesCli} hermesApi={hermesApi} hermesModelConfig={hermesModelConfig} setHermesModelConfig={setHermesModelConfig} refreshHermesCli={refreshHermesCli} refreshHermesApi={refreshHermesApi} cronOverview={cronOverview} setCronOverview={setCronOverview} cronCliStatus={cronCliStatus} setCronCliStatus={setCronCliStatus} cronLastLoadedAt={cronLastLoadedAt} setCronLastLoadedAt={setCronLastLoadedAt} />
          )}
        </main>
      </div>
    </div>
  );
}

function Onboarding({ config, updateConfig, hermesCli, hermesApi }: { config: AppConfig; updateConfig: (next: AppConfig) => Promise<void>; hermesCli: HermesStatus | null; hermesApi: HermesApiServerStatus | null }) {
  const [draft, setDraft] = useState({ ...config, baseUrl: config.baseUrl || DEFAULT_CONFIG.baseUrl });
  const [showToken, setShowToken] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const hermesInstalled = hermesCli?.installed;
  const hermesRunning = hermesApi?.running;

  const providerMap: Record<string, string> = { "deepseek-v4-flash": "deepseek", "deepseek-v4-pro": "deepseek", "kimi-k2.6": "kimi-coding" };

  const applyAndEnter = async () => {
    setApplying(true);
    setResult(null);
    try {
      if (!draft.apiKey.trim()) throw new Error("请填写专属模型供应 Token");
      // Test token first
      const modelsResult = await listModels(draft.baseUrl, draft.apiKey);
      if (!modelsResult.ok) throw new Error(modelsResult.error || "Token 连接测试失败");
      // Apply to Hermes if installed
      if (hermesInstalled) {
        try {
          await applyHermesModelConfig(draft.apiKey, draft.defaultModel);
        } catch { /* non-fatal: config write failed but we can still enter */ }
      }
      await updateConfig({ ...draft, selectedEngine: "hermes", hasCompletedOnboarding: true });
      setResult({ ok: true, message: "配置完成，正在进入工作台…" });
    } catch (error) {
      setResult({ ok: false, message: getErrorMessage(error) });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-6 lg:grid-cols-[1fr_440px]">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#6366F1] via-[#4F46E5] to-[#06B6D4] p-8 text-white shadow-xl">
          <div className="relative space-y-5">
            <Badge className="border-white/30 bg-white/20 text-white">U 盘交付版</Badge>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">欢迎使用 AI Agent 工作台</h1>
              <p className="mt-3 text-sm leading-6 text-white/80">你的个人 Hermes Agent 桌面助手。填写 Token、选择模型，即可开始使用。</p>
            </div>
            <div className="grid gap-3 text-sm text-white/85">
              <div className="rounded-xl bg-white/10 p-3">Hermes 是长期运行的个人 Agent，负责对话、记忆和工作流。</div>
              <div className="rounded-xl bg-white/10 p-3">Token 用于调用 DeepSeek / Kimi 模型服务，额度用完后可联系续费。</div>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>初始化配置</CardTitle>
            <CardDescription>填写 Token、选择模型，点击应用即可完成配置。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={cn("rounded-xl border p-3 text-sm", hermesRunning ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : hermesInstalled ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400")}>
              {!hermesCli
                ? "正在检测本机 Hermes…"
                : hermesRunning
                ? "Hermes 对话服务运行中，可以正常使用。"
                : hermesInstalled
                  ? "Hermes 已安装，但对话服务未运行。配置完成后请启动 Hermes。"
                  : "未检测到 Hermes。进入工作台后可通过 Hermes 管理页查看安装方式。"}
            </div>
            <Field label="专属模型供应 Token">
              <div className="flex gap-2">
                <Input type={showToken ? "text" : "password"} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="请输入 Token" />
                <Button variant="outline" size="icon" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              </div>
            </Field>
            <Field label="Hermes 使用模型">
              <select className="w-full rounded-xl border bg-background px-3 py-2 text-sm" value={draft.defaultModel} onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value as typeof draft.defaultModel })}>
                <option value="deepseek-v4-flash">deepseek-v4-flash（快速）</option>
                <option value="deepseek-v4-pro">deepseek-v4-pro（高质量）</option>
                <option value="kimi-k2.6">kimi-k2.6（长文本）</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Provider：{providerMap[draft.defaultModel] || "custom"}</p>
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button className="w-full" disabled={applying || !draft.apiKey.trim()} onClick={applyAndEnter}>{applying && <Loader2 className="h-4 w-4 animate-spin" />}应用并进入</Button>
              <Button variant="outline" className="w-full" onClick={() => updateConfig({ ...draft, selectedEngine: "hermes", hasCompletedOnboarding: true })}>跳过，直接进入</Button>
            </div>
            {result && <div className={cn("rounded-xl border p-3 text-sm", result.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400")}>{result.message}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Page({ active, setActive, chatDraft, setChatDraft, pendingNewSessionTitle, setPendingNewSessionTitle, config, updateConfig, hermesCli, hermesApi, hermesModelConfig, setHermesModelConfig, refreshHermesCli, refreshHermesApi, cronOverview, setCronOverview, cronCliStatus, setCronCliStatus, cronLastLoadedAt, setCronLastLoadedAt }: { active: RouteId; setActive: (id: RouteId) => void; chatDraft: string; setChatDraft: (value: string) => void; pendingNewSessionTitle: string; setPendingNewSessionTitle: (v: string) => void; config: AppConfig; updateConfig: (next: AppConfig) => Promise<void>; hermesCli: HermesStatus | null; hermesApi: HermesApiServerStatus | null; hermesModelConfig: HermesModelConfig | null; setHermesModelConfig: (value: HermesModelConfig | null) => void; refreshHermesCli: () => Promise<HermesStatus>; refreshHermesApi: () => Promise<HermesApiServerStatus>; cronOverview: HermesCronOverview | null; setCronOverview: (v: HermesCronOverview | null) => void; cronCliStatus: HermesCronCliStatus | null; setCronCliStatus: (v: HermesCronCliStatus | null) => void; cronLastLoadedAt: number; setCronLastLoadedAt: (v: number) => void }) {
  if (active === "home") return <HomePage config={config} setActive={setActive} hermesCli={hermesCli} hermesApi={hermesApi} hermesModelConfig={hermesModelConfig} />;
  if (active === "chat") return <ChatPage config={config} hermesCli={hermesCli} hermesApi={hermesApi} refreshHermesApi={refreshHermesApi} setActive={setActive} initialDraft={chatDraft} onDraftConsumed={() => setChatDraft("")} pendingNewSessionTitle={pendingNewSessionTitle} onNewSessionCreated={() => setPendingNewSessionTitle("")} />;
  if (active === "engines") return <EnginesPage config={config} updateConfig={updateConfig} hermesCli={hermesCli} hermesApi={hermesApi} hermesModelConfig={hermesModelConfig} setHermesModelConfig={setHermesModelConfig} refreshHermesCli={refreshHermesCli} refreshHermesApi={refreshHermesApi} />;
  if (active === "skills") return <SkillsPage config={config} updateConfig={updateConfig} setActive={setActive} setChatDraft={setChatDraft} setPendingNewSessionTitle={setPendingNewSessionTitle} />;
  if (active === "memory") return <MemoryPage />;
  if (active === "tasks") return <TasksPage cronOverview={cronOverview} setCronOverview={setCronOverview} cronCliStatus={cronCliStatus} setCronCliStatus={setCronCliStatus} cronLastLoadedAt={cronLastLoadedAt} setCronLastLoadedAt={setCronLastLoadedAt} />;
  if (active === "usage") return <UsagePage />;
  if (active === "tutorials") return <TutorialsPage config={config} />;
  return <AboutPage config={config} updateConfig={updateConfig} />;
}

function HomePage({ config, setActive, hermesCli, hermesApi, hermesModelConfig }: { config: AppConfig; setActive: (id: RouteId) => void; hermesCli: HermesStatus | null; hermesApi: HermesApiServerStatus | null; hermesModelConfig: HermesModelConfig | null }) {
  const agentConnected = hermesApi?.running;
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#06B6D4] p-6 text-white shadow-lg md:p-8">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">AI Agent 工作台</h2>
            <p className="mt-1 text-sm text-white/80">你的个人 Hermes Agent 桌面助手</p>
          </div>
          <Badge className="self-start border-white/30 bg-white/20 text-white">
            {hermesApi ? (agentConnected ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Moon className="mr-1 h-3 w-3" />) : <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {!hermesApi ? "正在检测" : agentConnected ? "Hermes 已连接" : hermesCli?.installed ? "对话服务未运行" : "未检测到 Hermes"}
          </Badge>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Hermes 状态" value={!hermesApi ? "检测中" : agentConnected ? "已连接" : hermesCli?.installed ? "服务未运行" : "未安装"} tone={agentConnected ? "success" : hermesCli?.installed ? "warning" : "danger"} />
        <Metric label="当前模型" value={hermesModelConfig?.model || config.defaultModel} tone="info" />
        <Metric label="Token 状态" value={config.apiKey ? "已配置" : "未配置"} tone={config.apiKey ? "success" : "warning"} />
        <Metric label="已启用 Skills" value={`${config.enabledSkills.length} 个`} tone="info" />
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>快速开始</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Button onClick={() => setActive("chat")} className="h-auto flex-col gap-1 p-5">
            <MessageSquare className="h-6 w-6" />
            <span className="text-sm font-semibold">开始对话</span>
          </Button>
          <Button variant="outline" onClick={() => setActive("engines")} className="h-auto flex-col gap-1 p-5">
            <Bot className="h-6 w-6" />
            <span className="text-sm font-semibold">配置 Hermes</span>
          </Button>
          <Button variant="outline" onClick={() => setActive("skills")} className="h-auto flex-col gap-1 p-5">
            <PackageOpen className="h-6 w-6" />
            <span className="text-sm font-semibold">Skill Center</span>
          </Button>
          <Button variant="outline" onClick={() => setActive("memory")} className="h-auto flex-col gap-1 p-5">
            <FileText className="h-6 w-6" />
            <span className="text-sm font-semibold">Hermes 记忆</span>
          </Button>
        </CardContent>
      </Card>

      {/* Token Warning */}
      {!config.apiKey && (
        <Card accent="#F59E0B">
          <CardHeader><CardTitle>请先配置专属模型供应 Token</CardTitle><CardDescription>Token 用于让 Hermes Agent 调用 DeepSeek / Kimi 模型。额度用完后可联系商家续费。</CardDescription></CardHeader>
          <CardContent><Button onClick={() => setActive("engines")}><Settings2 className="h-4 w-4" />去配置</Button></CardContent>
        </Card>
      )}

      {/* Not connected warning */}
      {config.apiKey && !agentConnected && hermesApi && (
        <Card accent="#F59E0B">
          <CardHeader><CardTitle>Hermes 对话服务未运行</CardTitle><CardDescription>{hermesCli?.installed ? "请确认 Hermes 已启动。" : "请先安装 Hermes。"}</CardDescription></CardHeader>
          <CardContent><Button variant="outline" onClick={() => setActive("engines")}>前往 Hermes 管理</Button></CardContent>
        </Card>
      )}
    </div>
  );
}

const REASONING_LEVELS = [
  { value: "none", label: "关闭" },
  { value: "low", label: "轻量" },
  { value: "medium", label: "标准" },
  { value: "high", label: "深度" },
  { value: "xhigh", label: "极深" },
] as const;

function ReasoningEffortControl({ hermesModelConfig, setHermesModelConfig, config, updateConfig }: { hermesModelConfig: HermesModelConfig | null; setHermesModelConfig: (v: HermesModelConfig | null) => void; config: AppConfig; updateConfig: (next: AppConfig) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const current = hermesModelConfig?.reasoningEffort || "medium";

  const handleChange = async (effort: string) => {
    setSaving(true);
    setMsg("");
    try {
      const res = await applyHermesReasoningConfig(effort);
      if (res.verifiedConfig) setHermesModelConfig(res.verifiedConfig);
      setMsg(`已设置为 ${REASONING_LEVELS.find((l) => l.value === effort)?.label || effort}`);
    } catch (err) {
      setMsg(`设置失败：${getErrorMessage(err)}`);
    } finally { setSaving(false); }
  };

  const handleToggleShow = () => {
    updateConfig({ ...config, showReasoning: !config.showReasoning });
  };

  return (
    <>
      <div className="space-y-1">
        <label className="text-sm font-medium">推理深度</label>
        <div className="flex flex-wrap gap-2">
          {REASONING_LEVELS.map((level) => (
            <Button key={level.value} size="sm" variant={current === level.value ? "default" : "outline"} disabled={saving} onClick={() => handleChange(level.value)}>{level.label}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">当前：{REASONING_LEVELS.find((l) => l.value === current)?.label || current}。更高强度可能增加响应时间和 token 消耗。</p>
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={config.showReasoning !== false} onCheckedChange={handleToggleShow} />
        <span className="text-sm">显示思考过程</span>
        <span className="text-xs text-muted-foreground">开启后 Agent 回复中会展示推理过程（默认折叠）。</span>
      </div>
      {msg && <div className="rounded-xl border bg-muted/30 p-2 text-xs text-muted-foreground">{msg}</div>}
    </>
  );
}

function EnginesPage({ config, updateConfig, hermesCli, hermesApi, hermesModelConfig, setHermesModelConfig, refreshHermesCli, refreshHermesApi }: { config: AppConfig; updateConfig: (next: AppConfig) => Promise<void>; hermesCli: HermesStatus | null; hermesApi: HermesApiServerStatus | null; hermesModelConfig: HermesModelConfig | null; setHermesModelConfig: (value: HermesModelConfig | null) => void; refreshHermesCli: () => Promise<HermesStatus>; refreshHermesApi: () => Promise<HermesApiServerStatus> }) {
  const [refreshing, setRefreshing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState(config.defaultModel);
  const [tokenDraft, setTokenDraft] = useState(config.apiKey);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showApplyPreview, setShowApplyPreview] = useState(false);
  const [readingConfig, setReadingConfig] = useState(false);

  useEffect(() => { setTokenDraft(config.apiKey); setSelectedModel(config.defaultModel); }, [config]);

  const providerMap: Record<string, string> = { "deepseek-v4-flash": "deepseek", "deepseek-v4-pro": "deepseek", "kimi-k2.6": "kimi-coding" };
  const currentProvider = providerMap[selectedModel] || "custom";

  const refreshAll = async () => {
    setRefreshing(true);
    try { await refreshHermesCli(); } catch { /* ignore */ }
    try { await refreshHermesApi(); } catch { /* ignore */ }
    try { const data = await readHermesModelConfig(); setHermesModelConfig(data); } catch { /* ignore */ }
    setRefreshing(false);
  };

  const readConfig = async () => {
    setReadingConfig(true);
    try { const data = await readHermesModelConfig(); setHermesModelConfig(data); } catch { /* ignore */ }
    setReadingConfig(false);
  };

  const testToken = async () => {
    setTesting(true); setResult(null);
    try {
      if (!tokenDraft.trim()) throw new Error("请先填写专属模型供应 Token");
      const res = await listModels(config.baseUrl, tokenDraft);
      if (!res.ok) throw new Error(res.error || "连接失败");
      const count = res.data?.data?.length ?? 0;
      setResult({ ok: true, message: `连接成功，可用模型 ${count} 个` });
    } catch (err) { setResult({ ok: false, message: getErrorMessage(err) }); }
    finally { setTesting(false); }
  };

  const saveConfig = async () => {
    await updateConfig({ ...config, apiKey: tokenDraft, defaultModel: selectedModel, hasCompletedOnboarding: true });
    setResult({ ok: true, message: "配置已保存到本地" });
  };

  const [applying, setApplying] = useState(false);
  const doApply = async () => {
    setApplying(true); setResult(null); setShowApplyPreview(false);
    try {
      if (!tokenDraft.trim()) throw new Error("请先填写专属模型供应 Token");
      const res = await applyHermesModelConfig(tokenDraft, selectedModel);
      if (!res.success) throw new Error("写入失败");
      await updateConfig({ ...config, apiKey: tokenDraft, defaultModel: selectedModel, hasCompletedOnboarding: true });
      if (res.verifiedConfig) {
        setHermesModelConfig(res.verifiedConfig);
        const verified = res.verifiedConfig as HermesModelConfig;
        if (verified.model !== selectedModel) {
          setResult({ ok: true, message: `配置已写入，但验证显示模型为 ${verified.model || "未知"}。若未生效请新建会话或重启 Hermes。` });
        } else {
          setResult({ ok: true, message: `配置已写入 Hermes。新建会话将使用 ${res.appliedModel}，当前会话不受影响。` });
        }
      } else {
        setResult({ ok: true, message: `配置已写入 Hermes。若当前对话仍使用旧模型，请新建会话。` });
      }
    } catch (err) { setResult({ ok: false, message: `写入失败：${getErrorMessage(err)}。已有配置未受影响，可在高级诊断查看备份路径。` }); }
    finally { setApplying(false); }
  };

  const hermesConnected = hermesApi?.running;
  const hermesInstalled = hermesCli?.installed;
  const hermesModel = hermesModelConfig?.model || null;
  const hermesProvider = hermesModelConfig?.provider || null;

  return (
    <div className="space-y-4">
      {/* 1. Status */}
      <Card accent="#6366F1">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Hermes 状态</CardTitle>
              <CardDescription>{hermesConnected ? "Hermes Agent 正在运行，可以正常对话。" : hermesInstalled ? "Hermes 已安装，但对话服务未运行。" : "未检测到 Hermes。"}</CardDescription>
            </div>
            <Badge tone={hermesConnected ? "success" : hermesInstalled ? "warning" : "danger"}>{hermesConnected ? "已连接" : hermesInstalled ? "未运行" : "未安装"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Hermes 程序" value={hermesCli ? (hermesInstalled ? "已安装" : "未安装") : "检测中"} tone={hermesInstalled ? "success" : "warning"} />
            <Metric label="对话服务" value={hermesApi ? (hermesConnected ? "已连接" : "未运行") : "检测中"} tone={hermesConnected ? "success" : "warning"} />
            <Metric label="Hermes 模型" value={hermesModel || "未读取"} tone={hermesModel ? "info" : "muted"} />
            <Metric label="Hermes Provider" value={hermesProvider || "未读取"} tone={hermesProvider ? "info" : "muted"} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={refreshing} onClick={refreshAll}>{refreshing && <Loader2 className="h-4 w-4 animate-spin" />}<RefreshCcw className="h-4 w-4" />刷新状态</Button>
            <span className="text-xs text-muted-foreground">最近检测：{hermesApi?.checkedAt || hermesCli?.checkedAt || "暂无"}</span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Model Config */}
      <Card>
        <CardHeader>
          <CardTitle>模型供应配置</CardTitle>
          <CardDescription>配置 Hermes Agent 使用的模型和 Token。额度用完后可联系商家续费。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">专属模型供应 Token</label>
            <div className="flex gap-2">
              <Input type={showKey ? "text" : "password"} value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="请输入 Token" />
              <Button variant="outline" size="icon" onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
            </div>
            <p className="text-xs text-muted-foreground">该 Token 用于让 Hermes Agent 调用 DeepSeek / Kimi 模型服务。请勿分享给他人。</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Hermes 使用模型</label>
            <select className="w-full rounded-xl border bg-background px-3 py-2 text-sm" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}>
              <option value="deepseek-v4-flash">deepseek-v4-flash（快速）</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro（高质量）</option>
              <option value="kimi-k2.6">kimi-k2.6（长文本）</option>
            </select>
            <p className="text-xs text-muted-foreground">Provider：{currentProvider} · 服务地址：{config.baseUrl}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={testing} onClick={testToken}>{testing && <Loader2 className="h-4 w-4 animate-spin" />}测试 Token</Button>
            <Button onClick={saveConfig}><Save className="h-4 w-4" />保存配置</Button>
            <Button variant="outline" onClick={() => setShowApplyPreview(true)}>应用到 Hermes</Button>
            <Button variant="outline" disabled={readingConfig} onClick={readConfig}>{readingConfig && <Loader2 className="h-4 w-4 animate-spin" />}读取 Hermes 配置</Button>
          </div>
          {result && <div className={cn("rounded-xl border p-3 text-sm", result.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400")}>{result.message}</div>}
        </CardContent>
      </Card>

      {/* 2.5 Reasoning Effort */}
      <Card>
        <CardHeader>
          <CardTitle>思考强度</CardTitle>
          <CardDescription>控制 Hermes Agent 的推理深度。是否生效取决于当前模型和模型供应服务是否支持。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReasoningEffortControl hermesModelConfig={hermesModelConfig} setHermesModelConfig={setHermesModelConfig} config={config} updateConfig={updateConfig} />
        </CardContent>
      </Card>

      {/* 3. Apply Preview Dialog */}
      {showApplyPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowApplyPreview(false)}>
          <Card className="max-h-[80vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>应用配置到 Hermes</CardTitle>
              <CardDescription>确认后将写入 Hermes 配置，新会话将使用新模型。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
                <div><span className="font-medium">模型：</span>{selectedModel}</div>
                <div><span className="font-medium">Provider：</span>{currentProvider}</div>
                <div><span className="font-medium">服务地址：</span>{config.baseUrl}</div>
                <div><span className="font-medium">Token：</span>{tokenDraft ? "已填写（不显示明文）" : "未填写"}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">写入前会自动备份现有配置。Token 将同时写入 DEEPSEEK_API_KEY 和 KIMI_API_KEY，方便后续切换模型。</div>
              <div className="flex gap-2">
                <Button disabled={applying || !tokenDraft.trim()} onClick={doApply}>{applying && <Loader2 className="h-4 w-4 animate-spin" />}确认应用</Button>
                <Button variant="outline" onClick={() => { navigator.clipboard.writeText(`hermes config set model.provider ${currentProvider}\nhermes config set model.default ${selectedModel}\nhermes config set model.base_url ${config.baseUrl}\nhermes config set model.api_mode chat_completions`); setShowApplyPreview(false); setResult({ ok: true, message: "命令已复制到剪贴板" }); }}><Copy className="h-4 w-4" />复制命令</Button>
                <Button variant="outline" onClick={() => setShowApplyPreview(false)}>取消</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 4. Advanced (collapsed) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">高级诊断</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{showAdvanced ? "收起" : "展开"}</Button>
          </div>
        </CardHeader>
        {showAdvanced && (
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div className="grid gap-1 rounded-xl border bg-muted/30 p-3">
              <div>Hermes 路径：{hermesCli?.binaryPath || "未找到"}</div>
              <div>配置文件：~/.hermes/config.yaml</div>
              <div>密钥文件：~/.hermes/.env（不读取内容）</div>
              <div>对话服务：http://127.0.0.1:8642/v1</div>
              <div>模型供应：{config.baseUrl}</div>
            </div>
            {hermesModelConfig?.exists && (
              <div className="grid gap-1 rounded-xl border bg-muted/30 p-3">
                <div className="font-medium">Hermes 当前配置：</div>
                <div>model = {hermesModelConfig.model || "未配置"}</div>
                <div>provider = {hermesModelConfig.provider || "未配置"}</div>
                <div>base_url = {hermesModelConfig.baseUrl || "未配置"}</div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

type ChatPhase = "ready" | "sending" | "thinking" | "running" | "done" | "error";

function ChatPage({ config, hermesCli, hermesApi, refreshHermesApi, setActive, initialDraft, onDraftConsumed, pendingNewSessionTitle, onNewSessionCreated }: { config: AppConfig; hermesCli: HermesStatus | null; hermesApi: HermesApiServerStatus | null; refreshHermesApi: () => Promise<HermesApiServerStatus>; setActive: (id: RouteId) => void; initialDraft: string; onDraftConsumed: () => void; pendingNewSessionTitle: string; onNewSessionCreated: () => void }) {
  const [input, setInput] = useState(initialDraft);
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState("");
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const sessionsLoadedRef = useRef(false);
  const [sessionError, setSessionError] = useState("");
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStreamDiagnostics, setShowStreamDiagnostics] = useState(false);
  const [modeMessage, setModeMessage] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const isComposingRef = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastElapsed, setLastElapsed] = useState<number | null>(null);
  const [phase, setPhase] = useState<ChatPhase>("ready");
  const [elapsedLive, setElapsedLive] = useState(0);
  const [streamDiagnostics, setStreamDiagnostics] = useState<FrontStreamDiagnostics>(initialFrontStreamDiagnostics);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<UiChatMessage[]>([]);
  const chatSessionsRef = useRef<ChatSession[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const stoppedIdsRef = useRef<Set<string>>(new Set());
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const twRef = useRef<TypewriterState>({ contentBuf: "", reasoningBuf: "", done: false, skip: false, rafId: null, requestId: "" });
  const autoFollowRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const persistSessions = async (next: ChatSession[]) => {
    const sorted = sortSessions(next);
    chatSessionsRef.current = sorted;
    setChatSessions(sorted);
    try {
      await writeChatSessions(sorted);
      setSessionError("");
    } catch (err) {
      setSessionError(`历史会话保存失败：${getErrorMessage(err)}`);
    }
  };

  const createSession = async (title?: string) => {
    if (loading) return;
    cancelTypewriter();
    const session = createEmptySession("hermes-agent");
    if (title) session.title = title;
    const existing = chatSessionsRef.current;
    if (!sessionsLoadedRef.current && existing.length === 0) {
      console.warn("[ChatPage] createSession blocked: sessions not yet loaded");
      return;
    }
    const next = sortSessions([session, ...existing]);
    chatSessionsRef.current = next;
    currentSessionIdRef.current = session.id;
    setChatSessions(next);
    setCurrentSessionId(session.id);
    currentSessionIdRef.current = session.id;
    setMessages([]);
    messagesRef.current = [];
    setError("");
    setErrorDetail(null);
    setPhase("ready");
    setLastElapsed(null);
    setElapsedLive(0);
    try { await writeChatSessions(next); setSessionError(""); }
    catch (err) { setSessionError(`历史会话保存失败：${getErrorMessage(err)}`); }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const switchSession = (session: ChatSession) => {
    if (loading || session.id === currentSessionId) return;
    cancelTypewriter();
    setCurrentSessionId(session.id);
    const nextMessages = (session.messages || []) as UiChatMessage[];
    setMessages(nextMessages);
    messagesRef.current = nextMessages;
    setError("");
    setErrorDetail(null);
    setPhase("ready");
    setLastElapsed(null);
    setElapsedLive(0);
    autoFollowRef.current = true;
    setShowJumpToBottom(false);
    setMobileHistoryOpen(false);
    requestAnimationFrame(() => scheduleScrollToBottom(true));
  };

  const saveCurrentSession = async (nextMessages: UiChatMessage[], extra?: Partial<ChatSession>) => {
    const currentId = currentSessionIdRef.current;
    const sessions = chatSessionsRef.current;
    const session = sessions.find((item) => item.id === currentId) ?? createEmptySession("hermes-agent");
    const updated = updateSessionFromMessages(session, nextMessages, extra);
    const next = sessions.some((item) => item.id === updated.id)
      ? sessions.map((item) => item.id === updated.id ? updated : item)
      : [updated, ...sessions];
    currentSessionIdRef.current = updated.id;
    setCurrentSessionId(updated.id);
    await persistSessions(next);
  };

  const saveErrorSummary = (requestId: string, summary: string) => {
    const existing = messagesRef.current;
    const failedMessages = existing.some((message) => message.role === "assistant" && message.requestId === requestId)
      ? existing.map((message) => message.role === "assistant" && message.requestId === requestId ? { ...message, content: `请求失败：${summary}` } : message)
      : [...existing, { role: "assistant", source: "Hermes Agent", requestId, content: `请求失败：${summary}`, modelName: "hermes-agent" } as UiChatMessage];
    messagesRef.current = failedMessages;
    setMessages(failedMessages);
    void saveCurrentSession(failedMessages, { lastMessagePreview: `请求失败：${summary}` });
  };

  const cancelTypewriter = () => {
    if (twRef.current.rafId !== null) {
      cancelAnimationFrame(twRef.current.rafId);
      twRef.current.rafId = null;
    }
  };

  const runTypewriter = (requestId: string) => {
    const tw = twRef.current;
    if (tw.requestId !== requestId) return;
    if (tw.rafId !== null) return;

    const tick = () => {
      if (tw.skip) {
        const rem = tw.contentBuf;
        const rrem = tw.reasoningBuf;
        tw.contentBuf = "";
        tw.reasoningBuf = "";
        if (rem || rrem) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.role === "assistant" && m.requestId === requestId);
            if (idx < 0) return prev;
            const u = [...prev];
            u[idx] = { ...u[idx], content: (u[idx].content || "") + rem, reasoningContent: (u[idx].reasoningContent || "") + rrem };
            return u;
          });
        }
        tw.rafId = null;
        if (tw.done) {
          tw.skip = false; tw.done = false;
          setPhase("done");
          setLoading(false);
          activeRequestRef.current = null;
        }
        return;
      }

      const bufLen = tw.contentBuf.length;
      const rBufLen = tw.reasoningBuf.length;
      if (bufLen === 0 && rBufLen === 0) {
        if (tw.done) {
          tw.rafId = null;
          tw.done = false;
          setPhase("done");
          setLoading(false);
          activeRequestRef.current = null;
        } else {
          tw.rafId = null;
        }
        return;
      }

      let cc = 0;
      if (bufLen > 0) {
        if (bufLen > 2000) cc = 40;
        else if (bufLen > 800) cc = 24;
        else if (bufLen > 250) cc = 12;
        else if (bufLen > 60) cc = 6;
        else cc = Math.min(3, bufLen);
      }

      let rc = 0;
      if (rBufLen > 0) {
        if (rBufLen > 1200) rc = 28;
        else if (rBufLen > 400) rc = 14;
        else if (rBufLen > 80) rc = 6;
        else rc = Math.min(3, rBufLen);
      }

      const cChunk = cc > 0 ? tw.contentBuf.slice(0, cc) : "";
      const rChunk = rc > 0 ? tw.reasoningBuf.slice(0, rc) : "";
      if (cChunk) tw.contentBuf = tw.contentBuf.slice(cc);
      if (rChunk) tw.reasoningBuf = tw.reasoningBuf.slice(rc);

      if (cChunk || rChunk) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === "assistant" && m.requestId === requestId);
          if (idx < 0) return prev;
          const u = [...prev];
          u[idx] = {
            ...u[idx],
            content: cChunk ? (u[idx].content || "") + cChunk : u[idx].content,
            reasoningContent: rChunk ? (u[idx].reasoningContent || "") + rChunk : u[idx].reasoningContent,
          };
          return u;
        });
      }

      tw.rafId = requestAnimationFrame(tick);
    };

    tw.rafId = requestAnimationFrame(tick);
  };

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn());
      if (timerRef.current) clearInterval(timerRef.current);
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
      cancelTypewriter();
    };
  }, []);

  useEffect(() => {
    if (!initialDraft) return;
    setInput(initialDraft);
    onDraftConsumed();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      autoResize(inputRef.current);
    });
  }, [initialDraft, onDraftConsumed]);

  // When coming from Skill Center with a new session request
  useEffect(() => {
    if (!pendingNewSessionTitle || !sessionsLoaded) return;
    void createSession(pendingNewSessionTitle);
    onNewSessionCreated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewSessionTitle, sessionsLoaded]);

  useEffect(() => {
    let cancelled = false;
    readChatSessions()
      .then((stored) => {
        if (cancelled) return;
        const sorted = sortSessions((stored || []) as ChatSession[]);
        const initial = sorted.length > 0 ? sorted : [createEmptySession("hermes-agent")];
        chatSessionsRef.current = initial;
        currentSessionIdRef.current = initial[0]?.id ?? null;
        setChatSessions(initial);
        setCurrentSessionId(initial[0]?.id ?? null);
        const initialMessages = (initial[0]?.messages || []) as UiChatMessage[];
        setMessages(initialMessages);
        messagesRef.current = initialMessages;
        setSessionsLoaded(true);
        sessionsLoadedRef.current = true;
        if (sorted.length === 0) void persistSessions(initial);
      })
      .catch((err) => {
        console.warn("Failed to read chat sessions", err);
        if (cancelled) return;
        const session = createEmptySession("hermes-agent");
        chatSessionsRef.current = [session];
        currentSessionIdRef.current = session.id;
        setChatSessions([session]);
        setCurrentSessionId(session.id);
        setSessionsLoaded(true);
        sessionsLoadedRef.current = true;
        setSessionError("历史会话文件无法读取，已临时重建为空历史。后续保存成功后会恢复正常。");
      });
    return () => { cancelled = true; };
  }, []);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scheduleScrollToBottom = (force = false, smooth = false) => {
    if (!force && !autoFollowRef.current) return;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  };

  const handleMessageScroll = () => {
    const near = isNearBottom();
    if (near !== autoFollowRef.current) {
      autoFollowRef.current = near;
      setShowJumpToBottom(!near);
    }
  };

  const jumpToBottom = () => {
    autoFollowRef.current = true;
    setShowJumpToBottom(false);
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  };

  useEffect(() => {
    scheduleScrollToBottom(false);
  }, [messages, loading]);

  // Initial load / session switch: scroll to bottom instantly
  useEffect(() => {
    autoFollowRef.current = true;
    setShowJumpToBottom(false);
    if (messages.length > 0) {
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
      }, 0);
    }
  }, [currentSessionId, sessionsLoaded]);

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    autoResize(e.target);
  };

  const skipTypewriter = () => {
    twRef.current.skip = true;
    runTypewriter(twRef.current.requestId);
  };

  const resetSession = () => { void createSession(); };

  const renameSession = async (session: ChatSession) => {
    const title = window.prompt("重命名对话", session.title)?.trim();
    if (!title) return;
    await persistSessions(chatSessions.map((item) => item.id === session.id ? { ...item, title, updatedAt: nowStamp() } : item));
  };

  const togglePinSession = async (session: ChatSession) => {
    await persistSessions(chatSessions.map((item) => item.id === session.id ? { ...item, pinned: !item.pinned, updatedAt: nowStamp() } : item));
  };

  const deleteSession = async (sessionId: string) => {
    const next = chatSessions.filter((session) => session.id !== sessionId);
    if (next.length === 0) {
      const fresh = createEmptySession("hermes-agent");
      setCurrentSessionId(fresh.id);
      currentSessionIdRef.current = fresh.id;
      setMessages([]);
      messagesRef.current = [];
      await persistSessions([fresh]);
      return;
    }
    const sorted = sortSessions(next);
    if (currentSessionId === sessionId) {
      setCurrentSessionId(sorted[0]!.id);
      currentSessionIdRef.current = sorted[0]!.id;
      const nextMessages = (sorted[0]!.messages || []) as UiChatMessage[];
      setMessages(nextMessages);
      messagesRef.current = nextMessages;
    }
    await persistSessions(sorted);
  };

  const clearHistory = async () => {
    const fresh = createEmptySession("hermes-agent");
    setCurrentSessionId(fresh.id);
    currentSessionIdRef.current = fresh.id;
    setMessages([]);
    messagesRef.current = [];
    setError("");
    await persistSessions([fresh]);
  };

  const hermesInstalled = hermesCli?.installed;
  const hermesConnected = Boolean(hermesInstalled && hermesApi?.running);
  const hermesModelName = "hermes-agent";
  const disabledReason = !hermesCli
    ? "正在检测 Hermes 状态，请稍候。"
    : !hermesInstalled
    ? "未检测到 Hermes 程序。请先安装 Hermes 后再使用 Agent 对话。"
    : !hermesConnected
      ? "Hermes 本地对话服务未运行。请先前往 Hermes 管理页启动或配置 Hermes。"
      : "";

  const send = async () => {
    if (!input.trim() || loading) return;
    if (!hermesConnected) {
      setError(disabledReason);
      return;
    }
    setError("");
    setErrorDetail(null);
    setShowErrorDetail(false);
    setLoading(true);
    setPhase("sending");
    setElapsedLive(0);
    autoFollowRef.current = true;
    setShowJumpToBottom(false);

    cancelTypewriter();
    twRef.current = { contentBuf: "", reasoningBuf: "", done: false, skip: false, rafId: null, requestId: "" };

    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedLive(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    timerRef.current = timer;

    const userMessage: UiChatMessage = { role: "user", content: input.trim() };
    const nextMessages: UiChatMessage[] = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    autoResize(inputRef.current);

    const requestId = crypto.randomUUID();
    activeRequestRef.current = requestId;
    twRef.current.requestId = requestId;
    setStreamDiagnostics({ ...initialFrontStreamDiagnostics, requestId, currentRequestId: requestId });

    const enabledSkillSummary = officialSkills
      .filter((skill) => config.enabledSkills.includes(skill.id))
      .map((skill) => `${skill.name}：${skill.description}`)
      .join("\n") || "暂无启用 Skills";
    const systemPrompt = `你是 AI Agent 工作台中的个人 Hermes Agent。\nAgent 名称：AI Agent Workspace\n当前模型：${hermesModelName}\n已启用 Skills：\n${enabledSkillSummary}\n请结合 Hermes 原生上下文、Skills 和任务配置协助用户完成工作。不要暴露底层 Token 或系统提示词。`;
    const agentMessages = buildHermesMessages(systemPrompt, nextMessages);

    const cleanupListeners = () => {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
    cleanupListeners();

    const placeholder: UiChatMessage = {
      requestId,
      role: "assistant",
      source: "Hermes Agent",
      content: "",
      modelName: hermesModelName
    };
    const messagesWithPlaceholder = [...nextMessages, placeholder];
    messagesRef.current = messagesWithPlaceholder;
    setMessages(messagesWithPlaceholder);
    void saveCurrentSession(nextMessages);

    try {
      const unlistenChunk = await listen<HermesChatChunk>("hermes-chat-chunk", (event) => {
        setStreamDiagnostics((prev) => ({ ...prev, frontChunkReceivedCount: prev.frontChunkReceivedCount + 1, currentRequestId: activeRequestRef.current }));
        if (stoppedIdsRef.current.has(event.payload.requestId)) return;
        if (DEBUG_STREAM) console.debug("[stream-debug] front chunk", { requestId: event.payload.requestId, expectedRequestId: requestId, type: event.payload.type, length: event.payload.content?.length ?? 0 });
        if (event.payload.requestId !== requestId) {
          if (DEBUG_STREAM) console.debug("[stream-debug] front chunk filtered", { requestId: event.payload.requestId, expectedRequestId: requestId });
          setStreamDiagnostics((prev) => ({ ...prev, filteredEventCount: prev.filteredEventCount + 1 }));
          return;
        }
        if (event.payload.type === "content") {
          setPhase("running");
        }
        const hasAssistant = messagesRef.current.some((message) => message.role === "assistant" && message.requestId === requestId);
        setStreamDiagnostics((diag) => hasAssistant
          ? { ...diag, frontChunkAppliedCount: diag.frontChunkAppliedCount + 1 }
          : { ...diag, missingAssistantPlaceholderCount: diag.missingAssistantPlaceholderCount + 1 });
        if (!hasAssistant && DEBUG_STREAM) console.debug("[stream-debug] front chunk missing assistant", { requestId });
        const raw = event.payload.content || "";
        if (event.payload.type === "reasoning") {
          twRef.current.reasoningBuf += raw;
        } else {
          twRef.current.contentBuf += raw;
        }
        runTypewriter(requestId);
      });
      unlistenRef.current.push(unlistenChunk);

      const unlistenTool = await listen<HermesToolProgress>("hermes-tool-progress", (event) => {
        setStreamDiagnostics((prev) => ({ ...prev, toolProgressReceivedCount: prev.toolProgressReceivedCount + 1, currentRequestId: activeRequestRef.current }));
        if (stoppedIdsRef.current.has(event.payload.requestId)) return;
        if (DEBUG_STREAM) console.debug("[stream-debug] front tool", { requestId: event.payload.requestId, expectedRequestId: requestId, length: event.payload.data?.length ?? 0 });
        if (event.payload.requestId !== requestId) {
          setStreamDiagnostics((prev) => ({ ...prev, filteredEventCount: prev.filteredEventCount + 1 }));
          return;
        }
        const hasAssistant = messagesRef.current.some((message) => message.role === "assistant" && message.requestId === requestId);
        if (!hasAssistant) setStreamDiagnostics((diag) => ({ ...diag, missingAssistantPlaceholderCount: diag.missingAssistantPlaceholderCount + 1 }));
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((message) => message.role === "assistant" && message.requestId === requestId);
          if (idx < 0) {
            return prev;
          }
          const last = updated[idx];
          const current = last.toolEvents || [];
          updated[idx] = { ...last, toolEvents: [...current, event.payload.data] };
          return updated;
        });
      });
      unlistenRef.current.push(unlistenTool);

      const unlistenStreamDiagnostics = await listen<HermesStreamDiagnostics>("hermes-stream-diagnostics", (event) => {
        if (event.payload.requestId !== requestId) {
          setStreamDiagnostics((prev) => ({ ...prev, filteredEventCount: prev.filteredEventCount + 1 }));
          return;
        }
        if (DEBUG_STREAM) console.debug("[stream-debug] front rust diagnostics", event.payload.diagnostics);
        setStreamDiagnostics((prev) => ({ ...prev, rust: { ...prev.rust, ...event.payload.diagnostics }, currentRequestId: activeRequestRef.current }));
      });
      unlistenRef.current.push(unlistenStreamDiagnostics);

      const unlistenDone = await listen<HermesChatDone>("hermes-chat-done", (event) => {
        setStreamDiagnostics((prev) => ({ ...prev, doneReceivedCount: prev.doneReceivedCount + 1, doneReceived: true, currentRequestId: activeRequestRef.current, rust: { ...prev.rust, ...(event.payload.diagnostics || {}) } }));
        if (stoppedIdsRef.current.has(event.payload.requestId)) {
          stoppedIdsRef.current.delete(event.payload.requestId);
          cleanupListeners();
          return;
        }
        if (DEBUG_STREAM) console.debug("[stream-debug] front done", { requestId: event.payload.requestId, expectedRequestId: requestId, contentLength: event.payload.content?.length ?? 0, reasoningLength: event.payload.reasoningContent?.length ?? 0, diagnostics: event.payload.diagnostics });
        if (event.payload.requestId !== requestId) {
          setStreamDiagnostics((prev) => ({ ...prev, filteredEventCount: prev.filteredEventCount + 1 }));
          return;
        }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const hasAssistant = messagesRef.current.some((message) => message.role === "assistant" && message.requestId === requestId);
        if (!hasAssistant) setStreamDiagnostics((diag) => ({ ...diag, missingAssistantPlaceholderCount: diag.missingAssistantPlaceholderCount + 1 }));
        const currentAssistant = messagesRef.current.find((message) => message.role === "assistant" && message.requestId === requestId);
        const displayedContentLength = currentAssistant?.content?.length ?? 0;
        const displayedReasoningLength = currentAssistant?.reasoningContent?.length ?? 0;
        const pendingContentLength = twRef.current.contentBuf.length;
        const pendingReasoningLength = twRef.current.reasoningBuf.length;
        const finalContent = event.payload.content || "";
        const finalReasoning = event.payload.reasoningContent || "";
        if (finalContent.length > displayedContentLength + pendingContentLength) {
          twRef.current.contentBuf += finalContent.slice(displayedContentLength + pendingContentLength);
        }
        if (finalReasoning.length > displayedReasoningLength + pendingReasoningLength) {
          twRef.current.reasoningBuf += finalReasoning.slice(displayedReasoningLength + pendingReasoningLength);
        }
        twRef.current.done = true;
        setLoading(false);
        setPhase("done");
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.role === "assistant" && m.requestId === requestId);
          if (idx < 0) return prev;
          const u = [...prev];
          u[idx] = {
            ...u[idx],
            modelName: event.payload.model,
            usage: event.payload.rawUsage ?? null,
            sessionId: event.payload.sessionId,
            elapsedMs: event.payload.elapsedMs,
            partial: Boolean(event.payload.partial),
            warning: event.payload.warning
          };
          return u;
        });
        setLastElapsed(event.payload.elapsedMs);
        if (event.payload.sessionId) setSessionId(event.payload.sessionId);
        setModeMessage("");
        if (event.payload.partial && !event.payload.stopped) {
          setErrorDetail(`流式连接提前结束，已保留已生成内容。\n错误：${event.payload.streamError || event.payload.warning || "unknown"}`);
          setShowErrorDetail(false);
        }
        const finalMessages = messagesRef.current.map((message) => {
          if (message.role !== "assistant" || message.requestId !== requestId) return message;
          return {
            ...message,
            content: event.payload.content || message.content || "",
            reasoningContent: event.payload.reasoningContent || message.reasoningContent,
            modelName: event.payload.model,
            usage: event.payload.rawUsage ?? null,
            sessionId: event.payload.sessionId,
            elapsedMs: event.payload.elapsedMs,
            partial: Boolean(event.payload.partial),
            warning: event.payload.warning
          };
        });
        void saveCurrentSession(finalMessages, { hermesSessionId: event.payload.sessionId, model: event.payload.model });
        runTypewriter(requestId);
        cleanupListeners();
      });
      unlistenRef.current.push(unlistenDone);

      const unlistenErr = await listen<HermesChatError>("hermes-chat-error", (event) => {
        setStreamDiagnostics((prev) => ({ ...prev, errorReceivedCount: prev.errorReceivedCount + 1, currentRequestId: activeRequestRef.current }));
        if (stoppedIdsRef.current.has(event.payload.requestId)) return;
        if (event.payload.requestId !== requestId) {
          setStreamDiagnostics((prev) => ({ ...prev, filteredEventCount: prev.filteredEventCount + 1 }));
          return;
        }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        cancelTypewriter();
        setError("Hermes 请求失败，请检查本地对话服务或 Hermes 模型供应配置。");
        setErrorDetail(`请求目标：Hermes 对话服务\nURL：${event.payload.url ?? "http://127.0.0.1:8642/v1/chat/completions"}\nHTTP 状态：${event.payload.status ?? "error"}\n错误：${event.payload.error}`);
        saveErrorSummary(requestId, event.payload.error);
        setPhase("error");
        setLoading(false);
        activeRequestRef.current = null;
        cleanupListeners();
      });
      unlistenRef.current.push(unlistenErr);
      setStreamDiagnostics((prev) => ({ ...prev, listenRegistered: true, currentRequestId: activeRequestRef.current }));
      if (DEBUG_STREAM) console.debug("[stream-debug] front listeners registered", { requestId });

      const latestHermesApi = hermesApi?.running ? hermesApi : await refreshHermesApi();
      if (!latestHermesApi?.running || !latestHermesApi.baseUrl) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        cancelTypewriter();
        setError("Hermes 本地对话服务未运行。请先前往 Hermes 管理页启动或配置 Hermes。");
        setErrorDetail(`请求目标：Hermes 对话服务\nURL：http://127.0.0.1:8642/v1/chat/completions\n模型：${hermesModelName}\nHTTP 状态：unavailable\n错误：Hermes API Server 未运行`);
        saveErrorSummary(requestId, "Hermes API Server 未运行");
        setPhase("error");
        setLoading(false);
        activeRequestRef.current = null;
        cleanupListeners();
        return;
      }

      setPhase("thinking");
      const result = await hermesChatCompletion(requestId, hermesModelName, agentMessages);
      if (!result.success) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        cancelTypewriter();
        setError(result.error || "请求提交失败");
        saveErrorSummary(requestId, result.error || "请求提交失败");
        setPhase("error");
        setLoading(false);
        activeRequestRef.current = null;
        cleanupListeners();
      }
    } catch (err) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      cancelTypewriter();
      const message = getErrorMessage(err);
      setError(`请求异常：${message}`);
      saveErrorSummary(requestId, message);
      setPhase("error");
      setLoading(false);
      activeRequestRef.current = null;
      cleanupListeners();
    }
  };

  const stopGeneration = () => {
    const rid = activeRequestRef.current;
    if (!rid) return;
    stoppedIdsRef.current.add(rid);
    activeRequestRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    cancelTypewriter();
    setLoading(false);
    setPhase("ready");
    // Mark current assistant message as stopped, or remove if empty
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === "assistant" && m.requestId === rid);
      if (idx < 0) return prev;
      const u = [...prev];
      const msg = u[idx]!;
      const finalContent = (msg.content || "") + twRef.current.contentBuf;
      const finalReasoning = (msg.reasoningContent || "") + twRef.current.reasoningBuf;
      if (!finalContent.trim() && !finalReasoning.trim()) {
        // No content generated — remove the placeholder, add a system notice
        u.splice(idx, 1);
        u.push({ role: "system" as any, content: "", requestId: rid, stopped: true } as any);
      } else {
        u[idx] = { ...msg, content: finalContent, reasoningContent: finalReasoning, partial: true, warning: "已停止生成" };
      }
      messagesRef.current = u;
      return u;
    });
    twRef.current = { contentBuf: "", reasoningBuf: "", done: true, skip: false, rafId: null, requestId: "" };
    // Save session with stopped content
    void saveCurrentSession(messagesRef.current);
    // Tell Rust to stop (best effort, non-blocking)
    void cancelHermesChatCompletion(rid).catch(() => {});
  };

  const regenLast = () => {
    if (messages.length < 2) return;
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx < 0) return;
    const trimmed = messages.slice(0, messages.length - lastUserIdx - 1);
    const lastUser = messages[trimmed.length] as UiChatMessage;
    setMessages(trimmed);
    setInput(lastUser.content);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      autoResize(inputRef.current);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (isComposing || isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!input.trim() || loading) return;
    send();
  };

  const filteredSessions = sortSessions(chatSessions).filter((session) => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return true;
    return session.title.toLowerCase().includes(query)
      || session.lastMessagePreview?.toLowerCase().includes(query)
      || session.messages.some((message) => message.content.toLowerCase().includes(query));
  });

  return (
    <div className="mx-auto grid h-full min-h-0 max-w-7xl gap-4 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="hidden min-h-0 flex-col overflow-hidden lg:flex">
        <CardHeader className="shrink-0 border-b py-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">历史对话</CardTitle>
            <Button size="sm" onClick={resetSession}><Plus className="h-4 w-4" />新建</Button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="搜索历史" />
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-2" onClick={() => setMenuOpenId(null)}>
          {sessionError && <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{sessionError}</div>}
          {!sessionsLoaded && <div className="p-3 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在加载历史</div>}
          {filteredSessions.map((session) => (
            <div key={session.id} className={cn("group relative rounded-xl border", session.id === currentSessionId ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/50")}>
              <button className="flex w-full items-start gap-2 p-2 text-left" disabled={loading} onClick={() => { setMenuOpenId(null); switchSession(session); }}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{session.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{session.lastMessagePreview || "暂无消息"}</div>
                </div>
                {session.pinned && <Pin className="mt-1 h-3 w-3 shrink-0 text-primary/60" />}
              </button>
              <div className="absolute right-1 top-1">
                <Button variant="ghost" size="icon" className={cn("h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100", menuOpenId === session.id && "opacity-100")} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === session.id ? null : session.id); }}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
                {menuOpenId === session.id && (
                  <div className="absolute right-0 top-8 z-20 min-w-[100px] rounded-xl border bg-card p-1 shadow-lg">
                    <button className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { renameSession(session); setMenuOpenId(null); }}>重命名</button>
                    <button className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { togglePinSession(session); setMenuOpenId(null); }}>{session.pinned ? "取消置顶" : "置顶"}</button>
                    <button className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-500/10" onClick={() => { setDeleteSessionId(session.id); setMenuOpenId(null); }}>删除</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filteredSessions.length === 0 && <div className="p-3 text-sm text-muted-foreground">没有匹配的历史对话。</div>}
        </CardContent>
        <div className="shrink-0 border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setConfirmClearHistory(true)}>清空全部历史</Button>
        </div>
      </Card>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b bg-background/80 py-2.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs">
              <span className={cn("h-2 w-2 rounded-full", hermesConnected ? "bg-emerald-500" : hermesInstalled ? "bg-amber-500" : "bg-rose-500")} />
              {hermesConnected ? "Hermes 已连接" : hermesInstalled ? "对话服务未运行" : "未安装"}
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            {hermesConnected && <PhaseBadge phase={phase} />}
            {(phase === "sending" || phase === "thinking" || phase === "running") && <span className="text-xs text-muted-foreground">已耗时 {elapsedLive}s</span>}
            {phase === "done" && lastElapsed != null && <span className="text-xs text-muted-foreground">耗时 {lastElapsed >= 1000 ? `${Math.round(lastElapsed / 1000)}s` : "1s"}</span>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {DEBUG_STREAM && (
                <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}高级诊断
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)} disabled={messages.length === 0}><Trash2 className="h-4 w-4" />清空</Button>
              <Button variant="outline" size="sm" onClick={resetSession}><Plus className="h-4 w-4" />新会话</Button>
            </div>
          </div>
          {!hermesConnected && <Button className="mt-2" variant="outline" size="sm" onClick={() => setActive("engines")}>前往 Hermes 管理</Button>}
          <div className="mt-3 lg:hidden">
            <Button variant="ghost" size="sm" onClick={() => setMobileHistoryOpen(!mobileHistoryOpen)}>
              {mobileHistoryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              历史对话
            </Button>
            {mobileHistoryOpen && <div className="mt-2 rounded-xl border bg-background p-2">
              {sessionError && <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{sessionError}</div>}
              <div className="mb-2 flex gap-2">
                <Input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="搜索历史" />
                <Button size="sm" onClick={resetSession}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {filteredSessions.map((session) => (
                  <button key={session.id} disabled={loading} onClick={() => switchSession(session)} className={cn("w-full rounded-lg px-2 py-1.5 text-left text-sm", session.id === currentSessionId ? "bg-primary/10 text-primary" : "hover:bg-muted")}>{session.title}</button>
                ))}
              </div>
            </div>}
          </div>
          {showAdvanced && DEBUG_STREAM && (
            <div className="mt-3 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="mb-2">高级诊断，仅用于排查问题。</div>
              <Button variant="ghost" size="sm" onClick={() => setShowStreamDiagnostics(!showStreamDiagnostics)}>
                {showStreamDiagnostics ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showStreamDiagnostics ? "收起流式诊断" : "展开流式诊断"}
              </Button>
              {showStreamDiagnostics && <StreamDiagnosticsPanel diagnostics={streamDiagnostics} />}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div className="relative flex-1 min-h-0">
            <div ref={scrollRef} onScroll={handleMessageScroll} className="h-full space-y-5 overflow-y-auto bg-gradient-to-b from-background to-muted/20 px-5 py-6">
            {messages.length === 0 && (
              <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
                <h3 className="text-xl font-semibold">今天想让 Hermes 帮你做什么？</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">输入问题后发送，回复会在这里平滑显示。支持 Markdown、代码块和推理过程。</p>
                <div className="mt-8 grid w-full max-w-lg gap-3 sm:grid-cols-2">
                  {[
                    { text: "写一段朋友圈宣传文案", fill: "写一段适合朋友圈发布的产品宣传文案" },
                    { text: "总结一份资料", fill: "请总结以下资料的核心要点：" },
                    { text: "解释一段报错", fill: "请解释以下报错的原因并给出修复建议：" },
                    { text: "制定一个工作计划", fill: "请帮我制定一个工作计划：" },
                  ].map((card) => (
                    <button key={card.text} onClick={() => { setInput(card.fill); requestAnimationFrame(() => { inputRef.current?.focus(); autoResize(inputRef.current); }); }}
                      className="rounded-xl border bg-card p-4 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5">
                      {card.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => {
              // System notice for stopped-with-no-content
              if ((message as any).role === "system" && (message as any).stopped) {
                return (
                  <div key={message.requestId || index} className="flex justify-start">
                    <div className="rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">已停止生成，未生成内容。</div>
                  </div>
                );
              }
              if (message.role !== "user" && message.role !== "assistant") return null;
              const isLastAssistant = message.role === "assistant" && index === messages.length - 1;
              const isPlaceholder = isLastAssistant && loading;
              const showPlaceholderText = isPlaceholder && !message.content && !message.reasoningContent;
              const isActiveAssistant = Boolean(loading && message.role === "assistant" && message.requestId === activeRequestRef.current);
              const isStopped = Boolean(message.partial && message.warning === "已停止生成");
              return (
                <div key={message.requestId || index} className={cn("group flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("flex flex-col", message.role === "user" ? "max-w-[68%] items-end" : "max-w-[720px] items-start")}>
                    <div className={cn(
                      "rounded-2xl px-5 py-3.5 text-[15px] leading-7",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border/40 bg-card text-foreground"
                    )}>
                      {message.role === "assistant" && <ReasoningBlock content={message.reasoningContent || ""} isPlaceholder={isPlaceholder} phase={isPlaceholder ? phase : "done"} />}
                      {message.role === "assistant" && (message.toolEvents?.length ?? 0) > 0 && <ToolsBlock toolEvents={message.toolEvents} />}
                      {showPlaceholderText ? <PlaceholderText phase={phase} elapsedLive={elapsedLive} /> : isActiveAssistant ? <div className="whitespace-pre-wrap leading-7">{message.content || ""}</div> : <MarkdownContent text={message.content || ""} />}
                      {message.role === "assistant" && isStopped && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">已停止生成</div>
                      )}
                      {message.role === "assistant" && message.partial && !isStopped && (
                        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          {message.warning || "回复可能不完整"}
                        </div>
                      )}
                    </div>
                    {message.role === "assistant" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        <span>Hermes</span>
                        {message.elapsedMs != null && <span>· {message.elapsedMs >= 1000 ? `${(message.elapsedMs / 1000).toFixed(1)}s` : `${message.elapsedMs}ms`}</span>}
                        {message.usage?.total_tokens != null && <span>· {message.usage.total_tokens} tokens</span>}
                        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(message.content || "")}><Copy className="h-3 w-3" />复制</Button>
                        {isActiveAssistant && <Button variant="ghost" size="sm" onClick={skipTypewriter}><FastForward className="h-3 w-3" />快速显示</Button>}
                        {isLastAssistant && !loading && messages.length >= 2 && <Button variant="ghost" size="sm" onClick={regenLast}><RotateCcw className="h-3 w-3" />重新生成</Button>}
                        <DetailsEntry message={message} expandedDetailId={expandedDetailId} setExpandedDetailId={setExpandedDetailId} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} className="h-28 shrink-0" />
          </div>
          {showJumpToBottom && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
              <Button className="pointer-events-auto rounded-full shadow-lg" size="sm" onClick={jumpToBottom}>
                回到底部
              </Button>
            </div>
          )}
        </div>          {error && (
            <div className="border-t px-5 py-3">
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400 whitespace-pre-wrap">{error}</div>
              {errorDetail && (
                <div className="mt-1">
                  <Button variant="ghost" size="sm" onClick={() => setShowErrorDetail(!showErrorDetail)}>
                    {showErrorDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {showErrorDetail ? "收起技术详情" : "展开技术详情"}
                  </Button>
                  {showErrorDetail && <pre className="mt-1 max-h-48 overflow-auto rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">{errorDetail}</pre>}
                </div>
              )}
            </div>
          )}
          <div className="shrink-0 border-t bg-background/90 p-3 backdrop-blur-xl md:p-4">
            <div className="rounded-2xl border bg-card/90 p-2 shadow-sm">
              <Textarea
                ref={inputRef}
                className="max-h-[180px] min-h-14 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0"
                value={input}
                onChange={handleInputChange}
                onCompositionStart={() => { setIsComposing(true); isComposingRef.current = true; }}
                onCompositionEnd={() => { setIsComposing(false); isComposingRef.current = false; }}
                onKeyDown={handleKeyDown}
                placeholder={hermesConnected ? "向 Hermes Agent 发送消息..." : disabledReason}
                disabled={!hermesConnected || loading}
              />
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-[11px] text-muted-foreground">Enter 发送 · Shift + Enter 换行</span>
                {loading ? (
                  <Button className="rounded-full" variant="destructive" onClick={stopGeneration}>
                    <Square className="h-4 w-4" />停止
                  </Button>
                ) : (
                  <Button className="rounded-full" disabled={!hermesConnected || !input.trim()} onClick={send}>
                    <Send className="h-4 w-4" />发送
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空对话"
        description="将清除当前所有对话消息，此操作不可恢复。"
        confirmLabel="确认清空"
        onConfirm={() => { setMessages([]); messagesRef.current = []; setError(""); setErrorDetail(null); void saveCurrentSession([]); }}
      />
      <ConfirmDialog
        open={deleteSessionId !== null}
        onClose={() => setDeleteSessionId(null)}
        title="删除历史对话"
        description="将删除此历史对话记录，此操作不可恢复。"
        confirmLabel="确认删除"
        onConfirm={() => { if (deleteSessionId) void deleteSession(deleteSessionId); setDeleteSessionId(null); }}
      />
      <ConfirmDialog
        open={confirmClearHistory}
        onClose={() => setConfirmClearHistory(false)}
        title="清空全部历史"
        description="将删除所有本地历史对话记录，此操作不可恢复。"
        confirmLabel="确认清空"
        onConfirm={() => { void clearHistory(); setConfirmClearHistory(false); }}
      />
    </div>
  );
}

function SkillsPage({ config, updateConfig, setActive, setChatDraft, setPendingNewSessionTitle }: { config: AppConfig; updateConfig: (next: AppConfig) => Promise<void>; setActive: (id: RouteId) => void; setChatDraft: (value: string) => void; setPendingNewSessionTitle: (v: string) => void }) {
  const [tab, setTab] = useState<"official" | "hub" | "enabled">("official");
  const [category, setCategory] = useState<string>("全部");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("全部");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [detailSkill, setDetailSkill] = useState<OfficialSkill | null>(null);
  const [hubDetail, setHubDetail] = useState<HermesHubSkill | null>(null);
  const [runSkill, setRunSkill] = useState<OfficialSkill | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);

  const toggleSkill = (id: string) => {
    const enabledSkills = config.enabledSkills.includes(id) ? config.enabledSkills.filter((item) => item !== id) : [...config.enabledSkills, id];
    updateConfig({ ...config, enabledSkills });
  };

  const query = search.trim().toLowerCase();
  const filteredOfficial = officialSkills.filter((skill) => {
    if (category !== "全部" && skill.category !== category) return false;
    if (riskFilter !== "全部" && skill.riskLevel !== riskFilter) return false;
    if (enabledOnly && !config.enabledSkills.includes(skill.id)) return false;
    if (query && !skill.name.toLowerCase().includes(query) && !skill.description.toLowerCase().includes(query)) return false;
    return true;
  });
  const filteredHub = hermesHubSkills.filter((skill) => {
    if (category !== "全部" && skill.category !== category) return false;
    if (riskFilter !== "全部" && skill.riskLevel !== riskFilter) return false;
    if (query && !skill.name.toLowerCase().includes(query) && !skill.description.toLowerCase().includes(query)) return false;
    return true;
  });
  const enabledList = officialSkills.filter((skill) => config.enabledSkills.includes(skill.id));

  const riskColor = (level: string) => level === "high" ? "danger" : level === "medium" ? "warning" : "success";
  const riskLabel = (level: string) => level === "high" ? "高" : level === "medium" ? "中" : "低";

  const openRun = (skill: OfficialSkill) => {
    setRunSkill(skill);
    setShowPreview(false);
    const defaults: Record<string, string> = {};
    skill.inputFields.forEach((field) => { defaults[field.id] = field.options?.[0] ?? ""; });
    setFormValues(defaults);
  };

  const builtPrompt = runSkill ? (() => {
    let p = `你正在运行 Skill：${runSkill.name}\n\n技能目标：\n${runSkill.description}\n\n`;
    const filled = runSkill.inputFields.filter((f) => formValues[f.id]?.trim());
    if (filled.length > 0) {
      p += "用户填写的信息：\n";
      filled.forEach((f) => { p += `- ${f.label}：${formValues[f.id]}\n`; });
      p += "\n";
    }
    p += "请按照以下工作流完成：\n";
    let fp = runSkill.fullPrompt;
    runSkill.inputFields.forEach((f) => { fp = fp.replace(`{${f.id}}`, formValues[f.id] || `[待填写：${f.label}]`); });
    p += fp;
    return p;
  })() : "";

  const missingRequired = runSkill?.inputFields.filter((f) => f.required && !formValues[f.id]?.trim()) ?? [];

  const generateAndGo = () => {
    if (!runSkill) return;
    setPendingNewSessionTitle(runSkill.name);
    setChatDraft(builtPrompt);
    setActive("chat");
    setRunSkill(null);
  };

  const categories = tab === "hub" ? ["全部", ...hermesHubCategories] : ["全部", ...officialCategories];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Skill Center</CardTitle>
          <CardDescription>Skill 是 Agent 的可复用工作流。选择技能后，Hermes Agent 会按固定流程帮你完成任务。当前内置官方模板技能；高级扩展技能将在后续版本开放。</CardDescription>
          <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">当前所有技能均为本地模板，不会执行本地命令，不会修改系统文件。</div>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={tab === "official" ? "default" : "outline"} onClick={() => { setTab("official"); setCategory("全部"); }}>官方模板</Button>
        <Button size="sm" variant={tab === "enabled" ? "default" : "outline"} onClick={() => setTab("enabled")}>已启用 ({enabledList.length})</Button>
        <Button size="sm" variant={tab === "hub" ? "default" : "outline"} onClick={() => { setTab("hub"); setCategory("全部"); }}>扩展预览</Button>
        <select className="rounded-xl border bg-background px-2 py-1 text-sm" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="全部">全部风险</option>
          <option value="low">低风险</option>
          <option value="medium">中风险</option>
          <option value="high">高风险</option>
        </select>
        {tab === "official" && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" checked={enabledOnly} onChange={(e) => setEnabledOnly(e.target.checked)} className="rounded" />只看已启用
          </label>
        )}
        <Input className="ml-auto max-w-[220px]" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索技能" />
      </div>

      {tab !== "enabled" && (
        <div className="flex flex-wrap gap-2">
          {categories.map((item) => <Button key={item} size="sm" variant={category === item ? "default" : "outline"} onClick={() => setCategory(item)}>{item}</Button>)}
        </div>
      )}

      {/* Official Tab */}
      {tab === "official" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:transition-all [&>*]:duration-200">
          {filteredOfficial.map((skill) => (
            <Card key={skill.id} className="group flex flex-col hover:-translate-y-0.5 hover:shadow-md" accent={skill.riskLevel === "high" ? "#F43F5E" : skill.riskLevel === "medium" ? "#F59E0B" : "#10B981"}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1"><CardTitle>{skill.name}</CardTitle></div>
                  <Switch checked={config.enabledSkills.includes(skill.id)} onCheckedChange={() => toggleSkill(skill.id)} />
                </div>
                <CardDescription className="line-clamp-2">{skill.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-3 pt-0">
                <div className="flex flex-wrap gap-2"><Badge tone={riskColor(skill.riskLevel)}>风险 {riskLabel(skill.riskLevel)}</Badge><Badge tone="info">{skill.category}</Badge>{skill.verified && <Badge tone="success">官方认证</Badge>}</div>
                {skill.recommendedUseCases.length > 0 && <p className="text-xs text-muted-foreground">场景：{skill.recommendedUseCases.join("、")}</p>}
                <div className="text-[10px] text-muted-foreground">{config.enabledSkills.includes(skill.id) ? "已启用 · 在已启用列表可快速找到" : "未启用 · 启用后可在已启用列表快速找到"}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => openRun(skill)}>运行技能</Button>
                  <Button variant="outline" size="sm" onClick={() => setDetailSkill(skill)}>详情</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredOfficial.length === 0 && <div className="col-span-full p-4 text-center text-sm text-muted-foreground">没有匹配的官方模板技能。</div>}
        </div>
      )}

      {/* Hub Tab */}
      {tab === "hub" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <div>这些是未来可能接入的 Hermes 高级技能，需要联网、授权或额外配置。当前版本仅展示能力预览，暂不支持安装。</div>
            <div className="text-xs">当前不会联网安装第三方技能，不会执行命令，不会修改 ~/.hermes。</div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:transition-all [&>*]:duration-200">
          {filteredHub.map((skill) => (
            <Card key={skill.id} className="group hover:-translate-y-0.5 hover:shadow-md">
              <CardHeader>
                <div className="flex justify-between gap-3">
                  <div><CardTitle>{skill.name}</CardTitle><CardDescription>{skill.description}</CardDescription></div>
                  <Badge tone="muted">后续开放</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2"><Badge tone={riskColor(skill.riskLevel)}>风险 {riskLabel(skill.riskLevel)}</Badge><Badge tone="info">{skill.category}</Badge></div>
                <p className="text-xs text-muted-foreground">适合：{skill.audience}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setHubDetail(skill)}>查看说明</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredHub.length === 0 && <div className="col-span-full p-4 text-center text-sm text-muted-foreground">没有匹配的扩展技能。</div>}
          </div>
        </div>
      )}

      {/* Enabled Tab */}
      {tab === "enabled" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:transition-all [&>*]:duration-200">
          {enabledList.map((skill) => (
            <Card key={skill.id} className="group hover:-translate-y-0.5 hover:shadow-md" accent="#10B981">
              <CardHeader className="pb-2"><CardTitle>{skill.name}</CardTitle><CardDescription>{skill.description}</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                <Button size="sm" onClick={() => openRun(skill)}>运行技能</Button>
                <Button variant="outline" size="sm" onClick={() => toggleSkill(skill.id)}>停用</Button>
              </CardContent>
            </Card>
          ))}
          {enabledList.length === 0 && (
            <div className="col-span-full rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              还没有启用技能。你可以在"官方模板"中启用常用技能，方便下次快速找到。
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {detailSkill && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 animate-in fade-in" onClick={() => setDetailSkill(null)}>
          <Card className="max-h-[80vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle>{detailSkill.name}</CardTitle><CardDescription>{detailSkill.description}</CardDescription></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2"><Badge tone={riskColor(detailSkill.riskLevel)}>风险 {riskLabel(detailSkill.riskLevel)}</Badge><Badge tone="info">{detailSkill.category}</Badge><Badge tone="success">v{detailSkill.version}</Badge></div>
              <div>适合场景：{detailSkill.recommendedUseCases.join("、")}</div>
              <div>输入项：{detailSkill.inputFields.map((f) => f.label).join("、")}</div>
              {detailSkill.examples.length > 0 && <div>示例输出：<pre className="mt-1 max-h-32 overflow-auto rounded-lg border bg-muted/30 p-2 text-xs">{detailSkill.examples[0].output}</pre></div>}
              <div>完整提示词：<pre className="mt-1 max-h-40 overflow-auto rounded-lg border bg-muted/30 p-2 text-xs whitespace-pre-wrap">{detailSkill.fullPrompt}</pre></div>
              <div className="text-xs text-muted-foreground">权限：{detailSkill.requiredPermissions.length > 0 ? detailSkill.requiredPermissions.join(", ") : "无"} · {detailSkill.author} · 已验证</div>
              <div className="flex gap-2"><Button onClick={() => { openRun(detailSkill); setDetailSkill(null); }}>运行技能</Button><Button variant="outline" onClick={() => setDetailSkill(null)}>关闭</Button></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Hub Detail Modal */}
      {hubDetail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setHubDetail(null)}>
          <Card className="max-h-[80vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle>{hubDetail.name}</CardTitle><CardDescription>{hubDetail.description}</CardDescription></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2"><Badge tone={riskColor(hubDetail.riskLevel)}>风险 {riskLabel(hubDetail.riskLevel)}</Badge><Badge tone="info">{hubDetail.category}</Badge><Badge tone="muted">后续开放</Badge></div>
              <div>适合人群：{hubDetail.audience}</div>
              {hubDetail.requiredPermissions.length > 0 && <div>可能需要权限：{hubDetail.requiredPermissions.join("、")}</div>}
              {hubDetail.externalServices.length > 0 && <div>可能需要的外部服务：{hubDetail.externalServices.join("、")}</div>}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">当前版本不会安装或执行该技能。后续版本将支持安全安装。</div>
              <Button variant="outline" onClick={() => setHubDetail(null)}>关闭</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Skill Runner Drawer */}
      {runSkill && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40 transition-opacity" onClick={() => setRunSkill(null)} />
          <div className="absolute bottom-0 right-0 top-0 w-full overflow-y-auto border-l bg-card shadow-2xl sm:max-w-[480px] animate-slide-in">
            <div className="sticky top-0 z-10 border-b bg-card/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{runSkill.name}</h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5"><Badge tone={riskColor(runSkill.riskLevel)}>风险 {riskLabel(runSkill.riskLevel)}</Badge><Badge tone="info">{runSkill.category}</Badge><Badge tone="success">官方认证</Badge></div>
                  <p className="mt-2 text-xs text-muted-foreground">{runSkill.description}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setRunSkill(null)}><ChevronUp className="h-4 w-4 rotate-90" /></Button>
              </div>
              {/* Step indicator */}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">1</span>填写信息
                <ChevronDown className="h-2 w-2 opacity-30" />
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">2</span>生成指令
                <ChevronDown className="h-2 w-2 opacity-30" />
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">3</span>进入对话
              </div>
            </div>

            <div className="space-y-4 px-5 py-4">
              {/* Form fields */}
              {runSkill.inputFields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <label className="text-sm font-medium">{field.label}{field.required && <span className="text-rose-500"> *</span>}</label>
                  {field.type === "select" ? (
                    <select className="w-full rounded-xl border bg-background px-3 py-2 text-sm" value={formValues[field.id] || ""} onChange={(e) => setFormValues({ ...formValues, [field.id]: e.target.value })}>
                      {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <Textarea placeholder={field.placeholder} value={formValues[field.id] || ""} onChange={(e) => setFormValues({ ...formValues, [field.id]: e.target.value })} className="min-h-20" />
                  ) : (
                    <Input placeholder={field.placeholder} value={formValues[field.id] || ""} onChange={(e) => setFormValues({ ...formValues, [field.id]: e.target.value })} />
                  )}
                </div>
              ))}

              {/* Instruction preview */}
              <div>
                <button onClick={() => setShowPreview(!showPreview)} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                  {showPreview ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Agent 指令预览
                </button>
                {showPreview && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border bg-muted/30 p-3">
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{builtPrompt}</pre>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigator.clipboard.writeText(builtPrompt)}><Copy className="h-3 w-3" />复制指令</Button>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom actions */}
            <div className="sticky bottom-0 border-t bg-card/95 px-5 py-4 backdrop-blur">
              {missingRequired.length > 0 && (
                <p className="mb-2 text-xs text-rose-500">请填写必填字段：{missingRequired.map((f) => f.label).join("、")}</p>
              )}
              <div className="flex gap-2">
                <Button className="flex-1" disabled={missingRequired.length > 0} onClick={generateAndGo}>生成并进入对话</Button>
                <Button variant="outline" onClick={() => setRunSkill(null)}>取消</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryPage() {
  const [memory, setMemory] = useState<HermesNativeMemoryResult | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const loadMemory = useCallback(async () => {
    setLoadingMemory(true);
    setMemoryError("");
    try {
      const result = await readHermesNativeMemory();
      setMemory(result);
      setSelectedId((current) => current && result.files.some((file) => file.id === current) ? current : result.files[0]?.id ?? "");
    } catch (err) {
      setMemoryError(getErrorMessage(err));
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  useEffect(() => { loadMemory(); }, [loadMemory]);

  const selected = memory?.files.find((file) => file.id === selectedId) ?? memory?.files[0] ?? null;
  const checkedAt = memory?.checkedAt ? new Date(Number(memory.checkedAt) * 1000).toLocaleString() : "-";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Hermes 记忆</CardTitle>
              <CardDescription>这里显示 Hermes Agent 的原生记忆文件。Hermes 会在对话中自动使用这些记忆，本页面当前只提供查看，不会修改文件。</CardDescription>
            </div>
            <Button variant="outline" onClick={loadMemory} disabled={loadingMemory}><RefreshCcw className={cn("h-4 w-4", loadingMemory && "animate-spin")} />重新扫描</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Metric label="Hermes 记忆目录" value={memory?.found ? "已检测到" : "未检测到"} tone={memory?.found ? "success" : "warning"} />
          <Metric label="已发现记忆文件" value={String(memory?.files.length ?? 0)} tone={(memory?.files.length ?? 0) > 0 ? "success" : "muted"} />
          <Metric label="最近扫描" value={checkedAt} tone="info" />
          {memoryError && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400 md:col-span-3">{memoryError}</div>}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader><CardTitle>文件列表</CardTitle><CardDescription>扫描 Hermes 记忆目录下的记忆文件。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {loadingMemory && <div className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在扫描 Hermes 原生记忆…</div>}
            {!loadingMemory && memory?.files.length === 0 && <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">未发现记忆文件。不同 Hermes 版本可能路径不同，文件不存在不会视为错误。</div>}
            {memory?.files.map((file) => (
              <button key={file.id} onClick={() => setSelectedId(file.id)} className={cn("w-full rounded-xl border p-3 text-left transition", selected?.id === file.id ? "border-primary/40 bg-primary/5" : "bg-card hover:bg-muted/40")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{file.title}</div>
                  <Badge tone="info">{memoryKindLabel(file)}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{file.relativePath}</div>
                <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                  <span>{formatBytes(file.size)}</span>
                  <span>{formatUnixTime(file.updatedAt)}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selected?.title ?? "选择记忆文件"}</CardTitle>
                <CardDescription>{selected ? selected.relativePath : "从左侧选择一个 Hermes 原生记忆文件查看。"}</CardDescription>
              </div>
              {selected && <Badge tone="warning">只读</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-6 text-muted-foreground">
                  <div>文件：<span className="break-all text-foreground">{selected.relativePath || selected.title}</span></div>
                  <div>类型：{memoryKindDescription(selected)}</div>
                  <div>安全：当前版本只读展示，不写入、不删除、不执行 Hermes 命令。</div>
                </div>
                <div className="max-h-[560px] overflow-auto rounded-xl border bg-background p-4 text-sm leading-7">
                  <MarkdownContent text={selected.content || "（文件为空）"} />
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">暂无可查看的 Hermes 记忆文件。</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>业务记忆模板，后续版本开放</CardTitle><CardDescription>后续可将这些模板安全写入 Hermes 原生记忆文件，但当前版本只读。</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {["业务介绍", "价格表", "回复风格", "常见问题", "售后规则"].map((item) => <Badge key={item} tone="muted">{item}</Badge>)}
        </CardContent>
      </Card>
    </div>
  );
}

function memoryKindLabel(file: HermesNativeMemoryFile) {
  if (file.relativePath.includes("memories/users/")) return "用户记忆";
  if (file.kind === "memory") return "MEMORY";
  if (file.kind === "user") return "USER";
  if (file.kind === "soul") return "SOUL";
  return "UNKNOWN";
}

function memoryKindDescription(file: HermesNativeMemoryFile) {
  if (file.relativePath.includes("memories/users/")) return "用户记忆：多用户或渠道下的用户级记忆文件。";
  if (file.kind === "memory") return "长期记忆：Hermes 学到的重要事实和知识。";
  if (file.kind === "user") return "用户偏好：与你相关的偏好、身份和长期上下文。";
  if (file.kind === "soul") return "Agent 人格：Agent 的行为风格和系统设定。";
  return "未知类型：Hermes 原生记忆目录下发现的 Markdown 文件。";
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatUnixTime(value: string | null) {
  if (!value) return "更新时间未知";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return new Date(numeric * 1000).toLocaleString();
}

function TasksPage({ cronOverview, setCronOverview, cronCliStatus, setCronCliStatus, cronLastLoadedAt, setCronLastLoadedAt }: { cronOverview: HermesCronOverview | null; setCronOverview: (v: HermesCronOverview | null) => void; cronCliStatus: HermesCronCliStatus | null; setCronCliStatus: (v: HermesCronCliStatus | null) => void; cronLastLoadedAt: number; setCronLastLoadedAt: (v: number) => void }) {
  const [loading, setLoading] = useState(false);
  const [cliLoading, setCliLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [taskSchedule, setTaskSchedule] = useState("every day at 9am");
  const [taskPrompt, setTaskPrompt] = useState("");

  const handleRefresh = async () => {
    setLoading(true);
    setError("");
    try { setCronOverview(await readHermesCronOverview()); setCronLastLoadedAt(Date.now()); } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  };

  const handleDetectCli = async () => {
    setCliLoading(true);
    try { setCronCliStatus(await readHermesCronCliStatus()); setCronLastLoadedAt(Date.now()); } catch { /* non-fatal */ }
    finally { setCliLoading(false); }
  };

  const lastLoadedText = cronLastLoadedAt
    ? `上次检测：${Math.round((Date.now() - cronLastLoadedAt) / 60000)} 分钟前${Date.now() - cronLastLoadedAt > 300000 ? '，状态可能已过期，可点击刷新。' : ''}`
    : "尚未检测 Cron 状态。点击下方按钮开始。";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Hermes 定时任务</CardTitle>
          <CardDescription>Hermes Cron 可以让 Agent 按计划自动执行任务。点击下方按钮检测本机 Cron 状态。</CardDescription>
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Cron 任务运行在新的 Agent 会话中，不会自动继承当前聊天内容。请在任务描述中写清楚完整背景。</div>
        </CardHeader>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleRefresh} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}{cronOverview ? <RefreshCcw className="h-4 w-4" /> : "检测 Cron 目录"}</Button>
        <Button variant="outline" size="sm" onClick={handleDetectCli} disabled={cliLoading}>{cliLoading && <Loader2 className="h-4 w-4 animate-spin" />}检测 CLI 状态</Button>
        <span className="text-xs text-muted-foreground">{lastLoadedText}</span>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</div>}

      {cronOverview && (
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Cron 目录" value={cronOverview.cronDirExists ? "已存在" : "不存在"} tone={cronOverview.cronDirExists ? "success" : "muted"} />
          <Metric label="Scheduler" value={cronCliStatus ? (cronCliStatus.schedulerRunning ? "运行中" : "已停止") : cliLoading ? "检测中" : "未检测"} tone={cronCliStatus?.schedulerRunning ? "success" : cliLoading ? "info" : "muted"} />
          <Metric label="任务数" value={cronCliStatus ? String(cronCliStatus.jobs.length) : cliLoading ? "…" : "-"} tone="info" />
        </div>
      )}

      {cronCliStatus && (
        <Card>
          <CardHeader><CardTitle>任务列表</CardTitle><CardDescription>{cronCliStatus.jobs.length ? `共 ${cronCliStatus.jobs.length} 个任务` : "暂无定时任务"}</CardDescription></CardHeader>
          <CardContent>
            {cronCliStatus.jobs.length > 0 ? (
              <div className="space-y-2">
                {cronCliStatus.jobs.map((job, i) => <div key={i} className="rounded-xl border bg-muted/30 p-3 text-sm font-mono">{job.raw}</div>)}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">当前没有定时任务。可在 Agent 对话中使用 /cron 命令创建。</div>
            )}
          </CardContent>
        </Card>
      )}

      {cronOverview?.outputDirExists && (
        <Card>
          <CardHeader><CardTitle>输出记录</CardTitle><CardDescription>Cron 输出目录共有 {cronOverview.outputFileCount} 个文件。查看文件内容将在后续版本开放。</CardDescription></CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div><CardTitle>新建任务预览</CardTitle><CardDescription>生成 Hermes Cron 指令，当前不真实创建。</CardDescription></div>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(!showCreate)}>{showCreate ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
          </div>
        </CardHeader>
        {showCreate && (
          <CardContent className="space-y-3">
            <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="任务名称" />
            <Input value={taskSchedule} onChange={(e) => setTaskSchedule(e.target.value)} placeholder="执行频率，例如 every day at 9am" />
            <Textarea value={taskPrompt} onChange={(e) => setTaskPrompt(e.target.value)} placeholder="任务描述 / prompt" />
            {taskName && taskPrompt && (
              <div className="rounded-xl border bg-muted/30 p-3"><pre className="whitespace-pre-wrap text-xs text-muted-foreground">{`/cron add "${taskSchedule}" "${taskPrompt}"`}</pre></div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" disabled={!taskName || !taskPrompt} onClick={() => { navigator.clipboard.writeText(`/cron add "${taskSchedule}" "${taskPrompt}"`); }}><Copy className="h-4 w-4" />复制命令</Button>
              <Button disabled>真正创建（后续开放）</Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}


function UsagePage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessions(await readChatSessions()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const allMessages = sessions.flatMap((session) => session.messages);
    const assistantMsgs = allMessages.filter((message) => message.role === "assistant");
    const userMsgs = allMessages.filter((message) => message.role === "user");
    const totalTokens = assistantMsgs.reduce((sum, message) => sum + (message.usage?.total_tokens ?? 0), 0);
    const promptTokens = assistantMsgs.reduce((sum, message) => sum + (message.usage?.prompt_tokens ?? 0), 0);
    const completionTokens = assistantMsgs.reduce((sum, message) => sum + (message.usage?.completion_tokens ?? 0), 0);
    const avgTokens = assistantMsgs.length > 0 ? Math.round(totalTokens / assistantMsgs.length) : 0;

    const now = Date.now();
    const dayMs = 86400000;
    const sessionsToday = sessions.filter((session) => now - Number(session.updatedAt) * 1000 < dayMs);
    const sessionsWeek = sessions.filter((session) => now - Number(session.updatedAt) * 1000 < 7 * dayMs);
    const sessionsMonth = sessions.filter((session) => now - Number(session.updatedAt) * 1000 < 30 * dayMs);
    const todayTokens = sessionsToday.flatMap((session) => session.messages).filter((message) => message.role === "assistant").reduce((sum, message) => sum + (message.usage?.total_tokens ?? 0), 0);
    const weekTokens = sessionsWeek.flatMap((session) => session.messages).filter((message) => message.role === "assistant").reduce((sum, message) => sum + (message.usage?.total_tokens ?? 0), 0);
    const monthTokens = sessionsMonth.flatMap((session) => session.messages).filter((message) => message.role === "assistant").reduce((sum, message) => sum + (message.usage?.total_tokens ?? 0), 0);

    const lastUse = sessions.length > 0 ? sessions.reduce((latest, session) => Math.max(latest, Number(session.updatedAt) * 1000), 0) : 0;

    const modelMap = new Map<string, number>();
    assistantMsgs.filter((message) => message.modelName).forEach((message) => {
      modelMap.set(message.modelName!, (modelMap.get(message.modelName!) ?? 0) + (message.usage?.total_tokens ?? 0));
    });

    const topSessions = [...sessions].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)).slice(0, 5);

    const fmtTokens = (n: number) => n > 10000 ? `${(n / 1000).toFixed(0)}K` : n > 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

    return { sessions, allMessages, assistantMsgs, userMsgs, totalTokens, promptTokens, completionTokens, avgTokens, todayTokens, weekTokens, monthTokens, lastUse, modelMap, topSessions, fmtTokens };
  }, [sessions]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const { totalTokens, promptTokens, completionTokens, avgTokens, todayTokens, weekTokens, lastUse, modelMap, topSessions, fmtTokens } = stats;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>使用概况</CardTitle>
          <CardDescription>本页统计来自本机历史会话，仅用于估算使用量。近期统计按会话最后更新时间估算，可能包含该会话内较早消息的 token。实际额度以模型供应服务后台为准。</CardDescription>
        </CardHeader>
      </Card>

      {stats.sessions.length === 0 ? (
        <div className="rounded-xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          暂无使用数据，开始一次 Agent 对话后这里会自动统计。
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="总会话数" value={String(stats.sessions.length)} tone="info" />
            <Metric label="总消息数" value={String(stats.allMessages.length)} tone="info" />
            <Metric label="总 Token" value={fmtTokens(totalTokens)} tone="success" />
            <Metric label="近 7 天" value={fmtTokens(weekTokens)} tone="info" />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="今日 Token" value={fmtTokens(todayTokens)} tone="success" />
            <Metric label="输入 Token" value={fmtTokens(promptTokens)} tone="info" />
            <Metric label="输出 Token" value={fmtTokens(completionTokens)} tone="info" />
            <Metric label="平均每次回复" value={fmtTokens(avgTokens)} tone="info" />
          </div>

          <Card>
            <CardHeader><CardTitle>模型用量分布</CardTitle></CardHeader>
            <CardContent>
              {modelMap.size === 0 ? (
                <div className="text-sm text-muted-foreground">暂无模型用量数据。</div>
              ) : (
                <div className="space-y-2">
                  {[...modelMap.entries()].sort((a, b) => b[1] - a[1]).map(([model, tokens]) => (
                    <div key={model} className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
                      <span className="font-medium">{model}</span>
                      <span className="text-sm text-muted-foreground">{fmtTokens(tokens)} tokens</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>最近会话</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topSessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{session.title || "新对话"}</div>
                      <div className="text-xs text-muted-foreground">{session.lastMessagePreview || ""} · {formatUnixTime(session.updatedAt)}</div>
                    </div>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">{session.totalTokens || 0} tokens</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {lastUse > 0 && (
        <div className="text-xs text-muted-foreground">最近一次使用：{new Date(lastUse).toLocaleString()}</div>
      )}

      <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />刷新统计</Button>
    </div>
  );
}

function TutorialsPage({ config }: { config: AppConfig }) {
  return <div className="grid gap-4 xl:grid-cols-2">{tutorials.map((tutorial) => <Card key={tutorial.title}><CardHeader><CardTitle>{tutorial.title}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{tutorial.steps.map((step, index) => <div key={step} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">{index + 1}</span><p className="text-muted-foreground">{step}</p></div>)}</CardContent></Card>)}<Card><CardHeader><CardTitle>售后联系方式</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">如有问题请联系售后 QQ：858070120</CardContent></Card></div>;
}

function AboutPage({ config, updateConfig }: { config: AppConfig; updateConfig: (next: AppConfig) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="space-y-4"><Card><CardHeader><CardTitle>AI Agent 工作台 U盘版</CardTitle><CardDescription>AI Agent Workspace v0.1.1</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><Metric label="Agent 服务" value="本机 Hermes 对话服务" tone="info" /><Metric label="对话模型" value="Hermes Agent" tone="success" /></CardContent></Card><Card><CardHeader><CardTitle>使用步骤</CardTitle><CardDescription>购买 U盘会赠送初始额度，用完后可联系续费。</CardDescription></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground">{["插入 U盘", "打开 AI Agent Workspace", "在 Hermes 管理页配置 Token 和模型", "确认 Hermes 对话服务运行中", "开始和 Hermes Agent 对话"].map((step, index) => <div key={step} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">{index + 1}</span>{step}</div>)}</CardContent></Card><Card><CardContent className="pt-4"><button onClick={() => setConfirm(true)} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">清除本地配置（重置 Token 和设置）</button></CardContent></Card><ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="确认清除" description="此操作会清除本地保存的 Token 和配置，不会影响 Hermes 记忆文件。" confirmLabel="确认清除" onConfirm={() => clearConfig().then(updateConfig)} /></div>;
}

function PhaseBadge({ phase }: { phase: ChatPhase }) {
  const map: Record<ChatPhase, { label: string; tone: "success" | "info" | "warning" | "danger" | "muted" }> = {
    ready: { label: "就绪", tone: "muted" },
    sending: { label: "发送中", tone: "info" },
    thinking: { label: "思考中", tone: "warning" },
    running: { label: "生成中", tone: "info" },
    done: { label: "完成", tone: "success" },
    error: { label: "出错", tone: "danger" }
  };
  const { label, tone } = map[phase];
  return <Badge tone={tone}>{label}</Badge>;
}

function PlaceholderText({ phase, elapsedLive }: { phase: ChatPhase; elapsedLive: number }) {
  return <div className="text-sm text-muted-foreground"><span className="animate-pulse">Hermes 正在回复</span><span>…</span></div>;
}

function ReasoningBlock({ content, isPlaceholder, phase }: { content: string; isPlaceholder?: boolean; phase?: ChatPhase }) {
  const [open, setOpen] = useState(false);
  const hasContent = content.length > 0;

  // During generation with no content yet: show nothing
  if (isPlaceholder && !hasContent) return null;

  // No reasoning content and not loading: show nothing
  if (!hasContent && !isPlaceholder) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400 hover:underline"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        推理过程
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {content}
        </div>
      )}
    </div>
  );
}

function ToolsBlock({ toolEvents }: { toolEvents?: string[] }) {
  const [open, setOpen] = useState(false);
  const hasEvents = toolEvents && toolEvents.length > 0;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn("flex items-center gap-1 text-[11px] hover:underline", hasEvents ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground")}
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        工具与技能执行{hasEvents ? ` (${toolEvents!.length})` : ""}
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2 text-xs text-muted-foreground space-y-1">
          {hasEvents
            ? toolEvents!.map((evt, i) => <div key={i} className="whitespace-pre-wrap">{evt}</div>)
            : <div>暂无工具调用记录。</div>}
        </div>
      )}
    </div>
  );
}

function DetailsEntry({ message, expandedDetailId, setExpandedDetailId }: { message: UiChatMessage; expandedDetailId: string | null; setExpandedDetailId: (v: string | null) => void }) {
  if (!message.modelName && !message.sessionId && !message.usage) return null;
  const msgId = message.requestId || message.sessionId || "";
  const open = expandedDetailId === msgId;
  const toggle = () => setExpandedDetailId(open ? null : msgId);
  return (
    <span className="relative inline-flex items-center gap-1">
      <button onClick={toggle} className="text-[11px] hover:underline">{open ? "收起详情" : "详情"}</button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 rounded-xl border bg-card p-2.5 text-xs text-muted-foreground shadow-lg">
          {message.modelName && <div>模型：{message.modelName}</div>}
          {message.usage?.prompt_tokens != null && <div>输入：{message.usage.prompt_tokens}</div>}
          {message.usage?.completion_tokens != null && <div>输出：{message.usage.completion_tokens}</div>}
          {message.usage?.total_tokens != null && <div>合计：{message.usage.total_tokens}</div>}
          {message.sessionId && <div className="mt-1 max-w-[320px] break-all border-t pt-1 text-[10px]">会话 ID：{message.sessionId}</div>}
        </div>
      )}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-2 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

function StreamDebugRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[170px_1fr] gap-2"><span>{label}</span><span className="break-all text-foreground">{value}</span></div>;
}

function StreamDiagnosticsPanel({ diagnostics }: { diagnostics: FrontStreamDiagnostics }) {
  return (
    <div className="mt-2 space-y-1 rounded-lg border bg-background/60 p-2">
      <div className="text-[11px] leading-5 text-muted-foreground">高级诊断，仅用于排查问题。</div>
      <StreamDebugRow label="contentType" value={String(diagnostics.rust.contentType ?? "-")} />
      <StreamDebugRow label="isSse" value={String(diagnostics.rust.isSse ?? "-")} />
      <StreamDebugRow label="bytesChunkCount" value={String(diagnostics.rust.bytesChunkCount ?? 0)} />
      <StreamDebugRow label="sseEventCount" value={String(diagnostics.rust.sseEventCount ?? 0)} />
      <StreamDebugRow label="contentChunkCount" value={String(diagnostics.rust.contentChunkCount ?? 0)} />
      <StreamDebugRow label="reasoningChunkCount" value={String(diagnostics.rust.reasoningChunkCount ?? 0)} />
      <StreamDebugRow label="toolEventCount" value={String(diagnostics.rust.toolEventCount ?? 0)} />
      <StreamDebugRow label="frontChunkReceivedCount" value={String(diagnostics.frontChunkReceivedCount)} />
      <StreamDebugRow label="frontChunkAppliedCount" value={String(diagnostics.frontChunkAppliedCount)} />
      <StreamDebugRow label="doneReceived" value={String(diagnostics.doneReceived)} />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "success" | "info" | "warning" | "danger" | "muted" }) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="flex items-center justify-between gap-3 text-xl"><span className="truncate">{value}</span><Badge tone={tone}>{tone === "success" ? "正常" : tone === "warning" ? "待配置" : tone === "danger" ? "异常" : tone === "muted" ? "占位" : "监控"}</Badge></CardTitle></CardHeader></Card>;
}

export default App;
