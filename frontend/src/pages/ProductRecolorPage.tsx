import { useState } from 'react';
import { App } from 'antd';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import {
  ColorStudio,
  RECOLOR_COLOR_SWATCHES,
  isValidHexColor,
  normalizeHexColor,
} from '../components/ColorStudio';
import { ToolHistoryPane } from '../components/ToolHistoryPane';
import { ProductSourceResult, ProductSourceUploadPreview } from '../components/ProductSourcePreview';

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
 * 诚实披露: recolor 由真实图像模型完成换色，要求保持材质、高光与阴影。
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
  const { message } = App.useApp();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'recolor', successMessage: '换色结果已生成' });

  const [color, setColor] = useState('#FFFFFF');
  const [customColor, setCustomColor] = useState('#5546D8');
  const [sourceAspect, setSourceAspect] = useState<number>();
  const targetColor = color === 'custom' ? customColor : color;
  const customColorValid = isValidHexColor(customColor);

  const handleHistoryReuse = () => {
    setSourceAspect(undefined);
    setResult(null);
  };

  return (
    <ToolShell
      capability="recolor"
      pageClass="product-retouch-page product-recolor-page"
      title="商品换色"
      desc="一键生成商品多色效果，快速制作全SKU展示图"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      replaceUpload
      renderUploadPreview={(uploads, controls) => {
        const image = uploads[0];
        return image ? (
          <ProductSourceUploadPreview image={image} controls={controls} alt="待换色商品图" />
        ) : null;
      }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即换色"
      emptyVideo="/static/mp4/07_sphs.mp4"
      emptyDesc="上传图片并选择商品颜色后，结果将在此处展示"
      formValid={color !== 'custom' || customColorValid}
      submitting={submitting}
      result={result}
      resultTag={COLOR_LABEL[color] ?? targetColor}
      resultView="product-card"
      resultBadge="换色后"
      generatingAspect={sourceAspect}
      onSubmit={(inputs, settings) => {
        if (color === 'custom' && !customColorValid) {
          message.error('请输入有效的 HEX 颜色（如 #5546D8）');
          return Promise.resolve();
        }
        const nextSourceUrl = inputs[0]?.url ?? '';
        if (nextSourceUrl) {
          const image = new Image();
          image.onload = () => {
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setSourceAspect(image.naturalWidth / image.naturalHeight);
            }
          };
          image.src = nextSourceUrl;
        }
        const normalizedCustom = normalizeHexColor(customColor) ?? '';
        return run(inputs, {
          targetColor: color === 'custom' ? normalizedCustom : targetColor.trim(),
          customColor: normalizedCustom,
          ratio: settings.ratio,
          size: settings.resolution,
        });
      }}
      sourcePane={(images) => {
        const image = images[0];
        return image ? <ProductSourceResult image={image} alt="待换色商品图" /> : null;
      }}
      onHistoryReuse={handleHistoryReuse}
      trailingPane={
        <ToolHistoryPane capability="recolor" refreshKey={result?.url} emptyText="暂无换色记录" />
      }
    >
      <ToolCard title="商品颜色" className="background-color-card product-recolor-color-card">
        <ColorStudio
          options={RECOLOR_COLOR_SWATCHES}
          value={color}
          onChange={setColor}
          customColor={customColor}
          onCustomColor={setCustomColor}
          allowAlpha={false}
          clearLabel="无填充"
          onClear={() => setColor('#FFFFFF')}
          ariaLabel="商品颜色"
        />
      </ToolCard>
    </ToolShell>
  );
}
