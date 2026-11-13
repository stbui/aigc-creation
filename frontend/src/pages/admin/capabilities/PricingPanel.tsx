import { useEffect, useMemo, useState } from 'react';
import {
  ActionButton,
  Descriptions,
  ListError,
  Notice,
  Panel,
  SelectField,
  SkeletonBody,
  StaleError,
  TextField,
} from '~/admin-ui/primitives';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import { adminCapabilityModelsApi } from '../../../lib/api';
import { BILLING_MODE_OPTIONS } from '../../../lib/billing-mode';
import { parseCredits, toCredits, toCreditsInput } from '../../../lib/microcredits';
import type { CapabilityPricingView } from '../../../types/model';
import { formatUpdatedAt } from './utils';

interface PricingDraft {
  billingMode: string;
  unitPrice: string;
  inputPrice: string;
  outputPrice: string;
  cachedPrice: string;
}

function draftFromView(view: CapabilityPricingView | null): PricingDraft {
  return {
    billingMode: view?.billingMode ?? 'fixed_request',
    unitPrice: toCreditsInput(view?.unitPriceMicrocredits ?? 0),
    inputPrice: toCreditsInput(view?.inputTokenPriceMicrocredits ?? 0),
    outputPrice: toCreditsInput(view?.outputTokenPriceMicrocredits ?? 0),
    cachedPrice: toCreditsInput(view?.cachedTokenPriceMicrocredits ?? 0),
  };
}

/** 能力售价：CapabilityPricing 是唯一事实源；切换线路不改价。 */
export function PricingPanel({
  capabilityId,
  capabilityName,
  data,
  loading,
  error,
  writable,
  onRetry,
}: {
  capabilityId: string;
  capabilityName: string;
  data: CapabilityPricingView | null;
  loading: boolean;
  error: string | null;
  writable: boolean;
  onRetry: () => Promise<void> | void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pricing, setPricing] = useState<PricingDraft>(() => draftFromView(data));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPricing(draftFromView(data));
  }, [data]);

  const unitLabel = useMemo(() => {
    if (pricing.billingMode === 'per_second') return '每秒价格';
    if (pricing.billingMode === 'token') return '按 Token 计价';
    return '单次价格';
  }, [pricing.billingMode]);

  const savePricing = async () => {
    const fixedMode = pricing.billingMode !== 'token';
    const unit = fixedMode ? parseCredits(pricing.unitPrice) : 0;
    const input = pricing.billingMode === 'token' ? parseCredits(pricing.inputPrice) : 0;
    const output = pricing.billingMode === 'token' ? parseCredits(pricing.outputPrice) : 0;
    const cached = pricing.billingMode === 'token' ? parseCredits(pricing.cachedPrice) : 0;
    if (unit === null || input === null || output === null || cached === null) {
      toast.error('价格必须是合法积分金额');
      return;
    }

    const confirmed = await confirm({
      title: `确认修改「${capabilityName}」售价？`,
      description: '新售价立即作用于后续请求；已创建任务按原账单快照结算，候选线路不会改变。',
      confirmText: '保存售价',
    });
    if (confirmed === null) return;

    setSaving(true);
    try {
      await adminCapabilityModelsApi.setPricing(capabilityId, {
        billingMode: pricing.billingMode,
        unitPriceMicrocredits: unit,
        inputTokenPriceMicrocredits: input,
        outputTokenPriceMicrocredits: output,
        cachedTokenPriceMicrocredits: cached,
      });
      toast.success('能力售价已保存');
      await onRetry();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel = data?.configured ? '能力售价（已配置）' : '能力默认价';

  if (loading && data === null) {
    return (
      <Panel title="能力售价" extra={<span className="text-xs text-muted-foreground">切换线路不改价</span>}>
        <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
          <SkeletonBody rows={4} />
          <p className="text-center text-xs text-muted-foreground">正在读取能力售价…</p>
        </div>
      </Panel>
    );
  }

  if (error && data === null) {
    return (
      <Panel title="能力售价" extra={<span className="text-xs text-muted-foreground">切换线路不改价</span>}>
        <ListError error={error} onRetry={() => void onRetry()} />
      </Panel>
    );
  }

  if (data === null) {
    return (
      <Panel title="能力售价" extra={<span className="text-xs text-muted-foreground">切换线路不改价</span>}>
        <ListError error="未读取到能力售价，请稍后重试" onRetry={() => void onRetry()} />
      </Panel>
    );
  }

  return (
    <Panel title="能力售价" extra={<span className="text-xs text-muted-foreground">切换线路不改价</span>}>
      <>
        {error && <StaleError error={error} onRetry={() => void onRetry()} />}
        <div className="flex flex-col gap-4">
          <Notice tone={data?.configured ? 'info' : 'warn'} className="mb-0">
            {data?.configured
              ? '当前使用 CapabilityPricing 中的能力级售价；所有绑定线路共用这一份价格。'
              : '当前尚未写入能力售价，按能力定义默认价计费。保存后会创建唯一售价记录。'}
          </Notice>

          <Descriptions
            columns={2}
            items={[
              { label: '定价来源', value: sourceLabel },
              {
                label: '默认单次价',
                value: `${toCredits(data?.defaultUnitPriceMicrocredits ?? 0)} 积分`,
              },
              { label: '更新人', value: data?.updatedBy || '—' },
              { label: '更新时间', value: formatUpdatedAt(data?.updatedAt ?? null) },
            ]}
          />

          <div className="grid grid-cols-4 gap-3">
            <SelectField
              ariaLabel="计费方式"
              value={pricing.billingMode}
              onChange={(value) =>
                setPricing((current) => ({ ...current, billingMode: value ?? 'fixed_request' }))
              }
              options={BILLING_MODE_OPTIONS}
            />

            {pricing.billingMode !== 'token' ? (
              <TextField
                ariaLabel={unitLabel}
                value={pricing.unitPrice}
                onChange={(value) => setPricing((current) => ({ ...current, unitPrice: value }))}
                placeholder="积分"
              />
            ) : (
              <>
                <TextField
                  ariaLabel="输入 Token 价格"
                  value={pricing.inputPrice}
                  onChange={(value) => setPricing((current) => ({ ...current, inputPrice: value }))}
                  placeholder="积分 / Token"
                />
                <TextField
                  ariaLabel="输出 Token 价格"
                  value={pricing.outputPrice}
                  onChange={(value) => setPricing((current) => ({ ...current, outputPrice: value }))}
                  placeholder="积分 / Token"
                />
                <TextField
                  ariaLabel="缓存 Token 价格"
                  value={pricing.cachedPrice}
                  onChange={(value) => setPricing((current) => ({ ...current, cachedPrice: value }))}
                  placeholder="积分 / Token"
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <ActionButton
              variant="default"
              size="sm"
              disabled={!writable || saving || loading}
              onClick={() => void savePricing()}
            >
              {saving ? '保存中…' : '保存售价'}
            </ActionButton>
            {!writable && <span className="text-xs text-muted-foreground">当前账号无 product.price 权限，仅可查看</span>}
          </div>
        </div>
      </>
    </Panel>
  );
}
