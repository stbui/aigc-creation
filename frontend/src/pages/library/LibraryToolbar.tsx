import { RefreshCw, Smartphone, Upload } from 'lucide-react';

import { Button, Select } from './components';
import { KIND_OPTIONS, type Kind } from './constants';

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
  kind: Kind;
  capability: string;
  capabilityOptions: LibraryCapabilityOption[];
  uploading: boolean;
  onKindChange: (kind: Kind) => void;
  onCapabilityChange: (capability: string) => void;
  onRefresh: () => void;
  onMobileUpload: () => void;
  onUpload: () => void;
}

export function LibraryToolbar({
  loggedIn,
  kind,
  capability,
  capabilityOptions,
  uploading,
  onKindChange,
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
            value={kind}
            onChange={(next) => onKindChange(next as Kind)}
            options={KIND_OPTIONS}
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
            className="asset-library-button"
          />
          <Button
            icon={<RefreshCw className="size-3.5" />}
            className="asset-library-button"
            onClick={onRefresh}
          >
            刷新
          </Button>
          <Button
            icon={<Smartphone className="size-3.5" />}
            className="asset-library-button"
            onClick={onMobileUpload}
          >
            手机上传
          </Button>
          <Button
            type="primary"
            icon={<Upload className="size-3.5" />}
            className="asset-library-button asset-library-button-primary"
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
