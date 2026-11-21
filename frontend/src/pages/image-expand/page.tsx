import { useState } from 'react';
import { Plus } from 'lucide-react';

import { DEFAULT_OCCUPY, QUICK_PERCENTS } from './constants';
import { ExpandLayoutPreview, PositionGrid, ToolHistoryPane, ToolShell } from './components';
import {
  PRODUCT_TOOL_DROPZONE,
  PRODUCT_TOOL_PAGE,
  productSourceUploadPreview,
} from './components';
import { useToolTask } from './hooks';
import {
  committedOccupyOf,
  effectiveOccupyOf,
  expandPayload,
  isOccupyInputValid,
  loadImageSize,
  positionLabelOf,
} from './utils';
import { useApp } from '../../ui';

/**
 * 智能扩图
 *
 * 实拍结构 (smart-expand-page):
 *   上传卡: * 上传图片
 *   原图占比卡: 快捷按钮 100% / 80%(默认) / 60% / 50% + 自由输入 (placeholder 1-99%)
 *   原图位置卡: 3x3 九宫格 ↖↑↗ / ←⊙→ / ↙↓↘ (center 默认)
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即扩图 (消耗价由后端下发, 见 hooks/useCreditLabel); 提示行 "*确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 智能扩展画面尺寸，快速适配不同平台展示需求
 *
 * 诚实披露: expand 只走真实图像模型；本地仅按原图尺寸计算 placement 元数据，
 * 不采样边缘、不合成像素，无模型通道时会明确失败而不是产出伪扩图。
 */

export function ImageExpandPage() {
  const { message } = useApp();
  const { submitting, result, setResult, run } = useToolTask({ capability: 'expand', successMessage: '扩图结果已生成' });

  const [occupy, setOccupy] = useState(DEFAULT_OCCUPY);
  const [occupyText, setOccupyText] = useState('');
  const [position, setPosition] = useState('center');
  const [previewRatio, setPreviewRatio] = useState('original');
  const [preparing, setPreparing] = useState(false);

  const occupyValid = isOccupyInputValid(occupyText);
  /**
   * 提交与预览都用这个值：自定义输入合法时立即生效，不必等失焦；
   * 非法输入不覆盖上一次有效档位（同时 formValid 会拦住提交）。
   */
  const effectiveOccupy = effectiveOccupyOf(occupyText, occupy);

  const handleHistoryReuse = () => {
    setResult(null);
  };

  /**
   * 输入框只负责文本，不把每个中间态写进 occupy。
   *
   * 否则用户从 80 改成 35 时，先输入的 "3" 会立刻成为有效占比，预览与
   * 结果标签会闪一次 3%；失焦或提交时再提交完整的合法值。
   */
  const commitOccupy = () => {
    const next = committedOccupyOf(occupyText);
    if (next !== null) {
      setOccupy(next);
      setOccupyText('');
    }
  };

  return (
    <ToolShell
      capability="expand"
      pageClass={`${PRODUCT_TOOL_PAGE} product-retouch-page smart-expand-page`}
      title="智能扩图"
      desc="智能扩展画面尺寸，快速适配不同平台展示需求"
      upload={{
        title: '上传图片',
        required: true,
        max: 1,
        hint: '点击、拖拽或粘贴图片上传，最多 1 张',
        promptIcon: <Plus size={22} />,
        dropzoneClassName: PRODUCT_TOOL_DROPZONE,
      }}
      replaceUpload
      renderUploadPreview={productSourceUploadPreview('待扩图原图')}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即扩图"
      emptyVideo="/static/mp4/06_znkt.mp4"
      emptyDesc="上传图片后，扩展构图的结果将在此处展示"
      formValid={!preparing && occupyValid}
      submitting={submitting}
      result={result}
      resultView="product-card"
      resultTag={`占比 ${effectiveOccupy}% · ${positionLabelOf(position)}`}
      onSubmit={async (inputs, settings) => {
        if (!occupyValid) {
          message.error('原图占比需为 1-99% 的整数');
          return;
        }
        setPreparing(true);
        try {
          const size = await loadImageSize(inputs[0]?.url ?? '');
          await run(inputs, expandPayload(size.width, size.height, settings, effectiveOccupy, position));
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
          <div className="relative flex size-full min-h-0 flex-col items-center justify-center">
            <ExpandLayoutPreview
              sourceUrl={image.url}
              ratio={previewRatio}
              occupy={effectiveOccupy}
              position={position}
            />
          </div>
        );
      }}
      onSettingsChange={(settings) => setPreviewRatio(settings.ratio)}
      trailingPane={
        <ToolHistoryPane capability="expand" refreshKey={result?.url} emptyText="暂无扩图记录" />
      }
    >
      <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] bg-card px-4 py-3.5 max-[900px]:p-3.5">
        <h2 className="m-0 text-sm leading-[22px] font-bold text-[color:var(--wb-text)] max-[900px]:mb-3 max-[900px]:leading-5">
          原图占比
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_PERCENTS.map((p) => {
            const active = p === occupy;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                className={`box-border h-7 min-w-10 cursor-pointer rounded-[7px] border px-2.5 text-xs leading-[26px] ${
                  active
                    ? 'border-[var(--tool-border-brand-5)] bg-[var(--wb-flow-income-bg)] font-semibold text-brand'
                    : 'border-[var(--border-1)] bg-card text-[color:var(--tool-text-1)]'
                }`}
                onClick={() => {
                  setOccupy(p);
                  setOccupyText('');
                }}
              >
                {p}%
              </button>
            );
          })}
          <label className="box-border h-7 w-[72px] overflow-hidden rounded-[7px] border border-[var(--border-1)] bg-card text-xs leading-[26px] text-[color:var(--tool-text-1)] has-[input[aria-invalid=true]]:border-[var(--tool-border-danger)] has-[input[aria-invalid=true]]:shadow-[0_0_0_2px_rgba(229,72,77,0.12)]">
            <span className="sr-only">自定义占比</span>
            <input
              className="box-border size-full border-0 px-[9px] text-[color:var(--text-body)] outline-0 placeholder:text-[color:var(--text-8)]"
              aria-label="自定义占比"
              value={occupyText}
              placeholder="1-99%"
              inputMode="numeric"
              min={1}
              max={99}
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
          <p className="mx-0 -mt-1 mb-0 text-xs leading-4 text-[color:var(--tool-text-danger)]" role="alert">
            请输入 1-99 之间的整数占比
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] bg-card px-4 py-3.5 max-[900px]:p-3.5">
        <h2 className="m-0 text-sm leading-[22px] font-bold text-[color:var(--wb-text)] max-[900px]:mb-3 max-[900px]:leading-5">
          原图位置
        </h2>
        <PositionGrid value={position} onChange={setPosition} />
      </section>
    </ToolShell>
  );
}
