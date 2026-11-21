import { useMemo, useState } from 'react';
import {
  ActionButton,
  FormDrawer,
  FormField,
  Notice,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from './components';
import type { StorageBackendId, StorageConfigField, StorageConfigView } from './types';
import { META } from './constants';

/** 抽屉内的分区顺序；未标注 group 的字段落在末尾。 */
const GROUP_ORDER = ['连接位置', '读取出口', '服务端凭据', '高级'];

/** 测试结果：stale = 之后又改过字段，结论已过期。 */
interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  stale?: boolean;
}

function groupFields(fields: StorageConfigField[]): Array<{ title: string; fields: StorageConfigField[] }> {
  const buckets = new Map<string, StorageConfigField[]>();
  for (const field of fields) {
    const key = field.group ?? '其他';
    const list = buckets.get(key) ?? [];
    list.push(field);
    buckets.set(key, list);
  }
  const order = [...GROUP_ORDER, ...Array.from(buckets.keys()).filter((k) => !GROUP_ORDER.includes(k))];
  return order.filter((k) => buckets.has(k)).map((k) => ({ title: k, fields: buckets.get(k)! }));
}

/**
 * 云端存储后端的配置抽屉。
 *
 * 字段由后端字段定义（config.fields）驱动，前端不写死字段名 —— 后端加字段时
 * 这里自动跟上，避免前后端两处契约分叉。按 `group` 分区，顺序为
 * 连接位置 → 读取出口 → 服务端凭据 → 高级。
 *
 * 密钥处理：secret 字段初始值为空，hint 展示后端下发的脱敏值；
 * 留空提交 = 沿用库中旧值（后端 saveConfig 的语义），绝不回传明文。
 *
 * 先测后存：抽屉内可用当前草稿做真实读写测试，不落库、不影响默认后端。
 * 任一连接字段变化后测试结论标记为过期，避免拿旧结论背书新配置。
 */
export function StorageConfigDrawer({
  backend,
  view,
  open,
  saving,
  testing,
  onClose,
  onSubmit,
  onTest,
}: {
  backend: StorageBackendId;
  view: StorageConfigView;
  open: boolean;
  saving: boolean;
  testing: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  onTest: (values: Record<string, string>) => Promise<{ ok: boolean; message: string; latencyMs?: number }>;
}) {
  /* 只把非密钥字段的当前值灌入草稿；密钥一律空串（留空 = 沿用）。 */
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.fields.map((f) => [f.name, f.secret ? '' : (view.values[f.name] ?? f.default ?? '')]),
    ),
  );
  const [test, setTest] = useState<TestResult | null>(null);

  const groups = useMemo(() => groupFields(view.fields), [view.fields]);

  const patch = (name: string, value: string) => {
    setDraft((d) => ({ ...d, [name]: value }));
    // 连接字段一改，之前的测试结论不再代表当前草稿
    setTest((prev) => (prev ? { ...prev, stale: true } : prev));
  };

  const runTest = async () => {
    setTest(null);
    const result = await onTest(draft);
    setTest(result);
  };

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={`配置 ${META[backend]?.label ?? backend}`}
      description="保存后即时生效，无需重启服务。建议先测试连接再保存。"
      busy={saving}
      dirty
      submitLabel="保存配置"
      onSubmit={() => onSubmit(draft)}
      extraFooter={
        <ActionButton variant="secondary" disabled={testing || saving} onClick={() => void runTest()}>
          {testing ? '测试中…' : '测试连接'}
        </ActionButton>
      }
    >
      <Notice tone="info" title="凭据加密存储">
        连接参数只保存到数据库，页面仅回显脱敏值；密钥留空表示沿用原值。
      </Notice>

      {test && <TestResultNotice result={test} />}

      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-3" data-testid="admin-storage-group">
          <h4 className="text-[13px] font-semibold text-foreground">{group.title}</h4>
          {group.fields.map((field) => (
            <FieldControl
              key={field.name}
              field={field}
              value={draft[field.name] ?? ''}
              secretConfigured={view.secretConfigured[field.name] === true}
              secretMasked={view.secretMasked[field.name]}
              onChange={(value) => patch(field.name, value)}
            />
          ))}
        </section>
      ))}

      {view.updatedAt && (
        <p className="text-[12px] text-muted-foreground" data-testid="admin-storage-audit">
          最后保存：{new Date(view.updatedAt).toLocaleString('zh-CN', { hour12: false })}
          {view.updatedBy ? ` · ${view.updatedBy}` : ''}
        </p>
      )}
    </FormDrawer>
  );
}

function TestResultNotice({ result }: { result: TestResult }) {
  if (result.stale) {
    return (
      <div data-testid="admin-storage-test-result" data-state="stale">
        <Notice tone="warn" title="配置已变化">
          连接字段在上次测试后又有改动，请重新测试后再保存。
        </Notice>
      </div>
    );
  }
  if (result.ok) {
    return (
      <div data-testid="admin-storage-test-result" data-state="ok">
        <Notice tone="success" title="连接测试通过">
          {result.message}
          {result.latencyMs ? ` · ${result.latencyMs}ms` : ''}
        </Notice>
      </div>
    );
  }
  return (
    <div data-testid="admin-storage-test-result" data-state="failed">
      <Notice tone="danger" title="连接测试失败">
        {result.message}
      </Notice>
    </div>
  );
}

function FieldControl({
  field,
  value,
  secretConfigured,
  secretMasked,
  onChange,
}: {
  field: StorageConfigField;
  value: string;
  secretConfigured: boolean;
  secretMasked?: string;
  onChange: (value: string) => void;
}) {
  const hint = field.secret
    ? secretConfigured
      ? `已配置 ${secretMasked ?? ''} · 留空表示不修改`
      : '尚未配置'
    : field.hint;

  if (field.type === 'switch') {
    return (
      <FormField label={field.label} hint={hint}>
        <SwitchField
          checked={value === 'true'}
          onChange={(checked) => onChange(checked ? 'true' : 'false')}
          ariaLabel={field.label}
        />
      </FormField>
    );
  }

  if (field.type === 'select') {
    return (
      <FormField label={field.label} hint={hint}>
        <SelectField
          value={value || undefined}
          onChange={(next) => onChange(next ?? '')}
          options={field.options ?? []}
          ariaLabel={field.label}
          placeholder={field.placeholder}
        />
      </FormField>
    );
  }

  if (field.type === 'number') {
    return (
      <FormField label={field.label} hint={hint}>
        <NumberField
          value={value === '' ? undefined : Number(value)}
          min={field.min}
          max={field.max}
          ariaLabel={field.label}
          onChange={(next) => onChange(next === undefined ? '' : String(next))}
        />
      </FormField>
    );
  }

  return (
    <FormField label={field.label} required={field.required} hint={hint}>
      <TextField
        ariaLabel={field.label}
        type={field.type === 'password' ? 'password' : 'text'}
        value={value}
        onChange={onChange}
        placeholder={
          field.secret && secretConfigured ? '留空不修改' : (field.placeholder ?? '')
        }
        maxLength={512}
      />
    </FormField>
  );
}