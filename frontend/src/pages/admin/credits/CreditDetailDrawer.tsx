import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDataTable,
  Descriptions,
  DetailSection,
  Drawer,
  EmptyState,
  FilterActions,
  FilterBar,
  FormField,
  ListError,
  SelectField,
  SkeletonBody,
  StaleError,
  TextField,
  type AdminColumn,
} from './components';
import { LEDGER_LABELS, LEDGER_OPTIONS, SOURCE_LABELS } from './constants';
import { useCreditDetail, useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { adminCreditsApi } from './api';
import {
  adminOrderHref,
  adminTasksHref,
  adminUserDetailHref,
  cn,
  fmtTime,
  signed,
} from './utils';
import type {
  AdminCreditLedgerRow,
  AdminCreditLotRow,
  AdminCreditRow,
} from '../../../types/api';

/**
 * 单用户明细: 批次 + 流水 + 单条调整。
 *
 * 独立组件而不是把状态塞进页面: 抽屉的批次/流水是「随用户切换而重拉」的数据,
 * 与列表的分页状态生命周期完全不同, 混在一起会让列表重新渲染时抽屉闪一下。
 */
export function CreditDetailDrawer({
  user,
  writable,
  onClose,
  onChanged,
}: {
  user: AdminCreditRow;
  writable: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState<string | undefined>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [validDays, setValidDays] = useState('');

  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useCreditDetail(user.userId, { type, from, to });
  const lots = data?.[0] ?? [];
  const ledger = data?.[1] ?? [];

  const parsedDelta = Number(delta);
  const deltaValid = Number.isInteger(parsedDelta) && parsedDelta !== 0;
  const adjustmentDirty = Boolean(delta.trim() || reason.trim() || validDays.trim());
  useUnsavedGuard(adjustmentDirty);
  const requestClose = useDiscardConfirm(adjustmentDirty, onClose);

  const submitAdjust = async () => {
    if (!deltaValid) {
      toast.warning('变动量必须是非零整数，正数增加、负数扣减');
      return;
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.warning('请填写调整原因');
      return;
    }
    setBusy(true);
    try {
      const r = await adminCreditsApi.adjust({
        userId: user.userId,
        delta: parsedDelta,
        reason: trimmed,
        ...(validDays.trim() ? { validDays: Number(validDays) } : {}),
      });
      toast.success(`已调整 ${signed(parsedDelta)} 积分，当前余额 ${r.balance}`);
      setDelta('');
      setReason('');
      setValidDays('');
      void reload({ silent: true });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '调整失败');
    } finally {
      setBusy(false);
    }
  };

  const lotColumns: Array<AdminColumn<AdminCreditLotRow>> = [
    {
      key: 'source',
      title: '来源',
      width: 100,
      render: (row) => <span className="text-xs">{SOURCE_LABELS[row.source] ?? row.source}</span>,
    },
    {
      key: 'amount',
      title: '剩余 / 总量',
      width: 140,
      render: (row) => (
        <span className="tabular-nums text-xs">
          {row.remainingCredits} / {row.totalCredits}
        </span>
      ),
    },
    {
      key: 'expireAt',
      title: '到期',
      width: 170,
      render: (row) =>
        row.expireAt ? (
          <span className="text-[12px] text-muted-foreground">{fmtTime(row.expireAt)}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">永久</span>
        ),
    },
    {
      key: 'createdAt',
      title: '创建时间',
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">{fmtTime(row.createdAt)}</span>
      ),
    },
  ];

  const ledgerColumns: Array<AdminColumn<AdminCreditLedgerRow>> = [
    {
      key: 'createdAt',
      title: '时间',
      width: 170,
      render: (row) => (
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {fmtTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'type',
      title: '类型',
      width: 110,
      render: (row) => <span className="text-xs">{LEDGER_LABELS[row.type] ?? row.type}</span>,
    },
    {
      key: 'amount',
      title: '变动',
      width: 90,
      render: (row) => (
        <b
          className={cn(
            'tabular-nums',
            row.amount > 0 ? 'text-success-text' : 'text-danger-text',
          )}
        >
          {signed(row.amount)}
        </b>
      ),
    },
    {
      key: 'balanceAfter',
      title: '变动后余额',
      width: 110,
      render: (row) => <span className="tabular-nums text-xs">{row.balanceAfter}</span>,
    },
    {
      key: 'reason',
      title: '说明',
      render: (row) => (
        <span className="text-[12px] text-muted-foreground">
          {row.reason ?? '—'}
          {row.taskId ? ` · 任务 ${row.taskId.slice(-8)}` : ''}
          {row.orderId ? ` · 订单 ${row.orderId.slice(-8)}` : ''}
        </span>
      ),
    },
  ];

  return (
    <Drawer
      title={`积分明细 · ${user.email}`}
      width={760}
      open
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      {error && data && <StaleError error={error} onRetry={() => void reload()} />}

      <DetailSection title="账户概要">
        <Descriptions
          columns={2}
          items={[
            {
              label: '用户',
              value: (
                <Link className="text-brand hover:underline" to={adminUserDetailHref(user.userId)}>
                  {user.email}
                </Link>
              ),
            },
            { label: '用户 ID', value: <code className="font-mono text-xs">{user.userId}</code> },
            {
              label: '关联记录',
              value: (
                <span className="flex flex-wrap gap-x-3">
                  <Link className="text-brand hover:underline" to={adminOrderHref({ email: user.email })}>
                    订单记录
                  </Link>
                  <Link className="text-brand hover:underline" to={adminTasksHref({ userId: user.userId })}>
                    任务记录
                  </Link>
                </span>
              ),
            },
            { label: '当前余额', value: <b className="tabular-nums">{user.balance}</b> },
            {
              label: '30 天内到期',
              value: <span className="tabular-nums">{user.expiringSoon}</span>,
            },
            {
              label: '累计获得 / 消耗',
              value: (
                <span className="tabular-nums">
                  {user.totalEarned} / {user.totalConsumed}
                  <span className="ml-1 text-[12px] text-muted-foreground">
                    不含到期回收与退款扣回，故与余额不构成等式
                  </span>
                </span>
              ),
            },
            { label: '最近到期', value: fmtTime(user.nearestExpiry) },
          ]}
        />
      </DetailSection>

      {writable && (
        <DetailSection title="人工调整" note="正数增加、负数扣减；扣减受余额限制" className="mt-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="w-40">
                <FormField label="变动量（积分）" htmlFor="c-delta">
                  <TextField
                    value={delta}
                    onChange={setDelta}
                    placeholder="如 100 或 -50"
                    inputMode="numeric"
                    ariaLabel="变动量"
                  />
                </FormField>
              </div>
              <div className="w-40">
                <FormField label="有效天数（可选）" htmlFor="c-valid">
                  <TextField
                    value={validDays}
                    onChange={setValidDays}
                    placeholder="留空 = 永久"
                    inputMode="numeric"
                    ariaLabel="有效天数"
                  />
                </FormField>
              </div>
            </div>
            <FormField label="调整原因（强制）" htmlFor="c-reason">
              <TextField
                value={reason}
                onChange={setReason}
                placeholder="如：工单 #123 补偿生成失败"
                maxLength={200}
                ariaLabel="调整原因"
              />
            </FormField>
            <div>
              <ActionButton
                variant="default"
                disabled={!deltaValid || busy}
                onClick={() => void submitAdjust()}
              >
                {busy ? '提交中…' : '提交调整'}
              </ActionButton>
            </div>
          </div>
        </DetailSection>
      )}

      <DetailSection
        title="批次"
        note="消耗按先到期先扣（FEFO），空到期视为最晚"
        className="mt-6"
      >
        {loading && !data ? (
          <SkeletonBody rows={4} />
        ) : error && !data ? (
          <ListError error={error} onRetry={() => void reload()} />
        ) : lots.length === 0 ? (
          <EmptyState title="该用户没有积分批次。" />
        ) : (
          <AdminDataTable<AdminCreditLotRow>
            rows={lots}
            columns={lotColumns}
            rowKey={(row) => row.id}
            loading={loading}
            density="compact"
            emptyText="该用户没有积分批次。"
          />
        )}
      </DetailSection>

      <DetailSection title="流水" className="mt-6">
        <FilterBar>
          <SelectField
            className="w-36"
            ariaLabel="按流水类型筛选"
            placeholder="类型"
            allowClear
            value={type}
            onChange={setType}
            options={LEDGER_OPTIONS}
          />
          <TextField
            className="w-40"
            ariaLabel="开始日期"
            type="date"
            value={from}
            onChange={setFrom}
          />
          <TextField className="w-40" ariaLabel="结束日期" type="date" value={to} onChange={setTo} />
          <FilterActions>
            <ActionButton variant="secondary" onClick={() => void reload()} disabled={loading}>
              刷新
            </ActionButton>
          </FilterActions>
        </FilterBar>
        {/*
          流水区不再重复报错: 批次区已经整块显示了同一次加载的失败原因,
          同一个错误在抽屉里出现两次只会让人以为两处各自坏了。
        */}
        {loading && !data ? (
          <SkeletonBody rows={4} />
        ) : error && !data ? null : ledger.length === 0 ? (
          <EmptyState title="没有符合条件的流水。" />
        ) : (
          <AdminDataTable<AdminCreditLedgerRow>
            rows={ledger}
            columns={ledgerColumns}
            rowKey={(row) => row.id}
            loading={loading}
            density="compact"
            emptyText="没有符合条件的流水。"
          />
        )}
      </DetailSection>
    </Drawer>
  );
}
