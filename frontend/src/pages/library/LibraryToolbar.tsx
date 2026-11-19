import { RefreshCw, Smartphone, Upload } from 'lucide-react';

import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from './components';
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
            onValueChange={(next) => onAssetKindChange(next as AssetKind)}
          >
            <SelectTrigger
              aria-label={'来源筛选'}
              className={'asset-library-date-filter'}
            >
              <SelectValue placeholder={'请选择'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ASSET_KIND_OPTIONS.map((option) => (
                  <SelectItem key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={capability}
            onValueChange={(next) => onCapabilityChange(String(next))}
          >
            <SelectTrigger
              aria-label={'能力筛选'}
            >
              <SelectValue placeholder={'请选择'} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[
                  { value: 'all', label: '全部能力' },
                  ...capabilityOptions.map((item) => ({ value: item.id, label: item.name })),
                ].map((option) => (
                  <SelectItem key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            onClick={onRefresh}
          >
            {<RefreshCw className="size-3.5" />}
            刷新
          </Button>
          <Button
            onClick={onMobileUpload}
          >
            {<Smartphone className="size-3.5" />}
            手机上传
          </Button>
          <Button disabled={uploading}
            variant="default"
            onClick={onUpload}
          >
            <span className="state-spinner is-small" aria-hidden />
            上传素材
          </Button>
        </div>
      )}
    </header>
  );
}
