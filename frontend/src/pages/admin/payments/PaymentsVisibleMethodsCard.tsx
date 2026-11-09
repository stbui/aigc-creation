import { useEffect, useState } from 'react';

import {
  ActionButton,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Notice,
  SelectField,
} from '~/admin-ui/primitives';
import type {
  AdminPaymentProviderView,
  AdminPaymentSettings,
  PaymentSource,
  VisiblePaymentMethod,
} from '../../../types/payment';
import { adminPaymentProvidersApi } from './api';
import { useToast } from './hooks';

const METHOD_LABELS: Record<VisiblePaymentMethod, string> = {
  alipay: '支付宝',
  wechat: '微信支付',
};

const SOURCE_LABELS: Record<PaymentSource, string> = {
  unset: '未选择',
  official: '官方渠道',
  epay: '易支付',
};

/**
 * 前台可见支付方式的来源选择。
 *
 * 每个按钮在同一时刻只能路由到一个来源；未选择或所选渠道不可用时，
 * 后端会直接隐藏该按钮，不会自动回退到另一来源。
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    adminPaymentProvidersApi
      .settings()
      .then((next) => {
        if (alive) {
          setSettings(next);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '读取支付来源失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateSource = (method: VisiblePaymentMethod, source: PaymentSource) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            [method === 'alipay' ? 'alipaySource' : 'wechatSource']: source,
          }
        : current,
    );
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await adminPaymentProvidersApi.saveSettings(settings);
      setSettings(next);
      setError(null);
      toast.success('前台支付来源已保存');
      onSaved();
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存支付来源失败';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="admin-payment-visible-methods" className="gap-0 py-0">
      <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-[13px] font-semibold">前台支付方式</CardTitle>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            用户始终只看到「支付宝 / 微信支付」两个按钮。请为每个按钮选择唯一来源；未选择时前台隐藏。
          </p>
        </div>
        <ActionButton onClick={() => void save()} disabled={!writable || !settings || saving}>
          {saving ? '保存中…' : '保存来源'}
        </ActionButton>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4 py-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {loading && !settings ? (
          <p className="text-[12px] text-muted-foreground">正在读取前台支付来源…</p>
        ) : settings ? (
          (['alipay', 'wechat'] as const).map((method) => {
            const source = method === 'alipay' ? settings.alipaySource : settings.wechatSource;
            const availability = sourceAvailability(providers, settings.defaultCurrency, method, source);
            return (
              <div
                key={method}
                className="grid grid-cols-[140px_minmax(0,220px)_minmax(0,1fr)] items-start gap-4 border-b border-border/70 pb-3 last:border-b-0 last:pb-0"
              >
                <div className="pt-2 text-[13px] font-medium text-foreground">
                  {METHOD_LABELS[method]}
                </div>
                <FormField label={`${METHOD_LABELS[method]}来源`} className="gap-1">
                  <SelectField
                    value={source}
                    onChange={(value) => {
                      if (value === 'unset' || value === 'official' || value === 'epay') {
                        updateSource(method, value);
                      }
                    }}
                    options={(['unset', 'official', 'epay'] as const).map((value) => ({
                      value,
                      label:
                        value === 'official'
                          ? method === 'alipay'
                            ? '支付宝官方'
                            : '微信官方'
                          : SOURCE_LABELS[value],
                    }))}
                    ariaLabel={`${METHOD_LABELS[method]}支付来源`}
                    disabled={!writable || saving}
                  />
                </FormField>
                <div className="pt-6">
                  {availability.ok ? (
                    <span className="text-[12px] text-muted-foreground">
                      当前配置可用，前台会展示该按钮。
                    </span>
                  ) : (
                    <Notice tone="warn" className="mb-0">
                      {availability.reason}，前台会隐藏该按钮。
                    </Notice>
                  )}
                </div>
              </div>
            );
          })
        ) : null}
        {!writable && (
          <p className="text-[12px] text-muted-foreground">当前账号没有支付配置写权限。</p>
        )}
      </CardContent>
    </Card>
  );
}

function sourceAvailability(
  providers: AdminPaymentProviderView[],
  currency: AdminPaymentSettings['defaultCurrency'],
  method: VisiblePaymentMethod,
  source: PaymentSource,
): { ok: boolean; reason: string } {
  if (source === 'unset') return { ok: false, reason: '未选择支付来源' };

  const providerId = source === 'official' ? method : 'epay';
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return { ok: false, reason: `尚未创建${SOURCE_LABELS[source]}渠道` };
  if (!provider.enabled) return { ok: false, reason: `${provider.name}渠道已停用` };
  if (!provider.configured) return { ok: false, reason: `${provider.name}渠道配置不完整` };
  if (!provider.supportedCurrencies.includes(currency)) {
    return { ok: false, reason: `${provider.name}不支持默认币种 ${currency}` };
  }
  const danger = provider.warnings.find((warning) => warning.level === 'danger');
  if (danger) return { ok: false, reason: danger.message };
  return { ok: true, reason: '' };
}
