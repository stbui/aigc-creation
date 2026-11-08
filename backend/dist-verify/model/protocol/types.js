"use strict";
/**
 * 插件清单类型定义 —— 与 `yingce.plugin/v2` 逐字段对齐。
 *
 * 移植自 open-ai-canvas `internal/protocol/types.go`。清单是插件与宿主之间
 * 唯一的公共契约：插件只声明「怎么拼请求、怎么读响应」，执行由宿主完成。
 * 因此这里的字段是**运行时投影**，不是插件代码的反射结果。
 *
 * 命名沿用上游 camlCase 的线上格式，TS 侧不做下划线转换 —— 插件包是
 * 外部产物，字段名一旦与参考实现分叉，110 个内置包全部要改。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANIFEST_SURFACES = exports.MANIFEST_CAPABILITIES = exports.PLUGIN_PACKAGE_VERSION = exports.MANIFEST_API_VERSION = void 0;
/** 清单版本常量 */
exports.MANIFEST_API_VERSION = 'yingce.plugin/v2';
/** 插件包容器版本常量 */
exports.PLUGIN_PACKAGE_VERSION = 'yingce.plugin/package-v1';
/** 允许的 provider 能力 */
exports.MANIFEST_CAPABILITIES = ['text', 'image', 'video', 'audio'];
/** 允许的宿主表面 */
exports.MANIFEST_SURFACES = [
    'admin.system-channel',
    'user.custom-channel',
    'canvas',
    'creation',
    'agent',
];
//# sourceMappingURL=types.js.map