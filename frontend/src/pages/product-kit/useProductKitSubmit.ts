import { useCallback, useRef, useState } from 'react';

import { generateApi, newIdempotencyKey, resolveModel } from './api';
import { PRODUCT_KIT_CAPABILITY } from './constants';
import { useApp } from '../../ui';
import {
  notifyCreditsChanged,
  useGenerateError,
  useProject,
  type UploadedImage,
} from './hooks';
import {
  buildVariantPlan,
  ensureAssetsInProject,
  imageInputCountError,
} from './utils';

/**
 * 商品主图的生成提交流程。
 *
 * 一次提交会按「自定义配置」拆成 N 个独立任务，每个任务各自建单、各自扣费；
 * 页面只负责表单状态，这里收口三件事：
 *
 *   1. 提交前校验与素材准备（模型上限 → 项目 → 跨项目素材复制）；
 *   2. 幂等批次：中途失败后重试复用同一 `batchId` 与幂等键，不重复扣费，
 *      补建的任务也不会被分到另一行；
 *   3. 失败语义：已落地的任务不回滚，尽量重拉列表让占位卡可见。
 *
 * 语义与原先的 `page.tsx` 内联实现逐条一致，只是把顺序建单、批内键复用等
 * 细节从页面编排里移出来，页面只留 `useProductKitSubmit(...)` 一行。
 */

/** 最近一次「尚未拿到全部 taskId」的提交，用于失败重试复用 */
interface PendingBatch {
  fingerprint: string;
  keys: string[];
  batchId: string;
}

/** 提交所需的表单快照 —— 页面在本次渲染里原样传入 */
export interface ProductKitSubmitForm {
  /** 页面输入位上的图片（尚未复制到本项目） */
  images: UploadedImage[];
  /** 四类变体的张数 */
  counts: Record<string, number>;
  productName: string;
  brand: string;
  platform: string;
  language: string;
  description: string;
  ratio: string;
  resolution: string;
}

export interface UseProductKitSubmitOptions {
  form: ProductKitSubmitForm;
  /** 提交前条件（图片 / 名称 / 描述 / 张数） */
  canSubmit: boolean;
  /** 已有任务排队或运行中 —— 防止重复提交（不含本 hook 的 `submitting`） */
  running: boolean;
  /** 跨项目素材复制成功后立即替换输入位，失败重试不重复复制 */
  onReplaceImage: (id: string, next: UploadedImage) => void;
  /** 提交后把视线切到结果区（占位卡在那里，留在示例页看不到进度） */
  onSubmitted: () => void;
  /** 重拉结果列表，拿到整批占位卡 */
  reloadResults: () => Promise<unknown>;
}

type PreparedInputs =
  | { ok: true; projectId: string; logicalModelId: string; inputAssetIds: string[] }
  | { ok: false; reason: string };

interface BatchContext {
  projectId: string;
  logicalModelId: string;
  inputAssetIds: string[];
  baseParams: Record<string, string>;
  plan: string[];
  batchId: string;
  keys: string[];
}

/**
 * 顺序创建任务。
 *
 * 并行创建曾触发 broker IPC EPIPE，顺序提交更稳。每成功一次回调一次，
 * 调用方据此区分「首单就失败」与「已部分落地」—— 后者不能误报已提交，
 * 但重拉列表能看到已创建的任务。
 */
async function createTasks(context: BatchContext, onCreated: () => void): Promise<void> {
  const { projectId, logicalModelId, inputAssetIds, baseParams, plan, batchId, keys } = context;
  for (let i = 0; i < plan.length; i += 1) {
    await generateApi.start({
      projectId,
      capability: PRODUCT_KIT_CAPABILITY,
      logicalModelId,
      inputAssetIds,
      idempotencyKey: keys[i],
      params: {
        ...baseParams,
        variant: plan[i],
        batchId,
        batchIndex: i + 1,
        batchSize: plan.length,
      },
    });
    onCreated();
  }
}

/**
 * 按「本次输入指纹」复用或新建批次。
 *
 * 某次建单请求在网络层失败后，用户重试会拿到同一个 `batchId` / 幂等键，
 * 服务端返回已创建的任务而不是再扣一次钱。输入变了（换模型、换图、改参数）
 * 指纹随之变化，自然开启新批次。
 */
