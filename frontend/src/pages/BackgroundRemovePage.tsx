import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { BG_COLOR_SWATCHES, ColorSwatchGrid, CustomColorInput, ToolCard } from '../components/ToolWidgets';

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
 * 诚实披露: matting 为 real 能力 —— 四角采样估计底色 + 距离阈值抠除 (本地算法),
 * 非 AI 语义分割; 换底色为真实像素合成。
 */

const COLOR_LABEL: Record<string, string> = {
  transparent: '透明底',
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
  custom: '自定义',
};

export function BackgroundRemovePage() {
  const { submitting, result, run } = useToolTask({ capability: 'matting', successMessage: '抠图结果已生成' });

  const [bgColor, setBgColor] = useState('transparent');
  const [customColor, setCustomColor] = useState('#8064F6');

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
      resultTag={COLOR_LABEL[bgColor] ?? bgColor}
      onSubmit={(inputs, settings) =>
        run(inputs, { bgColor, customColor: customColor.trim(), ratio: settings.ratio })
      }
    >
      <ToolCard title="背景颜色">
        <ColorSwatchGrid
          options={BG_COLOR_SWATCHES}
          value={bgColor}
          onChange={setBgColor}
          onCustom={() => setBgColor('custom')}
          customActive={bgColor === 'custom'}
          ariaLabel="背景颜色"
        />
        {bgColor === 'custom' && <CustomColorInput value={customColor} onChange={setCustomColor} label="自定义背景色（HEX）" />}
        <p className="tool-card-copy">本地为四角采样估计底色的阈值抠除（非 AI 语义分割），换底色为真实像素合成。</p>
      </ToolCard>
    </ToolShell>
  );
}
