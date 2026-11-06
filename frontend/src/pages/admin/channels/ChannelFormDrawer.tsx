import { ActionButton, Drawer, NumberField, SwitchField, TextField } from '~/admin-ui/primitives';
import { ChannelHeadersEditor } from './ChannelHeadersEditor';
import { Field } from './ChannelField';
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
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width={760}
      title={editing ? '编辑渠道' : '新建渠道'}
      footer={
        <>
          <ActionButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton variant="default" size="sm" disabled={saving || !writable} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold text-foreground">基础信息</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="渠道名称">
              <TextField
                ariaLabel="渠道名称"
                value={draft.name}
                onChange={(value) => onChange({ name: value })}
                placeholder="如 火山方舟-主"
                maxLength={80}
              />
            </Field>
            <Field label="展示顺序" hint="数字越小，位置越靠前">
              <NumberField
                ariaLabel="展示顺序"
                value={Number(draft.sortOrder) || 0}
                min={0}
                onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
              />
            </Field>
          </div>

          <Field label="服务地址" hint="服务商提供的接口地址">
            <TextField
              ariaLabel="服务地址"
              value={draft.baseUrl}
              onChange={(value) => onChange({ baseUrl: value })}
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
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
              label="访问凭证"
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
                placeholder={editing?.hasApiKey ? '••••••（不修改）' : '输入访问凭证'}
              />
            </Field>
            <Field
              label="签名密钥"
              hint={editing?.hasSecretKey ? '已配置，留空保持不变' : '服务商要求额外签名时填写'}
            >
              <TextField
                ariaLabel="签名密钥"
                type="password"
                value={draft.secretKey}
                onChange={(value) => onChange({ secretKey: value })}
                placeholder={editing?.hasSecretKey ? '••••••（不修改）' : '如无则留空'}
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
            <div className="text-xs font-medium text-foreground">启用渠道</div>
            <div className="text-[12px] text-muted-foreground">
              停用后，该渠道的模型不再用于新任务
            </div>
          </div>
          <SwitchField
            checked={draft.enabled}
            ariaLabel="启用渠道"
            onChange={(checked) => onChange({ enabled: checked })}
          />
        </div>
      </div>
    </Drawer>
  );
}
