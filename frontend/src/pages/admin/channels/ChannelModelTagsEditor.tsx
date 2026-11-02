import { Plus, Trash2 } from 'lucide-react';
import { ActionButton, IconButton, Notice, SelectField, TextField } from './components';
import { Field } from './ChannelField';
import {
  MAX_MODEL_TAGS,
  MAX_TAG_TEXT_LENGTH,
  TAG_COLOR_LABELS,
  validateModelTags,
} from './utils';

/**
 * 模型展示标签编辑器。
 *
 * 结构化编辑（文字 + 颜色），而不是「文字:颜色, 文字:颜色」的自由文本 ——
 * 自由文本下运营容易写错颜色名（非法颜色静默回落紫色），也看不到最终效果。
 *
 * 约束与后端一致：最多 5 个、每个 1–12 字、文字不可重复。
 */
export function ChannelModelTagsEditor({
  tags,
  onChange,
}: {
  tags: Array<{ text: string; color: string }>;
  onChange: (next: Array<{ text: string; color: string }>) => void;
}) {
  const error = validateModelTags(tags);
  const colorOptions = Object.entries(TAG_COLOR_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const update = (index: number, patch: Partial<{ text: string; color: string }>) => {
    onChange(tags.map((tag, i) => (i === index ? { ...tag, ...patch } : tag)));
  };

  return (
    <Field
      label="展示标签"
      hint="最多 5 个，每个 1–12 字，文字不可重复；展示在 C 端模型选项里，不影响计费"
      error={error}
    >
      <div className="flex flex-col gap-2">
        {tags.map((tag, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                ariaLabel={`标签 ${index + 1} 文字`}
                value={tag.text}
                maxLength={MAX_TAG_TEXT_LENGTH}
                onChange={(value) => update(index, { text: value })}
                placeholder="如 限时特价、官方1折"
              />
            </div>
            <div className="w-28">
              <SelectField
                ariaLabel={`标签 ${index + 1} 颜色`}
                value={tag.color}
                options={colorOptions}
                onChange={(value) => update(index, { color: value ?? 'purple' })}
              />
            </div>
            <IconButton
              size="sm"
              icon={Trash2}
              label={`删除标签 ${index + 1}`}
              onClick={() => onChange(tags.filter((_, i) => i !== index))}
            />
          </div>
        ))}

        <ActionButton
          variant="ghost"
          size="xs"
          icon={Plus}
          disabled={tags.length >= MAX_MODEL_TAGS}
          onClick={() => onChange([...tags, { text: '', color: 'purple' }])}
        >
          添加标签
        </ActionButton>

        {tags.some((tag) => tag.text.trim() !== '') && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">展示预览</span>
            {tags
              .filter((tag) => tag.text.trim() !== '')
              .map((tag, index) => (
                <span
                  key={`${tag.text}-${index}`}
                  className="rounded-full border border-border px-2 py-0.5 text-[12px]"
                  style={{
                    color: `var(--tag-${tag.color}, var(--brand))`,
                    borderColor: `var(--tag-${tag.color}-border, var(--border))`,
                  }}
                >
                  {tag.text.trim()}
                </span>
              ))}
          </div>
        )}

        {error && <Notice tone="danger" title={error} />}
      </div>
    </Field>
  );
}
