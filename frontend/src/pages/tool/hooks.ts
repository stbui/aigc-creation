/**
 * 通用工具页的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用上传 / 轮询 / 错误翻译从 `src` 转出；只服务本页的表单任务状态
 * 直接定义在下方。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Asset, CapabilityDef, Task } from '../../types/api';
import { Upload, type FormInstance, type UploadFile } from '../../ui';
import { useAssetLibrary } from '../../hooks/useAssetLibrary';
import { useCreditLabel } from '../../hooks/useCreditLabel';
import { useGenerateError } from '../../hooks/useGenerateError';
import { usePollAbort } from '../../hooks/usePollAbort';
import { useProject } from '../../hooks/useProject';
import { useUploadLimits } from '../../context/UploadLimitsContext';
import { notifyCreditsChanged } from '../../context/CreditsContext';
import { useApp } from '../../ui';
import {
  ApiError,
  assetSrc,
  assetThumbSrc,
  assetsApi,
  generateApi,
  newIdempotencyKey,
  resolveModelKey,
} from './api';
import {
  taskErrorText,
  waitForTask,
} from './utils';

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject } from '../../hooks/useProject';
/** 轮询取消信号 */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 接口错误码 → 用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 余额变更通知 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
/** 素材库选择 */
export { useAssetLibrary } from '../../hooks/useAssetLibrary';
/** 能力定价文案 */
export { useCreditLabel } from '../../hooks/useCreditLabel';
/** SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 全局反馈 (message) */
export { useApp } from '../../ui';

/**
 * 通用工具页的上传 / 建任务 / 轮询状态。
 *
 * 上传与生成分开计数：上传完成的 finally 不能把「生成中」复位，否则轮询仍在跑
 * 时按钮恢复可点，再点一次就是第二个任务、第二次扣费。
 * 建单幂等键按「本次输入指纹」复用，网络重试不会重复扣费。
 */
