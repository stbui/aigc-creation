import { useState } from 'react';
import type { CSSProperties } from 'react';

import { AssetLibraryModal, MobileUploadModal } from './components';
import {
  useAuth,
  useCapabilityRuntime,
  useCreditCost,
  useMultiFusionAssets,
  useMultiFusionPrompt,
  useMultiFusionTask,
} from './hooks';
import { compactCreditLabelOf, multiFusionCreditCost, resolutionOptions } from './utils';
import { MultiFusionAnalysisCard } from './MultiFusionAnalysisCard';
import { MultiFusionEditorHeader } from './MultiFusionEditorHeader';
import { MultiFusionParameterCard } from './MultiFusionParameterCard';
import { MultiFusionResultPanel } from './MultiFusionResultPanel';
import { MultiFusionSceneGateway } from './MultiFusionSceneGateway';
import { MultiFusionSubmitBar } from './MultiFusionSubmitBar';
import { MultiFusionUploadCard } from './MultiFusionUploadCard';

/**
 * 多图融合 —— 严格 1:1 复刻参考站 https://ijihua.cn/multi-image-fusion。
 *
 * 依据docs/multi-image-fusion-spec.md (2026-10-17 设计师产出, 唯一依据):
 *   §2  区块地图 (两步流, 无路由变化)          → 本文件 DOM 结构
 *   §4.1 参考站实测文案 (逐字照录)             → SCENE_GROUPS / 各处文案
 *   §5  参考站 203 条规则字面值                 → style.css 的 multi-image-fusion-* 区块
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
 * 本文件只做编排：两步流切换、场景与输出参数、价签换算，以及把三个页面级
 * hook（图位 / 描述 / 任务）接给展示组件。图位、描述与任务状态分别见
 * `useMultiFusionAssets` / `useMultiFusionPrompt` / `useMultiFusionTask`。
 */
export function MultiFusionPage() {
  // 基础价读后端下发的 creditCost，再按画质倍率计算本次真实扣费。
  const baseCreditCost = useCreditCost('multi_fusion');
  const { blocked: capabilityBlocked, reason: capabilityReason } =
    useCapabilityRuntime('multi_fusion');
  const { token } = useAuth();

  const [step, setStep] = useState<'gateway' | 'workspace'>('gateway');
  const [scene, setScene] = useState('print_pattern');
  const [variantCount, setVariantCount] = useState('4');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    subject,
    accents,
    uploading,
    totalCount,
    uploadTo,
    removeSubject,
    removeAccent,
    openLibraryFor,
    openMobile,
    library,
    libraryMaxSelectable,
    mobile,
  } = useMultiFusionAssets();
  const prompt = useMultiFusionPrompt({ subject });
  /**
   * 能力不可用只对已登录用户做硬拦截 —— 访客点击仍应走登录弹窗，
   * 而不是先被一句「能力不可用」挡在门外。
   */
  const blockedReason =
    token && capabilityBlocked ? capabilityReason || '该能力当前不可提交' : null;
  const task = useMultiFusionTask({
    subject,
    accents,
    scene,
    variantCount,
    ratio,
    resolution,
    prompt: prompt.value,
    blockedReason,
  });

  const resolutionMultiplier =
    resolutionOptions('multi_fusion').find((option) => option.value === resolution)?.multiplier ?? 1;
  const currentCreditCost =
    baseCreditCost === null
      ? null
      : multiFusionCreditCost(baseCreditCost, variantCount, resolutionMultiplier);
  const compactCreditLabel = compactCreditLabelOf(currentCreditCost);
  const capabilityBlockedForUser = Boolean(token) && capabilityBlocked;
  const submitDisabled =
    !subject ||
    accents.length === 0 ||
    task.submitting ||
    Boolean(task.timedOutTaskId) ||
    capabilityBlockedForUser;
  const canRegenerate =
    !task.submitting &&
    !capabilityBlockedForUser &&
    Boolean(subject && accents.length > 0) &&
    (task.results.length > 0 ||
      task.lastFailure?.kind === 'generation' ||
      task.lastFailure?.kind === 'submit');

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
  const resultRatio = task.requestedRatio ?? ratio;
  const [resultRatioW, resultRatioH] = resultRatio.split(':').map(Number);
  // §1.3: --fusion-ratio-width/height 参考站 CSS 产物中无定义, 由 JS 按所选比例内联注入。
  // 注入在页面根 (而非仅 preview-stage), 因为参考站 rule #155 的自适应宽度规则
  // 同时作用于 .multi-image-fusion-preview-stage 与 .multi-image-fusion-result-empty,
  // 空态也必须拿到这两个变量 (E3 实测空态宽 193px = 100vh - 104 - 280, 1:1)。
  const fusionRatioVars = {
    '--fusion-ratio-width': ratioW,
    '--fusion-ratio-height': ratioH,
  } as CSSProperties;

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
            onRemoveSubject={removeSubject}
            onRemoveAccent={removeAccent}
            onOpenLibrary={openLibraryFor}
            onOpenMobile={openMobile}
          />

          {/* ── 卡片 2/4: AI 分析 (S-7: 独立成卡) ── */}
          <MultiFusionAnalysisCard
            analyzing={prompt.analyzing}
            message={prompt.message}
            descriptionOpen={prompt.open}
            prompt={prompt.value}
            onAnalyze={() => void prompt.analyze()}
            onPromptChange={prompt.setValue}
            onToggleDescription={prompt.toggle}
          />

          {/* ── 卡片 3/4: 输出参数 ── */}
          <MultiFusionParameterCard
            variantCount={variantCount}
            onVariantCountChange={setVariantCount}
          />

          {/* ── 卡片 4/4: 提交区 (S-15: sticky 白底容器) ── */}
          <MultiFusionSubmitBar
            submitting={task.submitting}
            disabled={submitDisabled}
            blockedReason={blockedReason}
            creditLabel={compactCreditLabel}
            settingsOpen={settingsOpen}
            ratio={ratio}
            resolution={resolution}
            onToggleSettings={() => setSettingsOpen((v) => !v)}
            onRatioChange={setRatio}
            onResolutionChange={setResolution}
            onSubmit={() => void task.submit()}
          />
        </section>

        {/* ── 结果面板 ── */}
        <MultiFusionResultPanel
          submitting={task.submitting}
          results={task.results}
          activeResult={task.activeResult}
          activeResultIndex={task.activeResultIndex}
          lastFailure={task.lastFailure?.result ?? null}
          failureKind={task.lastFailure?.kind ?? null}
          requestedCount={task.requestedVariantCount}
          ratio={resultRatio}
          ratioWidth={resultRatioW}
          ratioHeight={resultRatioH}
          canRegenerate={canRegenerate}
          onRetryPoll={task.timedOutTaskId ? () => void task.retryPoll() : undefined}
          onRegenerate={() => void task.submit()}
          onDownload={task.download}
          onSelectResult={task.selectResult}
        />
      </div>

      {/* 手机上传: 主体位与搭配位共用同一次扫码流程 */}
      <MobileUploadModal
        open={mobile.open}
        onReceived={mobile.addAssets}
        onCancel={mobile.closeMobile}
      />

      {/* 素材库选择弹窗 (主体位 1 张 / 搭配位上限 5 张) */}
      <AssetLibraryModal
        open={library.open}
        loading={library.loading}
        items={library.items}
        error={library.error}
        onCancel={library.closeLibrary}
        onPick={library.pick}
        maxSelectable={libraryMaxSelectable}
      />
    </div>
  );
}
