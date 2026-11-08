/**
 * AI 带货图文页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 页面只表达「提交什么」; 按张拆任务、扣费与退款都在服务端, 这里不做
 * 任何业务推算。
 *
 * 约定: `shoppable-carousel/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 */

/** 通用接口模块 (生成 / 提示词工具 / 幂等键 / 接口错误类型) */
export { ApiError, generateApi, newIdempotencyKey, promptToolsApi } from '../../lib/api';

/**
 * 模板清单接口。
 *
 * 模板数据的事实源在后端（与能力定义同域），前端不复制一份 ——
 * 两份清单漂移时，用户选中的模板会与后端查不到的那份对不上，
 * 表现为「版式不对但看不出原因」。
 */
export { shoppableCarouselApi } from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';

/** 素材读取 / 上传与地址换算: 提交前把跨项目输入复制到当前项目 */
export { assetsApi, assetSrc, assetThumbUrl, toAbsoluteUrl } from '../../lib/api';
export type { Asset } from '../../types/api';
export type { ShoppableCarouselTemplate, ShoppableCarouselTemplatesResult } from '../../types/api';
