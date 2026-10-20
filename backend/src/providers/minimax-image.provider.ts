import { BaseImageProvider } from './image-provider-base';

/**
 * MiniMax 图像通道。
 *
 * 契约（2026-10-20 查官方文档取证，与 OpenAI 系有**四处差异**）:
 *   1. 端点  POST {base}/v1/image_generation —— **单数 image_generation**，不是 images/generations
 *   2. 尺寸  用 aspect_ratio ("16:9")，**没有 size/像素字段**，分辨率由服务端决定
 *   3. 响应  `{ id, data: { image_urls: [...] } }` —— data 是**对象**且字段名是 image_urls，
 *             与 OpenAI 的 `data: [{ url }]` 结构完全不同
 *   4. 参考图  subject_reference: [{ type: 'character', image_file: <url> }]
 *             —— 只支持**单张**参考图，且用专门的字段名
 *   错误形状  `{ base_resp: { status_code, status_msg } }`（HTTP 200 也可能是失败）
 *
 * 第 3 点尤其容易踩: 按 OpenAI 的 data[0].url 取会拿到 undefined。
 * 第 5 点更隐蔽: MiniMax 失败时仍返回 HTTP 200，只在 base_resp 里标错。
 *
 * ## 2026-10-20 架构重构
 * 以上五点全部移入协议层 (`minimax` 协议), 本类只剩一行构造。
 */
export class MiniMaxImageProvider extends BaseImageProvider {
  constructor() {
    super('minimax');
  }
}
