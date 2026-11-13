import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { MAX_REGIONS, type LibraryTarget } from './constants';
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
  useAuth,
  useSkuBatch,
  useSkuDownload,
  useSkuDraft,
  useTargetedAssetPicker,
  usePasteUpload,
  usePollAbort,
  useResultGallery,
} from './hooks';
import { assetsApi, fileNameFromUrl, generateApi, toToolAsset } from './api';
import {
  downloadDirect,
  groupContainsTask,
  groupSkuHistory,
  resultFromGallery,
  restoreSkuDraft,
  type SkuBatchGroup,
} from './utils';
import { useApp, Spin } from '../../ui';

export function ProductSkuPage() {
  const { message } = useApp();
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const submissionId = searchParams.get('submissionId');

  const templateInputRef = useRef<HTMLInputElement>(null);
  const restoredSubmissionRef = useRef(false);
  const pollSignal = usePollAbort();
  const [restoringId, setRestoringId] = useState<string | null>(null);

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

  // 模板图 / 区域 / SKU 清单及其编辑动作收口在独立 hook
  const {
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
  } = useSkuDraft({ onResetBatch: clearBatch });

  // 素材库 / 手机上传：先记住触发按钮对应的图片位，再回填到模板图或变体区域
  const { library, openLibraryFor, mobile } = useTargetedAssetPicker<LibraryTarget>({
    onLibraryPick: (target, asset) => {
      const picked = toToolAsset(asset, fileNameFromUrl(asset.sourceUrl, '素材'));
      if (target.kind === 'template') {
        applyTemplate(picked);
        message.success('已从素材库设为模板图');
      } else {
        setVariantReference(target.itemKey, target.regionId, picked);
        message.success('已添加参考图');
      }
      return true;
    },
    onMobileReceive: (target, assets) => {
      const first = assets[0];
      if (!first) return;
      const picked = toToolAsset(first, first.filename);
      if (target.kind === 'template') {
        applyTemplate(picked);
        message.success('已从手机接收模板图');
      } else {
        setVariantReference(target.itemKey, target.regionId, picked);
        message.success('已从手机接收参考图');
      }
    },
  });

  usePasteUpload((files) => uploadTemplate(files));

  const historyGroups = useMemo(() => groupSkuHistory(gallery.items), [gallery.items]);

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
      applyDraft(draft);
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
  }, [applyDraft, message, openHistoryResult, setFailedNotice]);

  useEffect(() => {
    if (!submissionId || restoredSubmissionRef.current || gallery.loading) return;
    restoredSubmissionRef.current = true;
    const group = historyGroups.find((entry) => groupContainsTask(entry, submissionId));
    if (group) openHistoryResult(group);
    else setFailedNotice('未找到该历史提交，可能已被删除或不属于当前账号');
  }, [gallery.loading, historyGroups, openHistoryResult, setFailedNotice, submissionId]);

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
          onOpenMobile={() => mobile.openMobile({ kind: 'template' })}
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
              mobile.openMobile({ kind: 'reference', itemKey, regionId })
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
        onClose={closeEditor}
        onConfirm={confirmRegions}
      />

      <AssetLibraryModal
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={library.pick}
        maxSelectable={1}
      />

      <MobileUploadModal
        open={mobile.open}
        onReceived={mobile.addAssets}
        onCancel={mobile.closeMobile}
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
