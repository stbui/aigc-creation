"use strict";
/**
 * 能力匹配：请求意图 vs 能力合同。
 *
 * 移植自 open-ai-canvas `internal/app/model_router_capability.go` 的 `MatchCapability`。
 *
 * 输出既有 `matched` 也有**逐条原因**：后台模拟与 C 端失败提示都直接读
 * `reasons`，不接受「选了模型但没生成出来」这种无信息量结果。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCapability = matchCapability;
const capability_config_1 = require("../domain/capability-config");
const image_contract_1 = require("./image-contract");
const model_intent_1 = require("./model-intent");
const option_values_1 = require("./option-values");
/** 图片参数合同参与匹配时，`size` 可能已被解析成像素预设：先归一化再校验 */
function matchImageParameters(spec, intent) {
    if (spec.imageParameters === undefined)
        return [];
    const issues = [];
    const values = { ...(intent.options ?? {}) };
    let parameters = spec.imageParameters.map((parameter) => ({ ...parameter, required: false }));
    if ((0, model_intent_1.capabilityImageSizePresetMatches)(spec, values.size, values)) {
        // 尺寸已经按预设归一，不再当作参数合同的普通取值
        delete values.size;
        parameters = parameters.filter((parameter) => parameter.name !== 'size');
    }
    try {
        (0, image_contract_1.resolveImageParameterValues)(parameters, values);
    }
    catch (caught) {
        issues.push({
            kind: 'image_parameter',
            name: 'imageParameters',
            reason: caught instanceof Error ? caught.message : String(caught),
        });
    }
    return issues;
}
function matchCapability(spec, intent) {
    const reasons = [];
    const issues = [];
    const addIssue = (kind, name, reason) => {
        reasons.push(reason);
        issues.push({ kind, name, reason });
    };
    for (const issue of matchImageParameters(spec, intent))
        addIssue(issue.kind, issue.name, issue.reason);
    if ((0, capability_config_1.normalizeCapability)(intent.capability) !== (0, capability_config_1.normalizeCapability)(spec.capability)) {
        addIssue('capability', 'capability', '能力类型不匹配');
    }
    const operation = String(intent.operation ?? '').trim().toLowerCase();
    const specOperations = spec.operations ?? [];
    if (operation !== '' && specOperations.length > 0 && !(0, capability_config_1.containsCapabilityString)(specOperations, operation)) {
        addIssue('operation', 'operation', `不支持操作 ${intent.operation}`);
    }
    const inputs = spec.inputs ?? {};
    for (const [inputType, count] of Object.entries(intent.inputs ?? {})) {
        if (count < 0) {
            addIssue('input', inputType, '输入数量不能小于 0');
            continue;
        }
        const constraint = inputs[inputType];
        if (!constraint) {
            if (count > 0)
                addIssue('input', inputType, `不支持 ${(0, option_values_1.capabilityInputLabel)(inputType)}输入`);
            continue;
        }
        if (count < constraint.min || count > constraint.max) {
            addIssue('input', inputType, `${(0, option_values_1.capabilityInputLabel)(inputType)}数量需在 ${constraint.min}-${constraint.max} 之间`);
        }
    }
    for (const [inputType, constraint] of Object.entries(inputs)) {
        if ((intent.inputs?.[inputType] ?? 0) < constraint.min) {
            addIssue('input', inputType, `至少需要 ${constraint.min} 个${(0, option_values_1.capabilityInputLabel)(inputType)}`);
        }
    }
    const options = spec.options ?? {};
    for (const [rawName, value] of Object.entries(intent.options ?? {})) {
        const name = (0, option_values_1.canonicalModelOptionName)(spec.capability, rawName);
        if ((0, option_values_1.inactiveCapabilityOptionValue)(name, value))
            continue;
        const constraint = options[name];
        if (!constraint) {
            addIssue('option', name, `不支持参数 ${(0, option_values_1.capabilityOptionLabel)(rawName)}`);
            continue;
        }
        if (!(0, option_values_1.matchOptionConstraint)(name, constraint, value)) {
            addIssue('option', name, `参数 ${(0, option_values_1.capabilityOptionLabel)(rawName)}超出支持范围`);
        }
    }
    return { matched: reasons.length === 0, reasons, issues };
}
//# sourceMappingURL=capability-match.js.map