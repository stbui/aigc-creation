import { ShieldCheck } from 'lucide-react';
import {
  ActionButton,
  AdminDataTable,
  HelpTip,
  StatusTag,
  type AdminColumn,
} from './components';
import { contributionText } from './constants';
import type { PluginView } from '../../../types/model';

/**
 * 插件清单。
 *
 * 行内动作用 ghost 按钮：一列四颗实心按钮会盖过状态列，运营反而看不出
 * 哪个插件更该处理。
 */
export function PluginTable({
  items,
  loading,
  error,
  writable,
  busy,
  onDetail,
  onVerify,
  onToggle,
  onUninstall,
  onRetry,
}: {
  items: PluginView[];
  loading: boolean;
  error: string | null;
  writable: boolean;
  busy: string | null;
  onDetail: (row: PluginView) => void;
  onVerify: (row: PluginView) => void;
  onToggle: (row: PluginView) => void;
  onUninstall: (row: PluginView) => void;
  onRetry: () => void;
}) {
  const columns: Array<AdminColumn<PluginView>> = [
    {
      key: 'name',
      title: '插件',
      width: 240,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{row.name}</span>
            {row.enabled ? (
              <StatusTag status="enabled" tone="success" label="启用" />
            ) : (
              <StatusTag status="disabled" tone="muted" label="停用" />
            )}
            <StatusTag
              status={row.origin}
              tone={row.origin === 'installed' ? 'brand' : 'muted'}
              label={row.origin === 'installed' ? '上传' : '内置'}
            />
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
            {row.id} · v{row.version}
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
      key: 'protocols',
      title: '协议生效',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.activeProtocols}</span>,
    },
    {
      key: 'availability',
      title: '当前环境',
      width: 150,
      render: (row) =>
        row.availability?.available ? (
          <StatusTag status="available" tone="success" label="可用" />
        ) : (
          <HelpTip tip={row.availability?.reason || '当前环境不可用'}>
            <StatusTag status="unavailable" tone="warn" label="不可用" />
          </HelpTip>
        ),
    },
    {
      key: 'providers',
      title: 'Provider',
      width: 180,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.providers.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            row.providers.map((provider) => (
              <StatusTag
                key={provider.id}
                status={provider.registered ? 'registered' : 'unregistered'}
                tone={provider.registered ? 'success' : 'muted'}
                label={provider.label || provider.id}
              />
            ))
          )}
        </div>
      ),
    },
    {
      key: 'contributions',
      title: '贡献',
      render: (row) => (
        <span className="line-clamp-2 text-[12px] text-muted-foreground">
          {contributionText(row)}
        </span>
      ),
    },
    {
      key: 'verify',
      title: '契约校验',
      width: 130,
      render: (row) =>
        row.verify ? (
          <div className="flex flex-col gap-0.5 text-[12px]">
            {row.verify.ok ? (
              <StatusTag status="ok" tone="success" label="通过" />
            ) : (
              <StatusTag status="fail" tone="danger" label="未通过" />
            )}
            <span className="tabular-nums text-muted-foreground">
              {new Date(row.verify.checkedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">未校验</span>
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="xs" onClick={() => onDetail(row)}>
            详情
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={ShieldCheck}
            disabled={busy === row.id}
            onClick={() => onVerify(row)}
          >
            校验
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={!writable || busy === row.id}
            onClick={() => onToggle(row)}
          >
            {row.enabled ? '停用' : '启用'}
          </ActionButton>
          {row.removable && (
            <ActionButton
              variant="ghost"
              size="xs"
              className="text-danger-text hover:text-danger-text"
              disabled={!writable || busy === row.id}
              onClick={() => onUninstall(row)}
            >
              卸载
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <AdminDataTable<PluginView>
      rows={items}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={items.length === 0 ? error : null}
      onRetry={onRetry}
      emptyText="没有任何插件。内置插件随代码入库，缺失时协议注册表为空。"
      minWidth={1180}
    />
  );
}
