import { useMemo, useState } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';
import { adminChannelsApi } from './api';
import {
  Button,
  FormField,
  ModalDialog,
  Notice,
  NumberInput,
  SelectBox,
  TextInput,
} from './components';
import { useToast } from './hooks';
import {
  buildRepriceRows,
  computeRepriceSale,
  formatMarkup,
  isValidMarkup,
  MAX_REPRICE_MARKUP_PERCENT,
  MAX_REPRICE_MODELS,
  parseSaleInput,
  repriceBlockingModels,
  saleInputValue,
  type RepriceRow,
} from '../../../lib/channelReprice';
import type { AdminChannelModelView, ChannelModelRepriceInput } from '../../../types/model';

/**
 * 渠道模型「统一调价」弹窗。
 *
 * 语义与后端 `POST /admin/channels/:id/models/batch-reprice` 一一对应：
 *   - 只改**已启用价格档**的售价，不动成本价、不动启停、不动上游键；
 *   - 售价 = 成本 × (1 + 加价率)，half-up 取整到所选积分精度；
 *   - `priceVersion` 是乐观并发令牌：期间有人改过价就整批拒绝，不部分落库。
 *
 * 为什么加价率在前端算：后端只接受最终售价（避免两端口径漂移），
 * 而「按成本重算」是纯展示态的批量操作，放前端可以让每一行都看到算式。
 * 重算是**幂等覆盖**：改加价率或小数位会按成本重算全部行，覆盖手动修改。
 */

const DECIMAL_OPTIONS = Array.from({ length: 7 }, (_, value) => ({
  value: String(value),
  label: `${value} 位小数`,
}));

