import { useState } from 'react';
import { App } from 'antd';
import { RotateCcw } from 'lucide-react';
import { useToolTask } from '../hooks/useToolTask';
import { ToolShell } from '../components/ToolShell';
import { RangeRow, ToolCard } from '../components/ToolWidgets';

/**
 * 旋转角度 —— 1:1 复刻参考站 https://ijihua.cn/rotate-angle。
 *
 * 实拍结构 (rotate-angle-page):
 *   上传卡: * 上传图片 (提示语 "支持 JPG、PNG、WebP，最多 1 张")
 *   旋转角度卡 (rotate-angle-settings):
 *     卡头: h2 + 重置参数按钮 (rotate-ccw 16px)
 *     tabs (role=tablist): 主体(默认) / 摄像头
 *       主体tab: rotate-angle-subject-stage > CSS 3D 立方体 (前/后/左/右/上/下 六面),
 *                transform: rotateX(pitch) rotateY(yaw), 可拖拽 (参考站 preview-drag)
 *       摄像头tab: rotate-angle-camera-stage > 轨道线 (12 条 15° 间隔) + 指针 +
 *                4 个方向键 (‹ › ⌃ ⌄, 分别调 yaw/pitch)
 *     三滑杆: 旋转 yaw -90..90 (默认0) / 倾斜 pitch -30..60 (默认0) /
 *            缩放 zoom 0.8..1.2 step0.01 (默认1, 标签显示"特写")
 *     提示: 相机保持静止，生成时按主体旋转角度重建商品展示。
 *   高级设置: 比例 原比例 / 画质 1K
 *   提交: 立即生成 本次消耗5积分; 提示行 "确认素材和参数后提交，右侧会展示生成结果。"
 *   描述: 视角平滑旋转，细节立体呈现
 *
 * 诚实披露: rotate 为 real 能力 —— yaw 平面旋转 + pitch 逐行剪切 + zoom 缩放的
 * 2D 近似 (真实 3D 重建需 AI 模型, 页面与结果图均有标注)。
 */

const ARROW_STEP = 15;

export function RotateAnglePage() {
  const { message } = App.useApp();
  const { submitting, result, run } = useToolTask({ capability: 'rotate', successMessage: '旋转结果已生成' });

  const [tab, setTab] = useState<'subject' | 'camera'>('subject');
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [zoom, setZoom] = useState(1);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const reset = () => {
    setYaw(0);
    setPitch(0);
    setZoom(1);
    message.info('已重置旋转参数');
  };

  // 摄像头方向键: 左右调 yaw, 上下调 pitch (参考站 orbit-arrow)
  const nudge = (dir: 'left' | 'right' | 'up' | 'down') => {
    if (dir === 'left') setYaw((v) => clamp(v - ARROW_STEP, -90, 90));
    if (dir === 'right') setYaw((v) => clamp(v + ARROW_STEP, -90, 90));
    if (dir === 'up') setPitch((v) => clamp(v + ARROW_STEP, -30, 60));
    if (dir === 'down') setPitch((v) => clamp(v - ARROW_STEP, -30, 60));
  };

  return (
    <ToolShell
      capability="rotate"
      title="旋转角度"
      desc="视角平滑旋转，细节立体呈现"
      upload={{ title: '上传图片', required: true, max: 1, hint: '支持 JPG、PNG、WebP，最多 1 张' }}
      settings={{ ratio: true, resolution: true }}
      submitLabel="立即生成"
      creditLabel="本次消耗5积分"
      hint="确认素材和参数后提交，右侧会展示生成结果。"
      mockNote=""
      emptyDesc="上传图片并调整角度后，结果将在此处展示"
      formValid
      submitting={submitting}
      result={result}
      resultTag={`旋转 ${yaw} · 倾斜 ${pitch} · 缩放 ${zoom.toFixed(2)}`}
      onSubmit={(inputs, settings) =>
        run(inputs, { yaw, pitch, zoom, ratio: settings.ratio, size: settings.resolution })
      }
    >
      <section className="local-redraw-card rotate-angle-settings">
        <div className="rotate-angle-settings-head">
          <h2>旋转角度</h2>
          <button type="button" aria-label="重置参数" title="重置参数" onClick={reset}>
            <RotateCcw size={16} />
          </button>
        </div>

        <div className="rotate-angle-tabs" role="tablist" aria-label="旋转模式">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'subject'}
            className={tab === 'subject' ? 'active' : ''}
            onClick={() => setTab('subject')}
          >
            主体
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'camera'}
            className={tab === 'camera' ? 'active' : ''}
            onClick={() => setTab('camera')}
          >
            摄像头
          </button>
        </div>

        {tab === 'subject' ? (
          <div className="rotate-angle-preview">
            <div className="rotate-angle-subject-stage">
              <div
                className="rotate-angle-cube"
                style={{ transform: `rotateX(${-pitch}deg) rotateY(${yaw}deg)` }}
              >
                <span className="rotate-angle-cube-face front">前</span>
                <span className="rotate-angle-cube-face back">后</span>
                <span className="rotate-angle-cube-face left">左</span>
                <span className="rotate-angle-cube-face right">右</span>
                <span className="rotate-angle-cube-face top">上</span>
                <span className="rotate-angle-cube-face bottom">下</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rotate-angle-preview">
            <div className="rotate-angle-camera-stage">
              <div className="rotate-angle-orbit">
                <div className="rotate-angle-wire" style={{ transform: `rotateX(${-pitch * 0.6}deg) rotateY(${yaw * 0.6}deg)` }}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <i key={i} style={{ ['--line-angle' as string]: `${i * 15}deg` }} />
                  ))}
                </div>
              </div>
              <div className="rotate-angle-needle" style={{ width: `${(yaw + 90) / 180 * 100}%`, transform: `rotate(${pitch}deg)` }} />
              <button type="button" className="orbit-arrow left" aria-label="向左旋转" title="向左旋转" onClick={() => nudge('left')}>
                ‹
              </button>
              <button type="button" className="orbit-arrow right" aria-label="向右旋转" title="向右旋转" onClick={() => nudge('right')}>
                ›
              </button>
              <button type="button" className="orbit-arrow up" aria-label="向上倾斜" title="向上倾斜" onClick={() => nudge('up')}>
                ⌃
              </button>
              <button type="button" className="orbit-arrow down" aria-label="向下倾斜" title="向下倾斜" onClick={() => nudge('down')}>
                ⌄
              </button>
            </div>
          </div>
        )}

        <RangeRow label="旋转" min={-90} max={90} step={1} value={yaw} onChange={setYaw} />
        <RangeRow label="倾斜" min={-30} max={60} step={1} value={pitch} onChange={setPitch} />
        <RangeRow label="缩放" display={zoom === 1 ? '特写' : zoom.toFixed(2)} min={0.8} max={1.2} step={0.01} value={zoom} onChange={setZoom} />

        <p className="tool-card-copy">相机保持静止，生成时按主体旋转角度重建商品展示。</p>
        <p className="tool-card-copy">本地为 2D 近似（平面旋转 + 逐行剪切 + 缩放），非 3D 重建。</p>
      </section>
    </ToolShell>
  );
}
