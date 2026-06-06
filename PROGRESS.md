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

### `df5b66c` gateway 服务化改造 (TASK-080) — 已在 main，**未发版**

- 解决 Windows「要手动点启动 + 黑框常驻」。新增 `install_gateway_service`（main.rs）：
  Win 动态解析 node.exe（`where node`）+ openclaw dist/index.js（解析 `gateway status` 的 CLI 路径，
  兜底 `%APPDATA%\npm\...\dist\index.js`）→ 生成隐藏窗口 VBS（`WshShell.Run cmd,0,False`）→
  `gateway install --force --port 18789 --wrapper <vbs>` → start；Mac/Linux 无 VBS 直接 install→start。幂等。
- 前端：`handleStartGateway` + quickSetup 改调 `install_gateway_service`；
  新增启动自检 `useEffect`（configExists && tokenPresent && !ready → 自动拉起，去掉手动点）。
- **真机验收（虚拟机）**：路径动态解析正确、health 通、无 cmd/wscript 残留、幂等、自动拉起均 ✅。
  **唯一未验**：登录自启瞬间是否闪 cmd 窗口（RDP 看不了，需物理桌面注销/登录肉眼确认）。

### `05eb4a7` 便携升级中文路径乱码根治 (TASK-081) — 已在 main，**未发版**

