import { Link } from 'react-router-dom';
import type { CreditLot } from '../../types/api';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  StateButton,
  StateEmpty,
  StateError,
  StateSkeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components';
import { LOT_STATUS, LOT_STATUS_TONE, PAGE_SIZE, SOURCE_LABEL } from './constants';
import { formatDate, shortId } from './utils';
import { CreditsLotList } from './CreditsLotList';

interface CreditsLotPanelProps {
  lots: CreditLot[];
  initialLoading: boolean;
  error: string | null;
  narrow: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

/** 批次明细页签：桌面表格与窄屏列表（批次一次取回后前端分页）。 */
export function CreditsLotPanel({
  lots,
  initialLoading,
  error,
  narrow,
  page,
  onPageChange,
  onRetry,
}: CreditsLotPanelProps) {
  const view = lots.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return initialLoading ? (
    <StateSkeleton variant="row" count={3} />
  ) : error ? (
    <StateError
      title="积分数据加载失败"
      desc="没能取回积分批次。可能是后端未启动或网络异常，重试一次即可。"
      onRetry={onRetry}
    />
  ) : lots.length === 0 ? (
    <StateEmpty
      compact
      title="还没有积分批次"
      desc="每次购买或发放都会形成一个有有效期的积分批次。"
      action={
        <StateButton asChild>
          <Link to="/packages">去获取积分</Link>
        </StateButton>
      }
    />
  ) : narrow ? (
    <>
      <CreditsLotList rows={view} />
      {lots.length > PAGE_SIZE && (
        <div className="flex justify-center pt-3">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  aria-disabled={page <= 1}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-2 text-xs text-muted-foreground">
                  第 {page} / {Math.max(1, Math.ceil(lots.length / PAGE_SIZE))} 页
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(page + 1)}
                  aria-disabled={page >= Math.ceil(lots.length / PAGE_SIZE)}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </>
  ) : (
    <Table className="min-w-[850px]">
      <TableHeader>
        <TableRow>
          <TableHead>来源</TableHead>
          <TableHead>发放时间</TableHead>
          <TableHead>关联订单</TableHead>
          <TableHead className="text-right">总额</TableHead>
          <TableHead className="text-right">剩余</TableHead>
          <TableHead>到期日</TableHead>
          <TableHead>状态</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lots.map((lot) => (
          <TableRow key={lot.id}>
            <TableCell>{SOURCE_LABEL[lot.source] ?? lot.source}</TableCell>
            <TableCell>{formatDate(lot.createdAt)}</TableCell>
            <TableCell className="max-w-[130px] truncate">
              {lot.orderId ? <span title={lot.orderId}>{shortId(lot.orderId)}</span> : '—'}
            </TableCell>
            <TableCell className="text-right">{lot.totalCredits}</TableCell>
            <TableCell className="text-right">{lot.remainingCredits}</TableCell>
            <TableCell>{lot.expireAt ? formatDate(lot.expireAt) : '永久'}</TableCell>
            <TableCell>
              {/* 不用预设色: 默认绿字在淡绿底上对比度不足, 状态色统一走 LOT_STATUS_TONE */}
              <StatusBadge
                variant="secondary"
                className={`h-[22px] rounded-full border-0 px-2 text-xs font-medium ${LOT_STATUS_TONE[lot.status]}`}
              >
                {LOT_STATUS[lot.status] ?? LOT_STATUS.active}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
