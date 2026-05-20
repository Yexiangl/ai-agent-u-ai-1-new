import {
  Activity,
  Bot,
  Brain,
  CalendarClock,
  Database,
  FileText,
  Gauge,
  Home,
  KeyRound,
  LockKeyhole,
  Plug,
  Puzzle,
  ShieldCheck,
  Sparkles,
  TerminalSquare
} from "lucide-react";

export const navItems = [
  { id: "overview", label: "首页总览", icon: Home },
  { id: "engines", label: "Hermes 管理", icon: Bot, children: ["Hermes"] },
  { id: "models", label: "模型与额度", icon: Gauge },
  { id: "memory", label: "记忆文件", icon: FileText },
  { id: "dream", label: "梦境模式", icon: Brain },
  { id: "tasks", label: "定时任务", icon: CalendarClock },
  { id: "usage", label: "使用情况", icon: Activity },
  { id: "skills", label: "Skills 技能中心", icon: Sparkles },
  { id: "plugins", label: "插件中心", icon: Plug },
  { id: "security", label: "安全设置", icon: ShieldCheck },
  { id: "tutorials", label: "使用教程", icon: Puzzle },
  { id: "admin", label: "管理后台", icon: LockKeyhole }
] as const;

export const statusCards = [
  { label: "Hermes 模型供应", value: "运行中", detail: "专属模型供应 Token 额度正常", tone: "success" },
  { label: "Hermes 状态", value: "运行中", detail: "默认模型 kimi-k2.5", tone: "success" },
  { label: "Hermes 扩展状态", value: "待接入", detail: "后续计划启用", tone: "warning" },
  { label: "今日调用量", value: "12,486", detail: "较昨日 +18.4%", tone: "default" },
  { label: "剩余额度", value: "¥ 842.60", detail: "月度额度剩余 68%", tone: "success" },
  { label: "今日费用", value: "¥ 37.42", detail: "预算内", tone: "default" },
  { label: "已启用技能数", value: "9", detail: "3 个需要敏感权限", tone: "warning" },
  { label: "最近错误", value: "4", detail: "主要来自网页搜索超时", tone: "danger" }
] as const;

export const engines = [
  {
    name: "Hermes",
    status: "运行中",
    defaultModel: "kimi-k2.5",
    uptime: "12 天 6 小时",
    description: "对话、任务编排、工具调用",
    logs: ["09:41 summary job finished", "09:22 memory profile.md synced", "08:55 model supply checked"]
  },
  {
    name: "Hermes 扩展",
    status: "待接入",
    defaultModel: "deepseek-chat",
    uptime: "未启动",
    description: "复杂工作流、后续云端执行器",
    logs: ["integration token pending", "service route reserved", "admin restart endpoint disabled"]
  }
] as const;

export const models = [
  { name: "deepseek-chat", provider: "DeepSeek", use: "通用对话、客服回复、长文本整理", tokens: 1834200, cost: 18.2 },
  { name: "deepseek-reasoner", provider: "DeepSeek", use: "复杂推理、报价分析、任务规划", tokens: 642100, cost: 21.7 },
  { name: "kimi-k2.5", provider: "Moonshot", use: "中文办公、资料整理、多轮任务", tokens: 1206200, cost: 29.4 },
  { name: "moonshot-v1-128k", provider: "Moonshot", use: "大上下文文件问答、知识库摘要", tokens: 931000, cost: 42.1 }
] as const;

export const tokenUsage = [
  { day: "周四", tokens: 82, cost: 18, calls: 860, errors: 2 },
  { day: "周五", tokens: 106, cost: 24, calls: 1120, errors: 4 },
  { day: "周六", tokens: 64, cost: 13, calls: 700, errors: 1 },
  { day: "周日", tokens: 58, cost: 11, calls: 620, errors: 1 },
  { day: "周一", tokens: 132, cost: 31, calls: 1360, errors: 5 },
  { day: "周二", tokens: 149, cost: 35, calls: 1490, errors: 3 },
  { day: "今天", tokens: 121, cost: 37, calls: 1248, errors: 4 }
] as const;

