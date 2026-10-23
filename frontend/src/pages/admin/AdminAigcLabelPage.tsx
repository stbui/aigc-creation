import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  App,
  AutoComplete,
  Button,
  ColorPicker,
  Input,
  InputNumber,
  Slider,
  Switch,
} from 'antd';
import { adminAigcLabelApi } from '../../lib/api';
import { hexToRgba } from '../../lib/aigc-label';
import { useAdmin } from '../../context/AdminContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type { AigcLabelPosition, AigcLabelSpec } from '../../types/api';

/**
 * AI 生成标识样式（2026-10-21）。
 *
 * ## 为什么位图在浏览器里画
 *
 * 中文无法在服务端零依赖地栅格化（Jimp 内置字体只有 ASCII）。所以由这个
 * 页面用 Canvas 按样式画一张 PNG，和服务端一起保存；服务端合成时只做
 * 缩放、定位与透明度。带来的约束是：**改文案/字体/配色后必须在点保存**，
 * 否则位图还是旧的 —— 页面用 `badge.stale` 明确提示这件事。
 *
 * ## 预览是「示例底图 + 真实合成参数」
 *
 * 预览按服务端同样的规则算宽度、边距与位置，所以看到的相对大小与最终
 * 产出一致；底图本身是画的，不是真实素材（不假装是）。
 */

const POSITION_LABELS: Record<AigcLabelPosition, string> = {
  'bottom-right': '右下',
  'bottom-left': '左下',
  'top-right': '右上',
  'top-left': '左上',
};

const FONT_PRESETS = [
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  '"Songti SC", "SimSun", serif',
  '"Arial", "Helvetica", sans-serif',
  '"Menlo", "Consolas", monospace',
];

/** 位图渲染倍率：2x，合成时再缩到目标宽度 */
const RENDER_SCALE = 2;

