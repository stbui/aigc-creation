/**
 * 提示词预览 —— 回放「最终会发给模型的那条提示词」。
 *
 * ## 为什么要有这个接口
 *
 * 提示词是**能力定义的一部分**（`CapabilityPlugin.buildPrompt`），但它过去
 * 只在任务执行期才被拼出来，页面上看不到。用户想知道「模型到底会收到
 * 什么」，只能提交一次生成、扣一次钱、然后从服务端日志里翻。
 *
 * 更糟的是**前端复刻一份提示词模板**：两份模板必然漂移，预览与实发对不上
 * —— 那比没有预览更糟，因为它会让用户按错误的信息做决策。
 *
 * 所以预览必须走**同一份 `buildPrompt`**：同一份参数收敛
 * （`sanitizeParams`）、同一份参数白名单、同一份变体展开
 * （`outputPlan`）。前端只负责渲染，不复制模板。
 *
 * ## 边界
 *
 * 预览**不建任务、不选路、不扣费**。它不是「试跑」，只是把提示词算出来
 * 给用户看。因此也不依赖任何渠道配置 —— 没有可用线路时预览依然可用
 * （用户看到的是「提示词长这样，但当前无可用线路」两件事，而不是一个
 * 什么都不给的错误页）。
 */

import { Injectable } from '@nestjs/common';

import { AppError } from '../common/app.exception';
import {
  getCapability,
  sanitizeParams,
  validateCapabilityParams,
} from './capability.registry';
import type { CapabilityOutput } from './capability-plugin.type';

/** 一张图的提示词预览 */
export interface PromptPreviewItem {
  /** 批次内稳定键；同一提示词可能是多张（同一变体出多张） */
  key: string;
  /** 展示名（变体名 / 模块名） */
  label: string;
  /** 最终发给模型的完整提示词 */
  prompt: string;
}

/** 预览结果 */
export interface PromptPreviewResult {
  /** 能力 id */
  capability: string;
  /** 能力名 */
  capabilityName: string;
  /** 收敛后的参数（前端可回显，与真实链路落库的参数一致） */
  params: Record<string, unknown>;
  /** 本次会产出的每一张图的提示词 */
  items: PromptPreviewItem[];
  /**
   * 提示词条数与「一次提交会产出几张」。
   *
   * 两者必须一致 —— 预览只有一张、实际出三张，用户就无法用预览核对整套图。
   */
  outputCount: number;
}

@Injectable()
export class PromptPreviewService {
  /**
   * 计算提示词预览。
   *
   * @param capabilityId 能力 id
   * @param params       客户端参数（会被白名单收敛）
   * @param refCount     参考素材张数（与真实链路的 `inputAssetIds.length` 同源）
   */
  preview(capabilityId: string, params?: Record<string, unknown>, refCount = 0): PromptPreviewResult {
    const def = getCapability(capabilityId);
    if (!def) {
      throw new AppError(40001, `不支持的能力: ${capabilityId}`, 400);
    }
    if (def.mode === 'planned') {
      throw new AppError(40001, `${def.name} 尚未开放`, 400);
    }

    /*
     * 与真实链路**完全相同**的两步：先严格校验（越界 / 非法枚举直接拒绝），
     * 再收敛（回落默认值 / 截断）。顺序反了会让预览显示的是"修正后"的参数，
     * 而实际提交会被拒 —— 用户看到的和发生的不是一回事。
     */
    validateCapabilityParams(capabilityId, params);
    const sanitized = sanitizeParams(capabilityId, params);
    const refCountSafe = Math.max(0, Math.floor(refCount || 0));

    /*
     * 一次提交可能产出多张（详情图按模块、主图按变体计数）。
     * 这里走**能力自己的 `outputPlan`** —— 与准入层拆任务时调用的是同一个函数，
     * 因此预览的张数、顺序、每张的子参数与真实提交完全一致。
     *
     * 没有 `outputPlan` 的能力 = 一次一张，提示词就是主参数本身。
     */
    const outputs: CapabilityOutput[] = def.outputPlan?.(sanitized) ?? [];
    const items = outputs.length > 0
      ? outputs.map((output, index) => ({
          key: output.key,
          label: output.label,
          prompt: def.buildPrompt({ ...sanitized, ...output.params }, refCountSafe),
        }))
      : [
          {
            key: 'default',
            label: def.name,
            prompt: def.buildPrompt(sanitized, refCountSafe),
          },
        ];

    return {
      capability: def.id,
      capabilityName: def.name,
      params: sanitized,
      items,
      outputCount: items.length,
    };
  }
}
