import { useCallback, useMemo, useState } from 'react';
import { adminPaymentProvidersApi } from './api';
import {
  ActionButton,
  Drawer,
  EmptyState,
  FormField,
  ListError,
  NumberField,
  SegmentedGroup,
  SelectField,
  SkeletonCards,
  StaleError,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import {
  useAdmin,
  useAdminResource,
  useDiscardConfirm,
  useRefreshOnNonce,
  useToast,
  useUnsavedGuard,
} from './hooks';
import type {
  AdminPaymentProviderView,
  PaymentConfigField,
} from '../../../types/payment';
import { missingRequiredLabels, providerState } from './utils';
import {
  PAYMENT_PROVIDER_STATE_META,
  type PaymentProviderState,
} from './constants';
import { PaymentsProviderCard } from './PaymentsProviderCard';
import { PaymentsProviderSummary } from './PaymentsProviderSummary';

/**
 * 支付渠道标签。
 *
 * 渠道配置**加密落库并版本化**：每次保存追加一个新版本，历史订单固定用
 * 下单时的版本（换密钥后旧订单的回调仍要能验签）。所以本页不做「删除渠道」，
 * 只做「保存」和「停用」。
 *
 * 密钥字段后端只回「是否已配置」，不回明文 —— 输入框留空即表示沿用旧值。
 */

/** 列表默认按「需要处理」的优先级排序，异常渠道永远先出现。 */
const PROVIDER_STATE_RANK: Record<PaymentProviderState, number> = {
  misconfigured: 0,
  unconfigured: 1,
  usable: 2,
  disabled: 3,
};

interface ConfigDraft {
  enabled: boolean;
  closeAfterMinutes: number;
  /** 字段名 → 输入值 */
  values: Record<string, string>;
}

/** 打开抽屉时的初始草稿：非密字段回填，密字段留空（空 = 沿用旧值） */
function toDraft(provider: AdminPaymentProviderView): ConfigDraft {
  const values: Record<string, string> = {};
  for (const field of provider.configFields) {
    if (field.secret) continue;
    values[field.name] = provider.values[field.name] ?? '';
  }
  return {
    enabled: provider.enabled,
    closeAfterMinutes: provider.closeAfterMinutes,
    values,
  };
}

export function PaymentsProvidersTab({ refreshNonce }: { refreshNonce: number }) {
  const toast = useToast();
  const { can } = useAdmin();
  const writable = can('payment.write');

  const { data, loading, error, reload } = useAdminResource(() =>
    adminPaymentProvidersApi.list(),
  );

  // 刷新按钮只重取数据，不重置当前状态筛选
  useRefreshOnNonce(refreshNonce, reload);

  const [editing, setEditing] = useState<AdminPaymentProviderView | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [saving, setSaving] = useState(false);
  /** 卡片区的状态筛选；只影响展示，不改数据源 */
  const [stateFilter, setStateFilter] = useState('all');

  // 密字段留空 = 沿用旧值；任何改动在关闭抽屉前都要确认，避免白填一遍密钥
  const dirty = useMemo(() => {
    if (!editing || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(editing));
  }, [draft, editing]);
  useUnsavedGuard(dirty && !saving);

  const openConfig = useCallback((provider: AdminPaymentProviderView) => {
    setEditing(provider);
    setDraft(toDraft(provider));
  }, []);

  const closeConfig = useCallback(() => {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }, [saving]);

  const requestCloseConfig = useDiscardConfirm(dirty && !saving, closeConfig);

  const providers = data?.items ?? [];

  /*
   * 派生量全部在**早退之前**算完。
   *
   * 早退（骨架 / 失败 / 空态）在 hook 之后是安全的，在 hook 之前不是 ——
   * 加载态与数据态渲染的 hook 数量不同，React 会直接报错。把派生计算提到
   * 早退之前，hook 顺序就恒定。
   */
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const provider of providers) {
      const state = providerState(provider);
      counts[state] = (counts[state] ?? 0) + 1;
    }
    return counts;
  }, [providers]);

  /* 筛选档位只列**真的有渠道**的那些；「全部」始终在。 */
  const filterOptions = useMemo(() => {
    const options = [{ value: 'all', label: '全部' }];
    for (const [state, meta] of Object.entries(PAYMENT_PROVIDER_STATE_META)) {
      const count = stateCounts[state] ?? 0;
      if (count > 0) options.push({ value: state, label: meta.label });
    }
    return options;
  }, [stateCounts]);

  const visibleProviders = useMemo(() => {
    const filtered =
      stateFilter === 'all'
        ? providers
        : providers.filter((provider) => providerState(provider) === stateFilter);

    return [...filtered].sort((a, b) => {
      const rankDiff =
        PROVIDER_STATE_RANK[providerState(a)] - PROVIDER_STATE_RANK[providerState(b)];
      return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [providers, stateFilter]);

  /* 标签页内的加载骨架只占卡片区域，页头、页签、提示条已经渲染好了。 */
  if (loading && !data) {
    return (
      <SkeletonCards
        count={6}
        className="mt-0"
        gridClassName="grid-cols-1 lg:grid-cols-2"
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data || providers.length === 0) return <EmptyState title="没有发现支付渠道" />;

  return (
    <div className="flex flex-col gap-3">
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      <PaymentsProviderSummary providers={providers} />

      <div className="flex items-center justify-between gap-4 px-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="m-0 text-[13px] font-semibold text-foreground">渠道列表</h2>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {visibleProviders.length} 个
          </span>
        </div>
        {filterOptions.length > 2 && (
          <SegmentedGroup
            value={stateFilter}
            onChange={setStateFilter}
            options={filterOptions}
            ariaLabel="按渠道状态筛选"
          />
        )}
      </div>

      {visibleProviders.length === 0 ? (
        <EmptyState title="该状态下暂无渠道" />
      ) : (
        <div
          data-testid="admin-provider-grid"
          className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2"
        >
          {visibleProviders.map((provider) => (
            <PaymentsProviderCard
              key={provider.id}
              provider={provider}
              writable={writable}
              onConfigure={() => openConfig(provider)}
            />
          ))}
        </div>
      )}

      {editing && draft && (
        <ProviderConfigDrawer
          provider={editing}
          draft={draft}
          writable={writable}
          saving={saving}
          onDraftChange={setDraft}
          onClose={requestCloseConfig}
          onSubmit={async () => {
            setSaving(true);
            try {
              const result = await adminPaymentProvidersApi.saveConfig(editing.id, {
                enabled: draft.enabled,
                closeAfterMinutes: draft.closeAfterMinutes,
                values: draft.values,
              });
              toast.success(result.unchanged ? '配置未变化' : '配置已保存');
              closeConfig();
              reload();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : '保存失败');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * 渠道配置抽屉。
 *
 * 只提交**用户实际改过**的字段：密字段留空表示沿用旧值，若把空串也提交上去
 * 会把已存的密钥清掉。
 */
function ProviderConfigDrawer({
  provider,
  draft,
  writable,
  saving,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  provider: AdminPaymentProviderView;
  draft: ConfigDraft;
  writable: boolean;
  saving: boolean;
  onDraftChange: (draft: ConfigDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const locked = new Set(provider.identityLockedFields);

  /**
   * 必填项判定基于**当前草稿**，不是已保存的值。
   *
   * 之前用 `provider.missing`（已存配置）有两个问题：用户刚补上必填项提示
   * 还挂着；用户清空必填项提示不出现，但保存时后端会 400。
   */
  const missingRequired = missingRequiredLabels(
    provider.configFields,
    draft.values,
    provider.secretConfigured,
  );

  const setValue = (name: string, value: string) => {
    onDraftChange({ ...draft, values: { ...draft.values, [name]: value } });
  };

  // 启用状态下缺必填项时不允许保存 —— 否则后端会 400，错误信息还很难懂
  const submitDisabled =
    !writable ||
    saving ||
    (draft.enabled && missingRequired.length > 0) ||
    draft.closeAfterMinutes < 5 ||
    draft.closeAfterMinutes > 1440;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`配置 ${provider.name}`}
      width={620}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton
            onClick={onSubmit}
            disabled={submitDisabled}
          >
            {saving ? '保存中…' : '保存'}
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/*
         * 开关与关闭时间归为一组「渠道行为」，参数归为另一组「渠道参数」。
         * 两组之间用分隔线断开，而不是各自套一个盒子 —— 表单里嵌套边框会
         * 让抽屉变成「框里还有框」，读起来更碎。
         */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4">
            <FormField label="渠道配置启用">
              <SwitchField
                checked={draft.enabled}
                onChange={(checked) => onDraftChange({ ...draft, enabled: checked })}
                label={draft.enabled ? '已启用' : '已停用'}
                disabled={!writable}
                ariaLabel="渠道配置启用"
              />
            </FormField>

            <FormField
              label="未支付订单自动关闭时间（分钟）"
              hint="5–1440 分钟。超时后系统会先向渠道查单，确认未支付才关单。"
            >
              <NumberField
                value={draft.closeAfterMinutes}
                onChange={(value) =>
                  onDraftChange({ ...draft, closeAfterMinutes: value ?? 30 })
                }
                min={5}
                max={1440}
                step={5}
                disabled={!writable}
                ariaLabel="未支付订单自动关闭时间"
              />
            </FormField>
          </div>

          {provider.configFields.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div>
                <span className="text-xs font-medium text-foreground">渠道参数</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  密钥类字段不回显；留空表示沿用上一版
                </span>
              </div>
              {provider.configFields.map((field: PaymentConfigField) => {
                const isLocked = locked.has(field.name);
                const isSecret = Boolean(field.secret);
                const configured = provider.secretConfigured[field.name];
                const controlId = `provider-field-${field.name}`;

                if (field.type === 'select' && field.options?.length) {
                  return (
                    <FormField
                      key={field.name}
                      label={field.label}
                      required={field.required}
                      hint={
                        isLocked
                          ? '已有订单绑定，不能修改'
                          : (field.description ?? undefined)
                      }
                    >
                      <SelectField
                        id={controlId}
                        value={draft.values[field.name] || undefined}
                        onChange={(value) => setValue(field.name, value ?? '')}
                        options={field.options}
                        disabled={!writable || isLocked}
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
                      hint={
                        isLocked
                          ? '已有订单绑定，不能修改'
                          : (field.description ?? undefined)
                      }
                    >
                      <TextAreaField
                        id={controlId}
                        value={draft.values[field.name] ?? ''}
                        onChange={(value) => setValue(field.name, value)}
                        disabled={!writable || isLocked}
                      />
                    </FormField>
                  );
                }

                return (
                  <FormField
                    key={field.name}
                    label={field.label}
                    required={field.required}
                    hint={
                      isLocked
                        ? '已有订单绑定，不能修改'
                        : [
                            field.description,
                            isSecret && configured ? '已配置，留空表示沿用' : null,
                          ]
                            .filter(Boolean)
                            .join('；') || undefined
                    }
                  >
                    <TextField
                      id={controlId}
                      type={isSecret ? 'password' : 'text'}
                      value={draft.values[field.name] ?? ''}
                      onChange={(value) => setValue(field.name, value)}
                      placeholder={
                        isSecret && configured
                          ? '已配置，留空表示沿用'
                          : (field.placeholder ?? '')
                      }
                      disabled={!writable || isLocked}
                    />
                  </FormField>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
