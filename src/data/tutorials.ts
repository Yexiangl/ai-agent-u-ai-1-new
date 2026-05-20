export const tutorials = [
  { title: "本 App 使用教程", steps: ["先进入 Hermes 管理页确认本机 Hermes 状态。", "进入模型供应页读取 Hermes 配置。", "填写专属模型供应 Token，用于配置 Hermes 的模型供应额度。", "本地对话服务运行后，进入 Agent 对话页发送第一条问题。"] },
  { title: "Hermes 模型供应配置教程", steps: ["在模型供应页查看 Hermes 当前 Provider、模型和 Base URL。", "复制 Hermes 配置命令作为参考。", "密钥文件路径为 ~/.hermes/.env，本 App 只显示路径，不读取密钥。", "应用到 Hermes 功能将在后续版本开放。"] },
  { title: "ChatBox 配置教程", steps: ["打开设置，选择自定义模型服务。", "填写 Base URL 和 API Key。", "选择模型名并发送测试消息。"] }
];
