import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import { Eraser, Maximize2, Paintbrush, RotateCcw } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { useProject } from '../hooks/useProject';
import { assetsApi } from '../lib/api';
import { ExpandTextModal, ToolShell, type ToolAsset } from '../components/ToolShell';
import { ToolCard } from '../components/ToolWidgets';

/**
 * 局部重绘 —— 1:1 复刻参考站 https://ijihua.cn/local-redraw。
 *
 * 实拍结构 (local-redraw-page):
 *   上传卡: * 上传图片 (从素材库导入 / 手机上传 / 点击或拖拽图片到此处上传,
 *          "点击、拖拽或粘贴图片上传，最多 1 张")
 *   重绘区域卡: 参考站在画布上涂抹圈选 → 本页**真的画布涂抹**，产出遮罩 PNG
 *   描述卡: "这个区域改成什么？" textarea + 放大编辑
 *   高级设置: 比例 原比例 / 画质 1K (提交区汇总 chip)
 *   提交: 开始重绘 (消耗价由后端下发); 描述: 只想修改局部？圈出来写描述就行
 *
 * ## 遮罩怎么走 (2026-10-22)
 *
 * 涂抹 → 画布导出**黑白 PNG**（透明区 = 要重绘的区域，OpenAI `images/edits`
 * 的约定）→ 上传成素材 → 提交时带 `maskAssetId`。
 *
 * 后端对「协议不支持遮罩」的通道**不静默忽略**，而是判 `42205` 并退款 ——
 * 忽略的后果是整图重绘：用户涂了包装盒，模型把整张图改了，界面上还显示成功。
 *
 * 没涂抹时退回位置枚举：那时它只是**提示词**里的一句位置描述，
 * 不具备圈选能力，故文案里如实写明「不改变重绘范围」。
 *
 * 诚实披露: local_redraw 必须由真实 inpainting 模型完成, 本地**没有实现**
 * (能力定义里 localFallback: false)。没有可用模型通道时后端判 failed/42204 并退款,
 * 本页据 runtime 提前禁用提交并说明原因, 不交付任何占位图。
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

type BrushTool = 'brush' | 'eraser';

/** 画布对外的两个动作：导出遮罩 / 清空涂抹 */
interface MaskPainterHandle {
  /** 导出遮罩 PNG；没有任何涂抹时返回 null（调用方据此退回位置枚举） */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}

/**
 * 遮罩画布。
 *
 * 结构是「一张 img 底图 + 一层透明画布叠在上面」：
 *   · 底图用 `<img>` 而不是把图画进 canvas —— 画进 canvas 后再「擦除」
 *     会把底图一起擦掉，用户看到的是白底而不是原图；
 *   · 涂抹只作用在叠层与离屏遮罩上，两者永不混入图片像素，
 *     故导出时不会因为跨域而得到一张被污染的空白 PNG。
 *
 * 离屏遮罩的初始状态是**全白不透明**；画笔是 `destination-out`
 * （把白色擦成透明）。于是「涂过的地方 = 透明 = 要重绘」，与 OpenAI
 * `images/edits` 的文档约定一致（见 protocol.spec.ts 的 maskSupport 注释）。
 */
