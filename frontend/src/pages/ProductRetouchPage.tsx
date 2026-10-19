import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { ExpandTextModal, ToolShell } from '../components/ToolShell';
import { PillOptions, ToolCard } from '../components/ToolWidgets';

/**
 * 产品精修 —— 1:1 复刻参考站 https://ijihua.cn/product-retouch。
 *
 * 实拍结构 (product-retouch-page):
 *   上传卡: * 上传图片
 *   精修模式卡 (retouch-mode-options): 6 项单选 pill, 默认"综合精修" ——
 *     综合精修 / 质感增强 / 瑕疵修复 / 色彩校正 / 提升清晰度 / 材质强化
 *   补充要求卡: textarea, placeholder "如：去掉电镀件上的指纹，让皮革看起来更有光泽", maxlength 200
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即生成 本次消耗5积分; 描述: 商品图去瑕疵，提高清晰度
 *
 * 诚实披露: enhance 为 real 能力 —— 6 模式各自映射真实像素管线
 * (亮度/对比度/饱和度/模糊去噪/unsharp 锐化), 补充要求中文原文记录于任务参数。
 */

const MODE_OPTIONS = [
  { value: 'comprehensive', label: '综合精修' },
  { value: 'texture', label: '质感增强' },
  { value: 'blemish', label: '瑕疵修复' },
  { value: 'color', label: '色彩校正' },
  { value: 'clarity', label: '提升清晰度' },
  { value: 'material', label: '材质强化' },
];

const MODE_LABEL: Record<string, string> = Object.fromEntries(MODE_OPTIONS.map((o) => [o.value, o.label]));

export function ProductRetouchPage() {
  const { submitting, result, run } = useToolTask({ capability: 'enhance', successMessage: '精修结果已生成' });

  const [mode, setMode] = useState('comprehensive');
  const [note, setNote] = useState('');
  const [expandOpen, setExpandOpen] = useState(false);

  return (
    <ToolShell
      capability="enhance"
      title="产品精修"
      desc="商品图去瑕疵，提高清晰度"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即生成"
      creditLabel="本次消耗5积分"
      emptyDesc="上传图片并选择精修模式后，结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={MODE_LABEL[mode]}
      onSubmit={(inputs, settings) =>
        run(inputs, { mode, note: note.trim(), ratio: settings.ratio, size: settings.resolution })
      }
    >
      <ToolCard title="精修模式">
        <PillOptions options={MODE_OPTIONS} value={mode} onChange={setMode} ariaLabel="精修模式" />
      </ToolCard>

      <ToolCard title="补充要求（选填）">
        <div className="pk-desc-editor">
          <textarea
            rows={3}
            maxLength={200}
            value={note}
            placeholder="如：去掉电镀件上的指纹，让皮革看起来更有光泽"
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className="pk-desc-expand" aria-label="放大编辑补充要求" title="放大编辑" onClick={() => setExpandOpen(true)}>
            <Maximize2 size={14} />
          </button>
        </div>
      </ToolCard>

      <ExpandTextModal
        open={expandOpen}
        title="编辑补充要求"
        value={note}
        maxLength={200}
        placeholder="如：去掉电镀件上的指纹，让皮革看起来更有光泽"
        onChange={setNote}
        onClose={() => setExpandOpen(false)}
      />
    </ToolShell>
  );
}
