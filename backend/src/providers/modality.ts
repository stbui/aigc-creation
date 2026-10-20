/**
 * 模态 —— 跨层共享的叶子模块 (2026-10-20 架构重构)。
 *
 * ## 为什么单独成文件
 *
 * `Modality` 同时被三层使用:
 *   - 统一模型能力层: 按模态分接口 (文/图/视)
 *   - 协议层: 每个协议声明它服务哪个模态
 *   - 厂商层: 每条通道声明它服务哪个模态
 *
 * 若把它放在协议层, 统一能力层就得 import 协议层 —— 破坏了「统一层是叶子」
 * 的分层前提 (应用层换厂商就要动能力层)。
 * 若放在厂商层, 协议层就得 import 厂商层 —— 更糟, 协议形状与厂商身份又揉一起。
 *
 * 故抽成**叶子模块**: 三层都依赖它, 它不依赖任何人。
 * 依赖方向保持单向: 应用 → 统一能力 → 厂商 → 协议 → (本模块)。
 *
 * ## 语义
 *
 * 模态 = 产出的**介质形态**, 与实现程度正交:
 *   image —— 图片字节
 *   text  —— 文本
 *   video —— 视频字节
 *
 * ⚠️ 协议名**跨模态复用** (`openai` 既是生图协议也是文本协议, 端点完全不同),
 * 故任何「按协议名推断能力」的写法都是错的, 必须 (modality, protocol) 二元组。
 */
export type Modality = 'text' | 'image' | 'video';

export const MODALITIES: Array<{ value: Modality; label: string; desc: string }> = [
  { value: 'text', label: '文生文', desc: '大语言模型对话补全, POST {base}/v1/chat/completions' },
  { value: 'image', label: '文生图', desc: '图像生成, 各家端点与尺寸写法不同, 逐协议适配' },
  {
    value: 'video',
    label: '文生视频',
    desc: '视频生成, 多数为异步任务制 (提交 + 轮询)。本项目尚未取证任何一家端点, 故暂无可选协议',
  },
];

/** 模态的中文名 (界面展示用) */
export const MODALITY_LABEL: Record<Modality, string> = {
  text: '文生文',
  image: '文生图',
  video: '文生视频',
};
