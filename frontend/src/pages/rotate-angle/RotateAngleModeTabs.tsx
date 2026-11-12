import type { RotateTab } from './constants';

interface RotateAngleModeTabsProps {
  tab: RotateTab;
  onChange: (tab: RotateTab) => void;
}

/** 模式页签的展示顺序固定为主体在前、摄像头在后。 */
const TABS: ReadonlyArray<{ id: RotateTab; label: string }> = [
  { id: 'subject', label: '主体' },
  { id: 'camera', label: '摄像头' },
];

/** 旋转模式页签：主体为立方体拖拽，摄像头为轨道与方向键。 */
export function RotateAngleModeTabs({ tab, onChange }: RotateAngleModeTabsProps) {
  return (
    <div className="rotate-angle-tabs" role="tablist" aria-label="旋转模式">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          className={tab === item.id ? 'active' : ''}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
