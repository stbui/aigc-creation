import { Chip } from '../../../vendor/boardui/components/base/badges/chip';
import { Button } from '../../../vendor/boardui/components/base/buttons/button';
import { NumberInput, SwitchBox, TextInput } from '../../../admin-ui/controls';
import { HoverTip } from '../../../admin-ui/controls';
import { TONE_CHIP_COLOR } from '../../../components/admin/statusMeta';
import type { AdminModelConfigItem } from '../../../types/api';
import { SOURCE_META, fmtTime, withoutModalityPrefix } from './meta';

/**
 * 单个配置项（左右两栏：说明 / 控件）。
 *
 * 来源信息只在需要时出现：默认值不挂标签，env 名放进 label tooltip；
 * 只有真被 env 覆盖时，才在正文里显示变量名与后台曾保存的值。
 */
export function ConfigItemRow({
  item,
  value,
  cleared,
  canWrite,
  onChange,
  onToggleClear,
}: {
  item: AdminModelConfigItem;
  value: string | number | boolean | undefined;
  cleared: boolean;
  canWrite: boolean;
  onChange: (value: string | number | boolean) => void;
  onToggleClear: () => void;
}) {
  const meta = SOURCE_META[item.source] ?? SOURCE_META.default;
  const locked = item.source === 'env';
  const label = item.modality ? withoutModalityPrefix(item.label, item.modality) : item.label;

  const control = cleared ? (
    <span className="text-xs text-amber-700">
      保存后恢复为默认值「{String(item.default)}」
    </span>
  ) : item.type === 'boolean' ? (
    <SwitchBox
      checked={Boolean(value)}
      disabled={locked || !canWrite}
      onChange={(next) => onChange(next)}
      ariaLabel={label}
    />
  ) : item.type === 'number' ? (
    <NumberInput
      value={Number(value ?? 0)}
      disabled={locked || !canWrite}
      onChange={(next) => onChange(Number(next ?? 0))}
      ariaLabel={label}
      className="w-full"
    />
  ) : item.type === 'secret' ? (
    <div className="flex items-center gap-2">
      <TextInput
        value={String(value ?? '')}
        placeholder={item.hasValue ? `已配置（${item.masked ?? '***'}），留空保持不变` : '尚未配置'}
        disabled={!canWrite || locked}
        type="password"
        maxLength={200}
        onChange={(next) => onChange(next)}
        ariaLabel={`${label} 访问令牌`}
        className="flex-1"
      />
      <HoverTip tip={locked ? '该项被部署环境变量覆盖，后台无法修改' : meta.hint}>
        <Chip variant="caption" color={item.hasValue ? 'lime' : 'neutral'}>
          {locked ? '环境变量' : item.hasValue ? '已配置' : '未配置'}
        </Chip>
      </HoverTip>
    </div>
  ) : (
    <TextInput
      value={String(value ?? '')}
      disabled={locked || !canWrite}
      placeholder={
        item.key.endsWith('.baseUrl')
          ? 'https://api.example.com'
          : item.key.endsWith('.model')
            ? '留空则使用协议默认模型'
            : String(item.default)
      }
      onChange={(next) => onChange(next)}
      ariaLabel={label}
      className="w-full"
    />
  );

  return (
    <div className="flex items-start gap-4 border-b border-border-table py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.envName ? (
            <HoverTip tip={`可用环境变量 ${item.envName} 覆盖`}>
              <span className="text-sm font-medium text-text-primary">{label}</span>
            </HoverTip>
          ) : (
            <span className="text-sm font-medium text-text-primary">{label}</span>
          )}
          {item.source !== 'default' && (
            <HoverTip tip={meta.hint}>
              <Chip variant="caption" color={TONE_CHIP_COLOR[meta.tone]}>
                {meta.label}
              </Chip>
            </HoverTip>
          )}
          {item.overridden && !locked && (
            <Button
              variant="ghost"
              size="xs"
              disabled={!canWrite}
              onClick={onToggleClear}
            >
              {cleared ? '取消恢复' : '恢复默认'}
            </Button>
          )}
        </div>

        <p className="mt-0.5 text-xs leading-5 text-text-tertiary">{item.description}</p>

        {locked && (item.dbValue != null || item.dbHasValue) && (
          <p className="mt-0.5 text-xs text-amber-700">
            后台曾保存：
            <code className="font-mono">
              {item.secret ? item.dbMasked : String(item.dbValue)}
            </code>
            （当前被环境变量覆盖，保存不会生效）
          </p>
        )}
        {locked && item.dbValue == null && !item.dbHasValue && (
          <p className="mt-0.5 text-xs text-text-tertiary">
            后台没有保存过该项，当前完全由部署环境提供。
          </p>
        )}

        {item.overridden && item.updatedAt && (
          <p className="mt-0.5 text-[11px] text-text-tertiary">
            上次修改：{item.updatedBy || 'admin'} · {fmtTime(item.updatedAt)}
          </p>
        )}
      </div>
      <div className="w-[42%] min-w-[220px] shrink-0">{control}</div>
    </div>
  );
}
