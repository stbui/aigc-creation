import type { CreditLedgerEntry } from '../../types/api';
import {
  Pagination,
  Select,
  StateButton,
  StateEmpty,
  StateError,
  StateSkeleton,
  Table,
} from './components';
import {
  LEDGER_FILTER_OPTIONS,
  LEDGER_LABEL,
  PAGE_SIZE,
  type LedgerFilter,
} from './constants';
import { formatDateTime, ledgerReference, ledgerRemark, shortId } from './utils';
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
  onGoPackages: () => void;
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
  onGoPackages,
}: CreditsLedgerPanelProps) {
  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (value: string) => LEDGER_LABEL[value] ?? value,
    },
    {
      // 关联单据三选一（账单 / 支付订单 / 生成任务）；短 ID 可读，完整 id 放 title
      title: '关联单据',
      key: 'reference',
      width: 170,
      ellipsis: true,
      render: (_value: unknown, row: CreditLedgerEntry) => {
        const reference = ledgerReference(row);
        if (!reference) return '—';
        return (
          <span title={reference.id}>
            {reference.label} {shortId(reference.id)}
          </span>
        );
      },
    },
    {
      title: '变动',
      dataIndex: 'amount',
      width: 110,
      align: 'right' as const,
      render: (value: number) => (
        <span className={`credits-amount ${value >= 0 ? 'is-plus' : 'is-minus'}`}>
          {value >= 0 ? `+${value}` : value}
        </span>
      ),
    },
    {
      // 这是该笔变动**发生当时**的快照, 不等于当前余额；
      // 列名叫「余额」会让用户拿它和顶部的余额对照, 误以为账错了。
      title: '变动后余额',
      dataIndex: 'balanceAfter',
      width: 110,
      align: 'right' as const,
    },
    {
      title: '备注',
      dataIndex: 'reason',
      ellipsis: true,
      /*
       * 后台人工调整的 reason 是运营填写的内部备注，可能含工单号、客服姓名。
       * C 端只展示枚举文案，不把内部原文透出给用户。
       */
      render: (_value: string | null, row: CreditLedgerEntry) => ledgerRemark(row) ?? '—',
    },
  ];

  return (
    <>
      <div className="credits-ledger-toolbar">
        <Select
          value={filter}
          onChange={(value) => onFilterChange(value as LedgerFilter)}
          options={LEDGER_FILTER_OPTIONS}
          disabled={initialLoading || tableLoading}
          aria-label="筛选积分流水"
        />
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
            filter === 'all' ? <StateButton onClick={onGoPackages}>去获取积分</StateButton> : undefined
          }
        />
      ) : narrow ? (
        <>
          <CreditsLedgerList rows={rows} />
          {total > PAGE_SIZE && (
            <div className="credits-mobile-pager">
              <Pagination
                simple
                size="small"
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                onChange={onPageChange}
              />
            </div>
          )}
        </>
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={tableLoading}
          columns={columns}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            hideOnSinglePage: true,
            onChange: onPageChange,
          }}
          scroll={{ x: 850 }}
        />
      )}
    </>
  );
}
