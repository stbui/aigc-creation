"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKBENCH_CAPABILITIES = exports.SUBMITTABLE_CAPABILITY_IDS = exports.parseDetailSections = exports.CAPABILITY_GROUPS = exports.CAPABILITIES = void 0;
exports.getCapability = getCapability;
exports.defaultCreditCostOf = defaultCreditCostOf;
exports.assertCreditCostDeclared = assertCreditCostDeclared;
exports.defaultParamsFor = defaultParamsFor;
exports.sanitizeParams = sanitizeParams;
exports.validateCapabilityParams = validateCapabilityParams;
const definitions_1 = require("./definitions");
const capability_plugin_type_1 = require("./capability-plugin.type");
const param_options_1 = require("./definitions/param-options");
Object.defineProperty(exports, "parseDetailSections", { enumerable: true, get: function () { return param_options_1.parseDetailSections; } });
const shoppable_carousel_1 = require("./definitions/shoppable_carousel");
const app_exception_1 = require("../common/app.exception");
/** 能力清单 (顺序即侧栏与工作台展示顺序, 与参考站一致) */
exports.CAPABILITIES = definitions_1.CAPABILITY_PLUGINS;
const BY_ID = new Map(exports.CAPABILITIES.map((c) => [c.id, c]));
function getCapability(id) {
    return BY_ID.get(id);
}
exports.CAPABILITY_GROUPS = [
    { id: 'ecommerce_gen', name: '电商生图', desc: '电商都在用，广大卖家优选' },
    { id: 'ai_retouch', name: 'AI修图', desc: '存量图二次创作' },
    { id: 'ai_video', name: 'AI视频', desc: '图生视频与短视频' },
];
/**
 * 能力的代码默认消耗价 (未读 SystemSetting 的裸值)。
 *
 * 与 `CapabilityPlugin.creditCost` 读的是同一个字段, 单列出来是为了让调用方
 * 意图明确 —— 要「当前生效价」请用 CreditPriceService.resolve(),
 * 不要在业务里直接取 def.creditCost, 否则后台改价对生成链路不生效。
 */
function defaultCreditCostOf(id) {
    const raw = BY_ID.get(id)?.creditCost;
    // 负数是非法配置, 按 0 处理而非透传 —— 负积分消耗会让 consume() 变成反向发放
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}
/**
 * 启动期自检的**兼容入口** —— 委托给 assertCapabilityIntegrity。
 *
 * ⚠️ 保留是因为既有调用方显式调过本函数; 新代码不必再调, 因为
 * `definitions/index.ts` 在被 import 时就已执行过一次同名校验。
 *
 * creditCost 的检查已并入 assertCapabilityIntegrity: 同一个装配期只留一道闸,
 * 避免「改了校验器却忘了另一处」的两份真相。
 */
function assertCreditCostDeclared() {
    (0, capability_plugin_type_1.assertCapabilityIntegrity)(exports.CAPABILITIES);
}
/** DTO 白名单用: 允许提交的能力 = 所有非 planned 的能力 */
exports.SUBMITTABLE_CAPABILITY_IDS = exports.CAPABILITIES.filter((c) => c.mode !== 'planned').map((c) => c.id);
/** 工作台卡片区展示顺序与参考站一致 */
exports.WORKBENCH_CAPABILITIES = exports.CAPABILITIES.filter((c) => c.inWorkbench);
/** 能力默认值, 供前端初始化表单 */
function defaultParamsFor(id) {
    const def = BY_ID.get(id);
    if (!def)
        return {};
    const out = {};
    for (const p of def.params) {
        if (p.default !== undefined)
            out[p.key] = p.default;
        else if (p.type === 'enum')
            out[p.key] = p.options?.[0]?.value;
        else if (p.type === 'number')
            out[p.key] = p.min ?? 0;
        else if (p.type === 'boolean')
            out[p.key] = false;
        else
            out[p.key] = '';
    }
    return out;
}
/** 参数越界时收敛到声明区间, 避免前端/外部传入离谱数值打挂图像处理 */
function sanitizeParams(id, params) {
    const def = BY_ID.get(id);
    if (!def)
        return {};
    const input = params ?? {};
    const out = {};
    for (const p of def.params) {
        const raw = input[p.key];
        if (raw === undefined || raw === null || raw === '') {
            /*
             * hidden 参数是页面/接口显式代填的技术字段（参考站别名、遮罩 id、
             * 精确定位等），不是用户表单项。未提交时必须保持“未提供”，不能补
             * 默认值 —— 否则新别名的默认值会覆盖旧字段，例如旧调用方只传
             * bgColor 时，下游会误以为用户选了 selectedColor=transparent。
             */
            if (p.hidden)
                continue;
            out[p.key] = defaultParamsFor(id)[p.key];
            continue;
        }
        if (p.type === 'number') {
            let n = Number(raw);
            if (!Number.isFinite(n))
                n = Number(p.default ?? p.min ?? 0);
            if (p.min !== undefined)
                n = Math.max(p.min, n);
            if (p.max !== undefined)
                n = Math.min(p.max, n);
            out[p.key] = n;
        }
        else if (p.type === 'boolean') {
            out[p.key] = raw === true || raw === 'true' || raw === 1 || raw === '1';
        }
        else {
            // enum: 只接受声明过的选项, 否则回落默认值 (防止前端加项后端不认)
            if (p.type === 'enum' && p.options && !p.options.some((o) => o.value === raw)) {
                out[p.key] = p.default ?? p.options[0]?.value;
            }
            else {
                out[p.key] = String(raw).slice(0, p.maxLength ?? 2000);
            }
        }
    }
    return out;
}
/**
 * 提交前严格校验参数。
 *
 * `sanitizeParams` 的职责是落库前收敛；它遇到非法枚举或越界数字会回落到
 * 默认值。这在“修正展示参数”时可以接受，但对生成任务是一种静默失真：
 * 调用方提交 120% 扩图占比，实际按默认的 80% 出图并扣费。这里在扣费前
 * 再做一道严格闸，越界/类型错误直接 40001。
 */
