import type { CapabilityPlugin } from '../capability-plugin.type';
import { VIDEO_DURATIONS, VIDEO_MOTION_PRESETS, VIDEO_MOTION_TEXT, VIDEO_RESOLUTIONS } from './video-param-options';

/**
 * 图生视频 —— 把一张静态图变成短视频。
 *
 * 2026-10-20 新增, 走 MiniMax 的视频通道 (minimax-video 协议)。
 *
 * ## 为什么视频能力**没有** localImpl
 *
 * 图像能力有本地 Jimp 兜底, 视频没有 —— 本地不存在「本地算法生成视频」这回事。
 * 编一段占位素材当视频产出, 会让用户以为模型产出了成品 (违反本项目
 * 「不把本地伪装成模型结果」的既有约定)。
 * 故视频能力**没有本地兜底**: 远程失败即失败, 如实呈现。
 * 校验器也据此放行 (只有 image 模态强制要求 localImpl)。
 *
 * ## 参数
 *
 * 时长与分辨率是**厂商枚举**而非自由值: MiniMax v1 只接受 6/10 秒与
 * 720P/1080P/2K, 传别的会报错。故只给选项, 不给数字输入框。
 */
export const ImageToVideo: CapabilityPlugin = {
  id: 'image_to_video',
  name: '图生视频',
  group: 'ai_video',
  summary: '上传一张图，生成动态短视频。',
  sidebarHint: '上传图片并描述想要的动态效果，即可生成短视频',
  mode: 'real',
  creditCost: 20, // 视频生成成本显著高于生图, 取 4 倍基准
  buildPrompt: (p) => {
    const motion = VIDEO_MOTION_TEXT[String(p.motion ?? 'normal')] ?? '';
    return (
      `图生视频：让画面中的主体自然动起来。` +
      (p.prompt ? `动作描述：${p.prompt}。` : '') +
      (motion ? `镜头与运动：${motion}。` : '')
    );
  },
  modality: 'video',
  inputs: 1,
  inWorkbench: true,
  params: [
    {
      key: 'prompt',
      label: '动态描述（选填）',
      type: 'text',
      placeholder: '例如：人物转头微笑，镜头缓慢推近',
      help: '描述你希望画面如何动起来；留空则由模型自行发挥',
    },
    { key: 'motion', label: '运动幅度', type: 'enum', default: 'normal', options: VIDEO_MOTION_PRESETS },
    { key: 'duration', label: '时长', type: 'enum', default: '6', options: VIDEO_DURATIONS },
    { key: 'resolution', label: '分辨率', type: 'enum', default: '1080P', options: VIDEO_RESOLUTIONS },
  ],
};
