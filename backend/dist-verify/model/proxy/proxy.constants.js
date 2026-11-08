"use strict";
/**
 * 中转子系统的契约常量。
 *
 * 请求头名是**对外接口**：自定义中转的调用方（第三方 SDK / 脚本）按这些头
 * 传上游地址、格式与密钥，改名等于破坏兼容。CORS 白名单、文档与前端示例
 * 都必须引用本文件的常量值，不得各写一份字符串。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROXY_LIMIT_DEFAULTS = exports.PROXY_IDEMPOTENCY_HEADER = exports.PROXY_SCENE_HEADER = exports.CUSTOM_RELAY_HEADERS_HEADER = exports.CUSTOM_RELAY_KEY_HEADER = exports.CUSTOM_RELAY_FORMAT_HEADER = exports.CUSTOM_RELAY_URL_HEADER = exports.CUSTOM_RELAY_SOURCE = exports.SYSTEM_PROXY_SOURCE = exports.PROXY_SCENE = void 0;
/** 中转账单的场景标识（后台账单按此筛选） */
exports.PROXY_SCENE = 'proxy';
/** 系统渠道中转（使用服务端凭证、按模型计费） */
exports.SYSTEM_PROXY_SOURCE = 'system-channel';
/** 自定义渠道中转（用户自带地址与密钥，不计费） */
exports.CUSTOM_RELAY_SOURCE = 'custom-relay';
/** 自定义中转：上游地址（必填，仅 http/https，严格 SSRF 判定） */
exports.CUSTOM_RELAY_URL_HEADER = 'x-canvas-upstream-url';
/** 自定义中转：调用格式 `openai` | `gemini` | `claude`，缺省 openai */
exports.CUSTOM_RELAY_FORMAT_HEADER = 'x-canvas-upstream-format';
/** 自定义中转：上游密钥。不能复用 `Authorization` —— 它承载的是本系统的 Bearer 令牌 */
exports.CUSTOM_RELAY_KEY_HEADER = 'x-canvas-upstream-key';
/** 自定义中转：附加出站头（base64 编码的 `[{name,value}]` JSON） */
exports.CUSTOM_RELAY_HEADERS_HEADER = 'x-canvas-headers';
/** 调用场景（写进账单 `scene`，供运营区分业务来源） */
exports.PROXY_SCENE_HEADER = 'x-canvas-scene';
/** 幂等键：同一用户重放同一键返回同一张账单 */
exports.PROXY_IDEMPOTENCY_HEADER = 'x-idempotency-key';
const MB = 1024 * 1024;
/** 默认值与 `ENV_SPECS` 中的默认值必须逐字一致（否则页面/文档在骗人） */
exports.PROXY_LIMIT_DEFAULTS = {
    enabled: true,
    systemRequestBytes: 32 * MB,
    systemResponseBytes: 64 * MB,
    systemTimeoutMs: 10 * 60 * 1000,
    customRequestBytes: 32 * MB,
    customResponseBytes: 64 * MB,
    customTimeoutMs: 10 * 60 * 1000,
    customConcurrency: 2,
};
//# sourceMappingURL=proxy.constants.js.map