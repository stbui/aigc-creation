import { LoginGiftArt } from './LoginGiftArt';

/** 参考站左栏两行礼遇 (auth-showcase-benefit-row × 3 / × 4) 的本地化文案 */
const BENEFIT_GROUPS: Array<{ key: 'signup' | 'usage'; items: string[] }> = [
  { key: 'signup', items: ['新用户注册', '老用户签到', '每邀请 1 位好友'] },
  { key: 'usage', items: ['AI 生图', 'AI 修图', 'AI 抠图', '去水印'] },
];

/*
 * 权益数字必须与后端一致, 不能照抄参考站:
 *   · 注册不发积分 (auth.service 建号时不写 CreditLot);
 *   · 签到基础 5 分 (seed-marketing 的 CheckinRule), 第 3/7/15 天有加成;
 *   · 邀请是邀请人 200 / 被邀请人 100, 且首次付费才触发;
 *   · 生图价格按能力 0~40 不等 (matting/remove_watermark 为 0)。
 * 写死「注册送 100 / 签到送 150 / 邀请送 600」属于全站可见的虚假承诺。
 */
function benefitValue(group: string, item: string): string {
  if (group === 'signup') {
    if (item === '新用户注册') return '注册即可使用';
    if (item === '老用户签到') return '每日 5 积分起';
    return '邀请双方得积分';
  }
  if (item === 'AI 生图') return '10 积分起';
  if (item === 'AI 修图') return '5 积分起';
  return '免费';
}

/** 登录卡左栏礼宾面板 (参考站 .auth-showcase)，纯展示，不参与表单。 */
export function AuthShowcase() {
  return (
    <aside className="login-showcase" aria-hidden>
      <div className="login-showcase-bg" />
      <LoginGiftArt />
      <div className="login-showcase-content">
        <h1 className="login-showcase-title">登录即享好礼</h1>
        <div className="login-showcase-benefits">
          {BENEFIT_GROUPS.map((g) => (
            <div key={g.key} className="login-benefit">
              {g.items.map((it) => (
                <div key={it} className="login-benefit-row">
                  <span className="login-benefit-name">{it}</span>
                  <span className="login-benefit-value">{benefitValue(g.key, it)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
