# 助手记忆数据源审计与 OpenClaw 记忆接入方案

TASK-033A：审计当前助手记忆实现，确认数据来源，查清 OpenClaw 记忆文件位置，输出重构方案。

---

## 1. 当前实现数据源

### 1.1 前端调用链

```
MemoryPage (App.tsx:3813)
  → readHermesNativeMemory() (hermes.ts:196)
    → Tauri invoke "read_hermes_native_memory"
      → Rust fn read_hermes_native_memory (main.rs:1409)
```

### 1.2 Rust 实现

**命令**：`read_hermes_native_memory` (`main.rs:1409-1470`)

**读取路径**：`~/.hermes/`

**查找文件**：
| 相对路径 | 文件 |
|---|---|
| `SOUL.md` | 根目录 |
| `MEMORY.md` | 根目录 |
| `USER.md` | 根目录 |
| `memory/SOUL.md` | memory/ 子目录 |
| `memory/MEMORY.md` | memory/ 子目录 |
| `memory/USER.md` | memory/ 子目录 |
| `memories/SOUL.md` | memories/ 子目录 |
| `memories/MEMORY.md` | memories/ 子目录 |
| `memories/USER.md` | memories/ 子目录 |
| `memories/users/*/USER.md` | 多用户目录 |

**返回格式**（`HermesNativeMemoryResult`）：
```typescript
{
  homeDir: "~/.hermes",
  found: boolean,
  files: [{ id, title, relativePath, size, updatedAt, kind, preview }],
  checkedAt: string,
  error: string | null
}
```

**安全措施**：
- 仅读取 `.md` 文件
- `collect_memory_file` 对内容做 `redact_sensitive_content()` 脱敏
- 只读前 50KB，预览前 500 字符
- 路径 canonicalize 检查防穿越

### 1.3 当前数据显示

| 区域 | 文案 | 说明 |
|---|---|---|
| 页面标题 | "助手记忆" | 泛称，未指定来源 |
| 描述 | "Agent 的原生记忆文件" | 暗示 Hermes（下方参考 "Hermes 原生记忆文件"） |
| 指标 | "助手记忆目录 / 已发现记忆文件 / 最近扫描" | ✅ |
| 文件列表 | 文件名 + kind badge（SOUL/MEMORY/USER） | 来自 Hermes |
| 文件详情 | "从左侧选择一个 Hermes 原生记忆文件查看" | 明确写了 Hermes |

**结论：当前助手记忆页完全读取 Hermes 的 `~/.hermes/` 目录，OpenClaw 记忆完全没有接入。**

---

## 2. OpenClaw 记忆文件

### 2.1 文件系统结构

通过本地检查确认：

**`~/.openclaw/workspace/`**（Markdown 文件）：

| 文件 | 大小 | 用途 |
|---|---|---|
| `SOUL.md` | 1,806 B | Agent 个性/规则定义 |
| `USER.md` | 537 B | 用户偏好/信息 |
| `AGENTS.md` | 7,938 B | 多 Agent 协作说明 |
| `HEARTBEAT.md` | 226 B | Agent 运行状态 |
| `IDENTITY.md` | 553 B | Agent 身份信息 |
| `TOOLS.md` | 920 B | 工具使用说明 |

**`~/.openclaw/memory/`**（SQLite）：
| 文件 | 大小 | 用途 |
|---|---|---|
| `main.sqlite` | 69,632 B | 向量/结构化长期记忆 |

### 2.2 可读性分析

| 数据源 | 可读性 | 建议 |
|---|---|---|
| `~/.openclaw/workspace/*.md` | ✅ 纯文本，可直接读取 | **优先接入** |
| `~/.openclaw/memory/main.sqlite` | ⚠️ SQLite 数据库，需了解 schema | P2 探索 |
| OpenClaw CLI `memory` 子命令 | ❌ 不存在 | 走文件系统 |

### 2.3 推荐读取路径

与 Hermes 实现类似的只读模式：

```
~/.openclaw/workspace/
  ├── SOUL.md      → kind: "soul"
  ├── USER.md      → kind: "user"
  ├── AGENTS.md    → kind: "agents"
  ├── HEARTBEAT.md → kind: "heartbeat"
  ├── IDENTITY.md  → kind: "identity"
  └── TOOLS.md     → kind: "tools"
```

### 2.4 与 Hermes 对比

