import { Button, Drawer, NumberInput, SwitchBox, TextInput } from './components';
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
      description={
        dirty ? '有未保存修改' : editing ? '凭证留空表示不修改现有值' : '创建后请继续在右侧补模型与价格'
      }
      footer={
        <>
          <Button variant="secondary" size="small" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" size="small" disabled={saving || !writable} onClick={onSubmit}>
            {saving ? '保存中…' : editing ? '保存修改' : '创建'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="渠道名称">
            <TextInput
              ariaLabel="渠道名称"
              value={draft.name}
              onChange={(value) => onChange({ name: value })}
              placeholder="如 火山方舟-主"
              maxLength={80}
            />
          </Field>
          <Field label="排序值" hint="数字越小越靠前">
            <NumberInput
              ariaLabel="排序值"
              value={Number(draft.sortOrder) || 0}
              min={0}
              onChange={(value) => onChange({ sortOrder: String(value ?? 0) })}
            />
          </Field>
        </div>

        <Field label="Base URL" hint="上游 API 根地址，不含 /v1（协议会自行拼接路径）">
          <TextInput
            ariaLabel="Base URL"
            value={draft.baseUrl}
            onChange={(value) => onChange({ baseUrl: value })}
            placeholder="https://ark.cn-beijing.volces.com/api/v3"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="API Key"
            hint={
              editing?.hasApiKey
                ? '已配置，留空表示不修改'
                : editing
                  ? '上游访问凭证，仅加密存储、不回显'
                  : '新建必填：上游访问凭证，仅加密存储、不回显'
            }
          >
            <TextInput
              ariaLabel="API Key"
              type="password"
              value={draft.apiKey}
              onChange={(value) => onChange({ apiKey: value })}
              placeholder={editing?.hasApiKey ? '••••••（不修改）' : '粘贴上游 Key'}
            />
          </Field>
          <Field
            label="Secret Key"
            hint={editing?.hasSecretKey ? '已配置，留空表示不修改' : '仅 SigV4 / TC3 类协议需要'}
          >
            <TextInput
              ariaLabel="Secret Key"
              type="password"
              value={draft.secretKey}
              onChange={(value) => onChange({ secretKey: value })}
              placeholder={editing?.hasSecretKey ? '••••••（不修改）' : '如无则留空'}
            />
          </Field>
        </div>

        <ChannelHeadersEditor
          value={draft.headers}
          onChange={(headers) => onChange({ headers })}
          disabled={!writable}
        />

        <Field
          label="出站代理"
          hint="为该渠道单独配置出站代理，支持 socks5://、socks5h://、http://、https://；留空则直连"
        >
          <TextInput
            ariaLabel="出站代理"
            value={draft.proxyUrl}
            onChange={(value) => onChange({ proxyUrl: value })}
            placeholder="如 socks5://127.0.0.1:1080 或 http://127.0.0.1:7890"
          />
        </Field>

        <Field label="渠道并发上限" hint="后台任务与代理请求共享该上限；槽位暂满时请求会等待">
          <div className="flex items-center gap-3">
            <SwitchBox
              checked={draft.useGlobalConcurrency}
              label="跟随系统"
              ariaLabel="跟随系统并发上限"
              onChange={(checked) => onChange({ useGlobalConcurrency: checked })}
            />
            {!draft.useGlobalConcurrency && (
              <NumberInput
                ariaLabel="渠道并发上限"
                value={Number(draft.concurrencyLimit) || 1}
                min={1}
                max={999}
                onChange={(value) => onChange({ concurrencyLimit: String(value ?? 1) })}
              />
            )}
          </div>
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-border-table px-3 py-2.5">
          <div>
            <div className="text-xs font-medium text-text-primary">启用渠道</div>
            <div className="text-[11px] text-text-tertiary">停用后该渠道的全部模型退出路由目录</div>
          </div>
          <SwitchBox
            checked={draft.enabled}
            ariaLabel="启用渠道"
            onChange={(checked) => onChange({ enabled: checked })}
          />
        </div>

        <Field label="变更原因" hint="写入审计，建议写清改了什么（如：更换上游 Key）">
          <TextInput
            ariaLabel="变更原因"
            value={draft.reason}
            onChange={(value) => onChange({ reason: value })}
            placeholder="如：切换到新上游账号"
            maxLength={200}
          />
        </Field>
      </div>
    </Drawer>
  );
}
