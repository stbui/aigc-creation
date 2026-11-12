import { useCallback, useMemo, useRef, useState } from 'react';

import {
  ALL_CATEGORY,
  ALL_GROUP,
  CAPABILITY_ID,
  DEFAULT_RATIO,
  DEFAULT_SIZE,
  MAX_IMAGES,
  MAX_IMAGE_MB,
} from './constants';
import { AssetLibraryModal, MobileUploadModal, ResultGalleryPane } from './components';
import { TemplateInputPane } from './TemplateInputPane';
import { TemplateShowcase } from './TemplateShowcase';
import {
  notifyCreditsChanged,
  useAuth,
  useCapabilityRuntime,
  useCreditCost,
  useDocumentMeta,
  useGenerateError,
  useImageUpload,
  useProject,
  useResultGallery,
  useTemplateCatalog,
  type GalleryItem,
} from './hooks';
import { generateApi, newIdempotencyKey, resolveModelId } from './api';
import { flattenCatalog, isUncertainSubmitError, type TemplateEntry } from './utils';
import { Modal, useApp } from '../../ui';

/**
 * 婚纱写真模板工作台
 *
 * 页面结构对齐 AI 带货图文（`/shoppable-carousel`）：
 *   左配置栏（上传人像照片 + 已选模板回显 + 高级设置 + 提交）
 *   + 右侧模板区（分类 tab + 模板网格：图片 + 名称），底部常驻「最近生成」。
 *
 * 生成规则：至少上传 1 张人物照片；提交的参数只有模板 id，服务端按模板
 * 查回提示词，与上传照片一起组成模型请求。模板清单由后端下发，前端不存副本；
 * 提示词不下发到 C 端，页面也不展示。
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：左栏 `TemplateInputPane`
 * （已选模板回显 `TemplateSelectedCard`），右栏 `TemplateShowcase`
 * （一级分类 `TemplateCategoryNav` / 二级分组 `TemplateGroupNav` / 网格
 * `TemplateGallery` / 历史 `TemplateHistory`）；模板取数落 `hooks.ts` 的
 * `useTemplateCatalog`，提交 / 删除等写操作仍留在本文件。
 */
