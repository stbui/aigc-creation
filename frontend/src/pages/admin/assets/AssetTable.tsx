import { useMemo } from 'react';
import {
  ActionButton,
  AdminDataTable,
  StatusTag,
  formatDateTime,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { AssetThumb } from './AssetThumb';
import { BACKEND_LABEL, type AssetRow } from './constants';
import { assetLabel, fmtBytes, fmtFormat, generationLine, thumbSrc } from './utils';
import type { AssetStatus } from '../../../types/api';

/**
 * 表格视图。
 *
 * 用来「查属性」：尺寸、格式、存储后端、所属用户都在列上，一页 20 行。
 * 列定义随视图一起下沉，页面只关心取数与批量动作。
 */
export function AssetTable({
  items,
  loading,
  error,
  page,
  pageSize,
  total,
  selected,
  selectable,
  statusBusyId,
  canHide,
  canDelete,
  hasFilter,
  onRetry,
  onResetFilters,
  onSelectedChange,
  onPreview,
  onToggleStatus,
  onDelete,
  onPageChange,
}: {
  items: AssetRow[];
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number;
  selected: string[];
  selectable: boolean;
  statusBusyId: string | null;
  canHide: boolean;
  canDelete: boolean;
  hasFilter: boolean;
  onRetry: () => void;
  onResetFilters: () => void;
  onSelectedChange: (ids: string[]) => void;
  onPreview: (id: string) => void;
  onToggleStatus: (row: AssetRow, next: AssetStatus) => void;
  onDelete: (row: AssetRow) => void;
  onPageChange: (page: number, pageSize?: number) => void;
}) {
  const columns: Array<AdminColumn<AssetRow>> = useMemo(
    () => [
      {
        key: 'thumb',
        title: '预览',
        width: 72,
        render: (row) => (
          <button
            type="button"
            className="block size-9 overflow-hidden rounded-md border border-border"
            title="查看大图"
            aria-label={`查看大图：${assetLabel(row)}`}
            onClick={() => onPreview(row.id)}
          >
            <AssetThumb
              className="size-full"
              src={thumbSrc(row.sourceUrl, 96)}
              alt={`${assetLabel(row)}缩略图`}
              format={row.format}
            />
          </button>
        ),
      },
      {
        key: 'kind',
        title: '类型',
        width: 80,
        render: (row) => (row.kind === 'original' ? '原始' : '生成'),
      },
      {
        key: 'capability',
        title: '能力',
        width: 130,
        cellTitle: (row) => row.capability ?? undefined,
        render: (row) => row.capability ?? <span className="text-muted-foreground">—</span>,
      },
      {
        key: 'generation',
        title: '模型 / 比例 / 画质',
        width: 180,
        cellTitle: (row) => (row.generation ? generationLine(row.generation) : undefined),
        render: (row) =>
          row.generation ? (
            <span className="block max-w-[170px] truncate text-[12px] leading-5">
              {generationLine(row.generation)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'dim',
        title: '尺寸',
        width: 110,
        render: (row) => (
          <span className="text-muted-foreground">
            {row.width && row.height ? `${row.width}×${row.height}` : '—'}
          </span>
        ),
      },
      {
        key: 'format',
        title: '格式',
        width: 68,
        render: (row) => <span className="text-muted-foreground">{fmtFormat(row.format)}</span>,
      },
      {
        key: 'sizeBytes',
        title: '大小',
        width: 80,
        align: 'right',
        render: (row) => <span className="tabular-nums">{fmtBytes(row.sizeBytes)}</span>,
      },
      {
        key: 'storageBackend',
        title: '存储',
        width: 90,
        render: (row) => BACKEND_LABEL[row.storageBackend] ?? row.storageBackend,
      },
      {
        key: 'ownerEmail',
        title: '所属用户',
        width: 190,
        cellTitle: (row) => row.ownerEmail,
        render: (row) => <span className="block max-w-[180px] truncate">{row.ownerEmail}</span>,
      },
      {
        key: 'projectName',
        title: '项目',
        width: 130,
        cellTitle: (row) => row.projectName,
        render: (row) => <span className="block max-w-[120px] truncate">{row.projectName}</span>,
      },
      {
        key: 'status',
        title: '状态',
        width: 80,
        // visible / hidden 不在 STATUS_META 里：素材语境下要读作「上架 / 下架」
        render: (row) => (
          <StatusTag
            status={row.status}
            label={row.status === 'visible' ? '已上架' : '已下架'}
            tone={row.status === 'visible' ? 'success' : 'warn'}
          />
        ),
      },
      {
        key: 'createdAt',
        title: '上传时间',
        /* 标题写「时间」就该给到分秒；只到日期的列在排序时看不出先后 */
        width: 170,
        render: (row) => formatDateTime(row.createdAt),
      },
      {
        key: 'ops',
        title: '',
        width: 130,
        fixed: 'right',
        render: (row) => (
          <div className="flex items-center gap-1">
            {canHide && (
              <ActionButton
                variant="ghost"
                size="sm"
                disabled={statusBusyId !== null}
                onClick={() => onToggleStatus(row, row.status === 'visible' ? 'hidden' : 'visible')}
              >
                {statusBusyId === row.id ? '处理中…' : row.status === 'visible' ? '下架' : '恢复'}
              </ActionButton>
            )}
            {canDelete && (
              <ActionButton variant="destructive" size="sm" onClick={() => onDelete(row)}>
                删除
              </ActionButton>
            )}
          </div>
        ),
      },
    ],
    [canDelete, canHide, onDelete, onPreview, onToggleStatus, statusBusyId],
  );

  return (
    <AdminDataTable<AssetRow>
      rows={items}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      onRetry={onRetry}
      minWidth={1480}
      rowClassName={(row) => (row.status === 'hidden' ? 'bg-warn-soft/40' : undefined)}
      selectable={selectable}
      selected={selected}
      onSelectedChange={onSelectedChange}
      emptyText={
        hasFilter
          ? '没有符合当前筛选条件的素材。清除筛选后可查看全部素材。'
          : '暂无素材。用户上传或生成图片后，会在这里出现。'
      }
      emptyAction={
        hasFilter ? (
          <ActionButton variant="secondary" onClick={onResetFilters}>
            清除筛选
          </ActionButton>
        ) : undefined
      }
      pagination={{
        current: page,
        pageSize,
        total,
        unit: '张',
        // 翻页必须清空选择：否则会对看不见的行执行批量下架/删除
        onChange: onPageChange,
      }}
    />
  );
}
