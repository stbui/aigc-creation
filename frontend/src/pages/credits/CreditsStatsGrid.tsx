import type { CreditBalance } from '../../types/api';
import { Surface, SurfaceContent } from './components';

interface CreditsStatsGridProps {
  balance: CreditBalance | null;
}

/** 余额下方的四项汇总：批次数、累计获得、生成消耗、30 天内到期。 */
export function CreditsStatsGrid({ balance }: CreditsStatsGridProps) {
  const stats = [
    /*
     * 不再放「可用余额」：上面的 hero 已经给了同一个数，两张卡片并排
     * 重复只会让页面看起来像两套账。这里换成批次数，回答 hero 那个数字
     * 是由几笔积分拼出来的。
     */
    { label: '可用批次', value: balance?.activeLots },
    { label: '累计获得', value: balance?.totalEarned },
    /*
     * 后端 totalConsumed 只统计 type='consume' 的流水（人工扣减走 admin_adjust、
     * 退款扣回走 refund_reclaim、到期走 expire，都不计入）。标成「累计消耗」会
     * 让人拿「获得 - 消耗」去对余额，一旦有到期或人工扣减就对不上；
     * 用「生成消耗」与流水里的类型名一致。
     */
    { label: '生成消耗', value: balance?.totalConsumed },
    { label: '30 天内到期', value: balance?.expiringSoon, warn: (balance?.expiringSoon ?? 0) > 0 },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {stats.map((item) => (
        <Surface key={item.label}>
          <SurfaceContent className="px-4 py-3.5">
            <div className="mb-1 text-xs text-muted-foreground">{item.label}</div>
            <div className={`text-[22px] font-bold ${item.warn ? 'text-warn-text' : 'text-foreground'}`}>
              {item.value ?? '—'}
            </div>
          </SurfaceContent>
        </Surface>
      ))}
    </div>
  );
}
