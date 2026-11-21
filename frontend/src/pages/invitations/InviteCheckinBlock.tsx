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
    <section className="rounded-xl border border-border bg-card px-6 pt-[22px] pb-6 max-[640px]:px-4 max-[640px]:pt-[18px] max-[640px]:pb-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-foreground">
          <CalendarCheck size={16} aria-hidden /> 每日签到
        </h2>
        <span className="text-xs leading-[18px] text-muted-foreground">连续签到有额外加成</span>
      </div>

      <div className="flex flex-wrap items-stretch gap-4 max-[640px]:flex-col max-[640px]:gap-3">
        <div className="flex min-w-0 flex-[1_1_320px] gap-3 max-[640px]:flex-none">
          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-1.5 rounded-lg bg-page px-4 py-3.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame size={13} aria-hidden /> 连续签到
            </span>
            <span className="text-2xl leading-[30px] font-bold text-foreground tabular-nums">
              {checkin.streak}
              <em className="ml-1 text-xs font-medium not-italic text-muted-foreground">天</em>
            </span>
          </div>
          {/* 签到关闭时不能写「今日可得 N 积分」—— 那是一个拿不到的数字 */}
          <div className="flex min-w-0 flex-[1_1_0] flex-col gap-1.5 rounded-lg bg-page px-4 py-3.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Gift size={13} aria-hidden />
                {' '}
              {!rule.enabled ? '签到状态' : checkin.checkedIn ? '今日已得' : '今日可得'}
            </span>
            <span
              className={`leading-[30px] tabular-nums ${
                rule.enabled
                  ? 'text-2xl font-bold text-foreground'
                  : 'text-[15px] font-medium text-muted-foreground'
              }`}
            >
              {!rule.enabled ? '未开启' : checkin.checkedIn ? checkin.todayCredits : checkin.nextCredits}
              {rule.enabled && <em className="ml-1 text-xs font-medium not-italic text-muted-foreground">积分</em>}
            </span>
          </div>
        </div>
        <Button
          variant="default"
          size="lg"
          className="h-[42px] min-w-[148px] self-center max-[640px]:w-full"
          onClick={onCheckin}
          disabled={checkin.checkedIn || !rule.enabled || submitting}
        >
          {submitting && <span className="state-spinner is-small" aria-hidden />}
          {checkin.checkedIn
            ? `今日已签到 +${checkin.todayCredits}`
            : rule.enabled
              ? '立即签到'
              : '签到未开启'}
        </Button>
      </div>

      {/* 未来 7 天: 让用户看清连签到第 3/7 天各能多拿多少 */}
      {rule.enabled && checkin.forecast.length > 0 && (
        <ol
          className="mt-4 mb-0 grid list-none grid-cols-7 gap-2 p-0 max-[640px]:flex max-[640px]:gap-2 max-[640px]:overflow-x-auto max-[640px]:pb-1 max-[640px]:[scrollbar-width:thin]"
          aria-label="未来 7 天签到可得"
        >
          {checkin.forecast.slice(0, 7).map((forecast) => {
            const isToday = forecast.day === checkin.today;
            const isBonus = forecast.credits > rule.baseCredits;
            return (
              <li
                key={forecast.day}
                className={`flex flex-col items-center gap-0.5 rounded-md px-1.5 py-2.5 max-[640px]:w-[68px] max-[640px]:shrink-0 ${
                  isToday ? 'bg-brand-bg' : 'bg-page'
                }`}
              >
                <span className={`text-xs font-semibold ${isToday ? 'text-brand' : 'text-muted-foreground'}`}>
                  {isToday ? '今天' : formatForecastDay(forecast.day)}
                </span>
                <span className="text-xs text-muted-foreground">第 {forecast.streak} 天</span>
                <strong className={`text-sm tabular-nums ${isBonus ? 'text-brand' : 'text-foreground'}`}>
                  +{forecast.credits}
                </strong>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