function MaskPainter({
  url,
  brush,
  tool,
  onChange,
  handleRef,
}: {
  url: string;
  brush: number;
  tool: BrushTool;
  /** 涂抹状态变化（有任何笔迹 / 被清空） */
  onChange: (painted: boolean) => void;
  handleRef: { current: MaskPainterHandle | null };
}) {
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  /** 图片加载完后按原始像素尺寸建画布：遮罩必须与输入图同尺寸 */
  const setup = useCallback(
    (w: number, h: number) => {
      const overlay = overlayRef.current;
      const mask = maskRef.current;
      if (!overlay || !mask || w <= 0 || h <= 0) return;
      overlay.width = w;
      overlay.height = h;
      mask.width = w;
      mask.height = h;

      const octx = overlay.getContext('2d');
      octx?.clearRect(0, 0, w, h);
      const mctx = mask.getContext('2d');
      if (mctx) {
        mctx.globalCompositeOperation = 'source-over';
        mctx.globalAlpha = 1;
        mctx.fillStyle = 'white';
        mctx.fillRect(0, 0, w, h);
      }
      onChange(false);
    },
    [onChange],
  );

  const clear = useCallback(() => {
    const overlay = overlayRef.current;
    const mask = maskRef.current;
    if (overlay) overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    if (mask) {
      const mctx = mask.getContext('2d');
      if (mctx) {
        mctx.globalCompositeOperation = 'source-over';
        mctx.globalAlpha = 1;
        mctx.fillStyle = 'white';
        mctx.fillRect(0, 0, mask.width, mask.height);
      }
    }
    onChange(false);
  }, [onChange]);

  /**
   * 判断「到底涂没涂」：用户可能涂完又全擦掉。
   *
   * 在 64×64 的缩略图上数透明像素，而不是对整张 4K 遮罩逐像素扫描 ——
   * 后者一次要读 60MB+ 的 ImageData，只为回答一个是非题。
   */
  const hasPaint = useCallback((): boolean => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const pctx = probe.getContext('2d');
    if (!pctx) return false;
    pctx.drawImage(mask, 0, 0, 64, 64);
    const data = pctx.getImageData(0, 0, 64, 64).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent += 1;
    // 少于 4 个采样点是抖动/抗锯齿，不算涂抹
    return transparent >= 4;
  }, []);

  const toBlob = useCallback((): Promise<Blob | null> => {
    const mask = maskRef.current;
    if (!mask || mask.width === 0 || !hasPaint()) return Promise.resolve(null);
    return new Promise<Blob | null>((resolve) => mask.toBlob((b) => resolve(b), 'image/png'));
  }, [hasPaint]);

  useEffect(() => {
    handleRef.current = { toBlob, clear };
    return () => {
      handleRef.current = null;
    };
  }, [clear, handleRef, toBlob]);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    // 画布内部分辨率是原图尺寸，显示尺寸是 CSS 宽度 —— 必须换算，否则笔迹错位
    return {
      x: (e.clientX - rect.left) * (c.width / Math.max(rect.width, 1)),
      y: (e.clientY - rect.top) * (c.height / Math.max(rect.height, 1)),
    };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const overlay = overlayRef.current;
    const mask = maskRef.current;
    if (!overlay || !mask) return;
    const octx = overlay.getContext('2d');
    const mctx = mask.getContext('2d');
    if (!octx || !mctx) return;

    const rect = overlay.getBoundingClientRect();
    const lineWidth = Math.max(2, brush * (overlay.width / Math.max(rect.width, 1)));
    // 品牌色从设计令牌读，不在这里写死十六进制（与全局样式同源）
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || 'black';

    // 叠层：涂抹画半透明品牌色；橡皮把颜色擦掉（底图仍在下面）
    octx.save();
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    octx.lineWidth = lineWidth;
    if (tool === 'brush') {
      octx.globalCompositeOperation = 'source-over';
      octx.globalAlpha = 0.45;
      octx.strokeStyle = brand;
    } else {
      octx.globalCompositeOperation = 'destination-out';
      octx.globalAlpha = 1;
      octx.strokeStyle = 'black';
    }
    octx.beginPath();
    octx.moveTo(from.x, from.y);
    octx.lineTo(to.x, to.y);
    octx.stroke();
    octx.restore();

    // 离屏遮罩：涂抹 = 擦成透明（重绘区），橡皮 = 涂回白色
    mctx.save();
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    mctx.lineWidth = lineWidth;
    mctx.globalAlpha = 1;
    if (tool === 'brush') {
      mctx.globalCompositeOperation = 'destination-out';
      mctx.strokeStyle = 'black';
    } else {
      mctx.globalCompositeOperation = 'source-over';
      mctx.strokeStyle = 'white';
    }
    mctx.beginPath();
    mctx.moveTo(from.x, from.y);
    mctx.lineTo(to.x, to.y);
    mctx.stroke();
    mctx.restore();
  };

  return (
    <div className="redraw-mask-stage">
      <img
        className="redraw-mask-bg"
        src={url}
        alt="待重绘的原图"
        onLoad={(e) => setup(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      />
      <canvas
        ref={overlayRef}
        className="redraw-mask-overlay"
        aria-label="在图上涂抹要重绘的区域"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = pointOf(e);
          lastPoint.current = p;
          drawSegment(p, p);
          if (tool === 'brush') onChange(true);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = pointOf(e);
          drawSegment(lastPoint.current ?? p, p);
          lastPoint.current = p;
        }}
        onPointerUp={() => {
          drawing.current = false;
          lastPoint.current = null;
          // 橡皮可能把最后一笔也擦掉了：以遮罩实际内容为准，不以「画过」为准
          onChange(hasPaint());
        }}
        onPointerCancel={() => {
          drawing.current = false;
          lastPoint.current = null;
          onChange(hasPaint());
        }}
      />
      {/* 离屏遮罩：只用于导出，不显示 */}
      <canvas ref={maskRef} className="redraw-mask-hidden" aria-hidden="true" />
    </div>
  );
}

