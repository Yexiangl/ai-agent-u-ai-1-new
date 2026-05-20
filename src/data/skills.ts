export const skillCategories = ["校园副业", "自媒体", "学习资料", "编程辅助", "通用办公"] as const;

export const skills = [
  { id: "moments-copy", name: "朋友圈宣传文案", category: "校园副业", description: "把产品卖点转成自然、不硬广的朋友圈文案。", risk: "低", model: "kimi-k2.6", prompt: "请根据以下产品信息，生成 3 条适合朋友圈发布的宣传文案，语气自然、真实、有购买引导。" },
  { id: "customer-reply", name: "客户咨询回复", category: "通用办公", description: "根据客户问题生成专业、简洁的回复。", risk: "低", model: "deepseek-v4-flash", prompt: "请根据客户问题生成一段清晰、礼貌、能推动成交的回复。" },
  { id: "price-table", name: "价格表整理", category: "通用办公", description: "把零散报价整理成结构化价格表。", risk: "中", model: "deepseek-v4-pro", prompt: "请把以下价格信息整理成表格，并补充适合发给客户的说明文字。" },
  { id: "after-sales", name: "售后解释话术", category: "通用办公", description: "生成安抚型售后解释和处理建议。", risk: "中", model: "kimi-k2.6", prompt: "请针对以下售后问题生成解释话术，要求态度友好、边界清晰、不承诺无法做到的事情。" },
  { id: "agent-moments", name: "代理商发圈文案", category: "校园副业", description: "为代理商生成多角度发圈素材。", risk: "低", model: "kimi-k2.6", prompt: "请生成 5 条代理商适合发布的朋友圈文案，分别强调收益、低门槛、案例、服务和限时活动。" },
  { id: "xiaohongshu", name: "小红书文案生成", category: "自媒体", description: "生成标题、正文和话题标签。", risk: "低", model: "kimi-k2.6", prompt: "请生成一篇小红书风格内容，包含 5 个标题、正文和 8 个话题标签。" },
  { id: "video-script", name: "短视频脚本", category: "自媒体", description: "生成口播脚本、分镜和结尾引导。", risk: "低", model: "deepseek-v4-flash", prompt: "请生成一个 60 秒短视频脚本，包含开头钩子、3 个卖点、口播稿和结尾行动引导。" },
  { id: "study-summary", name: "学习资料总结", category: "学习资料", description: "把长资料总结成重点和复习提纲。", risk: "低", model: "deepseek-v4-pro", prompt: "请总结以下学习资料，输出核心知识点、易错点和复习清单。" },
  { id: "code-error", name: "代码报错解释", category: "编程辅助", description: "解释报错原因并给出修复步骤。", risk: "中", model: "deepseek-v4-pro", prompt: "请解释以下代码报错的原因，并给出可执行的排查步骤和修复建议。" },
  { id: "server-deploy", name: "服务器部署助手", category: "编程辅助", description: "生成部署检查清单和问题排查建议。", risk: "高", model: "deepseek-v4-pro", prompt: "请根据以下部署目标生成检查清单和排错步骤。不要执行命令，只输出建议。" }
] as const;
