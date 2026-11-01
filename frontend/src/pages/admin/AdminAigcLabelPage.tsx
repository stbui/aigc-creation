import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminAigcLabelApi } from '../../lib/api';
import { hexToRgba } from '../../lib/aigc-label';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  ConfirmAction,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import { FormField, Notice, SaveBar } from '../../admin-ui/primitives';
import {
  ColorBox,
  NumberInput,
  RangeBox,
  SuggestInput,
  SwitchBox,
  TextInput,
} from '../../admin-ui/controls';
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

export function AdminAigcLabelPage() {
  const toast = useToast();
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
      toast.warning('角标文案不能为空');
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(spec.textColor) || !/^#[0-9a-f]{6}$/i.test(spec.backgroundColor)) {
      toast.warning('颜色必须是 #rrggbb 格式');
      return;
    }
    if (spec.dotColor && !/^#[0-9a-f]{6}$/i.test(spec.dotColor)) {
      toast.warning('圆点颜色必须是 #rrggbb，或留空关闭圆点');
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (!spec) return;
    const text = reason.trim();
    if (!text) {
      toast.warning('请填写变更原因（写入审计日志）');
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
      toast.success('已保存，下一张生成的图片立即使用新角标');
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
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
        <Notice tone="warn">
          当前位图是按旧样式渲染的（样式改过但没重新保存位图）。点「保存并应用」会用当前样式重新生成。
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel title="样式">
          <div className="flex flex-col gap-4">
            <FormField
              label="显示可见角标"
              hint="关闭后产出图不再合成角标，但文件内的隐式标识（XMP / IPTC DigitalSourceType）仍照常写入。按《人工智能生成合成内容标识办法》，显式标识属法定义务，关闭前请自行确认适用场景与法律风险。"
            >
              <div className="flex items-center gap-2">
                <SwitchBox
                  checked={spec.enabled}
                  onChange={(checked) => patch({ enabled: checked })}
                  disabled={!editable}
                  ariaLabel="显示可见角标"
                />
                <span className="text-xs text-text-secondary">
                  {spec.enabled ? '开启（默认）' : '已关闭：产出图不显示角标'}
                </span>
              </div>
              {!spec.enabled && (
                <Notice tone="danger" className="mt-2">
                  关闭后仅保留隐式标识；产品图被转发到站外时，观看者将看不到「AI 生成」提示。
                </Notice>
              )}
            </FormField>

            <FormField label="角标文案" hint="最多 20 个字。用户下载/转发图片时会一起带走">
              <TextInput
                value={spec.text}
                maxLength={20}
                onChange={(next) => patch({ text: next })}
                disabled={!editable}
                ariaLabel="角标文案"
              />
            </FormField>

            <FormField
              label="字体"
              hint="使用你本机已安装的字体；不同运营电脑的预览可能略有差异"
            >
              <SuggestInput
                value={spec.fontFamily}
                suggestions={FONT_PRESETS}
                onChange={(next) => patch({ fontFamily: next })}
                disabled={!editable}
                ariaLabel="字体"
              />
            </FormField>

            <FormField label="字号">
              <RangeBox
                value={spec.fontSize}
                min={12}
                max={80}
                suffix="px（2x 基准）"
                onChange={(v) => patch({ fontSize: v })}
                disabled={!editable}
                ariaLabel="字号"
              />
            </FormField>

            <FormField label="字重">
              <div className="flex gap-2">
                {[400, 500, 600, 700].map((w) => (
                  <Button
                    key={w}
                    variant={spec.fontWeight === w ? 'primary' : 'secondary'}
                    size="small"
                    onClick={() => patch({ fontWeight: w })}
                    disabled={!editable}
                    aria-pressed={spec.fontWeight === w}
                  >
                    {w}
                  </Button>
                ))}
              </div>
            </FormField>

            <FormField label="字距">
              <RangeBox
                value={spec.letterSpacing}
                min={0}
                max={12}
                step={0.5}
                suffix="px"
                onChange={(v) => patch({ letterSpacing: v })}
                disabled={!editable}
                ariaLabel="字距"
              />
            </FormField>

            <FormField label="文字颜色">
              <ColorBox
                value={spec.textColor}
                onChange={(v) => patch({ textColor: v })}
                disabled={!editable}
                ariaLabel="文字颜色"
              />
            </FormField>

            <FormField label="底色">
              <ColorBox
                value={spec.backgroundColor}
                onChange={(v) => patch({ backgroundColor: v })}
                disabled={!editable}
                ariaLabel="底色"
              />
            </FormField>

            <FormField label="底色不透明度">
              <RangeBox
                value={spec.backgroundOpacity}
                min={0}
                max={100}
                suffix="%"
                onChange={(v) => patch({ backgroundOpacity: v })}
                disabled={!editable}
                ariaLabel="底色不透明度"
              />
            </FormField>

            <FormField label="圆角">
              <RangeBox
                value={spec.radius}
                min={0}
                max={60}
                suffix="px（2x 基准）"
                onChange={(v) => patch({ radius: v })}
                disabled={!editable}
                ariaLabel="圆角"
              />
            </FormField>

            <FormField label="水平内边距">
              <RangeBox
                value={spec.paddingX}
                min={0}
                max={80}
                suffix="px（2x 基准）"
                onChange={(v) => patch({ paddingX: v })}
                disabled={!editable}
                ariaLabel="水平内边距"
              />
            </FormField>

            <FormField label="圆点" hint="留空 = 不画圆点">
              <ColorBox
                value={spec.dotColor}
                onChange={(v) => patch({ dotColor: v })}
                disabled={!editable || !spec.dotColor}
                ariaLabel="圆点颜色"
              />
            </FormField>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="预览" note="按合成规则实时计算">
            <canvas
              ref={previewRef}
              width={760}
              height={500}
              className="block h-auto w-full rounded-xl"
            />
            {previewError && (
              <p className="mt-2 text-xs text-rose-600">{previewError}</p>
            )}
            <p className="mt-2.5 text-xs leading-5 text-text-tertiary">
              预览只影响你看到的画面；用户拿到的图片由服务端按同一组参数合成。
            </p>
          </Panel>

          <Panel title="位置与缩放">
            <div className="flex flex-col gap-4">
              <FormField label="位置">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(POSITION_LABELS) as AigcLabelPosition[]).map((p) => (
                    <Button
                      key={p}
                      variant={spec.position === p ? 'primary' : 'secondary'}
                      size="small"
                      onClick={() => patch({ position: p })}
                      disabled={!editable}
                      aria-pressed={spec.position === p}
                    >
                      {POSITION_LABELS[p]}
                    </Button>
                  ))}
                </div>
              </FormField>

              <FormField label="宽度（占图片宽度的比例）">
                <RangeBox
                  value={spec.scalePercent}
                  min={4}
                  max={60}
                  suffix="%"
                  onChange={(v) => patch({ scalePercent: v })}
                  disabled={!editable}
                  ariaLabel="宽度比例"
                />
              </FormField>

              <FormField
                label="宽度上下限"
                hint="缩略图不至于被角标糊掉，大图上也不会小到看不见"
              >
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={spec.minWidthPx}
                    min={16}
                    max={2048}
                    onChange={(next) => patch({ minWidthPx: next ?? spec.minWidthPx })}
                    disabled={!editable}
                    ariaLabel="最小宽度"
                    className="w-24"
                  />
                  <span className="text-xs text-text-tertiary">~</span>
                  <NumberInput
                    value={spec.maxWidthPx}
                    min={16}
                    max={4096}
                    onChange={(next) => patch({ maxWidthPx: next ?? spec.maxWidthPx })}
                    disabled={!editable}
                    ariaLabel="最大宽度"
                    className="w-24"
                  />
                  <span className="text-xs text-text-tertiary">px</span>
                </div>
              </FormField>

              <FormField label="边距（占图片宽度的比例，至少 6px）">
                <RangeBox
                  value={spec.marginPercent}
                  min={0}
                  max={10}
                  step={0.5}
                  suffix="%"
                  onChange={(v) => patch({ marginPercent: v })}
                  disabled={!editable}
                  ariaLabel="边距"
                />
              </FormField>

              <FormField
                label="整体不透明度"
                hint="低于 20% 在浅色图上几乎不可见，服务端会按下限夹紧"
              >
                <RangeBox
                  value={spec.opacity}
                  min={20}
                  max={100}
                  suffix="%"
                  onChange={(v) => patch({ opacity: v })}
                  disabled={!editable}
                  ariaLabel="整体不透明度"
                />
              </FormField>
            </div>
          </Panel>

          {data.badge.source === 'custom' && data.badge.pngBase64 && (
            <Panel title="当前生效位图" note="服务端实际使用的那一张">
              <div
                className="grid place-items-center rounded-xl p-3"
                style={{
                  background:
                    'repeating-conic-gradient(var(--surface) 0% 25%, var(--page-bg) 0% 50%) 50% / 16px 16px',
                }}
              >
                <img
                  src={`data:image/png;base64,${data.badge.pngBase64}`}
                  alt="当前角标位图"
                  className="max-w-full"
                />
              </div>
              <p className="mt-2 text-xs text-text-tertiary">
                {data.badge.width}×{data.badge.height}px
                {data.badge.updatedAt
                  ? ` · 更新于 ${new Date(data.badge.updatedAt).toLocaleString('zh-CN')}`
                  : ''}
              </p>
            </Panel>
          )}
        </div>
      </div>

      {editable && (
        <SaveBar>
          <span className="min-w-0 flex-1 text-xs text-text-secondary">
            {dirty ? '有未保存的变更' : '当前配置已保存'}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              disabled={busy || !dirty}
              onClick={() => setSpec(data.spec)}
            >
              放弃变更
            </Button>
            <Button
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={() => setSpec(data.defaults)}
            >
              恢复默认样式
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={busy || (!dirty && !data.badge.stale)}
              onClick={openConfirm}
            >
              保存并应用
            </Button>
          </div>
        </SaveBar>
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
            <FormField label="变更原因（写入审计日志）" required>
              <TextInput
                value={reason}
                onChange={setReason}
                placeholder="例如：按品牌规范调整角标配色"
                maxLength={200}
                ariaLabel="变更原因"
              />
            </FormField>
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
