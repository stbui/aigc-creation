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
    <header className="mb-[22px] flex items-end justify-between gap-6 max-[720px]:mb-[17px] max-[720px]:items-start max-[700px]:flex-col max-[700px]:items-stretch max-[640px]:gap-3">
      <div>
        <h1 className="m-0 text-[28px] leading-10 font-bold text-foreground max-[720px]:text-2xl max-[720px]:leading-[34px]">
          素材库
        </h1>
      </div>
      {loggedIn && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Select
            value={assetKind}
            onValueChange={(next) => onAssetKindChange(next as AssetKind)}
          >
            <SelectTrigger
              aria-label={'来源筛选'}
              className="gap-1.5 px-[11px] text-muted-foreground hover:border-brand hover:bg-brand-bg hover:text-brand-hover"
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
            {uploading && <span className="state-spinner is-small" aria-hidden />}
            上传素材
          </Button>
        </div>
      )}
    </header>
  );
}
