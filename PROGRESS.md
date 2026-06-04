# PROGRESS — 会话交接

> 给新会话窗口快速了解项目现状用。读完即可上手，不要凭记忆改代码，动手前先读相关文件。

## 项目速览

- **AI Agent Workspace**：Tauri 2 + React 19 + TypeScript + Vite 桌面应用，U 盘便携部署，中文界面。
- **代码根目录**：`/Users/yourenc/Code/Codex/2026-05-20/ai-agent-u-ai-1-new`
  （注意：`/Users/yourenc/Documents/...` 同名目录只有截图，不是代码）
- **GitHub**：`git@github.com:Yexiangl/ai-agent-u-ai-1-new.git`，单人仓库，直接提交并推送 `main`。
- **提交规范**：中文，`feat:/fix:/chore: 简述 (TASK-XXX)`。最新 TASK-071，版本 0.1.4。

## 关键技术约定

- 前端用 `invoke` 调 Rust 命令。`npm run web:dev`（端口 1420）**无后端**，invoke 落空走 localStorage 兜底；持久化只在真实 Tauri app 生效。
- 存储文件（各自独立）：`config.json`（含 `pet` 字段）、`chat-sessions.json`、`usage-log.json`（删会话不影响用量）。
- 验证命令：`cd src-tauri && cargo check`；`npx tsc --noEmit`；`npm run build`。

## 最近完成（已推送 main，工作区干净）

### `b784e5a` 桌宠重构 + 用量统计修复 (TASK-069~070)

- 桌宠形象升级为 **Microsoft Fluent Emoji Flat SVG**（MIT，可商用），10 种动物：
  猫/狗/狐狸/熊猫/兔/仓鼠/企鹅/青蛙/恐龙/独角兽。素材由 `scripts/fetch-pets.sh` 拉取到 `src/assets/pets/`。
- 核心从"养大形象"改为**办公陪伴**：累计 token 驱动**亲密度 + 称号**（10 级，新朋友→命定搭子）。
  去掉成长阶段、换色、配饰。
- 心情改用 emoji 气泡（😊🙂🍙🌧️😴），脸固定不变。
- 办公陪伴特性：久坐提醒、整点报时、专注陪伴（`petCompanion.ts` 定时器）。
- **修复用量统计**：原来用量挂在消息上、删会话就归零；改为独立持久账本 `usage-log.json`
  （后端原子写 + 备份），按 `requestId` 去重累计、只增不减，UsagePage 改读账本，并回填历史用量。
- 旧存档自动迁移（`migratePet`）；清理旧 Lottie 资源，移除 `lottie-react` 依赖。

### `c8514e1` 检查更新 403 修复 (TASK-071)

- 根因：`api.github.com` 匿名限流 60 次/小时/IP，共享/NAT 网络易报 403。
- 改用不限流的 `github.com` 网页端点：`releases/latest`（取版本号）+ `expanded_assets`（解析资产名）。
- 自行解析资产 HTML，不新增 regex 依赖。代价：网页片段无 release notes（前端已做存在性判断，不受影响）。

## 关键文件

- **宠物**：`src/lib/pet.ts`、`petAppearance.ts`、`petCompanion.ts`、
  `src/components/Pet{Avatar,Customizer,Widget}.tsx`、`src/assets/pets/*.svg`
- **用量**：`src/lib/usage.ts`、`src-tauri/src/main.rs`（usage-log 命令）、`src/App.tsx`（UsagePage + 两个 done 回调）
- **更新**：`src-tauri/src/update.rs`

## 验证状态

- **Mac 端**：`cargo check`、`tsc --noEmit`、`npm run build`、浏览器烟测全过
  （宠物迁移、10 动物选择器、切换保存、专注按钮、心情气泡）。
- **Windows 虚拟机端（ARM64 Windows，aarch64-pc-windows-msvc）已实测**：
  - 构建出包成功：NSIS setup.exe + MSI + 便携 exe，启动不弹控制台（WINDOWS_GUI subsystem）。
  - 便携模式路径检测 ✅：`<exe上级>/data/portable.json` 存在且 `data/app` 可写才进便携模式，
    数据落 `data/app/`；否则回退 `%APPDATA%`。两种情况都验证正确。
  - 用量持久化 ✅：文件级实测，删除 chat-sessions.json 后 usage-log.json 不受影响。
  - 检查更新 ✅：curl 实测 releases/latest + expanded_assets 不报 403，返回"已是最新版"。
  - 热替换 bat、服务路径探测（%APPDATA%\npm、.cmd shim、CREATE_NO_WINDOW）逻辑确认。
- **仍缺**：Windows 下宠物 GUI 的真机截图验收（SVG 渲染、气泡、用量页删会话前后数字）
  之前主要是代码/接口验证，未真正点开 app 交互截图。需补。

## 跨平台打包现状（重要）

- 打包走 GitHub Actions（`.github/workflows/release.yml`），push `v*` tag 触发：
  - `windows-latest` 原生出 x86_64 Windows 包（setup.exe + portable.exe）
  - `macos-latest` 原生出 macOS 包，**但只有 x86_64-apple-darwin（Intel）**
  - `ubuntu` 汇总上传。**Mac 不能交叉编译 Windows 包**，各平台原生构建。
- **两个待修的发布缺口**：
  1. CI 的 macOS 只出 Intel 包，作者机器是 Apple Silicon、用户也多为 ARM →
     建议给 release.yml 加 `aarch64-apple-darwin`（+ 可选 arm64 Windows）。
  2. 版本号不一致：`tauri.conf.json` 是 0.1.4，部分 `docs/` 写 v0.3.0，发布以 0.1.4 为准。

## 待办（按优先级）

1. Windows 宠物 GUI 真机截图验收（见上）。
2. CI 补 Apple Silicon（aarch64-apple-darwin）macOS 包。
3. 统一版本号。
4. 可选：检查更新拿不到 release notes，如需保留要单独补带降级的 API 调用。

## 协作 / 环境备注

- 虚拟机代码在 `C:\dev\ai-agent-workspace`，基于 origin/main 建了 `win-test` 分支，
  约定 Windows 端只推 win-test、不碰 main。
- 会话备份在 `~/Desktop/opencode-backup/`：整库快照 `.db` + 本次对话 `.md`（仅归档，勿整篇喂给新窗口）。
