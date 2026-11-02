import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type BatchPlan,
  type SkuBatchResult,
  type StartedTask,
  type VariantParam,
} from './constants';
import type { ToolAsset, ToolSettings } from './components';
import { generateApi, newIdempotencyKey, resolveModelId } from './api';
import type { GalleryItem } from '../../hooks/useResultGallery';
import { useProject } from '../../hooks/useProject';
import { useGenerateError } from '../../hooks/useGenerateError';
import { notifyCreditsChanged } from '../../context/CreditsContext';
import {
  pollToResult,
  resultFromGallery,
  taskErrorText,
  type SkuBatchGroup,
} from './utils';
import type { TaskStatus } from '../../types/api';
import { useApp } from '../../ui';

/**
 * 商品 SKU 图工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页的独有 hook (`useSkuBatch`) 也放在这里; 以后出现「只服务本页」的
 * 取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `product-sku/` 下的文件不从 `src/hooks` / `src/context` / `src/components`
 * 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 模板图粘贴上传 */
export { usePasteUpload } from '../../hooks/usePasteUpload';
/** 结果列表轮询; `GalleryItem` 是历史面板的数据类型 */
export { useResultGallery, type GalleryItem } from '../../hooks/useResultGallery';
/** 登录态: 判断是否已登录 */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 素材库取数 (定义在 AssetLibraryModal 文件里) */
export { useAssetLibrary } from '../../components/AssetLibraryModal';

/**
 * SKU 批量生成：批次状态 + 建单 → 轮询 → 结果回填。
 *
 * 从 `page.tsx` 抽出，但行为与原来的内联实现一致：
 *   - 新批次按 `batchId + planIndex` 生成幂等键；
 *   - 重试按 attempt 递进，避免复用已命中过的 key；
 *   - 一批 SKU 只解析一次模型，保证版式一致；
 *   - 中途建单失败时，已创建的任务仍继续轮询，不让用户看到“整批失败”。
 */
