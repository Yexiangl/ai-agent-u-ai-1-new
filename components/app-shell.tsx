"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  FileX,
  Inbox,
  Menu,
  Moon,
  PackageOpen,
  Play,
  Plus,
  Power,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Trash2,
  UploadCloud,
  X,
  Zap
} from "lucide-react";
import { useTheme } from "next-themes";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, Td, Th } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  callLogs,
  dreamRuns,
  engines,
  memoryFiles,
  models,
  navItems,
  plugins,
  skills,
  statusCards,
  tasks,
  tokenUsage,
  users
} from "@/lib/mock-data";
import { cn, maskKey } from "@/lib/utils";

type PageId = (typeof navItems)[number]["id"];
type MemoryFile = (typeof memoryFiles)[number];

const apiKey = "sk-uai_your_customer_token_here";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [active, setActive] = useState<PageId>("overview");
  const { theme, setTheme } = useTheme();
  const current = navItems.find((item) => item.id === active) ?? navItems[0];

  const handleNav = (id: PageId) => {
    setActive(id);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 flex h-full w-72 flex-col border-r bg-card">
            <div className="flex h-16 items-center justify-between border-b px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">U AI Workbench</div>
                  <div className="text-xs text-muted-foreground">Agent 管理面板 v0.1</div>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="rounded-lg p-1 hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList active={active} onNavigate={handleNav} />
            <div className="border-t p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex h-2 w-2 rounded-full bg-emerald-500" />
                云端服务运行中
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground/60">U AI Agent Workbench v0.1.1</div>
            </div>
          </aside>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r bg-card lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 border-b px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Settings2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">U AI Workbench</div>
            <div className="text-xs text-muted-foreground">Agent 管理面板 v0.1</div>
          </div>
        </div>
        <NavList active={active} onNavigate={handleNav} />
        <div className="border-t p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex h-2 w-2 rounded-full bg-emerald-500" />
            云端服务运行中
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground/60">U AI Agent Workbench v0.1.1</div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{current.label}</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">云端 Agent 服务运行中，U 盘用于激活、教程与交付</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground md:flex">
              <Search className="h-4 w-4" />
              搜索模型、技能、任务
            </div>
            <Button variant="outline" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="切换暗色模式">
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </Button>
          </div>
        </header>

        <main className="p-4 md:p-6">
          <Page active={active} />
        </main>
      </div>
    </div>
  );
}

function NavList({ active, onNavigate }: { active: PageId; onNavigate: (id: PageId) => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {navItems.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
              selected
                ? "bg-[#EEF2FF] text-[#4F46E5] font-medium dark:bg-indigo-500/16 dark:text-indigo-300"
                : "text-muted-foreground hover:bg-[#F1F5F9] hover:text-foreground dark:hover:bg-slate-800"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
            {"children" in item && <ChevronRight className="h-3.5 w-3.5 opacity-60" />}
          </button>
        );
      })}
    </nav>
  );
}

function Page({ active }: { active: PageId }) {
  if (active === "overview") return <Overview />;
  if (active === "engines") return <Engines />;
  if (active === "models") return <ModelsQuota />;
  if (active === "memory") return <MemoryFiles />;
  if (active === "dream") return <DreamMode />;
  if (active === "tasks") return <ScheduledTasks />;
  if (active === "usage") return <Usage />;
  if (active === "skills") return <SkillsCenter />;
  if (active === "plugins") return <PluginCenter />;
  if (active === "security") return <Security />;
  if (active === "tutorials") return <Tutorials />;
  return <Admin />;
}

function statusLabel(tone: string) {
  if (tone === "success") return "正常";
  if (tone === "danger") return "异常";
  if (tone === "warning") return "待接入";
  return "监控";
}