export function LocalRedrawPage() {
  const { message } = App.useApp();
  const { ensureProject } = useProject();
  const { submitting, result, run } = useToolTask({ capability: 'local_redraw', successMessage: '重绘结果已生成' });

  const [region, setRegion] = useState('center');
  const [prompt, setPrompt] = useState('');
  const [expandOpen, setExpandOpen] = useState(false);
  const [tool, setTool] = useState<BrushTool>('brush');
  const [brush, setBrush] = useState(32);
  const [painted, setPainted] = useState(false);
  /** 遮罩上传期间也要禁用按钮 —— 否则连点会传两份遮罩 */
  const [preparing, setPreparing] = useState(false);
  const painter = useRef<MaskPainterHandle | null>(null);

  const submit = async (inputs: ToolAsset[], settings: { ratio: string; resolution: string }) => {
    let maskAssetId: string | undefined;
    try {
      setPreparing(true);
      const blob = await painter.current?.toBlob();
      if (blob) {
        // 遮罩先落成素材再用 id 提交：生成是异步的，不能把 Blob 挂在不落库的临时对象上
        const projectId = await ensureProject();
        const file = new File([blob], `mask-${Date.now()}.png`, { type: 'image/png' });
        const asset = await assetsApi.upload(file, projectId);
        maskAssetId = asset.id;
      } else if (painted) {
        // 涂过又全擦掉：如实说明按位置描述提交，不假装带上了遮罩
        message.info('遮罩已擦空，本次按位置描述重绘');
      }
    } catch (e) {
      message.error((e as Error).message || '遮罩上传失败，请重试');
      setPreparing(false);
      return;
    } finally {
      setPreparing(false);
    }

    await run(inputs, {
      region,
      prompt: prompt.trim(),
      ratio: settings.ratio,
      size: settings.resolution,
      ...(maskAssetId ? { maskAssetId } : {}),
    });
  };

  return (
    <ToolShell
      capability="local_redraw"
      title="局部重绘"
      desc="只想修改局部？圈出来写描述就行，适合去掉瑕疵、更换图案、修改画面中的元素"
      upload={{ title: '上传图片', required: true, max: 1, hint: '点击、拖拽或粘贴图片上传，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="开始重绘"
      emptyDesc="上传图片并涂抹区域、写下描述后，重绘结果将在此处展示"
      formValid
      submitting={submitting || preparing}
      result={result}
      resultTag={painted ? '遮罩涂抹' : REGION_LABEL[region]}
      onSubmit={(inputs, settings) => submit(inputs, settings)}
    >
      {(images) => {
        const image = images[0];
        return (
          <>
            <ToolCard title="重绘区域">
              <p className="tool-card-copy">
                在原图上涂抹要重绘的地方。遮罩会随任务一起提交，只有支持图像编辑的通道（openai
                协议）能接收；其它通道会如实报错并退款，不会默默整图重绘。
              </p>
              {image ? (
                <>
                  <MaskPainter
                    url={image.url}
                    brush={brush}
                    tool={tool}
                    onChange={setPainted}
                    handleRef={painter}
                  />
                  <div className="redraw-mask-toolbar">
                    <button
                      type="button"
                      className={`tool-region-chip${tool === 'brush' ? ' active' : ''}`}
                      aria-pressed={tool === 'brush'}
                      onClick={() => setTool('brush')}
                    >
                      <Paintbrush size={13} />
                      画笔
                    </button>
                    <button
                      type="button"
                      className={`tool-region-chip${tool === 'eraser' ? ' active' : ''}`}
                      aria-pressed={tool === 'eraser'}
                      onClick={() => setTool('eraser')}
                    >
                      <Eraser size={13} />
                      橡皮
                    </button>
                    <label className="redraw-mask-brush">
                      笔刷
                      <input
                        type="range"
                        min={8}
                        max={96}
                        step={4}
                        value={brush}
                        onChange={(e) => setBrush(Number(e.target.value))}
                      />
                    </label>
                    <button type="button" className="tool-region-chip" onClick={() => painter.current?.clear()}>
                      <RotateCcw size={13} />
                      清空
                    </button>
                  </div>
                  <p className="redraw-mask-hint">
                    {painted
                      ? '涂抹区域将按描述重绘，其余像素保持不变。'
                      : '还没涂。未涂抹时按下面的位置描述提交 —— 那只是提示词里的一句话，并不限定重绘范围。'}
                  </p>
                </>
              ) : (
                <p className="tool-card-copy">先上传一张图片，再在图上涂抹要重绘的区域。</p>
              )}
            </ToolCard>

            <ToolCard title="重绘位置（未涂抹时使用）">
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
                <button
                  type="button"
                  className="pk-desc-expand"
                  aria-label="放大编辑描述"
                  title="放大编辑"
                  onClick={() => setExpandOpen(true)}
                >
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
          </>
        );
      }}
    </ToolShell>
  );
}
