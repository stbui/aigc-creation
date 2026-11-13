/**
 * 爆款复刻工作台页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 本页的独有 hook (`useCollectedReferenceAsset`) 也放在这里; 以后出现
 * 「只服务本页」的取数或状态逻辑, 直接在本文件追加。
 *
 * 约定: `viral-clone/` 下的文件不从 `src/hooks` / `src/context` / `src/components`
 * 直接取 hook, 一律经由本文件 —— 目录内新增通用 hook 时在这里补一行 re-export。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { useCapabilities } from '../../hooks/useCapabilities';
import type { UploadedImage } from '../../hooks/useImageUpload';
import { usePasteUpload } from '../../hooks/usePasteUpload';
import { useProject } from '../../hooks/useProject';
import { useTargetedAssetPicker } from '../../hooks/useTargetedAssetPicker';
import { runtimeOf } from '../../lib/constants';
import { assetsApi, assetSrc, toAbsoluteUrl } from './api';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_IMAGES,
  SUPPORTED_IMAGE_LABEL,
  type AssetSlot,
} from './constants';
import { isSupportedImageFile } from './utils';
import { useApp } from '../../ui';

/** 上传区素材条目 (商品图 / 参考图共用) */
export type { UploadedImage };

/** 项目归属 (上传与建任务都要求 projectId) */
export { useProject };
/** 轮询中止信号 (离开页面 / 重新提交时停掉旧轮询) */
export { usePollAbort } from '../../hooks/usePollAbort';
/** 粘贴上传 (商品图 / 参考图按当前聚焦的上传区回填) */
export { usePasteUpload };
/** 能力运行时状态: 后台下线或无线路时在前端事前标注 */
export { useCapabilities };
/** 实时积分单价 (后台可调价) */
export { useCreditLabel } from '../../hooks/useCreditLabel';
/** 错误提示: 把接口错误码翻译成用户可读文案 */
export { useGenerateError } from '../../hooks/useGenerateError';
/** 结果列表轮询; `GalleryItem` 是结果网格的数据类型 */
export {
  hasActiveGalleryItems,
  useResultGallery,
  type GalleryItem,
  type ResultGallery,
} from '../../hooks/useResultGallery';
export { useRightTab, type RightTab } from '../../hooks/useRightTab';
/** 单次提交的幂等键 */
export { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
/** 模型实时报价优先的价签 */
export { useModelQuoteCreditLabel } from '../../hooks/useModelQuoteCreditLabel';
/** 平台 / 比例 / 画质的生成设置 */
export { useGenerationSettings } from '../../hooks/useGenerationSettings';
/** 删除单张作品（确认框 + 接口 + 本地摘除） */
export { useDeleteGalleryItem } from '../../hooks/useDeleteGalleryItem';
/** 登录态: 判断是否已登录 (访客点提交先走登录弹窗) */
export { useAuth } from '../../context/AuthContext';
/** 余额变更通知: 扣费 / 退款后通知积分上下文刷新 */
export { notifyCreditsChanged } from '../../context/CreditsContext';

interface ViralCloneAssetsOptions {
  /** 商品图位上限，已为参考图预留 1 个模型输入位 */
  imageMax: number;
  /** 模型合同允许的商品图 + 参考图总数（提示文案用） */
  modelImageMax: number | null;
}

/**
 * 爆款复刻的双图片位（商品图 / 参考图）上传与回填。
 *
 * 页面有两栏上传区，素材库与手机上传又各由触发按钮决定回填到哪一栏；
 * 这组状态与校验规则放在这里，`page.tsx` 只保留表单与提交。
 * 参考图是单张位：新上传直接替换，多传的部分如实告知被丢弃（不静默截断）。
 */
export function useViralCloneAssets({ imageMax, modelImageMax }: ViralCloneAssetsOptions) {
  const { message } = useApp();
  const { ensureProject } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [reference, setReference] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);

  // 浏览器扩展「图片复刻」直接带参考图进来（地址参数由 hook 自行清理）
  useCollectedReferenceAsset(setReference);

  // ── 上传: 商品图 (点击/拖拽/粘贴, 按模型总图片数预留参考图位) ──
  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const room = imageMax - images.length;
      if (room <= 0) {
        message.warning(`当前模型最多接收 ${modelImageMax ?? MAX_IMAGES} 张图片，商品图最多 ${imageMax} 张`);
        return;
      }
      const accepted = list.slice(0, room);
      if (list.length > room) message.warning(`超出数量限制，仅取前 ${room} 张`);
      const oversize = accepted.filter((f) => f.size > MAX_IMAGE_BYTES);
      if (oversize.length > 0) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${oversize.map((f) => f.name).join('、')}`);
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
        message.success(`已上传 ${uploaded.length} 张商品图片`);
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [imageMax, images.length, modelImageMax, ensureProject, message],
  );

  // ── 上传: 参考图 (单张, 超出即替换) ──
  const uploadReference = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(isSupportedImageFile);
      if (list.length === 0) {
        message.warning(`请选择图片文件（${SUPPORTED_IMAGE_LABEL}）`);
        return;
      }
      const file = list[0];
      if (file.size > MAX_IMAGE_BYTES) {
        message.error(`单张不超过 ${MAX_IMAGE_MB}MB：${file.name}`);
        return;
      }
      setUploading(true);
      try {
        const projectId = await ensureProject();
        const asset = await assetsApi.upload(file, projectId);
        setReference({ id: asset.id, url: assetSrc(asset) ?? '', name: file.name });
        message.success('参考图已上传（最多 1 张，新上传将替换原参考图）');
      } catch (e) {
        message.error((e as Error).message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [ensureProject, message],
  );

  const removeImage = useCallback((id: string) => setImages((prev) => prev.filter((x) => x.id !== id)), []);
  const clearReference = useCallback(() => setReference(null), []);
  /** 产出素材被删除时, 若它正占着参考图位同步清掉 —— 否则下一轮会带着已不存在的 assetId 提交 */
  const removeReferenceAsset = useCallback((assetId: string) => {
    setReference((prev) => (prev?.id === assetId ? null : prev));
  }, []);

  // 拖拽 & 粘贴 (粘贴走商品图区, 与参考站主路径一致; 参考图支持点击/拖拽)
  // 两个拖拽高亮态均已下沉到 ToolImageDropzone 内部, 页面不再持有
  usePasteUpload(uploadFiles);

  // ── 素材库 / 手机上传 (商品图 / 参考图共用) ──
  const { libraryTarget, library, openLibraryFor, mobile } = useTargetedAssetPicker<AssetSlot>({
    onLibraryPick: (target, asset) => {
      const name = asset.sourceUrl.split('/').pop() ?? '素材';
      if (target === 'reference') {
        setReference({ id: asset.id, url: assetSrc(asset) ?? '', name });
        return true;
      }
      if (images.length >= imageMax) {
        message.warning(`当前模型最多接收 ${modelImageMax ?? MAX_IMAGES} 张图片，商品图最多 ${imageMax} 张`);
        return false;
      }
      if (images.some((x) => x.id === asset.id)) {
        message.info('该素材已在列表中');
        return false;
      }
      setImages((prev) => [...prev, { id: asset.id, url: assetSrc(asset) ?? '', name }]);
      return true;
    },
    onMobileReceive: (target, assets) => {
      const toAsset = (a: typeof assets[number]) => ({
        id: a.id,
        url: toAbsoluteUrl(a.signedUrl || a.url) ?? '',
        name: a.filename,
      });
      if (target === 'reference') {
        const first = assets[0];
        if (!first) return;
        if (assets.length > 1) message.warning('参考图位只有 1 个，仅取第 1 张');
        setReference(toAsset(first));
        message.success('已从手机接收参考图');
        return;
      }
      // 额度判定放在 setState 外: 在 updater 里弹 toast 会被 StrictMode 跑两遍
      const room = imageMax - images.length;
      if (room <= 0) {
        message.warning(`商品图位已满 (${imageMax} 张), 手机上传的图片未加入`);
        return;
      }
      const fresh = assets.filter((a) => !images.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room);
      if (fresh.length > accepted.length) {
        message.warning(`商品图位只剩 ${room} 个, ${fresh.length - accepted.length} 张未加入`);
      }
      setImages((prev) => [...prev, ...accepted.map(toAsset)]);
      if (accepted.length > 0) message.success(`已从手机接收 ${accepted.length} 张图片`);
    },
  });

  return {
    images,
    reference,
    uploading,
    fileInputRef,
    referenceInputRef,
    uploadFiles,
    uploadReference,
    removeImage,
    clearReference,
    replaceReference: setReference,
    removeReferenceAsset,
    /** 素材库可选项上限: 参考图是单张位, 只允许选 1 张 */
    libraryMaxSelectable: libraryTarget === 'reference' ? 1 : imageMax,
    library,
    openLibraryFor,
    mobile,
  };
}

/**
 * 爆款复刻能力此刻能不能提交。
 *
 * 没有可用模型通道 (`unavailable`) 或被后台下线 (`disabled`) 时提前拦住提交,
 * 避免用户填完表单点下去才收到一次 42204。不可提交时统一给出可读原因:
 * 运营下线时透出后台填写的原因, 其余场景用本页兜底文案。
 */
export function useHotRemakeAvailability(): string | null {
  const { data } = useCapabilities();
  const def = data?.items.find((c) => c.id === 'hot_remake');
  const runtime = def ? runtimeOf(def) : null;
  if (!runtime) return null;
  if (runtime.effective !== 'unavailable' && runtime.effective !== 'disabled') return null;
  return runtime.reason || '该能力当前不可提交，请稍后再试或联系客服。';
}

/**
 * 浏览器扩展「图片复刻」带参考图进入本页。
 *
 * 扩展只拿得到素材 id (生成接口吃 inputAssetIds, 不是 URL), 故约定
 * `/viral-clone?referenceAssetId=xxx`: 进来按 id 取回素材回填参考图,
 * 用完即从地址栏摘掉 —— 保留会让刷新/后退重复拉取, 也会让用户复制链接
 * 给别人时莫名其妙多带一张图。
 *
 * 未登录时不发请求 (C 端路由开放浏览, 此时必然 401); 参数留在地址上,
 * 登录回来 token 到位后本 hook 自然再次触发。
 */
export function useCollectedReferenceAsset(onLoaded: (asset: UploadedImage) => void) {
  const { message } = useApp();
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const referenceAssetId = searchParams.get('referenceAssetId');
  /** 已处理过的 id, 防止 token 变化等依赖抖动导致重复拉取 */
  const handledReferenceAssetId = useRef<string | null>(null);

  useEffect(() => {
    if (!referenceAssetId || !token) return;
    if (handledReferenceAssetId.current === referenceAssetId) return;
    handledReferenceAssetId.current = referenceAssetId;

    let cancelled = false;
    void (async () => {
      try {
        const asset = await assetsApi.get(referenceAssetId);
        if (cancelled) return;
        onLoaded({
          id: asset.id,
          url: assetSrc(asset) ?? '',
          name: asset.sourceTitle || asset.sourceUrl.split('/').pop() || '参考图',
        });
        message.success('已带入采集的参考图');
      } catch (e) {
        if (cancelled) return;
        message.error((e as Error).message || '参考图读取失败');
      } finally {
        if (!cancelled) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete('referenceAssetId');
              return next;
            },
            { replace: true },
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [referenceAssetId, token, message, setSearchParams, onLoaded]);
}
