import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RotateCcw, ShieldCheck, WalletCards } from 'lucide-react';

import {
  ActionButton,
  AdminPage,
  EmptyState,
  FieldGroup,
  ListError,
  Notice,
  PageSkeleton,
  Panel,
  SaveBar,
  SkeletonPanel,
  StaleError,
  ToneBadge,
} from '~/admin-ui/primitives';
import { adminSettingsApi } from '../../../lib/api';
import type { AdminSettingValue } from '../../../types/api';
import { useAdmin, useAdminResource, useToast, useUnsavedGuard } from './hooks';
import {
  CUSTOMER_EXPERIENCE_KEYS,
  ORDER_LIMIT_KEYS,
  PAYMENT_CONFIG_HREF,
  PAYMENT_RULES_ANCHOR,
  PAYMENT_RULES_KEYS,
  PAYMENT_RULE_COPY,
  PAYMENT_STRATEGY_KEYS,
  REFUND_RULE_KEYS,
  REFUND_RULES_ANCHOR,
  paymentRuleItems,
  refundRatioPercent,
} from './constants';
import { PaymentRuleField } from './fields';
import {
  OperationGuidePanel,
  PaymentRulesOverview,
  SaveRulesDialog,
  formatRuleValue,
  refundBoundaryText,
  type RuleChange,
} from './components';

type DraftMap = Record<string, AdminSettingValue>;