export function TemplatePage() {
  useDocumentMeta('婚纱写真模板 · 货觉AI', '上传人物照片，选择模板，生成同款婚纱写真');

  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();

  // ── 模板清单（来自后端，前端不存副本） ──
  const {
    catalog,
    loading: templatesLoading,
    error: templatesError,
    reload: reloadTemplates,
  } = useTemplateCatalog();
  const [categoryId, setCategoryId] = useState(ALL_CATEGORY);
  const [groupId, setGroupId] = useState(ALL_GROUP);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // ── 上传 ──
  const { images, uploading, fileInputRef, uploadFiles, removeImage, library, mobile } = useImageUpload({
    max: MAX_IMAGES,
    maxMb: MAX_IMAGE_MB,
    noun: '人像照片',
  });
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
    pick,
  } = library;

  // ── 表单状态 ──
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [resolution, setResolution] = useState(DEFAULT_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);

  /**
   * 最近一次「结果未确认」的提交。
   *
   * 网络中断或 5xx 时服务端可能已建单；用户重试必须复用同一幂等键，
   * 让后端返回既有任务而不是再扣一次钱。成功拿到响应后清空。
   */
  const pendingSubmitRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  // ── 结果栏 ──
  const gallery = useResultGallery({
    capability: CAPABILITY_ID,
    token,
    includeFailed: true,
  });
  const generating = useMemo(
    () => submitting || gallery.items.some((item) => item.status === 'queued' || item.status === 'running'),
    [submitting, gallery.items],
  );
  const refreshGallery = useCallback(() => {
    void gallery.reload();
  }, [gallery.reload]);

  // ── 能力运行时（不可用时禁用提交并给出原因） ──
  const { blocked, reason } = useCapabilityRuntime(CAPABILITY_ID);

  // ── 价签 ──
  const unitCreditCost = useCreditCost(CAPABILITY_ID);
  const creditLabel = useMemo(() => {
    const unit = modelQuoteCredits ?? unitCreditCost;
    if (unit == null) return null;
    if (unit === 0) return '免费';
    return modelQuoteCredits == null ? `本次消耗 ${unit} 积分` : `本次约 ${unit} 积分（按所选模型）`;
  }, [unitCreditCost, modelQuoteCredits]);

  /** 全量展平：模板选择、历史回显与名称查找共用 */
  const allTemplates = useMemo(() => flattenCatalog(catalog), [catalog]);

  const selectedTemplate = useMemo(
    () => allTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [allTemplates, selectedTemplateId],
  );

  const formValid = images.length > 0 && Boolean(selectedTemplateId);

  const selectTemplate = useCallback((template: TemplateEntry) => {
    setSelectedTemplateId(template.id);
  }, []);

  /** 切换一级分类时回到「全部分组」，避免上一个分类的二级筛选残留 */
  const selectCategory = useCallback((nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    setGroupId(ALL_GROUP);
  }, []);

  // ── 生成 ──
  const submit = async () => {
    if (!formValid || generating || !selectedTemplateId) return;
    setSubmitting(true);

    try {
      const projectId = await ensureProject();
      const logicalModelId = await resolveModelId(CAPABILITY_ID);
      const params = {
        templateId: selectedTemplateId,
        ratio,
        size: resolution,
      };
      const inputAssetIds = images.map((image) => image.id);

      /*
       * 幂等键按「本次输入指纹」复用：结果未确认时用户重试会拿到同一个 key，
       * 服务端返回已创建的任务而不是再扣一次钱。
       */
      const fingerprint = JSON.stringify({
        capability: CAPABILITY_ID,
        projectId,
        logicalModelId,
        inputAssetIds,
        params,
      });
      const previous =
        pendingSubmitRef.current?.fingerprint === fingerprint ? pendingSubmitRef.current : null;
      const idempotencyKey = previous?.idempotencyKey ?? newIdempotencyKey();
      pendingSubmitRef.current = { fingerprint, idempotencyKey };

      await generateApi.start({
        projectId,
        capability: CAPABILITY_ID,
        logicalModelId,
        inputAssetIds,
        idempotencyKey,
        params,
      });

      await gallery.reload();
      pendingSubmitRef.current = null;
      message.success('已提交婚纱写真，生成完成后自动更新');
    } catch (error) {
      reportError(error);
      await gallery.reload();
      if (isUncertainSubmitError(error)) {
        message.warning('提交结果未确认，请先查看生成记录；重新提交不会重复扣费');
      }
    } finally {
      setSubmitting(false);
      notifyCreditsChanged();
    }
  };

  const deleteItem = useCallback(
    (item: GalleryItem) => {
      modal.confirm({
        title: '删除这张写真？',
        content: '生成图与本地文件会一并删除，不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await generateApi.remove(item.id);
            gallery.removeItem(item.id);
            message.success('已删除写真');
          } catch (error) {
            message.error((error as Error).message || '删除失败，请刷新后重试');
            await gallery.reload();
          }
        },
      });
    },
    [gallery, message, modal],
  );

  const guestLabel = blocked ? undefined : '登录后生成婚纱写真';
  const hint = blocked
    ? (reason ?? undefined)
    : images.length === 0
      ? '请先上传至少 1 张人物照片'
      : !selectedTemplateId
        ? '请先在右侧选择一个模板'
        : undefined;

  return (
    <div className="tpl-workspace">
      <div className="tpl-body">
        {/* ── 左: 配置栏 ── */}
        <TemplateInputPane
          images={images}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onFiles={(files) => void uploadFiles(files)}
          onRemove={removeImage}
          onOpenLibrary={openLibrary}
          onOpenMobile={mobile.openMobile}
          selectedTemplate={selectedTemplate}
          onClearTemplate={() => setSelectedTemplateId(null)}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
          ratio={ratio}
          onRatioChange={setRatio}
          resolution={resolution}
          onResolutionChange={setResolution}
          onModelQuoteChange={setModelQuoteCredits}
          generating={generating}
          submitDisabled={!formValid || blocked}
          guestLabel={guestLabel}
          creditLabel={creditLabel}
          hint={hint}
          onSubmit={() => void submit()}
        />

        {/* ── 右: 模板展示（常驻）+ 底部历史记录 ── */}
        <section className="tpl-showcase">
          <TemplateShowcase
            catalog={catalog}
            categoryId={categoryId}
            groupId={groupId}
            onCategoryChange={selectCategory}
            onGroupChange={setGroupId}
            allTemplates={allTemplates}
            selectedTemplateId={selectedTemplateId}
            onSelectTemplate={selectTemplate}
            templatesLoading={templatesLoading}
            templatesError={templatesError}
            onRetryTemplates={() => void reloadTemplates()}
            galleryItems={gallery.items}
            galleryLoading={gallery.loading}
            galleryError={gallery.error}
            onRefreshGallery={refreshGallery}
            onOpenAll={() => setHistoryOpen(true)}
          />
        </section>
      </div>

      {/* 素材库选择弹窗（真实数据） */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={MAX_IMAGES}
      />

      {/* 手机上传弹窗（二维码方案） */}
      <MobileUploadModal open={mobile.open} onReceived={mobile.addAssets} onCancel={mobile.closeMobile} />

      {/* 全部记录抽屉 */}
      <Modal
        open={historyOpen}
        title="全部生成记录"
        width={960}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <ResultGalleryPane
          title="生成记录"
          items={gallery.items}
          loading={gallery.loading}
          error={gallery.error}
          emptyTitle="还没有生成记录"
          emptyDesc={
            token
              ? '提交任务后，你生成的婚纱写真会陈列在这里'
              : '登录后，你在这个页面生成过的写真都会显示在这里'
          }
          onRefresh={refreshGallery}
          onDelete={deleteItem}
          downloadNamePrefix="wedding-template"
        />
      </Modal>
    </div>
  );
}
