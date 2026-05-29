# v0.3.0 真实 token 人工冒烟测试清单

TASK-040E | 状态：待人工执行 | 需要低额度测试 token

---

## 测试目标

验证真实客户主路径：

```
粘贴模型访问密钥 → 一键启用 AI 助手 → 自动配置 →
自动启动 → 自动检查 → 开始对话 → 用量统计出现
```

---

## 测试前准备

- [ ] 准备低额度真实测试 token（不使用正式客户 token）
- [ ] 不把 token 写入文档、截图、回执
- [ ] 确认 `git status` clean
- [ ] 备份 `~/.openclaw/openclaw.json`
- [ ] 记录当前 probe 结果基线
- [ ] 确认测试完成后需要恢复原配置

---

## 测试步骤

| 步骤 | 操作 | 预期结果 | 验证方法 |
|---|---|---|---|
| 1 | 打开 App | 正常启动 | |
| 2 | 进入 AI 助手页 | 页面加载正常 | |
| 3 | 找到"启用 AI 助手"卡片 | 卡片存在。如已配置可跳过 | 卡片标题、输入框、按钮完整 |
| 4 | 粘贴测试 token | token 以 password 形式显示（***） | 不截图展示 token |
| 5 | 点击"一键启用 AI 助手" | 触发配置写入 | |
| 6 | 观察状态流 | 正在保存配置 → 正在启动 → 正在检查 → AI 助手已启用，可以开始对话 | 每个阶段文案正确 |
| 7 | 进入 AI 对话页 | 页面正常 | 不显示"需要配置" |
| 8 | 发送 "hi" | 有正常回复 | 回复内容合理 |
| 9 | 确认消息来源显示 | 显示 "AI Agent" | 不显示技术词 |
| 10 | 进入本地用量概览 | 页面正常 | |
| 11 | 查看用量统计 | 有真实统计，或明确解释未返回 usage | 不显示 0 伪装正常 |
| 12 | 备份原配置 | 可恢复 | |
| 13 | 恢复原配置 | openclaw.json 恢复到测试前状态 | |
| 14 | 重新运行 probe | probe 通过 | /v1/models + /v1/chat/completions |
| 15 | 确认 token 未泄露 | 文档/截图/日志无 token | |

---

## 关键确认项

| 确认项 | 检查方式 |
|---|---|
| usage 是否保存 | AI 对话后，消息 footer 或用量概览有数据 |
| 用量概览是否更新 | 打开本地用量概览，Token 统计非 0 或有明确"暂未提供" |
| 技术词不暴露 | AI 助手页无 OpenClaw/Gateway/provider/baseUrl |
| 终端命令不出现 | 页面无 openclaw gateway start/restart |

---

## 通过标准

- [ ] 一键启用流程成功完成
- [ ] AI 对话能回复
- [ ] usage 被保存到消息记录
- [ ] 用量概览有真实统计或明确解释
- [ ] token 不出现在 UI/docs/AGENT_BOARD/logs
- [ ] 测试后原配置恢复成功

---

## 失败分类

失败时必须归类，并记录到测试结果表：

| 失败类型 | 说明 |
|---|---|
| token 无效 | Token 格式或权限不正确 |
| token 额度不足 | 中转站额度已用完 |
| 中转站不可达 | `https://ai.f1class.icu/v1` 不可达 |
| 配置写入失败 | `apply_openclaw_model_provider_config` 返回错误 |
| config validate 失败 | `openclaw config validate` 非零退出 |
| 本地服务启动失败 | `start_openclaw_gateway` 失败 |
| probe 失败 | /v1/models 或 /v1/chat/completions 不可用 |
| AI 对话失败 | send 返回错误或超时 |
| usage 未返回 | API 响应无 usage 字段 |
| 用量概览未更新 | UsagePage 仍显示旧数据或 0 |
| 配置恢复失败 | 原配置未能正确恢复 |

---

## 安全要求

- [ ] 不在终端输出 token
- [ ] 不在回执中输出 token
- [ ] 不把 token 写入 docs/AGENT_BOARD
- [ ] 不读取 .env
- [ ] 不执行 doctor --fix
- [ ] 不执行 config set
- [ ] 不执行 openclaw update
- [ ] 不执行 gateway restart/stop
- [ ] 不安装/卸载能力
- [ ] 不输出完整 openclaw.json

---

## 测试记录模板

| 项目 | 结果 | 备注 |
|---|---|---|
| git status clean | ☐ | |
| 配置已备份 | ☐ | |
| 一键启用成功 | ☐ | |
| config validate 通过 | ☐ | |
| probe 通过 | ☐ | |
| AI 对话成功 | ☐ | |
| usage 保存 | ☐ | |
| 用量概览更新 | ☐ | |
| 原配置恢复 | ☐ | |
| 敏感信息无泄露 | ☐ | |
| token 不在回执中 | ☐ | |