export function useToolPageTask(def: CapabilityDef, form: FormInstance) {
  const { message } = useApp();
  const reportError = useGenerateError();
  const { ensureProject } = useProject();
  const pollSignal = usePollAbort();
  const { allowedLabel, isSupportedImageFile, validateImageFile } = useUploadLimits();

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [generating, setGenerating] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [task, setTask] = useState<Task | null>(null);
  /** 图片位的同步镜像：素材库一次确定多张时，渲染闭包里的 assets.length 是旧的 */
  const assetsRef = useRef<Asset[]>([]);
  /** 建单请求的幂等键：同一次提交的网络重试复用，避免重复扣费 */
  const pendingStartRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const inputs = def.inputs;
  /*
   * 消耗价文案与定制工具页同源。此前通用页**完全不提积分**, 用户点下去
   * 才发现余额少了 —— 同一个能力从不同入口进来, 说辞必须一致。
   */
  const creditLabel = useCreditLabel(def.id);

  /*
   * 「从素材库导入」。定制页早就有这个入口, 通用页没有, 于是同一个能力
   * 换个入口就得多走一趟本地文件。onPick 返回 false 表示额度不足,
   * 弹窗保持打开让用户改选。
   */
  const library = useAssetLibrary((asset) => {
    const current = assetsRef.current;
    if (current.length >= inputs) {
      message.warning(`最多 ${inputs} 张`);
      return false;
    }
    if (current.some((item) => item.id === asset.id)) {
      message.warning('这张素材已经在列表里了');
      return false;
    }
    // 同步更新镜像，保证同一批多选时第二张看到第一张已占用额度
    assetsRef.current = [...current, asset];
    setAssets((prev) => (prev.some((item) => item.id === asset.id) ? prev : [...prev, asset]));
    setFileList((prev) => [
      ...prev,
      {
        uid: asset.id,
        name: `素材-${asset.id.slice(0, 6)}.${asset.format}`,
        status: 'done',
        url: assetSrc(asset),
        // picture-card 只有 100 多像素; 原图留给后续查看 / 提交
        thumbUrl: assetThumbSrc(asset, 320),
      } as UploadFile,
    ]);
    return true;
  });

  // 切换能力时重置表单与状态 (默认值来自后端声明)
  useEffect(() => {
    form.setFieldsValue(def.defaultParams as Record<string, unknown>);
    setFileList([]);
    setAssets([]);
    assetsRef.current = [];
    setTask(null);
    pendingStartRef.current = null;
  }, [def.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doUpload(file: File): Promise<Asset> {
    const projectId = await ensureProject();
    return assetsApi.upload(file, projectId);
  }

  async function pollTask(taskId: string) {
    const outcome = await waitForTask(taskId, { signal: pollSignal, onTick: setTask });
    if (!outcome.ok) throw new Error('生成超时');
    return outcome.task;
  }

  /** antd 兼容 Upload 的 beforeUpload：校验后走自身上传逻辑 */
  const beforeUpload = async (file: File): Promise<boolean | string> => {
    if (generating) return Upload.LIST_IGNORE;
    if (!isSupportedImageFile(file)) {
      message.warning(`请选择图片文件（${allowedLabel}）`);
      return Upload.LIST_IGNORE;
    }
    const validationError = await validateImageFile(file);
    if (validationError) {
      message.error(`${file.name}：${validationError}`);
      return Upload.LIST_IGNORE;
    }
    setUploadingCount((count) => count + 1);
    doUpload(file)
      .then((asset) => {
        assetsRef.current = [...assetsRef.current, asset];
        setAssets((prev) => [...prev, asset]);
        // 必须落成 UploadFile：直接塞原生 File 时没有 uid / 预览地址，
        // 缩略图与「移除」都会错位（兼容层会按 uid 定位）。
        setFileList((prev) => [
          ...prev,
          {
            uid: asset.id,
            name: file.name,
            status: 'done',
            url: assetSrc(asset),
            thumbUrl: assetThumbSrc(asset, 320),
            originFileObj: file,
          },
        ]);
        message.success(`${file.name} 上传成功`);
      })
      .catch((cause: Error) => message.error(cause.message || '上传失败'))
      .finally(() => setUploadingCount((count) => Math.max(0, count - 1)));
    return false; // 阻止兼容层自动请求, 走自己的上传逻辑
  };

  const removeFile = (file: UploadFile) => {
    if (generating) return;
    const index = fileList.findIndex((item) => item.uid === file.uid);
    if (index >= 0) {
      assetsRef.current = assetsRef.current.filter((_, current) => current !== index);
      setAssets((prev) => prev.filter((_, current) => current !== index));
    }
    setFileList((prev) => prev.filter((item) => item.uid !== file.uid));
  };

  const onSubmit = async () => {
    if (generating || uploadingCount > 0) return;
    if (fileList.length < inputs) {
      message.warning(`请先上传 ${inputs} 张图片`);
      return;
    }
    setGenerating(true);
    setTask(null);
    try {
      const params = form.getFieldsValue();
      const projectId = await ensureProject();
      const modelKey = await resolveModelKey(def.id);
      const inputAssetIds = assetsRef.current.map((asset) => asset.id);
      const fingerprint = JSON.stringify({
        projectId,
        capability: def.id,
        modelKey,
        inputAssetIds,
        params,
      });
      const idempotencyKey =
        pendingStartRef.current?.fingerprint === fingerprint
          ? pendingStartRef.current.key
          : newIdempotencyKey();
      pendingStartRef.current = { fingerprint, key: idempotencyKey };

      const { taskId } = await generateApi.start({
        projectId,
        inputAssetIds,
        capability: def.id,
        modelKey,
        params,
        idempotencyKey,
      });
      // 已拿到任务句柄：后续轮询失败不应复用建单键
      pendingStartRef.current = null;
      const done = await pollTask(taskId);
      if (done.status !== 'succeeded') {
        message.error(`${def.name}未完成：${taskErrorText(done.errorCode)}`);
      } else {
        message.success(`${def.name} 已完成`);
      }
    } catch (cause) {
      // 4xx 是确定性拒绝，复用 key 只会再次失败；网络错误/5xx 保留 key
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        pendingStartRef.current = null;
      }
      reportError(cause);
    } finally {
      setGenerating(false);
      // 扣费在建任务时发生、失败会自动退还，两个方向都改了余额
      notifyCreditsChanged();
    }
  };

  const clearResult = useCallback(() => setTask(null), []);

  return {
    inputs,
    creditLabel,
    fileList,
    assets,
    generating,
    uploadingCount,
    task,
    resultUrl: task?.outputAsset ? assetSrc(task.outputAsset) : undefined,
    library,
    beforeUpload,
    removeFile,
    onSubmit,
    clearResult,
  };
}
