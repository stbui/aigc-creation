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
  buildVariantsParam,
  ensureAssetsInProject,
  imageInputCountError,
} from './utils';

/**
 * 商品主图的生成提交流程。
 *
 * 一次提交**只发一个请求**：服务端按「自定义配置」的计数把这次提交拆成
 * N 个任务，每张各自建单、各自扣费、各自退款。
 *
 * ## 为什么拆单放到服务端
 *
 * 此前由前端逐张调用建单接口，带来三个真实问题：
 *
 *   1. **中途失败会留下半套状态** —— 前 3 张已建单并扣费，第 4 张失败，
 *      用户看到的是「报错了」，但前 3 张的钱已经扣掉、任务已经存在；
 *   2. **整批任务与账单不在一个事务里** —— 余额不足时可能扣掉一部分就停，
 *      留下「排队中但没有账单」的任务；
 *   3. **提示词与变体可能对不上** —— 前端逐张拼参数，任何一处漂移都会
 *      让某张图的变体与用户选的对不上。
 *
 * 服务端 `outputPlan` 一套机制（商品详情图 / 带货图文已在用）把这三件事
 * 一次解决：拆单、计费、事务全在服务端，前端只表达「要哪几类、各几张」。
 *
 * 本 hook 收口三件事：
 *   1. 提交前校验与素材准备（模型上限 → 项目 → 跨项目素材复制）；
 *   2. 幂等键：网络失败后重试复用同一键，服务端返回既有任务，不重复扣费；
 *   3. 失败语义：已落地的任务不回滚，尽量重拉列表让占位卡可见。
 */

/** 最近一次提交，用于失败重试复用同一幂等键 */
interface PendingSubmit {
  fingerprint: string;
  key: string;
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
  | { ok: true; projectId: string; modelKey: string; inputAssetIds: string[] }
  | { ok: false; reason: string };

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
  const pendingRef = useRef<PendingSubmit | null>(null);

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
      modelKey: model.modelKey,
      inputAssetIds: preparedImages.map((image) => image.id),
    };
  }, [form.images, ensureProject, onReplaceImage]);

  const submit = useCallback(async () => {
    if (!canSubmit || submitting || running) return;
    // guest 点击仍应走登录弹窗（generateApi 的 401 → auth:required 契约）
    setSubmitting(true);
    onSubmitted();

    let started = false;
    try {
      const prepared = await prepareInputs();
      if (!prepared.ok) {
        message.warning(prepared.reason);
        return;
      }

      const plan = buildVariantPlan(form.counts);
      const params = {
        productName: form.productName.trim(),
        brand: form.brand.trim(),
        platform: form.platform,
        language: form.language,
        description: form.description.trim(),
        ratio: form.ratio,
        size: form.resolution,
        // 服务端按这个清单拆成 N 个任务（每张各自计费）
        variants: buildVariantsParam(form.counts),
      };

      /*
       * 幂等键按「本次输入指纹」复用：网络层失败后重试拿到同一个键，
       * 服务端返回已创建的任务而不是再扣一次钱。输入变了指纹随之变化，
       * 自然开启新批次。
       */
      const fingerprint = JSON.stringify({
        capability: PRODUCT_KIT_CAPABILITY,
        projectId: prepared.projectId,
        modelKey: prepared.modelKey,
        inputAssetIds: prepared.inputAssetIds,
        params,
      });
      const key =
        pendingRef.current?.fingerprint === fingerprint
          ? pendingRef.current.key
          : newIdempotencyKey();
      pendingRef.current = { fingerprint, key };

      /*
       * 请求一旦发出，服务端就可能已经建单扣费。必须在调用**之前**置位：
       * 若网络在响应前断开，catch 里才能提示「可能已提交」并重拉记录，
       * 否则用户会以为没提交而重复操作。
       */
      started = true;
      await generateApi.start({
        projectId: prepared.projectId,
        capability: PRODUCT_KIT_CAPABILITY,
        modelKey: prepared.modelKey,
        inputAssetIds: prepared.inputAssetIds,
        idempotencyKey: key,
        params,
      });

      // 重拉列表拿到整批占位卡, 之后 useResultGallery 会轮询到全部任务终态
      await reloadResults();
      // 已成功提交；之后的主动再生成才换新幂等键
      pendingRef.current = null;
      message.success(`已提交 ${plan.length} 张商品主图，生成完成后自动更新`);
    } catch (e) {
      reportError(e);
      /*
       * 建单失败：服务端已落地的任务不回滚（已扣费）。尽量重拉一次，
       * 让已经落地的占位卡可见；pendingRef 保留，用户重试时复用同一
       * 幂等键，服务端会返回既有任务而不重复扣费。
       */
      if (started) {
        /*
         * 刷新失败不能吞掉「可能已提交」的提示，也不能让异常继续冒泡到
         * 页面的 `void submit()` 变成未处理拒绝 —— 提示优先。
         */
        try {
          await reloadResults();
        } catch {
          // 列表稍后会由轮询补上；这里只保证不掩盖真正原因
        }
        message.warning('部分商品主图可能已提交，请查看生成记录；重新提交不会重复扣费');
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
