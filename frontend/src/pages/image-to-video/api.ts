/**
 * 图生视频页面的后端依赖面。
 *
 * 当前页面只复用共享上传接口产出的素材地址；能力清单与模型目录分别由
 * `hooks.ts` / `components.ts` 的共享 hooks、选择器读取，不在页面重复请求。
 */
export { assetThumbUrl } from '../../lib/api';
