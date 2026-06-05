# PROGRESS — 会话交接

> 给新会话窗口快速了解项目现状用。读完即可上手，不要凭记忆改代码，动手前先读相关文件。

## 项目速览

- **AI Agent Workspace**：Tauri 2 + React 19 + TypeScript + Vite 桌面应用，U 盘便携部署，中文界面。
- **代码根目录**：`/Users/yourenc/AIcode/ai-agent-u-ai-1-new`
- **GitHub**：`git@github.com:Yexiangl/ai-agent-u-ai-1-new.git`，单人仓库，直接提交并推送 `main`。
- **提交规范**：中文，`feat:/fix:/chore: 简述 (TASK-XXX)`。最新 TASK-077，**已发布 v0.1.6**。

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

### `ae6b53f` Windows 黑框 + onPath + AI助手文案 (TASK-072)

- **能力中心弹黑框**：`openclaw_command()`（main.rs）工厂函数统一加 `hide_command_window`，
  一处覆盖 18 个调用点；另修便携 node/openclaw 版本探测、`open_url` 的 `cmd start`。
- **onPath 误报**：`check_openclaw_installed` 在 Windows 改用 `cmd /c where openclaw`
  （`Command::new("openclaw")` 找不到 `.cmd` shim，导致已装却报 onPath:false、装完被误判需重启）。
- **AI助手文案**：未配置时从"未找到本地配置文件"改为"填写密钥一键启用"，不再误导为未安装。

### `933bf0f` 版本升级 v0.1.5 (TASK-073)

- tauri.conf.json / Cargo.toml / Cargo.lock / package.json → 0.1.5。
- 修正前端硬编码：侧边栏 v0.1.1、关于页 v0.3.0、网关 client 0.1.1 → 全部 0.1.5。
- 打 tag `v0.1.5` 触发 CI，**已发布 Release**（三资产：portable.exe / x64-setup.exe / aarch64.dmg）。

### `1ac1081` v0.1.6 三项修复 + 发版 (TASK-074~077)

- **TASK-074 用量统计**：OpenClaw/Hermes 流式请求体补 `stream_options.include_usage`
  （main.rs:1054/2654）。原来流式响应不返回 usage → rawUsage=null → 前端 recordTurnUsage
  因 total<=0 提前 return → 用量永不入账。**真机验证**：用量页显示真实 token、删会话不归零。
- **TASK-075 中文路径升级**：`_update.bat` 第二行加 `chcp 65001`（update.rs）。原来 bat 以 UTF-8
  写盘但 cmd 用 GBK 解析，中文路径变乱码("找不到文件 娴爾")。**真机验证** C:\我的软件\app 升级正常。
- **TASK-076 BOM 容错**：新增 `strip_bom`/`read_json_file`，所有【文件读取】的 JSON 解析去 BOM
  （openclaw.json 由 CLI 写、用户记事本另存可能带 BOM）。网络/CLI stdout 解析不变。
- **TASK-077**：版本号 → 0.1.6，前端硬编码同步。打 tag `v0.1.6` 已发布 Release。

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
  - 检查更新 ✅：curl 实测 releases/latest + expanded_assets 不报 403。
  - 热替换 bat、服务路径探测（%APPDATA%\npm、.cmd shim、CREATE_NO_WINDOW）逻辑确认。
  - TASK-072 修复后复测 ✅：黑框消失、onPath:false→true、配置写入+`openclaw config validate`（exit 0）、
    AI助手文案已更新。"一键启用"按钮 disabled 是 CDP 假象（直接设 value 不触发 React onChange），非 bug。
- **仍缺**：v0.1.5 安装包级的真机回归（之前多在 win-test 本地构建/CDP 验证），
  尤其检查更新→便携 exe 热替换的完整真机流程、宠物 GUI 截图。

## 跨平台打包现状（重要，已据 v0.1.5 实际发布修正）

- 打包走 GitHub Actions（`.github/workflows/release.yml`），push `v*` tag 触发，各平台原生构建：
  - `windows-latest` → x86_64 Windows 包（`x64-setup.exe` + `portable.exe`）
  - `macos-latest` → macOS 包。**实测产物是 `aarch64`（Apple Silicon）**：workflow 里虽写
    `x86_64-apple-darwin`，但 `npm run tauri:build` 忽略该 target、按 runner 自身架构出包，
    而 GitHub macos-latest 现为 M 系列 → 实际只出 ARM 包。
  - `ubuntu` 汇总发 Release。**Mac 不能交叉编译 Windows 包**。
- **当前发布的架构覆盖缺口**：
  - macOS：只有 aarch64（ARM），**没有 Intel 包** → Intel Mac 用户装不了。
  - Windows：只有 x86_64，没有 arm64（ARM Windows 上靠兼容层跑 x64）。
  - 如要全覆盖，需在 release.yml 显式加 target 矩阵（aarch64-apple-darwin + x86_64-apple-darwin
    分别出包，Windows 同理）。当前若用户都是新机器（ARM Mac / x64 Win）则够用。

## 待办（按优先级）

1. ✅ 已完成：v0.1.6 Windows 真机回归（用量端到端、中文路径升级、BOM）均通过并发版。
2. 可选：v0.1.5→v0.1.6 端到端"检查更新→便携 exe 热替换"完整 UI 流程仍未在真机跑过
   （此前 v0.1.4 有 403 无法触发；v0.1.5 起检查更新已修，可从 v0.1.5 升 v0.1.6 实测一次）。
3. CI 多架构补全（Intel Mac / ARM Windows），按需。
4. 可选：检查更新拿不到 release notes，如需保留要单独补带降级的 API 调用。
5. 可选：前端版本号改为动态读取 Tauri 版本，避免每次发版手改硬编码。

## 协作 / 环境备注

- 虚拟机代码在 `C:\dev\ai-agent-workspace`，基于 origin/main 建了 `win-test` 分支，
  约定 Windows 端只推 win-test、不碰 main。
- 会话备份在 `~/Desktop/opencode-backup/`：整库快照 `.db` + 本次对话 `.md`（仅归档，勿整篇喂给新窗口）。
