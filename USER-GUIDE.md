# Codex 会话身份面板（Windows）

0.1.9 后台终端阻塞确认：选择会话并请求切换身份后，如后端确认仅被该会话自己的后台终端阻塞，面板会弹出确认窗口，列出终端编号、可用的系统 PID / CPU 信息及关闭影响。点击“继续等待，不关闭任务”不会终止进程；也可用“取消等待”撤销切换。点击“关闭列出的终端并继续切换”只关闭确认时列出的所选会话终端，然后重新检查身份切换，不关闭分叉或其他聊天。

确认两分钟内有效且只能使用一次。切换目标、后端进程或终端清单变化后必须重新确认。SSH 终端关闭不保证已分离的远端任务终止。命令可能包含凭据，因此确认窗口不展示完整命令。面板更新不自动重启 Codex；旧桥接必须正常重启后才能使用新接口，再次点击身份启动快捷方式会检测并提示重启，用户拒绝则保留当前任务。

面板管理本机 Codex 桌面会话的模型身份。支持原有官方登录、已登记的 API 身份及独立官方账号档案。原有会话 ID、历史和工作目录继续使用。

## 安装

1. 解压安装包，右键 PowerShell 运行 `Install.ps1`。默认安装到当前用户的 `Documents\Codex\Applications\CodexSessionIdentity`，无需另装 Node 或 Python。此目录避免 MSIX 应用对 AppData 的文件系统虚拟化导致桌面启动时找不到文件。
2. 首次关闭 Codex，然后使用桌面的 `Codex - Session Identities` 快捷方式启动。此后使用这个快捷方式加载补丁后端。
3. 主程序会自动启动面板服务和系统托盘。点击右下角的 **Codex 会话身份** 图标，或右键选择 **打开身份面板**。若未直接显示，可在托盘的 `^` 隐藏图标中查找。访问授权自动处理，不需要输入密钥。

桌面默认快捷方式指向 `codex-session-desktop.exe --admin --restart`，通过 UAC 请求管理员权限。Codex 已运行时，无论是否已加载补丁，都会显示置顶重启确认；选“是”后关闭旧桌面进程及其身份桥接和后端，并确认新后端 PID 已改变。其他辅助子进程不阻塞重启，也不会被启动器终止。选“否”保留当前窗口。没有运行时正常启动。重复点击不会同时执行多个重启。原生启动器保留 `desktop-launcher.log`、`desktop-launcher-output.log` 和 `launcher-status.json`；`ready` 表示补丁后端实际连接成功。

启动主程序不会自动弹出面板网页。托盘是单实例；“退出托盘”只关闭托盘入口，不退出 Codex。`Codex Identity Panel` 快捷方式仍保留为直接打开入口。安装更新会先让已有托盘正常退出。

如果自动定位失败，可指定 `-CodexExe`（原版 CLI）、`-DesktopExe`（桌面 `ChatGPT.exe`）和 `-CodexHome`。不要把桌面入口 `Codex.exe` 当作 CLI。

安装程序复用已有 `identity-switcher/state.json` 及 Windows 凭据管理器。当前官方登录只登记账号引用，不复制 refresh token。其他官方档案由独立凭据目录管理；不要同时用旧全局切换器改写已导入账号的登录。

### 管理员模式

默认入口 `Codex - Session Identities` 会请求管理员权限；`Codex - Session Identities (Standard)` 保留普通权限启动，`Codex Identity Panel` 打开身份面板。旧版重复的 `Administrator` 快捷方式会在更新快捷方式时备份并移除；修改过目标或参数的快捷方式会保留。各入口使用相同的账号档案和 `CODEX_HOME`。请在 UAC 中选择“是”；取消后不会关闭现有 Codex。不要改用另一个 Windows 账号授权，否则无法沿用原用户的凭据保险库。

已有 Codex 运行时，管理员入口仍会先询问是否重启。新启动器检查实际 app-server 的管理员令牌；不能用一个普通权限的旧后端冒充管理员模式。`launcher-status.json` 中的 `administratorRequested`、`launcherElevated` 和 `backendElevated` 可用于诊断。命令行等价入口为 `codex-session-desktop.exe --admin --restart`，`--admin --check` 只进行提权及预检，不关闭当前窗口。

