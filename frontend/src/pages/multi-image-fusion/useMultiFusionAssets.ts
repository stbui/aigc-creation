import { useCallback, useRef, useState } from 'react';

import {
  MAX_ACCENTS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  SUPPORTED_IMAGE_LABEL,
  type MultiFusionSlot,
} from './constants';
import type { ToolAsset } from './components';
import { assetsApi, assetSrc, toAbsoluteUrl } from './api';
import { isSupportedImageFile } from './utils';
import { useAuth } from '../../context/AuthContext';
import { useProject } from '../../hooks/useProject';
import { usePasteUpload } from '../../hooks/usePasteUpload';
import { useTargetedAssetPicker } from '../../hooks/useTargetedAssetPicker';
import type { Asset, MobileUploadAsset } from '../../types/api';
import { useApp } from '../../ui';

/**
 * 两个图位的上传、粘贴、素材库导入与手机回填。
 *
 * 主体图是**单张替换**位，搭配图是 1-5 张的追加位；两者共用同一组弹窗，
 * 因此「这次由哪个图位打开」的目标记录统一交给 `useTargetedAssetPicker`，
 * 本 hook 只负责各图位自己的额度与去重规则。
 *
 * 与 `useImageUpload` 的差别是结构性的：那边是「一个图片列表」，这里是
 * 「一个单图位 + 一个多图位」，粘贴落位（有空主体位先进主体位）与手机多选
 * 溢出到搭配位的语义只属于本页，故各页在自己的目录内维护。
 *
 * 目录内引用：内部 hook 直接引外部实现（与 `product-sku/useSkuDraft.ts` 一致），
 * 对外经 `hooks.ts` 转出，避免 `hooks.ts ↔ 本文件` 循环引用。
 */
