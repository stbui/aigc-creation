import { useEffect, useRef, useState } from 'react';
import { Images, Trash2, Upload } from 'lucide-react';

import { adminAssetsApi, adminPromptsApi } from './api';
import {
  ActionButton,
  CheckboxField,
  EmptyState,
  ModalDialog,
  Panel,
  SkeletonBody,
  Spinner,
  type AppliedFilter,
} from './components';
import { useToast } from './hooks';
import { PROMPT_IMAGES_MAX } from './constants';
import { PromptImagePreview } from './PromptImagePreview';
import type { PromptImage } from './types';

interface PromptImagesFieldProps {
  images: PromptImage[];
  onChange: (images: PromptImage[]) => void;
  disabled?: boolean;
}

interface AssetOption {
  id: string;
  ref: string;
  previewUrl: string;
  name: string;
}

/**
 * 提示词配图：本地上传 + 从素材库多选。
 *
 * 同一份 `images` 数组承载两种来源，靠 `assetId` 区分（素材库来源带它）。
 * 只保存稳定引用，预览地址是读取产物 —— 签名地址过期后仍能被重新解析。
 */
export function PromptImagesField({ images, onChange, disabled = false }: PromptImagesFieldProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);

  const remaining = PROMPT_IMAGES_MAX - images.length;

  const removeAt = (index: number) => onChange(images.filter((_, i) => i !== index));

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length > remaining) {
      toast.error(`最多还能添加 ${remaining} 张配图`);
      return;
    }
    setUploading(true);
    try {
      const result = await adminPromptsApi.uploadImages(files);
      onChange([
        ...images,
        ...result.items.map((item) => ({
          ref: item.ref,
          name: item.name,
          previewUrl: item.previewUrl,
        })),
      ]);
      toast.success(`已上传 ${result.items.length} 张配图`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const addFromLibrary = (picked: AssetOption[]) => {
    const existing = new Set(images.map((image) => image.ref));
    const next = picked
      .filter((item) => !existing.has(item.ref))
      .slice(0, remaining)
      .map((item) => ({
        ref: item.ref,
        assetId: item.id,
        name: item.name,
        previewUrl: item.previewUrl,
      }));
    onChange([...images, ...next]);
    setPicking(false);
    if (next.length > 0) toast.success(`已添加 ${next.length} 张配图`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {images.map((image, index) => (
          <div
            key={`${image.ref}-${index}`}
            className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted/40"
          >
            <PromptImagePreview
              image={image}
              size={320}
              alt={image.name || `配图 ${index + 1}`}
            />
            <button
              type="button"
              className="absolute right-1 top-1 rounded bg-foreground/70 p-1 text-background opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`移除配图 ${index + 1}`}
              disabled={disabled || uploading}
              onClick={() => removeAt(index)}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
            {image.assetId && (
              <span className="absolute bottom-1 left-1 rounded bg-foreground/70 px-1 py-0.5 text-[12px] leading-4 text-background">
                素材库
              </span>
            )}
          </div>
        ))}

        {images.length < PROMPT_IMAGES_MAX && (
          <button
            type="button"
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-muted/20 text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed"
            aria-label="上传配图"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Spinner /> : <Upload className="size-4" aria-hidden />}
            <span>{uploading ? '上传中…' : '上传图片'}</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          variant="secondary"
          size="sm"
          icon={Upload}
          disabled={disabled || uploading || remaining === 0}
          onClick={() => fileInputRef.current?.click()}
        >
          上传图片
        </ActionButton>
        <ActionButton
          variant="secondary"
          size="sm"
          icon={Images}
          disabled={disabled || uploading || remaining === 0}
          onClick={() => setPicking(true)}
        >
          从素材库选择
        </ActionButton>
        <span className="text-[12px] text-muted-foreground">
          已选 {images.length}/{PROMPT_IMAGES_MAX} 张，支持 PNG / JPEG / WebP
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void upload(files);
        }}
      />

      <AssetPickerDialog
        open={picking}
        remaining={remaining}
        onClose={() => setPicking(false)}
        onConfirm={addFromLibrary}
      />
    </div>
  );
}

function AssetPickerDialog({
  open,
  remaining,
  onClose,
  onConfirm,
}: {
  open: boolean;
  remaining: number;
  onClose: () => void;
  onConfirm: (items: AssetOption[]) => void;
}) {
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [items, setItems] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 24;

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appliedKeyword, page]);

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminAssetsApi.list({
        keyword: appliedKeyword || undefined,
        status: 'visible',
        page,
        pageSize,
      });
      setItems(
        result.items.map((item) => ({
          id: item.id,
          /*
           * 存稳定引用而非 `sourceUrl` —— 后者是带签名的展示地址，几小时后过期，
           * 落库后配图会集体 403。有 storageKey 时按 `storage://` 重组；
           * 老数据没有 key 才退回原地址。
           */
          ref: item.storageKey
            ? `storage://${item.storageBackend}/${item.storageKey}`
            : item.sourceUrl,
          previewUrl: item.sourceUrl,
          name: item.generation?.prompt?.slice(0, 40) || item.id.slice(-8),
        })),
      );
      setTotal(result.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '素材加载失败');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      if (!checked) return prev.filter((item) => item !== id);
      if (prev.length >= remaining) {
        toast.error(`最多还能添加 ${remaining} 张配图`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const confirm = () => {
    const picked = items.filter((item) => selected.includes(item.id));
    onConfirm(picked);
    setSelected([]);
    setAppliedKeyword('');
    setKeyword('');
    setPage(1);
  };

  const appliedChips: AppliedFilter[] = appliedKeyword
    ? [
        {
          key: 'keyword',
          label: `关键词：${appliedKeyword}`,
          onClear: () => {
            setKeyword('');
            setAppliedKeyword('');
            setPage(1);
          },
        },
      ]
    : [];

  return (
    <ModalDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="从素材库选择配图"
      description={`仅展示可见素材；一次最多还能添加 ${remaining} 张。`}
      size="lg"
      footer={
        <>
          <ActionButton variant="secondary" onClick={onClose}>
            取消
          </ActionButton>
          <ActionButton variant="default" disabled={selected.length === 0} onClick={confirm}>
            添加所选（{selected.length}）
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="h-8 w-64 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none focus-visible:border-ring"
            placeholder="素材 ID / 能力"
            aria-label="按素材 ID 或能力搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setAppliedKeyword(keyword.trim());
                setPage(1);
              }
            }}
          />
          <ActionButton
            variant="secondary"
            onClick={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
          >
            查询
          </ActionButton>
          {appliedChips.length > 0 && (
            <span className="text-[12px] text-muted-foreground">
              {appliedChips.map((chip) => chip.label).join(' · ')}
            </span>
          )}
        </div>

        {error ? (
          <Panel title="素材加载失败">
            <p className="text-[13px] text-muted-foreground">{error}</p>
            <ActionButton variant="secondary" size="sm" onClick={() => void load()}>
              重试
            </ActionButton>
          </Panel>
        ) : loading && items.length === 0 ? (
          <SkeletonBody rows={4} />
        ) : items.length === 0 ? (
          <EmptyState
            title="没有可用的素材"
            description="素材库为空，或当前关键词没有匹配项。可以直接在表单里上传图片。"
          />
        ) : (
          <>
            <div className="grid grid-cols-6 gap-2">
              {items.map((item) => {
                const checked = selected.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted/30"
                  >
                    <PromptImagePreview
                      image={{ ref: item.ref, previewUrl: item.previewUrl }}
                      size={320}
                      alt={item.name}
                    />
                    <div className="absolute left-1 top-1 rounded bg-background/85 px-1 py-0.5">
                      <CheckboxField
                        checked={checked}
                        onChange={(next) => toggle(item.id, next)}
                        ariaLabel={`选择素材 ${item.name}`}
                        size="sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {total > pageSize && (
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span>
                  共 {total} 张，第 {page}/{Math.max(1, Math.ceil(total / pageSize))} 页
                </span>
                <div className="flex items-center gap-1">
                  <ActionButton
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  >
                    上一页
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    size="sm"
                    disabled={page >= Math.ceil(total / pageSize) || loading}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    下一页
                  </ActionButton>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ModalDialog>
  );
}
