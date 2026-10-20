import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { PositionGrid, ToolCard } from '../components/ToolWidgets';

/**
 * 智能扩图 —— 1:1 复刻参考站 https://ijihua.cn/image-expand。
 *
 * 实拍结构 (smart-expand-page):
 *   上传卡: * 上传图片
 *   原图占比卡: 快捷按钮 100% / 80%(默认) / 60% / 50% + 自由输入 (placeholder 1-99%)
 *   原图位置卡: 3x3 九宫格 ↖↑↗ / ←⊙→ / ↙↓↘ (center 默认)
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即扩图 (消耗价由后端下发, 见 hooks/useCreditLabel); 提示行 "*确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 智能扩展画面尺寸，快速适配不同平台展示需求
 *
 * 诚实披露: expand 为 real 能力 —— 边缘延展 (clamp 采样) + 羽化过渡,
 * 非 AI 内容补全; 原图占比/位置真实参与构图。
 */

const QUICK_PERCENTS = [100, 80, 60, 50];

const POSITION_LABEL: Record<string, string> = {
  'top-left': '左上',
  top: '上',
  'top-right': '右上',
  left: '左',
  center: '居中',
  right: '右',
  'bottom-left': '左下',
  bottom: '下',
  'bottom-right': '右下',
};

export function ImageExpandPage() {
  const { submitting, result, run } = useToolTask({ capability: 'expand', successMessage: '扩图结果已生成' });

  const [occupy, setOccupy] = useState(80);
  const [occupyText, setOccupyText] = useState('');
  const [position, setPosition] = useState('center');

  const commitOccupy = (raw: string) => {
    setOccupyText(raw);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= 99) setOccupy(Math.round(n));
  };

  return (
    <ToolShell
      capability="expand"
      title="智能扩图"
      desc="智能扩展画面尺寸，快速适配不同平台展示需求"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即扩图"
      hint="*确认素材和参数后提交，右侧会展示生成结果。"
      emptyDesc="上传图片后，扩展构图的结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={`占比 ${occupy}% · ${POSITION_LABEL[position]}`}
      onSubmit={(inputs, settings) =>
        run(inputs, { occupy, position, ratio: settings.ratio, size: settings.resolution })
      }
    >
      <ToolCard title="原图占比">
        <div className="tool-select-row">
          {QUICK_PERCENTS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={p === occupy}
              className={`tool-region-chip${p === occupy ? ' active' : ''}`}
              onClick={() => {
                setOccupy(p);
                setOccupyText('');
              }}
            >
              {p}%
            </button>
          ))}
        </div>
        <label className="tool-percent-field">
          <span>自定义占比</span>
          <input
            value={occupyText}
            placeholder="1-99%"
            inputMode="numeric"
            onChange={(e) => commitOccupy(e.target.value.replace(/[^\d]/g, ''))}
          />
        </label>
      </ToolCard>

      <ToolCard title="原图位置">
        <PositionGrid value={position} onChange={setPosition} />
        <p className="tool-card-copy">原图在扩展画布中的位置；边缘由原图像素向外延展并做羽化过渡。</p>
      </ToolCard>
    </ToolShell>
  );
}
