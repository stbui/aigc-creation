import type { ParamOption } from '../capability-plugin.type';

/**
 * 视频参数选项集 (2026-10-20)。
 *
 * 与图像参数集分文件放, 理由同 `param-options.ts`:
 * 视频参数 (时长/分辨率) 与图像参数 (比例/画质档位) 是**不同概念** ——
 * 视频没有「画面比例」这种东西 (比例由输入图决定), 图像没有「时长」。
 * 混在一处会让两个模态的选项集互相污染。
 */

/**
 * 视频时长 (秒) —— MiniMax v1 支持 6/10 秒。
 *
 * ⚠️ 取值来自官方文档实测, 不臆造中间值: 厂商只接受这几个枚举,
 * 传 5 或 7 会报错。故不给自由数字输入, 只给选项。
 */
export const VIDEO_DURATIONS: ParamOption[] = [
  { value: '6', label: '6 秒' },
  { value: '10', label: '10 秒' },
];

/**
 * 视频分辨率 —— MiniMax v1 支持 720P / 1080P / 2K。
 */
export const VIDEO_RESOLUTIONS: ParamOption[] = [
  { value: '720P', label: '720P' },
  { value: '1080P', label: '1080P' },
  { value: '2K', label: '2K' },
];

/**
 * 视频运动幅度 —— 属于提示词语义, 但作为独立选项更易用。
 *
 * ⚠️ 这三项会拼进提示词文本, 不作为独立 API 字段传 (MiniMax v1 无此参数),
 * 故标为提示词片段而非参数。放在这里是因为它确实是"视频专属的选项"。
 */
export const VIDEO_MOTION_PRESETS: ParamOption[] = [
  { value: 'static', label: '静止（镜头不动）' },
  { value: 'slow', label: '缓慢运动' },
  { value: 'normal', label: '自然运动' },
  { value: 'dynamic', label: '剧烈运动' },
];

/** 视频提示词里的运动描述片段 (中文 → 英文短语, 模型对英文响应更稳) */
export const VIDEO_MOTION_TEXT: Record<string, string> = {
  static: 'static camera, no motion',
  slow: 'slow gentle motion',
  normal: 'natural smooth motion',
  dynamic: 'dynamic energetic motion',
};
