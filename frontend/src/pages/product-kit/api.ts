/**
 * 商品主图工作台页面的后端接口面 —— 目录内文件的唯一 API 入口。
 *
 * 页面只表达「提交什么」; 按变体拆任务、扣费与退款都在服务端, 这里不做
 * 任何业务推算。
 *
 * 约定: `product-kit/` 下的文件不从 `lib/api` / `lib/models` 直接取东西,
 * 一律经由本文件转出 —— 一个页面的后端依赖集中可见, 换实现只改一处。
 * 目录内新增调用时在这里补一行 re-export。
 */

/** 通用接口模块 (生成 / 提示词工具 / 幂等键) */
export { generateApi, newIdempotencyKey, promptToolsApi } from '../../lib/api';

/** 前台模型目录数据层: 建任务必须解析出 `logicalModelId` */
export { resolveModelId } from '../../lib/models';
