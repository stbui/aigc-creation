import { useEffect, useMemo, useState } from 'react';
import type { PopupCampaign } from '../types/api';

export interface CampaignCountdownParts {
  days: number;
  hours: string;
  minutes: string;
  seconds: string;
}

/**
 * 营销活动倒计时。基准取服务端 `serverNow`, 本地只负责走秒。
 *
 * 偏移量用 useMemo 一次算定: 若每次渲染重算, 已过去的秒数会被抵消,
 * 倒计时永远停在起点。组件消费 `remainText` 做通栏文案, 弹层消费
 * `parts` 渲染参考站的 HH:MM:SS 数字块, 两边共用同一时间口径。
 */
export function useCampaignCountdown(campaign: PopupCampaign | null) {
  const [remainText, setRemainText] = useState('');
  const [parts, setParts] = useState<CampaignCountdownParts | null>(null);
  const [expired, setExpired] = useState(false);

  const skewMs = useMemo(() => {
    if (!campaign) return 0;
    return new Date(campaign.serverNow).getTime() - Date.now();
  }, [campaign]);

  useEffect(() => {
    if (!campaign) {
      setRemainText('');
      setParts(null);
      setExpired(false);
      return;
    }

    const tick = () => {
      const serverNow = Date.now() + skewMs;
      const left = new Date(campaign.endAt).getTime() - serverNow;
      if (left <= 0) {
        setRemainText('');
        setParts(null);
        setExpired(true);
        return;
      }
      setExpired(false);

      const totalSec = Math.floor(left / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      const pad = (n: number) => String(n).padStart(2, '0');

      setParts({ days, hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) });
      setRemainText(
        days > 0
          ? `${days} 天 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
          : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
      );
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [campaign, skewMs]);

  return { remainText, parts, expired };
}
