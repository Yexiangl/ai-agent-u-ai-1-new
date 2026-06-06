# 安装与首次运行说明

AI Agent Workspace 提供两种 Windows 安装方式，按需选择。

## 下载

到 [Releases 页面](https://github.com/Yexiangl/ai-agent-u-ai-1-new/releases/latest) 下载：

- **便携版**：`AI-Agent-Workspace-portable.exe` —— 免安装，双击即用，可放 U 盘。
- **安装版**：`*_x64-setup.exe` —— 标准安装到系统。

## 首次运行会看到蓝色提示，这是正常的

本程序目前**未购买代码签名证书**（早期阶段，先把成本投入到产品本身）。因此首次运行时，
Windows 会弹出蓝色的 **“Windows 已保护你的电脑”** 提示。这**不代表程序有问题**，按以下步骤即可正常运行：

1. 在蓝色弹窗中点击左侧的 **“更多信息”**
2. 出现 **“仍要运行”** 按钮，点击它

之后程序正常启动，以后再打开不会再提示。

> 浏览器下载时若提示“此文件可能有危害”，选择 **“保留”** 即可。

## 验证下载文件完整性（可选，推荐）

每个安装包都附带一个同名的 `.sha256` 校验文件。你可以核对下载的文件没有被篡改或损坏：

PowerShell 中运行（以便携版为例）：

```powershell
Get-FileHash .\AI-Agent-Workspace-portable.exe -Algorithm SHA256
```

把输出的哈希值与 `AI-Agent-Workspace-portable.exe.sha256` 文件里的值对比，一致即说明文件完整可信。

## 杀毒软件误报

个别杀毒软件（尤其是国内安全软件）可能对未签名程序误报。如遇拦截，可将程序加入信任/白名单。
程序为开源构建，源码与构建流程公开于本仓库。
