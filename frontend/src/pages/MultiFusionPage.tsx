import { useRef, useState } from 'react';
import { App, Spin } from 'antd';
import { ChevronDown, ChevronLeft, Download, ImagePlus, Layers, RefreshCw, Sparkles, X } from 'lucide-react';
import { assetSrc, assetsApi, generateApi, promptToolsApi, toAbsoluteUrl } from '../lib/api';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  isSupportedImageFile,
} from '../lib/constants';
import { ratioOptions, resolutionOptions } from '../lib/optionSets';
import { multiFusionCreditCost } from '../lib/multiFusionBilling';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { notifyCreditsChanged } from '../context/CreditsContext';
import { pollToResult } from '../lib/poll';
import type { ToolAsset, ToolResult } from '../components/ToolShell';
import { useCreditCost } from '../hooks/useCreditLabel';
import { useCapabilityRuntime } from '../hooks/useCapabilityRuntime';
import { ToolGeneratingState } from '../components/ToolEmptyState';
import { ProviderBadge } from '../components/ProviderBadge';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { usePasteUpload } from '../hooks/usePasteUpload';
import { useAuth } from '../context/AuthContext';
import type { Asset, MobileUploadAsset } from '../types/api';

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
 */

interface SceneDef {
  value: string;
  label: string;
  desc: string;
}

/** §4.1 实测原文: 分组标题仅 h2, 无描述文案 (见 D-13) */
const SCENE_GROUPS: Array<{ name: string; scenes: SceneDef[] }> = [
  {
    name: '表面附着',
    scenes: [
      { value: 'print_pattern', label: '印花/图案', desc: '手机壳、服装、杯具等表面的图案融合' },
      { value: 'embroidery', label: '刺绣/绣花', desc: '服装、帽子等织物表面的刺绣融合' },
      { value: 'texture', label: '纹理/材质', desc: '木纹、大理石、碳纤维等表面材质融合' },
      { value: 'sticker', label: '贴纸/贴花', desc: '笔记本、滑板、行李箱等表面的贴纸融合' },
      { value: 'hot_stamping', label: '烫金/烫印', desc: '包装、皮具等表面的烫金与压印效果' },
      { value: 'carving', label: '雕刻/蚀刻', desc: '金属、玻璃等表面的雕刻与磨砂图案' },
      { value: 'painting', label: '彩绘/涂装', desc: '头盔、陶瓷等表面的喷绘与手绘融合' },
    ],
  },
  {
    name: '空间摆放',
    scenes: [
      { value: 'table_display', label: '桌面陈列', desc: '办公用品、化妆品等桌面组合陈列' },
      { value: 'wearing', label: '穿搭/佩戴', desc: '模特、手模与服装配饰融合' },
      { value: 'scene_match', label: '场景搭配', desc: '家具进房间、产品进展台、陈设入空间' },
      { value: 'handheld', label: '手持展示', desc: '手模或人物自然手持商品与道具' },
      { value: 'combo_set', label: '组合套装', desc: '礼盒、多件商品与套装组合展示' },
      { value: 'food_plating', label: '食品摆盘', desc: '餐盘、托盘与菜品茶具组合' },
      { value: 'storage_display', label: '收纳展示', desc: '收纳盒、化妆包与内部物件展示' },
      { value: 'shelf_display', label: '货架陈列', desc: '货架、书架与多件商品陈列' },
    ],
  },
];

const ALL_SCENES = SCENE_GROUPS.flatMap((g) => g.scenes);
const sceneLabel = (v: string) => ALL_SCENES.find((s) => s.value === v)?.label ?? v;
const sceneImage = (value: string) => `/multi-fusion/scenes/${value}.webp`;

const VARIANT_COUNTS = ['4', '3', '2', '1'];

const MAX_TOTAL = 6; // §4.1 计数器「0 / 6」(主体 1 + 搭配 1-5)
const MAX_ACCENTS = 5; // §4.1 字段标签「必传 · 1-5 张」

