import { ChevronRight } from 'lucide-react';
import type { Ticket } from '../../types/api';
import { STATUS_LABELS, STATUS_PILL, STATUS_TONE } from './constants';
import { formatDateTime } from './utils';

/**
 * 工单列表卡片。
 *
 * 整张卡是一个按钮：点击进入同页详情，不弹抽屉 —— 桌面端与手机共用一套交互。
 */
export interface TicketCardProps {
  ticket: Ticket;
  /** 当前详情是否为这张工单 */
  active: boolean;
  onOpen: () => void;
}

export function TicketCard({ ticket: t, active, onOpen }: TicketCardProps) {
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-4 rounded-xl border bg-card px-[18px] py-4 text-left transition-[border-color,box-shadow] hover:border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] hover:shadow-card max-[640px]:gap-2.5 max-[640px]:p-3.5 ${
        active ? 'border-brand' : 'border-border'
      }`}
      onClick={onOpen}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2 max-[640px]:flex-wrap">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground max-[640px]:line-clamp-2 max-[640px]:whitespace-normal">
            {t.subject}
          </span>
          {t.priority === 'high' && (
            <span className="flex-none rounded-sm bg-warn-soft px-1.5 py-px text-xs leading-4 font-medium text-warn-text">
              高优先级
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-x-1.5 text-xs leading-[18px] text-muted-foreground [&>span+span]:before:mr-1.5 [&>span+span]:text-muted-foreground/60 [&>span+span]:content-['·']">
          <span>{t.ticketNo}</span>
          <span>{t.typeLabel}</span>
          <span>{formatDateTime(t.createdAt)}</span>
          {t.replyCount ? <span>{t.replyCount} 条回复</span> : null}
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        <span className={`${STATUS_PILL} ${STATUS_TONE[t.status]}`}>{STATUS_LABELS[t.status]}</span>
        <ChevronRight size={15} className="text-muted-foreground" aria-hidden />
      </span>
    </button>
  );
}