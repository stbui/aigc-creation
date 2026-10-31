/**
 * 用户对「前台模型」的选择（按能力记忆）。
 *
 * 为什么放在模块 + localStorage 而不是各页 state：
 * 同一能力的入口分散在多个页面（工具页、工作台、自由创作、爆款复刻），
 * 用户在 A 页选了「高质量」模型，回 B 页再提交却悄悄换回默认模型 —— 这是一次
 * 真实的扣费差异。选择按能力持久化，所有入口读同一份。
 *
 * 只存 id，不存镜像：模型可能被下架、线路可能不可用，读取时必须以刚拉到的
 * 目录为准回退到默认模型（`resolveModelId` 负责这一步）。
 */

const KEY_PREFIX = 'aigc.model.';
/** 选择变化的窗口事件：同页多个选择器与提交按钮需要同时刷新 */
export const MODEL_SELECTION_EVENT = 'aigc:model-selection';

function storageKey(capability: string): string {
  return `${KEY_PREFIX}${capability}`;
}

/**
 * 读取该能力已选模型 id。
 *
 * localStorage 可能不可用（隐私模式 / 站点数据被禁），失败按「没选过」处理，
 * 不能让读偏好把页面打挂。
 */
export function readSelectedModelId(capability: string): string | null {
  try {
    const value = window.localStorage.getItem(storageKey(capability));
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

export function writeSelectedModelId(capability: string, modelId: string): void {
  try {
    window.localStorage.setItem(storageKey(capability), modelId);
  } catch {
    // 存不进去不影响本次选择：事件仍会通知同页其它组件
  }
  window.dispatchEvent(
    new CustomEvent(MODEL_SELECTION_EVENT, { detail: { capability, modelId } }),
  );
}

/** 订阅选择变化；返回取消订阅函数 */
export function subscribeModelSelection(listener: () => void): () => void {
  window.addEventListener(MODEL_SELECTION_EVENT, listener);
  return () => window.removeEventListener(MODEL_SELECTION_EVENT, listener);
}
