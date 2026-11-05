import { Copy, Download, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { ActionButton, EmptyState, Panel, StatusTag } from '~/admin-ui/primitives';
import { ChannelModelManager } from './ChannelModelManager';
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

/** 渠道工作台右侧：选中渠道的详情与模型管理 */
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
      aria-label={selected ? `${selected.name} 的模型管理` : '渠道模型管理'}
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
                  label={selected.enabled ? '渠道已启用' : '渠道已停用'}
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
                variant="secondary"
                size="xs"
                icon={Pencil}
                disabled={!writable || saving}
                onClick={() => onEdit(selected)}
              >
                编辑
              </ActionButton>
              <ActionButton
                variant="ghost"
                size="xs"
                className="hover:bg-muted"
                icon={Copy}
                disabled={!writable || saving}
                onClick={() => onDuplicate(selected)}
              >
                复制
              </ActionButton>
              <span title="导出该渠道（不含凭证）">
                <ActionButton
                  variant="ghost"
                  size="xs"
                  className="hover:bg-muted"
                  icon={Download}
                  disabled={exporting}
                  onClick={() => onExport(selected)}
                >
                  导出
                </ActionButton>
              </span>
              <ActionButton
                variant="ghost"
                size="xs"
                className={
                  selected.enabled
                    ? 'text-danger-text hover:text-danger-text'
                    : 'hover:bg-muted'
                }
                icon={Power}
                disabled={!writable || saving}
                onClick={() => onToggle(selected)}
              >
                {selected.enabled ? '停用渠道' : '启用渠道'}
              </ActionButton>
              <ActionButton
                variant="ghost"
                size="xs"
                className="text-danger-text hover:text-danger-text"
                icon={Trash2}
                disabled={!writable || saving}
                onClick={() => onDelete(selected)}
              >
                删除
              </ActionButton>
            </div>
          }
        >
          <ChannelModelManager
            key={selected.id}
            channel={selected}
            writable={modelWritable}
            canTest={canTest}
            onChanged={onChanged}
            focusModelId={pendingModelId}
            onFocusConsumed={onFocusConsumed}
          />
        </Panel>
      ) : (
        <Panel title="渠道详情">
          <EmptyState
            title={
              loading
                ? '正在加载渠道'
                : error
                  ? '暂时无法读取渠道'
                  : hasFilters
                    ? '没有匹配的渠道'
                    : '请选择渠道'
            }
            action={
              !hasFilters && !loading && !error ? (
                <ActionButton variant="default" size="sm" icon={Plus} disabled={!writable} onClick={onCreate}>
                  新建渠道
                </ActionButton>
              ) : undefined
            }
          />
        </Panel>
      )}
    </section>
  );
}
