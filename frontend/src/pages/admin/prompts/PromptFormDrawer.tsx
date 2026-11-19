import {
  FormDrawer,
  FormField,
  NumberField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from './components';
import { MODALITY_OPTIONS, type PromptDraft } from './constants';
import { PromptImagesField } from './PromptImagesField';
import { promptHeading } from './utils';
import type { AdminPrompt, PromptImage, PromptModality } from './types';

interface PromptFormDrawerProps {
  open: boolean;
  editing: AdminPrompt | null;
  draft: PromptDraft;
  formError: string | null;
  formDirty: boolean;
  busy: boolean;
  categories: string[];
  onPatch: (patch: Partial<PromptDraft>) => void;
  onClose: () => void;
  onSave: () => void;
}

/** 提示词表单：正文是主体，其余字段用于检索与归类。 */
export function PromptFormDrawer({
  open,
  editing,
  draft,
  formError,
  formDirty,
  busy,
  categories,
  onPatch,
  onClose,
  onSave,
}: PromptFormDrawerProps) {
  const parsedSort = Number(draft.sortOrder);
  const sortValue = draft.sortOrder === '' || !Number.isFinite(parsedSort) ? undefined : parsedSort;

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={editing ? `编辑提示词 · ${promptHeading(editing)}` : '新建提示词'}
      busy={busy}
      dirty={formDirty}
      formError={formError}
      submitLabel="保存"
      submitDisabled={Boolean(editing) && !formDirty}
      onSubmit={onSave}
    >
      <FormField label="标题" hint="可留空；为空时列表用正文摘要辨认">
        <TextField
          ariaLabel="提示词标题"
          value={draft.title}
          placeholder="如：电商白底主图"
          maxLength={60}
          onChange={(value) => onPatch({ title: value })}
        />
      </FormField>

      <FormField
        label="分类"
        hint={
          categories.length > 0
            ? `已有分类：${categories.join('、')}`
            : '自由文本，保存后会出现在筛选项里'
        }
      >
        <TextField
          ariaLabel="提示词分类"
          value={draft.category}
          placeholder="如：电商 / 人像 / 风景"
          maxLength={40}
          onChange={(value) => onPatch({ category: value })}
        />
      </FormField>

      <FormField label="适用模态" hint="与能力定义的产出模态同口径">
        <SelectField
          ariaLabel="适用模态"
          value={draft.modality}
          onChange={(value) => onPatch({ modality: (value ?? 'image') as PromptModality })}
          options={MODALITY_OPTIONS}
        />
      </FormField>

      <FormField label="提示词内容" required hint="提交给模型的正向提示词">
        <TextAreaField
          ariaLabel="提示词内容"
          rows={8}
          value={draft.content}
          placeholder="描述画面主体、场景、光线、镜头、质感与风格"
          maxLength={4000}
          showCount
          onChange={(value) => onPatch({ content: value })}
        />
      </FormField>

      <FormField label="反向提示词" hint="可选；不希望出现的元素">
        <TextAreaField
          ariaLabel="反向提示词"
          rows={3}
          value={draft.negativePrompt}
          placeholder="如：低清晰度、模糊、变形、水印"
          maxLength={2000}
          showCount
          onChange={(value) => onPatch({ negativePrompt: value })}
        />
      </FormField>

      <FormField label="标签" hint="逗号分隔，最多 8 个；用于检索与筛选">
        <TextField
          ariaLabel="提示词标签"
          value={draft.tags}
          placeholder="人像，棚拍，纯色背景"
          onChange={(value) => onPatch({ tags: value })}
        />
      </FormField>

      <FormField
        label="配图"
        hint="可选；本地上传或从素材库多选，最多 9 张。配图存稳定引用，不存签名地址"
      >
        <PromptImagesField
          images={draft.images}
          disabled={busy}
          onChange={(images: PromptImage[]) => onPatch({ images })}
        />
      </FormField>

      <div className="grid grid-cols-2 items-start gap-4">
        <FormField label="排序" hint="数值小的靠前">
          <NumberField
            ariaLabel="排序"
            min={0}
            value={sortValue}
            onChange={(value) => onPatch({ sortOrder: value === undefined ? '' : String(value) })}
          />
        </FormField>
        <div className="pt-6">
          <SwitchField
            checked={draft.enabled}
            onChange={(checked) => onPatch({ enabled: checked })}
            label={draft.enabled ? '已启用' : '已停用'}
          />
        </div>
      </div>
    </FormDrawer>
  );
}
