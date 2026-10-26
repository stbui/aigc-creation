import { useState } from 'react';
import { App } from 'antd';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { PositionGrid } from '../components/ToolWidgets';
import { ToolHistoryPane } from '../components/ToolHistoryPane';
import { ExpandLayoutPreview } from '../components/ExpandLayoutPreview';
import { computeExpandPlacement, loadImageSize } from '../lib/expandGeometry';

/**
 * 智能扩图 —— 1:1 复刻参考站 https://ijihua.cn/image-expand。
 *
 * 实拍结构 (smart-expand-page):
 *   上传卡: * 上传图片
 *   原图占比卡: 快捷按钮 100% / 80%(默认) / 60% / 50% + 自由输入 (placeholder 1-100%)
 *   原图位置卡: 3x3 九宫格 ↖↑↗ / ←⊙→ / ↙↓↘ (center 默认)
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即扩图 (消耗价由后端下发, 见 hooks/useCreditLabel); 提示行 "*确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 智能扩展画面尺寸，快速适配不同平台展示需求
 *
 * 诚实披露: expand 只走真实图像模型；本地仅按原图尺寸计算 placement 元数据，
 * 不采样边缘、不合成像素，无模型通道时会明确失败而不是产出伪扩图。
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
  const { message } = App.useApp();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'expand', successMessage: '扩图结果已生成' });

  const [occupy, setOccupy] = useState(80);
  const [occupyText, setOccupyText] = useState('');
  const [position, setPosition] = useState('center');
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewRatio, setPreviewRatio] = useState('original');
  const [preparing, setPreparing] = useState(false);

  const customOccupy = Number(occupyText);
  const occupyValid =
    occupyText === '' || (Number.isInteger(customOccupy) && customOccupy >= 1 && customOccupy <= 100);
  /**
   * 提交与预览都用这个值：自定义输入合法时立即生效，不必等失焦；
   * 非法输入不覆盖上一次有效档位（同时 formValid 会拦住提交）。
   */
  const effectiveOccupy =
    occupyText !== '' && Number.isInteger(customOccupy) && customOccupy >= 1 && customOccupy <= 100
      ? customOccupy
      : occupy;

  const handleHistoryReuse = () => {
    setSourceUrl('');
    setResult(null);
  };

  /**
   * 输入框只负责文本，不把每个中间态写进 occupy。
   *
   * 否则用户从 80 改成 35 时，先输入的 "3" 会立刻成为有效占比，预览与
   * 结果标签会闪一次 3%；失焦或提交时再提交完整的合法值。
   */
  const commitOccupy = () => {
    const n = Number(occupyText);
    if (Number.isInteger(n) && n >= 1 && n <= 100) {
      setOccupy(n);
      setOccupyText('');
    }
  };

  return (
    <ToolShell
      capability="expand"
      pageClass="product-retouch-page smart-expand-page"
      title="智能扩图"
      desc="智能扩展画面尺寸，快速适配不同平台展示需求"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即扩图"
      emptyDesc="上传图片后，扩展构图的结果将在此处展示"
      formValid={!preparing && occupyValid}
      submitting={submitting}
      result={result}
      resultTag={`占比 ${effectiveOccupy}% · ${POSITION_LABEL[position]}`}
      resultCompare={
        result?.status === 'succeeded' && result.url && sourceUrl
          ? { beforeUrl: sourceUrl, beforeLabel: '原图', afterLabel: '扩图后' }
          : undefined
      }
      onSubmit={async (inputs, settings) => {
        if (!occupyValid) {
          message.error('原图占比需为 1-100% 的整数');
          return;
        }
        setSourceUrl(inputs[0]?.url ?? '');
        setPreparing(true);
        try {
          const size = await loadImageSize(inputs[0]?.url ?? '');
          const placement = computeExpandPlacement(
            size.width,
            size.height,
            settings.ratio,
            effectiveOccupy,
            position,
          );
          await run(inputs, {
            occupy: effectiveOccupy,
            position,
            ...placement,
            ...(settings.ratio !== 'original' ? { targetImageRatio: settings.ratio } : {}),
            ratio: settings.ratio,
            size: settings.resolution,
          });
        } catch (e) {
          message.error((e as Error).message || '扩图参数计算失败，请重试');
        } finally {
          setPreparing(false);
        }
      }}
      onHistoryReuse={handleHistoryReuse}
      sourcePane={(images) => {
        const image = images[0];
        if (!image) return null;
        return (
          <div className="smart-expand-preview-stage">
            <ExpandLayoutPreview
              sourceUrl={image.url}
              ratio={previewRatio}
              occupy={effectiveOccupy}
              position={position}
            />
            <p className="smart-expand-preview-caption">
              原图 {effectiveOccupy}% · {POSITION_LABEL[position]} · {previewRatio === 'original' ? '原比例' : previewRatio}
            </p>
          </div>
        );
      }}
      onSettingsChange={(settings) => setPreviewRatio(settings.ratio)}
      trailingPane={
        <ToolHistoryPane capability="expand" refreshKey={result?.url} emptyText="暂无扩图记录" />
      }
    >
      <section className="local-redraw-card smart-expand-card">
        <h2>原图占比</h2>
        <div className="smart-expand-scale-options">
          {QUICK_PERCENTS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={p === occupy}
              className={p === occupy ? 'active' : ''}
              onClick={() => {
                setOccupy(p);
                setOccupyText('');
              }}
            >
              {p}%
            </button>
          ))}
          <label>
            <span className="sr-only">自定义占比</span>
            <input
              aria-label="自定义占比"
              value={occupyText}
              placeholder="1-100%"
              inputMode="numeric"
              aria-invalid={!occupyValid}
              onChange={(e) => setOccupyText(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitOccupy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitOccupy();
              }}
            />
          </label>
        </div>
        {!occupyValid && (
          <p className="smart-expand-field-error" role="alert">
            请输入 1-100 之间的整数占比
          </p>
        )}
      </section>

      <section className="local-redraw-card smart-expand-card">
        <h2>原图位置</h2>
        <PositionGrid value={position} onChange={setPosition} />
      </section>
    </ToolShell>
  );
}
