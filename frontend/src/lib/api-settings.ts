import { request } from './api';

/** 与后端 `SettingsService.uploadLimits()` 对齐的公开上传限制。 */
export interface PublicUploadLimits {
  maxSizeMb: number;
  maxBytes: number;
  maxPixels: number;
  /** 归一化后的扩展名列表，例如 `jpg,png,webp` */
  allowedTypes: string;
  allowedMimes: string[];
  allowedLabels: string[];
}

export interface PublicSettingsSnapshot {
  upload: PublicUploadLimits;
}

/** 上传限制保存成功后广播；已挂载的上传入口据此立即刷新。 */
export const UPLOAD_LIMITS_CHANGED_EVENT = 'upload-limits:changed';

export const publicSettingsApi = {
  /** 仅返回上传域，不携带支付、邮件等后台配置。 */
  read: () => request<PublicSettingsSnapshot>('/settings'),
};
