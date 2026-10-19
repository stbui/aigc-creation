import { useCallback, useEffect, useState } from 'react';
import { App, Modal, Spin } from 'antd';
import { assetsApi, toAbsoluteUrl } from '../lib/api';
import type { Asset } from '../types/api';

/**
 * 素材库导入弹窗 —— 工具页通用能力。
 *
 * 2026-10-19 抽取。此前同一套「打开 → 拉原始素材 → 网格展示 → 点选回填」在
 * ToolShell + ProductKit / ProductDetail / ViralClone / FreeCreation 共 5 处重复，
 * 连 loading / 空态 / 网格的 CSS 类名都相同（`pk-library-loading` / `-empty` / `-grid` / `-item`）。
 *
 * 各页唯一差异是「点选后如何回填」，故由 onPick 回调承担，弹窗本身不含业务判断。
 */

export interface UseAssetLibraryResult {
  open: boolean;
  loading: boolean;
  items: Asset[];
  /** 打开弹窗并拉取素材（每次打开都重新拉，保证看到最新上传） */
  openLibrary: () => void;
  closeLibrary: () => void;
  /** 供弹窗点击某项时调用 */
  pick: (asset: Asset) => void;
}

/**
 * 素材库弹窗的状态与数据。
 *
 * @param onPick 点选某素材后的回填逻辑，由各页自行实现（额度校验 / 去重 / 双通道选择等）。
 *   返回 `false` 表示拒绝本次选择（如超出张数上限），弹窗**保持打开**让用户改选；
 *   返回 `void` / `true` 视为接受，弹窗关闭。
 */
export function useAssetLibrary(onPick: (asset: Asset) => void | boolean): UseAssetLibraryResult {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Asset[]>([]);
  const { message } = App.useApp();

  const openLibrary = useCallback(() => {
    setOpen(true);
    setLoading(true);
    assetsApi
      .list({ kind: 'original', limit: 60 })
      .then((res) => setItems(res.items ?? []))
      .catch(() => message.error('素材库加载失败'))
      .finally(() => setLoading(false));
  }, [message]);

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
    if (!open) setItems([]);
  }, [open]);

  return { open, loading, items, openLibrary, closeLibrary, pick };
}

export interface AssetLibraryModalProps {
  open: boolean;
  loading: boolean;
  items: Asset[];
  onCancel: () => void;
  onPick: (asset: Asset) => void;
  /** 只读模式：点击不触发回填（ToolShell 的导入按钮为诚实禁用态，用它做只读展示） */
  readOnly?: boolean;
}

export function AssetLibraryModal({
  open,
  loading,
  items,
  onCancel,
  onPick,
  readOnly = false,
}: AssetLibraryModalProps) {
  return (
    <Modal open={open} title="从素材库导入" footer={null} width={720} onCancel={onCancel}>
      {loading ? (
        <div className="pk-library-loading">
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <div className="pk-library-empty">素材库暂无原始图片，请先上传</div>
      ) : (
        <div className="pk-library-grid">
          {items.map((a) =>
            readOnly ? (
              <div key={a.id} className="pk-library-item">
                <img src={toAbsoluteUrl(a.sourceUrl)} alt={a.sourceUrl} loading="lazy" decoding="async" />
                <span>
                  {a.width}×{a.height} · {a.format}
                </span>
              </div>
            ) : (
              <button key={a.id} type="button" className="pk-library-item" onClick={() => onPick(a)}>
                <img src={toAbsoluteUrl(a.sourceUrl)} alt={a.sourceUrl} loading="lazy" decoding="async" />
                <span>
                  {a.width}×{a.height} · {a.format}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </Modal>
  );
}