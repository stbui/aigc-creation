import { useState } from 'react';

import {
  MAX_ACCENTS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_TOTAL,
  SUPPORTED_IMAGE_LABEL,
} from './constants';
import {
  AssetLibraryModal,
  MobileUploadModal,
  type ToolAsset,
  type ToolResult,
} from './components';
import {
  notifyCreditsChanged,
  useAssetLibrary,
  useAuth,
  useCapabilityRuntime,
  useCreditCost,
  useGenerateError,
  usePasteUpload,
  usePollAbort,
  useProject,
} from './hooks';
import {
  assetSrc,
  assetsApi,
  generateApi,
  promptToolsApi,
  resolveModelId,
  toAbsoluteUrl,
} from './api';
import {
  compactCreditLabelOf,
  downloadFilenameOf,
  isSupportedImageFile,
  multiFusionCreditCost,
  outputsOf,
  pollToResult,
  promptToolErrorMessage,
  resolutionOptions,
  resultsOf,
} from './utils';
import { MultiFusionAnalysisCard } from './MultiFusionAnalysisCard';
import { MultiFusionEditorHeader } from './MultiFusionEditorHeader';
import { MultiFusionParameterCard } from './MultiFusionParameterCard';
import { MultiFusionResultPanel } from './MultiFusionResultPanel';
import { MultiFusionSceneGateway } from './MultiFusionSceneGateway';
import { MultiFusionSubmitBar } from './MultiFusionSubmitBar';
import { MultiFusionUploadCard } from './MultiFusionUploadCard';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp } from '../../ui';

/**
 * 多图融合 —— 严格 1:1 复刻参考站 https://ijihua.cn/multi-image-fusion。
 *
 * 依据docs/multi-image-fusion-spec.md (2026-10-17 设计师产出, 唯一依据):
 *   §2  区块地图 (两步流, 无路由变化)          → 本文件 DOM 结构
 *   §4.1 参考站实测文案 (逐字照录)             → SCENE_GROUPS / 各处文案
 *   §5  参考站 203 条规则字面值                 → global.css 的 multi-image-fusion-* 区块
 *   §6  --mif-* token 组                        → global.css :root
 *   §7  逐项差异清单 S-1~S-17 / D-1~D-96        → 实施范围
 *
 * 命名隔离: 本页只使用 `multi-image-fusion-*` 命名空间, 不复用也不改名 `pk-*`
 * (pk-* 同时服务 ProductKit 等页面, 改动会外溢)。
 *
 * 诚实披露 (§11 无证据清单, 禁止编造):
 *   - 15 张场景卡的 WebP 预览图 URL 参考站无证据 → 保留同图标占位, 未复刻
 *   - 搭配图槽内文案参考站无证据 → 只渲染图标 + aria-label, 未编造文案
 *   - 比例项数/顺序、画质选项列表参考站无证据 → 沿用本地既有列表, 未按猜测调整
 *   - `.multi-image-fusion-step` / `-description*` / `-scene-state` 参考站当前流程不渲染
 *     → 本页不加入这些元素 (spec §4.2)
 *
 * 状态与写操作留在本页; 展示板块拆成 `MultiFusion*` 业务组件 (见同目录各文件)。
 */

