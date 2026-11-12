import { CalendarCheck, Flame, Gift } from 'lucide-react';

import type { CheckinStatus } from './constants';
import { Button } from './components';
import { formatForecastDay } from './utils';

interface InviteCheckinBlockProps {
  checkin: CheckinStatus;
  submitting: boolean;
  onCheckin: () => void;
}

/** 每日签到：连续天数、今日可得与未来 7 天加成。 */
export function InviteCheckinBlock({ checkin, submitting, onCheckin }: InviteCheckinBlockProps) {
  const { rule } = checkin;

  return (
    <section className="invite-block">
      <div className="invite-block-head">
        <h2>
          <CalendarCheck size={16} aria-hidden /> 每日签到
        </h2>
        <span className="invite-block-sub">连续签到有额外加成</span>
      </div>

      <div className="invite-checkin">
        <div className="invite-checkin-stats">
          <div className="invite-checkin-stat">
            <span className="invite-metric-label">
              <Flame size={13} aria-hidden /> 连续签到
            </span>
            <span className="invite-checkin-value">
              {checkin.streak}
              <em>天</em>
            </span>
          </div>
          {/* 签到关闭时不能写「今日可得 N 积分」—— 那是一个拿不到的数字 */}
          <div className="invite-checkin-stat">
            <span className="invite-metric-label">
              <Gift size={13} aria-hidden />{' '}
              {!rule.enabled ? '签到状态' : checkin.checkedIn ? '今日已得' : '今日可得'}
            </span>
            <span className={`invite-checkin-value${rule.enabled ? '' : ' is-text'}`}>
              {!rule.enabled ? '未开启' : checkin.checkedIn ? checkin.todayCredits : checkin.nextCredits}
              {rule.enabled && <em>积分</em>}
            </span>
          </div>
        </div>
        <Button
          type="primary"
          size="large"
          className="invite-checkin-btn"
          onClick={onCheckin}
          loading={submitting}
          disabled={checkin.checkedIn || !rule.enabled}
        >
          {checkin.checkedIn
            ? `今日已签到 +${checkin.todayCredits}`
            : rule.enabled
              ? '立即签到'
              : '签到未开启'}
        </Button>
      </div>

      {/* 未来 7 天: 让用户看清连签到第 3/7 天各能多拿多少 */}
      {rule.enabled && checkin.forecast.length > 0 && (
        <ol className="invite-checkin-days" aria-label="未来 7 天签到可得">
          {checkin.forecast.slice(0, 7).map((forecast) => {
            const isToday = forecast.day === checkin.today;
            const isBonus = forecast.credits > rule.baseCredits;
            return (
              <li
                key={forecast.day}
                className={`${isToday ? 'is-today' : ''}${isBonus ? ' is-bonus' : ''}`.trim()}
              >
                <span className="invite-checkin-day">
                  {isToday ? '今天' : formatForecastDay(forecast.day)}
                </span>
                <span className="invite-checkin-streak">第 {forecast.streak} 天</span>
                <strong>+{forecast.credits}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
