import { useCallback, useRef, useState } from 'react';

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  SUPPORTED_IMAGE_LABEL,
  type PkAsset,
  type PkResult,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  Separator,
  StatusBadge,
  Surface,
  SurfaceContent,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from './components';
import { ViralCloneConfig } from './ViralCloneConfig';
import { ViralCloneDegreeCard } from './ViralCloneDegreeCard';
import { ViralCloneRequirementCard } from './ViralCloneRequirementCard';
import { ViralCloneRequirementModal } from './ViralCloneRequirementModal';
import { ViralCloneResultPane } from './ViralCloneResultPane';
import { ViralCloneSubmitBar } from './ViralCloneSubmitBar';
import { ViralCloneTabs } from './ViralCloneTabs';
import {
  notifyCreditsChanged,
  useAssetLibrary,
  useAuth,
  useCapabilities,
  useCollectedReferenceAsset,
  useCreditLabel,
  useGenerateError,
  usePasteUpload,
  usePollAbort,
  useProject,
  useResultGallery,
  type GalleryItem,
} from './hooks';
import {
  assetsApi,
  assetSrc,
  generateApi,
  newIdempotencyKey,
  resolveModelId,
  toAbsoluteUrl,
} from './api';
import {
  degreeCaption,
  isSupportedImageFile,
  platformSpec,
  pollToResult,
  taskErrorText,
} from './utils';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp } from '../../ui';

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
 * 复刻由真实图像模型完成；没有可用模型通道时页面禁用提交，
 * 直调任务会失败并退款。
 */