export function MultiFusionPage() {
  // 基础价读后端下发的 creditCost，再按画质倍率计算本次真实扣费。
  const baseCreditCost = useCreditCost('multi_fusion');
  const { blocked: capabilityBlocked, reason: capabilityReason } = useCapabilityRuntime('multi_fusion');
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();

  const [step, setStep] = useState<'gateway' | 'workspace'>('gateway');
  const [scene, setScene] = useState('print_pattern');

  const [subject, setSubject] = useState<ToolAsset | null>(null);
  const [accents, setAccents] = useState<ToolAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  /**
   * 手机上传弹窗的目标位。
   *
   * 同一份二维码流程服务两个图位: 主体图只收 1 张, 搭配图收 1-5 张。
   * 打开前必须登录 —— 会话与素材都挂在登录用户下。
   */
  const [mobileTarget, setMobileTarget] = useState<'subject' | 'accent' | null>(null);

  const [variantCount, setVariantCount] = useState('4');
  /** 本次已提交任务的变体数快照；生成后修改选项不能反过来改写结果状态。 */
  const [requestedVariantCount, setRequestedVariantCount] = useState(4);
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * 画面描述 —— 提交时作为 `prompt` 参数进入能力提示词。
   *
   * 来源两条: 「AI 分析」按主体图识图生成, 或用户手写。留空不报错:
   * 提示词会退回场景版式语义 (见 `definitions/multi_fusion.ts` 的 buildPrompt),
   * 这与「分析失败」是两回事, 故不在前端强制必填。
   */
  const [prompt, setPrompt] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  /** AI 分析进行中 (按钮禁用 + 文案切换, 防止连点时重复请求文本通道) */
  const [analyzing, setAnalyzing] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ToolResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [lastFailure, setLastFailure] = useState<ToolResult | null>(null);
  const pollSignal = usePollAbort();

  const totalCount = (subject ? 1 : 0) + accents.length;
  const resolutionMultiplier =
    resolutionOptions('multi_fusion').find((option) => option.value === resolution)?.multiplier ?? 1;
  const currentCreditCost =
    baseCreditCost === null
      ? null
      : multiFusionCreditCost(baseCreditCost, variantCount, resolutionMultiplier);
  const compactCreditLabel = compactCreditLabelOf(currentCreditCost);
  const activeResult = results[activeResultIndex] ?? results[0] ?? null;

  const uploadTo = async (files: FileList | File[], target: 'subject' | 'accent') => {
    const list = Array.from(files).filter(isSupportedImageFile);
    if (list.length === 0) {
      message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
      return;
    }
    // 体积校验此前缺失: 素材库尤其会收下一个改了后缀的非图片, 页面只当"上传成功"
    const oversize = list.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (oversize.length > 0) {
      message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
      return;
    }
    if (target === 'accent') {
      const room = MAX_ACCENTS - accents.length;
      if (room <= 0) {
        message.warning(`最多添加 ${MAX_ACCENTS} 张搭配图`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: ToolAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        }
        setAccents((prev) => [...prev, ...uploaded]);
        message.success(`已添加 ${uploaded.length} 张搭配图`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
      return;
    }
    const file = list[0];
    setUploading(true);
    try {
      const projectId = await ensureProject();
      const asset = await assetsApi.upload(file, projectId);
      setSubject({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
      message.success('主体图已上传（最多 1 张，新上传将替换原主体图）');
    } catch (e) {
      message.error((e as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  /**
   * 参考站上传区文案承诺“可直接粘贴”，因此必须真的监听页面粘贴。
   * 主体位为空时第一张进主体位；已有主体图时按顺序补搭配位。
   */
  usePasteUpload((files) => uploadTo(files, subject ? 'accent' : 'subject'));

  const openMobileUpload = (target: 'subject' | 'accent') => {
    // 会话建立与素材落库都挂在登录用户名下, 未登录先唤起登录
    if (!token) {
      openLogin();
      return;
    }
    setMobileTarget(target);
  };

  // ── 素材库导入 (双通道: 主体位 / 搭配位) ──
  const [libraryTarget, setLibraryTarget] = useState<'subject' | 'accent'>('subject');

  /** 返回 false = 拒绝本次选择 (选择器会中止整批并保持打开) */
  const pickFromLibrary = (asset: Asset): boolean => {
    const next: ToolAsset = {
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    };
    if (libraryTarget === 'subject') {
      setSubject(next);
      return true;
    }
    if (accents.length >= MAX_ACCENTS) {
      message.warning(`最多添加 ${MAX_ACCENTS} 张搭配图`);
      return false;
    }
    if (accents.some((x) => x.id === asset.id)) {
      message.info('该素材已在搭配图中');
      return false;
    }
    setAccents((prev) => [...prev, next]);
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
  } = useAssetLibrary(pickFromLibrary);

  const openLibraryFor = (target: 'subject' | 'accent') => {
    // 素材列表需鉴权: 未登录时先唤起登录, 而不是等接口 401
    if (!token) {
      openLogin();
      return;
    }
    // 搭配位已满时直接说清: 打开一个「最多可选 0 张」的弹窗等于让用户白点
    if (target === 'accent' && accents.length >= MAX_ACCENTS) {
      message.warning(`搭配图已满 ${MAX_ACCENTS} 张，请先移除一张`);
      return;
    }
    setLibraryTarget(target);
    openLibrary();
  };

  /**
   * 手机端传回的图片落到当前目标图位。
   *
   * 手机端可一次多选: 主体位只留第一张, 余下的**转进搭配位**而不是丢弃 ——
   * 用户多选时最合理的意图就是"这些都要用"。
   */
  const handleMobileReceived = (incoming: MobileUploadAsset[]) => {
    const target = mobileTarget;
    setMobileTarget(null);
    if (!incoming.length) return;

    const asToolAsset = (a: MobileUploadAsset): ToolAsset => ({
      id: a.id,
      url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
      name: a.filename,
    });

    if (target === 'subject') {
      const [first, ...rest] = incoming;
      setSubject(asToolAsset(first));
      if (rest.length === 0) {
        message.success('主体图已从手机接收');
        return;
      }
      // 提示放在 setState 之前算好 —— 在更新函数里发消息会在 StrictMode
      // 双调用时弹两次, 而且 updater 本就不该有副作用
      const room = Math.max(0, MAX_ACCENTS - accents.length);
      const accepted = rest.slice(0, room).map(asToolAsset);
      const dropped = rest.length - accepted.length;
      if (dropped > 0) message.warning(`搭配图位只剩 ${room} 个，${dropped} 张未加入`);
      if (accepted.length > 0) setAccents((prev) => [...prev, ...accepted]);
      message.success(`已接收 ${incoming.length} 张图片（第 1 张为主体图）`);
      return;
    }

    const room = Math.max(0, MAX_ACCENTS - accents.length);
    const fresh = incoming.filter((a) => !accents.some((x) => x.id === a.id));
    const accepted = fresh.slice(0, room).map(asToolAsset);
    const dropped = fresh.length - accepted.length;
    if (dropped > 0) message.warning(`搭配图位只剩 ${room} 个，${dropped} 张未加入`);
    if (accepted.length > 0) setAccents((prev) => [...prev, ...accepted]);
    message.success(`已从手机接收 ${accepted.length} 张搭配图`);
  };

  const pollTask = (taskId: string) => pollToResult(taskId, { signal: pollSignal });

  /**
   * AI 分析: 对主体图做真实识图, 结果写进可编辑的「画面描述」。
   *
   * 走文本通道的 promptToolsApi.imageToPrompt (后端按 assetId 读图, 带归属校验)。
   * 通道未配置时后端 502 —— 如实把原因抛给用户, 不编一段假的分析:
   * 编出来的描述会被当成模型看过图的结论, 比"这次没分析出内容"更误导。
   */
  const runAiAnalyze = async () => {
    setAnalysisMessage(null);
    if (!subject || accents.length === 0) {
      const text = '请先上传主体图和至少 1 张搭配图';
      setAnalysisMessage({ kind: 'error', text });
      message.warning(text);
      return;
    }
    setAnalyzing(true);
    try {
      const { text } = await promptToolsApi.imageToPrompt(subject.id);
      const content = text?.trim();
      if (!content) {
        const hint = '这次没有生成可用内容，请重试';
        setAnalysisMessage({ kind: 'error', text: hint });
        message.warning(hint);
        return;
      }
      setPrompt(content);
      setDescriptionOpen(true);
      message.success('已按主体图生成画面描述，可继续编辑');
    } catch (e) {
      const hint = promptToolErrorMessage(e, 'image');
      setAnalysisMessage({ kind: 'error', text: hint });
      message.error(hint);
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    if (!subject || accents.length === 0 || submitting) return;
    // guest 点击仍应走登录弹窗；已登录时才把「能力不可用」作为硬拦截。
    if (token && capabilityBlocked) {
      message.warning(capabilityReason || '该能力当前不可提交');
      return;
    }
    const requestedCount = Math.max(1, Math.trunc(Number(variantCount)) || 1);
    setRequestedVariantCount(requestedCount);
    setSubmitting(true);
    setResults([]);
    setActiveResultIndex(0);
    setLastFailure(null);
    try {
      const projectId = await ensureProject();
      const logicalModelId = await resolveModelId('multi_fusion');
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'multi_fusion',
        logicalModelId,
        // 顺序即语义: [0]=主体图, [1..]=搭配图 (后端 processTask 按提交序保序)
        inputAssetIds: [subject.id, ...accents.map((a) => a.id)].slice(0, MAX_TOTAL),
        params: { scene, variantCount: String(requestedCount), ratio, size: resolution, prompt: prompt.trim() },
      });
      const done = await pollTask(taskId);
      if (done.status === 'failed') {
        setLastFailure(done);
        message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      } else {
        const outputs = outputsOf(done);
        if (outputs.length === 0) {
          const emptyFailure: ToolResult = { status: 'failed', errorCode: 'EMPTY_OUTPUT' };
          setLastFailure(emptyFailure);
          message.error('模型没有返回可用图片，请重试');
        } else {
          setResults(resultsOf(done));
          message.success(
            outputs.length < requestedCount
              ? `已生成 ${outputs.length} / ${requestedCount} 张变体`
              : `融合结果已生成（${outputs.length} 张）`,
          );
        }
      }
    } catch (e) {
      setLastFailure({ status: 'failed', errorCode: (e as Error).message || 'GENERATE_FAILED' });
      reportError(e);
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  const download = () => {
    if (!activeResult?.url) return;
    const a = document.createElement('a');
    a.href = activeResult.url;
    a.download = downloadFilenameOf(activeResultIndex, activeResult.url);
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  };

  // ── 状态 1: 场景网关 (无 header / 无返回键, 见 §2) ──
  if (step === 'gateway') {
    return (
      <MultiFusionSceneGateway
        onSelect={(value) => {
          setScene(value);
          setStep('workspace');
        }}
      />
    );
  }

  // ── 状态 2: 工作区 ──
  const [ratioW, ratioH] = ratio.split(':').map(Number);
  // §1.3: --fusion-ratio-width/height 参考站 CSS 产物中无定义, 由 JS 按所选比例内联注入。
  // 注入在页面根 (而非仅 preview-stage), 因为参考站 rule #155 的自适应宽度规则
  // 同时作用于 .multi-image-fusion-preview-stage 与 .multi-image-fusion-result-empty,
  // 空态也必须拿到这两个变量 (E3 实测空态宽 193px = 100vh - 104 - 280, 1:1)。
  const fusionRatioVars = {
    '--fusion-ratio-width': ratioW,
    '--fusion-ratio-height': ratioH,
  } as React.CSSProperties;

  return (
    <div className="multi-image-fusion-page is-editor" style={fusionRatioVars}>
      <MultiFusionEditorHeader scene={scene} onBack={() => setStep('gateway')} />

      <div className="multi-image-fusion-layout">
        <section className="multi-image-fusion-control-column">
          {/* ── 卡片 1/4: 上传图片 ── */}
          <MultiFusionUploadCard
            subject={subject}
            accents={accents}
            uploading={uploading}
            totalCount={totalCount}
            onUploadFiles={(target, files) => void uploadTo(files, target)}
            onRemoveSubject={() => setSubject(null)}
            onRemoveAccent={(id) => setAccents((prev) => prev.filter((x) => x.id !== id))}
            onOpenLibrary={openLibraryFor}
            onOpenMobile={openMobileUpload}
          />

          {/* ── 卡片 2/4: AI 分析 (S-7: 独立成卡) ── */}
          <MultiFusionAnalysisCard
            analyzing={analyzing}
            message={analysisMessage}
            descriptionOpen={descriptionOpen}
            prompt={prompt}
            onAnalyze={() => void runAiAnalyze()}
            onPromptChange={setPrompt}
          />

          {/* ── 卡片 3/4: 输出参数 ── */}
          <MultiFusionParameterCard
            variantCount={variantCount}
            onVariantCountChange={setVariantCount}
          />

          {/* ── 卡片 4/4: 提交区 (S-15: sticky 白底容器) ── */}
          <MultiFusionSubmitBar
            submitting={submitting}
            disabled={
              !subject || accents.length === 0 || submitting || (Boolean(token) && capabilityBlocked)
            }
            blockedReason={capabilityBlocked && token ? capabilityReason : null}
            creditLabel={compactCreditLabel}
            settingsOpen={settingsOpen}
            ratio={ratio}
            resolution={resolution}
            onToggleSettings={() => setSettingsOpen((v) => !v)}
            onRatioChange={setRatio}
            onResolutionChange={setResolution}
            onSubmit={() => void submit()}
          />
        </section>

        {/* ── 结果面板 ── */}
        <MultiFusionResultPanel
          submitting={submitting}
          results={results}
          activeResult={activeResult}
          activeResultIndex={activeResultIndex}
          lastFailure={lastFailure}
          requestedCount={requestedVariantCount}
          ratio={ratio}
          ratioWidth={ratioW}
          ratioHeight={ratioH}
          canRegenerate={
            !submitting &&
            !(Boolean(token) && capabilityBlocked) &&
            Boolean(subject && accents.length > 0) &&
            (results.length > 0 || Boolean(lastFailure))
          }
          onRegenerate={() => void submit()}
          onDownload={download}
          onSelectResult={setActiveResultIndex}
        />
      </div>

      {/* 手机上传: 主体位与搭配位共用同一次扫码流程 */}
      <MobileUploadModal
        open={mobileTarget !== null}
        onReceived={handleMobileReceived}
        onCancel={() => setMobileTarget(null)}
      />

      {/* 素材库选择弹窗 (主体位 1 张 / 搭配位上限 5 张) */}
      <AssetLibraryModal
        open={libraryOpen}
        loading={libraryLoading}
        items={libraryItems}
        error={libraryError}
        onCancel={closeLibrary}
        onPick={pick}
        maxSelectable={libraryTarget === 'subject' ? 1 : MAX_ACCENTS - accents.length}
      />
    </div>
  );
}
