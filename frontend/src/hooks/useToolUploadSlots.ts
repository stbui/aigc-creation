import { useCallback, useEffect, useRef, useState } from 'react';
import { assetsApi, assetSrc, toAbsoluteUrl } from '../lib/api';
import { useAssetLibrary } from './useAssetLibrary';
import { usePasteUpload } from './usePasteUpload';
import { useProject } from './useProject';
import { useUploadLimits } from '../context/UploadLimitsContext';
import { useApp } from '../ui';
import type { Asset, MobileUploadAsset, Task } from '../types/api';
import type { ToolAsset, UploadSpec } from '../components/toolShellTypes';

/**
 * 工具页「图片位」的状态与全部写操作。
 *
 * 2026-11-14 从 `ToolShell` 抽出：主壳此前同时承担「图片位状态机 + 左栏上传卡 +
 * 右栏结果三态 + 组合」，任一处调整都要在同一个 790 行文件里找位置。抽出后
 * 主壳只剩组合与提交，上传规则（额度 / 去重 / 替换 / 截断提示）集中在这里。
 *
 * 分工：`useImageUpload` 服务**页面自带上传区**的页面（商品主图 / 商品详情 /
 * 自由创作等，由页面自己渲染上传控件）；本 hook 服务 `ToolShell` 骨架，
 * 额外承载 `replaceUpload`（单图工具重新上传即替换）与历史结果回填。
 */

interface Options {
  /** 上传卡规格；`null` 表示该页自带上传区，图片位恒为空且写操作全部 no-op。 */
  upload: UploadSpec | null;
  /** 单图工具重新上传时替换当前图，而不是被「最多 1 张」拒绝。 */
  replaceUpload?: boolean;
  /** 图片位变化（上传 / 替换 / 移除 / 历史回填）。 */
  onImagesChange?: (images: ToolAsset[]) => void;
  /** 历史结果已回填到上传位；页面可据此清掉上一轮结果态。 */
  onHistoryReuse?: () => void;
}

