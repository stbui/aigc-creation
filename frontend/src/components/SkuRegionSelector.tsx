import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { App } from 'antd';
import { RotateCcw, X } from 'lucide-react';

/** 归一化坐标 (0~1)，与模板图原始像素尺寸无关。 */
export interface SkuRegionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  url: string;
  alt?: string;
  regions: SkuRegionBox[];
  max?: number;
  onChange: (regions: SkuRegionBox[]) => void;
}

interface DraftBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const MIN_SIZE = 0.025;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeDraft(draft: DraftBox): SkuRegionBox {
  const x1 = Math.min(draft.startX, draft.currentX);
  const y1 = Math.min(draft.startY, draft.currentY);
  const x2 = Math.max(draft.startX, draft.currentX);
  const y2 = Math.max(draft.startY, draft.currentY);
  return {
    x: round4(clamp01(x1)),
    y: round4(clamp01(y1)),
    width: round4(clamp01(x2 - x1)),
    height: round4(clamp01(y2 - y1)),
  };
}

export function SkuRegionSelector({ url, alt = 'SKU 模板图', regions, max = 3, onChange }: Props) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<DraftBox | null>(null);
  const draftRef = useRef<DraftBox | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const pointOf = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / Math.max(rect.width, 1)),
      y: clamp01((e.clientY - rect.top) / Math.max(rect.height, 1)),
    };
  };

  const setDraftBox = (next: DraftBox | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const startDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (regions.length >= max) {
      message.warning(`最多框选 ${max} 个变体区域`);
      return;
    }
    const p = pointOf(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerIdRef.current = e.pointerId;
    setDraftBox({ startX: p.x, startY: p.y, currentX: p.x, currentY: p.y });
  };

  const moveDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const current = draftRef.current;
    if (!current) return;
    const p = pointOf(e);
    setDraftBox({ ...current, currentX: p.x, currentY: p.y });
  };

  const finishDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const current = draftRef.current;
    setDraftBox(null);
    if (!current) return;
    const box = normalizeDraft(current);
    if (box.width < MIN_SIZE || box.height < MIN_SIZE) {
      message.warning('框选区域太小，请拖拽出更大的范围');
      return;
    }
    onChange([...regions, box]);
  };

  const cancelDraw = () => {
    pointerIdRef.current = null;
    setDraftBox(null);
  };

  const removeRegion = (index: number) => {
    onChange(regions.filter((_, i) => i !== index));
  };

  const draftBox = draft ? normalizeDraft(draft) : null;

  return (
    <div className="product-sku-region-selector">
      <div className="product-sku-region-toolbar">
        <span className="product-sku-region-count">
          变体区域 <strong>{regions.length}</strong> / {max}
        </span>
        <button
          type="button"
          className="pk-text-link product-sku-region-clear"
          disabled={regions.length === 0}
          onClick={() => onChange([])}
        >
          <RotateCcw size={12} />
          清空框选
        </button>
      </div>

      <div
        className={`product-sku-region-stage${regions.length >= max ? ' is-limit' : ''}`}
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={finishDraw}
        onPointerCancel={cancelDraw}
        aria-label="在模板图上拖拽框选 SKU 变体区域"
      >
        <img src={url} alt={alt} draggable={false} />
        {regions.map((region, index) => (
          <div
            key={`${index}-${region.x}-${region.y}-${region.width}-${region.height}`}
            className="product-sku-region-box"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          >
            <span>区域 {index + 1}</span>
            <button
              type="button"
              className="product-sku-region-remove"
              aria-label={`删除区域 ${index + 1}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                removeRegion(index);
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {draftBox && (
          <div
            className="product-sku-region-box is-draft"
            style={{
              left: `${draftBox.x * 100}%`,
              top: `${draftBox.y * 100}%`,
              width: `${draftBox.width * 100}%`,
              height: `${draftBox.height * 100}%`,
            }}
          >
            <span>释放完成框选</span>
          </div>
        )}
        {regions.length === 0 && !draft && (
          <span className="product-sku-region-empty-hint">在图片上拖拽框选变体区域</span>
        )}
      </div>

      <p className="product-sku-region-hint">
        框选要跟随 SKU 变化的位置，最多 3 个；框选坐标会随任务提交，框外保持模板不变。
      </p>
    </div>
  );
}
