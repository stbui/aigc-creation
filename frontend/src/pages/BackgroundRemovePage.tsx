import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import { ColorStudio, MATTING_COLOR_SWATCHES } from '../components/ColorStudio';
import { MattingResultEditor } from '../components/MattingResultEditor';
import { ToolHistoryPane } from '../components/ToolHistoryPane';

/**
 * 一键抠图 —— 1:1 复刻参考站 https://ijihua.cn/background-remove。
 *
 * 实拍结构 (background-remove-page):
 *   上传卡: * 上传图片 (同 local-redraw 共享 dropzone 样式)
 *   背景颜色卡 (background-color-card): 7 项色板 ——
 *     透明底(棋盘格, 默认) / 白色 / 浅蓝 #82CEF3 / 蓝色 #3988E9 /
 *     红色 #FF0B22 / 深红 #A8001B / 自定义颜色 (调色盘图标 + HEX 输入)
 *   高级设置: 仅"比例 原比例" (参考站该页无画质档位, 输出保持输入分辨率)
 *   提交: 开始抠图 (creditCost=0, 即「限时免费」的价格语义); 描述: 上传图片后，自动去除图片背景
 *
 * 诚实披露: matting 由真实图像模型完成主体分割与背景替换；
 * 抠图边缘质量取决于当前模型通道能力。
 */

const COLOR_LABEL: Record<string, string> = {
  transparent: '透明底',
  white: '白色',
  'light-blue': '浅蓝',
  blue: '蓝色',
  red: '红色',
  'dark-red': '深红',
  custom: '自定义',
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
};

export function BackgroundRemovePage() {
  const { submitting, result, run } = useToolTask({ capability: 'matting', successMessage: '抠图结果已生成' });

  const [selectedColor, setSelectedColor] = useState('transparent');
  const [customColor, setCustomColor] = useState('#5546D8');
  const [customAlpha, setCustomAlpha] = useState(100);
  /*
   * 结果编辑器需要原图做对比；提交时记录本次实际输入与比例，避免用户随后
   * 换图/改设置时把旧结果和新素材拼在一起。比例变更通过 ToolShell 回调实时同步。
   */
  const [sourceUrl, setSourceUrl] = useState('');
  const [outputRatio, setOutputRatio] = useState('original');

  const colorLabel =
    selectedColor === 'custom'
      ? `自定义 ${customColor}${customAlpha < 100 ? ` · ${customAlpha}%` : ''}`
      : (COLOR_LABEL[selectedColor] ?? selectedColor);

  return (
    <ToolShell
      capability="matting"
      title="一键抠图"
      desc="上传图片后，自动去除图片背景"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true }}
      submitLabel="开始抠图"
      emptyDesc="上传图片后，抠除背景的结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={colorLabel}
      onSettingsChange={(settings) => setOutputRatio(settings.ratio)}
      onSubmit={async (inputs, settings) => {
        setSourceUrl(inputs[0]?.url ?? '');
        setOutputRatio(settings.ratio);
        await run(inputs, {
          selectedColor,
          customColor: customColor.trim(),
          customAlpha,
          ratio: settings.ratio,
          resolution: settings.resolution,
        });
      }}
      resultPane={
        result?.status === 'succeeded' && result.url && sourceUrl ? (
          <section className="pk-result-pane pk-result-pane-editor">
            <MattingResultEditor
              resultUrl={result.url}
              originalUrl={sourceUrl}
              selectedColor={selectedColor}
              customColor={customColor}
              customAlpha={customAlpha}
              outputRatio={outputRatio}
            />
          </section>
        ) : undefined
      }
      trailingPane={
        <ToolHistoryPane capability="matting" refreshKey={result?.url} emptyText="暂无抠图记录" />
      }
    >
      <ToolCard title="背景颜色">
        <ColorStudio
          options={MATTING_COLOR_SWATCHES}
          value={selectedColor}
          onChange={setSelectedColor}
          customColor={customColor}
          onCustomColor={setCustomColor}
          customAlpha={customAlpha}
          onCustomAlpha={setCustomAlpha}
          onClear={() => setSelectedColor('transparent')}
          clearLabel="透明底"
          ariaLabel="背景颜色"
        />
        <p className="tool-card-copy">由图像模型完成主体分割与换底，边缘效果取决于当前模型能力。</p>
      </ToolCard>
    </ToolShell>
  );
}
