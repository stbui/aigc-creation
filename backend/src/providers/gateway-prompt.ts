import { toAssetUrl } from './gateway-image.provider';
import { getCapability } from '../capabilities/capability.registry';

/**
 * 能力 → 真实模型的提示词构造。
 *
 * ## 2026-10-20: 本文件的 PROMPTS 字典已删除
 *
 * 提示词原先是这个文件里一份手写的 `Record<capability, PromptBuilder>`,
 * 与能力注册表**平行维护**。漏写某项能力时的行为是:
 *   `PROMPTS[capability]?.(…) ?? capability`
 * ——把裸能力 id (如字符串 `"matting"`) 当成提示词发给真实模型,
 * **不报错、不回落**, 只是模型收到一句莫名其妙的话, 产出垃圾图。
 * 这类失败在日志里完全看不出来, 只能靠用户投诉才发现。
 *
 * 现在提示词是能力自包含字段 (`CapabilityPlugin.buildPrompt`), 与能力定义同处
 * 一个文件, 且由 `assertCapabilityIntegrity` 在装配期强制校验非空。
 * 漏写从"运行时静默降级"变成"进程启动即报错"。
 *
 * 另有一处顺带修掉的隐式传递: 参考图张数过去靠往 params 里塞 `__refCount`
 * 混在业务参数里, 落库后分不清哪个是用户填的; 现在是 `buildPrompt` 的
 * 第二个显式入参 `refCount`。
 */

interface PromptContext {
  baseUrl: string;
  token: string;
  model: string;
  assetBase: string;
}

/**
 * 取能力的能力声明 (缺失即抛, 不再回落成裸 id)。
 *
 * ⚠️ 显式抛错而非 `?? capability` 的理由见文件头: 静默回落正是本次抽离
 * 要消灭的那类失败。走到这里说明能力注册表与调用方对不上, 属于编程错误,
 * 应当立刻暴露而不是降级。
 */
function pluginOf(capability: string) {
  const def = getCapability(capability);
  if (!def) {
    throw new Error(
      `未知能力 "${capability}" —— 未在 capabilities/definitions 下声明。` +
        `新增能力请在该目录建文件并在 definitions/index.ts 注册`,
    );
  }
  return def;
}

/** 组装请求体 (aigc 网关契约: type/prompt/model/params) */
export function buildGatewayRequest(
  capability: string,
  inputPaths: string[],
  params: Record<string, any>,
  promptOverride: string | undefined,
  ctx: PromptContext,
): Record<string, unknown> {
  const def = pluginOf(capability);
  const prompt = promptOverride || def.buildPrompt(params, inputPaths.length);
  return {
    // ⚠️ type 取自能力自身的 modality: 同一套网关契约下, 图像与文本的
    // type 取值不同, 写死 'image' 会让网关按图像契约解析文本请求。
    type: def.modality,
    prompt,
    ...(ctx.model ? { model: ctx.model } : {}),
    params: {
      capability,
      // 业务参数原样透传, 网关/渠道可自行取用
      ...params,
      // 参考图以站内 URL 回传 (网关侧拉取), 不传本地磁盘路径
      inputImages: inputPaths.map((p) => `${ctx.assetBase}${toAssetUrl(p)}`),
    },
  };
}

/**
 * 构造送给真实模型的提示词。
 *
 * 能力未注册时**抛错**而非回落成能力 id —— 见文件头的理由。
 */
export function buildPromptFor(capability: string, params: Record<string, any>): string {
  return pluginOf(capability).buildPrompt(params, 0);
}