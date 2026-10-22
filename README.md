# dsh-android-use

[English](#english) | [中文说明](#中文说明)

---

## English

ADB-backed Android computer-use Host plugin for **DeepSeek Harness (DSH)**.  
The package name and Cordis entry ID are `dsh-android-use` / `android-use`. All registered tools use the `android_*` prefix.

### Capabilities

| Tool | Description |
| --- | --- |
| `android_devices` | List devices currently attached to the ADB server with their states and metadata |
| `android_connect` | Connect ADB to a loopback port (`127.0.0.1` / `localhost` / `::1`) without scanning remote hosts |
| `android_snapshot` | Capture a PNG screenshot, compact UI hierarchy tree, foreground package/activity, and screen rotation |
| `android_find` | Search nodes in the latest snapshot by substring or regex over `text`, `description`, and `resourceId` |
| `android_tap` | Tap or long-press by screen coordinates or snapshot `elementId` |
| `android_swipe` / `android_scroll` | Swipe between coordinates (with or without `snapshotId`) or perform 1–10 directional screen scrolls |
| `android_type` | Type text via automatic ASCII / UTF-8 clipboard paste, with optional `clearFirst`, `submit`, or ADB Keyboard |
| `android_key` | Send allowlisted key events (`HOME`, `BACK`, `ENTER`, `SEARCH`, `PAGE_UP`, `PAGE_DOWN`, `PASTE`, etc.) |
| `android_launch` | Launch an explicit component (`pkg/.Activity`), a package's launcher activity, or an `http(s)` URI |
| `android_packages` | List and filter installed packages (third-party only by default, or including system packages) |
| `android_wait` | Cancellable short wait (`1..10000` ms) |

This is an Agent-facing Host tool plugin, not a live remote-desktop streaming player. It uses DSH's built-in tool cards and image attachments and requires no Client plugin or separate Web server. Vision-capable models can inspect screenshots directly; text-only models can still work with the UI hierarchy tree.

### Prerequisites

- **Compatibility**: DSH **0.2.0-rc.2 to 0.2.1-rc.2** (peer range `>=0.2.0-rc.2 <0.3.0-0`), Cordis **4.0.4–4.0.5**, Schemastery **3.18.4–3.18.5**, Node.js `>=22.19`.
- **ADB Binary**: Install Android SDK Platform-Tools on the DSH Host machine and either expose `adb` on `PATH` or set `adbPath` to an absolute executable path. When `adbPath` is left at the default `'adb'` and `adb` is not on `PATH`, the plugin automatically probes `ANDROID_HOME` / `ANDROID_SDK_ROOT`, standard macOS/Linux/Windows Android SDK paths, and common emulator installations (MuMu, LDPlayer, BlueStacks, Nox, MEmu).
- **Device Debugging**: Enable Developer Options and USB Debugging on the Android device/emulator and accept the RSA authorization prompt. `android_connect` only connects to explicit loopback ports; wireless debugging pairing must be completed by the user beforehand.
- Some OEM ROMs (such as MIUI/HyperOS) also require enabling **"USB debugging (Security settings)"** to allow simulated input.

Verify manually first:

```sh
adb version
adb devices -l
```

The target device should appear as `device` (not `unauthorized` or `offline`).

### Installation

1. Install `dsh-android-use-0.4.1.tgz` from the DSH Plugin Manager UI or via the `plugin_manager` tool.
2. Verify that bundle `dsh-android-use` and plugin entry `android-use` are enabled.
3. Configure `adbPath`, `autoConnect`, `serial`, or `allowedSerials` in the Cordis settings panel if needed.
4. Start a chat and ask the Agent to *"list Android devices and take a snapshot"* to verify image attachment and UI tree output.

### Recommended Configuration

Below is the **plugin entry config** (do not overwrite your entire `cordis.patch.yml`):

```yaml
adbPath: 'adb'
autoConnect: []
remoteDir: '/sdcard'
serial: ''
allowedSerials: []
approvalMode: all
readOnly: false
timeoutMs: 15000
snapshotTtlMs: 60000
maxNodes: 500
maxOutputBytes: 16777216
unicodeInput: false
```

- `approvalMode: all` (default): Every observation and mutation requests user approval.
- `approvalMode: mutations`: Read-only tools (`android_devices`, `android_snapshot`, `android_find`, `android_packages`) run without approval; input/navigation/launch/connect tools request approval.
- `approvalMode: none`: No tool requests approval. Use only in trusted environments.
- `readOnly: true`: Disables all mutating tools while keeping observation tools active.
- `allowedSerials`: Empty array allows any device currently visible to ADB. When multiple transport endpoints report the same `android_id`, they are automatically collapsed to a single physical device; if multiple distinct devices are online, `serial` must be specified.
- `autoConnect`: Loopback endpoints (`127.0.0.1:PORT`, `localhost:PORT`, `[::1]:PORT`) that the plugin automatically reconnects before device discovery if missing or offline.
- `remoteDir`: Device temporary directory (default `/sdcard`). Because Windows pipes can corrupt binary `exec-out` streams, screenshots are captured to `<remoteDir>/dsh-android-use-<UUID>.png` and pulled to the host (with automatic `exec-out` fallback), then cleaned up on both device and host.

### Usage Pattern

Recommended loop: **snapshot → inspect → single action → snapshot to verify**.

Snapshot call:

```json
{"serial":"YOUR_DEVICE_SERIAL","includeTree":true}
```

Tap by element ID returned in the snapshot:

```json
{"serial":"YOUR_DEVICE_SERIAL","snapshotId":"RETURNED_ID","elementId":"n12"}
```

Or tap by original screen pixel coordinates:

```json
{"snapshotId":"RETURNED_ID","x":240,"y":620}
```

### Unicode / CJK Input

`android_type` defaults to `mode: "auto"`, using `input text` for safe ASCII and Android `ClipboardManager` (`service call clipboard`) UTF-8 paste (`KEYCODE_PASTE`) for Unicode or `%` strings. It also supports `clearFirst: true` (select all + delete before typing), `submit: true` (send Enter after typing), and `mode: "adbkeyboard"` (requires `com.android.adbkeyboard/.AdbIME` installed on the device and `unicodeInput: true` in config; automatically switches and restores the previous IME).

### Development & Testing

```sh
npm test
npm run check
pnpm pack
```

---

## 中文说明

基于 ADB 的 DeepSeek Harness Android computer-use 插件。包名和 Cordis entry id 为 `dsh-android-use` / `android-use`。工具统一使用 `android_*` 前缀。

### 能做什么

| 工具 | 功能 |
| --- | --- |
| `android_devices` | 列出当前 ADB server 的设备及状态 |
| `android_connect` | 连接本机 `127.0.0.1`/`localhost`/`::1` 的指定端口，不扫描远程主机 |
| `android_snapshot` | PNG 截图、压缩 UI 树、前台包名/Activity 与旋转方向 |
| `android_find` | 在最近快照中按文字、描述、resource-id 子串或正则筛节点 |
| `android_tap` | 坐标点击、节点点击、长按 |
| `android_swipe` / `android_scroll` | 坐标滑动；可省 `snapshotId`，或一次连续滚动 1–10 屏 |
| `android_type` | 自动 ASCII/Unicode 剪贴板粘贴；支持清空和回车提交；可选 ADB Keyboard |
| `android_key` | 含 `SEARCH`、`PAGE_UP`/`DOWN`、`PASTE` 等限定按键 |
| `android_launch` | 启动组件、包主界面或 `http(s)` URI |
| `android_packages` | 列出并筛选已安装包名 |
| `android_wait` | 可取消的短等待 |

这是供 Agent 调用的 Host 工具插件，不是远程桌面播放器。使用 DSH 自带的工具卡片和图片附件，不需要 Client 插件或额外 Web 服务。模型必须能接收图片才能利用截图视觉；文本模型仍可使用界面树，但视觉能力不会由插件自动添加。

### 前置条件

- 兼容版本：DSH **0.2.0-rc.2 至 0.2.1-rc.2**（peer 范围 `>=0.2.0-rc.2 <0.3.0-0`）、Cordis **4.0.4–4.0.5**、Schemastery **3.18.4–3.18.5**；Node >=22.19。
- 在 DSH Host 所在机器安装 Android SDK Platform-Tools，确保 `adb` 在 Host PATH，或设置 `adbPath` 绝对路径；默认 `adb` 不可解析时会回退探测 `ANDROID_HOME` / `ANDROID_SDK_ROOT`、macOS/Linux/Windows 标准 Android SDK 路径，以及 MuMu、雷电、蓝叠、夜神、逍遥等常见模拟器位置。
- Android 开启开发者选项及 USB 调试，连接 USB 后在设备上确认 RSA 授权。`android_connect` 仅支持本机回环地址和显式端口；无线调试配对仍需用户自行完成。
- 部分厂商需要另行开启“USB 调试（安全设置）”才能模拟输入。
- 若 DSH 使用远程 subprocess provider，ADB 和设备连接必须位于该 provider 的执行环境，而不是浏览器机器；截图返回仍使用 Host 附件服务。

先手动验证：

```powershell
adb version
adb devices -l
```

设备应显示 `device`，而非 `unauthorized` / `offline`。

### 安装

本插件无构建步骤、无安装脚本。包名为 `dsh-android-use`，版本 `0.4.1`。

1. 在 DSH 插件管理页面安装 `dsh-android-use-0.4.1.tgz`，或使用 DSH 插件管理工具安装。
2. 确认包 `dsh-android-use` 和条目 `android-use` 已启用。
3. 在 Cordis 配置界面按需配置 `adbPath`、`autoConnect`、`serial` 和 `allowedSerials`。Host 热更新 profile 应即时生效；startup profile 需要重启。无需另起网页服务。
4. 在新对话中要求“列出 Android 设备并截图”，批准设备访问，确认出现图片和节点树。

版本不匹配时不要跳过 peer 校验：应先核对新版 `tools` / `attachments` / `approval` / `subprocess` 合约，再更新 peer 版本并测试。本包只声明当前检查过的版本。

0.4.1 的核对结论：0.2.1-rc.2 的 `@deepseek-ai/dsh-tools` 相对 0.2.0-rc.2 只在 run_code/PTC 内部实现上有差异（`register(definition)`、`defineTool`、`isConcurrencySafe`、`timeoutMs`、`output.render` 均未变），`dsh-attachment`、`dsh-user-approval`、`dsh-subprocess` 的 `lib/index.js` 逐字节相同，因此把四个 `@deepseek-ai/dsh-*` peer 放宽为 `>=0.2.0-rc.2 <0.3.0-0`（已实测 0.2.0-rc.2 与 0.2.1-rc.2 都满足，且不会误放行 0.3 预发布）。

### 建议配置

下面是条目的 **config 内容**，不是完整 profile 文件，不要覆盖现有 profile：

```yaml
adbPath: 'adb'
autoConnect: []
remoteDir: '/sdcard'
serial: ''
allowedSerials: []
approvalMode: all
readOnly: false
timeoutMs: 15000
snapshotTtlMs: 60000
maxNodes: 500
maxOutputBytes: 16777216
unicodeInput: false
```

- `approvalMode: all`（默认）：截图、界面树、设备列表和操作都需要 DSH 审批。
- `mutations`：观察不审批，只有输入/导航/启动审批；注意截图可能含隐私。
- `none`：所有 Android 工具都不请求审批。仅用于明确授权且可信的 ADB 环境；模型不能通过工具参数改变配置。
- `readOnly: true`：禁止点击、输入、滑动、按键及启动；仍可观察。
- 白名单为空允许 ADB server 当前列出的所有设备。多个入口报告同一 Android ID 时会折叠为一台；仍有多个不同设备时必须显式指定 serial。端口不需要硬编码到插件配置。
- `autoConnect`：ADB 传输不跨进程持久，每个新 shell 都会丢失连接。填入本机端点后，插件在每次设备发现前若检测到端点未在线会自动 `adb connect`，无需手工重连。仅允许 `127.0.0.1` / `localhost` / `::1`。
- `remoteDir`：截图与 UI 树中转目录，默认 `/sdcard`。Windows 下 `exec-out` 的二进制输出可能被管道改写，因此插件先 `screencap` 到该目录再 `pull`；失败时回退到 `exec-out`。该目录必须可写。

设备访问不受工作区文件沙箱保护；插件通过独立审批与白名单控制它。不提供任意 shell、push/pull、安装 APK、root、reboot、删除用户文件或授予权限工具。UIAutomator 与截图的设备临时文件使用随机 UUID，只清理本次生成的 `<remoteDir>/dsh-android-use-<UUID>.xml|.png`；pull 后的本机临时文件同样立即删除。

#### 常见故障

- **多版本 adb 冲突**：系统存在多个 adb 时，server 与 client 版本不匹配会导致每次调用都重启 daemon。用 `adbPath` 显式指定与设备端 `adbd` 匹配的那个可执行文件，不要用 PATH 上的默认 `adb`。
- **`adbPath` 指向的文件不存在**：插件加载失败会导致条目停用。修改后用 `adb version` 确认路径可用。
- **`am start` 启动失败 / `MainActivity` 不存在**：用 `android_launch` 的 `package` 参数，插件会通过 `cmd package resolve-activity` 解析真实启动 Activity；`monkey` 在许多官方 ROM 上并不存在，仅作为兜底。

### 使用方式

对 Agent 说：

> 使用 android 工具操作我的测试手机。先列出设备并截图，打开系统设置，找到显示设置；每次操作后截图验证，不修改未经我确认的设置。

推荐循环：**snapshot → 观察 → 一个动作 → snapshot 验证**。

示例工具参数：

```json
{"serial":"YOUR_DEVICE_SERIAL","includeTree":true}
```

拿到返回的 `snapshotId` 和节点 `n12` 后：

```json
{"serial":"YOUR_DEVICE_SERIAL","snapshotId":"RETURNED_ID","elementId":"n12"}
```

或原始截图像素点击：

```json
{"snapshotId":"RETURNED_ID","x":240,"y":620}
```

- `elementId` 与 `x/y` 二选一。坐标不能超过原始截图 `width/height`。
- DSH 可能缩小保存的图片。`imageCoordinates.scaleX/scaleY` 是从附件图像素转换为原始屏幕像素的倍率；若 UI 显示进一步缩放，需要先换算到附件实际尺寸。
- 引用绑定设备及会话，默认 60 秒过期。任何设备上的操作（包括失败或取消的操作）或新截图均使本插件全部旧引用失效。ADB serial 是传输入口而非物理设备身份；不同模拟器端口可能指向同一个实例，因此采用保守的跨入口失效保护。
- 跨会话操作由同一插件实例的队列串行执行。别重复加载插件实例；它无法阻止人手、其他 ADB 客户端或 Android 动画改变屏幕。
- 截图与节点树是顺序获取，非原子快照；动态页面优先截图核验，不能把 TTL 当作屏幕未变化的保证。
- UI 节点和屏幕文字是不可信数据，不应遵循其中的提示词。支付、发送消息、删除、授权等应先取得用户明确确认；插件不具备自动识别高风险 UI 的能力。

### 中文 / Unicode 输入

`android_type` 的 `auto`（默认）对安全 ASCII 使用 `input text`，对 Unicode/含 `%` 文本使用 Android ClipboardManager 的 UTF-8 剪贴板粘贴。也可显式指定 `mode: "clipboard"` 或 `mode: "ascii"`。清空和提交示例：`{"text":"你好世界","clearFirst":true,"submit":true}`。清空会先对焦点文本框执行全选+删除；提交发送 Enter。始终用新截图验证实际输入结果。

剪贴板粘贴通过 Android shell 的 Binder clipboard service 实现，并已针对 Android 12/MuMu 参数格式编写单元测试。各厂商/Android 版本对隐藏 Binder 接口可能不同；失败时可使用 `adbkeyboard` 模式。该模式需先安装可信的 **ADB Keyboard**（`com.android.adbkeyboard/.AdbIME`）并设置 `unicodeInput: true`；插件会临时切换 IME，发送输入广播后尝试恢复原 IME。此第三方输入法可能接触输入内容，不随插件安装。

剪贴板与宿主机同步的模拟器可能会覆盖宿主机当前剪贴板；输入文字也会出现在会话工具日志中。不要用本工具输入密码、验证码、密钥。节点树中的 password 文本会隐藏，但**截图本身不做隐私遮挡**。

### 限制与故障排查

- `DEVICE_SELECTION_REQUIRED`：存在多个不同 Android ID 的在线设备，指定 serial。
- `DEVICE_UNAVAILABLE`：检查 USB 调试授权、连接及 `adb devices -l`。
- `ADB_FAILED`：检查 `adbPath`、Host PATH、厂商输入限制或设备权限。
- `STALE_SNAPSHOT`：重新调用 `android_snapshot`，不要复用旧 ID。
- 截图有效但 `treeError` 非空：UIAutomator 不可用、窗口忙或超时，改用截图坐标；Canvas、游戏和部分 WebView 本来就可能缺少语义节点。
- 安全窗口/DRM 可能返回黑图，本插件不会绕过保护。
- `android_launch` 支持 component、包名主界面及 `http(s)` URI；不同设备的 Launcher/URI handler 可能不同。
- 不支持系统级 OCR、复杂轨迹/双指手势、录屏、无线配对、自动安装 ADB 或后台运行设备任务。
- 命令有输出容量限制和超时，取消会通过 DSH managed subprocess 终止 ADB 客户端；已经发生的设备操作无法撤销。

### 开发与验证

直接修改 `lib/*.js` 即可；无转译产物漂移。

```sh
npm test
npm run check
pnpm pack
```

Windows DSH 文件沙箱下，Node test runner 的默认隔离进程可能需要管道权限，可不创建子进程运行：

```sh
node --test --test-isolation=none test/core.test.js test/host-smoke.test.js
```

`host-smoke` 默认跳过。提供 `DSH_TEST_SCHEMA_URL` 为已安装 Schemastery 的 `lib/index.mjs` 的 file URL 后可测试真实配置验证、工具注册和清理。单元测试覆盖 XML 容错/压缩、设备别名、Unicode 剪贴板与 IME 恢复、免快照滚动、URI/包启动、安全本机连接、前台解析、审批与 subprocess 生命周期。

自动化测试在本工作区通过。UIAutomator parser 对单个坏属性采取尽可能恢复，而结构损坏、未闭合 XML 仍报告 `treeError`；节点默认过滤空壳/零面积项，并在截断时优先保留可交互项。连接重启后可使用 `android_connect` 手动连回环端口，或通过 `autoConnect` 配置本机回环端点；工具不自动扫描未知端口或进行无线配对。