管理员权限与 Codex 的工具授权、沙箱和组织策略是不同层面的设置。管理员入口只负责 Windows 提权；面板中的 YOLO 开关负责下述命令审批和沙箱选择。它们不保证所有桌面应用都可被操控，也不能绕过 UAC 安全桌面、受保护进程或其他用户会话。选择当前用户有管理员权限的 Windows 账号，且仍需在原生应用中启用可用的电脑操作能力。

### YOLO 执行权限

面板右侧顶部提供全局 YOLO 开关，默认开启。开启使用 `danger-full-access` 和 `approval_policy = "never"`，允许当前 Windows 用户权限内的文件、网络与命令操作，不弹出命令审批。关闭使用 `workspace-write` 和 `on-request`，限制工作区外写入、默认禁止命令网络访问并恢复按需审批。

设置作用于加载本补丁的本机桌面后端上的所有会话和侧边聊天，独立于官方/API 身份。开关不需要每次重启，从下一轮回复或下一条独立执行请求生效；正在运行的回复与已启动命令继续使用原权限，关闭开关不撤销它们。原版对已加载会话的 resume 不一定应用权限覆盖，因此核验应以新一轮后的后端设置为准。

偏好保存在 `<CODEX_HOME>\session-identities\execution-policy.sqlite`，重启面板和 Codex 后保留。面板通过版本检查拒绝旧页面覆盖新设置。桥接层在创建、恢复、分支、修改设置和开始新一轮时统一传入所选权限；原生聊天里的权限选择不能覆盖这个全局开关。模型、身份、输入内容等其他字段保留。

首次安装这项更新后，需要通过桌面快捷方式重启一次 Codex 来加载新桥接代码。面板在未连接新版控制时显示“已保存；重启 Codex 后启用权限控制”，不会报告已生效。后续切换无需重启。此开关不修改原版全局 `config.toml`，也不影响直接使用原版 CLI 的权限设置；当前本机原有全局配置已经是完整访问和 `never`。

Windows 管理员令牌仍由启动方式决定，YOLO 开关不会自动弹 UAC，也不会在关闭时撤销进程的管理员令牌。原生后端仍校验组织限制；工具、插件、应用授权与必要的安全确认继续由各自系统处理。该开关不是“无限制操作电脑”的承诺。

### 应用快照

继续使用原版输入框下方的加号菜单中的应用快照入口，或已配置的原生快捷键。官方默认在 Windows 上使用左右两个 Alt 键。截图采集、窗口文字读取和截图权限由已安装的原版桌面程序处理；身份面板不代替采集器，也不强制打开组织禁用或账号尚不可用的功能。

桥接层保留图片和文本输入。已用真实补丁后端和桥接层验证内联图片、本地截图文件，以及切换身份、重新恢复聊天后历史图片和文字仍出现在模型请求中。测试使用本地模拟模型服务与合成图片，没有截图真实应用，也未上传真实窗口内容。这不等同于实际点击原生加号菜单的端到端验证。

若入口不可用，检查原版桌面版本、账号功能开放情况和组织的 `allowAppshots` 策略；若入口存在但截图失败，检查原生采集器错误。管理员启动不会替代截图功能的账号和组织条件。官方说明：<https://developers.openai.com/codex/appshots>。

## 使用

### 切换等待原因

切换身份等待时，右侧详情显示目标会话自身的回复、后台命令、运行中的子智能体或准备期间重新变忙等原因。普通分叉会话独立运行，不阻塞主会话切换，也不会随主会话改变身份。旧版后端仍可能报告分叉阻塞；需正常重启加载修复。等待会自动重试，也可取消，不会自动终止后台命令。

暂停 `/goal` 只暂停目标继续执行，不会停止已经启动的后台终端。只读监视脚本也可能继续运行并阻塞身份切换；请先在原会话检查后台终端，确认用途后再决定是否结束。界面只显示命令数量，不展示命令参数、输出或凭据。

详细原因需要加载含 `0006-identity-switch-blockers.patch` 的后端。旧后端仍能切换，但等待时明确显示“后端报告忙碌，但未提供具体原因”，不会猜测成目标暂停或登录失效。更新后端后重启一次即可；不需要为了显示等待提示更改身份凭据。

### 身份去重与移除

