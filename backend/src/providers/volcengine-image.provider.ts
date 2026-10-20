import { BaseImageProvider } from './image-provider-base';

/**
 * 火山方舟（火山引擎 Ark）图像通道。
 *
 * 契约（2026-10-20 查官方文档取证，与 OpenAI 系有**三处实质差异**，
 * 这也是它不能复用 modelverse provider 的原因）:
 *   1. 端点  POST {base}/images/generations  —— baseUrl 自带 /api/v3, 无 /v1/images 段
 *   2. 尺寸  size 用「1K / 2K / 4K」档位，**不接受精确像素**（传 "1024x1024" 会报错）
 *   3. 参考图走公网可达的 URL（不是 base64），故依赖 ASSET_PUBLIC_BASE 配成对方能拉取的地址
 *
 * 响应仍是 OpenAI 形状 `{ data: [{ url }] }`，故 extract 可复用通用写法。
 * 错误形状是 `{ error: { message, type, param, code } }`（与 OpenAI 一致）。
 *
 * ⚠️ 本地开发时 ASSET_PUBLIC_BASE 是 localhost，上游拉不到参考图 →
 * 会退化成纯文生图。带参考图的真实验证需在公网可达环境做。
 *
 * ## 2026-10-20 架构重构
 * 端点/尺寸/参考图字段/响应解包/错误解包全部移入协议层 (`volcengine` 协议),
 * 本类只剩一行构造 —— 差异声明只有一份, 改协议不用改 provider。
 */
export class VolcengineImageProvider extends BaseImageProvider {
  constructor() {
    super('volcengine');
  }
}
