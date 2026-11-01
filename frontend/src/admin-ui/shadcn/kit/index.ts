/**
 * 整页换皮用的控件套件（shadcn 版）出口。
 *
 * 与 `admin-ui/shadcn/index.ts` 的分工：
 *   - `shadcn/index.ts` —— 新页面直接写，签名是新设计的；
 *   - `shadcn/kit` —— 把**既有页面**整页换观感，导出件与 BoardUI 版
 *     **同名同签名**，因此调用方只需换 import 来源，业务代码一行不动。
 *
 * 首个使用者是渠道工作台（`pages/admin/channels/components.ts`）。
 */
export * from './controls';
export * from './display';
export * from './overlay';
export * from './table';
export * from './dropdown';
