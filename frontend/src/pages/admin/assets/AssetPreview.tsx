import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { ImageLightbox, type LightboxItem } from '~/components/ImageLightbox';
import type { AssetRow } from './constants';
import type { AssetStatus } from '../../../types/api';

/**
 * 素材大图预览。
 *
 * 灯箱里保留「下架 / 删除」两个动作：看图时最常发现违规素材，退回列表再操作
 * 会丢失当前浏览位置。删除仍需二次确认（由页面统一弹条）。
 */
export function AssetPreview({
  assets,
  items,
  index,
  statusBusyId,
  canHide,
  canDelete,
  onIndexChange,
  onClose,
  onToggleStatus,
  onDelete,
}: {
  assets: AssetRow[];
  items: LightboxItem[];
  index: number;
  statusBusyId: string | null;
  canHide: boolean;
  canDelete: boolean;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleStatus: (row: AssetRow, next: AssetStatus) => void;
  onDelete: (row: AssetRow) => void;
}) {
  const asset = assets[index];
  if (!asset) return null;

  return (
    <ImageLightbox
      items={items}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      ariaLabel="素材预览"
      renderActions={() => (
        <div className="img-viewer-actions">
          {canHide && (
            <button
              type="button"
              className="img-viewer-action"
              disabled={statusBusyId === asset.id}
              onClick={() => {
                onClose();
                onToggleStatus(asset, asset.status === 'visible' ? 'hidden' : 'visible');
              }}
            >
              {asset.status === 'visible' ? <EyeOff size={14} /> : <Eye size={14} />}
              {asset.status === 'visible' ? '下架' : '恢复'}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="img-viewer-action is-danger"
              onClick={() => onDelete(asset)}
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
        </div>
      )}
    />
  );
}
