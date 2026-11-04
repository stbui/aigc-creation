import { Images } from 'lucide-react';

import type { WorksTab } from './useWorksFilters';

/**
 * 我的作品 · 空态。
 *
 * 2026-11-04 从 `page.tsx` 抽出。两种空态必须分开：访客看到的不是「没有作品」
 * 而是「登录后才有」，已登录用户看到的才是真空态或筛选无结果 —— 三种情况给
 * 同一个「还没有作品」会让人以为产出丢了。
 */

/** 访客态：作品与账号绑定，直接给登录入口 */
export function WorksGuestState({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="my-works-empty">
      <Images size={72} strokeWidth={1.35} aria-hidden="true" />
      <h2>登录后查看你的作品</h2>
      <p>作品与账号绑定，登录后即可查看、下载并继续创作。</p>
      <button type="button" className="my-works-empty-action" onClick={onLogin}>
        登录/注册
      </button>
    </div>
  );
}

/**
 * 已登录但网格为空。
 *
 * 有筛选条件时不引导去创作（用户已经在找东西，不是没东西），只提示放宽条件；
 * 无筛选时才说明该类作品从哪来，并给「去创作」。
 */
export function WorksNoWorksState({
  tab,
  activeFilterCount,
  onGoCreate,
}: {
  tab: WorksTab;
  activeFilterCount: number;
  onGoCreate: () => void;
}) {
  return (
    <div className="my-works-empty">
      <Images size={72} strokeWidth={1.35} aria-hidden="true" />
      <h2>
        {activeFilterCount === 0
          ? tab === 'video'
            ? '还没有视频作品'
            : '还没有作品'
          : tab === 'video'
            ? '没有符合条件的视频'
            : '没有符合条件的作品'}
      </h2>
      <p>
        {activeFilterCount > 0
          ? '试试放宽筛选条件，或清除全部筛选。'
          : tab === 'video'
            ? '视频作品来自「图生视频」能力，完成后会出现在这里。'
            : '完成一次创作后，作品会出现在这里。'}
      </p>
      {activeFilterCount === 0 && (
        <button type="button" className="my-works-empty-action" onClick={onGoCreate}>
          去创作
        </button>
      )}
    </div>
  );
}
