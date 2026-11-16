import { Skeleton } from '../../../admin-ui/primitives';

/**
 * 通用加载态：标题占位 + 内容占位，加载期间不闪白。
 *
 * 用在**还知道自己在加载哪一页**之前的两处：路由 chunk 的 Suspense 兜底、
 * 以及后台身份校验期间的骨架。这两处都不知道页面标题，所以标题只能是灰条；
 * 等页面自己渲染后，它会换成真实标题（见各页的 `PageSkeleton`）。
 */
export function AdminLoading({ tip }: { tip: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div>
        <Skeleton rows={1} className="max-w-[260px]" />
        <p className="mt-2 text-xs text-muted-foreground">{tip}</p>
      </div>
      <Skeleton rows={6} />
    </div>
  );
}
