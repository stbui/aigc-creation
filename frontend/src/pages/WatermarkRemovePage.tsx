import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';

/**
 * 去除水印 —— 1:1 复刻参考站 https://ijihua.cn/watermark-remove。
 *
 * 实拍结构 (watermark-removal-page, 全站最简工具页):
 *   上传卡: * 上传图片 (同款 dropzone)
 *   无高级设置 (提交区只有主按钮)
 *   提交: 开始去除 (creditCost=0, 即「限时免费」的价格语义); 描述: 框选、圈选或涂抹水印区域，即可去除图片中的水印
 *
 * 处理方式卡: 参考站上传后提供框选/圈选/涂抹画布操作, 本地以
 * "处理方式 (自动识别/指定区域) + 区域位置 (五宫格)" 枚举代替。
 *
 * 诚实披露: remove_watermark 为 mock 能力 (依赖真实 inpainting 模型),
 * 本地以区域模糊修补占位; 请仅处理你拥有版权或已获授权的图片。
 */

const MODE_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'region', label: '指定区域' },
];

const REGION_OPTIONS = [
  { value: 'bottom_right', label: '右下角' },
  { value: 'bottom_left', label: '左下角' },
  { value: 'top_right', label: '右上角' },
  { value: 'top_left', label: '左上角' },
  { value: 'center', label: '画面中央' },
];

export function WatermarkRemovePage() {
  const { submitting, result, run } = useToolTask({ capability: 'remove_watermark', successMessage: '处理结果已生成' });

  const [mode, setMode] = useState('auto');
  const [region, setRegion] = useState('bottom_right');

  return (
    <ToolShell
      capability="remove_watermark"
      title="去除水印"
      desc="框选、圈选或涂抹水印区域，即可去除图片中的水印"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      submitLabel="开始去除"
      mockNote="本地演示：以指定区域模糊修补占位（真实去水印需接入 AI 模型）"
      emptyDesc="上传图片后，处理结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={mode === 'auto' ? '自动识别' : REGION_OPTIONS.find((o) => o.value === region)?.label}
      onSubmit={(inputs) => run(inputs, { mode, region })}
    >
      <ToolCard title="处理方式">
        <div className="tool-select-row">
          {MODE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === mode}
              className={`tool-region-chip${o.value === mode ? ' active' : ''}`}
              onClick={() => setMode(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {mode === 'region' && (
          <label className="tool-select-field">
            <span>区域位置</span>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="tool-card-copy">请仅处理你拥有版权或已获授权的图片。</p>
      </ToolCard>
    </ToolShell>
  );
}
