/**
 * 图生视频页面的固定契约。
 *
 * 视频参数（运动幅度 / 时长 / 分辨率）及其选项**不在前端定义**：
 * 唯一事实源是后端 `/capabilities` 下发的 `params`，运营调整后页面自动跟随。
 * 这里只保留能力 id、参数 key 与下载文件名等页面级常量。
 */
export const IMAGE_TO_VIDEO_CAPABILITY = 'image_to_video';
export const PROMPT_PARAM_KEY = 'prompt';
export const VIDEO_DOWNLOAD_NAME = 'image-to-video.mp4';

/** 文本参数在控件层面的安全上限；后端未下发 maxLength 时仅用于避免误粘贴超长内容。 */
export const PROMPT_MAX_LENGTH = 800;

export type { CapabilityDef, CapabilityParam, CapabilityRuntime } from '../../types/api';