export function ChannelModelRepriceDialog({
  channelId,
  channelName,
  models,
  onClose,
  onSaved,
}: {
  channelId: string;
  channelName: string;
  models: AdminChannelModelView[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();

  const [markup, setMarkup] = useState<number | undefined>(undefined);
  const [decimalPlaces, setDecimalPlaces] = useState(2);
  const [rows, setRows] = useState<RepriceRow[]>(() => buildRepriceRows(models));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  /** 参与调价的模型：必须全部具备「已启用 + 成本价 + 售价」 */
  const blocking = useMemo(() => repriceBlockingModels(models), [models]);

  /** 原始售价（未修改前），用于算「已修改 N 项」 */
  const original = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of buildRepriceRows(models)) map.set(row.key, row.sale);
    return map;
  }, [models]);

  const changed = useMemo(
    () =>
      rows.filter((row) => {
        try {
          return parseSaleInput(row.sale) !== parseSaleInput(original.get(row.key) ?? '');
        } catch {
          return false;
        }
      }).length,
    [rows, original],
  );

  /** 输入校验错误：任一行的售价不是合法金额就不能保存 */
  const validationError = useMemo(() => {
    if (models.length === 0) return '请至少选择一个渠道模型';
    if (models.length > MAX_REPRICE_MODELS) return `单次最多调整 ${MAX_REPRICE_MODELS} 个渠道模型`;
    if (blocking.length > 0) {
      return `模型 ${blocking.map((item) => item.modelKey).join('、')} 存在未配置成本价或售价的已启用规格，请先在模型编辑里补齐`;
    }
    try {
      for (const row of rows) parseSaleInput(row.sale);
    } catch (e) {
      return e instanceof Error ? e.message : '销售价无效';
    }
    return '';
  }, [models, blocking, rows]);

  /**
   * 调价是 `channel.model_write`（高危）：原因必填。
   *
   * 审计里只有一句「改了价」是不够的 —— 事后对账时要能回答「按什么口径
   * 调的、为什么调」。后端审计拦截器把 `reason` 单独存一列，不写进 detail。
   */
  const reasonMissing = reason.trim().length === 0;

  const recalculate = (nextMarkup: number | undefined, nextPlaces: number) => {
    setMarkup(nextMarkup);
    setDecimalPlaces(nextPlaces);
    if (nextMarkup === undefined) return;
    if (!isValidMarkup(nextMarkup)) {
      toast.error('请输入 0% 到 1000% 的加价率，最多两位小数');
      return;
    }
    const next = buildRepriceRows(models);
    for (const row of next) {
      if (row.cost === null) continue;
      const sale = computeRepriceSale(row.cost, nextMarkup, nextPlaces);
      if (sale === null) {
        toast.error(`${row.modelName}（${row.specLabel}）：调整后售价超出上限`);
        return;
      }
      row.sale = saleInputValue(sale);
      row.manual = false;
    }
    setRows(next);
  };

  const save = async () => {
    if (validationError || reasonMissing || !changed || saving) return;
    setSaving(true);
    try {
      const payload = buildPayload(models, rows);
      const result = await adminChannelsApi.batchRepriceModels(
        channelId,
        payload,
        reason.trim(),
      );
      toast.success(`已保存 ${result.updated} 个模型的售价`);
      try {
        await onSaved();
      } catch {
        toast.error('价格已保存，但列表刷新失败，请手动刷新');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '统一调价失败');
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      width={1080}
      title={`统一调价 · ${models.length} 个模型`}
      description={`渠道 ${channelName}：只改已启用规格的售价，不改成本与启停状态`}
      footer={
        <>
          <Button variant="secondary" size="small" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="small"
            disabled={saving || Boolean(validationError) || reasonMissing || changed === 0}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : changed > 0 ? `保存售价（${changed} 项）` : '保存售价'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[180px]">
            <FormField label="加价率" hint="0–1000%，最多两位小数">
              <NumberInput
                ariaLabel="加价率"
                value={markup}
                min={0}
                max={MAX_REPRICE_MARKUP_PERCENT}
                disabled={saving}
                onChange={(value) => recalculate(value, decimalPlaces)}
              />
            </FormField>
          </div>
          <div className="w-[150px]">
            <FormField label="保留小数位" hint="按此精度一次四舍五入">
              <SelectBox
                ariaLabel="保留小数位"
                value={String(decimalPlaces)}
                options={DECIMAL_OPTIONS}
                disabled={saving}
                onChange={(value) =>
                  recalculate(markup, value === undefined ? decimalPlaces : Number(value))
                }
              />
            </FormField>
          </div>
          <Button
            variant="secondary"
            size="small"
            leadingIcon={Calculator}
            disabled={saving || markup === undefined}
            onClick={() => recalculate(markup, decimalPlaces)}
          >
            按成本重算
          </Button>
          <div className="flex-1 text-[11px] leading-4 text-text-tertiary">
            新售价 = 成本价 ×（1 + 加价率）。改加价率或小数位会按成本重算全部规格售价，
            <strong className="font-medium text-text-secondary">覆盖手动修改</strong>；重算后仍可逐项编辑，保存以输入框的最终值为准。
          </div>
        </div>

        {validationError && (
          <Notice tone="warn" title="无法提交">
            {validationError}
          </Notice>
        )}

        <RepriceTable rows={rows} disabled={saving} onSaleChange={(key, value) =>
          setRows((current) =>
            current.map((row) => (row.key === key ? { ...row, sale: value, manual: true } : row)),
          )
        } />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-tertiary">
            {rows.length} 个计费项 · 已修改 {changed} 项 ·
            四舍五入及手动修改可能使实际加价率偏离目标；价格配置发生变化时整批拒绝保存，请刷新后重试。
          </span>
          <div className="w-[280px]">
            <FormField
              label="变更原因"
              required
              hint="写入审计，建议写清加价口径"
              error={reasonMissing ? '调价是高危写操作，必须填写原因' : null}
            >
              <TextInput
                ariaLabel="变更原因"
                value={reason}
                disabled={saving}
                onChange={setReason}
                placeholder="如：统一按 20% 加价率调价"
                maxLength={200}
              />
            </FormField>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}

/**
 * 组装提交体。
 *
 * 每个模型只提交「已启用」的价格档，且必须带上该档的全部售价字段 ——
 * 少一个或多一个都会被后端整批拒绝（这是刻意的：半份价格会算错账）。
 */
function buildPayload(
  models: AdminChannelModelView[],
  rows: RepriceRow[],
): ChannelModelRepriceInput[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return models.map((model) => {
    const tiers = model.priceTiers.filter((tier) => tier.enabled);
    return {
      modelId: model.id,
      priceVersion: model.priceVersion,
      priceTiers: tiers.map((tier) => {
        const prices: Record<string, number> = {};
        for (const row of rows) {
          if (row.tierId !== tier.id) continue;
          prices[row.field.key] = parseSaleInput(row.sale);
        }
        return { id: tier.id, priceVersion: tier.priceVersion, prices };
      }),
    };
  });
}

/** 调价明细表：一个模型一格，格内按规格逐行列出成本与售价 */
function RepriceTable({
  rows,
  disabled,
  onSaleChange,
}: {
  rows: RepriceRow[];
  disabled: boolean;
  onSaleChange: (key: string, value: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, RepriceRow[]>();
    for (const row of rows) {
      const list = map.get(row.modelId) ?? [];
      list.push(row);
      map.set(row.modelId, list);
    }
    return [...map.values()];
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border-table px-3 py-6 text-center text-xs text-text-tertiary">
        所选模型没有已启用的价格档，无法调价。
      </p>
    );
  }

  return (
    <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-lg border border-border-table p-2">
      {groups.map((group) => (
        <div key={group[0].modelId} className="rounded-lg border border-border-table">
          <div className="flex items-center gap-2 border-b border-border-table px-3 py-2">
            <span className="font-mono text-[12px] text-text-primary">{group[0].modelKey}</span>
            <span className="text-[11px] text-text-tertiary">
              {group[0].modelName}
              {group[0].channelLabel ? ` · ${group[0].channelLabel}` : ''}
              {group[0].providerModelKey ? ` · 上游 ${group[0].providerModelKey}` : ''}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-border-table">
            {group.map((row) => {
              let sale: number | null = null;
              try {
                sale = parseSaleInput(row.sale);
              } catch {
                // 输入未完成：保持可见并阻止保存
                sale = null;
              }
              return (
                <div key={row.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 w-[240px]">
                    <div className="truncate text-[12px] text-text-primary">{row.specLabel}</div>
                    <div className="truncate text-[11px] text-text-tertiary">
                      {row.field.label ? `${row.field.label} · ` : ''}
                      成本 {row.cost === null ? '未配置' : saleInputValue(row.cost)}
                    </div>
                  </div>
                  <div className="w-[160px]">
                    <TextInput
                      ariaLabel={`${row.modelName} ${row.specLabel} ${row.field.label} 销售价`}
                      value={row.sale}
                      disabled={disabled}
                      onChange={(value) => onSaleChange(row.key, value)}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="flex-1 text-[11px] text-text-tertiary">
                    {sale === null ? (
                      <span className="text-rose-600">售价无效</span>
                    ) : (
                      <>
                        {row.manual ? '手动修改 · ' : ''}
                        加价 {formatMarkup(row.cost, sale)}
                        <span className="ml-2">积分 / {row.field.unit}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