/** 按样式把角标画成一张 PNG（透明底） */
function renderBadgeCanvas(spec: AigcLabelSpec): HTMLCanvasElement {
  const S = RENDER_SCALE;
  const fontSize = spec.fontSize * S;
  const font = `${spec.fontWeight} ${fontSize}px ${spec.fontFamily}`;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('当前浏览器不支持 Canvas，无法生成角标位图');
  // letterSpacing 是较新的属性；不支持时按 0 处理（测量与绘制都不含字距，仍自洽）
  const spacing = `${spec.letterSpacing * S}px`;
  (probe as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  probe.font = font;
  const textW = Math.ceil(probe.measureText(spec.text || ' ').width);

  const dotD = spec.dotColor ? Math.round(spec.fontSize * 0.4 * S) : 0;
  const gap = spec.dotColor ? Math.round(spec.fontSize * 0.35 * S) : 0;
  const padX = Math.round(spec.paddingX * S);
  const width = Math.max(1, padX * 2 + dotD + gap + textW);
  const height = Math.max(1, Math.round(spec.fontSize * 2.2 * S));
  const radius = Math.min(spec.radius * S, Math.floor(height / 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法生成角标位图');

  ctx.fillStyle = hexToRgba(spec.backgroundColor, spec.backgroundOpacity);
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.fill();

  let x = padX;
  if (dotD > 0) {
    ctx.fillStyle = spec.dotColor;
    ctx.beginPath();
    ctx.arc(x + dotD / 2, height / 2, dotD / 2, 0, Math.PI * 2);
    ctx.fill();
    x += dotD + gap;
  }

  // 调整 canvas 尺寸会重置上下文，字体/字距必须在这之后设置
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  ctx.fillStyle = spec.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.text, x, height / 2);

  return canvas;
}

/** 示例底图 + 按服务端规则合成角标 */
function drawPreview(canvas: HTMLCanvasElement, spec: AigcLabelSpec, badge: HTMLCanvasElement) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#eef2f8');
  bg.addColorStop(1, '#d9e0ee');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 示意「一张商品图」：不能拿真实素材冒充预览，但也不能是个纯色块
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.roundRect(W * 0.26, H * 0.16, W * 0.48, H * 0.66, 28);
  ctx.fill();
  ctx.fillStyle = '#b9c4d8';
  ctx.beginPath();
  ctx.arc(W * 0.5, H * 0.42, H * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa8c1';
  ctx.beginPath();
  ctx.roundRect(W * 0.4, H * 0.62, W * 0.2, H * 0.07, 10);
  ctx.fill();

  ctx.fillStyle = 'rgba(23, 26, 43, 0.32)';
  ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('示例底图（非真实产出）', 18, H - 18);

  if (!spec.enabled) {
    // 关闭态不画角标，但要说清楚「少了什么」，避免预览空着让人以为坏了
    ctx.fillStyle = 'rgba(23, 26, 43, 0.55)';
    ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('可见角标已关闭：产出图不再显示角标', W / 2, H * 0.9);
    return;
  }

  let targetW = Math.round(
    Math.min(spec.maxWidthPx, Math.max(spec.minWidthPx, (W * spec.scalePercent) / 100)),
  );
  targetW = Math.max(1, Math.min(targetW, W));
  let targetH = Math.max(1, Math.round((badge.height / Math.max(1, badge.width)) * targetW));
  if (targetH > H) {
    targetH = H;
    targetW = Math.max(1, Math.round((badge.width / badge.height) * targetH));
  }

  const margin = Math.max(6, Math.round((W * spec.marginPercent) / 100));
  const x = spec.position.endsWith('right')
    ? Math.max(0, W - targetW - margin)
    : Math.min(margin, Math.max(0, W - targetW));
  const y = spec.position.startsWith('bottom')
    ? Math.max(0, H - targetH - margin)
    : Math.min(margin, Math.max(0, H - targetH));

  ctx.globalAlpha = spec.opacity / 100;
  ctx.drawImage(badge, x, y, targetW, targetH);
  ctx.globalAlpha = 1;
}

/** 表单行 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</div>}
    </div>
  );
}

/** 颜色：原生取色器 + 可粘 hex 的输入框 */
function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <ColorPicker
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
        onChange={(color) => onChange(color.toHexString())}
        disabled={disabled}
        showText={false}
      />
      <Input
        className="adm-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="#rrggbb"
        maxLength={7}
      />
    </div>
  );
}

/** 滑块 + 数字输入，两者同步 */
function RangeField({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <Slider
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={onChange}
        disabled={disabled}
        style={{ flex: 1 }}
      />
      <InputNumber
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(next) => onChange(Number(next))}
        disabled={disabled}
        style={{ width: 92 }}
      />
      {suffix && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{suffix}</span>}
    </div>
  );
}

