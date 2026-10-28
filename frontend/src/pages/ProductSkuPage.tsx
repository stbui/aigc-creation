import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { ImagePlus, Plus, Upload, X } from 'lucide-react';
import { assetsApi, generateApi, assetSrc, newIdempotencyKey, toAbsoluteUrl } from '../lib/api';
import { AssetLibraryModal, useAssetLibrary } from '../components/AssetLibraryModal';
import { MobileUploadModal } from '../components/MobileUploadModal';
import { ImageLightbox } from '../components/ImageLightbox';
import { SkuHistoryPane } from '../components/SkuHistoryPane';
import { SkuRegionEditorModal, type SkuRegion } from '../components/SkuRegionEditorModal';
import { SkuResultPanel, type SkuResultItem } from '../components/SkuResultPanel';
import type { Asset, MobileUploadAsset, TaskStatus } from '../types/api';
import { useProject } from '../hooks/useProject';
import { usePollAbort } from '../hooks/usePollAbort';
import { useGenerateError } from '../hooks/useGenerateError';
import { usePasteUpload } from '../hooks/usePasteUpload';
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
import { downloadUrlsAsZip } from '../lib/zip';
import { groupContainsTask, groupSkuHistory, type SkuBatchGroup } from '../lib/skuBatches';
import { ToolShell, type ToolAsset, type ToolSettings } from '../components/ToolShell';

const MAX_REGIONS = 3;
const MAX_SKUS = 10;
const MAX_SKU_NAME = 15;

interface SkuVariantContent {
  regionId: string;
  instruction: string;
  reference?: ToolAsset;
}

interface SkuItem {
  key: number;
  name: string;
  variants: Record<string, SkuVariantContent>;
}

interface StartedTask {
  taskId: string;
  label: string;
  planIndex: number;
}

interface SkuBatchResult extends SkuResultItem {
  /** 对齐提交时的 SKU 顺序；重试与状态回填都按它定位。 */
  planIndex: number;
}

interface BatchPlan {
  batchId: string;
  template: ToolAsset;
  regions: SkuRegion[];
  items: SkuItem[];
  settings: ToolSettings;
}

interface VariantParam {
  regionId: string;
  instruction?: string;
  referenceAssetId?: string;
  referenceIndex?: number;
}

type LibraryTarget = { kind: 'template' } | { kind: 'reference'; itemKey: number; regionId: string };

let skuSeq = 0;

function createSkuItem(regions: SkuRegion[], name = 'SKU 1'): SkuItem {
  return {
    key: ++skuSeq,
    name,
    variants: Object.fromEntries(
      regions.map((region) => [region.id, { regionId: region.id, instruction: '' }]),
    ),
  };
}

function cloneSkuItem(source: SkuItem, name: string): SkuItem {
  return {
    key: ++skuSeq,
    name,
    variants: Object.fromEntries(
      Object.keys(source.variants).map((regionId) => [
        regionId,
        { regionId, instruction: '', reference: undefined } satisfies SkuVariantContent,
      ]),
    ),
  };
}

function syncVariants(items: SkuItem[], regions: SkuRegion[]): SkuItem[] {
  return items.map((item) => {
    const variants: Record<string, SkuVariantContent> = {};
    for (const region of regions) {
      variants[region.id] = item.variants[region.id] ?? { regionId: region.id, instruction: '' };
    }
    return { ...item, variants };
  });
}

function normalizeRegions(raw: unknown): SkuRegion[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: SkuRegion[] = [];
  for (const [index, entry] of value.slice(0, MAX_REGIONS).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const box = entry as Record<string, unknown>;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const type = box.type === 'ellipse' || box.type === 'brush' ? box.type : 'rect';
    out.push({
      id: typeof box.regionId === 'string' ? box.regionId : typeof box.id === 'string' ? box.id : `restored-region-${index + 1}`,
      type,
      x,
      y,
      width,
      height,
    });
  }
  return out;
}

function normalizeVariants(raw: unknown): VariantParam[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const regionId = typeof item.regionId === 'string' ? item.regionId : '';
    if (!regionId) return [];
    return [{
      regionId,
      instruction: typeof item.instruction === 'string' ? item.instruction : undefined,
      referenceAssetId: typeof item.referenceAssetId === 'string' ? item.referenceAssetId : undefined,
      referenceIndex: typeof item.referenceIndex === 'number' ? item.referenceIndex : undefined,
    }];
  });
}

