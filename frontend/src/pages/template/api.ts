/**
 * 写真模板页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 页面只表达「提交什么」；模板提示词查回、扣费与退款都在服务端。
 *
 * 约定：`template/` 下的文件不从 `lib/api` / `lib/models` 直接取东西，
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见，换实现只改一处。
 */

/** 通用接口模块 (生成 / 幂等键 / 接口错误类型) */
export { ApiError, generateApi, newIdempotencyKey } from '../../lib/api';

/** 模板清单接口；模板事实源在后端，前端不复制清单 */
export { templateApi } from '../../lib/api';

/** 前台模型目录数据层：建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';

export type { PortraitTemplate, PortraitTemplatesResult } from '../../types/api';