export function useSkuBatch({
  pollSignal,
  prependGallery,
}: {
  pollSignal: AbortSignal;
  prependGallery: (items: GalleryItem[]) => void;
}) {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const reportError = useGenerateError();

  const batchPlanRef = useRef<BatchPlan | null>(null);
  const batchItemsRef = useRef<SkuBatchResult[]>([]);
  const attemptSeqRef = useRef(0);
  const batchRunningRef = useRef(false);

  const [submitting, setSubmitting] = useState(false);
  const [failedNotice, setFailedNotice] = useState<string | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<SkuBatchResult[]>([]);

  useEffect(() => {
    batchItemsRef.current = batchItems;
  }, [batchItems]);

  const runBatch = useCallback(
    async (plan: BatchPlan, targetIndices: number[], mode: 'new' | 'retry') => {
      const targets = Array.from(new Set(targetIndices)).sort((a, b) => a - b);
      if (targets.length === 0 || batchRunningRef.current) return;
      batchRunningRef.current = true;
      const attempt = ++attemptSeqRef.current;
      const pendingId = (planIndex: number) => `pending-${plan.batchId}-${planIndex}-${attempt}`;
      const labelOf = (planIndex: number) =>
        plan.items[planIndex]?.name.trim() || `SKU ${planIndex + 1}`;

      setSubmitting(true);
      setFailedNotice(null);
      if (mode === 'new') {
        const pending = plan.items.map((_, planIndex) => ({
          id: pendingId(planIndex),
          planIndex,
          label: labelOf(planIndex),
          status: 'queued' as TaskStatus,
        }));
        setBatchItems(pending);
        setActiveResultId(pending[0]?.id ?? null);
      } else {
        setBatchItems((current) =>
          current.map((entry) =>
            targets.includes(entry.planIndex)
              ? {
                  ...entry,
                  id: pendingId(entry.planIndex),
                  status: 'queued',
                  url: undefined,
                  errorCode: undefined,
                }
              : entry,
          ),
        );
        setActiveResultId(pendingId(targets[0]));
      }

      try {
        const projectId = await ensureProject();
        // 整批 SKU 共用同一个模型：版式一致性依赖同一线路，逐张解析可能在
        // 目录缓存过期时把一批图拆到两个模型上
        const logicalModelId = await resolveModelId('sku_image');
        const startResults = await Promise.allSettled(
          targets.map(async (planIndex) => {
            const item = plan.items[planIndex];
            const label = labelOf(planIndex);
            const uniqueReferences: ToolAsset[] = [];
            for (const region of plan.regions) {
              const reference = item.variants[region.id]?.reference;
              if (reference && !uniqueReferences.some((entry) => entry.id === reference.id)) {
                uniqueReferences.push(reference);
              }
            }
            const referenceIndex = new Map(
              uniqueReferences.map((reference, index) => [reference.id, index + 1]),
            );
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
            const idempotencyKey =
              mode === 'retry'
                ? `sku-${plan.batchId}-${planIndex + 1}-retry-${attempt}`
                : `sku-${plan.batchId}-${planIndex + 1}`;
            const { taskId } = await generateApi.start({
              projectId,
              capability: 'sku_image',
              logicalModelId,
              idempotencyKey,
              inputAssetIds: [
                plan.template.id,
                ...uniqueReferences.map((reference) => reference.id),
              ],
              params: {
                skuName: label,
                regions: JSON.stringify(
                  plan.regions.map(({ id, type, x, y, width, height }) => ({
                    regionId: id,
                    type,
                    x,
                    y,
                    width,
                    height,
                  })),
                ),
                variants: JSON.stringify(variantPayload),
                batchId: plan.batchId,
                batchIndex: planIndex + 1,
                batchSize: plan.items.length,
                ratio: plan.settings.ratio,
                size: plan.settings.resolution,
              },
            });
            return { taskId, label, planIndex } satisfies StartedTask;
          }),
        );

        const started: StartedTask[] = [];
        const startErrors: unknown[] = [];
        startResults.forEach((result) => {
          if (result.status === 'fulfilled') started.push(result.value);
          else startErrors.push(result.reason);
        });

        setBatchItems((current) =>
          current.map((entry) => {
            const targetPosition = targets.indexOf(entry.planIndex);
            if (targetPosition < 0) return entry;
            const result = startResults[targetPosition];
            if (result.status === 'rejected') return { ...entry, status: 'failed' };
            return {
              ...entry,
              id: result.value.taskId,
              label: result.value.label,
              status: 'queued',
            };
          }),
        );
        if (started[0]) setActiveResultId(started[0].taskId);

        const polled =
          started.length === 0
            ? []
            : await Promise.all(
                started.map(async (task) => {
                  let result: Awaited<ReturnType<typeof pollToResult>>;
                  try {
                    result = await pollToResult(task.taskId, { signal: pollSignal });
                  } catch {
                    result = { status: 'failed' };
                  }
                  setBatchItems((current) =>
                    current.map((entry) =>
                      entry.planIndex === task.planIndex
                        ? {
                            ...entry,
                            status: result.status,
                            url: result.url,
                            width: result.width,
                            height: result.height,
                            errorCode: result.errorCode,
                          }
                        : entry,
                    ),
                  );
                  return { task, result };
                }),
              );

        const succeeded = polled.filter(
          ({ result }) => result.status === 'succeeded' && result.url,
        );
        const fresh = succeeded.map(({ task, result }) => ({
          id: task.taskId,
          status: 'succeeded' as const,
          url: result.url!,
          assetId: result.assetId,
          format: result.format,
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
        prependGallery(fresh);
        if (succeeded[0]) setActiveResultId(succeeded[0].task.taskId);

        const priorFailures =
          mode === 'retry'
            ? batchItemsRef.current.filter(
                (entry) => entry.status === 'failed' && !targets.includes(entry.planIndex),
              ).length
            : 0;
        const failedCount = priorFailures + targets.length - succeeded.length;
        if (failedCount > 0) {
          const firstPollFailure = polled.find(
            ({ result }) => result.status !== 'succeeded',
          )?.result.errorCode;
          const firstStartError = startErrors[0] instanceof Error ? startErrors[0].message : '';
          const detail = `本批次 ${plan.items.length} 张中 ${failedCount} 张未生成成功`;
          setFailedNotice(
            firstPollFailure
              ? `${detail}：${taskErrorText(firstPollFailure)}`
              : firstStartError
                ? `${detail}：${firstStartError}`
                : detail,
          );
          message.error(`${plan.items.length} 张中 ${failedCount} 张生成失败，可重试失败项`);
        } else if (succeeded.length > 0) {
          message.success(
            mode === 'retry'
              ? `已重试成功 ${succeeded.length} 张 SKU 图`
              : `已批量生成 ${succeeded.length} 张 SKU 图`,
          );
        }
      } catch (error) {
        reportError(error);
        setBatchItems((current) =>
          current.map((entry) =>
            targets.includes(entry.planIndex) &&
            (entry.status === 'queued' || entry.status === 'running')
              ? { ...entry, status: 'failed' }
              : entry,
          ),
        );
        setFailedNotice((error as Error).message || 'SKU 图生成失败');
      } finally {
        batchRunningRef.current = false;
        setSubmitting(false);
        notifyCreditsChanged();
      }
    },
    [ensureProject, message, pollSignal, prependGallery, reportError],
  );

  const submit = useCallback(
    async (
      _inputs: ToolAsset[],
      settings: ToolSettings,
      snapshot: Omit<BatchPlan, 'batchId' | 'settings'>,
    ) => {
      const plan: BatchPlan = {
        ...snapshot,
        batchId: newIdempotencyKey(),
        settings: { ...settings },
      };
      batchPlanRef.current = plan;
      await runBatch(plan, plan.items.map((_, index) => index), 'new');
    },
    [runBatch],
  );

  const retryFailed = useCallback(
    async (itemId?: string) => {
      const plan = batchPlanRef.current;
      if (!plan || submitting) return;
      const targets = batchItemsRef.current
        .filter((entry) => entry.status === 'failed' && (!itemId || entry.id === itemId))
        .map((entry) => entry.planIndex);
      if (targets.length === 0) return;
      await runBatch(plan, targets, 'retry');
    },
    [runBatch, submitting],
  );

  const openHistoryResult = useCallback((group: SkuBatchGroup) => {
    const restoredResults = group.items.map((item, index) => ({
      ...resultFromGallery(item),
      planIndex: index,
    }));
    setActiveResultId(
      restoredResults.find((item) => item.url)?.id ?? restoredResults[0]?.id ?? null,
    );
    setBatchItems(restoredResults);
    setFailedNotice(null);
    batchPlanRef.current = null;
  }, []);

  const clearBatch = useCallback(() => {
    setBatchItems([]);
    setActiveResultId(null);
    setFailedNotice(null);
  }, []);

  const removeBatchItems = useCallback((removedIds: Set<string>) => {
    setBatchItems((current) => current.filter((entry) => !removedIds.has(entry.id)));
    setActiveResultId((current) => (current && removedIds.has(current) ? null : current));
  }, []);

  return {
    submitting,
    failedNotice,
    activeResultId,
    batchItems,
    setActiveResultId,
    setFailedNotice,
    clearBatch,
    removeBatchItems,
    submit,
    retryFailed,
    openHistoryResult,
  };
}