- 症状：中文路径升级报 `C:\Usersyourenc\...娴孀疾?exe`（吞反斜杠 + 乱码）。
- 根因：`_update.bat` UTF-8 写盘但 cmd 用 GBK 解析，中文 UTF-8 字节被当 GBK 双字节吞掉紧跟的
  ASCII（`\`=0x5C、`.`=0x2E 是合法 GBK 尾字节）；TASK-075 的 `chcp` 因脚本 DETACHED 无控制台而失效。
- 修法：便携热替换脚本 `_update.bat`(cmd/GBK) → `_update.ps1`(PowerShell + UTF-8 BOM)，
  `Move-Item -LiteralPath '...'` 单引号字面量。彻底根治，**取代 TASK-075 的 chcp 方案**。
- **真机验收（虚拟机）**：中文目录 + 含空格 exe 名升级成功、无乱码、无 .ps1/.bak/_new.exe 残留、新进程拉起 ✅。
  窗口理论无（`-WindowStyle Hidden` + `CREATE_NO_WINDOW + DETACHED_PROCESS` 双保险）。

### `cd0f303` openclaw 命令黑框根治 (TASK-082) — 已在 main，**未发版**

- 症状：点"能力中心"（以及任何 openclaw CLI 调用）弹一下黑框又关。
- 根因（虚拟机 procmon + MSDN 证实）：`cmd /c openclaw.cmd` 链路里 cmd 无 console（已 CREATE_NO_WINDOW），
  但 cmd 内部 spawn `node.exe`(console 子系统)不带 flag → Windows 给 node **新分配可见控制台**。
  `CREATE_NO_WINDOW` 不传递子/孙进程、且被子进程 CREATE_NEW_CONSOLE 覆盖，所以拦不住。与 gateway 黑框同源。
- 修法：`openclaw_command()`(main.rs:119) Windows 分支改为**直接跑 `node.exe openclaw.mjs`**（从 .cmd
  同级 `node_modules/openclaw/openclaw.mjs` 解析；node 优先用 shim 旁 bundled，否则 `where node`），
  node 自身加 CREATE_NO_WINDOW → 无控制台。跳过 cmd 中间层。解析失败回退原 `cmd /c`。
  新增 `resolve_openclaw_node_invocation()`。**一处改根治全部 ~18 个 openclaw 调用点。**
- 验证：`cargo check` ✅；Windows-only 函数体用独立 stub 单独类型校验 ✅。
- **真机验收（虚拟机 + 用户物理桌面）通过**：①点能力中心**实测无黑框**（用户物理桌面确认）；
  ②回归——skills list / --version / gateway status / plugins list 新旧方式输出 SHA256 全匹配，
  功能无损；③边界——.mjs 不存在时正确回退 `cmd /c`。
   注：clawhub 在线市场走纯 HTTP（main.rs:3308），不经 openclaw CLI，不受本改影响。

## v0.1.7 已发布（`gh release v0.1.7`，含 078/079/080/081/082）

CI 三 job 全绿，Win 便携版 + Win 安装版 + Mac(arm64)dmg 已出。中文 release notes 已填。
遗留：CI 矩阵写 x64 但 macos-latest 实出 aarch64（Mac 双架构待修）；Node20 action 弃用警告（待升级 action 版本）。

### `c557039` Windows 体验优化 P1-P5 (TASK-083) — 已在 main，**未发版（>0.1.7）**

- P1 启动卡顿根治：`check_hermes_installed`/`get_hermes_paths`/`read_installed_capabilities`
  改 `spawn_blocking`（原同步阻塞，启动/进能力中心冻 UI 数秒）。
- P2 前端 `detect()` 三连串行 → `Promise.all`。
- P3 深色模式持久化：AppConfig 加 `dark` 字段，`toggleDark` 持久化，启动恢复。
- P4 窗口大小/位置持久化：引入 `tauri-plugin-window-state`（注册即生效，状态存 AppData，
  便携换机不跟随属可接受）。
- P5 中文字体栈：body 声明跨平台中文字体（Win 微软雅黑 / Mac 苹方优先）。
- **真机验收（虚拟机自构建 arm64 + 用户物理桌面）**：冷启动实测 ~1.05s 无卡顿、能力中心异步不冻、
  深色/窗口记忆、功能回归全过。注：虚拟机出的是 arm64 包（仅验逻辑），x64 实包等发版 CI 出。

### `2a3b7ef` Windows 稳定性硬化 P6-P9 (TASK-084) — 已在 main，**未发版**

- P6 `write_config` 原子写（tmp+rename）+ `.bak` 备份；`read_config` 主文件损坏回退 .bak。
  （原裸 `fs::write`，是唯一没做原子写的，sessions/usage 早有）。
- P7 `install_gateway_service` 的 `gateway start` 改用 **gateway 专属 `/health` 端点探测**
  （`c61f93a` 修正：初版用裸 TCP 端口探测，虚拟机 P7-2 发现端口被别的程序占用时会假阳性误报成功；
  改用 `GET /health` 检查 `{"status":"live"}`/`{"ok":true}` 标记，别的程序占端口答不出 → 真区分。
  `reqwest::blocking`，重试 6 次最坏 ~15s）。不再静默吞错；**保留幂等**（已运行仍 live=成功）。
- P8 `.env` 读失败返回错误而非 `unwrap_or_default()` 静默清空（避免覆盖写丢用户其它 env 变量）。
- P9 `resolve_node_exe`/`resolve_openclaw_dist_js` 加 `OnceLock` 缓存（减少 `where node` /
  `gateway status` 重复冷启动）。
- 验证：cargo check ✅、tsc ✅、build ✅、Windows-only 缓存逻辑独立 stub 校验 ✅。
- **真机验收（虚拟机）**：P6-2 改坏 config 能从 .bak 恢复 ✅、P6 原子写无残留 tmp ✅、
  P7-1 已运行重复点仍幂等成功 ✅、P8 .env 保护逻辑正确 ✅、P9 缓存功能正常 ✅；
  P7-2 端口占用——虚拟机发现裸 TCP 假阳性，已改 /health 端点修正（`c61f93a`）。
  **P7 /health 修正复验通过（虚拟机）**：TcpListener 占端口（不应答 /health）→ 正确报失败；
  gateway 占端口（返回 {"ok":true,"status":"live"}）→ 成功；幂等重复启动仍 live。假阳性根治。
  TASK-084 (P6-P9) + 084b 全部验收通过。

## 两端一致性核查结论（已做，TASK-079 那轮）

核查 23 处平台分支。核心功能（openclaw 命令/安装/卸载、open_url、dashboard、known_paths、
便携数据探测）**两端对等**。差异分类：
- 已修：workspace_root 重复条件（TASK-079）。
- 无影响：`stopMacos` 脚本检测缺失（前端没用这些字段，死数据）；`hide_command_window` mac no-op（合理）。
- **待用户决策，未改**：①mac 自动更新无热替换（update.rs:284，只 open dmg 手动装，业界标准，建议保持）；
  ②Windows 敏感文件无 0600 等价（main.rs:1841/2496/3880，单用户机风险低）；
  ③which_hermes 在 Win 缺 known-paths 兜底（main.rs:1930，hermes 是否必装待定）。

## 唯一悬而未决：gateway 登录自启闪窗（TASK-080 收尾项）

代码与功能已验收通过（见上 `df5b66c` TASK-080）。**唯一没验的**是 Windows 登录瞬间是否闪一下 cmd 窗口：
- 链路 `计划任务 → gateway.cmd(批处理) → wrapper.vbs → node(隐藏)`。VBS 只隐藏 node 层；
  Task Scheduler 在交互会话跑 `.cmd` 时由 `cmd.exe`(console 子系统)解释 → **登录瞬间可能闪一下控制台**（<0.5s）。
- 进程快照抓不到（一闪即退），**必须真机物理桌面（非 RDP）注销→重新登录肉眼观察**。
- **若确认明显闪窗的兜底方案**（未实施，待确认后再动）：install 后用 PowerShell 把任务 Action 从
  `gateway.cmd` 改为 `wscript.exe //B //Nologo <wrapper.vbs>`，并把 gateway.cmd 里那 8 个 `OPENCLAW_*`
  环境变量塞进任务环境或写进 VBS，彻底跳过 cmd 层。代价：篡改 openclaw 管理的任务，跨版本可能脆。
- token 来源见 `load_openclaw_gateway_token`（main.rs:2510）。


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

1. **gateway 登录自启闪窗确认**（TASK-080 唯一收尾项，见上「唯一悬而未决」章节）：
   需物理桌面（非 RDP）注销→重新登录肉眼看登录瞬间是否闪 cmd 窗。其余功能已验收通过。
2. **发 v0.1.7**：把 TASK-078（一键卸载）+ TASK-079 + TASK-080（gateway 服务化）+ TASK-081（中文路径升级）+ TASK-082（命令黑框根治）一并发。
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
