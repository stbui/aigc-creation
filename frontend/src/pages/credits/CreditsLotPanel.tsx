import type { CreditLot } from '../../types/api';
import {
  Pagination,
  StateButton,
  StateEmpty,
  StateError,
  StateSkeleton,
  Table,
  Tag,
} from './components';
import { LOT_STATUS, PAGE_SIZE, SOURCE_LABEL } from './constants';
import { formatDate } from './utils';
import { CreditsLotList } from './CreditsLotList';

interface CreditsLotPanelProps {
  lots: CreditLot[];
  initialLoading: boolean;
  error: string | null;
  narrow: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onGoPackages: () => void;
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
  onGoPackages,
}: CreditsLotPanelProps) {
  const columns = [
    {
      title: '来源',
      dataIndex: 'source',
      width: 130,
      render: (value: string) => SOURCE_LABEL[value] ?? value,
    },
    { title: '总额', dataIndex: 'totalCredits', width: 100, align: 'right' as const },
    { title: '剩余', dataIndex: 'remainingCredits', width: 100, align: 'right' as const },
    {
      title: '到期日',
      dataIndex: 'expireAt',
      width: 140,
      render: (value: string | null) => (value ? formatDate(value) : '永久'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: CreditLot['status']) => (
        // 不用预设色: 默认绿字在淡绿底上对比度不足, 状态色统一走 .credits-status
        <Tag variant="filled" className={`credits-status is-${value}`}>
          {LOT_STATUS[value] ?? LOT_STATUS.active}
        </Tag>
      ),
    },
  ];

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
      action={<StateButton onClick={onGoPackages}>去获取积分</StateButton>}
    />
  ) : narrow ? (
    <>
      <CreditsLotList rows={view} />
      {lots.length > PAGE_SIZE && (
        <div className="credits-mobile-pager">
          <Pagination
            simple
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={lots.length}
            onChange={onPageChange}
          />
        </div>
      )}
    </>
  ) : (
    <Table
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={lots}
      pagination={{
        current: page,
        pageSize: PAGE_SIZE,
        total: lots.length,
        hideOnSinglePage: true,
        onChange: onPageChange,
      }}
      scroll={{ x: 620 }}
    />
  );
}
