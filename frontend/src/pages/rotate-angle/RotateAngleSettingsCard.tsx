import { Info, RotateCcw } from 'lucide-react';

import {
  PITCH_MAX,
  PITCH_MIN,
  YAW_MAX,
  YAW_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  type RotateTab,
} from './constants';
import { RangeRow } from './components';
import { RotateAngleModeTabs } from './RotateAngleModeTabs';
import { RotateAnglePreview } from './RotateAnglePreview';

interface RotateAngleSettingsCardProps {
  tab: RotateTab;
  onTabChange: (tab: RotateTab) => void;
  yaw: number;
  pitch: number;
  zoom: number;
  /** 已上传图片地址；null 时预览显示方位占位 */
  previewImage: string | null;
  onYawChange: (value: number) => void;
  onPitchChange: (value: number) => void;
  onZoomChange: (value: number) => void;
  onReset: () => void;
}

/**
 * 旋转角度设置卡：卡头重置、模式页签、可拖拽预览、三滑杆与说明。
 *
 * 角度状态与提交仍留在 `page.tsx`，本组件只负责把设置区的板块拼起来；
 * 滑杆区间与步进来自 `constants.ts`，确保拖拽 / 方向键 / 滑杆同一口径。
 */
export function RotateAngleSettingsCard({
  tab,
  onTabChange,
  yaw,
  pitch,
  zoom,
  previewImage,
  onYawChange,
  onPitchChange,
  onZoomChange,
  onReset,
}: RotateAngleSettingsCardProps) {
  return (
    <section className="local-redraw-card rotate-angle-settings">
      <div className="rotate-angle-settings-head">
        <h2>旋转角度</h2>
        <button type="button" aria-label="重置参数" title="重置参数" onClick={onReset}>
          <RotateCcw size={16} />
        </button>
      </div>

      <RotateAngleModeTabs tab={tab} onChange={onTabChange} />

      <RotateAnglePreview
        tab={tab}
        yaw={yaw}
        pitch={pitch}
        zoom={zoom}
        previewImage={previewImage}
        onYawChange={onYawChange}
        onPitchChange={onPitchChange}
      />

      <RangeRow label="旋转" min={YAW_MIN} max={YAW_MAX} step={1} value={yaw} onChange={onYawChange} />
      <RangeRow
        label="倾斜"
        min={PITCH_MIN}
        max={PITCH_MAX}
        step={1}
        value={pitch}
        onChange={onPitchChange}
      />
      <RangeRow
        label="缩放"
        display={zoom === 1 ? '特写' : zoom.toFixed(2)}
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoom}
        onChange={onZoomChange}
      />

      <p className="rotate-angle-tip">
        <Info size={13} />
        <span>相机保持静止，生成时按主体旋转角度重建商品展示。</span>
      </p>
    </section>
  );
}
