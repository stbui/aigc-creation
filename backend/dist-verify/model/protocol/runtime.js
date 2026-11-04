"use strict";
/**
 * 协议运行时契约 —— 插件与宿主之间唯一的执行接口。
 *
 * 移植自 open-ai-canvas `internal/protocol/types.go` 与 `adapter.go`。适配器只做
 * 「协议翻译」（拼请求、读响应），凭证、出站安全、轮询租约、计费、结果下载与
 * 任务恢复全部由宿主负责；这条边界是声明式插件可以安全执行的前提 ——
 * 插件永远拿不到数据库连接，也不直接发网络请求。
 *
 * 上游 Go 用 interface{} 表达所有模板值，这里统一用 `any`；`Buffer | string`
 * 的响应体允许适配器处理二进制结果（音频 / TTS 流）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=runtime.js.map