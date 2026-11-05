import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Download, FileJson, ListOrdered, Plus, X } from 'lucide-react';
import {
  StaleError,
  ActionButton,
  ClearableField,
  EmptyState,
  FilePicker,
  IconButton,
  Panel,
  SelectField,
} from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';
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
 * 只负责「选哪条渠道」，224 足够放下名称 + 健康摘要；余量全部给右侧模型表。
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
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // 深链打开或键盘移动选中项时，只在目标不在视口内才滚动，避免普通点击抢滚动
  useEffect(() => {
    const node = activeRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId, visible]);

  const handleChannelKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, visible.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visible.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    onSelect(visible[nextIndex].id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[data-testid="admin-channel-item"]',
    );
    buttons?.[nextIndex]?.focus();
  };

  return (
    <Panel
      title={
        <span className="flex items-baseline gap-2">
          渠道
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {hasFilters ? `${visible.length} / ${rows.length} 个` : `共 ${rows.length} 个`}
          </span>
        </span>
      }
      extra={
        <div className="flex items-center gap-0.5">
          <FilePicker
            compact
            file={importFile}
            accept="application/json,.json"
            onPick={onPickImportFile}
            onClear={onClearImportFile}
            disabled={!writable || importing}
            label="导入渠道"
            hint="渠道导出文件"
          />
          <IconButton
            icon={Download}
            size="xs"
            label="导出全部渠道"
            disabled={exporting || rows.length === 0}
            onClick={onExportAll}
          />
          <IconButton
            icon={ListOrdered}
            size="xs"
            label="调整渠道顺序"
            disabled={!writable}
            onClick={onReorder}
          />
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {/* 新建与导入导出都在列表旁：这三件事的目的都是「让列表里多一条渠道」 */}
        <ActionButton
          variant="default"
          size="sm"
          icon={Plus}
          className="w-full justify-center"
          disabled={!writable}
          onClick={onCreate}
        >
          新建渠道
        </ActionButton>
        {importFile && (
          <div className="rounded-md border border-border bg-muted/50 p-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              <FileJson className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground" title={importFile.name}>
                {importFile.name}
              </span>
              <IconButton
                icon={X}
                size="xs"
                label="移除已选文件"
                disabled={importing}
                onClick={onClearImportFile}
              />
            </div>
            <ActionButton
              variant="default"
              size="sm"
              className="mt-2 w-full justify-center"
              disabled={importing || !writable}
              onClick={onImport}
            >
              {importing ? '导入中…' : '开始导入'}
            </ActionButton>
          </div>
        )}
        <ClearableField
          ariaLabel="搜索渠道"
          value={keyword}
          onChange={onKeywordChange}
          placeholder="搜索渠道名称或服务地址"
        />
        <SelectField
          ariaLabel="渠道状态"
          value={status}
          options={CHANNEL_STATUS_OPTIONS}
          placeholder="全部状态"
          clearLabel="全部状态"
          allowClear
          onChange={onStatusChange}
        />

        {error && (
          <div className="py-2">
            <StaleError error={error} onRetry={onRetry} />
          </div>
        )}

        {/*
         * 列表跟随页面滚动，不设内部滚动区。
         *
         * 原先写 `max-h-[calc(100vh-420px)]` + `overflow-y-auto`：那个魔法数把
         * 「顶栏 + 页头 + 视图切换 + 按钮组」的高度硬编码进来，其中任何一块
         * 改高（或浏览器放大字号）都会让列表底边错位；且它视口变高时不跟随
         * 增长（900px 以上恒为 316px），长列表仍要在小窗里滚两次。
         *
         * 外壳内容区 `.adm-content` 是页面级滚动；工作台只把左列容器设为 sticky，
         * 让右侧长内容滚动时仍能换渠道。列表自身保持自然高度，不与页面抢滚动。
         */}
        <div className="flex flex-col gap-0.5" aria-busy={loading}>
          {loading && rows.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <EmptyState
              title={hasFilters ? '没有匹配的渠道' : '暂无渠道'}
              action={
                hasFilters ? (
                  <ActionButton variant="secondary" size="sm" onClick={onClearFilters}>
                    清除筛选
                  </ActionButton>
                ) : undefined
              }
            />
          )}
          {visible.map((row, index) => {
            const active = row.id === selectedId;
            const stats = healthByChannel.get(row.id);
            const rate = stats && stats.samples > 0 ? stats.success / stats.samples : null;
            const tone = healthTone(rate, stats?.samples ?? 0);
            return (
              <button
                key={row.id}
                type="button"
                data-testid="admin-channel-item"
                aria-pressed={active}
                aria-controls="admin-channel-detail"
                title={`${row.name}\n${row.baseUrl}`}
                /*
                 * 未选中项保持透明，选中态只给浅底 + 内描边；两者必须区分开，
                 * 否则整列看起来都像选中。
                 */
                className={cn(
                  'h-auto w-full rounded-lg px-2.5 py-2 text-left whitespace-normal hover:bg-muted',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  active && 'bg-accent ring-1 ring-inset ring-brand/30 hover:bg-accent',
                )}
                onClick={() => onSelect(row.id)}
                onKeyDown={(event) => handleChannelKeyDown(event, index)}
                ref={active ? activeRef : undefined}
              >
                <span className="flex w-full min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      data-testid="admin-channel-name"
                      className="truncate text-[13px] font-medium text-foreground"
                    >
                      {row.name}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    {/* 状态用圆点：每行一颗绿色「启用」胶囊会把整列刷成绿色，异常项反而看不见 */}
                    <span className="inline-flex items-center gap-1">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          row.enabled ? 'bg-success-text' : 'bg-muted-foreground'
                        }`}
                        aria-hidden
                      />
                      {row.enabled ? '渠道启用' : '渠道停用'}
                    </span>
                    <span className="tabular-nums">{row.modelCosts?.length ?? 0} 个模型</span>
                    {rate !== null && (
                      <span
                        className={
                          tone === 'success'
                            ? 'text-success-text'
                            : tone === 'warn'
                              ? 'text-warn-text'
                              : 'text-danger-text'
                        }
                        title={`近 24 小时 ${stats?.samples ?? 0} 次生成请求，成功 ${stats?.success ?? 0} 次`}
                      >
                        {formatRate(rate)}
                      </span>
                    )}
                    {!row.hasApiKey && <span className="text-danger-text">未配置访问凭证</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

      </div>
    </Panel>
  );
}
