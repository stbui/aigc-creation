import { Download, ListOrdered, Plus } from 'lucide-react';
import {
  AdminStaleError,
  Button,
  EmptyState,
  FilePick,
  Panel,
  SelectBox,
  TextInput,
} from './components';
import { formatRate, healthTone } from './utils';
import { CHANNEL_STATUS_OPTIONS, type ChannelHealthSummary } from './constants';
import type { AdminChannelView } from '../../../types/model';

interface ChannelListPanelProps {
  rows: AdminChannelView[];
  visible: AdminChannelView[];
  loading: boolean;
  error: string | null;
  hasFilters: boolean;
  keyword: string;
  status: string | undefined;
  selectedId: string | null;
  healthByChannel: Map<string, ChannelHealthSummary>;
  writable: boolean;
  importing: boolean;
  exporting: boolean;
  importFile: File | null;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: string | undefined) => void;
  onClearFilters: () => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onCreate: () => void;
  onExportAll: () => void;
  onPickImportFile: (file: File) => void;
  onClearImportFile: () => void;
  onImport: () => void;
  onReorder: () => void;
}

/**
 * 渠道工作台左列：渠道导航。
 *
 * 只负责「选哪条渠道」，260 足够放下名称 + 健康摘要；余量全部给右侧模型表。
 * 搜索与状态筛选都在本地过滤，切渠道只有一次点击。
 */
export function ChannelListPanel({
  rows,
  visible,
  loading,
  error,
  hasFilters,
  keyword,
  status,
  selectedId,
  healthByChannel,
  writable,
  importing,
  exporting,
  importFile,
  onKeywordChange,
  onStatusChange,
  onClearFilters,
  onSelect,
  onRetry,
  onCreate,
  onExportAll,
  onPickImportFile,
  onClearImportFile,
  onImport,
  onReorder,
}: ChannelListPanelProps) {
  return (
    <Panel
      title="渠道"
      note={hasFilters ? `${visible.length} / ${rows.length} 个` : `共 ${rows.length} 个`}
    >
      <div className="flex flex-col gap-2">
        {/* 新建与导入导出都在列表旁：这三件事的目的都是「让列表里多一条渠道」 */}
        <Button
          variant="primary"
          size="small"
          leadingIcon={Plus}
          className="w-full justify-center"
          disabled={!writable}
          onClick={onCreate}
        >
          新建渠道
        </Button>
        <div className="flex items-center gap-2">
          <FilePick
            file={importFile}
            accept="application/json,.json"
            onPick={onPickImportFile}
            onClear={onClearImportFile}
            disabled={!writable || importing}
            label="导入"
            hint="JSON"
          />
          <Button
            variant="secondary"
            size="small"
            leadingIcon={Download}
            className="ml-auto shrink-0"
            disabled={exporting || rows.length === 0}
            title="导出全部渠道，不含 API Key 等凭证"
            onClick={onExportAll}
          >
            {exporting ? '导出中…' : '导出全部'}
          </Button>
        </div>
        {importFile && (
          <Button
            variant="primary"
            size="small"
            className="w-full justify-center"
            disabled={importing || !writable}
            onClick={onImport}
          >
            {importing ? '导入中…' : '开始导入'}
          </Button>
        )}
        <TextInput
          ariaLabel="搜索渠道"
          value={keyword}
          onChange={onKeywordChange}
          placeholder="搜索渠道名或 Base URL"
          allowClear
        />
        <SelectBox
          ariaLabel="渠道状态"
          value={status}
          options={CHANNEL_STATUS_OPTIONS}
          placeholder="全部状态"
          allowClear
          onChange={onStatusChange}
        />

        {error && (
          <div className="py-2">
            <AdminStaleError error={error} onRetry={onRetry} />
          </div>
        )}

        <div className="flex max-h-[calc(100vh-420px)] flex-col gap-1 overflow-y-auto" aria-busy={loading}>
          {loading && rows.length === 0 && (
            <p className="py-6 text-center text-xs text-text-tertiary">加载中…</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <EmptyState
              title={hasFilters ? '没有匹配的渠道' : '还没有渠道'}
              description={
                hasFilters
                  ? '调整搜索词或状态筛选，或清除筛选查看全部渠道。'
                  : '新建渠道并导入模型后，C 端才会有可选模型。'
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="small" onClick={onClearFilters}>
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          )}
          {visible.map((row) => {
            const active = row.id === selectedId;
            const stats = healthByChannel.get(row.id);
            const rate = stats && stats.samples > 0 ? stats.success / stats.samples : null;
            const tone = healthTone(rate, stats?.samples ?? 0);
            return (
              <Button
                key={row.id}
                variant="ghost"
                size="small"
                data-testid="admin-channel-item"
                aria-pressed={active}
                aria-controls="admin-channel-detail"
                /*
                 * ghost 自带 accent-100 底色：这里必须用 `!` 压平，否则未选中项
                 * 与选中项同色，整列看起来都像选中。选中态只给浅底 + 内描边。
                 */
                className={`h-auto w-full justify-start whitespace-normal px-3 py-2.5 text-left !bg-transparent hover:!bg-background-secondary-default ${
                  active ? '!bg-accent-50 ring-1 ring-inset ring-accent-300 hover:!bg-accent-50' : ''
                }`}
                onClick={() => onSelect(row.id)}
              >
                <span className="flex w-full min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      data-testid="admin-channel-name"
                      className="truncate text-[13px] font-medium text-text-primary"
                    >
                      {row.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-text-tertiary">
                    {/* 状态用圆点：每行一颗绿色「启用」胶囊会把整列刷成绿色，异常项反而看不见 */}
                    <span className="inline-flex items-center gap-1">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          row.enabled ? 'bg-emerald-500' : 'bg-text-placeholder'
                        }`}
                        aria-hidden
                      />
                      {row.enabled ? '启用' : '停用'}
                    </span>
                    <span className="tabular-nums">{row.modelCosts?.length ?? 0} 个模型</span>
                    {rate !== null && (
                      <span
                        className={
                          tone === 'success'
                            ? 'text-emerald-600'
                            : tone === 'warn'
                              ? 'text-amber-600'
                              : 'text-rose-600'
                        }
                        title={`近 24 小时 ${stats!.samples} 次生成请求，成功 ${stats!.success} 次`}
                      >
                        {formatRate(rate)}
                      </span>
                    )}
                    {!row.hasApiKey && <span className="text-rose-600">未配置 Key</span>}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>

        <div className="border-t border-border-table pt-2">
          <Button
            variant="secondary"
            size="small"
            leadingIcon={ListOrdered}
            className="w-full"
            disabled={!writable}
            onClick={onReorder}
          >
            调整渠道顺序
          </Button>
        </div>
      </div>
    </Panel>
  );
}
