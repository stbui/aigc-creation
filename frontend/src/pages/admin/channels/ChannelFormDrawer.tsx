import { useEffect, useMemo, useState } from 'react';
import {
  ActionButton,
  Drawer,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from '~/admin-ui/primitives';
import { ChannelHeadersEditor } from './ChannelHeadersEditor';
import { Field } from './ChannelField';
import { useProtocolCatalog } from './useChannelModels';
import type { ChannelDraft } from './constants';
import type { AdminChannelView } from '../../../types/model';

interface ChannelFormDrawerProps {
  open: boolean;
  editing: AdminChannelView | null;
  draft: ChannelDraft;
  dirty: boolean;
  saving: boolean;
  writable: boolean;
  onChange: (patch: Partial<ChannelDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 渠道新建 / 编辑抽屉：凭证留空表示不修改已有值 */
export function ChannelFormDrawer({
  open,
  editing,
  draft,
  dirty,
  saving,
  writable,
  onChange,
  onClose,
  onSubmit,
}: ChannelFormDrawerProps) {
  const { protocols: protocolCatalog, loading: presetLoading } = useProtocolCatalog('');
  const presets = useMemo(
    () => protocolCatalog.filter((item) => String(item.baseUrl ?? '').trim() !== ''),
    [protocolCatalog],
  );
  const [presetId, setPresetId] = useState('');
  const preset = presets.find((item) => item.id === presetId);
  const credentialField = preset?.configuration?.find(
    (field) => field.name === preset.credentialField,
  );
  const secretField = preset?.configuration?.find(
    (field) => field.name === preset.secretField,
  );

  useEffect(() => {
    if (!open) setPresetId('');
  }, [open]);

  const applyPreset = (id: string | undefined) => {
    if (!id) {
      setPresetId('');
      return;
    }
    const next = presets.find((item) => item.id === id);
    if (!next) return;
    setPresetId(id);
    onChange({
      baseUrl: next.baseUrl || draft.baseUrl,
      // 名称只在用户没填时带入，避免覆盖已输入的自定义命名
      name: draft.name.trim() ? draft.name : next.label,
    });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title={editing ? '编辑供应商' : '接入供应商'}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={saving || !writable} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '接入'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-foreground">供应商信息</h3>
          <Field
            label="服务商预设"
            hint="选择后自动填写服务地址与凭证字段名称；也可完全不选，手工配置"
          >
            <SelectField
              ariaLabel="服务商预设"
              value={presetId || undefined}
              options={presets.map((item) => ({
                value: item.id,
                label: `${item.label}（${item.id}）`,
              }))}
              placeholder={presetLoading ? '读取中…' : '自定义'}
              allowClear
              clearLabel="自定义"
              disabled={!writable || presetLoading}
              onChange={applyPreset}
            />
          </Field>
          <Field label="供应商名称">
            <TextField
              ariaLabel="供应商名称"
              value={draft.name}
              onChange={(value) => onChange({ name: value })}
              placeholder="如 火山方舟-主"
              maxLength={80}
            />
          </Field>

          <Field label="服务地址" hint="服务商提供的接口地址">
            <TextField
              ariaLabel="服务地址"
              value={draft.baseUrl}
              onChange={(value) => onChange({ baseUrl: value })}
              placeholder={preset?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}
            />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-xs font-semibold text-foreground">访问凭证</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              用于验证渠道的调用权限，保存后不再显示。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={credentialField?.label || '访问凭证'}
              hint={
                editing?.hasApiKey
                  ? '已配置，留空保持不变'
                  : editing
                    ? '仅保存加密信息，不会再次显示'
                    : '新建时必填，仅保存加密信息，不会再次显示'
              }
            >
              <TextField
                ariaLabel="访问凭证"
                type="password"
                value={draft.apiKey}
                onChange={(value) => onChange({ apiKey: value })}
                placeholder={
                  editing?.hasApiKey
                    ? '••••••（不修改）'
                    : preset && credentialField?.label
                      ? `输入${credentialField.label}`
                      : '输入访问凭证'
                }
              />
            </Field>
            <Field
              label={secretField?.label || '签名密钥'}
              hint={
                editing?.hasSecretKey
                  ? '已配置，留空保持不变'
                  : preset?.secretField
                    ? `该服务商需要同时填写${secretField?.label || '签名密钥'}`
                    : '服务商要求额外签名时填写'
              }
            >
              <TextField
                ariaLabel="签名密钥"
                type="password"
                value={draft.secretKey}
                onChange={(value) => onChange({ secretKey: value })}
                placeholder={
                  editing?.hasSecretKey
                    ? '••••••（不修改）'
                    : preset?.secretField
                      ? `输入${secretField?.label || '签名密钥'}`
                      : '如无则留空'
                }
              />
            </Field>
          </div>
        </section>

        <details className="group rounded-lg border border-border bg-muted/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
            <span className="text-xs font-semibold text-foreground">高级设置</span>
            <span className="text-[12px] text-muted-foreground">
              仅在服务商有特殊接入要求时配置
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-border p-3">
            <Field label="展示顺序" hint="数字越小，位置越靠前">
              <NumberField
                ariaLabel="展示顺序"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
              />
            </Field>

            <ChannelHeadersEditor
              value={draft.headers}
              onChange={(headers) => onChange({ headers })}
              disabled={!writable}
            />

            <Field label="网络代理" hint="仅在当前网络需要指定出口时填写；留空则直接连接">
              <TextField
                ariaLabel="网络代理"
                value={draft.proxyUrl}
                onChange={(value) => onChange({ proxyUrl: value })}
                placeholder="如 socks5://127.0.0.1:1080 或 http://127.0.0.1:7890"
              />
            </Field>

            <Field label="同时处理任务数" hint="限制该渠道同时处理的任务数量">
              <div className="flex items-center gap-3">
                <SwitchField
                  checked={draft.useGlobalConcurrency}
                  label="沿用全局设置"
                  ariaLabel="沿用全局任务数设置"
                  onChange={(checked) => onChange({ useGlobalConcurrency: checked })}
                />
                {!draft.useGlobalConcurrency && (
                  <NumberField
                    ariaLabel="同时处理任务数"
                    value={Number(draft.concurrencyLimit) || 1}
                    min={1}
                    max={999}
                    onChange={(value) => onChange({ concurrencyLimit: String(value ?? 1) })}
                  />
                )}
              </div>
            </Field>
          </div>
        </details>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <div className="text-xs font-medium text-foreground">启用供应商</div>
            <div className="text-[12px] text-muted-foreground">
              停用后，该供应商的商品不再用于新任务
            </div>
          </div>
          <SwitchField
            checked={draft.enabled}
            ariaLabel="启用供应商"
            onChange={(checked) => onChange({ enabled: checked })}
          />
        </div>
      </div>
    </Drawer>
  );
}
