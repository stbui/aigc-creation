import { Link } from 'react-router-dom';
import type { CreditLedgerEntry } from '../../types/api';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem,
  StateButton,
  StateEmpty,
  StateError,
  StateSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components';
import { LEDGER_FILTER_OPTIONS, PAGE_SIZE, type LedgerFilter } from './constants';
import {
  formatDateTime,
  ledgerReference,
  ledgerRemark,
  ledgerTypeLabel,
  shortId,
} from './utils';
import { CreditsLedgerList } from './CreditsLedgerList';

interface CreditsLedgerPanelProps {
  /** 服务端分页返回的当前页流水 */
  rows: CreditLedgerEntry[];
  total: number;
  /** 整页首次加载（余额 + 流水 + 批次） */
  initialLoading: boolean;
  /** 仅流水翻页 / 筛选时的加载态 */
  tableLoading: boolean;
  error: string | null;
  filter: LedgerFilter;
  narrow: boolean;
  page: number;
  onFilterChange: (filter: LedgerFilter) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

/** 积分流水页签：筛选、加载 / 失败 / 空态、桌面表格与窄屏列表。 */
export function CreditsLedgerPanel({
  rows,
  total,
  initialLoading,
  tableLoading,
  error,
  filter,
  narrow,
  page,
  onFilterChange,
  onPageChange,
  onRetry,
}: CreditsLedgerPanelProps) {
  return (
    <>
      <div className="credits-ledger-toolbar">
        <Select
          value={filter}
          onValueChange={(value) => onFilterChange(value as LedgerFilter)}
          disabled={initialLoading || tableLoading}
        >
          <SelectTrigger
            aria-label={'筛选积分流水'}
          >
            <SelectValue placeholder={'请选择'} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LEDGER_FILTER_OPTIONS.map((option) => (
                <SelectItem key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {initialLoading ? (
        <StateSkeleton variant="row" count={5} />
      ) : error ? (
        <StateError
          title="积分流水加载失败"
          desc="没能取回当前筛选下的积分流水。可能是后端未启动或网络异常，重试一次即可。"
          onRetry={onRetry}
        />
      ) : rows.length === 0 ? (
        <StateEmpty
          compact
          title={filter === 'all' ? '还没有积分流水' : '当前筛选下没有流水'}
          desc={
            filter === 'all'
              ? '购买积分、开通会员或完成签到后，每一笔变动都会记录在这里。'
              : '可以切换筛选条件，查看其他类型的积分变动。'
          }
          action={
            filter === 'all' ? (
              <StateButton asChild>
                <Link to="/packages">去获取积分</Link>
              </StateButton>
            ) : undefined
          }
        />
      ) : narrow ? (
        <>
          <CreditsLedgerList rows={rows} />
          {total > PAGE_SIZE && (
            <div className="credits-mobile-pager">
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
                      第 {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => onPageChange(page + 1)}
                      aria-disabled={page >= Math.ceil(total / PAGE_SIZE)}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      ) : (
        <Table
          className={`min-w-[850px]${tableLoading ? ' pointer-events-none opacity-60' : ''}`}
          aria-busy={tableLoading || undefined}
        >
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>关联单据</TableHead>
              <TableHead className="text-right">变动</TableHead>
              <TableHead className="text-right">变动后余额</TableHead>
              <TableHead>备注</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const reference = ledgerReference(row);
              return (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>{ledgerTypeLabel(row)}</TableCell>
                  <TableCell className="max-w-[170px] truncate">
                    {reference ? (
                      <span title={reference.id}>
                        {reference.label} {shortId(reference.id)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`credits-amount ${row.amount >= 0 ? 'is-plus' : 'is-minus'}`}
                    >
                      {row.amount >= 0 ? `+${row.amount}` : row.amount}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{row.balanceAfter}</TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {ledgerRemark(row) ?? '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
