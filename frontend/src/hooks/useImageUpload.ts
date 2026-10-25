import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { assetsApi, assetSrc, toAbsoluteUrl } from '../lib/api';
import { useProject } from './useProject';
import { usePasteUpload } from './usePasteUpload';
import { useAssetLibrary } from '../components/AssetLibraryModal';
import { SUPPORTED_IMAGE_LABEL, isSupportedImageFile } from '../lib/constants';
import type { Asset, MobileUploadAsset } from '../types/api';

export interface UploadedImage {
  id: string;
  url: string;
  name: string;
}

interface Options {
  /** 数量上限 */
  max: number;
  /** 单张体积上限 (MB) */
  maxMb: number;
  /** 提示文案里的名词, 如「商品图片」/「参考图片」 */
  noun?: string;
  /** 初始已有素材 (从历史记录恢复时用) */
  initial?: UploadedImage[];
}

/**
 * 工具页图片上传逻辑 —— 2026-10-19 从 4 个大页面抽出。
 *
 * 抽出前的事实（ProductKitPage:112-176 与 ProductDetailPage:110-174 **逐字节相同**，
 * 前 41 行在 ViralClonePage:110-150 也相同）：三页各自复制了
 * 「类型/数量/体积三重校验 → ensureProject → 逐张上传 → 追加 → toast」+「素材库回填」
 * +「粘贴上传」共 79 行。
 *
 * 与既有 `useToolTask` 的分工：那个 hook 收口的是「提交 → 轮询 → 结果」，
 * 并明确写了「多任务/多结果页面仍各自维护提交流程」。本 hook 只管**输入侧**，
 * 不碰提交流程，两者在 `hooks/` 下并列。
 */
export function useImageUpload({ max, maxMb, noun = '商品图片', initial = [] }: Options) {
  const { message } = App.useApp();
  const { ensureProject } = useProject();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<UploadedImage[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * 图片位的同步镜像。
   *
   * 素材库弹窗「确定」时是**同步 for 循环**逐个调 onPick, 期间不会重渲染 ——
   * 只读 state 会让「最多 1 张」的页面把一次勾选的 3 张全部收下。手机上传的
   * 回调同理 (可能在一次事件里连加多张)。故用 ref 记本轮已接受的结果。
   */
  const imagesRef = useRef<UploadedImage[]>(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const room = max - images.length;
      if (room <= 0) {
        message.warning(`最多上传 ${max} 张${noun}`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > maxMb * 1024 * 1024);
      if (oversize.length > 0) {
        message.error(`单张不超过 ${maxMb}MB：${oversize.map((f) => f.name).join('、')}`);
        return;
      }

      setUploading(true);
      try {
        const projectId = await ensureProject();
        const uploaded: UploadedImage[] = [];
        for (const file of accepted) {
          const asset = await assetsApi.upload(file, projectId);
          uploaded.push({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        }
        setImages((prev) => [...prev, ...uploaded]);
        message.success(`已上传 ${uploaded.length} 张${noun}`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [images.length, max, maxMb, noun, ensureProject, message],
  );

  const removeImage = useCallback(
    (id: string) => setImages((prev) => prev.filter((x) => x.id !== id)),
    [],
  );

  // 参考站支持点击 / 拖拽 / 粘贴三种上传方式（拖拽高亮态在 ToolImageDropzone 内部）
  usePasteUpload(uploadFiles);

  /**
   * 素材库点选回填。
   *
   * ⚠️ **必须返回 false 表示拒绝** (不是 undefined):
   * 素材库选择器是**多选**的, 「确定」时逐个调用本回调;
   * 只有显式返回 false 才能让选择器中止整批并保持弹窗打开。
   * 返回 undefined 会被当成"接受" —— 超额的那张会静默进入, 上限失效。
   */
  const pickFromLibrary = useCallback(
    (asset: Asset): boolean => {
      const current = imagesRef.current;
      if (current.length >= max) {
        message.warning(`最多上传 ${max} 张${noun}`);
        return false;
      }
      if (current.some((x) => x.id === asset.id)) {
        message.info('该素材已在列表中');
        return false;
      }
      const next: UploadedImage = {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: asset.sourceUrl.split('/').pop() ?? '素材',
      };
      imagesRef.current = [...current, next];
      setImages((prev) => (prev.some((x) => x.id === next.id) ? prev : [...prev, next]));
      return true;
    },
    [max, noun, message],
  );

  const library = useAssetLibrary(pickFromLibrary);

  /**
   * 手机端传回图片 → 进入图片位。
   *
   * 超出位数的部分**如实告知被截断**, 不静默丢弃 (FreeCreationPage 同款语义)。
   */
  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      const current = imagesRef.current;
      const room = max - current.length;
      if (room <= 0) {
        message.warning(`图片位已满 (${max} 张${noun}), 手机上传的图片未加入`);
        setMobileOpen(false);
        return;
      }
      const fresh = assets.filter((a) => !current.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room);
      const dropped = fresh.length - accepted.length;
      if (dropped > 0) message.warning(`图片位只剩 ${room} 个, ${dropped} 张未加入`);

      const added: UploadedImage[] = accepted.map((a) => ({
        id: a.id,
        url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
        name: a.filename,
      }));
      imagesRef.current = [...current, ...added];
      setImages((prev) => [...prev, ...added.filter((a) => !prev.some((x) => x.id === a.id))]);
      setMobileOpen(false);
      if (added.length > 0) message.success(`已从手机接收 ${added.length} 张${noun}`);
    },
    [max, noun, message],
  );

  return {
    images,
    uploading,
    fileInputRef,
    uploadFiles,
    removeImage,
    /** 素材库弹窗状态 (openLibrary / closeLibrary / pick) */
    library,
    /** 手机上传弹窗: 状态 + 打开 + 接收回调 (弹窗由页面渲染) */
    mobile: {
      open: mobileOpen,
      openMobile: () => setMobileOpen(true),
      closeMobile: () => setMobileOpen(false),
      addAssets: addMobileAssets,
    },
  };
}
