import { BaseImageProvider } from './image-provider-base';

/**
 * 优云智算 (ModelVerse / api.modelverse.cn) 图像生成客户端。
 *
 * ## 2026-10-20: 已接入统一基座
 *
 * 改造前本类是 238 行的**独立实现**, 抄了基座的一整套骨架
 * (request / download / buildRefImages / 鉴权 / 超时), 却只比基座多做了
 * 两件小事:
 *   1. 单张用 `image` 字段、多张用 `images` 字段
 *   2. 响应是 OpenAI 形状 `{ created, data: [{ url }] }`
 *
 * 这两件事如今都在协议层 (`openai` 协议) 声明完毕, 故本类**只剩一行构造**。
 *
 * 保留本类而非直接用基座的原因: 它是**本项目当前唯一实测可用的图像通道**
 * (2026-10-20 实测 qwen-image-3.0 出图成功), 保留一个具名子类能让
 * capability-router 里的分派一眼看出「优云智算走哪条路」, 便于排障时
 * 快速定位; 行为上它与其它 OpenAI 兼容厂商**完全一致**。
 *
 * ## 契约形状 (2026-10-20 实测, 供对照)
 *   请求 { model, prompt, size?, image? | images?, n?, seed?, negative_prompt?, watermark? }
 *   响应 { created, data: [ { url } ] }        ← url 指向阿里云 OSS, 7 天后失效
 *   失败 { error: { message, type, param, code } }
 *
 * 参考图走 **base64 data URL** 而非站内 URL:
 *   优云智算明确接受 data:image/png;base64,... 形式(实测图生图生效),
 *   且这样不要求对方能回拉 ASSET_PUBLIC_BASE —— 本地开发时那个地址根本不可达。
 *
 * 单张请求体上限: 多张 1024 图 base64 后约 1.4MB/张, 故参考图最多取前若干张,
 * 超出部分丢弃 —— 宁可少参考几张, 也不让整个请求 413 失败。
 */
export class ModelVerseImageProvider extends BaseImageProvider {
  constructor() {
    super('openai');
  }
}

/**
 * 尺寸换算 (业务 ratio → 宽x高) —— **已废弃**。
 *
 * 2026-10-20 起统一走协议层的 `buildSize`, 本函数保留仅为不打断外部引用。
 *
 * @deprecated 用 image-provider-base 的 buildSize
 */
export function ratioToSize(ratio?: string, quality?: string): string {
  const base = quality === '2k' ? 2048 : 1024;
  const [rw, rh] = String(ratio ?? '1:1')
    .split(':')
    .map((n) => Number(n) || 1);
  const w = rw >= rh ? base : Math.round((base * rw) / rh);
  const h = rw >= rh ? Math.round((base * rh) / rw) : base;
  return `${Math.round(w / 64) * 64}x${Math.round(h / 64) * 64}`;
}

/**
 * 字节魔数判图片格式 —— **已移至** image-format.ts。
 *
 * 此处 re-export 是为了让既有引用点不必改; 新代码直接从 image-format 导入
 * (避免与 image-provider-base 形成循环依赖)。
 */
export { sniffImageFormat } from './image-format';
