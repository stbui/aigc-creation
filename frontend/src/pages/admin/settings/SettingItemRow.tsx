import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import {
  ActionButton,
  FilePicker,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
  ToneBadge,
} from '~/admin-ui/primitives';
import type { AdminSettingValue } from '../../../types/api';
import type { SettingItem } from './constants';
import { displayValue } from './utils';
import { adminSettingsApi } from '../../../lib/api';

/** 帮助图片上传：选中即上传，上传成功后只把稳定引用写进本地草稿。 */
function ImageUploadControl({
  item,
  value,
  editable,
  onChange,
}: {
  item: SettingItem;
  value: AdminSettingValue;
  editable: boolean;
  onChange: (value: AdminSettingValue) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ value: string; previewUrl: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // 设置重新加载后，服务端返回的预览地址才是当前基准；清掉仅属于旧草稿的本地地址。
    setUploaded((current) =>
      current && current.value !== String(value ?? '') ? null : current,
    );
  }, [value]);

  const currentValue = String(value ?? '');
  const previewUrl =
    currentValue && uploaded?.value === currentValue
      ? uploaded.previewUrl
      : currentValue
        ? item.previewUrl ?? null
        : null;

  const upload = async (next: File) => {
    setFile(next);
    setUploading(true);
    setError('');
    try {
      const result = await adminSettingsApi.uploadImage(next);
      setUploaded({ value: result.value, previewUrl: result.previewUrl });
      onChange(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片上传失败');
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${item.label}预览`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px] text-muted-foreground">
            <ImageIcon className="size-5" aria-hidden />
            暂无图片
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <FilePicker
          file={file}
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          onPick={(next) => void upload(next)}
          onClear={() => setFile(null)}
          disabled={!editable || uploading}
          label={previewUrl ? '更换图片' : '上传图片'}
          hint="PNG / JPEG / WebP"
        />
        {previewUrl && (
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={!editable || uploading}
            onClick={() => {
              setUploaded(null);
              onChange('');
            }}
          >
            移除
          </ActionButton>
        )}
      </div>
      {uploading && (
        <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          正在上传…
        </p>
      )}
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

function renderControl({
  item,
  value,
  editable,
  onChange,
}: {
  item: SettingItem;
  value: AdminSettingValue;
  editable: boolean;
  onChange: (value: AdminSettingValue) => void;
}) {
  if (item.readOnly) {
    /* 只读值不画成输入框：它不是可编辑控件，画成禁用输入框会让人反复去点 */
    return (
      <span className="inline-flex min-h-8 items-center text-right text-[13px] font-medium text-foreground">
        {displayValue(item.value, item.type)}
      </span>
    );
  }

  if (item.control === 'image-upload') {
    return (
      <ImageUploadControl
        item={item}
        value={value}
        editable={editable}
        onChange={onChange}
      />
    );
  }

  if (item.type === 'boolean') {
    return (
      <SwitchField
        checked={Boolean(value)}
        onChange={(checked) => onChange(checked)}
        disabled={!editable}
        ariaLabel={item.label}
      />
    );
  }

  if (item.type === 'number') {
    if (item.enum && item.enum.length > 0) {
      return (
        <SelectField
          value={String(value)}
          onChange={(next) => next !== undefined && onChange(Number(next))}
          options={item.enum.map((next) => ({ value: String(next), label: String(next) }))}
          ariaLabel={item.label}
          disabled={!editable}
          className="w-40"
        />
      );
    }
    return (
      <NumberField
        value={value === null ? undefined : Number(value)}
        min={item.min}
        max={item.max}
        onChange={(next) =>
          onChange(item.nullable ? (next ?? null) : Number(next ?? item.default))
        }
        disabled={!editable}
        ariaLabel={item.label}
        className="w-40"
      />
    );
  }

  if (item.type === 'string' && item.options?.length) {
    return (
      <SelectField
        value={String(value)}
        onChange={(next) => next !== undefined && onChange(next)}
        options={item.options.map((next) => ({
          value: next,
          label: item.optionLabels?.[next] ?? next,
        }))}
        ariaLabel={item.label}
        disabled={!editable}
        className="w-40"
      />
    );
  }

  return (
    <TextField
      value={String(value)}
      onChange={(next) => onChange(next)}
      disabled={!editable}
      ariaLabel={item.label}
      maxLength={item.maxLength}
      className="w-full"
    />
  );
}

/** 单个配置项：左侧说明与元信息、右侧控件，以及只在该项可操作时出现的行内动作。 */
export function SettingItemRow({
  item,
  value,
  isDraft,
  isClearing,
  editable,
  onChange,
  onRevert,
  onClear,
}: {
  item: SettingItem;
  value: AdminSettingValue;
  isDraft: boolean;
  isClearing: boolean;
  editable: boolean;
  onChange: (value: AdminSettingValue) => void;
  onRevert: () => void;
  onClear: () => void;
}) {
  const showActions = !item.readOnly && (isDraft || isClearing || (item.overridden && editable));

  return (
    <div className="flex items-start gap-6 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{item.label}</span>
          {item.readOnly && <ToneBadge tone="neutral">只读</ToneBadge>}
          {item.overridden && !isClearing && (
            <ToneBadge tone="brand">
              <span title="已覆盖代码默认值">已自定义</span>
            </ToneBadge>
          )}
          {isClearing && <ToneBadge tone="warn">待恢复默认</ToneBadge>}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{item.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span>默认值：{displayValue(item.default, item.type)}</span>
          {item.type === 'number' && (item.min !== undefined || item.max !== undefined) && (
            <span>
              取值范围 {item.min ?? '—'} ~ {item.max ?? '—'}
            </span>
          )}
          {item.updatedBy && (
            <span>
              上次修改：{item.updatedBy}
              {item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString('zh-CN')}` : ''}
            </span>
          )}
          {item.linkTo && (
            <Link className="text-brand hover:underline" to={item.linkTo}>
              前往配置 →
            </Link>
          )}
        </div>
      </div>

      {/* 控件列固定 240：不同分组的输入框右边缘落在同一条竖线上 */}
      <div className="flex w-[240px] shrink-0 flex-col items-end gap-1">
        <div className="flex w-full justify-end">{renderControl({ item, value, editable, onChange })}</div>
        {showActions && (
          <div className="flex items-center gap-1">
            {(isDraft || isClearing) && (
              <ActionButton variant="ghost" size="xs" onClick={onRevert} disabled={!editable}>
                撤销
              </ActionButton>
            )}
            {item.overridden && !isClearing && editable && (
              <ActionButton variant="ghost" size="xs" onClick={onClear}>
                恢复默认
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
