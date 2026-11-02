import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  MAX_REGIONS,
  MAX_SKUS,
  MAX_SKU_NAME,
  SUPPORTED_IMAGE_LABEL,
  type LibraryTarget,
  type SkuItem,
  type SkuVariantContent,
} from './constants';
import {
  AssetLibraryModal,
  ImageLightbox,
  MobileUploadModal,
  SkuRegionEditorModal,
  type SkuRegion,
  type ToolAsset,
  type ToolSettings,
} from './components';
import { ProductSkuTemplateCard } from './ProductSkuTemplateCard';
import { ProductSkuWorkspace } from './ProductSkuWorkspace';
import { ProductSkuList } from './ProductSkuList';
import { ProductSkuStepsCard } from './ProductSkuStepsCard';
import {
  useAssetLibrary,
  useAuth,
  useGenerateError,
  usePasteUpload,
  usePollAbort,
  useProject,
  useResultGallery,
  useSkuBatch,
} from './hooks';
import {
  assetsApi,
  assetSrc,
  generateApi,
  toAbsoluteUrl,
} from './api';
import {
  cloneSkuItem,
  createSkuItem,
  downloadDirect,
  downloadUrlsAsZip,
  groupContainsTask,
  groupSkuHistory,
  isSupportedImageFile,
  nextSkuKey,
  normalizeRegions,
  normalizeVariants,
  resultFromGallery,
  safeFilename,
  syncVariants,
  type SkuBatchGroup,
} from './utils';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp, Spin } from '../../ui';

