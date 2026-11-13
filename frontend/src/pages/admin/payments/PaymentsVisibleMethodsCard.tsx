import { useEffect, useState } from 'react';
import { CreditCard, MessageCircle, SlidersHorizontal } from 'lucide-react';

import {
  ActionButton,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  ModalDialog,
  Notice,
  SelectField,
  StatusTag,
} from '~/admin-ui/primitives';
import type {
  AdminPaymentProviderView,
  AdminPaymentSettings,
  PaymentSource,
  VisiblePaymentMethod,
} from '../../../types/payment';
import { adminPaymentProvidersApi } from './api';
import { PAYMENT_METHOD_LABELS } from './constants';
import { useDiscardConfirm, useToast, useUnsavedGuard } from './hooks';
import { sourceAvailability, sourceAvailableInstances } from './utils';

const SOURCE_LABELS: Record<PaymentSource, string> = {
  unset: '尚未选择来源',
  official: '官方直连',
  epay: '易支付',
};

const METHOD_VISUAL: Record<
  VisiblePaymentMethod,
  { Icon: typeof CreditCard; iconClassName: string }
> = {
  alipay: { Icon: CreditCard, iconClassName: 'bg-brand/10 text-brand' },
  wechat: { Icon: MessageCircle, iconClassName: 'bg-success-soft text-success-text' },
};

/** 把技术侧不可用原因换成运营能直接理解的客户影响。 */
function customerReason(reason: string): string {
  return reason
    .replace('尚未开通官方收款来源', '官方收款来源尚未开通')
    .replace('尚未开通易支付收款来源', '易支付收款来源尚未开通')
    .replace('尚未创建对应官方渠道', '对应官方收款来源尚未开通')
    .replace('尚未创建易支付渠道', '易支付收款来源尚未开通')
    .replace('尚未创建服务商实例', '尚未添加收款通道')
    .replace(/没有实例选择支付宝/g, '没有通道支持支付宝')
    .replace(/没有实例选择微信支付/g, '没有通道支持微信支付')
    .replace(/没有已启用的支付宝实例/g, '没有已启用的支付宝收款通道')
    .replace(/没有已启用的微信支付实例/g, '没有已启用的微信支付收款通道')
    .replace('的已启用实例配置不完整', '的收款通道尚未准备完成')
    .replace('不支持默认币种', '暂不支持当前结算币种');
}

function sourceLabel(method: VisiblePaymentMethod, source: PaymentSource): string {
  if (source === 'official') {
    return method === 'alipay' ? '支付宝官方' : '微信支付官方';
  }
  return SOURCE_LABELS[source];
}

/**
 * 客户可选的支付方式。
 *
 * 运营先看到「客户能不能选」「当前由谁收款」，需要调整时再打开弹窗选择来源。
 * 支付来源表单不常驻页面，避免把运营工作台做成一组系统参数。
 */
