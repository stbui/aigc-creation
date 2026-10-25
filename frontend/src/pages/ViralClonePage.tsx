import { useCallback, useRef, useState } from 'react';
import { App, Modal } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Maximize2 } from 'lucide-react';
import { assetsApi, generateApi, assetSrc, toAbsoluteUrl } from '../lib/api';
import { languageOptions, platformOptions } from '../lib/optionSets';

import { ToolWorkflowSteps } from '../components/ToolEmptyState';
import { ToolSubmitBar } from '../components/ToolSubmitBar';
import { ToolImageDropzone } from '../components/ToolImageDropzone';
import { ToolSettingsPopover } from '../components/ToolSettingsPopover';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { ResultGalleryPane } from '../components/ResultGalleryPane';
import type { ImageMenuItem } from '../components/ImageContextMenu';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { useCapabilities } from '../hooks/useCapabilities';
import { useCreditLabel } from '../hooks/useCreditLabel';
import { useGenerateError } from '../hooks/useGenerateError';
import { useResultGallery, type GalleryItem } from '../hooks/useResultGallery';
import { useAuth } from '../context/AuthContext';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { pollToResult } from '../lib/poll';
import { MAX_IMAGE_MB, taskErrorText } from '../lib/constants';
import type { Asset, MobileUploadAsset, TaskStatus } from '../types/api';

/**
 * 爆款复刻工作台 —— 1:1 复刻参考站 https://ijihua.cn/viral-clone。
 *
 * 版面数值来自参考站 computed styles 实拍 (1920×1080):
 *   上传商品图 / 生成设置卡 / 高级设置 popover 与 product-kit、product-detail 同类同值
 *   上传参考图（爆款图）: 独立 section, 400x160 虚线区 (同款 dropzone),
 *              plus 图标 margin-bottom 20; 标题行只有"从素材库导入/手机上传", 无计数器;
 *              文件输入不 multiple, 上限 1 张
 *   复刻要求: 独立卡 432x141 radius16 padding16; label 14px/700 #333;
 *              textarea 400x80 rows3 maxlength1000, padding 5px 36px 5px 12px, radius4
 *   复刻程度: 独立卡 432x155; 2 列 x 192 gap16; 选项 192x86 bg #F2F4F7 radius8
 *              padding 8px 16px flex-column gap8; 标题 14px #333 flex gap8 带 <i> 14x14
 *              圆点 (inactive: border 1px #C9CDD4; active: border 4px #625DF5 + 白底);
 *              说明 12px #86909C lh20; 默认选中"高度复刻"
 *
 * 接线: 商品图 + 参考图 → hot_remake 任务 (inputAssetIds 顺序即上传顺序,
 * 后端保序: [0]=商品图 [1]=参考图); 复刻程度 → degree 参数
 * (high_replica=参考图为底替换商品 / reference_style=提取参考图布局重建场景);
 * 复刻要求/名称/品牌 → 任务参数 (中文原文完整下发; 不再有"图内只画 ASCII"的本地兜底);
 * 比例/画质 → ratio / size 参数。
 *
 * 本地实现是**真实算法** (makeClone: 提取参考图布局签名与调色板 →
 * 按两档复刻程度重建场景 / 换主体)。云端通道不可用时由本地兜底出图,
 * 保底有产出; 只有能力被后台下线时才置灰提交。
 */

// ───────────────── 常量 (参考站实拍) ─────────────────

const MAX_IMAGES = 5;
const MAX_NAME_LEN = 100;
const MAX_REQUIREMENT_LEN = 1000;

/** 复刻程度两档 (实拍: 默认选中"高度复刻") */
const CLONE_DEGREES: Array<{ value: 'reference_style' | 'high_replica'; label: string; desc: string }> = [
  { value: 'reference_style', label: '参考风格', desc: '参考整体风格和结构，自动调整色彩和重构场景。' },
  { value: 'high_replica', label: '高度复刻', desc: '参照参考图视觉结构替换产品和文案，场景细节略有差异。' },
];

const DEGREE_LABEL: Record<string, string> = {
  reference_style: '参考风格',
  high_replica: '高度复刻',
};

interface PkAsset {
  id: string;
  url: string;
  name: string;
}

interface PkResult {
  status: TaskStatus;
  url?: string;
  width?: number;
  height?: number;
  errorCode?: string | null;
}

/**
 * 任务参数里的复刻程度 → 缩略图标签。
 *
 * 本页唯一会显著改变产出观感的维度就是复刻程度 (参考风格 / 高度复刻),
 * 两种结果混在一格里若不带标签, 用户无法知道自己看的是哪一档。
 * 后台认不出的度数原样显示, 不吞掉信息。
 */
