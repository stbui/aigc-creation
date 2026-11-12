import { useState } from 'react';
import { Plus } from 'lucide-react';

import { BackgroundSourcePreview } from './BackgroundSourcePreview';
import { BackgroundRemoveIntro } from './BackgroundRemoveIntro';
import { BackgroundRemoveUploadPreview } from './BackgroundRemoveUploadPreview';
import { BackgroundResultPane } from './BackgroundResultPane';
import { ColorStudio, ToolCard, ToolShell } from './components';
import { DEFAULT_CUSTOM_COLOR, MATTING_COLOR_SWATCHES } from './constants';
import { useApp, useCreditCost, useToolTask } from './hooks';
import { colorLabelOf, isValidHexColor, normalizeHexColor } from './utils';

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
 *
 * 板块拆分见 `docs/frontend-module-conventions.md`：上传预览
 * `BackgroundRemoveUploadPreview`、空态 `BackgroundRemoveIntro`、结果面板
 * `BackgroundResultPane`；颜色状态与提交仍留在 `page.tsx`。
 */
export function BackgroundRemovePage() {
  const { message } = useApp();
  const { submitting, result, run } = useToolTask({ capability: 'matting', successMessage: '抠图结果已生成' });

  const [selectedColor, setSelectedColor] = useState('transparent');
  const [customColor, setCustomColor] = useState(DEFAULT_CUSTOM_COLOR);
  const [customAlpha, setCustomAlpha] = useState(100);
  /*
   * 结果编辑器需要原图做对比；提交时记录本次实际输入与比例，避免用户随后
   * 换图/改设置时把旧结果和新素材拼在一起。比例变更通过 ToolShell 回调实时同步。
   */
  const [sourceUrl, setSourceUrl] = useState('');
  const [outputRatio, setOutputRatio] = useState('original');
  const creditCost = useCreditCost('matting');
  const customColorValid = isValidHexColor(customColor);

  const colorLabel = colorLabelOf(selectedColor, customColor, customAlpha);

  return (
    <ToolShell
      capability="matting"
      pageClass="background-remove-page"
      title="一键抠图"
      desc="上传图片后，自动去除图片背景"
      upload={{
        title: '上传图片',
        required: true,
        max: 1,
        hint: '点击、拖拽或粘贴图片上传，最多 1 张',
        promptIcon: <Plus size={22} />,
      }}
      replaceUpload
      renderUploadPreview={(uploads, controls) => {
        const image = uploads[0];
        if (!image) return null;
        return (
          <BackgroundRemoveUploadPreview
            image={image}
            uploading={controls.uploading}
            onPreview={() => controls.preview(image)}
            onOpen={controls.open}
          />
        );
      }}
      settings={{ ratio: true }}
      submitLabel="开始抠图"
      creditLabel={creditCost === 0 ? '限时免费' : undefined}
      emptyDesc="上传图片后，抠除背景的结果将在此处展示"
      formValid={selectedColor !== 'custom' || customColorValid}
      submitting={submitting}
      result={result}
      resultTag={colorLabel}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) return <BackgroundRemoveIntro />;
        return (
          <div className="background-remove-stage background-remove-source-stage">
            <BackgroundSourcePreview key={image.url} image={image} />
          </div>
        );
      }}
      onSettingsChange={(settings) => setOutputRatio(settings.ratio)}
      onSubmit={async (inputs, settings) => {
        if (selectedColor === 'custom' && !customColorValid) {
          message.error('请输入有效的 HEX 背景色（如 #5546D8）');
          return;
        }
        setSourceUrl(inputs[0]?.url ?? '');
        setOutputRatio(settings.ratio);
        await run(inputs, {
          selectedColor,
          customColor: normalizeHexColor(customColor) ?? '',
          customAlpha,
          ratio: settings.ratio,
          resolution: settings.resolution,
        });
      }}
      resultPane={
        result?.status === 'succeeded' && result.url && sourceUrl ? (
          <BackgroundResultPane
            resultUrl={result.url}
            originalUrl={sourceUrl}
            selectedColor={selectedColor}
            customColor={customColor}
            customAlpha={customAlpha}
            outputRatio={outputRatio}
          />
        ) : undefined
      }
    >
      <ToolCard title="背景颜色" className="background-color-card">
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
      </ToolCard>
    </ToolShell>
  );
}
