import { Pencil, Plus } from 'lucide-react';
import { ActionButton, EmptyState, Panel, RowMenu, StatusTag } from '~/admin-ui/primitives';
import { ChannelModelManager } from './ChannelModelManager';
import type { ProductConsumptionState } from './useProductConsumption';
import type { AdminChannelView } from '../../../types/model';

interface ChannelDetailPanelProps {
  selected: AdminChannelView | null;
  loading: boolean;
  error: string | null;
  hasFilters: boolean;
  writable: boolean;
  modelWritable: boolean;
  /** 是否可发起连通性测试（`channel.test` 权限） */
  canTest: boolean;
  saving: boolean;
  exporting: boolean;
  consumption: ProductConsumptionState;
  /** 新建供应商后自动打开上游导入 */
  autoUpstream: boolean;
  onAutoUpstreamConsumed: () => void;
  pendingModelId: string | null;
  onEdit: (channel: AdminChannelView) => void;
  onDuplicate: (channel: AdminChannelView) => void;
  onExport: (channel: AdminChannelView) => void;
  onToggle: (channel: AdminChannelView) => void;
  onDelete: (channel: AdminChannelView) => void;
  onCreate: () => void;
  onChanged: () => void;
  onFocusConsumed: () => void;
}

/** 供应商视图右侧：选中供应商的详情与商品管理 */
export function ChannelDetailPanel({
  selected,
  loading,
  error,
  hasFilters,
  writable,
  modelWritable,
  canTest,
  saving,
  exporting,
  consumption,
  autoUpstream,
  onAutoUpstreamConsumed,
  pendingModelId,
  onEdit,
  onDuplicate,
  onExport,
  onToggle,
  onDelete,
  onCreate,
  onChanged,
  onFocusConsumed,
}: ChannelDetailPanelProps) {
  return (
    <section
      id="admin-channel-detail"
      className="min-w-0"
      aria-label={selected ? `${selected.name} 的商品管理` : '商品管理'}
    >
      {selected ? (
        <Panel
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate" title={selected.name}>
                {selected.name}
              </span>
              <span className="shrink-0">
                <StatusTag
                  status={selected.enabled ? 'channel-enabled' : 'channel-disabled'}
                  tone={selected.enabled ? 'success' : 'muted'}
                  label={selected.enabled ? '供应商已启用' : '供应商已停用'}
                />
              </span>
            </span>
          }
          note={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 max-w-full truncate font-mono text-[12px]" title={selected.baseUrl}>
                {selected.baseUrl}
              </span>
              {!selected.hasApiKey && <span>访问凭证未配置</span>}
              {selected.hasApiKey && selected.hasSecretKey && <span>访问凭证与签名密钥已配置</span>}
              {selected.proxyUrl && <span className="font-mono">网络代理：{selected.proxyUrl}</span>}
              {selected.catalogProviderId && (
                <span>来源：服务商目录 · {selected.catalogProviderId}</span>
              )}
            </span>
          }
          extra={
            <div className="flex items-center gap-1">
              <ActionButton
                variant="ghost"
                size="xs"
                icon={Pencil}
                disabled={!writable || saving}
                onClick={() => onEdit(selected)}
              >
                编辑供应商
              </ActionButton>
              <RowMenu
                label={`供应商 ${selected.name} 更多操作`}
                items={[
                  {
                    key: 'duplicate',
                    label: '复制供应商',
                    disabled: !writable || saving,
                    onSelect: () => onDuplicate(selected),
                  },
                  {
                    key: 'export',
                    label: '导出配置（不含凭证）',
                    disabled: exporting,
                    onSelect: () => onExport(selected),
                  },
                  {
                    key: 'toggle',
                    label: selected.enabled ? '停用供应商' : '启用供应商',
                    disabled: !writable || saving,
                    danger: selected.enabled,
                    onSelect: () => onToggle(selected),
                  },
                  {
                    key: 'delete',
                    label: '删除供应商',
                    disabled: !writable || saving,
                    danger: true,
                    separator: true,
                    onSelect: () => onDelete(selected),
                  },
                ]}
              />
            </div>
          }
        >
          <ChannelModelManager
            key={selected.id}
            channel={selected}
            writable={modelWritable}
            canTest={canTest}
            consumption={consumption}
            autoFetchUpstream={autoUpstream}
            onAutoFetchConsumed={onAutoUpstreamConsumed}
            onChanged={onChanged}
            focusModelId={pendingModelId}
            onFocusConsumed={onFocusConsumed}
          />
        </Panel>
      ) : (
        <Panel title="供应商详情">
          <EmptyState
            title={
              loading
                ? '正在加载供应商'
                : error
                  ? '暂时无法读取供应商'
                  : hasFilters
                    ? '没有匹配的供应商'
                    : '请选择供应商'
            }
            action={
              !hasFilters && !loading && !error ? (
                <ActionButton variant="default" size="sm" icon={Plus} disabled={!writable} onClick={onCreate}>
                  接入供应商
                </ActionButton>
              ) : undefined
            }
          />
        </Panel>
      )}
    </section>
  );
}
