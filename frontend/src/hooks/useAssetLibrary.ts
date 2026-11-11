import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { assetsApi } from '../lib/api';
import type { Asset } from '../types/api';
import { useApp } from '../ui';

export interface UseAssetLibraryResult {
  open: boolean;
  loading: boolean;
  items: Asset[];
  /** 加载失败时的错误信息; 非空表示弹窗内应渲染失败态而非空态 */
  error: string | null;
  /** 打开弹窗并拉取素材（每次打开都重新拉，保证看到最新上传） */
  openLibrary: () => void;
  closeLibrary: () => void;
  /** 供弹窗点击某项时调用 */
  pick: (asset: Asset) => void;
}

/**
 * 素材库选择器的开关与取数状态。
 *
 * @param onPick 点选某素材后的回填逻辑，由各页自行实现（额度校验 / 去重 / 双通道选择等）。
 *   返回 `false` 表示拒绝本次选择（如超出张数上限），弹窗**保持打开**让用户改选；
 *   返回 `void` / `true` 视为接受，弹窗关闭。
 */
export function useAssetLibrary(onPick: (asset: Asset) => void | boolean): UseAssetLibraryResult {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Asset[]>([]);
  /**
   * 加载失败必须与「无素材」分开 (2026-10-20 修)。
   * 此前失败只 message.error 弹一下, 弹窗内照常渲染「素材库暂无原始图片」——
   * 用户以为是自己没上传过, 真相是接口没连上。
   */
  const [error, setError] = useState<string | null>(null);
  const { message } = useApp();
  const { token, openLogin } = useAuth();

  const openLibrary = useCallback(() => {
    // 素材库是账号数据。未登录直接打开选择器只会拿到 401，并在弹窗里
    // 显示「素材库加载失败」—— 把「需要登录」误报成「服务坏了」。
    // 与提交/上传入口一致，先唤起登录弹窗，登录后用户再点一次即可。
    if (!token) {
      openLogin();
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    // ⚠️ **不按 kind 过滤**: 选择器有「原始图片 / 生成图片」两个维度,
    // 若只拉 original, 切到「生成图片」永远是空的 —— 一个点不动的假入口。
    // 故一次性拉全部 (原始 + 生成), 由侧栏维度在前端分流。
    assetsApi
      .list({ limit: 120 })
      .then((res) => setItems(res.items ?? []))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '素材库加载失败');
        message.error('素材库加载失败');
      })
      .finally(() => setLoading(false));
  }, [message, openLogin, token]);

  const closeLibrary = useCallback(() => setOpen(false), []);

  const pick = useCallback(
    (asset: Asset) => {
      if (onPick(asset) === false) return;
      setOpen(false);
    },
    [onPick],
  );

  // 弹窗关闭时释放列表，避免下次打开前渲染出上一次的旧数据
  useEffect(() => {
    if (!open) {
      setItems([]);
      setError(null);
    }
  }, [open]);

  return { open, loading, items, error, openLibrary, closeLibrary, pick };
}