export function ProductSkuPage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const submissionId = searchParams.get('submissionId');

  const templateInputRef = useRef<HTMLInputElement>(null);
  const libraryTargetRef = useRef<LibraryTarget | null>(null);
  const mobileTargetRef = useRef<LibraryTarget | null>(null);
  const restoredSubmissionRef = useRef(false);
  const pollSignal = usePollAbort();

  const [template, setTemplate] = useState<ToolAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regions, setRegions] = useState<SkuRegion[]>([]);
  const [items, setItems] = useState<SkuItem[]>([createSkuItem([])]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [referenceBusy, setReferenceBusy] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [settingsSeed, setSettingsSeed] = useState(0);
  const [defaultRatio, setDefaultRatio] = useState('1:1');
  const [defaultResolution, setDefaultResolution] = useState('1k');

  const gallery = useResultGallery({
    capability: 'sku_image',
    token,
    captionOf: (params) => {
      const name = typeof params.skuName === 'string' ? params.skuName.trim() : '';
      return name || undefined;
    },
  });

  const {
    submitting,
    failedNotice,
    activeResultId,
    batchItems,
    setActiveResultId,
    setFailedNotice,
    clearBatch,
    removeBatchItems,
    submit,
    retryFailed,
    openHistoryResult,
  } = useSkuBatch({ pollSignal, prependGallery: gallery.prepend });

  const historyGroups = useMemo(() => groupSkuHistory(gallery.items), [gallery.items]);

  const applyTemplate = useCallback((next: ToolAsset) => {
    setTemplate(next);
    setRegions([]);
    setItems([createSkuItem([])]);
    clearBatch();
    setEditorOpen(true);
  }, [clearBatch]);

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
      applyTemplate({
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: file.name,
      });
      message.success('模板图已上传，请框选变体区域');
    } catch (error) {
      reportError(error);
    } finally {
      setUploading(false);
    }
  }, [applyTemplate, ensureProject, message, reportError]);

  usePasteUpload((files) => uploadTemplate(files));

  const setVariantReference = useCallback((itemKey: number, regionId: string, reference: ToolAsset | undefined) => {
    setItems((current) => current.map((item) => {
      if (item.key !== itemKey) return item;
      const previous = item.variants[regionId] ?? { regionId, instruction: '' };
      return {
        ...item,
        variants: { ...item.variants, [regionId]: { ...previous, reference } },
      };
    }));
  }, []);

  const pickFromLibrary = useCallback((asset: Asset) => {
    const target = libraryTargetRef.current;
    if (!target) return false;
    const picked: ToolAsset = {
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    };
    if (target.kind === 'template') {
      applyTemplate(picked);
      message.success('已从素材库设为模板图');
    } else {
      setVariantReference(target.itemKey, target.regionId, picked);
      message.success('已添加参考图');
    }
    libraryTargetRef.current = null;
    return true;
  }, [applyTemplate, message, setVariantReference]);

  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
    pick,
  } = useAssetLibrary(pickFromLibrary);

  const openLibraryFor = useCallback((target: LibraryTarget) => {
    libraryTargetRef.current = target;
    openLibrary();
  }, [openLibrary]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const addMobileAsset = useCallback((assets: MobileUploadAsset[]) => {
    setMobileOpen(false);
    const target = mobileTargetRef.current;
    const first = assets[0];
    mobileTargetRef.current = null;
    if (!first || !target) return;
    const picked: ToolAsset = {
      id: first.id,
      url: toAbsoluteUrl(first.signedUrl || first.url) ?? '',
      name: first.filename,
    };
    if (target.kind === 'template') {
      applyTemplate(picked);
      message.success('已从手机接收模板图');
    } else {
      setVariantReference(target.itemKey, target.regionId, picked);
      message.success('已从手机接收参考图');
    }
  }, [applyTemplate, message, setVariantReference]);

  const openMobileFor = useCallback((target: LibraryTarget) => {
    mobileTargetRef.current = target;
    setMobileOpen(true);
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
      setVariantReference(itemKey, regionId, {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: file.name,
      });
      message.success('参考图已上传');
    } catch (error) {
      reportError(error);
    } finally {
      setReferenceBusy((current) => current === busyKey ? null : current);
    }
  }, [ensureProject, message, reportError, setVariantReference]);

  const confirmRegions = useCallback((next: SkuRegion[]) => {
    setRegions(next);
    setItems((current) => syncVariants(current.length > 0 ? current : [createSkuItem(next)], next));
    setEditorOpen(false);
  }, []);

  const handleEditorClose = useCallback(() => setEditorOpen(false), []);

  const updateItemName = (key: number, name: string) => {
    setItems((current) => current.map((item) => item.key === key ? { ...item, name } : item));
  };

  const updateInstruction = (itemKey: number, regionId: string, instruction: string) => {
    setItems((current) => current.map((item) => {
      if (item.key !== itemKey) return item;
      return {
        ...item,
        variants: {
          ...item.variants,
          [regionId]: {
            ...(item.variants[regionId] ?? { regionId, instruction: '' }),
            instruction,
          },
        },
      };
    }));
  };

  const addSku = () => {
    if (items.length >= MAX_SKUS) {
      message.warning(`最多添加 ${MAX_SKUS} 个 SKU`);
      return;
    }
    const source = items[items.length - 1] ?? createSkuItem(regions);
    setItems((current) => [...current, cloneSkuItem(source, `SKU ${current.length + 1}`)]);
  };

  const removeSku = (key: number) => {
    if (items.length <= 1) return;
    setItems((current) => current.filter((item) => item.key !== key));
  };

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const normalized = item.name.trim().toLowerCase();
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const validationMessage = useMemo(() => {
    if (!template) return '请先上传模板图';
    if (regions.length === 0) return '请先在模板图上框选至少 1 个变体区域';
    if (items.length === 0) return '请至少添加 1 个 SKU';
    for (const [index, item] of items.entries()) {
      const name = item.name.trim();
      if (!name) return `请填写 SKU ${index + 1} 的名称`;
      if (name.length > MAX_SKU_NAME) return `SKU ${index + 1} 名称不能超过 ${MAX_SKU_NAME} 个字符`;
      if ((nameCounts.get(name.toLowerCase()) ?? 0) > 1) return `SKU 名称「${name}」重复`;
      for (const [regionIndex, region] of regions.entries()) {
        const variant = item.variants[region.id];
        if (!variant?.instruction.trim() && !variant?.reference) {
          return `请为 SKU ${index + 1} 的区域 ${regionIndex + 1} 填写说明或上传参考图`;
        }
      }
    }
    return null;
  }, [items, nameCounts, regions, template]);

  const submitFromForm = useCallback(
    async (_inputs: ToolAsset[], settings: ToolSettings) => {
      if (!template || validationMessage || submitting) return;
      await submit(_inputs, settings, {
        template: { ...template },
        regions: regions.map((region) => ({ ...region })),
        items: items.map((item) => ({
          ...item,
          variants: Object.fromEntries(
            Object.entries(item.variants).map(([regionId, variant]) => [regionId, { ...variant }]),
          ),
        })),
      });
    },
    [items, regions, submit, submitting, template, validationMessage],
  );

  const restoreHistory = useCallback(async (group: SkuBatchGroup) => {
    setRestoringId(group.id);
    try {
      const tasks = await Promise.all(group.items.map((item) => generateApi.getTask(item.id)));
      const inputIds = Array.from(new Set(tasks.flatMap((task) => task.inputAssetIds ?? [])));
      if (inputIds.length === 0) throw new Error('原模板或参考图已不可用');
      const assetResults = await Promise.allSettled(inputIds.map((id) => assetsApi.get(id)));
      const assets = assetResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      if (assets.length !== inputIds.length) throw new Error('原模板或参考图已不可用，无法恢复整批内容');
      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const primaryTask = tasks.find((task) => normalizeRegions(task.params?.regions).length > 0) ?? tasks[0];
      const templateId = primaryTask?.inputAssetIds?.[0];
      const templateAsset = templateId ? assetsById.get(templateId) : undefined;
      if (!templateAsset) throw new Error('原模板图已不可用');
      const restoredRegions = normalizeRegions(primaryTask?.params?.regions);
      if (restoredRegions.length === 0) throw new Error('这条历史记录没有可恢复的区域');

      const restoredItems = tasks.map((task, index) => {
        const variantParams = normalizeVariants(task.params?.variants);
        const name = typeof task.params?.skuName === 'string' ? task.params.skuName : group.items[index]?.caption || `SKU ${index + 1}`;
        return {
          key: nextSkuKey(),
          name,
          variants: Object.fromEntries(restoredRegions.map((region, regionIndex) => {
            const variant = variantParams.find((entry) => entry.regionId === region.id) ?? variantParams[regionIndex];
            const referenceAsset = variant?.referenceAssetId ? assetsById.get(variant.referenceAssetId) : undefined;
            return [region.id, {
              regionId: region.id,
              instruction: variant?.instruction ?? '',
              reference: referenceAsset ? {
                id: referenceAsset.id,
                url: assetSrc(referenceAsset) ?? toAbsoluteUrl(referenceAsset.sourceUrl) ?? '',
                name: referenceAsset.sourceUrl.split('/').pop() ?? '参考图',
              } : undefined,
            } satisfies SkuVariantContent];
          })),
        } satisfies SkuItem;
      });

      setTemplate({
        id: templateAsset.id,
        url: assetSrc(templateAsset) ?? toAbsoluteUrl(templateAsset.sourceUrl) ?? '',
        name: templateAsset.sourceUrl.split('/').pop() ?? '模板图',
      });
      setRegions(restoredRegions);
      setItems(restoredItems.length > 0 ? restoredItems : [createSkuItem(restoredRegions)]);
      setDefaultRatio(typeof primaryTask?.params?.ratio === 'string' ? primaryTask.params.ratio : '1:1');
      setDefaultResolution(typeof primaryTask?.params?.size === 'string' ? primaryTask.params.size : '1k');
      setSettingsSeed((value) => value + 1);
      setFailedNotice(null);
      openHistoryResult(group);
      message.success(restoredItems.length > 1 ? `已恢复整批 ${restoredItems.length} 个 SKU` : '已恢复历史提交，可继续编辑');
    } catch (error) {
      message.error((error as Error).message || '历史提交恢复失败');
    } finally {
      setRestoringId(null);
    }
  }, [message, openHistoryResult]);

  const deleteHistory = useCallback((group: SkuBatchGroup) => {
    const count = group.items.length;
    modal.confirm({
      title: count > 1 ? `移除整批 ${count} 张 SKU 历史？` : '移除这条 SKU 历史记录？',
      content: '任务记录与生成图会一并删除，不可恢复。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const results = await Promise.allSettled(group.items.map((item) => generateApi.remove(item.id)));
        const removedIds = new Set(group.items.flatMap((item, index) => results[index]?.status === 'fulfilled' ? [item.id] : []));
        removedIds.forEach((id) => gallery.removeItem(id));
        removeBatchItems(removedIds);
        const failed = results.length - removedIds.size;
        if (failed > 0) message.error(`有 ${failed} 条历史移除失败，请稍后重试`);
        else message.success(count > 1 ? '整批历史记录已移除' : '历史记录已移除');
      },
    });
  }, [gallery, message, modal, removeBatchItems]);

  useEffect(() => {
    if (!submissionId || restoredSubmissionRef.current || gallery.loading) return;
    restoredSubmissionRef.current = true;
    const group = historyGroups.find((entry) => groupContainsTask(entry, submissionId));
    if (group) openHistoryResult(group);
    else setFailedNotice('未找到该历史提交，可能已被删除或不属于当前账号');
  }, [gallery.loading, historyGroups, openHistoryResult, submissionId]);

  const downloadHistoryGroup = useCallback(async (group: SkuBatchGroup) => {
    const ready = group.items.filter((item) => item.status !== 'failed' && item.url);
    if (ready.length === 0) {
      message.warning('这组历史暂无已完成的图片');
      return;
    }
    if (ready.length === 1) {
      downloadDirect(resultFromGallery(ready[0]));
      return;
    }
    try {
      await downloadUrlsAsZip(
        `sku-batch-${new Date().toISOString().slice(0, 10)}.zip`,
        ready.map((item, index) => ({
          name: `${String(index + 1).padStart(2, '0')}-${safeFilename(item.caption || 'SKU')}.png`,
          url: item.url!,
        })),
      );
      message.success(`已打包下载 ${ready.length} 张 SKU 图`);
    } catch {
      ready.forEach((item, index) => window.setTimeout(() => downloadDirect(resultFromGallery(item)), index * 180));
      message.info('浏览器不支持打包，已改为逐张下载');
    }
  }, [message]);

  const handleDownloadAll = async () => {
    const ready = batchItems.filter((item) => item.status === 'succeeded' && item.url);
    if (ready.length === 0) return;
    try {
      await downloadUrlsAsZip(
        `sku-batch-${new Date().toISOString().slice(0, 10)}.zip`,
        ready.map((item, index) => ({
          name: `${String(index + 1).padStart(2, '0')}-${safeFilename(item.label)}.png`,
          url: item.url!,
        })),
      );
      message.success(`已打包下载 ${ready.length} 张 SKU 图`);
    } catch {
      ready.forEach((item, index) => window.setTimeout(() => downloadDirect(item), index * 180));
      message.info('浏览器不支持打包，已改为逐张下载');
    }
  };

  return (
    <>
      <ProductSkuWorkspace
        settingsSeed={settingsSeed}
        defaultRatio={defaultRatio}
        defaultResolution={defaultResolution}
        validationMessage={validationMessage}
        submitting={submitting}
        formValid={validationMessage === null}
        onSubmit={submitFromForm}
        batchItems={batchItems}
        galleryLoading={gallery.loading}
        galleryError={gallery.error}
        failedNotice={failedNotice}
        activeResultId={activeResultId}
        onActiveResultChange={setActiveResultId}
        onRefresh={() => void gallery.reload()}
        onRetryFailed={(itemId) => void retryFailed(itemId)}
        batchDownloading={false}
        onDownloadAll={() => void handleDownloadAll()}
        historyGroups={historyGroups}
        onOpenHistory={openHistoryResult}
        onRestoreHistory={(group) => void restoreHistory(group)}
        onDownloadHistory={(group) => void downloadHistoryGroup(group)}
        onDeleteHistory={deleteHistory}
      >
        <ProductSkuTemplateCard
          template={template}
          uploading={uploading}
          templateInputRef={templateInputRef}
          onUpload={(files) => void uploadTemplate(files)}
          onOpenLibrary={() => openLibraryFor({ kind: 'template' })}
          onOpenMobile={() => openMobileFor({ kind: 'template' })}
          onEditRegions={() => setEditorOpen(true)}
          onPreview={setPreviewUrl}
          onRemove={() => {
            setTemplate(null);
            setRegions([]);
            setItems([createSkuItem([])]);
            clearBatch();
          }}
        />

        {regions.length === 0 ? (
          <ProductSkuStepsCard />
        ) : (
          <ProductSkuList
            items={items}
            regions={regions}
            nameCounts={nameCounts}
            referenceBusy={referenceBusy}
            onAdd={addSku}
            onRemove={removeSku}
            onNameChange={updateItemName}
            onInstructionChange={updateInstruction}
            onUploadReference={(file, itemKey, regionId, input) =>
              void uploadReferenceFile(file, itemKey, regionId, input)
            }
            onOpenReferenceLibrary={(itemKey, regionId) =>
              openLibraryFor({ kind: 'reference', itemKey, regionId })
            }
            onOpenReferenceMobile={(itemKey, regionId) =>
              openMobileFor({ kind: 'reference', itemKey, regionId })
            }
            onRemoveReference={(itemKey, regionId) =>
              setVariantReference(itemKey, regionId, undefined)
            }
            onPreview={setPreviewUrl}
          />
        )}
      </ProductSkuWorkspace>

      <SkuRegionEditorModal
        open={Boolean(editorOpen && template)}
        url={template?.url ?? ''}
        alt={template?.name}
        initialRegions={regions}
        max={MAX_REGIONS}
        onClose={handleEditorClose}
        onConfirm={confirmRegions}
      />

      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={() => {
          libraryTargetRef.current = null;
          closeLibrary();
        }}
        onPick={pick}
        maxSelectable={1}
      />

      <MobileUploadModal
        open={mobileOpen}
        onReceived={addMobileAsset}
        onCancel={() => {
          mobileTargetRef.current = null;
          setMobileOpen(false);
        }}
      />

      {restoringId && (
        <div className="product-sku-restoring" role="status">
          <Spin size="small" /> 正在恢复历史提交…
        </div>
      )}

      {previewUrl && (
        <ImageLightbox
          items={[{ id: previewUrl, url: previewUrl }]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setPreviewUrl(null)}
        />
      )}
    </>
  );
}
