import type { Page } from '@playwright/test';

const AUTH_STORAGE_KEYS = ['huojue_token', 'huojue_email', 'huojue_role'] as const;
const GUEST_PROMO_DISMISS_KEY = 'huojue-guest-promo-dismissed-v1';

/**
 * 在当前浏览器上下文建立真正的游客会话。
 *
 * admin 配置会为所有用例注入管理员 storageState。清理必须在页面脚本执行前完成，
 * 否则首屏仍会按管理员身份发起私有请求，测试看到的就不是游客业务流程。
 */
export async function prepareGuestSession(
  page: Page,
  options: { dismissPromo?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ authKeys, dismissPromo, promoKey }) => {
      authKeys.forEach((key) => localStorage.removeItem(key));
      if (dismissPromo) localStorage.setItem(promoKey, '1');
    },
    {
      authKeys: [...AUTH_STORAGE_KEYS],
      dismissPromo: options.dismissPromo ?? false,
      promoKey: GUEST_PROMO_DISMISS_KEY,
    },
  );
}