function hasOwn(map: DraftMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * 独立「支付与退费」运营工作台。
 *
 * 支付渠道与客户可选支付方式仍由 `/admin/payments` 管理；本页只处理客户支付
 * 体验、订单边界和退款规则。数据继续写入统一 settings API，避免业务运行时
 * 出现第二套配置源，但页面结构不复用系统设置的分组工作台。
 */
export function AdminPaymentRulesPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const editable = can('setting.write');

  const { data: settings, loading, error, reload } = useAdminResource(() =>
    adminSettingsApi.read(),
  );
  const items = useMemo(() => (settings ? paymentRuleItems(settings) : []), [settings]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

  const [draft, setDraft] = useState<DraftMap>({});
  const [clears, setClears] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const changedKeys = useMemo(
    () => [...new Set([...Object.keys(draft), ...clears])].filter((key) => itemMap.has(key)),
    [draft, clears, itemMap],
  );
  const dirtyCount = changedKeys.length;
  useUnsavedGuard(dirtyCount > 0);

  const valueFor = (key: string): AdminSettingValue => {
    if (hasOwn(draft, key)) return draft[key];
    return itemMap.get(key)?.value ?? null;
  };

  const setValue = (key: string, value: AdminSettingValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const revert = (key: string) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const restoreDefault = (key: string) => {
    if (!itemMap.get(key)?.overridden) return;
    setDraft((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setClears((current) => new Set(current).add(key));
  };

  const changes = useMemo<RuleChange[]>(() => {
    return changedKeys.flatMap((key) => {
      const item = itemMap.get(key);
      if (!item) return [];
      const to = clears.has(key) ? item.default : draft[key];
      return [
        {
          key,
          label: PAYMENT_RULE_COPY[key]?.label ?? item.label,
          from: formatRuleValue(key, item.value),
          to: clears.has(key)
            ? `${formatRuleValue(key, item.default)}（恢复默认）`
            : formatRuleValue(key, to),
        },
      ];
    });
  }, [changedKeys, clears, draft, itemMap]);

  const discard = () => {
    if (dirtyCount === 0) return;
    setDraft({});
    setClears(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      const nextSettings = Object.fromEntries(
        Object.entries(draft).filter(([key]) => itemMap.has(key) && !clears.has(key)),
      );
      const nextClears = [...clears].filter((key) => itemMap.has(key));
      const result = await adminSettingsApi.update({
        settings: nextSettings,
        clears: nextClears,
      });
      setDraft({});
      setClears(new Set());
      setConfirming(false);
      await reload();
      toast.success(
        '支付与退费规则已保存',
        `${result.updated.length + result.cleared.length} 项变更已对客户侧生效。`,
      );
    } catch (cause) {
      toast.error(
        '支付与退费规则保存失败',
        cause instanceof Error ? cause.message : '请检查配置后重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!settings || !hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hash, settings]);

  if (loading && !settings) {
    return (
      <PageSkeleton
        title="支付与退费"
        description="管理客户支付体验、下单边界与退款处理规则"
        stats={4}
        body={
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <SkeletonPanel rows={7} />
              <SkeletonPanel rows={5} />
              <SkeletonPanel rows={6} className="mb-0" />
            </div>
            <SkeletonPanel rows={9} className="mb-0" />
          </div>
        }
      />
    );
  }
  if (error && !settings) return <ListError error={error} onRetry={() => void reload()} />;
  if (!settings) return <EmptyState title="暂时无法读取支付与退费规则" />;

  const paymentEnabled = Boolean(valueFor(PAYMENT_RULES_KEYS.enabled));
  const refundWindowDays = valueFor(PAYMENT_RULES_KEYS.refundWindowDays);
  const refundRatioBps = valueFor(PAYMENT_RULES_KEYS.refundMaxRatioBps);
  const allowConsumedTask = Boolean(valueFor(PAYMENT_RULES_KEYS.refundAllowConsumedTask));
  const cancelLimitEnabled = Boolean(valueFor(PAYMENT_RULES_KEYS.cancelLimitEnabled));
  const cancelWindowSize = valueFor(PAYMENT_RULES_KEYS.cancelWindowSize);
  const cancelWindowUnit = valueFor(PAYMENT_RULES_KEYS.cancelWindowUnit) === 'hour' ? '小时' : '分钟';
  const cancelLimitMax = valueFor(PAYMENT_RULES_KEYS.cancelLimitMax);
  const maxPendingOrders = valueFor(PAYMENT_RULES_KEYS.maxPendingOrders);
  const orderTtlMinutes = valueFor(PAYMENT_RULES_KEYS.orderTtlMinutes);

  const renderRule = (key: string) => {
    const item = itemMap.get(key);
    if (!item) return null;
    return (
      <PaymentRuleField
        key={key}
        item={item}
        value={valueFor(key)}
        dirty={hasOwn(draft, key)}
        clearing={clears.has(key)}
        disabled={!editable || Boolean(item.readOnly)}
        onChange={(value) => setValue(key, value)}
        onRevert={() => revert(key)}
        onClear={() => restoreDefault(key)}
      />
    );
  };

  const renderGrid = (keys: readonly string[], wideKeys: ReadonlySet<string> = new Set()) => (
    <FieldGroup className="grid grid-cols-1 gap-x-6 gap-y-5 xl:grid-cols-2">
      {keys.map((key) => (
        <div key={key} className={wideKeys.has(key) ? 'min-w-0 xl:col-span-2' : 'min-w-0'}>
          {renderRule(key)}
        </div>
      ))}
    </FieldGroup>
  );

  const wideCustomerKeys = new Set<string>([
    PAYMENT_RULES_KEYS.enabled,
    PAYMENT_RULES_KEYS.helpImage,
    PAYMENT_RULES_KEYS.helpText,
  ]);

  return (
    <AdminPage
      title="支付与退费"
      description="从客户支付体验到退款处理边界，集中管理影响收款与售后判断的规则。保存后立即生效。"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ActionButton
            variant="outline"
            size="sm"
            icon={WalletCards}
            onClick={() => navigate(PAYMENT_CONFIG_HREF)}
          >
            管理收款渠道
          </ActionButton>
          <ToneBadge tone={dirtyCount > 0 ? 'warn' : editable ? 'success' : 'neutral'}>
            {dirtyCount > 0 ? `${dirtyCount} 项未保存` : editable ? '规则已保存' : '仅查看'}
          </ToneBadge>
        </div>
      }
    >
      {error ? <StaleError error={error} onRetry={() => void reload()} /> : null}
      {!editable ? (
        <Notice tone="locked" title="仅查看模式">
          当前账号可查看支付与退费规则，但不能修改。如需调整，请联系具备系统设置管理权限的管理员。
        </Notice>
      ) : null}
      {!paymentEnabled ? (
        <Notice tone="warn" title="客户支付当前处于关闭状态">
          客户侧不会展示支付方式。完成收款渠道检查后，可在下方「客户支付体验」中重新开放。
        </Notice>
      ) : null}

      <PaymentRulesOverview
        enabled={paymentEnabled}
        minAmount={valueFor(PAYMENT_RULES_KEYS.minAmountYuan)}
        maxAmount={valueFor(PAYMENT_RULES_KEYS.maxAmountYuan)}
        dailyLimit={valueFor(PAYMENT_RULES_KEYS.dailyLimitYuan)}
        refundWindowDays={refundWindowDays}
        refundRatioBps={refundRatioBps}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <section id={PAYMENT_RULES_ANCHOR} className="scroll-mt-4">
            <Panel
              title="客户支付体验"
              note="决定客户是否看到支付入口，以及充值金额、商品名称和帮助信息的呈现方式。"
              extra={
                <ToneBadge tone={paymentEnabled ? 'success' : 'warn'}>
                  {paymentEnabled ? '支付开放中' : '支付已关闭'}
                </ToneBadge>
              }
            >
              {renderGrid(CUSTOMER_EXPERIENCE_KEYS, wideCustomerKeys)}
            </Panel>
          </section>

          <section id={REFUND_RULES_ANCHOR} className="scroll-mt-4">
            <Panel
              title="退款处理边界"
              note="用于订单退款时的统一判断，不改变已完成任务的产出回收方式。"
              extra={<ToneBadge tone="brand">运营口径</ToneBadge>}
            >
              {renderGrid(REFUND_RULE_KEYS)}
              <div className="mt-5 flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                <RotateCcw className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="m-0 text-[13px] font-medium text-foreground">客户可感知的退款边界</p>
                  <p className="m-0 mt-1 text-[12px] leading-5 text-muted-foreground">
                    {refundBoundaryText(refundWindowDays, refundRatioBps)}；
                    {allowConsumedTask
                      ? '积分已经使用时，仍按剩余可退金额继续处理。'
                      : '积分已经使用且无法全额扣回时，退款会被拒绝。'}
                  </p>
                </div>
              </div>
            </Panel>
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Panel
              title="下单与取消限制"
              note="减少重复下单和恶意占单，同时保留客户正常的支付重试空间。"
            >
              {renderGrid(ORDER_LIMIT_KEYS)}
              <div className="mt-4 flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                <p className="m-0 text-[12px] leading-5 text-muted-foreground">
                  {cancelLimitEnabled
                    ? `客户每 ${formatRuleValue(
                        PAYMENT_RULES_KEYS.cancelWindowSize,
                        cancelWindowSize,
                      )}${cancelWindowUnit}最多主动取消 ${formatRuleValue(
                        PAYMENT_RULES_KEYS.cancelLimitMax,
                        cancelLimitMax,
                      )} 笔订单。`
                    : '当前不限制客户主动取消待支付订单的次数。'}
                </p>
              </div>
            </Panel>

            <Panel
              title="支付能力策略"
              note="控制多收款通道的分流方式和支付宝移动端唤起体验。"
            >
              {renderGrid(PAYMENT_STRATEGY_KEYS)}
            </Panel>
          </div>
        </div>

        <OperationGuidePanel
          enabled={paymentEnabled}
          windowDays={refundWindowDays}
          ratioBps={refundRatioBps}
          allowConsumedTask={allowConsumedTask}
          maxPendingOrders={maxPendingOrders}
          orderTtlMinutes={orderTtlMinutes}
        />
      </div>

      {editable && dirtyCount > 0 ? (
        <SaveBar>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-medium text-foreground">有 {dirtyCount} 项规则待保存</p>
            <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
              保存后立即影响客户支付与订单退款判断。
            </p>
          </div>
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={discard}
          >
            放弃变更
          </ActionButton>
          <ActionButton
            size="sm"
            disabled={saving}
            onClick={() => setConfirming(true)}
          >
            保存变更
          </ActionButton>
        </SaveBar>
      ) : null}

      <SaveRulesDialog
        open={confirming}
        changes={changes}
        busy={saving}
        onOpenChange={setConfirming}
        onConfirm={() => void save()}
      />
    </AdminPage>
  );
}
