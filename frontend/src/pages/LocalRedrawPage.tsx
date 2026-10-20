import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { ExpandTextModal, ToolShell } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';

/**
 * 局部重绘 —— 1:1 复刻参考站 https://ijihua.cn/local-redraw。
 *
 * 实拍结构 (local-redraw-page):
 *   上传卡: * 上传图片 (从素材库导入 disabled / 手机上传 / 点击或拖拽图片到此处上传,
 *          "点击、拖拽或粘贴图片上传，最多 1 张")
 *   重绘区域卡: 参考站在画布上涂抹圈选, 本地以位置枚举代替 (后端 region 参数)
 *   描述卡: "这个区域改成什么？" textarea + 放大编辑
 *   高级设置: 比例 原比例 / 画质 1K (提交区汇总 chip)
 *   提交: 开始重绘 (消耗价由后端下发); 描述: 只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素
 *
 * 诚实披露: local_redraw 为 mock 能力 (依赖真实 inpainting 模型), 本地渲染以区域框 +
 * 描述文案占位, 参考图真实参与构图; 中文原文完整记录在任务参数中。
 */

const REGION_OPTIONS = [
  { value: 'center', label: '画面中心' },
  { value: 'top', label: '画面上方' },
  { value: 'bottom', label: '画面下方' },
  { value: 'left', label: '画面左侧' },
  { value: 'right', label: '画面右侧' },
  { value: 'full', label: '整图重绘' },
];

const REGION_LABEL: Record<string, string> = Object.fromEntries(REGION_OPTIONS.map((o) => [o.value, o.label]));

export function LocalRedrawPage() {
  const { submitting, result, run } = useToolTask({ capability: 'local_redraw', successMessage: '重绘结果已生成' });

  const [region, setRegion] = useState('center');
  const [prompt, setPrompt] = useState('');
  const [expandOpen, setExpandOpen] = useState(false);

  return (
    <ToolShell
      capability="local_redraw"
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      mockNote="本地演示：重绘结果为区域框 + 描述占位渲染（真实重绘需接入 AI 模型），原图会真实参与构图"
      emptyDesc="上传图片并框选区域、写下描述后，重绘结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={REGION_LABEL[region]}
      onSubmit={(inputs, settings) =>
        run(inputs, { region, prompt: prompt.trim(), ratio: settings.ratio, size: settings.resolution })
      }
    >
      <ToolCard title="重绘区域">
        <p className="tool-card-copy">参考站在画布上涂抹圈选，本地演示以位置枚举代替涂抹区域。</p>
        <div className="tool-select-row">
          {REGION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === region}
              className={`tool-region-chip${o.value === region ? ' active' : ''}`}
              onClick={() => setRegion(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </ToolCard>

      <ToolCard title="这个区域改成什么？">
        <div className="pk-desc-editor">
          <textarea
            rows={3}
            maxLength={1000}
            value={prompt}
            placeholder="例如：把包装盒改成哑光材质"
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="button" className="pk-desc-expand" aria-label="放大编辑描述" title="放大编辑" onClick={() => setExpandOpen(true)}>
            <Maximize2 size={14} />
          </button>
        </div>
      </ToolCard>

      <ExpandTextModal
        open={expandOpen}
        title="编辑重绘描述"
        value={prompt}
        maxLength={1000}
        placeholder="例如：把包装盒改成哑光材质"
        onChange={setPrompt}
        onClose={() => setExpandOpen(false)}
      />
    </ToolShell>
  );
}
