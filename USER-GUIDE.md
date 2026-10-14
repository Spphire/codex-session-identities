# Codex 会话身份面板（Windows）

面板管理本机 Codex 桌面会话的模型身份。支持原有官方登录、已登记的 API 身份及独立官方账号档案。原有会话 ID、历史和工作目录继续使用。

## 安装

1. 解压安装包，右键 PowerShell 运行 `Install.ps1`。默认安装到当前用户的 `Documents\Codex\Applications\CodexSessionIdentity`，无需另装 Node 或 Python。此目录避免 MSIX 应用对 AppData 的文件系统虚拟化导致桌面启动时找不到文件。
2. 首次关闭 Codex，然后使用桌面的 `Codex - Session Identities` 快捷方式启动。此后使用这个快捷方式加载补丁后端。
3. 主程序会自动启动面板服务和系统托盘。点击右下角的 **Codex 会话身份** 图标，或右键选择 **打开身份面板**。若未直接显示，可在托盘的 `^` 隐藏图标中查找。访问授权自动处理，不需要输入密钥。

桌面启动快捷方式指向 `codex-session-desktop.exe --restart`。Codex 已运行时，无论是否已加载补丁，都会显示置顶重启确认；选“是”后关闭旧桌面进程及其身份桥接和后端，并确认新后端 PID 已改变。其他辅助子进程不阻塞重启，也不会被启动器终止。选“否”保留当前窗口。没有运行时正常启动。重复点击不会同时执行多个重启。原生启动器保留 `desktop-launcher.log`、`desktop-launcher-output.log` 和 `launcher-status.json`；`ready` 表示补丁后端实际连接成功。

启动主程序不会自动弹出面板网页。托盘是单实例；“退出托盘”只关闭托盘入口，不退出 Codex。`Codex Identity Panel` 快捷方式仍保留为直接打开入口。安装更新会先让已有托盘正常退出。

如果自动定位失败，可指定 `-CodexExe`（原版 CLI）、`-DesktopExe`（桌面 `ChatGPT.exe`）和 `-CodexHome`。不要把桌面入口 `Codex.exe` 当作 CLI。

安装程序复用已有 `identity-switcher/state.json` 及 Windows 凭据管理器。当前官方登录只登记账号引用，不复制 refresh token。其他官方档案由独立凭据目录管理；不要同时用旧全局切换器改写已导入账号的登录。

## 使用

### 身份去重与移除

同一账号的本体登录和独立档案按匹配的 account ID 与 user ID 合并展示，并注明来源和档案数。邮箱相同但账号或用户不同不会合并。合并不删除档案、不迁移会话绑定，也不改写登录凭据。本体换号后，旧固定身份显示“登录不匹配或已失效”，不能继续选择；不会用新账号邮箱替换旧身份。

在“已登记身份”列表右侧点击减号移除身份，需要确认。有会话绑定（含归档或孤立绑定）、排队请求或已观测运行时引用时会拒绝移除；请先切换相关会话。此操作只从面板和切换列表移除，不注销账号、不删除 Windows 凭据或官方登录文件，也不影响原有历史。移除配置保存在 `<CODEX_HOME>\session-identities\panel-identities.json`。需恢复时关闭面板服务，从该文件 `removedIds` 中移去相应条目后重新打开；不要修改会话绑定文件。

### Fast 与本体登录

桌面版的 Fast 入口读取本体账号，而不是当前 session 的身份绑定。需要使用 Fast 时，本体须真实登录官方账号，且全局默认 `model_provider` 为 `openai`。全局 `openai_base_url` 不应指向中转站；中转站地址保存在各自的 provider 定义和身份 profile 中。

本体登录可使用原版 CLI 的 `codex login --device-auth`。修改本体登录或全局默认 provider 后重启一次主程序，随后通过面板继续为不同 session 选择身份。新会话默认使用官方 provider；需要中转站的会话应明确绑定对应 API 身份。选择 Fast 仍取决于模型支持和账号权限；此配置不保证中转站支持 Fast。

实测已验证官方 Fast、切到 API 的标准请求、再切回官方 Fast。测试在独立目录运行，只向临时后端提供短期 access token，没有复制 refresh token。桌面模型菜单的账号能力仍属于主机级，这次修复未将其改为逐 session 的权限判断。公开验证摘要见源码仓库 `VALIDATION.md`。

- 选中会话后查看身份，再选择目标身份并切换。
- 已加载且空闲的会话重建自己的运行时，整个 Codex 不重启。
- 会话仍在生成、后台终端运行或子任务仍占用运行时时，请求会等待，可以取消尚未执行的请求。以“已生效”为准，再开始需要新身份的工作。
- 未加载的会话只保存绑定，显示“打开会话后生效”；不会因为修改身份而自动启动该会话。
- 身份切换保留当前模型。目标服务是否支持该模型、是否有额度，仍取决于服务端。

