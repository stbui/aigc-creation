import { useCallback, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { adminPaymentProvidersApi } from './api';
import {
  ActionButton,
  AdminDataTable,
  Drawer,
  EmptyState,
  FormField,
  ListError,
  Notice,
  NumberField,
  PageSkeleton,
  Panel,
  SelectField,
  StatusTag,
  SwitchField,
  TextAreaField,
  TextField,
  type AdminColumn,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminResource, useToast } from './hooks';
import type {
  AdminPaymentProviderView,
  PaymentConfigField,
} from '../../../types/payment';
import { CHECKOUT_MODE_LABELS } from './constants';

/**
 * 支付渠道标签。
 *
 * 渠道配置**加密落库并版本化**：每次保存追加一个新版本，历史订单固定用
 * 下单时的版本（换密钥后旧订单的回调仍要能验签）。所以本页不做「删除渠道」，
 * 只做「保存新版本」和「停用」。
 *
 * 密钥字段后端只回「是否已配置」，不回明文 —— 输入框留空即表示沿用旧值。
 */

/** 渠道图标：内联小方块，避免拉外链图片（后台不该有第三方资源依赖） */
function ProviderIcon({ icon }: { icon: string }) {
  // 品牌图标色用语义 token，不写裸 hex —— 支付宝/微信的品牌色也不进全站令牌表
  const tone =
    icon === 'alipay'
      ? 'bg-brand/10 text-brand'
      : icon === 'wechat'
        ? 'bg-success-soft text-success-text'
        : icon === 'paypal'
          ? 'bg-brand/10 text-brand'
          : icon === 'stripe'
            ? 'bg-brand/10 text-brand'
            : icon === 'epay'
              ? 'bg-warn-soft text-warn-text'
              : icon === 'zpay'
                ? 'bg-brand/10 text-brand'
                : 'bg-muted text-muted-foreground';
  return (
    <span
      aria-hidden
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${tone}`}
    >
      {icon === 'alipay'
        ? '支'
        : icon === 'wechat'
          ? '微'
          : icon === 'paypal'
            ? 'P'
            : icon === 'stripe'
              ? 'S'
              : icon === 'epay'
                ? '易'
                : icon === 'zpay'
                  ? 'Z'
                  : '沙'}
    </span>
  );
}

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

  // 刷新按钮只重取数据，不重置筛选（本标签无筛选，但保持与其它标签一致的口径）
  useEffect(() => {
    if (refreshNonce > 0) void reload();
  }, [refreshNonce, reload]);

  const [editing, setEditing] = useState<AdminPaymentProviderView | null>(null);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const openConfig = useCallback((provider: AdminPaymentProviderView) => {
    setEditing(provider);
    setDraft(toDraft(provider));
  }, []);

  const closeConfig = useCallback(() => {
    if (saving) return;
    setEditing(null);
    setDraft(null);
  }, [saving]);

  const providers = data?.items ?? [];
  const enabledCount = providers.filter((p) => p.enabled && p.configured).length;

  const columns: Array<AdminColumn<AdminPaymentProviderView>> = [
    {
      key: 'provider',
      title: '支付渠道',
      width: 220,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <ProviderIcon icon={row.icon} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{row.name}</span>
            <code className="font-mono text-[12px] text-muted-foreground">{row.id}</code>
          </div>
        </div>
      ),
    },
    {
      key: 'checkoutMode',
      title: '支付方式',
      width: 100,
      render: (row) => <span className="text-muted-foreground">{CHECKOUT_MODE_LABELS[row.checkoutMode] ?? row.checkoutMode}</span>,
    },
    {
      key: 'status',
      title: '状态',
      width: 200,
      render: (row) => {
        const usable = row.enabled && row.configured;
        return (
          <div className="flex flex-col gap-1">
            <StatusTag
              status={usable ? 'usable' : 'unusable'}
              tone={usable ? 'success' : 'muted'}
              label={usable ? '可用' : '不可用'}
            />
            <span className="text-[12px] text-muted-foreground">
              配置{row.enabled ? '已启用' : '已停用'} ·{' '}
              {row.configured ? '密钥已配齐' : `缺 ${row.missing.length} 项`}
            </span>
          </div>
        );
      },
    },
    {
      key: 'closeAfterMinutes',
      title: '未支付自动关闭',
      width: 130,
      render: (row) => <span>{row.closeAfterMinutes} 分钟</span>,
    },
    {
      key: 'version',
      title: '配置版本',
      width: 100,
      render: (row) =>
        row.version === null ? (
          <span className="text-muted-foreground">未配置</span>
        ) : (
          <code className="font-mono text-xs">v{row.version}</code>
        ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 90,
      render: (row) => (
        <ActionButton
          icon={Settings2}
          onClick={() => openConfig(row)}
          ariaLabel={writable ? `配置${row.name}` : `查看${row.name}`}
        >
          {writable ? '配置' : '查看'}
        </ActionButton>
      ),
    },
  ];

  /*
   * 标签页内的加载骨架只占**这一块面板**的位置：页头、页签、提示条都在上面，
   * 已经渲染好了，不该跟着塌。面板限宽与真实 `Panel` 一致（不限宽）。
   */
  if (loading && !data) {
    return (
      <PageSkeleton panels={1} panelRows={5} />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data) return <EmptyState title="没有发现支付渠道" />;

  const allWarnings = providers.flatMap((p) => p.warnings);

  return (
    <div className="flex flex-col gap-3">
      {allWarnings.length > 0 && (
        <Notice tone={allWarnings.some((w) => w.level === 'danger') ? 'danger' : 'warn'} title="支付渠道风险提示">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {allWarnings.map((w, i) => (
              <li key={`${w.message}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Panel
        title="支付渠道"
        note={`共 ${providers.length} 个渠道，其中 ${enabledCount} 个可用`}
      >
        <AdminDataTable
          rows={providers}
          columns={columns}
          rowKey={(row) => row.id}
          emptyText="没有发现支付渠道"
          minWidth={840}
        />
      </Panel>

      {editing && draft && (
        <ProviderConfigDrawer
          provider={editing}
          draft={draft}
          writable={writable}
          saving={saving}
          onDraftChange={setDraft}
          onClose={closeConfig}
          onSubmit={async () => {
            setSaving(true);
            try {
              const result = await adminPaymentProvidersApi.saveConfig(editing.id, {
                enabled: draft.enabled,
                closeAfterMinutes: draft.closeAfterMinutes,
                values: draft.values,
              });
              toast.success(
                result.unchanged ? '配置未变化，未新增版本' : '已保存为新配置版本',
              );
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
  const missingEnabled = draft.enabled && provider.missing.length > 0;

  const setValue = (name: string, value: string) => {
    onDraftChange({ ...draft, values: { ...draft.values, [name]: value } });
  };

  const submitDisabled =
    !writable ||
    saving ||
    draft.closeAfterMinutes < 5 ||
    draft.closeAfterMinutes > 1440;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`配置 ${provider.name}`}
      description="保存即追加一个新版本，历史订单继续使用下单时的版本"
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
            {saving ? '保存中…' : '保存新版本'}
          </ActionButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">
          密钥加密保存，不会回显到界面；留空表示沿用上一版本的值。
          历史订单固定使用下单时的配置版本，保存新版本不影响在途订单的验签。
        </Notice>

        {missingEnabled && (
          <Notice tone="danger" title="必填项缺失">
            当前渠道仍缺 {provider.missing.length} 项必填配置，启用后发起支付会返回 503。
          </Notice>
        )}

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

        {provider.configFields.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <span className="text-xs font-medium text-foreground">渠道参数</span>
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
                    hint={isLocked ? '已有订单绑定，不能修改' : undefined}
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
                    hint={isLocked ? '已有订单绑定，不能修改' : undefined}
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
                      : isSecret && configured
                        ? '已配置，留空表示沿用'
                        : undefined
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
    </Drawer>
  );
}
