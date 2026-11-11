import { useEffect, useMemo, useState } from 'react';
import { adminAigcLabelApi } from './api';
import {
  AdminPage,
  ActionButton,
  EmptyState,
  ListError,
  Notice,
  PageSkeleton,
  SaveBar,
  SkeletonPanel,
  StaleError,
} from '~/admin-ui/primitives';
import { useAdmin, useAdminResource, useToast, useUnsavedGuard } from './hooks';
import { renderBadgeCanvas } from './utils';
import { StylePanel } from './StylePanel';
import { PreviewPanel } from './PreviewPanel';
import { PositionPanel } from './PositionPanel';
import { CurrentBadgePanel } from './CurrentBadgePanel';
import { SaveLabelConfirm } from './SaveLabelConfirm';
import type { AigcLabelSpec } from '../../../types/api';

/**
 * AI 生成标识样式（2026-10-21）。
 *
 * ## 为什么位图在浏览器里画
 *
 * 中文无法在服务端零依赖地栅格化（Jimp 内置字体只有 ASCII）。所以由这个
 * 页面用 Canvas 按样式画一张 PNG，和服务端一起保存；服务端合成时只做
 * 缩放、定位与透明度。带来的约束是：**改文案/字体/配色后必须点保存**，
 * 否则位图还是旧的 —— 页面用 `badge.stale` 明确提示这件事。
 *
 * ## 预览是「示例底图 + 真实合成参数」
 *
 * 预览按服务端同样的规则算宽度、边距与位置，所以看到的相对大小与最终
 * 产出一致；底图本身是画的，不是真实素材（不假装是）。
 *
 * ## 模块划分
 *
 * 样式 / 预览 / 位置缩放 / 当前位图 / 保存确认各自独立；本文件只保留
 * 数据装配、草稿与保存编排。
 */
export function AdminAigcLabelPage() {
  const toast = useToast();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const { data, loading, error, reload } = useAdminResource(() => adminAigcLabelApi.read(), []);
  /** 编辑中的草稿。与 data.spec 分离：边改边存会改到服务端快照上，dirty 判定就失效了 */
  const [spec, setSpec] = useState<AigcLabelSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /*
   * 只在还没有草稿时从服务端快照播种 (spec 一旦存在就不再覆盖)：
   * 否则刷新失败后点「重试」成功，会把用户正在调的样式整块冲掉。
   * 保存成功后手工 setSpec 回填，不依赖这条 effect。
   */
  useEffect(() => {
    if (!data || spec) return;
    setSpec(data.spec);
  }, [data, spec]);

  const patch = (next: Partial<AigcLabelSpec>) => setSpec((s) => (s ? { ...s, ...next } : s));

  const dirty = useMemo(() => {
    if (!data || !spec) return false;
    return JSON.stringify(spec) !== JSON.stringify(data.spec);
  }, [data, spec]);

  /*
   * 改的是全站每张产出图上的法定标识，调样式通常要反复微调十几次 ——
   * 之前误点侧栏就整轮清零，且直到回来才发现。现在离开前会确认。
   */
  useUnsavedGuard(dirty);

  const openConfirm = () => {
    if (!spec) return;
    if (!spec.text.trim()) {
      toast.warning('角标文案不能为空');
      return;
    }
    if (
      !/^#[0-9a-f]{6}$/i.test(spec.textColor) ||
      !/^#[0-9a-f]{6}$/i.test(spec.backgroundColor)
    ) {
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
    setBusy(true);
    try {
      const badge = renderBadgeCanvas(spec);
      const base64 = badge.toDataURL('image/png').split(',')[1] ?? '';
      if (!base64) throw new Error('角标位图生成失败');
      const next = await adminAigcLabelApi.update({ spec, badgePngBase64: base64 });
      setSpec(next.spec);
      setConfirming(false);
      // 服务端返回的就是最新快照，静默重取一次让 dirty 基线跟上，不闪骨架屏
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
   * 本页右侧是两层 Canvas 预览（CSS 外观 + 位图预览），只要外层塌一次，
   * canvas 节点就被卸载，位图要靠 effect 重画才回来 —— 明明只是重试一次
   * 请求，视觉上却像样式被重置了。数据在手时保持页面不动，只换内容。
   */
  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 之前的守卫整页替换，首屏先闪一段没有标题的灰条，再冒出完整页面 ——
   * 骨架该占住位置，不是把版面清空。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="AI 标识"
        description={
          editable
            ? '生成图片的显式 AIGC 角标：可改样式，也可整体关闭（关闭后仅保留文件内隐式标识）。文案与字体由浏览器渲染成位图后保存，位置与缩放实时生效'
            : '当前账号无 setting.write 权限，仅可查看'
        }
        /*
         * 真实版面是 2×2 的面板网格（样式 / 预览 / 位置缩放 / 当前位图），
         * 叠成上下两块的话数据到位时整页会重排一次。
         */
        body={
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            <SkeletonPanel rows={5} />
            <SkeletonPanel rows={5} />
            <SkeletonPanel rows={4} />
            <SkeletonPanel rows={4} />
          </div>
        }
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (!data || !spec) return <EmptyState title="暂无配置" />;

  return (
    <AdminPage
      title="AI 标识"
      description={
        editable
          ? '生成图片的显式 AIGC 角标：可改样式，也可整体关闭（关闭后仅保留文件内隐式标识）。文案与字体由浏览器渲染成位图后保存，位置与缩放实时生效'
          : '当前账号无 setting.write 权限，仅可查看'
      }
    >

      {/* 刷新失败但草稿还在：不能把编辑中的样式清掉，只提示「配置可能已过期」 */}
      {error && <StaleError error={error} onRetry={() => void reload()} />}

      {data.badge.stale && (
        <Notice tone="warn">
          当前位图是按旧样式渲染的（样式改过但没重新保存位图）。点「保存并应用」会用当前样式重新生成。
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <StylePanel spec={spec} editable={editable} onPatch={patch} />

        <div className="flex flex-col gap-4">
          <PreviewPanel spec={spec} />
          <PositionPanel spec={spec} editable={editable} onPatch={patch} />
          <CurrentBadgePanel badge={data.badge} />
        </div>
      </div>

      {editable && (
        <SaveBar>
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {dirty ? '有未保存的变更' : '当前配置已保存'}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={busy || !dirty}
              onClick={() => setSpec(data.spec)}
            >
              放弃变更
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setSpec(data.defaults)}
            >
              恢复默认样式
            </ActionButton>
            <ActionButton
              variant="default"
              size="sm"
              disabled={busy || (!dirty && !data.badge.stale)}
              onClick={openConfirm}
            >
              保存并应用
            </ActionButton>
          </div>
        </SaveBar>
      )}

      <SaveLabelConfirm
        open={confirming}
        current={data.spec}
        next={spec}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void save()}
      />
    </AdminPage>
  );
}
