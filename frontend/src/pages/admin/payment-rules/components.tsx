import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CircleDollarSign,
  Clock3,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';

import {
  ActionButton,
  ModalDialog,
  Panel,
  StatCards,
  ToneBadge,
} from '~/admin-ui/primitives';
import type { AdminSettingValue } from '../../../types/api';
import {
  PAYMENT_CONFIG_HREF,
  PAYMENT_RULES_KEYS,
  refundRatioPercent,
} from './constants';

export interface RuleChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

const AMOUNT_KEYS = new Set<string>([
  PAYMENT_RULES_KEYS.minAmountYuan,
  PAYMENT_RULES_KEYS.maxAmountYuan,
  PAYMENT_RULES_KEYS.dailyLimitYuan,
]);

function numberText(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function formatRuleValue(key: string, value: AdminSettingValue): string {
  if (value === null || value === undefined || value === '') {
    if (key === PAYMENT_RULES_KEYS.refundWindowDays) return '不限时间';
    return '不限';
  }
  if (typeof value === 'boolean') {
    if (key === PAYMENT_RULES_KEYS.enabled) return value ? '已开放' : '已关闭';
    return value ? '允许' : '不允许';
  }
  if (key === PAYMENT_RULES_KEYS.refundMaxRatioBps) {
    return `${numberText(refundRatioPercent(value))}%`;
  }
  if (AMOUNT_KEYS.has(key)) return `¥ ${numberText(value)}`;
  if (key === PAYMENT_RULES_KEYS.refundWindowDays) {
    return Number(value) === 0 ? '不限时间' : `${numberText(value)} 天`;
  }
  if (key === PAYMENT_RULES_KEYS.orderTtlMinutes) return `${numberText(value)} 分钟`;
  if (key === PAYMENT_RULES_KEYS.cancelWindowUnit) {
    return value === 'hour' ? '小时' : '分钟';
  }
  return String(value);
}

export function refundBoundaryText(windowDays: unknown, ratioBps: unknown): string {
  const days = Number(windowDays);
  const ratio = refundRatioPercent(ratioBps);
  const windowText = days === 0 ? '不限时间' : `支付后 ${numberText(days)} 天内`;
  return `${windowText}最多可退 ${numberText(ratio)}%`;
}

export function PaymentRulesOverview({
  enabled,
  minAmount,
  maxAmount,
  dailyLimit,
  refundWindowDays,
  refundRatioBps,
}: {
  enabled: unknown;
  minAmount: unknown;
  maxAmount: unknown;
  dailyLimit: unknown;
  refundWindowDays: unknown;
  refundRatioBps: unknown;
}) {
  const paymentEnabled = Boolean(enabled);
  const amountRange =
    maxAmount === null || maxAmount === undefined || maxAmount === ''
      ? `¥ ${numberText(minAmount)} 起`
      : `¥ ${numberText(minAmount)} – ${numberText(maxAmount)}`;
  const dailyLimitText =
    dailyLimit === null || dailyLimit === undefined || dailyLimit === ''
      ? '每日充值额度不限'
      : `每位客户每日最多 ¥ ${numberText(dailyLimit)}`;

  return (
    <StatCards
      columns={4}
      className="mb-4"
      items={[
        {
          key: 'payment-entry',
          label: '客户支付入口',
          value: paymentEnabled ? '已开放' : '已关闭',
          hint: paymentEnabled ? '客户可正常选择支付方式' : '客户侧支付方式整体隐藏',
          tone: paymentEnabled ? undefined : 'warn',
        },
        {
          key: 'amount-range',
          label: '单笔充值范围',
          value: amountRange,
          hint: dailyLimitText,
        },
        {
          key: 'refund-window',
          label: '退款时间窗',
          value: Number(refundWindowDays) === 0 ? '不限时间' : `${numberText(refundWindowDays)} 天`,
          hint: '从支付成功时刻开始计算',
        },
        {
          key: 'refund-ratio',
          label: '单笔可退上限',
          value: `${numberText(refundRatioPercent(refundRatioBps))}%`,
          hint: '按订单实付金额计算',
          tone: refundRatioPercent(refundRatioBps) === 0 ? 'warn' : undefined,
        },
      ]}
    />
  );
}

export function OperationGuidePanel({
  enabled,
  windowDays,
  ratioBps,
  allowConsumedTask,
  maxPendingOrders,
  orderTtlMinutes,
}: {
  enabled: unknown;
  windowDays: unknown;
  ratioBps: unknown;
  allowConsumedTask: unknown;
  maxPendingOrders: unknown;
  orderTtlMinutes: unknown;
}) {
  const paymentEnabled = Boolean(enabled);
  return (
    <div className="sticky top-4 flex flex-col gap-4">
      <Panel
        title="运营影响预览"
        note="按当前草稿汇总，保存后立即影响客户侧"
        extra={
          <ToneBadge tone={paymentEnabled ? 'success' : 'warn'}>
            {paymentEnabled ? '支付开放中' : '支付已暂停'}
          </ToneBadge>
        }
        className="mb-0"
      >
        <dl className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <dt className="text-[13px] font-medium text-foreground">客户付款</dt>
              <dd className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                {paymentEnabled
                  ? `客户可在支付页发起充值；未付款订单保留 ${numberText(orderTtlMinutes)} 分钟。`
                  : '客户侧不展示支付方式；已有订单仍可在订单管理中处理。'}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <dt className="text-[13px] font-medium text-foreground">退款处理</dt>
              <dd className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                {refundBoundaryText(windowDays, ratioBps)}。
                {allowConsumedTask
                  ? '积分已经使用时，仍可按剩余可退金额处理。'
                  : '积分一旦使用且无法全额扣回，将拒绝退款。'}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div>
              <dt className="text-[13px] font-medium text-foreground">下单边界</dt>
              <dd className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                每位客户最多同时保留 {numberText(maxPendingOrders)} 笔待支付订单。
              </dd>
            </div>
          </div>
        </dl>
      </Panel>

      <Panel title="关联工作台" note="客户体验与退款处理的其他入口" className="mb-0">
        <div className="flex flex-col">
          <RelatedLink
            to={PAYMENT_CONFIG_HREF}
            icon={WalletCards}
            label="支付配置"
            description="管理收款渠道、客户可选支付方式与对账"
          />
          <RelatedLink
            to="/admin/orders"
            icon={ReceiptText}
            label="订单管理"
            description="查看客户付款、手工核销与退款处理"
          />
          <RelatedLink
            to="/admin/credits"
            icon={ShieldCheck}
            label="积分账本"
            description="核对充值发放、任务消耗与退款回收"
          />
        </div>
      </Panel>
    </div>
  );
}

function RelatedLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: typeof WalletCards;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[13px] font-medium text-foreground group-hover:text-brand">
          {label}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </span>
        <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </Link>
  );
}

export function SaveRulesDialog({
  open,
  changes,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  changes: RuleChange[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="确认保存支付与退费规则"
      description="保存后立即影响客户支付体验、订单限制与退款判断。"
      size="sm"
      footer={
        <>
          <ActionButton
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            继续检查
          </ActionButton>
          <ActionButton disabled={busy} onClick={onConfirm}>
            {busy ? '保存中…' : '确认保存'}
          </ActionButton>
        </>
      }
    >
      <div className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] leading-5 text-warn-text">
        <div className="mb-1 font-semibold">本次将调整 {changes.length} 项</div>
        <ul className="flex flex-col gap-1">
          {changes.map((change) => (
            <li key={change.key} className="flex flex-wrap gap-x-1.5">
              <span className="font-medium">{change.label}</span>
              <span>{change.from}</span>
              <span aria-hidden>→</span>
              <span className="font-medium">{change.to}</span>
            </li>
          ))}
        </ul>
      </div>
    </ModalDialog>
  );
}