function resultFromGallery(item: GalleryItem): SkuResultItem {
  return {
    id: item.id,
    label: item.caption || 'SKU 图',
    status: item.status ?? 'succeeded',
    url: item.url || undefined,
    width: item.width,
    height: item.height,
  };
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'SKU';
}

function downloadDirect(item: SkuResultItem) {
  if (!item.url) return;
  const anchor = document.createElement('a');
  anchor.href = item.url;
  anchor.download = `${safeFilename(item.label)}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ProductSkuPage() {
  const { message, modal } = App.useApp();
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
  const batchPlanRef = useRef<BatchPlan | null>(null);
  const batchItemsRef = useRef<SkuBatchResult[]>([]);
  const attemptSeqRef = useRef(0);
  const batchRunningRef = useRef(false);

  const [template, setTemplate] = useState<ToolAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [regions, setRegions] = useState<SkuRegion[]>([]);
  const [items, setItems] = useState<SkuItem[]>([createSkuItem([])]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failedNotice, setFailedNotice] = useState<string | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<SkuBatchResult[]>([]);
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

  useEffect(() => {
    batchItemsRef.current = batchItems;
  }, [batchItems]);

  const historyGroups = useMemo(() => groupSkuHistory(gallery.items), [gallery.items]);

  const applyTemplate = useCallback((next: ToolAsset) => {
    setTemplate(next);
    setRegions([]);
    setItems([createSkuItem([])]);
    setBatchItems([]);
    setActiveResultId(null);
    setFailedNotice(null);
    setEditorOpen(true);
  }, []);

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
      applyTemplate({
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: file.name,
      });
      message.success('模板图已上传，请框选变体区域');
    } catch (error) {
      reportError(error);
    } finally {
      setUploading(false);
    }
  }, [applyTemplate, ensureProject, message, reportError]);

  usePasteUpload((files) => uploadTemplate(files));

  const setVariantReference = useCallback((itemKey: number, regionId: string, reference: ToolAsset | undefined) => {
    setItems((current) => current.map((item) => {
      if (item.key !== itemKey) return item;
      const previous = item.variants[regionId] ?? { regionId, instruction: '' };
      return {
        ...item,
        variants: { ...item.variants, [regionId]: { ...previous, reference } },
      };
    }));
  }, []);

  const pickFromLibrary = useCallback((asset: Asset) => {
    const target = libraryTargetRef.current;
    if (!target) return false;
    const picked: ToolAsset = {
      id: asset.id,
      url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
      name: asset.sourceUrl.split('/').pop() ?? '素材',
    };
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
    const picked: ToolAsset = {
      id: first.id,
      url: toAbsoluteUrl(first.signedUrl || first.url) ?? '',
      name: first.filename,
    };
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
      setVariantReference(itemKey, regionId, {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: file.name,
      });
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
    setItems((current) => current.map((item) => {
      if (item.key !== itemKey) return item;
      return {
        ...item,
        variants: {
          ...item.variants,
          [regionId]: {
            ...(item.variants[regionId] ?? { regionId, instruction: '' }),
            instruction,
          },
        },
      };
    }));
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

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const normalized = item.name.trim().toLowerCase();
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const validationMessage = useMemo(() => {
    if (!template) return '请先上传模板图';
    if (regions.length === 0) return '请先在模板图上框选至少 1 个变体区域';
    if (items.length === 0) return '请至少添加 1 个 SKU';
    for (const [index, item] of items.entries()) {
      const name = item.name.trim();
      if (!name) return `请填写 SKU ${index + 1} 的名称`;
      if (name.length > MAX_SKU_NAME) return `SKU ${index + 1} 名称不能超过 ${MAX_SKU_NAME} 个字符`;
      if ((nameCounts.get(name.toLowerCase()) ?? 0) > 1) return `SKU 名称「${name}」重复`;
      for (const [regionIndex, region] of regions.entries()) {
        const variant = item.variants[region.id];
        if (!variant?.instruction.trim() && !variant?.reference) {
          return `请为 SKU ${index + 1} 的区域 ${regionIndex + 1} 填写说明或上传参考图`;
        }
      }
    }
    return null;
  }, [items, nameCounts, regions, template]);

  const openHistoryResult = useCallback((group: SkuBatchGroup) => {
    const restoredResults = group.items.map((item, index) => ({
      ...resultFromGallery(item),
      planIndex: index,
    }));
    setActiveResultId(restoredResults.find((item) => item.url)?.id ?? restoredResults[0]?.id ?? null);
    setBatchItems(restoredResults);
    setFailedNotice(null);
    batchPlanRef.current = null;
  }, []);

  const runBatch = async (plan: BatchPlan, targetIndices: number[], mode: 'new' | 'retry') => {
    const targets = Array.from(new Set(targetIndices)).sort((a, b) => a - b);
    if (targets.length === 0 || batchRunningRef.current) return;
    batchRunningRef.current = true;
    const attempt = ++attemptSeqRef.current;
    const pendingId = (planIndex: number) => `pending-${plan.batchId}-${planIndex}-${attempt}`;
    const labelOf = (planIndex: number) => plan.items[planIndex]?.name.trim() || `SKU ${planIndex + 1}`;

    setSubmitting(true);
    setFailedNotice(null);
    if (mode === 'new') {
      const pending = plan.items.map((_, planIndex) => ({
        id: pendingId(planIndex),
        planIndex,
        label: labelOf(planIndex),
        status: 'pending' as TaskStatus,
      }));
      setBatchItems(pending);
      setActiveResultId(pending[0]?.id ?? null);
    } else {
      setBatchItems((current) => current.map((entry) => targets.includes(entry.planIndex) ? {
        ...entry,
        id: pendingId(entry.planIndex),
        status: 'pending',
        url: undefined,
        errorCode: undefined,
      } : entry));
      setActiveResultId(pendingId(targets[0]));
    }

    try {
      const projectId = await ensureProject();
      const startResults = await Promise.allSettled(targets.map(async (planIndex) => {
        const item = plan.items[planIndex];
        const label = labelOf(planIndex);
        const uniqueReferences: ToolAsset[] = [];
        for (const region of plan.regions) {
          const reference = item.variants[region.id]?.reference;
          if (reference && !uniqueReferences.some((entry) => entry.id === reference.id)) uniqueReferences.push(reference);
        }
        const referenceIndex = new Map(uniqueReferences.map((reference, index) => [reference.id, index + 1]));
        const variantPayload: VariantParam[] = plan.regions.map((region) => {
          const variant = item.variants[region.id];
          const instruction = variant?.instruction.trim();
          const reference = variant?.reference;
          return {
            regionId: region.id,
            instruction: instruction || undefined,
            referenceAssetId: reference?.id,
            referenceIndex: reference ? referenceIndex.get(reference.id) : undefined,
          };
        });
        const idempotencyKey = mode === 'retry'
          ? `sku-${plan.batchId}-${planIndex + 1}-retry-${attempt}`
          : `sku-${plan.batchId}-${planIndex + 1}`;
        const { taskId } = await generateApi.start({
          projectId,
          capability: 'sku_image',
          idempotencyKey,
          inputAssetIds: [plan.template.id, ...uniqueReferences.map((reference) => reference.id)],
          params: {
            skuName: label,
            regions: JSON.stringify(plan.regions.map(({ id, type, x, y, width, height }) => ({ regionId: id, type, x, y, width, height }))),
            variants: JSON.stringify(variantPayload),
            batchId: plan.batchId,
            batchIndex: planIndex + 1,
            batchSize: plan.items.length,
            ratio: plan.settings.ratio,
            size: plan.settings.resolution,
          },
        });
        return { taskId, label, planIndex } satisfies StartedTask;
      }));

      const started: StartedTask[] = [];
      const startErrors: unknown[] = [];
      startResults.forEach((result, targetPosition) => {
        if (result.status === 'fulfilled') started.push(result.value);
        else startErrors.push(result.reason);
      });

      setBatchItems((current) => current.map((entry) => {
        const targetPosition = targets.indexOf(entry.planIndex);
        if (targetPosition < 0) return entry;
        const result = startResults[targetPosition];
        if (result.status === 'rejected') return { ...entry, status: 'failed' };
        return { ...entry, id: result.value.taskId, label: result.value.label, status: 'running' };
      }));
      if (started[0]) setActiveResultId(started[0].taskId);

      const polled = started.length === 0 ? [] : await Promise.all(started.map(async (task) => {
        let result: Awaited<ReturnType<typeof pollToResult>>;
        try {
          result = await pollToResult(task.taskId, { signal: pollSignal });
        } catch {
          result = { status: 'failed' };
        }
        setBatchItems((current) => current.map((entry) => entry.planIndex === task.planIndex ? {
          ...entry,
          status: result.status,
          url: result.url,
          width: result.width,
          height: result.height,
          errorCode: result.errorCode,
        } : entry));
        return { task, result };
      }));

      const succeeded = polled.filter(({ result }) => result.status === 'succeeded' && result.url);
      const fresh: GalleryItem[] = succeeded.map(({ task, result }) => ({
        id: task.taskId,
        status: 'succeeded',
        url: result.url!,
        width: result.width ?? null,
        height: result.height ?? null,
        createdAt: new Date().toISOString(),
        caption: task.label,
        params: {
          skuName: task.label,
          batchId: plan.batchId,
          batchIndex: task.planIndex + 1,
          batchSize: plan.items.length,
          ratio: plan.settings.ratio,
          size: plan.settings.resolution,
        },
      }));
      gallery.prepend(fresh);
      if (succeeded[0]) setActiveResultId(succeeded[0].task.taskId);

      const priorFailures = mode === 'retry'
        ? batchItemsRef.current.filter((entry) => entry.status === 'failed' && !targets.includes(entry.planIndex)).length
        : 0;
      const failedCount = priorFailures + targets.length - succeeded.length;
      if (failedCount > 0) {
        const firstPollFailure = polled.find(({ result }) => result.status !== 'succeeded')?.result.errorCode;
        const firstStartError = startErrors[0] instanceof Error ? startErrors[0].message : '';
        const detail = `本批次 ${plan.items.length} 张中 ${failedCount} 张未生成成功`;
        setFailedNotice(firstPollFailure
          ? `${detail}：${taskErrorText(firstPollFailure)}`
          : firstStartError ? `${detail}：${firstStartError}` : detail);
        message.error(`${plan.items.length} 张中 ${failedCount} 张生成失败，可重试失败项`);
      } else if (succeeded.length > 0) {
        message.success(mode === 'retry' ? `已重试成功 ${succeeded.length} 张 SKU 图` : `已批量生成 ${succeeded.length} 张 SKU 图`);
      }
    } catch (error) {
      reportError(error);
      setBatchItems((current) => current.map((entry) => targets.includes(entry.planIndex) && (entry.status === 'pending' || entry.status === 'running')
        ? { ...entry, status: 'failed' }
        : entry));
      setFailedNotice((error as Error).message || 'SKU 图生成失败');
    } finally {
      batchRunningRef.current = false;
      setSubmitting(false);
      notifyCreditsChanged();
    }
  };

  const submit = async (_inputs: ToolAsset[], settings: ToolSettings) => {
    if (!template || validationMessage || submitting) return;
    const plan: BatchPlan = {
      batchId: newIdempotencyKey(),
      template: { ...template },
      regions: regions.map((region) => ({ ...region })),
      items: items.map((item) => ({
        ...item,
        variants: Object.fromEntries(Object.entries(item.variants).map(([regionId, variant]) => [regionId, { ...variant }])),
      })),
      settings: { ...settings },
    };
    batchPlanRef.current = plan;
    await runBatch(plan, plan.items.map((_, index) => index), 'new');
  };

  const retryFailed = async (itemId?: string) => {
    const plan = batchPlanRef.current;
    if (!plan || submitting) return;
    const targets = batchItemsRef.current
      .filter((entry) => entry.status === 'failed' && (!itemId || entry.id === itemId))
      .map((entry) => entry.planIndex);
    if (targets.length === 0) return;
    await runBatch(plan, targets, 'retry');
  };

  const restoreHistory = useCallback(async (group: SkuBatchGroup) => {
    setRestoringId(group.id);
    try {
      const tasks = await Promise.all(group.items.map((item) => generateApi.getTask(item.id)));
      const inputIds = Array.from(new Set(tasks.flatMap((task) => task.inputAssetIds ?? [])));
      if (inputIds.length === 0) throw new Error('原模板或参考图已不可用');
      const assetResults = await Promise.allSettled(inputIds.map((id) => assetsApi.get(id)));
      const assets = assetResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      if (assets.length !== inputIds.length) throw new Error('原模板或参考图已不可用，无法恢复整批内容');
      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const primaryTask = tasks.find((task) => normalizeRegions(task.params?.regions).length > 0) ?? tasks[0];
      const templateId = primaryTask?.inputAssetIds?.[0];
      const templateAsset = templateId ? assetsById.get(templateId) : undefined;
      if (!templateAsset) throw new Error('原模板图已不可用');
      const restoredRegions = normalizeRegions(primaryTask?.params?.regions);
      if (restoredRegions.length === 0) throw new Error('这条历史记录没有可恢复的区域');

      const restoredItems = tasks.map((task, index) => {
        const variantParams = normalizeVariants(task.params?.variants);
        const name = typeof task.params?.skuName === 'string' ? task.params.skuName : group.items[index]?.caption || `SKU ${index + 1}`;
        return {
          key: ++skuSeq,
          name,
          variants: Object.fromEntries(restoredRegions.map((region, regionIndex) => {
            const variant = variantParams.find((entry) => entry.regionId === region.id) ?? variantParams[regionIndex];
            const referenceAsset = variant?.referenceAssetId ? assetsById.get(variant.referenceAssetId) : undefined;
            return [region.id, {
              regionId: region.id,
              instruction: variant?.instruction ?? '',
              reference: referenceAsset ? {
                id: referenceAsset.id,
                url: assetSrc(referenceAsset) ?? toAbsoluteUrl(referenceAsset.sourceUrl) ?? '',
                name: referenceAsset.sourceUrl.split('/').pop() ?? '参考图',
              } : undefined,
            } satisfies SkuVariantContent];
          })),
        } satisfies SkuItem;
      });

      setTemplate({
        id: templateAsset.id,
        url: assetSrc(templateAsset) ?? toAbsoluteUrl(templateAsset.sourceUrl) ?? '',
        name: templateAsset.sourceUrl.split('/').pop() ?? '模板图',
      });
      setRegions(restoredRegions);
      setItems(restoredItems.length > 0 ? restoredItems : [createSkuItem(restoredRegions)]);
      setDefaultRatio(typeof primaryTask?.params?.ratio === 'string' ? primaryTask.params.ratio : '1:1');
      setDefaultResolution(typeof primaryTask?.params?.size === 'string' ? primaryTask.params.size : '1k');
      setSettingsSeed((value) => value + 1);
      setFailedNotice(null);
      openHistoryResult(group);
      message.success(restoredItems.length > 1 ? `已恢复整批 ${restoredItems.length} 个 SKU` : '已恢复历史提交，可继续编辑');
    } catch (error) {
      message.error((error as Error).message || '历史提交恢复失败');
    } finally {
      setRestoringId(null);
    }
  }, [message, openHistoryResult]);

  const deleteHistory = useCallback((group: SkuBatchGroup) => {
    const count = group.items.length;
    modal.confirm({
      title: count > 1 ? `移除整批 ${count} 张 SKU 历史？` : '移除这条 SKU 历史记录？',
      content: '任务记录与生成图会一并删除，不可恢复。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const results = await Promise.allSettled(group.items.map((item) => generateApi.remove(item.id)));
        const removedIds = new Set(group.items.flatMap((item, index) => results[index]?.status === 'fulfilled' ? [item.id] : []));
        removedIds.forEach((id) => gallery.removeItem(id));
        setBatchItems((current) => current.filter((entry) => !removedIds.has(entry.id)));
        setActiveResultId((current) => current && removedIds.has(current) ? null : current);
        const failed = results.length - removedIds.size;
        if (failed > 0) message.error(`有 ${failed} 条历史移除失败，请稍后重试`);
        else message.success(count > 1 ? '整批历史记录已移除' : '历史记录已移除');
      },
    });
  }, [gallery, message, modal]);

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
    try {
      await downloadUrlsAsZip(
        `sku-batch-${new Date().toISOString().slice(0, 10)}.zip`,
        ready.map((item, index) => ({
          name: `${String(index + 1).padStart(2, '0')}-${safeFilename(item.caption || 'SKU')}.png`,
          url: item.url!,
        })),
      );
      message.success(`已打包下载 ${ready.length} 张 SKU 图`);
    } catch {
      ready.forEach((item, index) => window.setTimeout(() => downloadDirect(resultFromGallery(item)), index * 180));
      message.info('浏览器不支持打包，已改为逐张下载');
    }
  }, [message]);

  const handleDownloadAll = async () => {
    const ready = batchItems.filter((item) => item.status === 'succeeded' && item.url);
    if (ready.length === 0) return;
    try {
      await downloadUrlsAsZip(
        `sku-batch-${new Date().toISOString().slice(0, 10)}.zip`,
        ready.map((item, index) => ({
          name: `${String(index + 1).padStart(2, '0')}-${safeFilename(item.label)}.png`,
          url: item.url!,
        })),
      );
      message.success(`已打包下载 ${ready.length} 张 SKU 图`);
    } catch {
      ready.forEach((item, index) => window.setTimeout(() => downloadDirect(item), index * 180));
      message.info('浏览器不支持打包，已改为逐张下载');
    }
  };

  return (
    <>
      <ToolShell
        key={`sku-${settingsSeed}`}
        capability="sku_image"
        pageClass="product-sku-page"
        title="商品SKU图"
        desc="一张图，批量套出版式完全一致的整组 SKU 图。"
        upload={null}
        settings={{ ratio: true, resolution: true, defaultRatio, defaultResolution }}
        submitLabel="立即生成"
        emptyDesc="上传模板图、框选变体区域并编辑 SKU 清单后，批量结果会显示在这里"
        hint={validationMessage ?? undefined}
        formValid={validationMessage === null}
        submitting={submitting}
        result={null}
        onSubmit={submit}
        resultPane={
          <SkuResultPanel
            items={batchItems}
            loading={gallery.loading}
            error={gallery.error}
            notice={failedNotice}
            activeId={activeResultId}
            onActiveChange={setActiveResultId}
            onRefresh={() => void gallery.reload()}
            onDownload={downloadDirect}
            onDownloadAll={() => void handleDownloadAll()}
            onRetryFailed={(itemId) => void retryFailed(itemId)}
            retrying={submitting}
          />
        }
        trailingPane={
          <SkuHistoryPane
            items={historyGroups}
            loading={gallery.loading}
            error={gallery.error}
            activeId={activeResultId}
            onOpen={openHistoryResult}
            onRestore={(item) => void restoreHistory(item)}
            onDownload={(group) => void downloadHistoryGroup(group)}
            onDelete={deleteHistory}
            onRetry={() => void gallery.reload()}
          />
        }
      >
        <section className="product-sku-card product-sku-template-card">
          <div className="product-sku-card-heading">
            <div className="product-sku-card-heading-top">
              <h2>SKU模板图</h2>
              <div className="product-sku-card-heading-actions">
                <button type="button" className="workspace-material-library-trigger" onClick={() => openLibraryFor({ kind: 'template' })}>
                  从素材库导入
                </button>
                <button type="button" className="mobile-upload-trigger mobile-upload-qr-trigger" onClick={() => openMobileFor({ kind: 'template' })}>
                  手机上传
                </button>
              </div>
            </div>
            <p className="product-sku-card-heading-copy">
              选一张结构最完整的成品图作为模板，框选要跟随SKU变动的区域，最多支持3个SKU变体区域
            </p>
          </div>

          <input
            ref={templateInputRef}
            type="file"
            accept={SUPPORTED_IMAGE_ACCEPT}
            hidden
            onChange={(event) => {
              if (event.target.files) void uploadTemplate(event.target.files);
              event.target.value = '';
            }}
          />

          <div
            className="product-sku-template-upload-wrap"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void uploadTemplate(event.dataTransfer.files);
            }}
          >
            {uploading && (
              <span className="pk-dropzone-loading product-sku-template-loading" aria-live="polite">
                <Spin size="small" />
              </span>
            )}
            {template ? (
              <div className="product-sku-template-ready">
                <button type="button" className="product-sku-template-thumb" aria-label="预览模板图" onClick={() => setPreviewUrl(template.url)}>
                  <img src={template.url} alt={template.name} />
                </button>
                <div>
                  <button type="button" onClick={() => setEditorOpen(true)}>重新框选</button>
                  <button type="button" onClick={() => templateInputRef.current?.click()}>更换模板</button>
                  <button type="button" onClick={() => {
                    setTemplate(null);
                    setRegions([]);
                    setItems([createSkuItem([])]);
                    setBatchItems([]);
                    setActiveResultId(null);
                  }}>
                    <X size={12} /> 移除模板
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="product-sku-template-upload" onClick={() => templateInputRef.current?.click()}>
                <ImagePlus size={22} />
                <strong>点击或拖拽图片到此处上传</strong>
                <span>点击、拖拽或粘贴图片上传，最多 1 张</span>
              </button>
            )}
          </div>
        </section>

        {regions.length === 0 ? (
          <section className="product-sku-card product-sku-steps-card">
            <h2>使用步骤</h2>
            <ol className="product-sku-steps">
              <li className="product-sku-step"><b>1</b><div><strong>上传模板图</strong><span>导入 SKU 图，作为批量生成的模板图</span></div></li>
              <li className="product-sku-step"><b>2</b><div><strong>框选要变化的区域</strong><span>框选可变内容区域，精准控制生成范围</span></div></li>
              <li className="product-sku-step"><b>3</b><div><strong>编辑SKU清单</strong><span>录入商品 SKU 信息，配置每个 SKU 的变化内容</span></div></li>
              <li className="product-sku-step"><b>4</b><div><strong>批量输出SKU图</strong><span>一键生成多款 SKU 图，高效完成批量出图</span></div></li>
            </ol>
          </section>
        ) : (
          <section className="product-sku-list-section" aria-label="SKU 清单">
            <div className="product-sku-list-heading">
              <strong>SKU 清单</strong>
              <button type="button" disabled={items.length >= MAX_SKUS} onClick={addSku}>
                <Plus size={12} /> 添加 SKU
              </button>
            </div>
            {items.map((item, itemIndex) => {
              const name = item.name.trim();
              const duplicate = Boolean(name) && (nameCounts.get(name.toLowerCase()) ?? 0) > 1;
              return (
                <article key={item.key} className="product-sku-item-card">
                  <div className="product-sku-item-heading">
                    <div className="product-sku-item-title-edit">
                      <input
                        value={item.name}
                        maxLength={MAX_SKU_NAME}
                        aria-label={`SKU ${itemIndex + 1} 名称`}
                        className={duplicate || !name ? 'is-invalid' : undefined}
                        onChange={(event) => updateItemName(item.key, event.target.value)}
                      />
                      <span>{item.name.length}/{MAX_SKU_NAME}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`移除 SKU ${itemIndex + 1}`}
                      title="移除 SKU"
                      disabled={items.length <= 1}
                      onClick={() => removeSku(item.key)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {duplicate && <p className="product-sku-item-error">SKU 名称不可重复（忽略大小写）</p>}

                  {regions.map((region, regionIndex) => {
                    const variant = item.variants[region.id] ?? { regionId: region.id, instruction: '' };
                    const incomplete = !variant.instruction.trim() && !variant.reference;
                    const busy = referenceBusy === `${item.key}:${region.id}`;
                    return (
                      <div key={region.id} className={`product-sku-variant-row${incomplete ? ' is-incomplete' : ''}`}>
                        <div className="product-sku-variant-title">
                          <span className="product-sku-variant-icon">{regionIndex + 1}</span>
                          <strong>区域 {regionIndex + 1}</strong>
                          <label className="product-sku-reference-upload">
                            <Upload size={12} />
                            {busy ? '上传中…' : '上传参考图'}
                            <input
                              type="file"
                              accept={SUPPORTED_IMAGE_ACCEPT}
                              hidden
                              disabled={busy}
                              onChange={(event) => void uploadReferenceFile(event.target.files?.[0], item.key, region.id, event.currentTarget)}
                            />
                          </label>
                          <button
                            type="button"
                            className="workspace-material-library-trigger"
                            onClick={() => openLibraryFor({ kind: 'reference', itemKey: item.key, regionId: region.id })}
                          >
                            素材库
                          </button>
                          <button
                            type="button"
                            className="mobile-upload-trigger"
                            onClick={() => openMobileFor({ kind: 'reference', itemKey: item.key, regionId: region.id })}
                          >
                            手机上传
                          </button>
                        </div>
                        <div className="product-sku-variant-body">
                          <input
                            value={variant.instruction}
                            placeholder="描述该区域要替换成的商品、颜色、材质等"
                            aria-label={`SKU ${itemIndex + 1} 区域 ${regionIndex + 1} 说明`}
                            onChange={(event) => updateInstruction(item.key, region.id, event.target.value)}
                          />
                        </div>
                        {variant.reference && (
                          <div className="product-sku-reference-thumb">
                            <button type="button" aria-label="移除参考图" onClick={() => setVariantReference(item.key, region.id, undefined)}>
                              <X size={18} />
                            </button>
                            <img
                              src={variant.reference.url}
                              alt={`SKU ${itemIndex + 1} 区域 ${regionIndex + 1} 参考图`}
                              onClick={() => setPreviewUrl(variant.reference!.url)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </section>
        )}
      </ToolShell>

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
        <div className="product-sku-restoring" role="status">
          <Spin size="small" /> 正在恢复历史提交…
        </div>
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
