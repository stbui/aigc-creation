"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCapabilityIntegrity = assertCapabilityIntegrity;
/**
 * 装配期完整性校验 —— 本次抽离的**核心价值所在**。
 *
 * 把「漏写某处」从运行时的静默错误提前到启动时的明确报错。
 * 具体拦截五类历史上真实发生过的漏改:
 *   1. 缺 buildPrompt  → 裸能力 id 被当提示词发给模型 (不报错, 产出垃圾)
 *   2. 缺 creditCost   → 该能力免费开放 (少收钱比多收钱更难被发现)
 *   3. id 重复 / 空 id  → 路由配置项互相覆盖, 后台页面显示错乱
 *   4. 参数 key 重复   → sanitizeParams 静默覆盖后一项
 *
 * 所有模态都只允许真实模型产出。本地生成算法已于 2026-10-25 删除,
 * 因此这里不再要求或允许声明本地实现句柄。
 *
 * ⚠️ 取代了原先分散在 registry 的 assertCreditCostDeclared: 同一个装配期
 * 只留一道闸, 避免"改了校验器却忘了另一处"的两份真相。
 */
function assertCapabilityIntegrity(plugins) {
    const errors = [];
    const seen = new Set();
    for (const p of plugins) {
        const tag = p.id || '(空 id)';
        if (!p.id)
            errors.push('存在空 id 的能力定义');
        else if (seen.has(p.id))
            errors.push(`能力 id 重复: ${p.id}`);
        seen.add(p.id);
        if (typeof p.buildPrompt !== 'function') {
            errors.push(`能力 ${tag} 未声明 buildPrompt —— 漏写会把裸 id 当提示词发给真实模型`);
        }
        if (typeof p.creditCost !== 'number') {
            errors.push(`能力 ${tag} 未声明 creditCost —— 会导致免费开放（显式写 0 表示限时免费，是合规的）`);
        }
        if (!p.modality) {
            errors.push(`能力 ${tag} 未声明 modality`);
        }
        // 模型映射缺失会让该能力在准入时无参数可映射（提交必失败），属声明错误
        if (!p.model) {
            errors.push(`能力 ${tag} 未声明 model —— 准入无法把该能力的参数映射成模型请求意图`);
        }
        else {
            if (typeof p.model.intent !== 'function') {
                errors.push(`能力 ${tag} 的 model.intent 必须是函数`);
            }
            if (!p.model.capability) {
                errors.push(`能力 ${tag} 的 model.capability 缺失`);
            }
            else if (String(p.model.capability) !== String(p.modality)) {
                errors.push(`能力 ${tag} 的 model.capability(${p.model.capability}) 与 modality(${p.modality}) 不一致`);
            }
            if (p.model.operation !== undefined && !String(p.model.operation).trim()) {
                errors.push(`能力 ${tag} 的 model.operation 不能是空串`);
            }
        }
        // 参数重名会让 sanitizeParams 静默覆盖后一项, 属声明错误
        const keys = new Set();
        for (const param of p.params ?? []) {
            if (keys.has(param.key))
                errors.push(`能力 ${tag} 的参数 key 重复: ${param.key}`);
            keys.add(param.key);
            if (param.pattern) {
                try {
                    new RegExp(param.pattern);
                }
                catch {
                    errors.push(`能力 ${tag} 的参数 ${param.key} 声明了无效正则: ${param.pattern}`);
                }
            }
        }
    }
    if (errors.length) {
        // 抛而不 warn: 这些是**声明错误**, 继续启动等于带着已知缺陷上线
        throw new Error(`[capability.registry] 能力注册表完整性校验失败 (${errors.length} 项):\n` +
            errors.map((e) => `  - ${e}`).join('\n'));
    }
}
//# sourceMappingURL=capability-plugin.type.js.map