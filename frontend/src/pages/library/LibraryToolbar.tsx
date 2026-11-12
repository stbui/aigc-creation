import { RefreshCw, Smartphone, Upload } from 'lucide-react';

import { Button, Select } from './components';
import { ASSET_KIND_OPTIONS, type AssetKind } from './constants';

/**
 * 素材库页头与筛选工具条。
 *
 * 来源 / 能力两个筛选器 + 刷新 / 手机上传 / 上传素材三个动作。
 * 访客只看到标题，动作区整体隐藏（登录入口由空态卡承担）。
 */

export interface LibraryCapabilityOption {
  id: string;
  name: string;
}

export interface LibraryToolbarProps {
  loggedIn: boolean;
  assetKind: AssetKind;
  capability: string;
  capabilityOptions: LibraryCapabilityOption[];
  uploading: boolean;
  onAssetKindChange: (assetKind: AssetKind) => void;
  onCapabilityChange: (capability: string) => void;
  onRefresh: () => void;
  onMobileUpload: () => void;
  onUpload: () => void;
}

export function LibraryToolbar({
  loggedIn,
  assetKind,
  capability,
  capabilityOptions,
  uploading,
  onAssetKindChange,
  onCapabilityChange,
  onRefresh,
  onMobileUpload,
  onUpload,
}: LibraryToolbarProps) {
  return (
    <header className="asset-library-header">
      <div>
        <h1 className="asset-library-title">素材库</h1>
      </div>
      {loggedIn && (
        <div className="asset-library-header-actions">
          <Select
            value={assetKind}
            onChange={(next) => onAssetKindChange(next as AssetKind)}
            options={ASSET_KIND_OPTIONS}
            aria-label="来源筛选"
            className="asset-library-date-filter"
          />
          <Select
            value={capability}
            onChange={(next) => onCapabilityChange(String(next))}
            options={[
              { value: 'all', label: '全部能力' },
              ...capabilityOptions.map((item) => ({ value: item.id, label: item.name })),
            ]}
            aria-label="能力筛选"
          />
          <Button
            icon={<RefreshCw className="size-3.5" />}
            onClick={onRefresh}
          >
            刷新
          </Button>
          <Button
            icon={<Smartphone className="size-3.5" />}
            onClick={onMobileUpload}
          >
            手机上传
          </Button>
          <Button
            type="primary"
            icon={<Upload className="size-3.5" />}
            loading={uploading}
            onClick={onUpload}
          >
            上传素材
          </Button>
        </div>
      )}
    </header>
  );
}
