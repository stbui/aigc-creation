import { useCallback, useMemo, useState } from 'react';

import {
  MAX_SKU_NAME,
  MAX_SKUS,
  SUPPORTED_IMAGE_LABEL,
  type SkuItem,
} from './constants';
import type { SkuRegion, ToolAsset } from './components';
import { assetsApi, toToolAsset } from './api';
import { useProject } from '../../hooks/useProject';
import { useGenerateError } from '../../hooks/useGenerateError';
import {
  cloneSkuItem,
  createSkuItem,
  isSupportedImageFile,
  patchSkuVariant,
  syncVariants,
  type RestoredSkuDraft,
} from './utils';
import { useApp } from '../../ui';

interface UseSkuDraftOptions {
  /** 模板图变化时清空上一批结果 */
  onResetBatch: () => void;
}

/**
 * SKU 草稿状态：模板图 / 变体区域 / SKU 清单及全部编辑动作。
 *
 * 页面只保留「选素材 / 提交 / 历史恢复」这些跨模块编排；清单增删、名称与
 * 区域说明更新、参考图上传、校验汇总都收口在这里，避免 `page.tsx` 继续膨胀。
 */
export function useSkuDraft({ onResetBatch }: UseSkuDraftOptions) {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const reportError = useGenerateError();

  const [template, setTemplate] = useState<ToolAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regions, setRegions] = useState<SkuRegion[]>([]);
  const [items, setItems] = useState<SkuItem[]>([createSkuItem([])]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [referenceBusy, setReferenceBusy] = useState<string | null>(null);
  const [settingsSeed, setSettingsSeed] = useState(0);
  const [defaultRatio, setDefaultRatio] = useState('1:1');
  const [defaultResolution, setDefaultResolution] = useState('1k');

  const applyTemplate = useCallback((next: ToolAsset) => {
    setTemplate(next);
    setRegions([]);
    setItems([createSkuItem([])]);
    onResetBatch();
    setEditorOpen(true);
  }, [onResetBatch]);

  const uploadTemplate = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files).find(isSupportedImageFile);
    if (!file) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    setUploading(true);
    try {
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      applyTemplate(toToolAsset(asset, file.name));
      message.success('模板图已上传，请框选变体区域');
    } catch (error) {
      reportError(error);
    } finally {
      setUploading(false);
    }
  }, [applyTemplate, ensureProject, message, reportError]);

  const setVariantReference = useCallback((itemKey: number, regionId: string, reference: ToolAsset | undefined) => {
    setItems((current) => patchSkuVariant(current, itemKey, regionId, { reference }));
  }, []);

  const uploadReferenceFile = useCallback(async (
    file: File | undefined,
    itemKey: number,
    regionId: string,
    input: HTMLInputElement,
  ) => {
    input.value = '';
    if (!file) return;
    if (!isSupportedImageFile(file)) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    const busyKey = `${itemKey}:${regionId}`;
    setReferenceBusy(busyKey);
    try {
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setVariantReference(itemKey, regionId, toToolAsset(asset, file.name));
      message.success('参考图已上传');
    } catch (error) {
      reportError(error);
    } finally {
      setReferenceBusy((current) => (current === busyKey ? null : current));
    }
  }, [ensureProject, message, reportError, setVariantReference]);

  const confirmRegions = useCallback((next: SkuRegion[]) => {
    setRegions(next);
    setItems((current) => syncVariants(current.length > 0 ? current : [createSkuItem(next)], next));
    setEditorOpen(false);
  }, []);

  const closeEditor = useCallback(() => setEditorOpen(false), []);

  const updateItemName = useCallback((key: number, name: string) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, name } : item)));
  }, []);

  const updateInstruction = useCallback((itemKey: number, regionId: string, instruction: string) => {
    setItems((current) => patchSkuVariant(current, itemKey, regionId, { instruction }));
  }, []);

  const addSku = useCallback(() => {
    if (items.length >= MAX_SKUS) {
      message.warning(`最多添加 ${MAX_SKUS} 个 SKU`);
      return;
    }
    const source = items[items.length - 1] ?? createSkuItem(regions);
    setItems((current) => [...current, cloneSkuItem(source, `SKU ${current.length + 1}`)]);
  }, [items, message, regions]);

  const removeSku = useCallback((key: number) => {
    setItems((current) => (current.length <= 1 ? current : current.filter((item) => item.key !== key)));
  }, []);

  /** 与其它行重名的规范化名称（小写），供清单做即时提示 */
  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of items) {
      const name = item.name.trim().toLowerCase();
      if (!name) continue;
      if (seen.has(name)) duplicates.add(name);
      else seen.add(name);
    }
    return duplicates;
  }, [items]);

  const validationMessage = useMemo(() => {
    if (items.length === 0) return '请至少添加 1 个 SKU';
    for (const [index, item] of items.entries()) {
      const name = item.name.trim();
      if (!name) return `请填写 SKU ${index + 1} 的名称`;
      if (name.length > MAX_SKU_NAME) return `SKU ${index + 1} 名称不能超过 ${MAX_SKU_NAME} 个字符`;
      if (duplicateNames.has(name.toLowerCase())) return `SKU 名称「${name}」重复`;
      for (const [regionIndex, region] of regions.entries()) {
        const variant = item.variants[region.id];
        if (!variant?.instruction.trim() && !variant?.reference) {
          return `请为 SKU ${index + 1} 的区域 ${regionIndex + 1} 填写说明或上传参考图`;
        }
      }
    }
    return null;
  }, [items, duplicateNames, regions]);

  /** 历史提交恢复：整体替换草稿并强制重建 ToolShell 的设置初值 */
  const applyDraft = useCallback((draft: RestoredSkuDraft) => {
    setTemplate(draft.template);
    setRegions(draft.regions);
    setItems(draft.items.length > 0 ? draft.items : [createSkuItem(draft.regions)]);
    setDefaultRatio(draft.defaultRatio);
    setDefaultResolution(draft.defaultResolution);
    setSettingsSeed((value) => value + 1);
  }, []);

  return {
    template,
    uploading,
    regions,
    items,
    editorOpen,
    previewUrl,
    referenceBusy,
    settingsSeed,
    defaultRatio,
    defaultResolution,
    applyTemplate,
    uploadTemplate,
    setVariantReference,
    uploadReferenceFile,
    confirmRegions,
    closeEditor,
    updateItemName,
    updateInstruction,
    addSku,
    removeSku,
    duplicateNames,
    validationMessage,
    applyDraft,
    setPreviewUrl,
    setEditorOpen,
  };
}
