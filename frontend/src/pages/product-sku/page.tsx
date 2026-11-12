import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  MAX_REGIONS,
  MAX_SKUS,
  MAX_SKU_NAME,
  SUPPORTED_IMAGE_LABEL,
  type LibraryTarget,
  type SkuItem,
} from './constants';
import {
  AssetLibraryModal,
  ImageLightbox,
  MobileUploadModal,
  SkuRegionEditorModal,
  Surface,
  type SkuRegion,
  type ToolAsset,
  type ToolSettings,
} from './components';
import { ProductSkuTemplateCard } from './ProductSkuTemplateCard';
import { ProductSkuWorkspace } from './ProductSkuWorkspace';
import { ProductSkuListSection } from './ProductSkuListSection';
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
  useSkuDownload,
} from './hooks';
import {
  assetsApi,
  fileNameFromUrl,
  generateApi,
  toToolAsset,
} from './api';
import {
  cloneSkuItem,
  createSkuItem,
  downloadDirect,
  groupContainsTask,
  groupSkuHistory,
  isSupportedImageFile,
  patchSkuVariant,
  resultFromGallery,
  restoreSkuDraft,
  syncVariants,
  type SkuBatchGroup,
} from './utils';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp, Spin } from '../../ui';

export function ProductSkuPage() {
  const { message } = useApp();
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
    submit,
    retryFailed,
    openHistoryResult,
  } = useSkuBatch({ pollSignal, prependGallery: gallery.prepend });
  const downloadZip = useSkuDownload();

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
      applyTemplate(toToolAsset(asset, file.name));
      message.success('模板图已上传，请框选变体区域');
    } catch (error) {
      reportError(error);
    } finally {
      setUploading(false);
    }
  }, [applyTemplate, ensureProject, message, reportError]);

  usePasteUpload((files) => uploadTemplate(files));

  const setVariantReference = useCallback((itemKey: number, regionId: string, reference: ToolAsset | undefined) => {
    setItems((current) => patchSkuVariant(current, itemKey, regionId, { reference }));
  }, []);

  const pickFromLibrary = useCallback((asset: Asset) => {
    const target = libraryTargetRef.current;
    if (!target) return false;
    const picked = toToolAsset(asset, fileNameFromUrl(asset.sourceUrl, '素材'));
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
    const picked = toToolAsset(first, first.filename);
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
      setVariantReference(itemKey, regionId, toToolAsset(asset, file.name));
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
    setItems((current) => patchSkuVariant(current, itemKey, regionId, { instruction }));
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

  const submitFromForm = useCallback(
    async (_inputs: ToolAsset[], settings: ToolSettings) => {
      if (!template || regions.length === 0 || validationMessage || submitting) return;
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
      const assetsById = new Map(
        assets.map((asset) => [asset.id, toToolAsset(asset, fileNameFromUrl(asset.sourceUrl, '素材'))]),
      );

      const draft = restoreSkuDraft(tasks, (id) => assetsById.get(id), group);
      setTemplate(draft.template);
      setRegions(draft.regions);
      setItems(draft.items.length > 0 ? draft.items : [createSkuItem(draft.regions)]);
      setDefaultRatio(draft.defaultRatio);
      setDefaultResolution(draft.defaultResolution);
      setSettingsSeed((value) => value + 1);
      setFailedNotice(null);
      openHistoryResult(group);
      message.success(
        draft.items.length > 1
          ? `已恢复整批 ${draft.items.length} 个 SKU`
          : '已恢复历史提交，可继续编辑',
      );
    } catch (error) {
      message.error((error as Error).message || '历史提交恢复失败');
    } finally {
      setRestoringId(null);
    }
  }, [message, openHistoryResult]);

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
    await downloadZip(ready.map(resultFromGallery));
  }, [downloadZip, message]);

  const handleDownloadAll = async () => {
    const ready = batchItems.filter((item) => item.status === 'succeeded' && item.url);
    if (ready.length === 0) return;
    await downloadZip(ready);
  };

  return (
    <>
      <ProductSkuWorkspace
        template={template}
        regions={regions}
        itemCount={items.length}
        settingsSeed={settingsSeed}
        defaultRatio={defaultRatio}
        defaultResolution={defaultResolution}
        validationMessage={validationMessage}
        submitting={submitting}
        formValid={regions.length > 0 && validationMessage === null}
        onSubmit={submitFromForm}
        batchItems={batchItems}
        galleryLoading={gallery.loading}
        galleryError={gallery.error}
        failedNotice={failedNotice}
        activeResultId={activeResultId}
        onActiveResultChange={setActiveResultId}
        onRefresh={() => void gallery.reload()}
        onRetryFailed={(itemId) => void retryFailed(itemId)}
        onDownloadAll={() => void handleDownloadAll()}
        historyGroups={historyGroups}
        onOpenHistory={openHistoryResult}
        onRestoreHistory={(group) => void restoreHistory(group)}
        onDownloadHistory={(group) => void downloadHistoryGroup(group)}
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
        />

        {regions.length === 0 ? (
          <ProductSkuStepsCard />
        ) : (
          <ProductSkuListSection
            items={items}
            regions={regions}
            duplicateNames={duplicateNames}
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
        <Surface className="product-sku-restoring flex-row border-0" role="status">
          <Spin size="small" /> 正在恢复历史提交…
        </Surface>
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