function validateCapabilityParams(id, params) {
    const def = BY_ID.get(id);
    if (!def)
        throw new app_exception_1.AppError(40001, `不支持的能力: ${id}`, 400);
    if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
        throw new app_exception_1.AppError(40001, 'params 必须是对象', 400);
    }
    const input = params ?? {};
    for (const p of def.params) {
        const raw = input[p.key];
        if (raw === undefined || raw === null || raw === '')
            continue;
        if (p.type === 'number') {
            const value = typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isFinite(value)) {
                throw new app_exception_1.AppError(40001, `${p.label}必须是有效数字`, 400);
            }
            if (p.min !== undefined && value < p.min) {
                throw new app_exception_1.AppError(40001, `${p.label}不能小于 ${p.min}`, 400);
            }
            if (p.max !== undefined && value > p.max) {
                throw new app_exception_1.AppError(40001, `${p.label}不能大于 ${p.max}`, 400);
            }
            continue;
        }
        if (p.type === 'boolean') {
            if (![true, false, 1, 0, '1', '0', 'true', 'false'].includes(raw)) {
                throw new app_exception_1.AppError(40001, `${p.label}必须是布尔值`, 400);
            }
            continue;
        }
        if (p.type === 'enum') {
            if (!p.options?.some((option) => String(option.value) === String(raw))) {
                throw new app_exception_1.AppError(40001, `${p.label}取值无效（允许：${p.options?.map((option) => option.value).join('、') ?? '无'}）`, 400);
            }
            continue;
        }
        if (typeof raw === 'object') {
            throw new app_exception_1.AppError(40001, `${p.label}必须是文本`, 400);
        }
        const text = String(raw);
        if (p.pattern && !new RegExp(p.pattern).test(text)) {
            throw new app_exception_1.AppError(40001, `${p.label}格式无效`, 400);
        }
        const maxLength = p.maxLength ?? 2000;
        if (text.length > maxLength) {
            throw new app_exception_1.AppError(40001, `${p.label}不能超过 ${maxLength} 个字符`, 400);
        }
    }
    /*
     * 换色支持两条调用约定：定制页提交 targetColor，旧调用方提交
     * color=custom + customColor。后者缺 HEX 时上面的逐字段校验会因空值跳过，
     * 最终可能把字面量 "custom" 当成目标色发给模型。跨字段约束必须在这里拦下。
     */
    if (id === 'recolor' && input.color === 'custom') {
        const targetColor = input.targetColor || input.customColor;
        if (targetColor === undefined || targetColor === null || targetColor === '') {
            throw new app_exception_1.AppError(40001, '选择自定义颜色时必须填写有效的 HEX 颜色', 400);
        }
    }
    /*
     * 带货图文的模板 id 是**外部引用**（49 个模板的稳定 id），
     * 声明成 text 是为了不让能力清单接口膨胀 49 倍。
     * 代价是 enum 的「合法值白名单」在这里失效 —— 模板生成模式下
     * 传一个不存在的模板 id 会静默走到 AI 生成分支，用户拿到的是
     * 「不是我要的版式」的结果却看不出原因。这里补一道校验：
     * 选了模板生成就必须给出真实存在的模板。
     */
    if (id === 'shoppable_carousel' && input.mode === 'template') {
        const templateId = String(input.templateId ?? '').trim();
        if (!templateId || !(0, shoppable_carousel_1.shoppableCarouselTemplate)(templateId)) {
            throw new app_exception_1.AppError(40001, '请选择一个有效的模板', 400);
        }
    }
}
//# sourceMappingURL=capability.registry.js.map