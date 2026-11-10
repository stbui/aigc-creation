import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CAPABILITY_ID,
  DEFAULT_RATIO,
  DEFAULT_SIZE,
  MAX_IMAGES,
  MAX_IMAGE_MB,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  ModelPicker,
  ResultGalleryPane,
  ToolImageDropzone,
  ToolSettingsPopover,
  ToolSubmitBar,
} from './components';
import { TemplateGallery } from './TemplateGallery';
import { TemplateHistory } from './TemplateHistory';
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
  type GalleryItem,
} from './hooks';
import {
  ApiError,
  generateApi,
  newIdempotencyKey,
  resolveModelId,
  templateApi,
  type PortraitTemplate,
} from './api';
import { filterTemplatesByCategory } from './utils';
import { Modal, useApp } from '../../ui';

/** 分类 tab 的「全部」项（纯前端筛选态，不来自后端） */
const ALL_CATEGORY = '';

/**
 * `POST /generate` 的失败是否「结果不明」。
 *
 * 一次提交只发一个请求，服务端在同一事务里建任务 + 建账 + 预留：
 *   · 4xx 是扣费前的确定性拒绝（参数 / 权益 / 余额），不可能留下任务；
 *   · 5xx 与 fetch 网络中断时，请求可能已经到达服务端并落库，
 *     只能提示用户先核对生成记录。
 */
function isUncertainSubmitError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}

/**
 * 婚纱写真模板工作台
 *
 * 页面结构对齐 AI 带货图文（`/shoppable-carousel`）：
 *   左配置栏（上传人像照片 + 已选模板回显 + 高级设置 + 提交）
 *   + 右侧模板区（分类 tab + 模板网格：图片 + 提示词），底部常驻「最近生成」。
 *
 * 生成规则：至少上传 1 张人物照片；提交的参数只有模板 id，服务端按模板
 * 查回提示词，与上传照片一起组成模型请求。模板清单由后端下发，前端不存副本。
 */
export function TemplatePage() {
  useDocumentMeta('婚纱写真模板 · 货觉AI', '上传人物照片，选择模板，生成同款婚纱写真');

  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();

  // ── 模板清单（来自后端，前端不存副本） ──
  const [templates, setTemplates] = useState<PortraitTemplate[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(ALL_CATEGORY);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const result = await templateApi.templates();
      setTemplates(result.templates);
      setCategories(result.categories);
    } catch (e) {
      setTemplatesError((e as Error).message || '模板清单加载失败');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

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

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const formValid = images.length > 0 && Boolean(selectedTemplateId);

  const selectTemplate = useCallback((template: PortraitTemplate) => {
    setSelectedTemplateId(template.id);
  }, []);

  const visibleTemplates = useMemo(
    () => filterTemplatesByCategory(templates, categoryId),
    [templates, categoryId],
  );

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
    } catch (e) {
      reportError(e);
      await gallery.reload();
      if (isUncertainSubmitError(e)) {
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
          } catch (e) {
            message.error((e as Error).message || '删除失败，请刷新后重试');
            await gallery.reload();
          }
        },
      });
    },
    [gallery, message, modal],
  );

  return (
    <div className="tpl-workspace">
      <div className="tpl-body">
        {/* ── 左: 配置栏 ── */}
        <aside className="tpl-input-pane">
          <div className="tpl-form-card">
            <div className="tpl-form-scroll">
              <ToolImageDropzone
                title="上传人像照片"
                noun="人像照片"
                required
                images={images}
                max={MAX_IMAGES}
                maxMb={MAX_IMAGE_MB}
                uploading={uploading}
                fileInputRef={fileInputRef}
                onFiles={(files) => void uploadFiles(files)}
                onRemove={removeImage}
                onOpenLibrary={openLibrary}
                onOpenMobile={mobile.openMobile}
                emptyHint={`至少上传 1 张清晰人像；最多 ${MAX_IMAGES} 张，单张不超过 ${MAX_IMAGE_MB}MB`}
              />

              <section className="tpl-section">
                <strong className="pk-section-title">
                  <i className="pk-required-mark">*</i>
                  选择模板
                </strong>
                {selectedTemplate ? (
                  <div className="tpl-selected">
                    <img
                      src={selectedTemplate.thumbFile}
                      alt={`${selectedTemplate.name} 模板预览`}
                      loading="lazy"
                    />
                    <div className="tpl-selected-copy">
                      <strong>{selectedTemplate.name}</strong>
                      <p title={selectedTemplate.prompt}>{selectedTemplate.prompt}</p>
                      <button
                        type="button"
                        className="tpl-selected-clear"
                        onClick={() => setSelectedTemplateId(null)}
                      >
                        清除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tpl-selected-empty">在右侧选择一个模板后即可生成</div>
                )}
              </section>
            </div>

            <div className="tpl-form-footer">
              <div className="tpl-footer-row">
                <ToolSettingsPopover
                  open={settingsOpen}
                  onToggle={() => setSettingsOpen((open) => !open)}
                  ratio={ratio}
                  onRatioChange={setRatio}
                  resolution={resolution}
                  onResolutionChange={setResolution}
                  capabilityId={CAPABILITY_ID}
                  modelPicker={
                    <ModelPicker
                      capability={CAPABILITY_ID}
                      options={{ ratio, size: resolution }}
                      onQuoteChange={setModelQuoteCredits}
                    />
                  }
                />
              </div>
              <ToolSubmitBar
                submitting={generating}
                disabled={!formValid || blocked}
                label="生成婚纱写真"
                guestLabel={blocked ? undefined : '登录后生成婚纱写真'}
                creditLabel={creditLabel ?? undefined}
                hint={
                  blocked
                    ? (reason ?? undefined)
                    : images.length === 0
                      ? '请先上传至少 1 张人物照片'
                      : !selectedTemplateId
                        ? '请先在右侧选择一个模板'
                        : undefined
                }
                onSubmit={() => void submit()}
              />
            </div>
          </div>
        </aside>

        {/* ── 右: 模板展示（常驻）+ 底部历史记录 ── */}
        <section className="tpl-showcase">
          <nav className="tpl-categories" aria-label="模板分类">
            <button
              type="button"
              aria-pressed={categoryId === ALL_CATEGORY}
              className={`tpl-category${categoryId === ALL_CATEGORY ? ' is-active' : ''}`}
              onClick={() => setCategoryId(ALL_CATEGORY)}
            >
              全部模板
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={categoryId === category.id}
                className={`tpl-category${categoryId === category.id ? ' is-active' : ''}`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.label}
              </button>
            ))}
          </nav>

          <div className="tpl-template-scroll">
            <TemplateGallery
              templates={visibleTemplates}
              selectedId={selectedTemplateId}
              onSelect={selectTemplate}
              error={templatesError}
              loading={templatesLoading}
              onRetry={() => void loadTemplates()}
            />
          </div>

          <TemplateHistory
            items={gallery.items}
            templates={templates}
            loading={gallery.loading}
            error={gallery.error}
            onRefresh={refreshGallery}
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
