import { Download, RefreshCw } from 'lucide-react';

import { ActionButton } from './form';

type ActionVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ActionSize = 'xs' | 'sm' | 'default';

interface ActionButtonStyleProps {
  variant?: ActionVariant;
  size?: ActionSize;
  className?: string;
  ariaLabel?: string;
}

export interface ExportCsvButtonProps extends ActionButtonStyleProps {
  /** 导出请求；同步或异步均可，错误由调用方的导出 hook 统一处理。 */
  onExport: () => void | Promise<void>;
  /** 导出进行中：同时禁用按钮并切换文案，避免重复触发。 */
  exporting?: boolean;
  disabled?: boolean;
  label?: string;
  exportingLabel?: string;
}

/**
 * 后台统一的 CSV 导出按钮。
 *
 * 后台多数列表都要「带当前筛选条件导出」，此前每个页面都重复一遍
 * `Download` 图标、`导出中…` 文案与禁用逻辑。这里只收口展示形态；
 * 请求参数、单飞保护与 toast 仍由 `useAdminExport` 负责。
 */
export function ExportCsvButton({
  onExport,
  exporting = false,
  disabled = false,
  label = '导出 CSV',
  exportingLabel = '导出中…',
  variant = 'secondary',
  size = 'sm',
  className,
  ariaLabel,
}: ExportCsvButtonProps) {
  return (
    <ActionButton
      variant={variant}
      size={size}
      icon={Download}
      disabled={disabled || exporting}
      ariaLabel={ariaLabel}
      className={className}
      onClick={() => void onExport()}
    >
      {exporting ? exportingLabel : label}
    </ActionButton>
  );
}

export interface RefreshButtonProps extends ActionButtonStyleProps {
  /** 重新拉取当前视图的数据；同步或异步均可。 */
  onRefresh?: () => void | Promise<void>;
  /** 请求进行中：禁用按钮并显示「刷新中…」。 */
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  loadingLabel?: string;
}

/**
 * 后台统一的刷新按钮。
 *
 * 刷新在概览、任务、财务、存储等页面反复出现；统一图标与忙碌文案后，
 * 页面只需要关心「重拉哪个资源」，不再各自维护按钮细节。
 */
export function RefreshButton({
  onRefresh,
  loading = false,
  disabled = false,
  label = '刷新',
  loadingLabel = '刷新中…',
  variant = 'secondary',
  size = 'sm',
  className,
  ariaLabel,
}: RefreshButtonProps) {
  return (
    <ActionButton
      variant={variant}
      size={size}
      icon={RefreshCw}
      disabled={disabled || loading}
      ariaLabel={ariaLabel}
      className={className}
      onClick={onRefresh ? () => void onRefresh() : undefined}
    >
      {loading ? loadingLabel : label}
    </ActionButton>
  );
}