function reuseOrCreateBatch(
  ref: { current: PendingBatch | null },
  fresh: Omit<BatchContext, 'batchId' | 'keys'>,
): { batchId: string; keys: string[] } {
  const fingerprint = JSON.stringify({ capability: PRODUCT_KIT_CAPABILITY, ...fresh });
  const previous = ref.current?.fingerprint === fingerprint ? ref.current : null;
  const batchId = previous?.batchId ?? newIdempotencyKey();
  const keys = previous?.keys ?? fresh.plan.map(() => newIdempotencyKey());
  ref.current = { fingerprint, keys, batchId };
  return { batchId, keys };
}

export function useProductKitSubmit({
  form,
  canSubmit,
  running,
  onReplaceImage,
  onSubmitted,
  reloadResults,
}: UseProductKitSubmitOptions) {
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const [submitting, setSubmitting] = useState(false);
  const pendingBatchRef = useRef<PendingBatch | null>(null);

  /** 提交前解析真实模型并把输入图准备到当前项目 */
  const prepareInputs = useCallback(async (): Promise<PreparedInputs> => {
    /*
     * 模型选择器可能还没完成目录加载，或用户刚切换模型；提交前再按真实
     * 落库模型校验一次。超限时保留全部素材并明确提示，绝不静默截断。
     */
    const model = await resolveModel(PRODUCT_KIT_CAPABILITY);
    const limitError = imageInputCountError(model, form.images.length);
    if (limitError) return { ok: false, reason: limitError };

    const projectId = await ensureProject();
    /*
     * 素材库会展示账号下所有项目的图片，但后端只允许任务引用同项目素材。
     * 跨项目选中时先复制到当前项目；复制成功立即替换输入位，失败则停在
     * 建单之前 —— 绝不把跨项目 asset id 直接提交。
     */
    const preparedImages = await ensureAssetsInProject(form.images, projectId, {
      onPrepared: onReplaceImage,
    });
    return {
      ok: true,
      projectId,
      logicalModelId: model.id,
      inputAssetIds: preparedImages.map((image) => image.id),
    };
  }, [form.images, ensureProject, onReplaceImage]);

  const submit = useCallback(async () => {
    if (!canSubmit || submitting || running) return;
    // guest 点击仍应走登录弹窗（generateApi 的 401 → auth:required 契约）
    setSubmitting(true);
    onSubmitted();

    let batchStarted = false;
    try {
      const prepared = await prepareInputs();
      if (!prepared.ok) {
        message.warning(prepared.reason);
        return;
      }

      const baseParams = {
        productName: form.productName.trim(),
        brand: form.brand.trim(),
        platform: form.platform,
        language: form.language,
        description: form.description.trim(),
        ratio: form.ratio,
        size: form.resolution,
      };
      // 自定义配置计数 → 每类变体生成 count 张 (与参考站批量出图行为一致)
      const plan = buildVariantPlan(form.counts);
      const batchInput = {
        projectId: prepared.projectId,
        logicalModelId: prepared.logicalModelId,
        inputAssetIds: prepared.inputAssetIds,
        baseParams,
        plan,
      };
      const { batchId, keys } = reuseOrCreateBatch(pendingBatchRef, batchInput);

      await createTasks({ ...batchInput, batchId, keys }, () => {
        batchStarted = true;
      });

      // 重拉列表拿到整批占位卡, 之后 useResultGallery 会轮询到全部任务终态
      await reloadResults();
      // 整批已创建且列表已刷新成功; 之后的主动再生成才是新批次
      pendingBatchRef.current = null;
      message.success(`已提交 ${plan.length} 张商品主图，生成完成后自动更新`);
    } catch (e) {
      reportError(e);
      /*
       * 中途建单失败：已创建的任务不回滚（服务端已扣费）。尽量重拉一次，
       * 让已经落地的占位卡可见；pendingBatchRef 保留，用户重试时复用同一
       * batchId 与幂等键，服务端会返回既有任务并继续补齐缺失张数。
       */
      if (batchStarted) {
        /*
         * 刷新失败不能吞掉「可能已提交」的提示，也不能让异常继续冒泡到
         * 页面的 `void submit()` 变成未处理拒绝 —— 提示优先。
         */
        try {
          await reloadResults();
        } catch {
          // 列表稍后会由轮询补上；这里只保证不掩盖真正原因
        }
        message.warning('部分商品主图可能已提交，请查看生成记录；重新提交会继续补齐本批');
      }
    } finally {
      setSubmitting(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  }, [
    canSubmit,
    submitting,
    running,
    onSubmitted,
    prepareInputs,
    message,
    reloadResults,
    reportError,
    form.counts,
    form.productName,
    form.brand,
    form.platform,
    form.language,
    form.description,
    form.ratio,
    form.resolution,
  ]);

  return { submitting, submit };
}