export function PaymentsVisibleMethodsCard({
  providers,
  writable,
  onSaved,
}: {
  providers: AdminPaymentProviderView[];
  writable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [settings, setSettings] = useState<AdminPaymentSettings | null>(null);
  const [draft, setDraft] = useState<AdminPaymentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    adminPaymentProvidersApi
      .settings()
      .then((next) => {
        if (alive) {
          setSettings(next);
          setDraft(next);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '读取支付方式失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = Boolean(
    editing && settings && draft && JSON.stringify(settings) !== JSON.stringify(draft),
  );
  useUnsavedGuard(writable && dirty);

  const requestClose = useDiscardConfirm(dirty, () => {
    setEditing(false);
    setDraft(settings);
    setError(null);
  });

  const openEditor = () => {
    if (!settings) return;
    setDraft(settings);
    setError(null);
    setEditing(true);
  };

  const updateSource = (method: VisiblePaymentMethod, source: PaymentSource) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            [method === 'alipay' ? 'alipaySource' : 'wechatSource']: source,
          }
        : current,
    );
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await adminPaymentProvidersApi.saveSettings(draft);
      setSettings(next);
      setDraft(next);
      setError(null);
      setEditing(false);
      toast.success('客户支付方式已更新');
      onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存支付方式失败';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        data-testid="admin-payment-visible-methods"
        className="flex h-full flex-col gap-0 rounded-xl border-border bg-card py-0 shadow-card"
      >
        <CardHeader className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <CardTitle className="text-[14px] font-semibold">客户可选的支付方式</CardTitle>
            <CardDescription className="mt-1 text-[12px] leading-5">
              客户充值时会看到已准备好的方式；无法收款时入口会自动隐藏。
            </CardDescription>
          </div>
          <ActionButton
            variant="outline"
            size="sm"
            icon={SlidersHorizontal}
            onClick={openEditor}
            disabled={!writable || !settings || loading}
            ariaLabel={writable ? '调整客户支付方式' : '当前账号仅可查看支付方式'}
          >
            {writable ? '调整方式' : '仅可查看'}
          </ActionButton>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-2 px-4 pb-4">
          {error && !editing && <Notice tone="danger">{error}</Notice>}
          {loading && !settings ? (
            <div className="flex flex-1 items-center rounded-lg border border-dashed border-border px-4 text-[12px] text-muted-foreground">
              正在确认客户支付方式…
            </div>
          ) : settings ? (
            <div className="grid flex-1 grid-cols-2 gap-2">
              {(['alipay', 'wechat'] as const).map((method) => {
                const source =
                  method === 'alipay' ? settings.alipaySource : settings.wechatSource;
                const availability = sourceAvailability(
                  providers,
                  settings.defaultCurrency,
                  method,
                  source,
                );
                const available = sourceAvailableInstances(
                  providers,
                  settings.defaultCurrency,
                  method,
                  source,
                );
                const visual = METHOD_VISUAL[method];
                const reason = customerReason(availability.reason);
                return (
                  <div
                    key={method}
                    className="flex min-w-0 flex-col rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${visual.iconClassName}`}
                      >
                        <visual.Icon className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-foreground">
                          {PAYMENT_METHOD_LABELS[method]}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                          {sourceLabel(method, source)}
                        </div>
                      </div>
                      <StatusTag
                        status={availability.ok ? 'usable' : 'disabled'}
                        tone={availability.ok ? 'success' : 'muted'}
                        label={availability.ok ? '客户可选' : '暂不可选'}
                        showDot={availability.ok}
                      />
                    </div>

                    <div className="mt-3 flex min-w-0 items-start justify-between gap-2 border-t border-border/70 pt-2.5 text-[12px] leading-4">
                      <span
                        className={availability.ok ? 'text-success-text' : 'text-muted-foreground'}
                        title={availability.ok ? undefined : reason}
                      >
                        {availability.ok
                          ? `${available.instances.length} 条收款通道可用`
                          : reason}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {settings.defaultCurrency}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {!writable && (
            <p className="m-0 text-[12px] text-muted-foreground">
              当前账号可以查看客户支付方式，但没有调整权限。
            </p>
          )}
        </CardContent>
      </Card>

      <ModalDialog
        open={editing}
        onOpenChange={(open) => {
          if (open) setEditing(true);
          else requestClose();
        }}
        title="调整客户支付方式"
        description="每个支付方式只能选择一个收款来源。来源下没有可用通道时，客户侧会自动隐藏该方式。"
        size="md"
        footer={
          <>
            <ActionButton variant="secondary" onClick={requestClose} disabled={saving}>
              取消
            </ActionButton>
            <ActionButton onClick={() => void save()} disabled={!writable || saving || !dirty}>
              {saving ? '保存中…' : '保存调整'}
            </ActionButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error && <Notice tone="danger">{error}</Notice>}
          {draft &&
            (['alipay', 'wechat'] as const).map((method) => {
              const source =
                method === 'alipay' ? draft.alipaySource : draft.wechatSource;
              const availability = sourceAvailability(
                providers,
                draft.defaultCurrency,
                method,
                source,
              );
              const available = sourceAvailableInstances(
                providers,
                draft.defaultCurrency,
                method,
                source,
              );
              const visual = METHOD_VISUAL[method];
              return (
                <div
                  key={method}
                  className="rounded-xl border border-border bg-card p-4 shadow-card"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${visual.iconClassName}`}
                    >
                      <visual.Icon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-foreground">
                        {PAYMENT_METHOD_LABELS[method]}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                        {availability.ok
                          ? `客户当前可以选择，${available.instances.length} 条收款通道可用。`
                          : `客户当前看不到此方式。${customerReason(availability.reason)}。`}
                      </p>
                    </div>
                    <StatusTag
                      status={availability.ok ? 'usable' : 'disabled'}
                      tone={availability.ok ? 'success' : 'muted'}
                      label={availability.ok ? '展示中' : '已隐藏'}
                      showDot={availability.ok}
                    />
                  </div>

                  <FormField label="使用哪个收款来源" className="mt-4 max-w-[280px]">
                    <SelectField
                      value={source}
                      onChange={(value) => {
                        if (value === 'unset' || value === 'official' || value === 'epay') {
                          updateSource(method, value);
                        }
                      }}
                      options={(['unset', 'official', 'epay'] as const).map((value) => ({
                        value,
                        label: sourceLabel(method, value),
                      }))}
                      ariaLabel={`${PAYMENT_METHOD_LABELS[method]}收款来源`}
                      disabled={!writable || saving}
                    />
                  </FormField>
                </div>
              );
            })}
        </div>
      </ModalDialog>
    </>
  );
}
