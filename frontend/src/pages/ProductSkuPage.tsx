import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Spin } from 'antd';
import { ImagePlus, Plus, X } from 'lucide-react';
import { assetsApi, generateApi, assetSrc, toAbsoluteUrl } from '../lib/api';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { ResultGalleryPane } from '../components/ResultGalleryPane';
import { SkuRegionSelector, type SkuRegionBox } from '../components/SkuRegionSelector';
import type { Asset, MobileUploadAsset } from '../types/api';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { useResultGallery, type GalleryItem } from '../hooks/useResultGallery';
import { useAuth } from '../context/AuthContext';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { pollToResult } from '../lib/poll';
import {
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
  taskErrorText,
} from '../lib/constants';
import { ToolShell, type ToolAsset, type ToolSettings } from '../components/ToolShell';
import { BG_COLOR_SWATCHES, ColorSwatchGrid, CustomColorInput } from '../components/ToolWidgets';

/**
 * 商品SKU图 —— 1:1 复刻参考站 https://ijihua.cn/product-sku。
 *
 * 实拍结构 (product-sku-control-column):
 *   SKU模板图卡 (product-sku-template-card):
 *     标题行: 从素材库导入 / 手机上传
 *     copy: 选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
 *     dropzone (复用 local-redraw-source-upload): 点击或拖拽图片到此处上传 / 最多 1 张
 *   使用步骤卡 (product-sku-steps-card): 4 步
 *     1 上传模板图 — 导入 SKU 图，作为批量生成的模板图
 *     2 框选要变化的区域 — 在模板图上拖拽框选, 最多 3 个, 坐标随任务提交
 *     3 编辑SKU清单 — 填写 SKU 名称和颜色, 每行对应一张图
 *     4 批量输出SKU图 — 点击立即生成, 结果出现在右侧
 *   高级设置: 比例 1:1 / 画质 1K; 提交: 立即生成 (消耗价由后端下发, 当前为 0)
 *   结果面板: 商品SKU图 — 一张图，批量套出版式完全一致的整组 SKU 图。
 *
 * 本地适配: 模板图上真实框选归一化坐标; SKU 清单每行提交
 * 一次任务 (sku_image)。结果栏与商品主图共用「全部生成图」网格
 * (方形缩略图 / 每行 3–6 张 / 大图 / 下载 / 删除), 避免同一壳内两套产图样式。
 *
 * 诚实披露: sku_image 由真实图像模型完成版式渲染；没有可用模型通道时不可提交。
 */

const COLOR_LABEL: Record<string, string> = {
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
  custom: '自定义',
};

interface SkuRow {
  key: number;
  name: string;
  color: string;
  customColor: string;
}

let rowSeq = 0;
const newRow = (): SkuRow => ({ key: ++rowSeq, name: '', color: '#FFFFFF', customColor: '#8064F6' });

/** 历史任务 / 新任务的缩略图角标：优先 SKU 名称，其次颜色。 */
function skuCaption(params: Record<string, unknown>): string | undefined {
  const name = typeof params.skuName === 'string' ? params.skuName.trim() : '';
  if (name) return name;
  const color = typeof params.skuColor === 'string' ? params.skuColor : '';
  return COLOR_LABEL[color];
}

