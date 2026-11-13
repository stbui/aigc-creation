import { useCallback, useRef, useState } from 'react';
import type { Asset, MobileUploadAsset } from '../types/api';
import { useAssetLibrary } from './useAssetLibrary';

interface Options<T> {
  /** 素材库点选回调；返回 false 表示拒绝，弹窗保持打开 */
  onLibraryPick: (target: T, asset: Asset) => boolean;
  /** 手机上传回传回调；目标位在回调前已记录 */
  onMobileReceive: (target: T, assets: MobileUploadAsset[]) => void;
}

/**
 * 「素材库 / 手机上传」到指定图片位的通用接线。
 *
 * 工具页常有多个图片位（商品图 / 参考图 / 模板图 / 变体区域），而弹窗只有一组：
 * 必须记住本次由哪个按钮打开，才能把选中的图片回填到正确的位置。
 * 商品 SKU 与爆款复刻页共用这套「先记目标、再打开、点选后清空」的语义。
 */
export function useTargetedAssetPicker<T>({ onLibraryPick, onMobileReceive }: Options<T>) {
  /** 素材库目标位；模板图 / 参考图位上限不同，需要暴露给调用方计算可选张数 */
  const [libraryTarget, setLibraryTarget] = useState<T | null>(null);
  const mobileTargetRef = useRef<T | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pick = useCallback(
    (asset: Asset): boolean => {
      if (libraryTarget === null) return false;
      const accepted = onLibraryPick(libraryTarget, asset);
      if (accepted) setLibraryTarget(null);
      return accepted;
    },
    [libraryTarget, onLibraryPick],
  );

  const library = useAssetLibrary(pick);

  const closeLibrary = useCallback(() => {
    setLibraryTarget(null);
    library.closeLibrary();
  }, [library.closeLibrary]);

  const openLibraryFor = useCallback(
    (target: T) => {
      setLibraryTarget(target);
      library.openLibrary();
    },
    [library.openLibrary],
  );

  const openMobileFor = useCallback((target: T) => {
    mobileTargetRef.current = target;
    setMobileOpen(true);
  }, []);

  const addMobileAssets = useCallback(
    (assets: MobileUploadAsset[]) => {
      const target = mobileTargetRef.current;
      mobileTargetRef.current = null;
      setMobileOpen(false);
      if (target !== null) onMobileReceive(target, assets);
    },
    [onMobileReceive],
  );

  const closeMobile = useCallback(() => {
    mobileTargetRef.current = null;
    setMobileOpen(false);
  }, []);

  return {
    libraryTarget,
    library: {
      open: library.open,
      loading: library.loading,
      items: library.items,
      error: library.error,
      closeLibrary,
      pick: library.pick,
    },
    openLibraryFor,
    mobile: {
      open: mobileOpen,
      openMobile: openMobileFor,
      addAssets: addMobileAssets,
      closeMobile,
    },
  };
}
