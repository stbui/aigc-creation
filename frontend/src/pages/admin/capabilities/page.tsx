/**
 * 能力与模型已合并为同一工作台。
 *
 * 保留 `AdminCapabilitiesPage` 这个页面出口，后台路由与既有测试无需感知
 * 实现文件从 capabilities 目录迁到了 logical-models 目录。
 */
export { AdminLogicalModelsPage as AdminCapabilitiesPage } from '../logical-models';