const EMPTY_TITLE = '等待你的第一组融合创意';
const EMPTY_HINT = '上传图片并提交生成，预览会出现在这里';
const UPLOAD_SUBJECT_HINT = `支持 JPG、PNG，单张不超过 ${MAX_IMAGE_MB}MB，可直接粘贴`;

export function MultiFusionPage() {
  // 基础价读后端下发的 creditCost，再按画质倍率计算本次真实扣费。
  const baseCreditCost = useCreditCost('multi_fusion');
  const { blocked: capabilityBlocked, reason: capabilityReason } = useCapabilityRuntime('multi_fusion');
  const { message } = App.useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const { token, openLogin } = useAuth();
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const accentInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'gateway' | 'workspace'>('gateway');
  const [scene, setScene] = useState('print_pattern');

  const [subject, setSubject] = useState<ToolAsset | null>(null);
  const [accents, setAccents] = useState<ToolAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  /**
   * 手机上传弹窗的目标位。
   *
   * 同一份二维码流程服务两个图位: 主体图只收 1 张, 搭配图收 1-5 张。
   * 打开前必须登录 —— 会话与素材都挂在登录用户下。
   */
  const [mobileTarget, setMobileTarget] = useState<'subject' | 'accent' | null>(null);

  const [variantCount, setVariantCount] = useState('4');
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
  const compactCreditLabel =
    currentCreditCost === null
      ? null
      : currentCreditCost > 0
        ? `本次消耗${currentCreditCost}积分`
        : '免费';
  /**
   * 参考站搭配图空态只有一个添加入口，槽内文案明确剩余额度。
   * 已满 5 张时不再渲染添加入口。
   */
  const accentRoom = Math.max(0, MAX_ACCENTS - accents.length);
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
        const hint = '模型没有返回内容，请重试';
        setAnalysisMessage({ kind: 'error', text: hint });
        message.warning(hint);
        return;
      }
      setPrompt(content);
      setDescriptionOpen(true);
      message.success('已按主体图生成画面描述，可继续编辑');
    } catch (e) {
      const hint = (e as Error).message || '识图失败：文本通道未配置';
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
    setSubmitting(true);
    setResults([]);
    setActiveResultIndex(0);
    setLastFailure(null);
    try {
      const projectId = await ensureProject();
      const { taskId } = await generateApi.start({
        projectId,
        capability: 'multi_fusion',
        // 顺序即语义: [0]=主体图, [1..]=搭配图 (后端 processTask 按提交序保序)
        inputAssetIds: [subject.id, ...accents.map((a) => a.id)].slice(0, MAX_TOTAL),
        params: { scene, variantCount, ratio, size: resolution, prompt: prompt.trim() },
      });
      const done = await pollTask(taskId);
      if (done.status === 'failed') {
        setLastFailure(done);
        message.error(`生成失败（${done.errorCode ?? '未知错误'}）`);
      } else {
        const outputs = done.outputs?.length
          ? done.outputs
          : done.url
            ? [{ url: done.url, width: done.width, height: done.height }]
            : [];
        if (outputs.length === 0) {
          const emptyFailure: ToolResult = { status: 'failed', errorCode: 'EMPTY_OUTPUT' };
          setLastFailure(emptyFailure);
          message.error('模型没有返回可用图片，请重试');
        } else {
          setResults(
            outputs.map((output) => ({
              status: 'succeeded',
              url: output.url,
              width: output.width,
              height: output.height,
              modality: output.modality,
              durationMs: output.durationMs,
              provider: done.provider,
            })),
          );
          message.success(
            outputs.length < Number(variantCount)
              ? `已生成 ${outputs.length} / ${variantCount} 张变体`
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
    a.download = `multi-fusion-${activeResultIndex + 1}.${activeResult.url.split('.').pop()?.split('?')[0] || 'jpg'}`;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  };

  // ── 状态 1: 场景网关 (无 header / 无返回键, 见 §2) ──
  if (step === 'gateway') {
    return (
      <div className="multi-image-fusion-page is-scene-selection">
        <section className="multi-image-fusion-scene-selection">
          {SCENE_GROUPS.map((g) => (
            <section key={g.name} className="multi-image-fusion-scene-group">
              <h2>{g.name}</h2>
              <div className="multi-image-fusion-scene-grid">
                {g.scenes.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className="multi-image-fusion-scene-card"
                    onClick={() => {
                      setScene(s.value);
                      setStep('workspace');
                    }}
                  >
                    {/* 15 个场景各配一张 2:1 预览图；图标留在图片下层，加载失败时自然兜底 */}
                    <span className="multi-image-fusion-scene-visual" aria-hidden>
                      <Sparkles size={20} />
                      <img
                        src={sceneImage(s.value)}
                        alt=""
                        width={640}
                        height={320}
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <span className="multi-image-fusion-scene-copy">
                      <strong>{s.label}</strong>
                      <small>{s.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </section>
      </div>
    );
  }

  // ── 状态 2: 工作区 ──
  const sceneDef = ALL_SCENES.find((s) => s.value === scene);
  const resolutionLabel = resolution.toUpperCase();
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
      <header className="multi-image-fusion-editor-head">
        <div className="multi-image-fusion-editor-title">
          {/* S-13/D-90: 参考站是 30x30 纯图标方块, 无文字 */}
          <button
            type="button"
            className="multi-image-fusion-scene-back"
            aria-label="返回场景列表"
            onClick={() => setStep('gateway')}
          >
            <ChevronLeft size={16} />
          </button>
          <div>
            <h1>{sceneDef?.label ?? sceneLabel(scene)}</h1>
            <p>上传主体图和搭配图，AI 将多张图片融合为一张新图</p>
          </div>
        </div>
      </header>

      <div className="multi-image-fusion-layout">
        <section className="multi-image-fusion-control-column">
          {/* ── 卡片 1/4: 上传图片 ── */}
          <div className="multi-image-fusion-card multi-image-fusion-upload-card">
            <div className="multi-image-fusion-card-heading">
              <div>
                <h2>上传图片</h2>
              </div>
              {/* D-22: 参考站是 11px 弱化灰 #aeacbd, 不是 16px 深色强调 */}
              <span className="multi-image-fusion-count">
                {totalCount} / {MAX_TOTAL}
              </span>
            </div>

            {/* 主体图: 必传 1 张 */}
            <div className="multi-image-fusion-upload-section">
              <div className="multi-image-fusion-field-label">
                <span>主体图</span>
                <small>必传 · 1 张</small>
                <span className="multi-image-fusion-field-actions">
                  <button
                    type="button"
                    className="multi-image-fusion-field-link"
                    title="从已上传的素材里选一张作为主体图"
                    onClick={() => openLibraryFor('subject')}
                  >
                    从素材库导入
                  </button>
                  <button
                    type="button"
                    className="multi-image-fusion-field-link multi-image-fusion-mobile-upload-link"
                    title="扫码在手机上选择图片，接收后进入主体图位"
                    onClick={() => openMobileUpload('subject')}
                  >
                    手机上传
                  </button>
                </span>
              </div>
              {subject ? (
                <div className="multi-image-fusion-image-card">
                  <img src={subject.url} alt={subject.name} loading="lazy" decoding="async" />
                  <button
                    type="button"
                    className="multi-image-fusion-remove"
                    aria-label="移除主体图"
                    onClick={() => setSubject(null)}
                  >
                    <X size={12} />
                  </button>
                  {uploading && <span className="multi-image-fusion-uploading">上传中</span>}
                </div>
              ) : (
                <button
                  type="button"
                  className="multi-image-fusion-upload-empty"
                  onClick={() => subjectInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (e.dataTransfer.files.length) void uploadTo(e.dataTransfer.files, 'subject');
                  }}
                >
                  {/* D-31: 参考站有 36x36 圆角色块, 本地原先没有 */}
                  <span className="multi-image-fusion-upload-icon">
                    <ImagePlus size={18} />
                  </span>
                  <strong>上传主体图</strong>
                  <span>{UPLOAD_SUBJECT_HINT}</span>
                </button>
              )}
            </div>

            {/* 搭配图: 必传 1-5 张, 参考站是网格小槽 (S-8) */}
            <div className="multi-image-fusion-upload-section">
              <div className="multi-image-fusion-field-label">
                <span>搭配图</span>
                <small>必传 · 1-5 张</small>
                <span className="multi-image-fusion-field-actions">
                  <button
                    type="button"
                    className="multi-image-fusion-field-link"
                    title="从已上传的素材里挑选搭配图"
                    onClick={() => openLibraryFor('accent')}
                  >
                    从素材库导入
                  </button>
                  <button
                    type="button"
                    className="multi-image-fusion-field-link multi-image-fusion-mobile-upload-link"
                    title="扫码在手机上选择图片，接收后进入搭配图位"
                    onClick={() => openMobileUpload('accent')}
                  >
                    手机上传
                  </button>
                </span>
              </div>
              <div
                className={`multi-image-fusion-accessory-grid${dragging ? ' is-dragging' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files.length) void uploadTo(e.dataTransfer.files, 'accent');
                }}
              >
                {accents.map((a) => (
                  <div key={a.id} className="multi-image-fusion-image-card">
                    <img src={a.url} alt={a.name} loading="lazy" decoding="async" />
                    <button
                      type="button"
                      className="multi-image-fusion-remove"
                      aria-label={`移除 ${a.name}`}
                      onClick={() => setAccents((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      <X size={12} />
                    </button>
                    {uploading && <span className="multi-image-fusion-uploading">上传中</span>}
                  </div>
                ))}
                {/* 参考站空态只有一个添加入口，并在槽内写明剩余额度 */}
                {accentRoom > 0 && (
                  <button
                    type="button"
                    className="multi-image-fusion-upload-empty"
                    aria-label={`添加搭配图，还可添加 ${accentRoom} 张`}
                    onClick={() => accentInputRef.current?.click()}
                  >
                    <span className="multi-image-fusion-upload-icon">
                      <ImagePlus size={18} />
                    </span>
                    <strong>添加搭配图</strong>
                    <span>还可添加 {accentRoom} 张</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── 卡片 2/4: AI 分析 (S-7: 独立成卡) ── */}
          <div className="multi-image-fusion-card multi-image-fusion-analysis-card">
            <div className="multi-image-fusion-card-heading compact">
              <div>
                <h2>AI 分析</h2>
              </div>
            </div>
            <button
              type="button"
              className="multi-image-fusion-analyze-button"
              disabled={analyzing}
              onClick={() => void runAiAnalyze()}
            >
              <Sparkles size={14} />
              <span>{analyzing ? '分析中…' : 'AI 分析'}</span>
            </button>
            {analysisMessage && (
              <p className={`multi-image-fusion-message ${analysisMessage.kind}`} role="status">
                {analysisMessage.text}
              </p>
            )}
            {/* 默认不占位；只有分析成功后才出现可编辑描述 */}
            {descriptionOpen && (
              <label className="multi-image-fusion-description">
                <span>画面描述</span>
                <textarea
                  className="multi-image-fusion-description-editor"
                  rows={6}
                  maxLength={4000}
                  value={prompt}
                  placeholder="分析后生成场景描述，可继续修改"
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </label>
            )}
          </div>

          {/* ── 卡片 3/4: 输出参数 ── */}
          <div className="multi-image-fusion-card multi-image-fusion-parameter-card">
            <div className="multi-image-fusion-card-heading compact">
              <div>
                <h2>输出参数</h2>
              </div>
            </div>
            <div className="multi-image-fusion-parameter-group">
              <div className="multi-image-fusion-field-label">
                <span>变体张数</span>
              </div>
              <div className="multi-image-fusion-variant-options" role="radiogroup" aria-label="变体张数">
                {VARIANT_COUNTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === variantCount}
                    className={v === variantCount ? 'selected' : undefined}
                    onClick={() => setVariantCount(v)}
                  >
                    {v} 张
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── 卡片 4/4: 提交区 (S-15: sticky 白底容器) ── */}
          {/* §5.13: 本元素同时挂 image-tool-submit-area 与 multi-image-fusion-submit-area,
               两者特异度相同, 后定义者胜 → 真实底色 #fff / z-index 10 (非 #f6f7fb / 5) */}
          <div className="image-tool-submit-area multi-image-fusion-submit-area">
            <div className="image-output-settings-shell">
              <button
                type="button"
                className="image-output-settings-summary"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((v) => !v)}
              >
                <span className="image-output-settings-summary-label">高级设置</span>
                <span className="image-output-settings-chip">比例 {ratio}</span>
                <span className="image-output-settings-chip">画质 {resolutionLabel}</span>
                <ChevronDown size={14} className={settingsOpen ? 'is-open' : undefined} />
              </button>
              {settingsOpen && (
                <div className="image-output-settings-popover">
                  <div className="image-output-settings-popover-head">
                    <h2>高级设置</h2>
                    <button
                      type="button"
                      className="image-output-settings-close"
                      aria-label="关闭高级设置"
                      title="关闭"
                      onClick={() => setSettingsOpen(false)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="image-output-settings">
                    <div className="image-output-settings-group">
                      <span className="image-output-settings-label">图片比例</span>
                      <div className="image-output-ratio-grid" aria-label="图片比例选项">
                        {ratioOptions('multi_fusion').map((o) => {
                          const r = String(o.value);
                          return (
                            <button
                              key={r}
                              type="button"
                              className={`image-output-ratio-option${r === ratio ? ' active' : ''}`}
                              aria-pressed={r === ratio}
                              onClick={() => setRatio(r)}
                            >
                              <small>{r}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="image-output-settings-group">
                      <span className="image-output-settings-label">分辨率（积分/权益消耗）</span>
                      <div className="image-output-resolution-grid" aria-label="分辨率选项">
                        {resolutionOptions('multi_fusion').map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            className={`image-output-resolution-option${
                              o.value === resolution ? ' active' : ''
                            }`}
                            aria-pressed={o.value === resolution}
                            disabled={o.disabled}
                            title={o.disabled ? o.disabledReason : undefined}
                            onClick={() => setResolution(String(o.value))}
                          >
                            <strong>{o.shortLabel ?? o.label}</strong>
                            <span>{o.sub}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <input
              ref={subjectInputRef}
              type="file"
              accept={SUPPORTED_IMAGE_ACCEPT}
              hidden
              onChange={(e) => {
                if (e.target.files) void uploadTo(e.target.files, 'subject');
                e.target.value = '';
              }}
            />
            <input
              ref={accentInputRef}
              type="file"
              accept={SUPPORTED_IMAGE_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void uploadTo(e.target.files, 'accent');
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="multi-image-fusion-submit-button"
              disabled={!subject || accents.length === 0 || submitting || (Boolean(token) && capabilityBlocked)}
              onClick={() => void submit()}
            >
              {submitting ? (
                <>
                  <Spin size="small" />
                  <span>生成中…</span>
                </>
              ) : (
                <>
                  <span>立即生成</span>
                  {/* creditLabel 为 null = 能力清单未到 (加载中)。
                      此时不显示任何价格占位 —— "加载中…"放在价格位上会被读成价格文案,
                      且用户点下按钮前看不到扣费提示。空着即可, 清单到达后会补上。 */}
                  {compactCreditLabel && <small>{compactCreditLabel}</small>}
                </>
              )}
            </button>
            {capabilityBlocked && token && (
              <p className="tool-submit-notice tool-submit-notice-error">{capabilityReason}</p>
            )}
          </div>
        </section>


        {/* ── 结果面板 ── */}
        <section className="multi-image-fusion-result-panel">
          <div className="multi-image-fusion-result-heading">
            <div>
              <h2>生成结果</h2>
              <p>
                {results.length > 0
                  ? `${results.length} 个融合变体 · ${ratio}`
                  : '完成设置后，生成结果会显示在这里'}
              </p>
            </div>
            <div className="multi-image-fusion-result-actions">
              <button
                type="button"
                disabled={
                  submitting || (Boolean(token) && capabilityBlocked) || results.length === 0
                }
                onClick={() => void submit()}
              >
                <RefreshCw size={13} />
                重新生成
              </button>
              <button type="button" disabled={!activeResult?.url} onClick={download}>
                <Download size={13} />
                一键下载
              </button>
            </div>
          </div>

          {submitting && results.length === 0 && !lastFailure ? (
            <div
              className="multi-image-fusion-preview-stage multi-image-fusion-generating-stage"
              style={{ aspectRatio: `${ratioW} / ${ratioH}` }}
            >
              <ToolGeneratingState />
            </div>
          ) : lastFailure && results.length === 0 ? (
            <div
              className="multi-image-fusion-preview-stage multi-image-fusion-failure-stage"
              style={{ aspectRatio: `${ratioW} / ${ratioH}` }}
            >
              <div className="multi-image-fusion-result-empty">
                <strong>生成失败</strong>
                <p>{lastFailure.errorCode ?? '未知错误'}</p>
              </div>
            </div>
          ) : results.length === 0 ? (
            <div
              className="multi-image-fusion-result-empty"
              style={{ aspectRatio: `${ratioW} / ${ratioH}` }}
            >
                {/* D-84: 参考站是 96x78 三卡片斜叠插画 (-9deg / 0 / +9deg), 非共用插画组件 */}
                <div className="multi-image-fusion-empty-art" aria-hidden>
                  <span>
                    <ImagePlus size={18} />
                  </span>
                  <span>
                    <Sparkles size={16} />
                  </span>
                  <span>
                    <Layers size={18} />
                  </span>
                </div>
                <strong>{EMPTY_TITLE}</strong>
                <p>{EMPTY_HINT}</p>
            </div>
          ) : activeResult?.url ? (
            <>
              {/* D-86: 参考站成功态是棋盘格预览舞台 + 缩略图网格, 不是本地详情卡 */}
              <div
                className="multi-image-fusion-preview-stage"
                style={{
                  aspectRatio:
                    activeResult.width && activeResult.height
                      ? `${activeResult.width} / ${activeResult.height}`
                      : `${ratioW} / ${ratioH}`,
                }}
              >
                <img
                  className="multi-image-fusion-preview-image"
                  src={activeResult.url}
                  alt={`多图融合结果 ${activeResultIndex + 1}`}
                />
                {activeResult.width && activeResult.height && (
                  <span className="multi-image-fusion-preview-size">
                    {activeResult.width}×{activeResult.height}
                  </span>
                )}
                {/* 以 pollToResult 的 provider 为准；新任务恒为模型，历史 local 如实保留 */}
                <ProviderBadge provider={activeResult.provider} className="mif-provider" />
              </div>
              <div className="multi-image-fusion-thumbnails">
                {results.map((item, index) => (
                  <button
                    key={item.url ?? index}
                    type="button"
                    className={index === activeResultIndex ? 'selected' : undefined}
                    aria-label={`查看第 ${index + 1} 个融合变体`}
                    aria-pressed={index === activeResultIndex}
                    onClick={() => setActiveResultIndex(index)}
                  >
                    <img
                      src={item.url}
                      alt={`融合结果缩略图 ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                    />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div
              className="multi-image-fusion-preview-stage"
              style={{ aspectRatio: `${ratioW} / ${ratioH}` }}
            >
              <div className="multi-image-fusion-result-empty">
                <strong>生成失败</strong>
                <p>模型没有返回可用图片，请重试</p>
              </div>
            </div>
          )}
        </section>
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
