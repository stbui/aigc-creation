import { ActionButton, AdminDataTable, StatusTag, type AdminColumn } from '~/admin-ui/primitives';
import type { ProviderCatalogEntry } from '../../../types/model';

/**
 * 服务商目录清单。
 *
 * 目录是插件包的上游清单；安装会下载包并走与上传安装同一套校验。
 */
export function CatalogTable({
  items,
  loading,
  error,
  writable,
  busy,
  onVerify,
  onInstall,
  onRetry,
}: {
  items: ProviderCatalogEntry[];
  loading: boolean;
  error: string | null;
  writable: boolean;
  busy: string | null;
  onVerify: (entry: ProviderCatalogEntry) => void;
  onInstall: (entry: ProviderCatalogEntry) => void;
  onRetry: () => void;
}) {
  const columns: Array<AdminColumn<ProviderCatalogEntry>> = [
    {
      key: 'name',
      title: '服务商',
      width: 220,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{row.name}</div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
            {row.id}
          </div>
        </div>
      ),
    },
    {
      key: 'vendor',
      title: '厂商',
      width: 120,
      render: (row) => <span className="text-muted-foreground">{row.vendor || '—'}</span>,
    },
    {
      key: 'version',
      title: '版本',
      width: 80,
      render: (row) => <span className="font-mono text-[12px]">v{row.version}</span>,
    },
    {
      key: 'endpoint',
      title: '接口',
      width: 280,
      render: (row) => (
        <div className="min-w-0 text-[12px]">
          <div className="text-muted-foreground">{row.apiFormat || '—'}</div>
          <div className="truncate font-mono text-muted-foreground" title={row.baseUrl}>
            {row.baseUrl || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'protocols',
      title: '协议',
      width: 200,
      render: (row) =>
        row.protocols.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="line-clamp-2 text-[12px] text-muted-foreground">
            {row.protocols.join(' · ')}
          </span>
        ),
    },
    {
      key: 'installed',
      title: '状态',
      width: 100,
      render: (row) =>
        row.installed ? (
          <StatusTag status="installed" tone="success" label="已安装" />
        ) : (
          <StatusTag status="not_installed" tone="muted" label="未安装" />
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton
            variant="ghost"
            size="sm"
            disabled={busy === `catalog:${row.id}`}
            onClick={() => onVerify(row)}
          >
            校验
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="sm"
            disabled={!writable || row.installed || busy === `catalog:${row.id}`}
            onClick={() => onInstall(row)}
          >
            {row.installed ? '已安装' : '安装'}
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <AdminDataTable<ProviderCatalogEntry>
      rows={items}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={items.length === 0 ? error : null}
      onRetry={onRetry}
      emptyText="目录为空。点「重新拉取」获取最新清单。"
      minWidth={1020}
    />
  );
}
