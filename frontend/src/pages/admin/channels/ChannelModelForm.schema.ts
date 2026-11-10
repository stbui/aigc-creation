import { z } from 'zod';
import { validateImageCapabilityConfigJson } from './imageCapability';
import { validateTextCapabilityConfigJson } from './textCapability';
import { buildPriceTiers, validateModelTags } from './utils';

const tierSchema = z.object({
  selector: z.string(),
  resolution: z.string(),
  videoSeconds: z.string(),
  providerModelKey: z.string(),
  billingMode: z.string(),
  unit: z.string(),
  input: z.string(),
  output: z.string(),
  cached: z.string(),
  costConfigured: z.boolean(),
  costUnit: z.string(),
  costInput: z.string(),
  costOutput: z.string(),
  costCached: z.string(),
  priceConfigured: z.boolean(),
  enabled: z.boolean(),
});

/**
 * 编辑模型表单的唯一校验入口。
 *
 * 这里直接复用提交时的价格换算与标签校验，避免界面和接口各维护一套规则；
 * 字段错误由 react-hook-form 按 path 落到对应 Field，不再用 toast 串联提示。
 */
export const modelDraftSchema = z
  .object({
    modelKey: z.string().trim().min(1, '请填写商品编号'),
    providerModelKey: z.string(),
    displayName: z.string(),
    channelLabel: z.string().max(80, '供应商内名称最多 80 字'),
    description: z.string().max(500, '商品介绍最多 500 字'),
    icon: z.string(),
    capability: z.string().min(1, '请选择模型类型'),
    protocol: z.string().min(1, '请选择接入方式'),
    priceCurrency: z.string().min(1, '请选择结算币种'),
    tags: z.array(
      z.object({
        text: z.string(),
        color: z.string(),
      }),
    ),
    capabilityConfig: z.string(),
    enabled: z.boolean(),
    tiers: z.array(tierSchema).min(1, '至少保留一个售价方案'),
  })
  .superRefine((draft, ctx) => {
    if (draft.capability === 'image') {
      const configError = validateImageCapabilityConfigJson(draft.capabilityConfig);
      if (configError) {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilityConfig'],
          message: configError,
        });
      }
    } else if (draft.capability === 'text') {
      const configError = validateTextCapabilityConfigJson(draft.capabilityConfig);
      if (configError) {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilityConfig'],
          message: configError,
        });
      }
    } else if (draft.capabilityConfig.trim()) {
      try {
        JSON.parse(draft.capabilityConfig);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['capabilityConfig'],
          message: '能力配置格式不正确',
        });
      }
    }

    const tagError = validateModelTags(draft.tags);
    if (tagError) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags'],
        message: tagError,
      });
    }

    const tierResult = buildPriceTiers(draft);
    if ('error' in tierResult) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiers'],
        message: tierResult.error,
      });
    }
  });
