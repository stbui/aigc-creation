/**
 * 通用工具页的接口入口 —— 目录内文件的唯一外部接口来源。
 */

/** 上传 / 建任务 / 幂等键 / 接口错误类型 / 素材地址换算 */
export {
  ApiError,
  assetSrc,
  assetThumbSrc,
  assetsApi,
  generateApi,
  newIdempotencyKey,
} from '../../lib/api';

/** 前台模型目录数据层：建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';