export const memoryFiles = [
  { name: "profile.md", icon: FileText, content: "# 客户画像\n\n- 主要客户：购买 U 盘 AI 工作台的中小商家\n- 目标：低门槛启用 AI Agent\n- 服务方式：云端运行，本地 U 盘承载激活、教程和交付资料" },
  { name: "business.md", icon: Database, content: "# 业务说明\n\n模型供应通过 Hermes 配置，当前渠道包含 DeepSeek 与 Kimi / Moonshot。核心工作台围绕 Hermes Agent。" },
  { name: "price-list.md", icon: KeyRound, content: "# 套餐价格\n\n- 入门版：基础额度 + 教程\n- 专业版：更高 Token 额度 + 定时任务\n- 团队版：管理后台 + 多用户" },
  { name: "faq.md", icon: Puzzle, content: "# 常见问题\n\nQ: U 盘拔掉后能否继续使用？\nA: U 盘主要作为激活入口和交付载体，核心服务运行在云端。" },
  { name: "reply-style.md", icon: TerminalSquare, content: "# 回复风格\n\n清晰、专业、少废话。遇到危险命令需要拒绝或提示管理员确认。" }
] as const;

export const dreamRuns = [
  { time: "今天 03:20", result: "完成每日总结，整理 6 条客户偏好", tokens: "18.2K", status: "成功" },
  { time: "昨天 03:20", result: "优化客服回复提示词，新增报价约束", tokens: "21.4K", status: "成功" },
  { time: "周一 03:20", result: "faq.md 合并重复问题", tokens: "16.8K", status: "成功" }
] as const;

export const tasks = [
  { name: "每日客户线索总结", frequency: "每天 09:00", prompt: "整理昨日对话中的客户意向", model: "kimi-k2.5", channel: "PushPlus", enabled: true, last: "成功", next: "明天 09:00" },
  { name: "报价单检查", frequency: "每 4 小时", prompt: "检查 price-list.md 与最新套餐是否一致", model: "deepseek-chat", channel: "邮箱", enabled: true, last: "成功", next: "今天 14:00" },
  { name: "高风险命令审计", frequency: "每天 22:30", prompt: "汇总危险命令拦截记录", model: "deepseek-reasoner", channel: "Telegram", enabled: false, last: "暂停", next: "未计划" }
] as const;

export const skills = [
  { name: "报价生成", category: "销售", installed: true, risk: "低", permission: "读取 price-list.md", example: "根据客户需求生成报价单" },
  { name: "客户画像整理", category: "记忆", installed: true, risk: "中", permission: "写入 profile.md", example: "提炼客户行业、预算和偏好" },
  { name: "网页资料检索", category: "研究", installed: false, risk: "中", permission: "访问公开网页", example: "查询竞品信息并摘要" },
  { name: "文件批量读取", category: "文件", installed: false, risk: "高", permission: "读取授权目录", example: "整理交付资料中的 FAQ" },
  { name: "自动售后回复", category: "客服", installed: true, risk: "中", permission: "读取 FAQ 和回复风格", example: "生成微信客服回复" }
] as const;

export const plugins = [
  { name: "PushPlus 微信推送", enabled: true, permission: "发送任务结果到管理员微信" },
  { name: "Telegram", enabled: false, permission: "发送任务状态与错误警报" },
  { name: "邮箱", enabled: true, permission: "发送日报与客户通知" },
  { name: "文件读取", enabled: true, permission: "读取白名单目录内文件" },
  { name: "网页搜索", enabled: false, permission: "访问公开网络搜索结果" },
  { name: "Hermes 模型供应接口", enabled: true, permission: "通过 Hermes 调用模型渠道" }
] as const;

export const callLogs = [
  { time: "10:32:18", user: "demo@u-agent.cn", model: "kimi-k2.5", provider: "Moonshot", tokens: "4,280", cost: "¥0.42", status: "成功" },
  { time: "10:21:02", user: "ops@u-agent.cn", model: "deepseek-chat", provider: "DeepSeek", tokens: "2,110", cost: "¥0.08", status: "成功" },
  { time: "10:04:43", user: "demo@u-agent.cn", model: "moonshot-v1-128k", provider: "Moonshot", tokens: "18,902", cost: "¥2.31", status: "成功" },
  { time: "09:58:11", user: "test@u-agent.cn", model: "deepseek-reasoner", provider: "DeepSeek", tokens: "0", cost: "¥0.00", status: "超时" }
] as const;

export const users = [
  { name: "广州云启商贸", plan: "专业版", code: "UA-2026-8K29", quota: "¥842.60", status: "正常" },
  { name: "杭州小鹿电商", plan: "入门版", code: "UA-2026-N4Q7", quota: "¥126.30", status: "正常" },
  { name: "深圳星河咨询", plan: "团队版", code: "UA-2026-Z9P1", quota: "¥2,410.00", status: "待续费" }
] as const;
