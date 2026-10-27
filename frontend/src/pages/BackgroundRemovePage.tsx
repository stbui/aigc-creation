import { type CSSProperties, useState } from 'react';
import { App } from 'antd';
import { Plus } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';
import {
  ColorStudio,
  MATTING_COLOR_SWATCHES,
  isValidHexColor,
  normalizeHexColor,
} from '../components/ColorStudio';
import { MattingResultEditor } from '../components/MattingResultEditor';
import { useCreditCost } from '../hooks/useCreditLabel';

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

function BackgroundSourcePreview({ image }: { image: ToolAsset }) {
  const [aspect, setAspect] = useState(1.6);

  return (
    <div
      className="background-remove-preview background-remove-source-preview"
      style={{ '--source-aspect': aspect } as CSSProperties}
    >
      <img
        src={image.url}
        alt={`${image.name} 原图预览`}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) setAspect(naturalWidth / naturalHeight);
        }}
      />
    </div>
  );
}

export function BackgroundRemovePage() {
  const { message } = App.useApp();
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
  const creditCost = useCreditCost('matting');
  const customColorValid = isValidHexColor(customColor);

  const colorLabel =
    selectedColor === 'custom'
      ? `自定义 ${customColor}${customAlpha < 100 ? ` · ${customAlpha}%` : ''}`
      : (COLOR_LABEL[selectedColor] ?? selectedColor);

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
          <div className={`background-source-row${controls.uploading ? ' processing' : ''}`}>
            <button
              type="button"
              className="background-source-preview"
              aria-label="预览待处理图片"
              onClick={() => controls.preview(image)}
            >
              <img src={image.url} alt="待处理图片" draggable={false} />
            </button>
            <button
              type="button"
              className="background-source-reupload"
              disabled={controls.uploading}
              onClick={controls.open}
            >
              重新上传
            </button>
          </div>
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
        if (!image) {
          return (
            <div className="background-remove-stage" aria-label="一键抠图介绍">
              <div className="background-remove-empty">
                <video
                  src="/static/mp4/background-remove.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  aria-label="一键抠图演示"
                />
                <strong>一键抠图</strong>
                <p>上传图片后，自动去除图片背景</p>
              </div>
            </div>
          );
        }
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