export function ProductSkuPage() {
  const { message, modal } = App.useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [template, setTemplate] = useState<ToolAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regions, setRegions] = useState<SkuRegionBox[]>([]);
  const [rows, setRows] = useState<SkuRow[]>([newRow(), newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<Array<{ key: string; label?: string }>>([]);
  const [failedNotice, setFailedNotice] = useState<string | null>(null);
  const pollSignal = usePollAbort();
  const gallery = useResultGallery({ capability: 'sku_image', token, captionOf: skuCaption });

  // 模板一换，旧框选坐标就不再对应画面，必须清空重选。
  useEffect(() => {
    setRegions([]);
  }, [template?.id]);

  const uploadTemplate = async (files: FileList | File[]) => {
    const file = Array.from(files).find(isSupportedImageFile);
    if (!file) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    setUploading(true);
    try {
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setTemplate({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
      message.success('模板图已上传（最多 1 张，新上传将替换原模板）');
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  // ── 模板图来源: 素材库 / 手机上传 (模板位只有 1 个, 选中即替换) ──
  const pickTemplate = (asset: Asset): boolean => {
    setTemplate({
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    });
    message.success('已从素材库设为模板图');
    return true;
  };
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
    pick,
  } = useAssetLibrary(pickTemplate);

  const [mobileOpen, setMobileOpen] = useState(false);
  const addMobileTemplate = useCallback(
    (assets: MobileUploadAsset[]) => {
      setMobileOpen(false);
      const first = assets[0];
      if (!first) return;
      if (assets.length > 1) message.warning('模板位只有 1 个，仅取第 1 张');
      setTemplate({
        id: first.id,
        url: toAbsoluteUrl(first.signedUrl || first.url) ?? '',
        name: first.filename,
      });
      message.success('已从手机接收模板图');
    },
    [message],
  );

  const pollOne = (taskId: string) => pollToResult(taskId, { signal: pollSignal });

  const submit = async (inputs: ToolAsset[], settings: ToolSettings) => {
    const tpl = template;
    if (!tpl || rows.length === 0 || regions.length === 0) return;
    setSubmitting(true);
    setFailedNotice(null);
    const plan = rows.map((row, index) => ({
      row,
      label: row.name.trim() || `SKU ${index + 1}`,
    }));
    setPending(plan.map((item, index) => ({ key: `${item.row.key}-${index}`, label: item.label })));
    try {
      const projectId = await ensureProject();
      const started: Array<{ taskId: string; label: string }> = [];
      for (const { row, label } of plan) {
        const { taskId } = await generateApi.start({
          projectId,
          capability: 'sku_image',
          inputAssetIds: [tpl.id],
          params: {
            skuName: row.name.trim(),
            skuColor: row.color,
            customColor: row.customColor.trim(),
            regions: JSON.stringify(regions),
            ratio: settings.ratio,
            size: settings.resolution,
          },
        });
        started.push({ taskId, label });
      }
      const done = await Promise.all(started.map((item) => pollOne(item.taskId)));
      const fresh: GalleryItem[] = done.flatMap((result, index) =>
        result.status === 'succeeded' && result.url
          ? [{
              id: started[index].taskId,
              status: 'succeeded' as const,
              url: result.url,
              width: result.width ?? null,
              height: result.height ?? null,
              createdAt: new Date().toISOString(),
              caption: started[index].label,
            }]
          : [],
      );
      gallery.prepend(fresh);
      const failed = done.filter((result) => result.status !== 'succeeded');
      if (failed.length > 0) {
        const detail = `本次有 ${failed.length} 张生成失败：${taskErrorText(failed[0]?.errorCode)}，可重新生成`;
        setFailedNotice(detail);
        message.error(`${done.length} 张中 ${failed.length} 张生成失败`);
      }
      else message.success(`已批量生成 ${done.length} 张 SKU 图`);
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      setPending([]);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  const deleteResult = (item: GalleryItem) => {
    modal.confirm({
      title: '删除这张 SKU 图？',
      content: '生成图与本地文件会一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await generateApi.remove(item.id);
          gallery.removeItem(item.id);
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
        }
      },
    });
  };

  const updateRow = (key: number, patch: Partial<SkuRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <>
    <ToolShell
      capability="sku_image"
      title="商品SKU图"
      desc="一张图，批量套出版式完全一致的整组 SKU 图。"
      upload={null}
      settings={{ ratio: true, resolution: true, defaultRatio: '1:1' }}
      submitLabel="立即生成"
      emptyDesc="上传模板图、框选变体区域并编辑 SKU 清单后，批量结果会显示在这里"
      hint={template && regions.length === 0 ? '请先在模板图上框选至少 1 个变体区域' : undefined}
      formValid={template !== null && regions.length > 0 && rows.length > 0}
      submitting={submitting}
      result={null}
      onSubmit={submit}
      resultPane={
        <ResultGalleryPane
          title={submitting ? '生成中…' : '全部生成图'}
          items={gallery.items}
          loading={gallery.loading}
          error={gallery.error}
          notice={
            failedNotice ? (
              <p className="tool-submit-notice tool-submit-notice-error">{failedNotice}</p>
            ) : null
          }
          pending={submitting ? pending : []}
          emptyTitle="商品SKU图"
          emptyDesc={
            token
              ? '上传模板图、框选变体区域并编辑 SKU 清单后，本页生成过的 SKU 图都会显示在这里'
              : '登录后，你在这个页面生成过的 SKU 图都会显示在这里'
          }
          onRefresh={() => void gallery.reload()}
          onDelete={deleteResult}
          downloadNamePrefix="sku"
        />
      }
    >
      {/* SKU模板图 */}
      <section className="product-sku-card product-sku-template-card">
        <div className="product-sku-card-heading">
          <div className="product-sku-card-heading-top">
            <h2>SKU模板图</h2>
            <div className="product-sku-card-heading-actions">
              <button
                type="button"
                className="workspace-material-library-trigger"
                onClick={openLibrary}
              >
                从素材库导入
              </button>
              <button
                type="button"
                className="mobile-upload-trigger mobile-upload-qr-trigger"
                title="用手机扫码上传，图片作为模板图"
                onClick={() => setMobileOpen(true)}
              >
                <span>手机上传</span>
              </button>
            </div>
          </div>
          <p className="product-sku-card-heading-copy">
            选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
          </p>
        </div>
        <div
          className="product-sku-template-upload-wrap"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploadTemplate(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_IMAGE_ACCEPT}
            hidden
            onChange={(e) => {
              if (e.target.files) void uploadTemplate(e.target.files);
              e.target.value = '';
            }}
          />
          {uploading && (
            <span className="pk-dropzone-loading product-sku-template-loading">
              <Spin size="small" />
            </span>
          )}
          {template ? (
            <>
              <SkuRegionSelector
                url={template.url}
                alt={template.name}
                regions={regions}
                max={3}
                onChange={setRegions}
              />
              <div className="product-sku-template-actions">
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  更换模板
                </button>
                <button type="button" onClick={() => setTemplate(null)}>
                  <X size={12} /> 移除模板
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="local-redraw-source-upload"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={22} />
              <strong>点击或拖拽图片到此处上传</strong>
              <small>点击、拖拽或粘贴图片上传，最多 1 张</small>
            </button>
          )}
        </div>
      </section>

      {/* 使用步骤 */}
      <section className="product-sku-card product-sku-steps-card">
        <div className="card-title-row">
          <h2>使用步骤</h2>
        </div>
        <ol className="product-sku-steps">
          <li className="product-sku-step">
            <strong>上传模板图</strong>
            <span>导入 SKU 图，作为批量生成的模板图</span>
          </li>
          <li className="product-sku-step">
            <strong>框选要变化的区域</strong>
            <span>框选可变内容区域，精准控制生成范围</span>
          </li>
          <li className="product-sku-step">
            <strong>编辑SKU清单</strong>
            <span>录入商品 SKU 信息，配置每个 SKU 的变化内容</span>
          </li>
          <li className="product-sku-step">
            <strong>批量输出SKU图</strong>
            <span>一键生成多款 SKU 图，高效完成批量出图</span>
          </li>
        </ol>
      </section>

      {/* SKU 清单编辑器 */}
      <section className="product-sku-card product-sku-list-card">
        <div className="card-title-row">
          <h2>SKU 清单</h2>
          <button
            type="button"
            className="pk-text-link"
            onClick={() => setRows((prev) => [...prev, newRow()])}
          >
            <Plus size={12} /> 添加 SKU
          </button>
        </div>
        <p className="product-sku-card-heading-copy">
          每行一个 SKU：填写名称和颜色；上方框选的 {regions.length} 个变体区域会应用到全部 SKU。
        </p>
        <div className="product-sku-rows">
          {rows.map((row, idx) => (
            <div key={row.key} className="product-sku-row">
              <div className="product-sku-row-head">
                <strong>SKU {idx + 1}</strong>
                <button
                  type="button"
                  className="pk-text-link"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  disabled={rows.length <= 1}
                >
                  移除
                </button>
              </div>
              <label className="product-sku-row-field">
                <span>SKU 名称</span>
                <input
                  value={row.name}
                  maxLength={60}
                  placeholder="例如：CLASSIC BLACK / M"
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                />
              </label>
              <div className="product-sku-row-field">
                <span>SKU 颜色（{COLOR_LABEL[row.color] ?? row.color}）</span>
                <ColorSwatchGrid
                  options={BG_COLOR_SWATCHES.slice(1)}
                  value={row.color}
                  onChange={(v) => updateRow(row.key, { color: v })}
                  onCustom={() => updateRow(row.key, { color: 'custom' })}
                  customActive={row.color === 'custom'}
                  customColor={row.customColor}
                  ariaLabel={`SKU ${idx + 1} 颜色`}
                />
                {row.color === 'custom' && (
                  <CustomColorInput
                    value={row.customColor}
                    onChange={(v) => updateRow(row.key, { customColor: v })}
                    label="自定义颜色（HEX）"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </ToolShell>

      {/* 素材库 / 手机上传: 模板位单张, 选中即替换 */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={1}
      />
      <MobileUploadModal open={mobileOpen} onReceived={addMobileTemplate} onCancel={() => setMobileOpen(false)} />
    </>
  );
}