| 属性 | Hermes (`~/.hermes/`) | OpenClaw (`~/.openclaw/workspace/`) |
|---|---|---|
| 文件格式 | .md | .md |
| 核心文件 | SOUL.md, MEMORY.md, USER.md | SOUL.md, USER.md, AGENTS.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md |
| 多用户 | memories/users/*/USER.md | 无（单用户 workspace） |
| 额外存储 | .env, config.yaml (禁止读取) | main.sqlite (P2 探索) |
| 当前接入 | ✅ 已接入 | ❌ 未接入 |

---

## 3. 为什么当前显示 Hermes 记忆

1. **历史原因**：App 最初基于 Hermes 后端构建，`read_hermes_native_memory` 是早期的原生能力
2. **迁移未完成**：切换到 OpenClaw HTTP-first 时，对话/模型/配置已迁移，但记忆页未更新
3. **OpenClaw 记忆未被发现**：没有人审计过 OpenClaw 的 `workspace/` 目录结构

---

## 4. 推荐实现方案

### 4.1 TASK-033B：新增 OpenClaw 记忆只读命令（P0）

**目标**：读取 `~/.openclaw/workspace/*.md`，与 Hermes 记忆并列或优先显示。

**Rust 命令**：`read_openclaw_workspace_memory`

- 路径：`~/.openclaw/workspace/`
- 读取 `.md` 文件（SOUL, USER, AGENTS, IDENTITY, TOOLS, HEARTBEAT）
- 复用 `collect_memory_file` 的脱敏/预览/防穿越逻辑
- 返回格式与 `HermesNativeMemoryResult` 兼容

**前端改动**：
- MemoryPage 调用 `read_openclaw_workspace_memory()`
- 数据源标识：显示 "OpenClaw 工作区" 或 "OpenClaw workspace"
- 描述改为 "Agent 的工作区记忆文件"

### 4.2 TASK-033C：双源分区显示（P1）

**目标**：同时显示 OpenClaw 和 Hermes 记忆，让用户了解数据来自哪里。

**UI 方案**：
```
助手记忆
├── 数据源：OpenClaw 工作区
│   ├── SOUL.md
│   ├── USER.md
│   ├── AGENTS.md
│   └── ...
├── 数据源：Hermes Legacy（已停用）
│   ├── SOUL.md
│   └── ...
```

- 默认展开 OpenClaw，Hermes 折叠
- Hermes 标记 "已停用 / 只读 / 仅作参考"

### 4.3 TASK-033D：记忆文件详情 polish（P2）

**目标**：文件预览页显示文件来源、最后修改时间、kind badge。

### 4.4 TASK-033E：记忆模块回归测试（P2）

**目标**：验证双源切换、文件列表、只读预览。

---

## 5. 安全边界

### 5.1 当前已保护

| 措施 | 状态 |
|---|---|
| 仅读取 .md 文件 | ✅ Hermes 现有实现 |
| canonicalize 防路径穿越 | ✅ Hermes 现有实现 |
| 内容脱敏 `redact_sensitive_content()` | ✅ Hermes 现有实现 |
| 只读前 50KB，预览前 500 字 | ✅ Hermes 现有实现 |
| 不写文件 | ✅ 只读 |
| 不读 .env | ✅ |
| 不读 Token | ✅ |

### 5.2 OpenClaw 接入注意事项

- **不要读 `~/.openclaw/openclaw.json`**（包含 gateway.auth.token）
- **不要读 `~/.openclaw/memory/main.sqlite`** 的完整内容（可能含对话历史），仅 P2 探索 schema
- **不要读 `~/.openclaw/workspace/.openclaw/`** 内部状态文件
- workspace 下的 `.git/` 目录不读取
- 仅读取 `.md` 文件，过滤其他格式

---

## 6. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估工时 |
|---|---|---|---|
| TASK-033B | P0 | Rust 命令 `read_openclaw_workspace_memory` + 前端接入 | 1.5h |
| TASK-033C | P1 | MemoryPage 双源分区 UI（OpenClaw 优先，Hermes legacy） | 1h |
| TASK-033D | P2 | 记忆文件详情页 polish（来源标识/时间/kind badge） | 0.5h |
| TASK-033E | P2 | 记忆模块回归测试 | 0.5h |

---

## 7. 结论

1. **当前实现**：助手记忆页完全读取 Hermes `~/.hermes/`，OpenClaw 记忆未接入 ❌
2. **OpenClaw 有记忆**：`~/.openclaw/workspace/` 含 6 个 .md 文件，与 Hermes 结构类似 ✅
3. **接入成本低**：复用现有 `collect_memory_file` 逻辑，新增 Rust 命令 + 前端调用
4. **建议优先接 OpenClaw**：作为当前主后端，Hermes 保留为 legacy 参考
5. **本轮未修改业务代码**：仅审计 + 方案输出
