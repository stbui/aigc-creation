import { BaseImageProvider } from '../image-provider-base';
import { ModelVerseImageProvider } from '../modelverse-image.provider';
import { VolcengineImageProvider } from '../volcengine-image.provider';
import { MiniMaxImageProvider } from '../minimax-image.provider';

/**
 * 协议 → 图像 provider 实例的工厂 (2026-10-20 架构重构)。
 *
 * ## 这是「统一各个协议」这一步的落点
 *
 * 改造前 capability-router 里有一个 switch, 把协议标识映射到具名实例:
 * ```
 *   case 'openai':      return this.modelverse;
 *   case 'volcengine':  return this.volcengine;
 *   case 'minimax':     return this.minimax;
 * ```
 * 每加一家新协议就要改这个 switch, 且**漏改不会报错** —— 表现为
 * 「选了新协议, 生成时报未知协议」。现在未知协议会显式抛错。
 *
 * 现在协议形状与端点都归协议层管, 同步类 provider 只差一个协议标识,
 * 故这里可以**按标识构造**: 新增协议 = 协议层加一条 + 本表加一行,
 * 不必再动路由器的 switch。
 */
export function createImageProvider(protocol: string): BaseImageProvider {
  switch (protocol) {
    case 'openai':
      // 历史别名: 早期只支持优云智算时叫 modelverse, 保留兼容以免已存配置失效
    case 'modelverse':
      return new ModelVerseImageProvider();
    case 'volcengine':
      return new VolcengineImageProvider();
    case 'minimax':
      return new MiniMaxImageProvider();
    default:
      // 未知协议**显式抛错**, 不静默兜底: 否则「协议填错」会变成
      // 一个难以从界面定位的静默失败。
      throw new Error(
        `未知通道协议 "${protocol}"。可用: openai / volcengine / minimax` +
          `（在后台「模型配置」页选择厂商预设）`,
      );
  }
}