同一账号的本体登录和独立档案按匹配的 account ID 与 user ID 合并展示，并注明来源和档案数。邮箱相同但账号或用户不同不会合并。合并不删除档案、不迁移会话绑定，也不改写登录凭据。本体换号后，旧固定身份显示“登录不匹配或已失效”，不能继续选择；不会用新账号邮箱替换旧身份。

在“已登记身份”列表右侧点击减号移除身份，需要确认。有会话绑定（含归档或孤立绑定）、排队请求或已观测运行时引用时会拒绝移除；请先切换相关会话。此操作只从面板和切换列表移除，不注销账号、不删除 Windows 凭据或官方登录文件，也不影响原有历史。移除配置保存在 `<CODEX_HOME>\session-identities\panel-identities.json`。需恢复时关闭面板服务，从该文件 `removedIds` 中移去相应条目后重新打开；不要修改会话绑定文件。

### 官方账号额度与 Credits

右侧“已登记身份”中的官方账号显示剩余周期额度、重置时间和官方接口返回的 Credits 余额。周期名称根据返回时长显示（例如 5 小时、每周），账号没有对应周期时不会补造数据。Credits 没有货币单位，不按美元或人民币显示；余额 0 不代表订阅额度耗尽。API 中转站不使用这套官方额度查询。

每个账号使用自身的 access token 和 account ID 查询官方 `/backend-api/wham/usage`。同一账号的已合并档案只显示一份额度。查询不会切换本体登录、发起模型生成、消耗重置券或改写登录文件。网页登录令牌及账号内部 ID 不发送到浏览器。

数据缓存 5 分钟，页面可见时检查更新；点击“已登记身份”旁的刷新图标可提前查询，至少间隔 30 秒。查询失败至少等待 1 分钟再重试，保留旧数值并标注“上次数据”；没有数据时显示查询失败或登录失效，不显示为 0。登录凭据更新会立即使旧缓存失效。面板不自行刷新官方 refresh token，以避免与运行中的 Codex 争用；正常情况下独立档案由原版 app-server 使用持久 refresh token 自动续期，不需要定期重新登录。

如果官方撤销了 refresh token，自动续期无法恢复，额度区域会提示登录失效。独立官方身份旁的“重新登录”会启动一次设备码授权；请使用同一个官方账号完成授权。授权成功后新凭据会持久化到该身份档案，原有 session 绑定保留。系统本体身份没有覆盖按钮，避免面板误改主机级登录；需要恢复本体账号时使用 Codex 本体登录。

### Fast 与本体登录

桌面版的 Fast 入口读取本体账号，而不是当前 session 的身份绑定。需要使用 Fast 时，本体须真实登录官方账号，且全局默认 `model_provider` 为 `openai`。全局 `openai_base_url` 不应指向中转站；中转站地址保存在各自的 provider 定义和身份 profile 中。

本体登录可使用原版 CLI 的 `codex login --device-auth`。修改本体登录或全局默认 provider 后重启一次主程序，随后通过面板继续为不同 session 选择身份。新会话默认使用官方 provider；需要中转站的会话应明确绑定对应 API 身份。选择 Fast 仍取决于模型支持和账号权限；此配置不保证中转站支持 Fast。

### 侧边聊天与身份

通过 Codex 分叉或侧边聊天创建的普通会话，只在创建时继承源会话的身份快照，之后各自独立。主会话切换不会等待、卸载或改写普通分叉，分叉也可单独切换。历史中的 forked_from_id 和旧绑定中的 parentThreadId 仅表示来源，不建立身份联动；已有旧绑定无需重写历史即可使用独立规则。真正通过子智能体机制启动且仍加载的任务，仍由原有保护规则处理。2026-10-23 的第九补丁取代旧版持续同步规则。

实测已验证官方 Fast、切到 API 的标准请求、再切回官方 Fast。测试在独立目录运行，只向临时后端提供短期 access token，没有复制 refresh token。桌面模型菜单的账号能力仍属于主机级，这次修复未将其改为逐 session 的权限判断。公开验证摘要见源码仓库 `VALIDATION.md`。

- 选中会话后查看身份，再选择目标身份并切换。
- 已加载且空闲的会话重建自己的运行时，整个 Codex 不重启。
- 会话仍在生成、后台终端运行或子任务仍占用运行时时，请求会等待，可以取消尚未执行的请求。以“已生效”为准，再开始需要新身份的工作。
- 未加载的会话只保存绑定，显示“打开会话后生效”；不会因为修改身份而自动启动该会话。
- 身份切换保留当前模型。目标服务是否支持该模型、是否有额度，仍取决于服务端。

