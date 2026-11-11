import {
  ActionButton,
  AdminDataTable,
  HelpTip,
  RowMenu,
  StatusTag,
  formatDate,
  type AdminColumn,
  type RowMenuItem,
} from '~/admin-ui/primitives';
import { contributionText } from './constants';
import type { PluginView } from '../../../types/model';

/**
 * 插件清单。
 *
 * 行内动作直显两颗（详情 / 启用停用），校验与卸载收进「更多」：四个动作平铺
 * 会把操作列撑到 200px，右侧固定列抢走正文宽度，运营反而看不出哪个插件更该
 * 处理。
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
            {/* 名称让位给两枚状态标签：名称过长时截断，标签固定不被挤出列外 */}
            <span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>
            <span className="flex shrink-0 items-center gap-1">
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
            </span>
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
      render: (row) => {
        /*
         * 只直显前两个：一个插件声明 8 个 provider 时，逐个平铺会把 180px 的列
         * 撑成 8 行竖排，整行高度从 58px 涨到 198px（同一张表里行高跳三倍）。
         * 余下的折成「+N」，悬停看全量与各自的注册状态。
         */
        if (row.providers.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }
        const shown = row.providers.slice(0, 2);
        const rest = row.providers.slice(2);
        return (
          <div className="flex flex-wrap items-center gap-1">
            {shown.map((provider) => (
              <StatusTag
                key={provider.id}
                status={provider.registered ? 'registered' : 'unregistered'}
                tone={provider.registered ? 'success' : 'muted'}
                label={provider.label || provider.id}
              />
            ))}
            {rest.length > 0 && (
              <HelpTip
                tip={rest
                  .map((provider) => `${provider.label || provider.id}${provider.registered ? '' : '（未注册）'}`)
                  .join('、')}
              >
                <StatusTag
                  status="more"
                  tone="muted"
                  label={`+${rest.length}`}
                />
              </HelpTip>
            )}
          </div>
        );
      },
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
              {formatDate(row.verify.checkedAt)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">未校验</span>
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (row) => {
        const moreItems: RowMenuItem[] = [
          {
            key: 'verify',
            label: '校验契约',
            disabled: busy === row.id,
            onSelect: () => onVerify(row),
          },
        ];
        if (row.removable) {
          moreItems.push({
            key: 'uninstall',
            label: '卸载插件',
            danger: true,
            separator: true,
            disabled: !writable || busy === row.id,
            onSelect: () => onUninstall(row),
          });
        }
        return (
          <div className="flex items-center gap-1">
            <ActionButton variant="ghost" size="sm" onClick={() => onDetail(row)}>
              详情
            </ActionButton>
            {/* 启用 / 停用是这页最高频的写操作，留在列上；校验与卸载收进「更多」 */}
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={!writable || busy === row.id}
              onClick={() => onToggle(row)}
            >
              {row.enabled ? '停用' : '启用'}
            </ActionButton>
            <RowMenu label={`插件 ${row.name} 更多操作`} items={moreItems} />
          </div>
        );
      },
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
