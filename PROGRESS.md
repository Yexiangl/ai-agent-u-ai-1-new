# PROGRESS — 会话交接

> 给新会话窗口快速了解项目现状用。读完即可上手，不要凭记忆改代码，动手前先读相关文件。

## 项目速览

- **AI Agent Workspace**：Tauri 2 + React 19 + TypeScript + Vite 桌面应用，U 盘便携部署，中文界面。
- **代码根目录**：`/Users/yourenc/AIcode/ai-agent-u-ai-1-new`
- **GitHub**：`git@github.com:Yexiangl/ai-agent-u-ai-1-new.git`，单人仓库，直接提交并推送 `main`。
- **提交规范**：中文，`feat:/fix:/chore: 简述 (TASK-XXX)`。最新 TASK-079，**已发布 v0.1.6**；main 上有 TASK-078/079 未发版。

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

### `9475b15` 一键卸载本地服务 (TASK-078) — 已在 main，**未发版**

- 后端 `uninstall_openclaw`（main.rs，install 命令附近）：跑 `npm uninstall -g openclaw`，
  镜像 install 的流式日志（复用 `openclaw-install-log` 事件 + 新增 `openclaw-uninstall-done`）。
  清理残留启动器 shim，但**保留 `~/.openclaw`**（配置/密钥/工作区/技能）。npm 非0退出但启动器已不存在也判成功（幂等）。
- 前端 `openclawInstaller.ts`：新增 `uninstalling`/`uninstalled` 状态、`startUninstall`、`resetInstallState`。
- AI 助手页（EnginesPage）新增「维护」卡片 `OpenClawMaintenanceCard`：仅在已安装时显示，
  卸载前弹确认框（说明保留数据），流式日志展示。**产品决策：只卸程序、保留数据。**

### `d30b004` workspace_root 去重复条件 (TASK-079) — 已在 main，**未发版**

- 两端一致性核查发现 main.rs:157 的 `||` 两边完全相同（笔误），清理。不影响功能。

## 两端一致性核查结论（已做，TASK-079 那轮）

核查 23 处平台分支。核心功能（openclaw 命令/安装/卸载、open_url、dashboard、known_paths、
便携数据探测）**两端对等**。差异分类：
- 已修：workspace_root 重复条件（TASK-079）。
- 无影响：`stopMacos` 脚本检测缺失（前端没用这些字段，死数据）；`hide_command_window` mac no-op（合理）。
- **待用户决策，未改**：①mac 自动更新无热替换（update.rs:284，只 open dmg 手动装，业界标准，建议保持）；
  ②Windows 敏感文件无 0600 等价（main.rs:1841/2496/3880，单用户机风险低）；
  ③which_hermes 在 Win 缺 known-paths 兜底（main.rs:1930，hermes 是否必装待定）。

## 进行中：gateway 服务化改造（解决"要手动点启动 + 黑框常驻"，未写代码）

**用户痛点**：Windows 上要手动点"启动本地服务"才"已连接"，且启动后有命令行窗口常驻，体验拉胯。

**已查清的根因（Mac + Win 实测）**：
- gateway 是后台系统服务（Mac=launchd / Win=schtasks 计划任务「OpenClaw Gateway」，LogonTrigger 登录自启）。
- `openclaw gateway start`=启动服务、`run`=前台运行、`install`=注册自启服务、`stop/status` 齐全。
- 当前 app 代码（`start_openclaw_gateway` main.rs:4062）只做临时 `start`，**从没调 `install`**，
  且一键启用流程（App.tsx:1627-1655 quickSetup、1442 handleStartGateway）只 start 不 install →
  所以不自启、每次要手点。
- **黑框根因**：Win 计划任务 `LogonType=Interactive` + Action 是 `gateway.cmd` 批处理 → 在交互桌面拉起 cmd→node，弹窗口常驻。
- **`Hidden=true` 解决不了**（那只控制任务在管理器里是否列出，与程序窗口无关）。
- **S4U 方案被否**：`Set-ScheduledTask -LogonType S4U` 需管理员，非管理员报 0x80070005 拒绝访问。

**确定可行方案（虚拟机实测验证）**：`openclaw gateway install --wrapper <VBS>`
- 用 VBS 包装器（`WshShell.Run cmd, 0, False` → 隐藏窗口启动 node），实测：node 无窗口、
  health 通、`openclaw gateway status/stop/start` **完全兼容无警告**、不需管理员。
- 次选（有配置警告，不推荐）：直接改 gateway.cmd 用 `powershell -WindowStyle Hidden`。

**改造前还差最后一轮调研（提示词已发给虚拟机，待回执）**：
1. `--wrapper` 生成的 `gateway.cmd` 确切内容 + 任务 Action 的 Execute/Arguments。
2. **关键：node.exe 和 openclaw dist/index.js 路径不能写死**（换机/换用户/便携模式会变），
   需确认如何动态解析（`openclaw gateway status` 的 `Command:` 行含这两个路径，或让 openclaw 自己用 --wrapper 填路径）。
3. 登录自启是否仍闪一下 cmd 窗口（VBS 隐藏的是 node 层，cmd 层可能仍闪）。
4. `install --force` 是否幂等（app 会反复调）。

**改造计划（拿到调研后实施）**：
- 新增/改造：app「一键启用」流程从「存配置→start」改为「存配置→生成通用 VBS（不含写死路径）→
  `openclaw gateway install --force --port 18789 --token <token> --wrapper <vbs>`→start」。
- app 启动时自动检测：已配置但 gateway 没连上 → 自动拉起，去掉"手动点启动"。
- token 来源见 `load_openclaw_gateway_token`（main.rs:2510）。
- 兜底 plan B：若 VBS 仍闪窗，用 openclaw `install --wrapper` 指定隐藏启动器的其他形态。

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

1. **gateway 服务化改造**（进行中，见上「进行中」章节）：解决 Windows 手动点启动 + 黑框常驻。
   等虚拟机最后一轮调研回执（gateway.cmd 内容 / 路径动态解析 / 闪窗 / 幂等）后写代码。
2. **发 v0.1.7**：把 TASK-078（一键卸载）+ TASK-079 发出去；若 gateway 改造完成则一并发。
   发版流程：升版本号（tauri.conf.json/Cargo.toml/Cargo.lock/package.json + 前端 App.tsx 2 处、
   openclawGateway.ts 2 处）→ commit → 打 tag `v0.1.7` → push tag 触发 CI → gh 确认 Release。
3. 卸载功能真机验收（需 v0.1.7 包）：维护卡片仅已装时显示、确认框文案、卸载后 ~/.openclaw 保留、重装恢复、无黑框。
4. 可选：v0.1.6 端到端"检查更新→便携 exe 热替换"完整 UI 流程真机验证。
5. 待用户决策的两端一致性问题（见上一致性核查章节，默认不动）。
6. CI 多架构补全（Intel Mac / ARM Windows），按需。
7. 可选：前端版本号改为动态读取 Tauri 版本，避免每次发版手改硬编码。

## 协作 / 环境备注

- 虚拟机代码在 `C:\dev\ai-agent-workspace`，基于 origin/main 建了 `win-test` 分支，
  约定 Windows 端只推 win-test、不碰 main。
- 会话备份在 `~/Desktop/opencode-backup/`：整库快照 `.db` + 本次对话 `.md`（仅归档，勿整篇喂给新窗口）。