export function ViralClonePage() {
  const { message, modal } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  /** 同一次提交的网络重试复用幂等键，避免重复建单扣费 */
  const pendingStartRef = useRef<{ fingerprint: string; key: string } | null>(null);

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
  /** 用户手动改过比例/画质后，切换平台不再覆盖 */
  const [ratioTouched, setRatioTouched] = useState(false);
  const [resolutionTouched, setResolutionTouched] = useState(false);
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
  // 实时价优先用所选模型报价，取不到才回落到能力基础价
  const [modelQuoteCredits, setModelQuoteCredits] = useState<number | null>(null);
  const baseCreditLabel = useCreditLabel('hot_remake');
  const creditLabel =
    modelQuoteCredits == null
      ? baseCreditLabel
      : modelQuoteCredits === 0
        ? '免费'
        : `本次约 ${modelQuoteCredits} 积分（按所选模型）`;
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

  /** 切换平台：用户没手动改过比例/画质时，带出该平台的主图规格 */
  const changePlatform = (value: string) => {
    setPlatform(value);
    const spec = platformSpec(value);
    if (!spec) return;
    if (!ratioTouched) setRatio(spec.ratio);
    if (!resolutionTouched) setResolution(spec.size);
  };

  // 浏览器扩展「图片复刻」直接带参考图进来（地址参数由 hook 自行清理）
  useCollectedReferenceAsset(setReference);

  /*
   * 该能力此刻能不能生成。
   *
   * 没有可用模型通道 (`unavailable`) 或被后台下线 (`disabled`) 时提前拦住提交。
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
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${MAX_IMAGES} 张商品图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > MAX_IMAGE_BYTES);
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
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const file = list[0];
      if (file.size > MAX_IMAGE_BYTES) {
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
      const logicalModelId = await resolveModelId('hot_remake');
      const payload = {
        projectId,
        capability: 'hot_remake',
        logicalModelId,
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
      };
      const fingerprint = JSON.stringify(payload);
      const idempotencyKey =
        pendingStartRef.current?.fingerprint === fingerprint
          ? pendingStartRef.current.key
          : newIdempotencyKey();
      pendingStartRef.current = { fingerprint, key: idempotencyKey };
      const { taskId } = await generateApi.start({ ...payload, idempotencyKey });
      pendingStartRef.current = null;
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
          assetId: done.assetId,
          format: done.format,
          width: done.width ?? null,
          height: done.height ?? null,
          createdAt: new Date().toISOString(),
          caption: degreeCaption({ degree }) ?? degree,
          // 顺序与提交一致: 商品图在前, 参考图固定在末位。右侧结果靠它还原对照。
          inputUrls: [...images.map((image) => image.url), reference.url].filter(Boolean),
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
    <main className="vc-workspace">
      {/* ── 左: 输入栏 ── */}
      <aside className="vc-input-pane" aria-label="爆款复刻设置">
        <Surface className="vc-editor-card">
          <SurfaceHeader className="vc-editor-header">
            <ViralCloneTabs />
            <div className="vc-editor-heading">
              <div className="flex flex-col gap-1">
                <SurfaceTitle className="text-base">爆款复刻</SurfaceTitle>
                <SurfaceDescription>上传商品图与参考图，按每次生成结果逐组对照。</SurfaceDescription>
              </div>
              <StatusBadge variant="secondary">
                {images.length}/{MAX_IMAGES} 商品图
              </StatusBadge>
            </div>
          </SurfaceHeader>

          <Separator />

          <SurfaceContent className="vc-editor-content">
            <ViralCloneConfig
              images={images}
              reference={reference}
              uploading={uploading}
              fileInputRef={fileInputRef}
              referenceInputRef={referenceInputRef}
              productName={productName}
              brand={brand}
              platform={platform}
              language={language}
              onProductFiles={(files) => void uploadFiles(files)}
              onReferenceFiles={(files) => void uploadReference(files)}
              onRemoveImage={removeImage}
              onRemoveReference={() => setReference(null)}
              onOpenLibrary={openLibraryFor}
              onOpenMobile={openMobileFor}
              onProductNameChange={setProductName}
              onBrandChange={setBrand}
              onPlatformChange={changePlatform}
              onLanguageChange={setLanguage}
            />

            <Separator />

            <ViralCloneRequirementCard
              requirement={requirement}
              onRequirementChange={setRequirement}
              onExpand={() => setExpandOpen(true)}
            />

            <Separator />

            <ViralCloneDegreeCard degree={degree} onDegreeChange={setDegree} />
          </SurfaceContent>

          <Separator />

          <SurfaceFooter className="vc-editor-footer">
            <ViralCloneSubmitBar
              generating={generating}
              formValid={formValid}
              unavailableReason={unavailableReason}
              creditLabel={creditLabel}
              settingsOpen={settingsOpen}
              ratio={ratio}
              resolution={resolution}
              onToggleSettings={() => setSettingsOpen((v) => !v)}
              onRatioChange={(value) => {
                setRatioTouched(true);
                setRatio(value);
              }}
              onResolutionChange={(value) => {
                setResolutionTouched(true);
                setResolution(value);
              }}
              onModelQuoteChange={setModelQuoteCredits}
              onSubmit={() => void submit()}
            />
          </SurfaceFooter>
        </Surface>
      </aside>

      <ViralCloneResultPane
        gallery={gallery}
        generating={generating}
        submitting={submitting}
        images={images}
        reference={reference}
        result={result}
        onRefresh={() => void gallery.reload()}
        onDelete={deleteImage}
        onUseAsReference={useAsReference}
      />

      {/* 素材库选择弹窗 (按 libraryTarget 决定写入商品图还是参考图;
          参考图是单张位 → maxSelectable=1) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={libraryTarget === 'reference' ? 1 : MAX_IMAGES}
      />

      {/* 手机上传弹窗 (按 mobileTarget 决定写入商品图还是参考图) */}
      <MobileUploadModal open={mobileOpen} onReceived={addMobileAssets} onCancel={() => setMobileOpen(false)} />

      <ViralCloneRequirementModal
        open={expandOpen}
        requirement={requirement}
        onRequirementChange={setRequirement}
        onClose={() => setExpandOpen(false)}
      />
    </main>
  );
}
