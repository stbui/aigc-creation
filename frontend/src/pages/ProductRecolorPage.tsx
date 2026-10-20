import { useState } from 'react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { BG_COLOR_SWATCHES, ColorSwatchGrid, CustomColorInput, ToolCard } from '../components/ToolWidgets';

/**
 * 商品换色 —— 1:1 复刻参考站 https://ijihua.cn/product-recolor。
 *
 * 实拍结构 (product-recolor-page):
 *   上传卡: * 上传图片
 *   商品颜色卡 (product-recolor-color-card): 复用 background-color-options 组件 ——
 *     白色(默认, 选中带勾) / 浅蓝 #82CEF3 / 蓝色 #3988E9 / 红色 #FF0B22 /
 *     深红 #A8001B / 自定义颜色 (调色盘图标)
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即换色 (消耗价由后端下发); 提示行 "* 确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 一键生成商品多色效果，快速制作全SKU展示图
 *
 * 诚实披露: recolor 为 real 能力 —— 估计商品主体色后按明度比例替换为目标色,
 * 高光/阴影层次保留 (本地算法, 非 AI)。
 */

const COLOR_LABEL: Record<string, string> = {
  '#FFFFFF': '白色',
  '#82CEF3': '浅蓝',
  '#3988E9': '蓝色',
  '#FF0B22': '红色',
  '#A8001B': '深红',
  custom: '自定义',
};

export function ProductRecolorPage() {
  const { submitting, result, run } = useToolTask({ capability: 'recolor', successMessage: '换色结果已生成' });

  const [color, setColor] = useState('#FFFFFF');
  const [customColor, setCustomColor] = useState('#8064F6');

  return (
    <ToolShell
      capability="recolor"
      title="商品换色"
      desc="一键生成商品多色效果，快速制作全SKU展示图"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即换色"
      hint="* 确认素材和参数后提交，右侧会展示生成结果。"
      emptyDesc="上传图片并选择商品颜色后，结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={COLOR_LABEL[color] ?? color}
      onSubmit={(inputs, settings) =>
        run(inputs, { color, customColor: customColor.trim(), ratio: settings.ratio, size: settings.resolution })
      }
    >
      <ToolCard title="商品颜色">
        <ColorSwatchGrid
          options={BG_COLOR_SWATCHES.slice(1)}
          value={color}
          onChange={setColor}
          onCustom={() => setColor('custom')}
          customActive={color === 'custom'}
          ariaLabel="商品颜色"
        />
        {color === 'custom' && <CustomColorInput value={customColor} onChange={setCustomColor} label="自定义颜色（HEX）" />}
        <p className="tool-card-copy">本地算法：估计商品主体色后按明度比例替换，高光与阴影层次保留。</p>
      </ToolCard>
    </ToolShell>
  );
}
