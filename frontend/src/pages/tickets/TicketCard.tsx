import { ChevronRight } from 'lucide-react';
import type { Ticket } from '../../types/api';
import { STATUS_LABELS } from './constants';
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
      className={`ticket-card${active ? ' is-active' : ''}`}
      onClick={onOpen}
    >
      <span className="ticket-card-main">
        <span className="ticket-card-row">
          <span className="ticket-card-title">{t.subject}</span>
          {t.priority === 'high' && <span className="ticket-card-flag">高优先级</span>}
        </span>
        <span className="ticket-card-sub">
          <span>{t.ticketNo}</span>
          <span>{t.typeLabel}</span>
          <span>{formatDateTime(t.createdAt)}</span>
          {t.replyCount ? <span>{t.replyCount} 条回复</span> : null}
        </span>
      </span>
      <span className="ticket-card-side">
        <span className={`ticket-status is-${t.status}`}>{STATUS_LABELS[t.status]}</span>
        <ChevronRight size={15} className="ticket-card-arrow" aria-hidden />
      </span>
    </button>
  );
}
