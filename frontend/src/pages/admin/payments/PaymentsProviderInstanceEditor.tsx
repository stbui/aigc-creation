import { CircleDashed, ShieldAlert } from 'lucide-react';

import {
  ActionButton,
  CheckboxField,
  FormField,
  Notice,
  NumberField,
  SelectField,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import type {
  AdminPaymentProviderInstanceView,
  AdminPaymentProviderView,
  PaymentConfigField,
  PaymentProviderConfigUpdate,
  VisiblePaymentMethod,
} from '../../../types/payment';
import { PAYMENT_METHOD_LABELS, PAYMENT_PROVIDER_STATE_META } from './constants';
import {
  allowedPaymentMethods,
  instanceLabel,
  instanceState,
  missingRequiredLabels,
  togglePaymentMethod,
} from './utils';

/** 实例编辑草稿。金额在 UI 中使用「元」，提交时再转回整数分。 */
export interface InstanceDraft {
  name: string;
  enabled: boolean;
  closeAfterMinutes: number;
  minYuan?: number;
  maxYuan?: number;
  dailyYuan?: number;
  refundEnabled: boolean;
  paymentMethods: VisiblePaymentMethod[];
  values: Record<string, string>;
}

function centsToYuan(cents: number | null): number | undefined {
  return cents == null ? undefined : cents / 100;
}

function yuanToCents(yuan: number | undefined): number | null {
  return yuan == null ? null : Math.round(yuan * 100);
}

/** 把实例配置转成表单草稿：密文字段不回显，留空表示沿用。 */
export function draftFromInstance(
  provider: AdminPaymentProviderView,
  instance: AdminPaymentProviderInstanceView,
): InstanceDraft {
  const values: Record<string, string> = {};
  for (const field of provider.configFields) {
    if (field.secret) {
      values[field.name] = '';
      continue;
    }
    values[field.name] = instance.values[field.name] ?? field.default ?? '';
  }

  return {
    name: instance.name ?? '',
    enabled: instance.enabled,
    closeAfterMinutes: instance.closeAfterMinutes,
    minYuan: centsToYuan(instance.minAmountCents),
    maxYuan: centsToYuan(instance.maxAmountCents),
    dailyYuan: centsToYuan(instance.dailyLimitCents),
    refundEnabled: instance.refundEnabled,
    paymentMethods: [...instance.paymentMethods],
    values,
  };
}

/** 新实例草稿：默认停用，服务商实例创建后由用户补齐凭据再启用。 */
export function draftForNewInstance(
  provider: AdminPaymentProviderView,
): InstanceDraft {
  const values: Record<string, string> = {};
  for (const field of provider.configFields) {
    values[field.name] = field.secret ? '' : (field.default ?? '');
  }
  return {
    name: '',
    enabled: false,
    closeAfterMinutes: 30,
    minYuan: undefined,
    maxYuan: undefined,
    dailyYuan: undefined,
    refundEnabled: true,
    paymentMethods: allowedPaymentMethods(provider.id),
    values,
  };
}

/** 草稿 → 保存入参。空金额项显式传 null，表示不限。 */
export function draftToConfigUpdate(
  draft: InstanceDraft,
): PaymentProviderConfigUpdate {
  return {
    name: draft.name.trim() || null,
    enabled: draft.enabled,
    closeAfterMinutes: draft.closeAfterMinutes,
    values: draft.values,
    minAmountCents: yuanToCents(draft.minYuan),
    maxAmountCents: yuanToCents(draft.maxYuan),
    dailyLimitCents: yuanToCents(draft.dailyYuan),
    refundEnabled: draft.refundEnabled,
    paymentMethods: draft.paymentMethods,
  };
}

export function instanceDraftChanged(
  draft: InstanceDraft,
  baseline: InstanceDraft,
): boolean {
  return JSON.stringify(draft) !== JSON.stringify(baseline);
}

/**
 * 单个实例编辑器。
 *
 * 金额按元输入、按分提交；密文字段始终以空值开始，避免把「未修改」误存成
 * 清空密钥。启用前会在前端先按当前草稿校验必填项，减少一次可解释的 400。
 */
export function PaymentsProviderInstanceEditor({
  provider,
  instance,
  draft,
  baseline,
  writable,
  saving,
  onDraftChange,
  onSave,
}: {
  provider: AdminPaymentProviderView;
  instance: AdminPaymentProviderInstanceView;
  draft: InstanceDraft;
  baseline: InstanceDraft;
  writable: boolean;
  saving: boolean;
  onDraftChange: (draft: InstanceDraft) => void;
  onSave: () => void;
}) {
  const state = instanceState(instance);
  const stateMeta = PAYMENT_PROVIDER_STATE_META[state];
  const locked = new Set(instance.identityLockedFields);
  const allowedMethods = allowedPaymentMethods(provider.id);
  const missingRequired = draft.enabled
    ? missingRequiredLabels(
        provider.configFields,
        draft.values,
        instance.secretConfigured,
      )
    : [];
  const rangeInvalid =
    draft.minYuan != null &&
    draft.maxYuan != null &&
    draft.minYuan > draft.maxYuan;
  const timeoutInvalid =
    draft.closeAfterMinutes < 5 || draft.closeAfterMinutes > 1440;
  const methodInvalid = draft.paymentMethods.length === 0;
  const dirty = instanceDraftChanged(draft, baseline);
  const canSave =
    writable &&
    !saving &&
    !rangeInvalid &&
    !timeoutInvalid &&
    !methodInvalid &&
    missingRequired.length === 0;

  const setValue = (name: string, value: string) => {
    onDraftChange({ ...draft, values: { ...draft.values, [name]: value } });
  };

  const toggleMethod = (method: VisiblePaymentMethod) => {
    onDraftChange({
      ...draft,
      paymentMethods: togglePaymentMethod(
        draft.paymentMethods,
        method,
        allowedMethods,
      ),
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-[15px] font-semibold text-foreground">
              {instanceLabel(instance)}
            </h3>
            <StatusTag
              status={state}
              tone={stateMeta.tone}
              label={stateMeta.label}
              showDot={state === 'usable'}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <code className="font-mono">{instance.instanceId}</code>
            <span>
              {instance.version == null ? '尚未保存' : `配置 v${instance.version}`}
            </span>
            {instance.hasOpenOrders && <span>已有在途订单</span>}
          </div>
        </div>
        {!writable && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <CircleDashed className="size-3.5" aria-hidden />
            只读
          </span>
        )}
      </div>

      {instance.warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {instance.warnings.map((warning, index) => (
            <Notice
              key={`${warning.level}-${index}`}
              tone={warning.level === 'danger' ? 'danger' : 'warn'}
              className="mb-0"
            >
              {warning.message}
            </Notice>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <FormField
          label="实例名称"
          hint="用于后台识别；留空时显示「默认实例」或实例 ID。改名不影响历史订单。"
        >
          <TextField
            id="payment-instance-name"
            value={draft.name}
            onChange={(name) => onDraftChange({ ...draft, name })}
            maxLength={80}
            placeholder={instance.instanceId === 'default' ? '默认实例' : '例如：支付宝主账号'}
            disabled={!writable || saving}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="启用实例"
            hint={draft.enabled ? '可用实例会参与负载均衡' : '停用后不参与新订单分配'}
          >
            <SwitchField
              checked={draft.enabled}
              onChange={(enabled) => onDraftChange({ ...draft, enabled })}
              label={draft.enabled ? '已启用' : '已停用'}
              disabled={!writable || saving}
              ariaLabel="启用服务商实例"
            />
          </FormField>

          <FormField
            label="退款功能"
            hint="关闭后该实例不再发起退款；历史退款仍可查询。"
          >
            <SwitchField
              checked={draft.refundEnabled}
              onChange={(refundEnabled) =>
                onDraftChange({ ...draft, refundEnabled })
              }
              label={draft.refundEnabled ? '允许退款' : '禁止退款'}
              disabled={!writable || saving}
              ariaLabel="服务商实例退款功能"
            />
          </FormField>
        </div>

        {draft.enabled && missingRequired.length > 0 && (
          <Notice tone="warn" className="mb-0">
            启用前还需补齐：{missingRequired.join('、')}
          </Notice>
        )}
        {rangeInvalid && (
          <Notice tone="danger" className="mb-0">
            单笔最小金额不能大于单笔最大金额。
          </Notice>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="订单超时（分钟）"
            hint="5–1440 分钟。超时后系统先查单，确认未支付才关闭。"
          >
            <NumberField
              value={draft.closeAfterMinutes}
              onChange={(value) =>
                onDraftChange({ ...draft, closeAfterMinutes: value ?? 30 })
              }
              min={5}
              max={1440}
              step={5}
              disabled={!writable || saving}
              ariaLabel="实例订单超时分钟数"
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4">
            <FormField label="支付方式" hint="至少保留一个；官方渠道只能选择对应方式。">
              <div className="flex flex-wrap gap-4 pt-1">
                {allowedMethods.map((method) => {
                  const checked = draft.paymentMethods.includes(method);
                  return (
                    <CheckboxField
                      key={method}
                      checked={checked}
                      onChange={() => toggleMethod(method)}
                      label={PAYMENT_METHOD_LABELS[method]}
                      disabled={
                        !writable ||
                        saving ||
                        (checked && draft.paymentMethods.length === 1)
                      }
                    />
                  );
                })}
              </div>
            </FormField>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="单笔最小（元）" hint="留空表示不限">
            <NumberField
              value={draft.minYuan}
              onChange={(minYuan) => onDraftChange({ ...draft, minYuan })}
              min={0}
              step={0.01}
              disabled={!writable || saving}
              ariaLabel="实例单笔最小金额"
            />
          </FormField>
          <FormField label="单笔最大（元）" hint="留空表示不限">
            <NumberField
              value={draft.maxYuan}
              onChange={(maxYuan) => onDraftChange({ ...draft, maxYuan })}
              min={0}
              step={0.01}
              disabled={!writable || saving}
              ariaLabel="实例单笔最大金额"
            />
          </FormField>
          <FormField label="每日限额（元）" hint="留空表示不限">
            <NumberField
              value={draft.dailyYuan}
              onChange={(dailyYuan) => onDraftChange({ ...draft, dailyYuan })}
              min={0}
              step={0.01}
              disabled={!writable || saving}
              ariaLabel="实例每日限额"
            />
          </FormField>
        </div>
      </div>

      {provider.configFields.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <span className="text-xs font-medium text-foreground">服务商参数</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              密钥类字段不回显；留空表示沿用上一次保存的值。
            </span>
          </div>
          {provider.configFields.map((field) =>
            renderConfigField({
              field,
              secretConfigured: instance.secretConfigured[field.name],
              locked: locked.has(field.name),
              value: draft.values[field.name] ?? '',
              disabled: !writable || saving,
              onChange: (value) => setValue(field.name, value),
            }),
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-[12px] text-muted-foreground">
          {dirty ? '有未保存的修改' : '所有修改已保存'}
        </span>
        <div className="flex items-center gap-2">
          {!writable && <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />}
          <ActionButton
            onClick={onSave}
            disabled={!canSave || !dirty}
          >
            {saving ? '保存中…' : '保存实例'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function renderConfigField({
  field,
  secretConfigured,
  locked,
  value,
  disabled,
  onChange,
}: {
  field: PaymentConfigField;
  secretConfigured: boolean | undefined;
  locked: boolean;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const hint = locked
    ? '已有订单绑定，不能修改'
    : [
        field.description,
        field.secret && secretConfigured ? '已配置，留空表示沿用' : null,
      ]
        .filter(Boolean)
        .join('；');

  if (field.type === 'select' && field.options?.length) {
    return (
      <FormField
        key={field.name}
        label={field.label}
        required={field.required}
        hint={hint || undefined}
      >
        <SelectField
          value={value || undefined}
          onChange={(next) => onChange(next ?? '')}
          options={field.options}
          disabled={disabled || locked}
          ariaLabel={field.label}
        />
      </FormField>
    );
  }

  if (field.type === 'textarea') {
    return (
      <FormField
        key={field.name}
        label={field.label}
        required={field.required}
        hint={hint || undefined}
      >
        <TextAreaField
          value={value}
          onChange={onChange}
          rows={4}
          disabled={disabled || locked}
          placeholder={
            field.secret && secretConfigured
              ? '已配置，留空表示沿用'
              : field.placeholder
          }
          maxLength={field.maxLength}
          ariaLabel={field.label}
        />
      </FormField>
    );
  }

  return (
    <FormField
      key={field.name}
      label={field.label}
      required={field.required}
      hint={hint || undefined}
    >
      <TextField
        value={value}
        onChange={onChange}
        type={field.secret ? 'password' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        maxLength={field.maxLength}
        disabled={disabled || locked}
        placeholder={
          field.secret && secretConfigured
            ? '已配置，留空表示沿用'
            : field.placeholder
        }
        ariaLabel={field.label}
      />
    </FormField>
  );
}