export function useToolUploadSlots({
  upload,
  replaceUpload = false,
  onImagesChange,
  onHistoryReuse,
}: Options) {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const {
    accept: allowedAccept,
    allowedLabel,
    isSupportedImageFile,
    validateImageFile,
  } = useUploadLimits();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<ToolAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  /** 手机上传弹窗 (二维码方案, 手机端传回后进入图片位) */
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * 图片位的同步镜像。
   *
   * 素材库弹窗「确定」时是**同步 for 循环**逐个调 onPick, 期间不会重渲染 ——
   * 只读 `images` 会让「最多 1 张」的页面把一次勾选的 3 张全部收下 (每张都读到
   * 同一份旧 state)。故用 ref 记下本轮已接受的结果, 渲染后再与 state 对齐。
   */
  const imagesRef = useRef<ToolAsset[]>(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    onImagesChange?.(images);
  }, [images, onImagesChange]);

  /**
   * 素材库点选回填。
   *
   * ⚠️ 拒绝时必须显式 `return false`: undefined 会被选择器当成「接受」,
   * 上限与去重就形同虚设 (AssetLibraryModal 的调用约定)。
   */
  const pickFromLibrary = useCallback(
    (asset: Asset): boolean => {
      if (!upload) return false;
      const current = imagesRef.current;
      const replacing = replaceUpload && upload.max === 1 && current.length > 0;
      if (!replacing && current.length >= upload.max) {
        message.warning(`最多上传 ${upload.max} 张图片`);
        return false;
      }
      if (current.some((x) => x.id === asset.id)) {
        if (replacing) return true;
        message.info('该素材已在列表中');
        return false;
      }
      const next: ToolAsset = {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: asset.sourceUrl.split('/').pop() ?? '素材',
      };
      const nextImages = replacing ? [next] : [...current, next];
      imagesRef.current = nextImages;
      // 用 updater 追加: 一轮多选时前一张还没进 state, 直接读 images 会丢。
      // 单图替换则必须覆盖旧图，否则「素材库导入」会永远被额度拒绝。
      setImages((prev) => (replacing ? [next] : prev.some((x) => x.id === next.id) ? prev : [...prev, next]));
      return true;
    },
    [message, replaceUpload, upload],
  );

  // 素材库弹窗 (通用组件; 本 hook 只提供额度与去重规则)
  const library = useAssetLibrary(pickFromLibrary);

  /**
   * 手机端传回图片 → 进入图片位。
   *
   * 超出位数的部分**如实告知被截断**, 不静默丢弃: 用户在手机上挑好了 5 张,
   * 电脑端只进 1 张却不说, 是最难受的一种失败。
   */
  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      const max = upload?.max ?? 0;
      const prev = imagesRef.current;
      const replacing = replaceUpload && max === 1 && prev.length > 0;
      const room = max - prev.length + (replacing ? 1 : 0);
      if (room <= 0) {
        message.warning(`图片位已满 (${max} 张), 手机上传的图片未加入`);
        setMobileOpen(false);
        return;
      }
      const fresh = assets.filter((a) => !prev.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room);
      const dropped = fresh.length - accepted.length;
      if (dropped > 0) message.warning(`图片位只剩 ${room} 个, ${dropped} 张未加入`);

      const added: ToolAsset[] = accepted.map((a) => ({
        id: a.id,
        url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
        name: a.filename,
      }));
      if (added.length === 0) {
        setMobileOpen(false);
        return;
      }
      const nextImages = replacing ? added.slice(0, 1) : [...prev, ...added];
      imagesRef.current = nextImages;
      setImages((cur) =>
        replacing ? added.slice(0, 1) : [...cur, ...added.filter((a) => !cur.some((x) => x.id === a.id))],
      );
      setMobileOpen(false);
      if (added.length > 0) message.success(`已从手机接收 ${added.length} 张图片`);
    },
    [message, replaceUpload, upload],
  );

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!upload) return;
      const all = Array.from(files);
      const list = all.filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择 ${allowedLabel} 格式的图片`);
        return;
      }
      if (list.length !== all.length) {
        message.warning(`已忽略不支持的文件，仅支持 ${allowedLabel}`);
      }
      const current = imagesRef.current;
      const replacing = replaceUpload && upload.max === 1 && current.length > 0;
      const room = upload.max - current.length + (replacing ? 1 : 0);
      if (room <= 0) {
        message.warning(`最多上传 ${upload.max} 张图片`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      setUploading(true);
      try {
        for (const file of accepted) {
          const validationError = await validateImageFile(file);
          if (validationError) {
            message.error(`${file.name}：${validationError}`);
            return;
          }
        }
        const projectId = await ensureProject();
        const uploaded: ToolAsset[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        }
        const next = replacing ? uploaded.slice(0, 1) : [...imagesRef.current, ...uploaded];
        imagesRef.current = next;
        setImages(next);
        message.success(`已上传 ${uploaded.length} 张图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [allowedLabel, ensureProject, isSupportedImageFile, message, replaceUpload, upload, validateImageFile],
  );

  // 粘贴上传 (参考站支持直接粘贴)
  usePasteUpload(uploadFiles);

  const removeImage = (id: string) => {
    const next = imagesRef.current.filter((x) => x.id !== id);
    imagesRef.current = next;
    setImages(next);
  };

  /**
   * 历史结果 → 当前输入。
   *
   * 参考站会先取回历史图片、再作为一次新的上传，而不是直接重放旧任务
   * （旧参数可能已经失效，且跨项目素材不能直接作为新项目输入）。
   * 这里沿用该语义：优先复制到当前项目成为 original 素材；签名图床
   * 不允许跨域读取时，只有同项目素材才退回直接引用，跨项目明确报错。
   */
  const reuseHistoryTask = useCallback(
    async (task: Task): Promise<boolean> => {
      if (!upload) {
        message.warning('当前页面不支持复用历史结果');
        return false;
      }
      const output = task.outputAsset;
      if (!output?.id) {
        message.warning('这条历史记录没有可复用的图片');
        return false;
      }
      const src = assetSrc(output) ?? toAbsoluteUrl(output.sourceUrl);
      if (!src) {
        message.warning('历史结果地址不可用');
        return false;
      }

      const projectId = await ensureProject();
      let next: ToolAsset | null = null;
      try {
        const response = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('图片内容为空');
        const mime = blob.type || output.format || 'image/png';
        const extension = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
        const file = new File([blob], `history-${task.id}.${extension}`, { type: mime });
        const asset = await assetsApi.upload(file, projectId);
        next = {
          id: asset.id,
          url: assetSrc(asset) ?? src,
          name: `历史结果-${task.id.slice(-6)}.${extension}`,
        };
      } catch {
        if (task.projectId !== projectId) {
          throw new Error('历史结果属于其他项目，复制失败，请稍后重试');
        }
        next = {
          id: output.id,
          url: src,
          name: `历史结果-${task.id.slice(-6)}`,
        };
      }

      imagesRef.current = [next];
      setImages([next]);
      onHistoryReuse?.();
      message.success('已把历史结果加入上传位，可调整参数后继续生成');
      return true;
    },
    [ensureProject, message, onHistoryReuse, upload],
  );

  return {
    allowedAccept,
    images,
    uploading,
    dragging,
    setDragging,
    fileInputRef,
    mobileOpen,
    setMobileOpen,
    library,
    /** 素材库逐项回填（返回 false 表示拒绝该次选择，弹窗保持打开）。 */
    pickFromLibrary,
    uploadFiles,
    removeImage,
    addMobileAssets,
    reuseHistoryTask,
  };
}