面板只监听 `127.0.0.1`，查询和操作均需要保存在当前用户配置目录中的面板访问令牌。令牌通过专用启动器交给浏览器会话，API Key 不进入网页。

切换会重建该会话的工具连接。文件和对话历史保留；工具的临时内存状态可能需要重新初始化。

## 新机器的身份登记

安装器会登记原版 CLI 当前已登录的官方账号。先用原版 CLI 完成官方登录，再运行安装器。已有 `identity-switcher` 的 API 身份和官方档案可自动导入；本版本面板只选择已登记身份，没有新增账号或 API Key 的网页表单。

第二个官方账号需使用独立 `CODEX_HOME` 完成真实登录，不要复制其他机器的 refresh token。下面命令在安装目录运行，并把 `<原版 CLI 路径>` 替换为 `runtime-config.json` 中的 `originalCodexExe`：

```powershell
$homeDirectory=Join-Path $env:USERPROFILE '.codex'
$previousHome=$env:CODEX_HOME
try {
    $env:CODEX_HOME=Join-Path $homeDirectory 'session-identities\profiles\chatgpt_second_official'
    New-Item -ItemType Directory -Path $env:CODEX_HOME -Force | Out-Null
    & '<原版 CLI 路径>' login --device-auth
    if ($LASTEXITCODE -ne 0) { throw 'Login failed' }
} finally { $env:CODEX_HOME=$previousHome }
.\node.exe .\register-second-official.mjs $homeDirectory
```

该脚本只登记固定的第二账号档案，要求与本体账号不同，并拒绝覆盖已有 profile。更多账号及首次 API 凭据登记目前需按 `import-profiles.mjs` 和 provider/profile 格式配置，尚无通用一键新增流程。不要把账号凭据或 profile 上传到 GitHub。

## 停用与更新

关闭 Codex 后运行安装目录中的 `Disable.ps1`。它先为可兼容的 API/当前官方身份准备原版 provider 定义，再启动原版程序，不删除历史。独立官方档案须先在面板重新绑定到当前系统登录或 API 身份。停用后官方会话恢复原版的全局登录行为。

更新安装包前关闭使用该安装目录的 Codex，再运行新版 `Install.ps1`。首次加载和代码更新需要重新启动后端；普通身份切换不需要。

## 源码补丁

补丁位于 `patches/`，基于 OpenAI Codex 提交 `0c7362d121d1c7f69540262425fd4e2209fd8e8d`。应用前运行：

```powershell
.\patches\apply.ps1 -Repository <Codex源码目录> -CheckOnly
```

去掉 `-CheckOnly` 后应用。不同上游版本会被拒绝，应在独立检出中重放、编译并运行源码包的测试后更新 manifest，不能仅凭补丁应用成功判断兼容。

已实测：Windows Desktop `26.1007.2314.0`、原 CLI `0.162.0-alpha.17.2`。其他版本需重新验证。

源码默认编译版本为 `0.0.0`，官方接口会据此限制可用模型。桥接程序启动时读取已安装原版 CLI 的版本，通过 `CODEX_IDENTITY_CLIENT_VERSION` 传给后端，统一官方请求的 `version` 标头与模型目录的 `client_version`。这只是版本兼容，不改变账号权限，也不把 Sol 模型映射成其他模型。升级原版后仍需验证补丁与新版本的协议兼容性。

2026-10-14 实测：两个不同官方账号分别成功调用 `gpt-6.1-sol`、`gpt-6-sol`，均使用 Fast；切到 API 后成功调用 `gpt-6-sol`，再切回官方成功调用 `gpt-6.1-sol` Fast。全局登录文件未变。验证范围和未覆盖项目见源码仓库 `VALIDATION.md`；含个人身份和会话元数据的原始报告不随公开发布包分发。

Windows 后端还需要同目录下的 `codex-code-mode-host.exe`、`codex-command-runner.exe`、`codex-windows-sandbox-setup.exe`。安装器从目标机器原版 CLI 目录复制这些文件；启动器补齐缺失文件，桥接程序启动后端前按哈希同步原版配套文件。手动只替换后端 EXE 不能代替完整部署。远端已验证实际命令执行及 Code Mode 宿主进程。

托盘和面板快捷方式使用独立的 Edge 面板窗口（无 Edge 时使用 Chrome）。重复点击恢复并激活已有窗口；关闭后才重新打开。该窗口使用当前 Codex 配置目录下的专用浏览器配置，不修改日常浏览器标签页。旧版本在普通浏览器中打开的标签页可手动关闭。
