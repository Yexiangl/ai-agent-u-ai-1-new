# AI Agent Workspace

U 盘交付版 AI Agent 工作台桌面 App。当前已迁移为 Tauri + React + TypeScript + Vite + Tailwind CSS。

## 当前阶段

- 第一阶段：Tauri + Vite 桌面项目结构、窗口配置、Sidebar/Header、基础 UI 已完成
- 第二阶段：Hermes 管理、Hermes Agent 对话、模型供应配置、技能包、记忆文件、本地配置存储已完成

## 开发命令

```bash
npm install
npm run build
npm run dev
```

说明：`npm run dev` 会启动 Tauri 开发窗口，开发机器需要安装 Rust/Cargo 和系统 WebView 依赖。最终客户不需要安装 Node.js、Cargo 或 Docker。

## 打包命令

macOS：

```bash
npm run tauri:build:mac
```

Windows：

```bash
npm run tauri:build:windows
```

Windows 和 macOS 不能共用同一个可执行文件，需要分别在对应平台或可用的交叉编译环境中打包。

## U 盘目录建议

```text
AI_WORKSTATION/
├── Windows/
│   └── AI-Agent-Workspace.exe
├── Mac/
│   └── AI Agent Workspace.app
├── 教程/
├── 激活码.txt
└── 技能包/
```

## Hermes 模型供应默认地址

```text
https://ai.f1class.icu/v1
```

App 不保存上游官方 API Key，只保存客户自己的模型供应 Token。该 Token 用于配置 Hermes 的模型供应额度，当前版本本地明文保存到应用数据目录，代码结构预留后续加密存储。