function Overview() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#06B6D4] p-6 text-white shadow-lg md:p-8">
        <div className="absolute right-0 top-0 opacity-10">
          <Zap className="h-64 w-64 -translate-y-8 translate-x-8 rotate-12" />
        </div>
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">AI Agent 工作台</h2>
            <p className="mt-1 text-sm text-white/80">
              云端 Agent 服务运行中，U 盘用于激活、教程与交付
            </p>
          </div>
          <Badge className="self-start border-white/30 bg-white/20 text-white backdrop-blur">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            服务正常
          </Badge>
        </div>
        <div className="relative mt-5 grid gap-3 rounded-xl bg-white/10 p-4 text-sm backdrop-blur md:grid-cols-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-white/90" />
            <span className="text-white/85">云端 Agent 服务运行中，U 盘用于激活、教程与交付</span>
          </div>
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 shrink-0 text-white/90" />
            <span className="text-white/85">API Key 默认隐藏，请勿泄露给他人</span>
          </div>
          <div className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4 shrink-0 text-white/90" />
            <span className="text-white/85">技能包由管理员审核后开放，确保安全合规</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">引擎与模型状态</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <CompactStatusCard
            label="Hermes 模型供应"
            value="运行中"
            tone="success"
            detail="专属模型供应 Token 额度正常"
            accent="#10B981"
          />
          <CompactStatusCard
            label="Hermes 引擎"
            value="运行中"
            tone="success"
            detail="默认模型 kimi-k2.5"
            accent="#6366F1"
          />
          <CompactStatusCard
            label="Hermes 扩展"
            value="待接入"
            tone="warning"
            detail="v0.2 计划启用"
            accent="#F59E0B"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">核心指标</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="今日调用量"
            value="12,486"
            icon={<Play className="h-4 w-4" />}
            detail="较昨日 +18.4%"
            tone="info"
            accent="#0EA5E9"
          />
          <MetricCard
            label="剩余额度"
            value="¥842.60"
            icon={<ShieldCheck className="h-4 w-4" />}
            detail="月度额度剩余 68%"
            tone="success"
            accent="#10B981"
          />
          <MetricCard
            label="今日费用"
            value="¥37.42"
            icon={<Clipboard className="h-4 w-4" />}
            detail="预算内"
            tone="info"
            accent="#0EA5E9"
          />
          <MetricCard
            label="最近错误"
            value="4"
            icon={<AlertTriangle className="h-4 w-4" />}
            detail="主要来自网页搜索超时"
            tone="danger"
            accent="#F43F5E"
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Token 与费用趋势</CardTitle>
            <CardDescription>最近 7 天，单位：万 Token / 元</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <UsageAreaChart />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>热门模型</CardTitle>
            <CardDescription>按今日调用量排序</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {models.map((model, index) => (
              <div key={model.name} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{index + 1}. {model.name}</span>
                  <span className="text-muted-foreground">{model.tokens.toLocaleString()} tokens</span>
                </div>
                <Progress value={90 - index * 16} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CompactStatusCard({ label, value, tone, detail, accent }: { label: string; value: string; tone: string; detail: string; accent?: string }) {
  return (
    <Card accent={accent} className="py-3">
      <CardContent className="flex items-center justify-between p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-base font-semibold">{value}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
        </div>
        <Badge tone={tone as "success" | "info" | "warning" | "danger"} className="shrink-0">
          {statusLabel(tone)}
        </Badge>
      </CardContent>
    </Card>
  );
}

function Engines() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState("");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {engines.map((engine) => (
          <Card key={engine.name}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{engine.name}</CardTitle>
                  <CardDescription>{engine.description}</CardDescription>
                </div>
                <Badge tone={engine.status === "运行中" ? "success" : "warning"}>{engine.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="当前默认模型" value={engine.defaultModel} />
                <Metric label="运行时间" value={engine.uptime} />
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="mb-2 text-sm font-medium">最近日志</div>
                <div className="space-y-2 font-mono text-xs text-muted-foreground">
                  {engine.logs.map((log) => <div key={log}>{log}</div>)}
                </div>
              </div>
              <Button
                variant="destructive"
                disabled={engine.status !== "运行中"}
                onClick={() => {
                  setConfirmTarget(engine.name);
                  setConfirmOpen(true);
                }}
              >
                <Power className="h-4 w-4" />
                重启引擎
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {}}
        title={`重启引擎：${confirmTarget}`}
        description="重启引擎可能导致正在执行的任务中断。此操作为演示 UI，不会实际执行。"
        confirmLabel="确认重启"
      />
    </div>
  );
}

function ModelsQuota() {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Hermes 模型供应信息</CardTitle>
          <CardDescription>默认打码显示。Token 默认隐藏，请勿泄露给他人。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <Metric label="Base URL" value="https://api.u-agent.example.com/v1" />
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm text-muted-foreground">API Key</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">{visible ? apiKey : maskKey(apiKey)}</code>
              <Button variant="outline" size="icon" onClick={() => setVisible(!visible)} title="显示或隐藏 API Key">{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
              <Button variant="outline" size="icon" onClick={() => navigator.clipboard?.writeText(apiKey)} title="复制 API Key"><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">API Key 默认隐藏，请勿泄露给他人</p>
          </div>
          <div className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">剩余额度</span>
              <span className="text-muted-foreground">¥842.60 / ¥1,240.00</span>
            </div>
            <Progress value={68} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>可用模型</CardTitle>
          <CardDescription>用途说明可直接同步到 Cherry Studio 或 ChatBox 配置说明</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <thead><tr><Th>模型</Th><Th>服务商</Th><Th>用途</Th><Th>今日 Token</Th><Th>费用</Th></tr></thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.name}><Td className="font-medium">{model.name}</Td><Td>{model.provider}</Td><Td>{model.use}</Td><Td>{model.tokens.toLocaleString()}</Td><Td>¥{model.cost}</Td></tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MemoryFiles() {
  const [selected, setSelected] = useState<MemoryFile>(memoryFiles[0]);
  const [content, setContent] = useState<string>(selected.content);
  const [showEmpty, setShowEmpty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fileList = showEmpty ? [] : memoryFiles;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setShowEmpty(!showEmpty)}>
          {showEmpty ? "加载示例数据" : "演示空状态"}
        </Button>
        {!showEmpty && (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            <RefreshCcw className="h-4 w-4" />
            重置记忆文件
          </Button>
        )}
      </div>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>文件树</CardTitle>
            <CardDescription>工作台基础记忆模板</CardDescription>
          </CardHeader>
          <CardContent>
            {fileList.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <FileX className="h-10 w-10 text-muted-foreground/40" />
                <div className="text-sm font-medium">暂无记忆文件</div>
                <p className="text-xs text-muted-foreground">点击「新建文件」创建首个记忆模板</p>
                <Button size="sm" variant="outline">
                  <Plus className="h-3.5 w-3.5" />
                  新建文件
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {fileList.map((file) => {
                  const Icon = file.icon;
                  return (
                    <button
                      key={file.name}
                      onClick={() => { setSelected(file); setContent(file.content); }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm", selected.name === file.name ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                    >
                      <Icon className="h-4 w-4" />
                      {file.name}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{fileList.length > 0 ? selected.name : "编辑器"}</CardTitle>
                <CardDescription>Markdown 编辑器，v0.1 暂存于前端状态</CardDescription>
              </div>
              {fileList.length > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setContent(selected.content)}>
                    <RefreshCcw className="h-4 w-4" />
                    恢复默认
                  </Button>
                  <Button><Save className="h-4 w-4" />保存</Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {fileList.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground/40" />
                <div className="text-sm font-medium">选择文件开始编辑</div>
                <p className="text-xs text-muted-foreground">左侧文件树为空，请先创建记忆文件</p>
              </div>
            ) : (
              <Textarea value={content} onChange={(event) => setContent(event.target.value)} className="min-h-[520px] font-mono" />
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setContent(selected.content); }}
        title="重置记忆文件"
        description={`将 "${selected.name}" 恢复为默认模板，当前编辑内容将丢失。此操作为演示 UI，不会实际写入。`}
        confirmLabel="确认重置"
      />
    </div>
  );
}

function DreamMode() {
  const [enabled, setEnabled] = useState(true);
  const [showEmpty, setShowEmpty] = useState(false);

  const runs = showEmpty ? [] : dreamRuns;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>梦境模式</CardTitle>
              <CardDescription>低峰时段自动总结、整理记忆并优化提示词</CardDescription>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Option checked label="每日总结" detail="生成客户、任务、错误摘要" />
          <Option checked label="自动整理记忆" detail="合并 profile / FAQ 中重复信息" />
          <Option checked label="优化提示词" detail="基于失败案例调整回复策略" />
          <Metric label="预计 Token 消耗" value="18K - 25K / 天" />
          <Metric label="建议运行时间" value="03:20" />
          <Metric label="当前状态" value={enabled ? "今晚自动运行" : "已暂停"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>最近运行记录</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setShowEmpty(!showEmpty)}>
              {showEmpty ? "加载示例数据" : "演示空状态"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/40" />
              <div className="text-sm font-medium">暂无运行记录</div>
              <p className="text-xs text-muted-foreground">开启梦境模式后，记录将在此显示</p>
            </div>
          ) : (
            <Table>
              <thead><tr><Th>时间</Th><Th>结果</Th><Th>Token</Th><Th>状态</Th></tr></thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.time}><Td>{run.time}</Td><Td>{run.result}</Td><Td>{run.tokens}</Td><Td><Badge tone="success">{run.status}</Badge></Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScheduledTasks() {
  const [open, setOpen] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");

  const taskList = showEmpty ? [] : tasks;

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={() => setShowEmpty(!showEmpty)}>
          {showEmpty ? "加载示例数据" : "演示空状态"}
        </Button>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建任务</Button>
      </div>
      {open && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>新建定时任务</CardTitle>
            <CardDescription>v0.1 仅创建 UI，不写入后端</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Input placeholder="任务名称" />
            <Input placeholder="执行频率，例如 每天 09:00" />
            <Textarea placeholder="提示词" className="md:col-span-2" />
            <Input placeholder="模型，例如 kimi-k2.5" />
            <Input placeholder="推送渠道，例如 PushPlus" />
            <Option checked label="启用状态" detail="保存后立即进入计划队列" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={() => setOpen(false)}>保存任务</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>自动化日报、审计和模型任务</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {taskList.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CalendarClock className="h-10 w-10 text-muted-foreground/40" />
              <div className="text-sm font-medium">暂无定时任务</div>
              <p className="text-xs text-muted-foreground">点击「新建任务」创建自动化工作流，支持多模型和推送渠道</p>
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                创建首个任务
              </Button>
            </div>
          ) : (
            <Table>
              <thead><tr><Th>任务名称</Th><Th>执行频率</Th><Th>模型</Th><Th>推送渠道</Th><Th>启用</Th><Th>最近运行</Th><Th>下次运行</Th><Th>操作</Th></tr></thead>
              <tbody>
                {taskList.map((task) => (
                  <tr key={task.name}>
                    <Td className="font-medium">{task.name}</Td>
                    <Td>{task.frequency}</Td>
                    <Td>{task.model}</Td>
                    <Td>{task.channel}</Td>
                    <Td><Switch checked={task.enabled} /></Td>
                    <Td>{task.last}</Td>
                    <Td>{task.next}</Td>
                    <Td>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setDeleteTarget(task.name);
                          setConfirmOpen(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {}}
        title={`删除任务：${deleteTarget}`}
        description="删除后任务及相关记录将永久移除。此操作为演示 UI，不会实际执行。"
        confirmLabel="确认删除"
      />
    </div>
  );
}

function Usage() {
  const hasErrors = callLogs.some((log) => log.status !== "成功");
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={<Clipboard className="h-4 w-4" />} label="Token 用量" value="121 万" accent="#6366F1" />
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="费用统计" value="¥37.42" accent="#06B6D4" />
        <MetricCard icon={<Play className="h-4 w-4" />} label="消息调用量" value="1,248" accent="#0EA5E9" />
        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="错误数量" value="4" tone="danger" accent="#F43F5E" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Token 用量折线图</CardTitle></CardHeader>
          <CardContent className="h-72"><UsageAreaChart /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>热门服务商 / 工具</CardTitle></CardHeader>
          <CardContent className="h-72"><UsageBarChart /></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>最近调用日志</CardTitle>
              <CardDescription>实时记录每次 API 调用的详情</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!hasErrors ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
              <div className="text-sm font-medium">暂无错误日志</div>
              <p className="text-xs text-muted-foreground">所有 API 调用均正常，系统运行良好</p>
            </div>
          ) : (
            <Table>
              <thead><tr><Th>时间</Th><Th>用户</Th><Th>模型</Th><Th>服务商</Th><Th>Token</Th><Th>费用</Th><Th>状态</Th></tr></thead>
              <tbody>
                {callLogs.map((log) => (
                  <tr key={`${log.time}-${log.model}`}>
                    <Td>{log.time}</Td>
                    <Td>{log.user}</Td>
                    <Td>{log.model}</Td>
                    <Td>{log.provider}</Td>
                    <Td>{log.tokens}</Td>
                    <Td>{log.cost}</Td>
                    <Td><Badge tone={log.status === "成功" ? "success" : "danger"}>{log.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SkillsCenter() {
  const categories = useMemo(() => ["全部", ...Array.from(new Set(skills.map((skill) => skill.category)))], []);
  const [category, setCategory] = useState("全部");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState("");

  const filtered = category === "全部" ? skills : skills.filter((skill) => skill.category === category);
  const installedOnly = skills.filter((s) => s.installed);
  const uninstalledOnly = skills.filter((s) => !s.installed);
  const [showOnly, setShowOnly] = useState<"all" | "installed" | "uninstalled">("all");

  let displaySkills = filtered;
  if (showOnly === "installed") displaySkills = installedOnly.filter((s) => category === "全部" || s.category === category);
  if (showOnly === "uninstalled") displaySkills = uninstalledOnly.filter((s) => category === "全部" || s.category === category);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">技能包由管理员审核后开放，请按需安装使用</p>
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((item) => (
          <Button key={item} variant={item === category ? "default" : "outline"} size="sm" onClick={() => setCategory(item)}>
            {item}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant={showOnly === "all" ? "default" : "outline"} size="sm" onClick={() => setShowOnly("all")}>全部</Button>
          <Button variant={showOnly === "installed" ? "default" : "outline"} size="sm" onClick={() => setShowOnly("installed")}>已安装</Button>
          <Button variant={showOnly === "uninstalled" ? "default" : "outline"} size="sm" onClick={() => setShowOnly("uninstalled")}>未安装</Button>
        </div>
      </div>
      {displaySkills.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
          <PackageOpen className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-sm font-medium">
            {showOnly === "uninstalled" ? "所有技能已安装" : "暂无匹配技能"}
          </div>
          <p className="text-xs text-muted-foreground">
            {showOnly === "uninstalled"
              ? "所有可用技能均已安装使用"
              : "技能包由管理员审核后开放，请关注后续更新"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displaySkills.map((skill) => (
            <Card key={skill.name}>
              <CardHeader>
                <div className="flex justify-between gap-3">
                  <div>
                    <CardTitle>{skill.name}</CardTitle>
                    <CardDescription>{skill.example}</CardDescription>
                  </div>
                  <Badge tone={skill.installed ? "success" : "muted"}>
                    {skill.installed ? "已安装" : "可安装"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Badge tone={skill.risk === "高" ? "danger" : skill.risk === "中" ? "warning" : "success"}>
                    风险 {skill.risk}
                  </Badge>
                  <Badge tone="muted">{skill.category}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">权限：{skill.permission}</p>
                {skill.installed ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConfirmTarget(skill.name);
                      setConfirmOpen(true);
                    }}
                  >
                    卸载
                  </Button>
                ) : (
                  <Button>安装</Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {}}
        title={`卸载技能：${confirmTarget}`}
        description="卸载后该技能将无法使用，相关配置将保留。此操作为演示 UI，不会实际执行。"
        confirmLabel="确认卸载"
      />
    </div>
  );
}

function PluginCenter() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);

  const enabledPlugins = plugins.filter((p) => p.enabled);
  const displayPlugins = showDisabled ? plugins.filter((p) => !p.enabled) : plugins;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant={!showDisabled ? "default" : "outline"} size="sm" onClick={() => setShowDisabled(false)}>
          已启用 ({enabledPlugins.length})
        </Button>
        <Button variant={showDisabled ? "default" : "outline"} size="sm" onClick={() => setShowDisabled(true)}>
          未启用 ({plugins.length - enabledPlugins.length})
        </Button>
      </div>
      {displayPlugins.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
          <PackageOpen className="h-10 w-10 text-muted-foreground/40" />
          <div className="text-sm font-medium">
            {showDisabled ? "所有插件已启用" : "暂无已启用插件"}
          </div>
          <p className="text-xs text-muted-foreground">
            {showDisabled ? "所有可用插件均已启用，系统运行完整" : "前往「未启用」标签页开启需要的插件"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displayPlugins.map((plugin) => (
            <Card key={plugin.name}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plugin.name}</CardTitle>
                  <Switch checked={plugin.enabled} />
                </div>
                <CardDescription>插件权限说明</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{plugin.permission}</p>
                {plugin.enabled && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmTarget(plugin.name);
                      setConfirmOpen(true);
                    }}
                  >
                    禁用插件
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {}}
        title={`禁用插件：${confirmTarget}`}
        description="禁用后相关功能将停止工作。此操作为演示 UI，不会实际执行。"
        confirmLabel="确认禁用"
      />
    </div>
  );
}

function Security() {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>账号安全</CardTitle>
            <CardDescription>修改密码 UI 与 API Key 显示控制</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="password" placeholder="当前密码" />
            <Input type="password" placeholder="新密码" />
            <div className="flex gap-2">
              <Input value={show ? apiKey : maskKey(apiKey)} readOnly />
              <Button variant="outline" size="icon" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button>保存安全设置</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>访问与额度限制</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Metric label="每日额度限制" value="¥120.00" />
            <Option checked label="Skills 白名单" detail="仅允许已审批技能运行" />
            <Option checked label="禁止危险命令" detail="拦截 rm、reset、shell 执行等高风险行为" />
            <Option checked label="文件访问范围" detail="/workspace 和授权资料目录" />
            <Option checked label="插件权限" detail="按插件单独授权启停" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>操作审计日志</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <thead><tr><Th>时间</Th><Th>操作</Th><Th>对象</Th><Th>风险</Th></tr></thead>
            <tbody>
              <tr><Td>10:18</Td><Td>显示 API Key</Td><Td>demo@u-agent.cn</Td><Td><Badge tone="warning">中</Badge></Td></tr>
              <tr><Td>09:54</Td><Td>启用插件</Td><Td>文件读取</Td><Td><Badge tone="warning">中</Badge></Td></tr>
              <tr><Td>09:02</Td><Td>保存记忆文件</Td><Td>profile.md</Td><Td><Badge tone="success">低</Badge></Td></tr>
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Tutorials() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {["Cherry Studio 配置教程", "ChatBox 配置教程"].map((title) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Base URL / API Key / 模型名说明</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Step n={1} text="打开模型服务商设置，新建 OpenAI Compatible 配置。" />
            <Step n={2} text="Base URL 填入 https://api.u-agent.example.com/v1。" />
            <Step n={3} text={`API Key 填入 ${maskKey(apiKey)}，模型名选择 deepseek-chat 或 kimi-k2.5。`} />
            <Step n={4} text="保存后发送一条测试消息，确认调用日志出现成功记录。" />
          </CardContent>
        </Card>
      ))}
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle>常见问题</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Faq q="U 盘拔掉后还能用吗？" a="可以。U 盘主要用于激活入口、教程和交付载体，核心服务在云端运行。" />
          <Faq q="可以换模型吗？" a="可以在模型与额度中选择 DeepSeek 或 Kimi / Moonshot 渠道。" />
          <Faq q="危险操作会执行吗？" a="v0.1 中所有重启、禁用和危险操作均为 UI，不会实际执行。" />
          <Faq q="后续怎么接真实后端？" a="替换 lib/mock-data.ts 为 API 请求，并用 Prisma schema 落库即可。" />
          <Faq q="API Key 安全吗？" a="API Key 默认隐藏，请勿泄露给他人。可在安全设置中管理显示权限。" />
          <Faq q="技能包如何获取？" a="技能包由管理员审核后开放，请联系管理员开通所需技能。" />
        </CardContent>
      </Card>
    </div>
  );
}

function Admin() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>客户与套餐</CardTitle>
          <CardDescription>用户列表、套餐、激活码、Token 额度与客户状态</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <thead><tr><Th>客户</Th><Th>套餐</Th><Th>激活码</Th><Th>Token 额度</Th><Th>状态</Th><Th>操作</Th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.code}>
                  <Td className="font-medium">{user.name}</Td>
                  <Td>{user.plan}</Td>
                  <Td><code>{user.code}</code></Td>
                  <Td>{user.quota}</Td>
                  <Td><Badge tone={user.status === "正常" ? "success" : "warning"}>{user.status}</Badge></Td>
                  <Td><Button variant="destructive" size="sm"><ShieldAlert className="h-4 w-4" />禁用用户</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={<UploadCloud className="h-4 w-4" />} label="总客户数" value="128" accent="#6366F1" />
        <MetricCard icon={<Clipboard className="h-4 w-4" />} label="本月消耗" value="¥9,842" accent="#0EA5E9" />
        <MetricCard icon={<AlertTriangle className="h-4 w-4" />} label="待续费客户" value="7" tone="warning" accent="#F59E0B" />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  detail,
  tone,
  accent
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  detail?: string;
  tone?: string;
  accent?: string;
}) {
  return (
    <Card accent={accent}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted" style={accent ? { color: accent } : undefined}>
            {icon}
          </span>
          {label}
        </CardDescription>
        <CardTitle className="flex items-center justify-between text-2xl">
          {value}
          {tone && <Badge tone={tone as "success" | "info" | "warning" | "danger"}>{statusLabel(tone)}</Badge>}
        </CardTitle>
      </CardHeader>
      {detail && (
        <CardContent>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      )}
    </Card>
  );
}

function Option({ checked, label, detail }: { checked: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Switch checked={checked} />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">{n}</span>
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="font-medium">{q}</div>
      <p className="mt-1 text-sm text-muted-foreground">{a}</p>
    </div>
  );
}

function UsageAreaChart() {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={[...tokenUsage]}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
        <Area type="monotone" dataKey="tokens" stroke="#6366F1" fill="#6366F1" fillOpacity={0.16} name="万 Token" />
        <Area type="monotone" dataKey="cost" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.12} name="费用" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function UsageBarChart() {
  const data = [
    { name: "Moonshot", value: 46 },
    { name: "DeepSeek", value: 39 },
    { name: "文件读取", value: 18 },
    { name: "网页搜索", value: 11 },
    { name: "PushPlus", value: 8 }
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
        <Bar dataKey="value" fill="#6366F1" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
