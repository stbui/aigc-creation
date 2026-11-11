import { useRef, useState, type ReactNode } from 'react';
import { ImageIcon, Upload } from 'lucide-react';

import {
  ActionButton,
  FormDrawer,
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
    <FormDrawer
      open
      onClose={onClose}
      size="md"
      title={title}
      description={description}
      busy={saving}
      onSubmit={onSave}
    >
      {children}
    </FormDrawer>
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
      description="一级分类是主题（如婚纱写真），C 端显示为顶部 tab。"
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
      description="二级分类是来源文章 / 风格（如龙凤褂、花海婚纱），C 端在一级分类下显示为筛选胶囊。"
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patch = (next: Partial<ItemDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const upload = async (next: File) => {
    setUploading(true);
    try {
      const result = await adminTemplateCatalogApi.uploadImage(next);
      patch({ imageUrl: result.imageUrl, previewUrl: result.previewUrl });
      toast.success('图片已上传');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
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
          <button
            type="button"
            className="group relative flex h-40 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40"
            onClick={() => fileInputRef.current?.click()}
            aria-label="点击选择模板图片"
            title="点击更换图片"
          >
            {draft.previewUrl ? (
              <>
                <img
                  src={draft.previewUrl}
                  alt="模板预览"
                  className="h-full w-full object-contain"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-foreground/60 px-2 py-1 text-center text-[12px] text-background opacity-0 transition-opacity group-hover:opacity-100">
                  点击更换图片
                </span>
              </>
            ) : (
              <span className="flex flex-col items-center gap-1 text-[12px] text-muted-foreground">
                <ImageIcon className="size-5" aria-hidden />
                点击上传图片
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = '';
              if (next) void upload(next);
            }}
          />
          <div className="flex items-center gap-3">
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Upload}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {draft.previewUrl ? '更换图片' : '上传图片'}
            </ActionButton>
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
            <span className="text-[12px] text-muted-foreground">PNG / JPEG / WebP</span>
          </div>
          <TextField
            value={draft.imageUrl}
            onChange={(imageUrl) => {
              const next = imageUrl.trim();
              // 手工填写站内路径 / http 地址时同步刷新预览；storage:// 引用无法直接渲染，交给上传按钮
              const previewUrl = next.startsWith('/') || /^https?:\/\//.test(next) ? next : '';
              patch({ imageUrl, previewUrl });
            }}
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
