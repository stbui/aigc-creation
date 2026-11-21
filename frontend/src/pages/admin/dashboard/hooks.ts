/**
 * 平台概览目录的外部 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 * 新增外部 hook / provider 引用时在这里补一行 re-export。
 */
export { useAdmin } from '../../../context/AdminContext';
export { useAdminWorkbench } from '../../../components/admin/WorkbenchContext';
export { useAdminResource } from '~/admin-ui/radar';