function degreeCaption(params: Record<string, unknown>): string | undefined {
  const v = params?.degree;
  return typeof v === 'string' ? (DEGREE_LABEL[v] ?? v) : undefined;
}

export function ViralClonePage() {
  const { message, modal } = App.useApp();
  const reportError = useGenerateError();
  const navigate = useNavigate();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  // ── 表单状态 ──
  const [images, setImages] = useState<PkAsset[]>([]);
  const [reference, setReference] = useState<PkAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [platform, setPlatform] = useState('taobao');
  const [language, setLanguage] = useState('zh-CN');
  const [requirement, setRequirement] = useState('');
  const [degree, setDegree] = useState<'reference_style' | 'high_replica'>('high_replica');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 弹窗状态 ──
  const [expandOpen, setExpandOpen] = useState(false);
  /** 素材库双通道: 本次导入写入商品图还是参考图（由触发按钮决定） */
  const [libraryTarget, setLibraryTarget] = useState<'product' | 'reference'>('product');
  /** 手机上传双通道: 与素材库同理, 由触发按钮决定回填到哪一栏 */
  const [mobileTarget, setMobileTarget] = useState<'product' | 'reference'>('product');
  const [mobileOpen, setMobileOpen] = useState(false);

  // ── 任务状态 ──
  const [submitting, setSubmitting] = useState(false);
  // 实时价来自能力清单（后台可调价），按钮文案不能再写死「免费生图」
  const creditLabel = useCreditLabel('hot_remake');
  /** 最近这一次提交的结果 (只用于提示行; 历史产出由 gallery 维护) */
  const [result, setResult] = useState<PkResult | null>(null);
  const pollSignal = usePollAbort();

  // ── 右侧结果栏 ──
  //
  // 与创意生图页、商品主图页、商品详情页同构: 网格展示本能力**全部**历史产出,
  // 用户可以并排比较「参考风格」与「高度复刻」两档的差异;
  // 缩略图左上角按任务参数标出当次复刻程度。
  const { token } = useAuth();
  const gallery = useResultGallery({ capability: 'hot_remake', token, captionOf: degreeCaption });
  // 服务端仍有 running/pending 任务时也算生成中: 离开页面再回来, 禁用态与标题不丢
  const generating = submitting || gallery.items.some((item) => !item.url);

  // 参考站本页名称/品牌/复刻要求均为选填, 提交条件 = 商品图 ≥1 + 参考图 =1
  const formValid = images.length > 0 && reference !== null;

  /*
   * 该能力此刻能不能生成。
   *
   * hot_remake 有真实本地算法, 没通道会回落本地而非失败; 只有被后台下线
   * (`disabled`) 或能力状态异常 (`unavailable`) 时才需要提前拦住提交。
   */
  const { data: capData } = useCapabilities();
  const hotRemakeRuntime = capData?.items.find((c) => c.id === 'hot_remake')?.runtime;
  const unavailableReason =
    hotRemakeRuntime &&
    (hotRemakeRuntime.effective === 'unavailable' || hotRemakeRuntime.effective === 'disabled')
      ? hotRemakeRuntime.reason || '该能力当前不可提交，请稍后再试或联系客服。'
      : null;

  // ── 上传: 商品图 (点击/拖拽/粘贴, 最多 5 张) ──
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > MAX_IMAGE_MB * 1024 * 1024);
      if (oversize.length > 0) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
        return;
      }

      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: PkAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        }
        setImages((prev) => [...prev, ...uploaded]);
        message.success(`已上传 ${uploaded.length} 张商品图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, ensureProject, message],
  );

  // ── 上传: 参考图 (单张, 超出即替换) ──
  const uploadReference = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        message.warning('请选择图片文件（PNG / JPG / WebP / GIF）');
        return;
      }
      const file = list[0];
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${file.name}`);
        return;
      }
      setUploading(true);
      try {
        const projectId = await ensureProject();
        const asset = await assetsApi.upload(file, projectId);
        setReference({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        message.success('参考图已上传（最多 1 张，新上传将替换原参考图）');
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [ensureProject, message],
  );

  const removeImage = (id: string) => setImages((prev) => prev.filter((x) => x.id !== id));

  // 拖拽 & 粘贴 (粘贴走商品图区, 与参考站主路径一致; 参考图支持点击/拖拽)
  // 两个拖拽高亮态均已下沉到 ToolImageDropzone 内部, 页面不再持有
  usePasteUpload(uploadFiles);

  // ── 素材库导入 (商品图 / 参考图共用) ──

  /** 返回 false = 拒绝本次选择(弹窗保持打开, 让用户改选) */
  const pickFromLibrary = (asset: Asset): boolean => {
    const name = asset.sourceUrl.split('/').pop() ?? '素材';
    if (libraryTarget === 'reference') {
      setReference({ id: asset.id, url: assetSrc(asset) ?? '', name });
      return true;
    }
    if (images.length >= MAX_IMAGES) {
      message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
      return false;
    }
    if (images.some((x) => x.id === asset.id)) {
      message.info('该素材已在列表中');
      return false;
    }
    setImages((prev) => [...prev, { id: asset.id, url: assetSrc(asset) ?? '', name }]);
    return true;
  };

  // 素材库弹窗 (通用组件; 双通道: 商品图 / 参考图)
  const {
    open: libraryOpen,
    loading: libraryLoading,
    items: libraryItems,
    error: libraryError,
    openLibrary,
    closeLibrary,
    pick,
  } = useAssetLibrary(pickFromLibrary);
  const openLibraryFor = (target: 'product' | 'reference') => {
    setLibraryTarget(target);
    openLibrary();
  };

  // ── 手机上传 (与素材库同一套双通道语义) ──
  const openMobileFor = (target: 'product' | 'reference') => {
    setMobileTarget(target);
    setMobileOpen(true);
  };

  /**
   * 手机端传回图片 → 按本次触发按钮决定写入商品图还是参考图。
   *
   * 参考图位只有 1 个: 多传的部分如实告知被丢弃 (不静默截断)。
   */
  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      const toAsset = (a: MobileUploadAsset) => ({
        id: a.id,
        url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
        name: a.filename,
      });
      if (mobileTarget === 'reference') {
        const first = assets[0];
        setMobileOpen(false);
        if (!first) return;
        if (assets.length > 1) message.warning('参考图位只有 1 个，仅取第 1 张');
        setReference(toAsset(first));
        message.success('已从手机接收参考图');
        return;
      }
      // 额度判定放在 setState 外: 在 updater 里弹 toast 会被 StrictMode 跑两遍
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`商品图位已满 (${MAX_IMAGES} 张), 手机上传的图片未加入`);
        setMobileOpen(false);
        return;
      }
      const fresh = assets.filter((a) => !images.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room);
      if (fresh.length > accepted.length) {
        message.warning(`商品图位只剩 ${room} 个, ${fresh.length - accepted.length} 张未加入`);
      }
      setImages((prev) => [...prev, ...accepted.map(toAsset)]);
      setMobileOpen(false);
      if (accepted.length > 0) message.success(`已从手机接收 ${accepted.length} 张图片`);
    },
    [images, message, mobileTarget],
  );

  // ── 生成 ──
  const pollTask = useCallback(
    (taskId: string) => pollToResult(taskId, { signal: pollSignal }),
    [pollSignal],
  );

  const submit = async () => {
    if (!formValid || !reference || generating) return;
    // 没有可用模型通道: 后端必定 42204 并退款, 不发起这次注定失败的任务
    if (unavailableReason) {
      message.warning(unavailableReason);
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'hot_remake',
        // 顺序即语义: [0]=商品图, [1]=参考图 (后端 processTask 按提交序保序)
        inputAssetIds: [...images.map((x) => x.id), reference.id],
        params: {
          productName: productName.trim(),
          brand: brand.trim(),
          platform,
          language,
          requirement: requirement.trim(),
          degree,
          ratio,
          size: resolution,
        },
      });
      const done = await pollTask(taskId);
      setResult(done);
      /*
       * 成功的图**直接插到网格首位**, 不回头重拉列表 (与创意生图 / 商品主图同款):
       * 重拉多一次往返, 占位撤下与新图到位之间会出现回弹闪烁。
       */
      if (done.status === 'succeeded' && done.url) {
        const fresh: GalleryItem = {
          id: taskId,
          url: done.url,
          width: done.width ?? null,
          height: done.height ?? null,
          createdAt: new Date().toISOString(),
          caption: DEGREE_LABEL[degree] ?? degree,
        };
        gallery.prepend([fresh]);
      }
      if (done.status === 'failed') message.error(`生成失败：${taskErrorText(done.errorCode)}`);
      else message.success('爆款复刻图已生成');
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  /**
   * 把这张生成图放进右侧「上传参考图（爆款图）」位。
   *
   * 本页的产出天然适合当下一轮的参考图 (复刻一张满意的结果, 再微调要求),
   * 而参考图位只有 1 个 —— 直接替换, 不排队, 与上传语义一致。
   */
  const useAsReference = (item: GalleryItem) => {
    const assetId = item.assetId;
    if (!assetId) {
      // 任务还在但素材已被清理 (后台删过素材): 不能拿一个空 id 去提交
      message.error('这张图片的素材已不存在，无法用作参考图');
      return;
    }
    if (reference?.id === assetId) {
      message.info('该图片已在参考图位');
      return;
    }
    setReference({ id: assetId, url: item.url, name: `生成图-${item.id.slice(-6)}` });
    message.success('已放入参考图位，下一轮复刻会以它为参考');
  };

  /**
   * 删除一张生成图 —— DELETE /tasks/:id 会连带删掉产出素材与磁盘文件。
   *
   * 与创意生图 / 商品主图 / 商品详情页同款确认框: 删除不可逆, 且用户此时看到的
   * 是缩略图, 未必意识到「作品记录」也一起没了。
   */
  const deleteImage = (item: GalleryItem) => {
    modal.confirm({
      title: '删除这张作品？',
      content: '生成图与本地文件会一并删除，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await generateApi.remove(item.id);
          gallery.removeItem(item.id);
          /*
           * 产出素材随之被删, 若它已被「用作参考图」放进参考图位, 必须同步清掉 ——
           * 否则下一次提交会带着一个已不存在的 assetId, 后端只能报错。
           */
          if (item.assetId) setReference((prev) => (prev?.id === item.assetId ? null : prev));
          message.success('已删除作品及其生成图');
        } catch (e) {
          message.error((e as Error).message || '删除失败');
        }
      },
    });
  };

  return (
    <div className="pk-workspace">
      {/* ── 左: 输入栏 ── */}
      <aside className="pk-input-pane">
        <div className="pk-form-card">
          {/* 业务类型 tab: 参考站仅窄屏显示 (桌面端 display:none 实拍确认) */}
          <div className="pk-editor-tabs" role="tablist" aria-label="业务类型">
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/product-kit')}>
              商品主图
            </button>
            <button type="button" role="tab" aria-selected={false} className="pk-editor-tab" onClick={() => navigate('/product-detail')}>
              商品详情
            </button>
            <button type="button" role="tab" aria-selected className="pk-editor-tab pk-editor-tab-active">
              爆款复刻
            </button>
          </div>

          <div className="pk-form-scroll">
            {/* 上传商品图 + 上传参考图 + 生成设置 (参考站同一张卡片) */}
            <section className="pk-config-card">
              <ToolImageDropzone
                title="上传商品图"
                images={images}
                max={MAX_IMAGES}
                maxMb={MAX_IMAGE_MB}
                uploading={uploading}
                fileInputRef={fileInputRef}
                onFiles={(f) => void uploadFiles(f)}
                onRemove={removeImage}
                onOpenLibrary={() => openLibraryFor('product')}
                onOpenMobile={() => openMobileFor('product')}
                noun="商品图片"
              />

              {/* 上传参考图（爆款图）: 独立 section, 单张上传, 标题行无计数器 */}
              <ToolImageDropzone
                title="上传参考图（爆款图）"
                images={reference ? [reference] : []}
                max={1}
                maxMb={MAX_IMAGE_MB}
                uploading={uploading}
                fileInputRef={referenceInputRef}
                onFiles={(f) => void uploadReference(f)}
                onRemove={() => setReference(null)}
                onOpenLibrary={() => openLibraryFor('reference')}
                onOpenMobile={() => openMobileFor('reference')}
                noun="参考图片"
                sectionClassName="vc-reference-section"
                dropzoneClassName="pk-dropzone-reference"
                single
                showCount={false}
                emptyHint={`上传或粘贴要复刻风格的参考图，最多 1 张，单张不超过 ${MAX_IMAGE_MB}MB`}
              />

              <div className="pk-section">
                <strong className="pk-section-title">生成设置</strong>
                <div className="pk-form-grid">
                  <label className="pk-field">
                    <span className="pk-field-label">商品名称（选填）</span>
                    <input
                      value={productName}
                      maxLength={MAX_NAME_LEN}
                      placeholder="请输入商品名称（选填）"
                      onChange={(e) => setProductName(e.target.value)}
                    />
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">品牌（选填）</span>
                    <input
                      value={brand}
                      maxLength={MAX_NAME_LEN}
                      placeholder="请输入品牌（选填）"
                      onChange={(e) => setBrand(e.target.value)}
                    />
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">平台</span>
                    <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                      {platformOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pk-field">
                    <span className="pk-field-label">语言</span>
                    <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                      {languageOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </section>

            {/* 复刻要求 (独立卡) */}
            <section className="pk-config-card vc-requirement-card">
              <div className="pk-section">
                <strong className="pk-section-title">复刻要求</strong>
                <div className="pk-desc-editor">
                  <textarea
                    className="vc-requirement-textarea"
                    rows={3}
                    maxLength={MAX_REQUIREMENT_LEN}
                    value={requirement}
                    placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
                    onChange={(e) => setRequirement(e.target.value)}
                  />
                  <button
                    type="button"
                    className="pk-desc-expand"
                    aria-label="放大编辑复刻要求"
                    title="放大编辑"
                    onClick={() => setExpandOpen(true)}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </section>

            {/* 复刻程度 (独立卡, 默认高度复刻) */}
            <section className="pk-config-card vc-degree-card">
              <div className="pk-section">
                <strong className="pk-section-title">复刻程度</strong>
                <div className="pk-section-picker vc-degree-options" role="radiogroup" aria-label="复刻程度">
                  {CLONE_DEGREES.map((d) => {
                    const active = d.value === degree;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`vc-degree-option${active ? ' vc-degree-option-active' : ''}`}
                        onClick={() => setDegree(d.value)}
                      >
                        <span className="vc-degree-title">
                          <i className="vc-degree-dot" aria-hidden />
                          {d.label}
                        </span>
                        <small>{d.desc}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>


          {/* 高级设置 + 提交 (sticky 底部) */}
          {/* 无可用模型通道: 提前说明, 而不是让用户点下去等一次 42204 */}
          {unavailableReason && !generating && (
            <p className="tool-submit-notice tool-submit-notice-error">{unavailableReason}</p>
          )}
          <ToolSubmitBar
            submitting={generating}
            disabled={!formValid || Boolean(unavailableReason)}
            label="立即生成"
            creditLabel={creditLabel ?? undefined}
            settings={
              <ToolSettingsPopover
                open={settingsOpen}
                onToggle={() => setSettingsOpen((v) => !v)}
                ratio={ratio}
                onRatioChange={setRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
                capabilityId="hot_remake"
              />
            }
            onSubmit={() => void submit()}
          />
        </div>
      </aside>

      {/* ── 右: 结果栏 (本能力全部生成图) ──
          与创意生图页同构的全部产出网格, 用户可以并排比较
          「参考风格」与「高度复刻」两档的差异。
          本次出图由 gallery.prepend 插到榜首, 生成中画一张占位卡。 */}
      <ResultGalleryPane
        title={generating ? '生成中…' : '全部生成图'}
        items={gallery.items}
        loading={gallery.loading}
        error={gallery.error}
        notice={
          result && result.status === 'failed' ? (
            <p className="tool-submit-notice tool-submit-notice-error">
              本次生成失败：{taskErrorText(result.errorCode)}，可重新生成
            </p>
          ) : null
        }
        pending={submitting ? [{ key: 'clone', label: '爆款复刻图' }] : []}
        emptyTitle="效果图预览"
        emptyDesc={
          token
            ? '提交任务后，生成结果将在此处展示，本页生成过的图都会保留在这里'
            : '登录后，你在这个页面生成过的图都会显示在这里'
        }
        emptyChildren={<ToolWorkflowSteps />}
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
        extraActions={(item): ImageMenuItem[] => [
          {
            key: 'reference',
            label: '用作参考图',
            icon: ImagePlus,
            onSelect: () => useAsReference(item),
          },
        ]}
        downloadNamePrefix="viral-clone"
      />

      {/* 素材库选择弹窗 (真实数据; 按 libraryTarget 决定写入商品图还是参考图)
          参考图是**单张位** → maxSelectable=1, 选择器自动退化为单选语义;
          商品图是多张位 → 上限 MAX_IMAGES。 */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={libraryTarget === 'reference' ? 1 : MAX_IMAGES}
      />

      {/* 手机上传弹窗 (二维码方案; 按 mobileTarget 决定写入商品图还是参考图) */}
      <MobileUploadModal open={mobileOpen} onReceived={addMobileAssets} onCancel={() => setMobileOpen(false)} />

      {/* 复刻要求放大编辑 */}
      <Modal
        open={expandOpen}
        title="编辑复刻要求"
        okText="确定"
        cancelText="取消"
        onOk={() => setExpandOpen(false)}
        onCancel={() => setExpandOpen(false)}
      >
        <textarea
          className="pk-expand-textarea"
          rows={10}
          maxLength={MAX_REQUIREMENT_LEN}
          value={requirement}
          placeholder="例如：文案统一用英文、模特保持完全不变、参考图不变只替换商品。"
          onChange={(e) => setRequirement(e.target.value)}
        />
      </Modal>
    </div>
  );
}