export function useMultiFusionAssets() {
  const { message } = useApp();
  const { token, openLogin } = useAuth();
  const { ensureProject } = useProject();

  const [subject, setSubject] = useState<ToolAsset | null>(null);
  const [accents, setAccents] = useState<ToolAsset[]>([]);
  const [uploading, setUploading] = useState(false);

  /**
   * 搭配图位的同步镜像。
   *
   * 素材库「确定」与手机回填都会在**一次事件里连续**调用回填逻辑，
   * 期间不会重渲染 —— 只读 state 会让最后一次额度判断停留在旧数量，
   * 从而越过 5 张上限。
   */
  const accentsRef = useRef<ToolAsset[]>(accents);

  const commitAccents = useCallback((next: ToolAsset[]) => {
    accentsRef.current = next;
    setAccents(next);
  }, []);

  const uploadTo = useCallback(
    async (files: FileList | File[], target: MultiFusionSlot) => {
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
        const room = MAX_ACCENTS - accentsRef.current.length;
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
          commitAccents([...accentsRef.current, ...uploaded]);
          message.success(`已添加 ${uploaded.length} 张搭配图`);
        } catch (e) {
          message.error((e as Error).message || '上传失败');
        } finally {
          setUploading(false);
        }
        return;
      }

      // 主体图单张位: 新上传直接替换旧图
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
    },
    [commitAccents, ensureProject, message],
  );

  /** 粘贴上传: 主体位为空时进主体位，否则按顺序补搭配位。 */
  const onPasteFiles = useCallback(
    (files: File[]) => uploadTo(files, subject ? 'accent' : 'subject'),
    [subject, uploadTo],
  );
  usePasteUpload(onPasteFiles);

  const removeSubject = useCallback(() => setSubject(null), []);
  const removeAccent = useCallback(
    (id: string) => commitAccents(accentsRef.current.filter((x) => x.id !== id)),
    [commitAccents],
  );

  /** 素材库点选：主体位直接替换，搭配位按额度追加并去重 */
  const handleLibraryPick = useCallback(
    (target: MultiFusionSlot, asset: Asset): boolean => {
      const next: ToolAsset = {
        id: asset.id,
        url: assetSrc(asset) ?? toAbsoluteUrl(asset.sourceUrl) ?? '',
        name: asset.sourceUrl.split('/').pop() ?? '素材',
      };
      if (target === 'subject') {
        setSubject(next);
        return true;
      }
      if (accentsRef.current.length >= MAX_ACCENTS) {
        message.warning(`最多添加 ${MAX_ACCENTS} 张搭配图`);
        return false;
      }
      if (accentsRef.current.some((x) => x.id === asset.id)) {
        message.info('该素材已在搭配图中');
        return false;
      }
      commitAccents([...accentsRef.current, next]);
      return true;
    },
    [commitAccents, message],
  );

  /**
   * 手机端回传图片。
   *
   * 手机可一次多选：主体位只留第一张，余下的**转进搭配位**而不是丢弃 ——
   * 用户多选时最合理的意图就是"这些都要用"。
   * 提示必须放在 setState 之前算好：在 updater 里发消息会在 StrictMode
   * 双调用时弹两次，且 updater 本就不该有副作用。
   */
  const handleMobileReceive = useCallback(
    (target: MultiFusionSlot, incoming: MobileUploadAsset[]) => {
      if (incoming.length === 0) return;
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
        const room = Math.max(0, MAX_ACCENTS - accentsRef.current.length);
        const accepted = rest.slice(0, room).map(asToolAsset);
        const dropped = rest.length - accepted.length;
        if (dropped > 0) message.warning(`搭配图位只剩 ${room} 个，${dropped} 张未加入`);
        if (accepted.length > 0) commitAccents([...accentsRef.current, ...accepted]);
        message.success(`已接收 ${1 + accepted.length} 张图片（第 1 张为主体图）`);
        return;
      }

      const room = Math.max(0, MAX_ACCENTS - accentsRef.current.length);
      const fresh = incoming.filter((a) => !accentsRef.current.some((x) => x.id === a.id));
      const accepted = fresh.slice(0, room).map(asToolAsset);
      const dropped = fresh.length - accepted.length;
      if (dropped > 0) message.warning(`搭配图位只剩 ${room} 个，${dropped} 张未加入`);
      if (accepted.length > 0) commitAccents([...accentsRef.current, ...accepted]);
      message.success(`已从手机接收 ${accepted.length} 张搭配图`);
    },
    [commitAccents, message],
  );

  const { libraryTarget, library, openLibraryFor: openLibraryTarget, mobile } =
    useTargetedAssetPicker<MultiFusionSlot>({
      onLibraryPick: handleLibraryPick,
      onMobileReceive: handleMobileReceive,
    });

  /**
   * 素材库与手机上传都挂在登录用户名下: 未登录时先唤起登录，
   * 而不是等接口 401 后只留一句报错。
   */
  const openLibraryFor = useCallback(
    (target: MultiFusionSlot) => {
      if (!token) {
        openLogin();
        return;
      }
      // 搭配位已满时直接说清: 打开一个「最多可选 0 张」的弹窗等于让用户白点
      if (target === 'accent' && accentsRef.current.length >= MAX_ACCENTS) {
        message.warning(`搭配图已满 ${MAX_ACCENTS} 张，请先移除一张`);
        return;
      }
      openLibraryTarget(target);
    },
    [token, openLogin, message, openLibraryTarget],
  );

  const openMobileTarget = mobile.openMobile;
  const openMobile = useCallback(
    (target: MultiFusionSlot) => {
      if (!token) {
        openLogin();
        return;
      }
      openMobileTarget(target);
    },
    [token, openLogin, openMobileTarget],
  );

  return {
    subject,
    accents,
    uploading,
    totalCount: (subject ? 1 : 0) + accents.length,
    uploadTo,
    removeSubject,
    removeAccent,
    openLibraryFor,
    openMobile,
    /** 素材库弹窗 props（open / items / pick / closeLibrary 等） */
    library,
    libraryTarget,
    /** 主体位单选 1 张；搭配位按剩余额度限制 */
    libraryMaxSelectable: libraryTarget === 'subject' ? 1 : MAX_ACCENTS - accents.length,
    /** 手机上传弹窗 props（open / addAssets / closeMobile） */
    mobile,
  };
}
