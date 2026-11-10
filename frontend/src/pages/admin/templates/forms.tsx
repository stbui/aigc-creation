import { useState, type ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';

import {
  ActionButton,
  Drawer,
  FilePicker,
  FormField,
  NumberField,
  SwitchField,
  TextAreaField,
  TextField,
} from '~/admin-ui/primitives';
import { adminTemplateCatalogApi } from './api';
import { useToast } from './hooks';
import type { CategoryDraft, GroupDraft, ItemDraft } from './constants';
import {
  buildCategoryPayload,
  buildGroupPayload,
  buildItemPayload,
  parseSortOrder,
} from './utils';

interface DrawerShellProps {
  title: string;
  description?: string;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}

function DrawerShell({ title, description, saving, onClose, onSave, children }: DrawerShellProps) {
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={title}
      description={description}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <ActionButton variant="outline" onClick={onClose} disabled={saving}>
            取消
          </ActionButton>
          <ActionButton onClick={onSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </ActionButton>
        </div>
      }
    >
      <div className="space-y-4">{children}</div>
    </Drawer>
  );
}

export function CategoryFormDrawer({
  mode,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial: CategoryDraft;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: CategoryDraft) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<CategoryDraft>(initial);
  const patch = (next: Partial<CategoryDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const submit = () => {
    const payload = buildCategoryPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    onSubmit(draft);
  };

  return (
    <DrawerShell
      title={mode === 'create' ? '新建一级分类' : '编辑一级分类'}
      description="一级分类对应一篇来源文章 / 一个主题，C 端显示为顶部 tab。"
      saving={saving}
      onClose={onClose}
      onSave={submit}
    >
      <FormField label="名称" required>
        <TextField
          value={draft.name}
          onChange={(name) => patch({ name })}
          placeholder="如：龙凤褂"
          maxLength={40}
        />
      </FormField>
      <FormField label="slug" required hint="小写字母/数字/短横线，创建后尽量不要再改">
        <TextField
          value={draft.slug}
          onChange={(slug) => patch({ slug })}
          placeholder="longfeng"
          maxLength={40}
        />
      </FormField>
      <FormField label="来源文章">
        <TextField
          value={draft.sourceUrl}
          onChange={(sourceUrl) => patch({ sourceUrl })}
          placeholder="https://mp.weixin.qq.com/s/..."
          maxLength={500}
        />
      </FormField>
      <FormField label="说明">
        <TextAreaField
          value={draft.description}
          onChange={(description) => patch({ description })}
          rows={3}
          maxLength={300}
          showCount
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="排序（小的靠前）">
          <NumberField
            value={parseSortOrder(draft.sortOrder)}
            onChange={(value) => patch({ sortOrder: String(value ?? 0) })}
          />
        </FormField>
        <FormField label="启用">
          <SwitchField
            checked={draft.enabled}
            onChange={(enabled) => patch({ enabled })}
            label="在 C 端显示"
          />
        </FormField>
      </div>
    </DrawerShell>
  );
}

export function GroupFormDrawer({
  mode,
  categoryName,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  categoryName: string;
  initial: GroupDraft;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: GroupDraft) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<GroupDraft>(initial);
  const patch = (next: Partial<GroupDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const submit = () => {
    const payload = buildGroupPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    onSubmit(draft);
  };

  return (
    <DrawerShell
      title={mode === 'create' ? `新建二级分类 · ${categoryName}` : '编辑二级分类'}
      description="二级分类是风格 / 场景分组，C 端在一级分类下显示为筛选胶囊。"
      saving={saving}
      onClose={onClose}
      onSave={submit}
    >
      <FormField label="名称" required>
        <TextField
          value={draft.name}
          onChange={(name) => patch({ name })}
          placeholder="如：纯色棚拍"
          maxLength={40}
        />
      </FormField>
      <FormField label="slug" required hint="同一级分类内唯一">
        <TextField
          value={draft.slug}
          onChange={(slug) => patch({ slug })}
          placeholder="studio"
          maxLength={40}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="排序（小的靠前）">
          <NumberField
            value={parseSortOrder(draft.sortOrder)}
            onChange={(value) => patch({ sortOrder: String(value ?? 0) })}
          />
        </FormField>
        <FormField label="启用">
          <SwitchField
            checked={draft.enabled}
            onChange={(enabled) => patch({ enabled })}
            label="在 C 端显示"
          />
        </FormField>
      </div>
    </DrawerShell>
  );
}

export function ItemFormDrawer({
  mode,
  groupName,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  groupName: string;
  initial: ItemDraft;
  saving: boolean;
  onClose: () => void;
  onSubmit: (draft: ItemDraft) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const patch = (next: Partial<ItemDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const upload = async (next: File) => {
    setFile(next);
    setUploading(true);
    try {
      const result = await adminTemplateCatalogApi.uploadImage(next);
      patch({ imageUrl: result.imageUrl, previewUrl: result.previewUrl });
      toast.success('图片已上传');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  const submit = () => {
    const payload = buildItemPayload(draft);
    if (!payload.ok) {
      toast.error(payload.error ?? '请检查表单');
      return;
    }
    onSubmit(draft);
  };

  return (
    <DrawerShell
      title={mode === 'create' ? `新建模板 · ${groupName}` : '编辑模板'}
      description="模板 = 一张预览图 + 提示词 + 标签；C 端点击图片即选用。"
      saving={saving}
      onClose={onClose}
      onSave={submit}
    >
      <FormField label="名称" required>
        <TextField
          value={draft.name}
          onChange={(name) => patch({ name })}
          placeholder="如：红墙团扇"
          maxLength={40}
        />
      </FormField>

      <FormField label="预览图" required hint="原图会保存到当前存储后端，C 端读取时重新生成访问地址">
        <div className="space-y-2">
          <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
            {draft.previewUrl ? (
              <img
                src={draft.previewUrl}
                alt="模板预览"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[12px] text-muted-foreground">
                <ImageIcon className="size-5" aria-hidden />
                暂无图片
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <FilePicker
              file={file}
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              onPick={(next) => void upload(next)}
              onClear={() => setFile(null)}
              disabled={uploading}
              label={draft.previewUrl ? '更换图片' : '上传图片'}
              hint="PNG / JPEG"
            />
            {draft.imageUrl && (
              <ActionButton
                variant="ghost"
                size="xs"
                disabled={uploading}
                onClick={() => patch({ imageUrl: '', previewUrl: '' })}
              >
                移除
              </ActionButton>
            )}
          </div>
          <TextField
            value={draft.imageUrl}
            onChange={(imageUrl) => patch({ imageUrl })}
            placeholder="也可以直接填写 /templates/... 或 storage://..."
            ariaLabel="模板图片地址"
            maxLength={500}
          />
        </div>
      </FormField>

      <FormField label="提示词" required hint="提交生成时与用户上传的照片一起发送给模型">
        <TextAreaField
          value={draft.prompt}
          onChange={(prompt) => patch({ prompt })}
          rows={8}
          maxLength={4000}
          showCount
        />
      </FormField>

      <FormField label="标签" hint="用逗号分隔，最多 8 个；C 端显示为标签胶囊">
        <TextField
          value={draft.tags}
          onChange={(tags) => patch({ tags })}
          placeholder="龙凤褂，纯色棚拍，团扇"
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="排序（小的靠前）">
          <NumberField
            value={parseSortOrder(draft.sortOrder)}
            onChange={(value) => patch({ sortOrder: String(value ?? 0) })}
          />
        </FormField>
        <FormField label="启用">
          <SwitchField
            checked={draft.enabled}
            onChange={(enabled) => patch({ enabled })}
            label="在 C 端显示"
          />
        </FormField>
      </div>

    </DrawerShell>
  );
}