export function AdminAigcLabelPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const { data, loading, error, reload } = useAdminResource(() => adminAigcLabelApi.read(), []);
  /** 编辑中的草稿。与 data.spec 分离: 边改边存会改到服务端快照上, dirty 判定就失效了 */
  const [spec, setSpec] = useState<AigcLabelSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewRef = useRef<HTMLCanvasElement | null>(null);

  /*
   * 只在还没有草稿时从服务端快照播种 (spec 一旦存在就不再覆盖):
   * 否则刷新失败后点「重试」成功, 会把用户正在调的样式整块冲掉。
   * 保存成功后手工 setSpec 回填, 不依赖这条 effect。
   */
  useEffect(() => {
    if (!data || spec) return;
    setSpec(data.spec);
  }, [data, spec]);

  // 样式变了就重画预览。渲染失败只影响预览，不阻断保存
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !spec) return;
    try {
      drawPreview(canvas, spec, renderBadgeCanvas(spec));
      setPreviewError(null);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : '预览渲染失败');
    }
  }, [spec]);

  const patch = (next: Partial<AigcLabelSpec>) => setSpec((s) => (s ? { ...s, ...next } : s));

  const dirty = useMemo(() => {
    if (!data || !spec) return false;
    return JSON.stringify(spec) !== JSON.stringify(data.spec);
  }, [data, spec]);

  /*
   * 改的是全站每张产出图上的法定标识, 调样式通常要反复微调十几次 ——
   * 之前误点侧栏就整轮清零, 且直到回来才发现。现在离开前会确认。
   */
  useUnsavedGuard(dirty);

  const openConfirm = () => {
    if (!spec) return;
    if (!spec.text.trim()) {
      void message.warning('角标文案不能为空');
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(spec.textColor) || !/^#[0-9a-f]{6}$/i.test(spec.backgroundColor)) {
      void message.warning('颜色必须是 #rrggbb 格式');
      return;
    }
    if (spec.dotColor && !/^#[0-9a-f]{6}$/i.test(spec.dotColor)) {
      void message.warning('圆点颜色必须是 #rrggbb，或留空关闭圆点');
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (!spec) return;
    const text = reason.trim();
    if (!text) {
      void message.warning('请填写变更原因（写入审计日志）');
      return;
    }
    setBusy(true);
    try {
      const badge = renderBadgeCanvas(spec);
      const base64 = badge.toDataURL('image/png').split(',')[1] ?? '';
      if (!base64) throw new Error('角标位图生成失败');
      const next = await adminAigcLabelApi.update({
        spec,
        badgePngBase64: base64,
        reason: text,
      });
      setSpec(next.spec);
      setReason('');
      setConfirming(false);
      // 服务端返回的就是最新快照, 静默重取一次让 dirty 基线跟上, 不闪骨架屏
      void reload({ silent: true });
      void message.success('已保存，下一张生成的图片立即使用新角标');
    } catch (e) {
      void message.error((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  /*
   * 2026-10-23: 守卫从无条件的 `if (loading)` 收窄成「还没有数据时才塌」。
   * 本页右侧是两层 Canvas 预览 (CSS 外观 + 位图预览), 只要外层塌一次,
   * canvas 节点就被卸载, 位图要靠 effect 重画才回来 —— 明明只是重试一次
   * 请求, 视觉上却像样式被重置了。数据在手时保持页面不动, 只换内容。
   */
  if (loading && !data) return <AdminListLoading tip="加载 AI 标识配置…" />;
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;
  if (!data || !spec) return <AdminEmpty description="暂无配置" />;

  return (
    <>
      <PageHeader
        title="AI 标识"
        description={
          editable
            ? '生成图片的显式 AIGC 角标：可改样式，也可整体关闭（关闭后仅保留文件内隐式标识）。文案与字体由浏览器渲染成位图后保存，位置与缩放实时生效'
            : '当前账号无 setting.write 权限，仅可查看'
        }
      />

      {/* 刷新失败但草稿还在: 不能把编辑中的样式清掉, 只提示「配置可能已过期」 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      {data.badge.stale && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(250, 173, 20, 0.12)',
            color: 'var(--text-body)',
            fontSize: 13,
          }}
        >
          当前位图是按旧样式渲染的（样式改过但没重新保存位图）。点「保存并应用」会用当前样式重新生成。
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <Panel title="样式">
          <Field
            label="显示可见角标"
            hint="关闭后产出图不再合成角标，但文件内的隐式标识（XMP / IPTC DigitalSourceType）仍照常写入。按《人工智能生成合成内容标识办法》，显式标识属法定义务，关闭前请自行确认适用场景与法律风险。"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <Switch
                checked={spec.enabled}
                onChange={(checked) => patch({ enabled: checked })}
                disabled={!editable}
              />
              <span style={{ color: spec.enabled ? 'var(--text-body)' : 'var(--danger-text)' }}>
                {spec.enabled ? '开启（默认）' : '已关闭：产出图不显示角标'}
              </span>
            </div>
            {!spec.enabled && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(212, 56, 13, 0.08)',
                  fontSize: 12,
                  lineHeight: 1.7,
                  color: 'var(--text-body)',
                }}
              >
                关闭后仅保留隐式标识；产品图被转发到站外时，观看者将看不到「AI 生成」提示。
              </div>
            )}
          </Field>

          <Field label="角标文案" hint="最多 20 个字。用户下载/转发图片时会一起带走">
            <Input
              className="adm-input"
              value={spec.text}
              maxLength={20}
              onChange={(e) => patch({ text: e.target.value })}
              disabled={!editable}
            />
          </Field>

          <Field label="字体" hint="使用你本机已安装的字体；不同运营电脑的预览可能略有差异">
            <AutoComplete
              className="adm-input"
              value={spec.fontFamily}
              options={FONT_PRESETS.map((font) => ({ value: font }))}
              onChange={(value) => patch({ fontFamily: value })}
              disabled={!editable}
            />
          </Field>

          <Field label="字号">
            <RangeField
              value={spec.fontSize}
              min={12}
              max={80}
              suffix="px（2x 基准）"
              onChange={(v) => patch({ fontSize: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="字重">
            <div style={{ display: 'flex', gap: 8 }}>
              {[400, 500, 600, 700].map((w) => (
                <Button
                  key={w}
                  type="default"
                  className={`adm-btn${spec.fontWeight === w ? ' is-primary' : ''}`}
                  onClick={() => patch({ fontWeight: w })}
                  disabled={!editable}
                >
                  {w}
                </Button>
              ))}
            </div>
          </Field>

          <Field label="字距">
            <RangeField
              value={spec.letterSpacing}
              min={0}
              max={12}
              step={0.5}
              suffix="px"
              onChange={(v) => patch({ letterSpacing: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="文字颜色">
            <ColorField value={spec.textColor} onChange={(v) => patch({ textColor: v })} disabled={!editable} />
          </Field>

          <Field label="底色">
            <ColorField
              value={spec.backgroundColor}
              onChange={(v) => patch({ backgroundColor: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="底色不透明度">
            <RangeField
              value={spec.backgroundOpacity}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => patch({ backgroundOpacity: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="圆角">
            <RangeField
              value={spec.radius}
              min={0}
              max={60}
              suffix="px（2x 基准）"
              onChange={(v) => patch({ radius: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="水平内边距">
            <RangeField
              value={spec.paddingX}
              min={0}
              max={80}
              suffix="px（2x 基准）"
              onChange={(v) => patch({ paddingX: v })}
              disabled={!editable}
            />
          </Field>

          <Field label="圆点" hint="留空 = 不画圆点">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input
                className="adm-input"
                value={spec.dotColor}
                placeholder="#5546d8（留空关闭）"
                maxLength={7}
                onChange={(e) => patch({ dotColor: e.target.value })}
                disabled={!editable}
              />
              <ColorPicker
                value={/^#[0-9a-f]{6}$/i.test(spec.dotColor) ? spec.dotColor : '#5546d8'}
                onChange={(color) => patch({ dotColor: color.toHexString() })}
                disabled={!editable || !spec.dotColor}
                showText={false}
              />
            </div>
          </Field>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          <Panel title="预览" note="按合成规则实时计算">
            <canvas
              ref={previewRef}
              width={760}
              height={500}
              style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block' }}
            />
            {previewError && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger-text)' }}>{previewError}</div>
            )}
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              预览只影响你看到的画面；用户拿到的图片由服务端按同一组参数合成。
            </div>
          </Panel>

          <Panel title="位置与缩放">
            <Field label="位置">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(Object.keys(POSITION_LABELS) as AigcLabelPosition[]).map((p) => (
                  <Button
                    key={p}
                    type="default"
                    className={`adm-btn${spec.position === p ? ' is-primary' : ''}`}
                    onClick={() => patch({ position: p })}
                    disabled={!editable}
                  >
                    {POSITION_LABELS[p]}
                  </Button>
                ))}
              </div>
            </Field>

            <Field label="宽度（占图片宽度的比例）">
              <RangeField
                value={spec.scalePercent}
                min={4}
                max={60}
                suffix="%"
                onChange={(v) => patch({ scalePercent: v })}
                disabled={!editable}
              />
            </Field>

            <Field label="宽度上下限" hint="缩略图不至于被角标糊掉，大图上也不会小到看不见">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  type="number"
                  className="adm-input adm-input-number"
                  value={spec.minWidthPx}
                  min={16}
                  max={2048}
                  onChange={(e) => patch({ minWidthPx: Number(e.target.value) })}
                  disabled={!editable}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>~</span>
                <Input
                  type="number"
                  className="adm-input adm-input-number"
                  value={spec.maxWidthPx}
                  min={16}
                  max={4096}
                  onChange={(e) => patch({ maxWidthPx: Number(e.target.value) })}
                  disabled={!editable}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>px</span>
              </div>
            </Field>

            <Field label="边距（占图片宽度的比例，至少 6px）">
              <RangeField
                value={spec.marginPercent}
                min={0}
                max={10}
                step={0.5}
                suffix="%"
                onChange={(v) => patch({ marginPercent: v })}
                disabled={!editable}
              />
            </Field>

            <Field label="整体不透明度" hint="低于 20% 在浅色图上几乎不可见，服务端会按下限夹紧">
              <RangeField
                value={spec.opacity}
                min={20}
                max={100}
                suffix="%"
                onChange={(v) => patch({ opacity: v })}
                disabled={!editable}
              />
            </Field>
          </Panel>

          {data.badge.source === 'custom' && data.badge.pngBase64 && (
            <Panel title="当前生效位图" note="服务端实际使用的那一张">
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  padding: 12,
                  borderRadius: 10,
                  background:
                    'repeating-conic-gradient(var(--surface) 0% 25%, var(--page-bg) 0% 50%) 50% / 16px 16px',
                }}
              >
                <img
                  src={`data:image/png;base64,${data.badge.pngBase64}`}
                  alt="当前角标位图"
                  style={{ maxWidth: '100%' }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                {data.badge.width}×{data.badge.height}px
                {data.badge.updatedAt ? ` · 更新于 ${new Date(data.badge.updatedAt).toLocaleString('zh-CN')}` : ''}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {editable && (
        <div className="adm-action-bar">
          <span className="adm-action-hint">
            {dirty ? '有未保存的变更' : '当前配置已保存'}
          </span>
          <div className="adm-action-buttons">
            <Button
              type="default"
              className="adm-btn"
              disabled={busy || !dirty}
              onClick={() => setSpec(data.spec)}
            >
              放弃变更
            </Button>
            <Button
              type="default"
              className="adm-btn"
              disabled={busy}
              onClick={() => setSpec(data.defaults)}
            >
              恢复默认样式
            </Button>
            <Button
              type="primary"
              className="adm-btn is-primary"
              disabled={busy || (!dirty && !data.badge.stale)}
              onClick={openConfirm}
            >
              保存并应用
            </Button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmAction
          open
          title="保存 AI 标识样式"
          confirmText="保存并应用"
          loading={busy}
          description={
            <p>
              保存后立即生效，影响此后生成的每一张图片。文案与字体变化会重新生成角标位图。
            </p>
          }
          impact={[
            `可见角标：${data.spec.enabled ? '开启' : '关闭'} → ${spec.enabled ? '开启' : '关闭'}`,
            `文案：${data.spec.text} → ${spec.text}`,
            `位置：${POSITION_LABELS[data.spec.position]} → ${POSITION_LABELS[spec.position]}`,
            `宽度：${data.spec.scalePercent}% → ${spec.scalePercent}%`,
          ]}
          extra={
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>变更原因（写入审计日志）</div>
              <Input
                className="adm-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：按品牌规范调整角标配色"
                maxLength={200}
              />
            </div>
          }
          onCancel={() => {
            setConfirming(false);
            setReason('');
          }}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}
