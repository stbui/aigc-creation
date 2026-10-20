import { BaseImageProvider } from '../image-provider-base';
import { GatewayImageProvider } from '../gateway-image.provider';
import { ModelVerseImageProvider } from '../modelverse-image.provider';
import { VolcengineImageProvider } from '../volcengine-image.provider';
import { MiniMaxImageProvider } from '../minimax-image.provider';
import { protocolSpec } from './protocol.spec';

/**
 * 协议 → 图像 provider 实例的工厂 (2026-10-20 架构重构)。
 *
 * ## 这是「统一各个协议」这一步的落点
 *
 * 改造前 capability-router 里有一个 switch, 把协议标识映射到四个具名实例:
 * ```
 *   case 'openai':      return this.modelverse;
 *   case 'volcengine':  return this.volcengine;
 *   case 'minimax':     return this.minimax;
 *   case 'aigc':        return this.aigc;
 * ```
 * 每加一家新协议就要改这个 switch, 且**漏改不会报错** —— 表现为
 * 「选了新协议, 生成时报未知协议」, 或者更糟: 落到 default 静默回落本地。
 *
 * 现在协议形状与端点都归协议层管, 同步类 provider 只差一个协议标识,
 * 故这里可以**按标识反射构造**: 新增协议 = 协议层加一条 + 本表加一行,
 * 不必再动路由器的 switch。
 *
 * ⚠️ 仍保留显式分支而非纯反射: 异步协议 (aigc) 的类结构与同步协议不同
 * (它自己管轮询), 不能用同一个基座构造。故本表是**协议 → 构造方式**的
 * 映射, 而不是"协议 → 类"的硬编码 switch。
 */
export function createImageProvider(protocol: string): BaseImageProvider | GatewayImageProvider {
  switch (protocol) {
    case 'openai':
      // 历史别名: 早期只支持优云智算时叫 modelverse, 保留兼容以免已存配置失效
    case 'modelverse':
      return new ModelVerseImageProvider();
    case 'volcengine':
      return new VolcengineImageProvider();
    case 'minimax':
      return new MiniMaxImageProvider();
    case 'aigc':
      return new GatewayImageProvider();
    default:
      // 未知协议**显式抛错**, 不静默回落: 静默兜底会把「协议填错」变成
      // 404 → 回落本地占位图的静默失败, 运营从界面上看不出来。
      throw new Error(
        `未知通道协议 "${protocol}"。可用: aigc / openai / volcengine / minimax` +
          `（在后台「模型配置」页选择厂商预设）`,
      );
  }
}

/**
 * 该协议在本项目是否已接入图像通道实现。
 *
 * 供后台在选择协议时提示「该协议下本项目尚无生图能力」,
 * 而不是让运营配完才发现 404 回落本地。
 */
export function imageProtocolAvailable(protocol: string): boolean {
  if (protocol === 'modelverse') return true; // 历史别名
  if (protocol === 'aigc') return true;
  const spec = protocolSpec(protocol);
  return !!spec && spec.modality === 'image';
}