面板只监听 `127.0.0.1`，查询和操作均需要保存在当前用户配置目录中的面板访问令牌。令牌通过专用启动器交给浏览器会话，API Key 不进入网页。

切换会重建该会话的工具连接。文件和对话历史保留；工具的临时内存状态可能需要重新初始化。

## 新机器的身份登记

从 v0.1.2 起，右侧栏提供“添加官方账号”入口：点击后显示设备码和 OpenAI 授权链接，使用目标官方账号授权。登录保存在独立账号目录，不改变本体登录。完成后按邮箱自动登记；相同 account ID 与 user ID 的账号拒绝重复登记。可以取消，设备码最多等待 15 分钟。

安装器会登记原版 CLI 当前已登录的官方账号。先用原版 CLI 完成官方登录，再运行安装器。已有 `identity-switcher` 的 API 身份和官方档案可自动导入；API 身份新增仍需手动配置，没有 API Key 的网页表单。

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

v0.1.3 到 v0.1.4 只更新面板功能，Rust 后端保持不变。无需退出 Codex，可以在新包的 `payload` 目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\Update-Panel.ps1 -Installation '<现有安装目录>'`。脚本备份旧面板文件、验证进程归属后只重启面板服务，并检查登录文件与后端哈希；失败时恢复旧面板文件。已有面板网页刷新后生效。其他跨版本升级继续使用安装程序并完成版本兼容验证，不能用这个脚本跳过后端升级。

## 源码补丁

通过 Windows OpenSSH 部署时，请在已登录用户的 Interactive 计划任务中运行面板更新脚本，再从独立 SSH 连接检查面板。直接在 SSH 作业中启动的子进程可能随连接退出被回收。计划任务只用于一次性部署，完成后可以删除任务；不需要设置周期运行。

### 分支与手机远程连接

源码后端的编译版本默认是 `0.0.0`。桌面会按握手版本判断分页分支能力，远程设备注册也按版本判断是否需要更新。从 v0.1.2 起，握手与设备注册使用原版 CLI 的实测版本，保留源码构建出处和实际分页历史；不修改桌面安装文件。旧设备缓存会在启动时尝试更新，只有服务端返回同一设备和环境 ID 才保存，失败则保留原配对。

安装更新后通过 `Codex - Session Identities` 重启一次。分页分支使用原生 `thread/fork` 并继承身份；手机端请刷新设备列表并重新连接。手机到 PC 的完整交互还需要在实际手机上验收；版本修复不保证所有旧手机客户端、新桌面版本或服务器策略兼容。

补丁位于 `patches/`，基于 OpenAI Codex 提交 `0c7362d121d1c7f69540262425fd4e2209fd8e8d`。应用前运行：

```powershell
.\patches\apply.ps1 -Repository <Codex源码目录> -CheckOnly
```

去掉 `-CheckOnly` 后应用。不同上游版本会被拒绝，应在独立检出中重放、编译并运行源码包的测试后更新 manifest，不能仅凭补丁应用成功判断兼容。

已实测：Windows Desktop `26.1007.2314.0`、原 CLI `0.162.0-alpha.17.2`。其他版本需重新验证。

版本对齐维护要求见 [VERSION-COMPATIBILITY.md](VERSION-COMPATIBILITY.md)：桌面握手、官方请求与模型目录、远程设备注册都应使用实际安装的原版 CLI 版本，执行宿主文件也应与该原版配套。升级不能只改版本字符串，必须验证对应协议和功能。

性能实测见 [PERFORMANCE.md](PERFORMANCE.md)。v0.1.3 使用优化构建，将模型目录准备移到共享锁之外，并按身份保存缓存；保留账号、提供方、版本与 5 分钟有效期校验。面板复用未变化的会话行，切换期间主动查询结果，后台隐藏时暂停网页轮询。安装文件更新后，已经运行的后端需要重启一次才能使用新构建。

远端真实双官方账号实测：切到尚未缓存的账号约 3.89 秒，切回已缓存账号约 42 毫秒；其他会话重命名的最长等待从约 4.24 秒降到 19 毫秒。A→API→B→A 的四次实际请求与命令执行验收也通过。首次目录查询仍可能受网络影响；失效缓存、较长历史和 MCP 重连不能保证同样速度。忙碌切换由生命周期事件触发重试，仍保留 2 秒轮询兜底。

源码默认编译版本为 `0.0.0`，官方接口会据此限制可用模型。桥接程序启动时读取已安装原版 CLI 的版本，通过 `CODEX_IDENTITY_CLIENT_VERSION` 传给后端，统一官方请求的 `version` 标头与模型目录的 `client_version`。这只是版本兼容，不改变账号权限，也不把 Sol 模型映射成其他模型。升级原版后仍需验证补丁与新版本的协议兼容性。

2026-10-14 实测：两个不同官方账号分别成功调用 `gpt-6.1-sol`、`gpt-6-sol`，均使用 Fast；切到 API 后成功调用 `gpt-6-sol`，再切回官方成功调用 `gpt-6.1-sol` Fast。全局登录文件未变。验证范围和未覆盖项目见源码仓库 `VALIDATION.md`；含个人身份和会话元数据的原始报告不随公开发布包分发。

Windows 后端还需要同目录下的 `codex-code-mode-host.exe`、`codex-command-runner.exe`、`codex-windows-sandbox-setup.exe`。安装器从目标机器原版 CLI 目录复制这些文件；启动器补齐缺失文件，桥接程序启动后端前按哈希同步原版配套文件。手动只替换后端 EXE 不能代替完整部署。远端已验证实际命令执行及 Code Mode 宿主进程。

托盘和面板快捷方式使用独立的 Edge 面板窗口（无 Edge 时使用 Chrome）。重复点击恢复并激活已有窗口；关闭后才重新打开。该窗口使用当前 Codex 配置目录下的专用浏览器配置，不修改日常浏览器标签页。旧版本在普通浏览器中打开的标签页可手动关闭。

## Update-resilient launch (2026-10-21)

Use the stable Session Identities shortcut after Store updates. The launcher discovers the registered Desktop and its bundled CLI together, stages backend and companion binaries in content-addressed runtime-bundles, and checks their hashes before use. Updating a companion creates a separate bundle instead of overwriting a running executable. Backend binaries are copied once into a private content store; bundles share that immutable copy where hard links are supported.

Ordinary startup and --check run only a headless protocol probe in an empty CODEX_HOME, with inherited token/API-key variables removed and no inference requests. Checks cover initialization, thread listing, identity metadata, temporary threads, and both history modes. Successful results are cached by executable and adapter hashes. Full Desktop tests are an explicit maintenance action on a designated test machine; ordinary launch never opens a second test Desktop. The actual production launch must still complete its initialization handshake and connect to the expected identity backend before it is marked ready.

An incompatible protocol check fails before the current Desktop is stopped. Version changes also recognize Desktop processes from older Store package directories. Failures retain a specific stage and message in launcher-status.json and append launcher-events.jsonl (rotated at 5 MiB). An error dialog releases the launcher mutex, so leaving it open cannot block subsequent launches. Preflight readiness is reported separately from a currently connected identity backend. A completed production launch saves last-successful-launch.json; configuration backups and previous runtime bundles remain available for deliberate recovery. There is no silent fallback to a global account or unpatched backend.

Machine JSON from Node uses ASCII Unicode escapes so Windows PowerShell 5.1 legacy code pages cannot corrupt Chinese status messages. JSON files are read as UTF-8. Future incompatible Desktop protocols still require porting the native patch; discovery and initialization checks do not certify every feature, account, tool execution mode, or remote-control workflow.

Provider recovery (2026-10-21, corrected): saved identity_* provider names are retained so old chats can load configuration. System aliases require both account and user to match the current global login. Independent official aliases are credential-free placeholders with requires_openai_auth=false and a pinned account header; the native identity manager supplies the private account on resume or switch. Do not install a global auth command on these aliases: native provider overrides deep-merge and set requires_openai_auth=true, which conflicts with a retained auth command. Independent identities require the identity launcher; these placeholders do not authorize standalone unpatched inference. Private credential files and the global default provider are not changed.

The launcher runs ensure-provider-aliases.mjs before loading its runtime. It adds missing aliases and migrates only the exact legacy private-credential commands generated by this installation, replacing their whole provider table after backing up config.toml. Customized provider authentication is preserved. The original CLI config API writes changes and read-back verifies that no conflicting auth command remains. Access/refresh tokens are never copied into config.toml.

Process ownership correction: Store package version matching is limited to Store-configured launchers in the same Windows session. A custom fixture cannot claim a production Store desktop. A prior remote fixture exposed this bug and closed the existing remote window; that window was restored through a one-time interactive task, and the task was removed. Corrected restart, incompatibility rejection, and process-ownership regressions all passed while preserving the restored desktop. Failure fixtures run the PowerShell target directly, avoiding the native wrapper's intentional error dialog. Ordinary startup never launches a second Desktop test window.


Tool diagnostics (2026-10-23): select a chat and use 诊断此会话工具. The panel queries that loaded thread's MCP inventory, connection/authentication states and discovery failure flag without executing tools, resuming unloaded chats, or exposing MCP schemas, resources, endpoints or error payloads. Unknown backend versions fail closed. A running older bridge requires one normal Codex restart; updating the panel does not restart Codex.

全局重新加载 MCP 配置 requires a fresh diagnostic and explicit acknowledgement that ALL loaded chats are affected. Confirmation expires after two minutes, is single-use, and is bound to the chat and backend PID. Native reload applies configuration changes to subsequent turns. It does not guarantee reconnection when configuration is unchanged. The panel reports accepted/queued separately from catalog visibility or successful model tool execution. It does not restore Desktop-injected tools, override browser URL checks, reauthorize SSH, enable deliberately disabled plugins, or relax permissions. Future protocol/schema incompatibilities show unavailable instead of pretending recovery succeeded.


侧边浏览器恢复（2026-10-23）：选择会话后，优先使用“检查侧边浏览器”，再点击“重新连接此会话浏览器工具”。这是身份后端新增的 thread/browser/read 和 thread/browser/reload 接口。它只检查已加载会话里现有的 iab 配置；未加载、未配置或正在回复时拒绝重连。恢复复用当前会话的配置，通过原生 RefreshMcpServers 操作强制在后续刷新建立新连接，不依赖改写全局配置。它会重新连接该会话的 MCP 工具宿主；其他会话保持原样。身份、历史、网站授权、刻意禁用的插件和文件权限均不会被该操作修改。

面板仅在收到本会话、当前后端且两分钟内的检查结果后允许重连，每个确认仅能使用一次。接口接受请求显示“已请求”，不代表页面读取已经验证成功。请在下一轮要求会话使用 Codex 右侧浏览器读取已打开页面；如果仍提示站点授权或浏览器策略错误，仍须按 Desktop 原有提示处理。旧桥接或旧原生后端会显示不支持；升级后在下一次正常启动 Codex 时加载，不会热替换正在运行的后端。

重连是异步操作，提交后会短暂抑制重复请求；请稍候再发起下一轮。界面不会把“已提交”当成已经能读取页面。

2026-10-26：提交后面板每 2.5 秒读取此会话浏览器宿主状态，最多等待 30 秒；会明确显示已连接、启动失败或尚未确认，禁用的旧 cua_repl 不影响判断。工具目录返回仍需下一轮实际读取页面验证。启动器会备份并修正 node_repl 指向的旧官方缓存路径，只采用与当前 Desktop 资源清单完全匹配且文件完整的运行时；自定义 MCP、身份和网站授权均保留。找不到匹配运行时时，在关闭当前 Codex 前停止启动检查，提示先打开官方 Codex 完成运行时安装。

对于已有 iab 配置、浏览器说明为空、直接启动官方 node_repl 且无自定义参数的旧配置，启动器会改用同一官方运行时自带的 cua-repl 初始化入口（仅启用 browser）。旧 bundled Browser 服务文件引用会迁移为同一运行时的 @oai/browser-desktop/service，其他可信服务和授权字段保留。面板会分别提示 JavaScript 宿主连接与浏览器初始化说明是否就绪；这两项仍不证明 IAB 或页面实际可用。

若实际调用返回 `Browser is not available: iab` 或浏览器清单为空，同时 Desktop 日志出现 `Timed out while fetching post-login Statsig bootstrap` 和 `bundled_plugins_reconcile_skipped_features_unavailable`，应先恢复 Desktop 官方功能配置加载。仅刷新 MCP 不能启动尚未启用的 Desktop 浏览器控制服务；不要通过强制功能开关绕过原有可用性和权限判断。

当前正式版 Desktop 不提供开发版的 `Reload Window` 菜单（源码通过 `allowWindowReload: buildFlavor !== Prod` 限制）。不要把此菜单或开发版快捷键作为正式版的恢复步骤。此初始化请求失败后没有独立的界面重试入口；重新启动 Desktop 才会重新执行初始化。重启前应确认正在运行的会话已妥善处理，重启后仍须以实际读取页面标题验证浏览器恢复，不能仅凭 MCP 已连接判断成功。

0.1.8 起，检测到与当前官方运行时匹配的 `unified-computer-use` / `cua_repl` 插件时，启动器保留官方工具初始化配置，不再把普通 `node_repl` 改成旧版浏览器专用入口。未安装新版插件的旧环境仍保留兼容处理；本功能不自动启用被禁用的插件。

面板现在先检查仍在运行的 Desktop 的启动日志。如果官方功能配置超时且浏览器服务没有启动，面板会直接说明原因，不再提交无效的会话重连。日志缺失时显示原有工具诊断，不推断授权失效，也不自动重启 Codex。若其他会话正在运行，先妥善结束任务，再彻底退出并通过身份启动器重新打开。以后更新仍须做真实页面只读验证；此版本不保证网络超时永远不会复发。

面板入口可见性修正（2026-10-23）：右侧上方始终显示“侧边浏览器”区域，先在左侧选中会话，按钮才启用。重新打开面板时，会比较前端文件版本和面板服务 PID；发生更新时仅刷新身份面板窗口，不重启 Codex。页面与服务未变则继续复用现有窗口，保留选择状态。
# 启动兼容性修复（2026-10-26）

0.1.11：如果直接创建 Store 版 Desktop 进程返回 Windows 拒绝访问，启动器只在路径与当前用户注册的 Codex 包完全匹配时，尝试在该包身份下启动。包启动不会继承调用方的环境变量，因此助手显式传入六项启动配置，再等待身份后端路径和管理员状态核验；打开窗口本身不算成功。不修改 WindowsApps 权限、包注册或系统环境变量。新诊断保留底层错误码；Windows PowerShell 读取时请使用 `Get-Content -Encoding UTF8`。

强制切换 0.1.10：所选会话因回复、后台终端或所属子代理阻塞时，可选择“强制停止任务并切换…”。确认框会显示目标身份和操作范围。确认后先暂停活动目标，再停止当前回复、关闭所属后台终端与子代理，并继续清理本次切换出现的所属阻塞。只有后端核验目标身份生效才显示成功。保留聊天历史、文件和已完成子代理的结果；独立分叉与其他会话不受该清理影响。

清理有超时和并发身份版本检查。无法停止任务、目标身份无效、鉴权或网络失败时会明确报告失败，停止自动排队，不能保证外部服务一定成功。超时后先刷新实际身份，避免连续重复强制操作。后台命令可能关联 SSH 远端脱离终端的进程，关闭本机终端并不能保证该远端进程退出。

普通切换也会自动释放已经完成且没有后台终端的所属子代理，保留结果；仍有工作的子代理需要上面的显式强制确认。新原生功能在下一次正常启动身份版 Codex 后加载。

身份后端及其代码工具宿主、命令运行器、沙箱程序现作为配套运行时固定并校验哈希。Codex 更新不再替换其中的宿主程序。兼容性预检会实际执行 JavaScript 和一条隔离的 PowerShell 命令，再决定是否允许重启加载；无需使用真实账号或外部模型请求。

侧边浏览器重连等待超过 15 秒会显示超时并恢复按钮；超时不能证明请求未提交，应先重新检查再操作。已提交重连也不代表网站读取成功，仍需在该会话下一轮实际读取侧边浏览器页面确认。

新版 Codex 增加了启动前的配置与网络策略检查。身份启动器现在将该检查原样交给当前安装的官方 CLI 执行，随后再加载支持身份切换的后端。不会伪造策略结果或跳过原有授权。

每次版本组合变化时，兼容性预检也会检查这一启动步骤；失败会在停止现有 Codex 前中止。面板可单独打开，但只有身份后端已连接时才能实际切换会话身份。更新启动器文件后，请在方便时通过身份切换软件的 Codex 快捷方式正常重开；无需重复点击启动。
