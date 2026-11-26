import { request } from "./api";
import { formDataWithFile } from "./http";

import type { AdminSystemPerformance } from "../types/admin-performance";
import type {
  AdminAigcLabel,
  AdminSettingImageUpload,
  AdminSettings,
  AdminSettingsUpdatePayload,
  AdminSettingsUpdateResult,
  AigcLabelSpec,
} from "../types/api";

/** 系统设置 (扁平结构提交, 字段名见后端 FIELD_TO_SETTING_KEY) */
export const adminSettingsApi = {
  read: () => request<AdminSettings>("/admin/settings"),
  uploadImage: (file: File) => request<AdminSettingImageUpload>("/admin/settings/upload", { method: "POST", body: formDataWithFile("file", file) }),
  update: (payload: AdminSettingsUpdatePayload) =>
    request<AdminSettingsUpdateResult>("/admin/settings", { method: "PATCH", body: payload }),
};

/**
 * 系统信息快照（只读）。
 *
 * 与系统设置分家走独立端点：设置接口的职责是读写运行时配置，把宿主机 /
 * 数据库元信息 / 调用耗时塞进去会让「保存设置」与「采集指标」互相拖累。
 */
export const adminSystemPerformanceApi = {
  read: () => request<AdminSystemPerformance>("/admin/system-performance"),
};

/**
 * AIGC 可见角标样式。
 *
 * `badgePngBase64` 由后台页面用 Canvas 按 spec 渲染，服务端只负责合成。
 * 两者一起提交的原因见后端 `AigcLabelService.save`：分两次写会出现
 * 「文案已改、图上还是旧字」的中间态。
 */
export const adminAigcLabelApi = {
  read: () => request<AdminAigcLabel>("/admin/aigc-label"),
  update: (payload: { spec: AigcLabelSpec; badgePngBase64: string }) =>
    request<AdminAigcLabel>("/admin/aigc-label", {
      method: "PUT",
      body: payload,
    }),
};
