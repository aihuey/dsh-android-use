import Schema from '@deepseek-ai/schemastery';
import { createTools } from './tools.js';
export const name = 'dsh-android-use';
export const inject = ['tools','attachments','approval','subprocess'];
export const Config = Schema.object({
  adbPath: Schema.string().default('adb').description('ADB 可执行文件：PATH 名称或绝对路径；Windows 默认 adb 不可解析时尝试常见 SDK/模拟器安装路径。多版本 adb 共存时必须显式指定与设备端 adbd 匹配的版本。'),
  autoConnect: Schema.array(Schema.string()).default([]).description('每次设备发现前自动 connect 的本机端点（如 127.0.0.1:5555）。ADB 传输不跨进程持久，用于避免每个新 shell 重复连接；仅允许 localhost 端点。'),
  remoteDir: Schema.string().default('/sdcard').description('设备端中转目录，用于截图与 UI 树临时文件（Windows 下 exec-out 二进制可能被改写）。该目录需可写。'),
  serial: Schema.string().default('').description('默认设备序列号；留空时仅允许自动选择唯一在线设备。'),
  allowedSerials: Schema.array(Schema.string()).default([]).description('设备白名单；空数组允许所有设备。建议填入测试设备序列号。'),
  approvalMode: Schema.union(['all','mutations','none']).default('all').description('all：所有设备访问审批；mutations：仅操作审批；none：可信专用设备自动化，不推荐。'),
  readOnly: Schema.boolean().default(false).description('仅观察设备，禁用所有输入与启动操作。'),
  timeoutMs: Schema.number().min(1000).max(120000).step(1).default(15000).description('单次 ADB 命令超时（毫秒）。'),
  snapshotTtlMs: Schema.number().min(1000).max(300000).step(1).default(60000).description('截图坐标/元素引用有效期（毫秒）。'),
  maxNodes: Schema.number().min(1).max(2000).step(1).default(500).description('最多返回的 UIAutomator 节点数。'),
  maxOutputBytes: Schema.number().min(1048576).max(67108864).step(1).default(16777216).description('单次 ADB 标准输出上限（字节）。'),
  unicodeInput: Schema.boolean().default(false).description('允许可选 ADB Keyboard Unicode 输入；须自行安装并选为当前输入法，不会自动安装/切换。'),
});
export function apply(ctx, config = {}) {
  const { definitions, dispose } = createTools(ctx,config);
  for (const definition of definitions) ctx.effect(() => ctx.tools.register(definition));
  ctx.effect(() => dispose);
}
