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
    <div
      className="grid min-h-8 grid-cols-2 gap-0 rounded-[9px] bg-[var(--surface-4)] p-[3px]"
      role="tablist"
      aria-label="旋转模式"
    >
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          className={`h-auto min-w-0 cursor-pointer rounded-[7px] border-0 bg-transparent p-0 text-xs font-semibold ${
            tab === item.id
              ? 'bg-card text-brand shadow-[0_1px_4px_rgba(36,42,60,0.1)]'
              : 'text-[color:var(--tool-text-4)]'
          }`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
