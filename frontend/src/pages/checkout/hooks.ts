/**
 * 结算页的 hooks / context 入口 —— 目录内文件的唯一 hook 来源。
 *
 * 本文件除转出 `notifyCreditsChanged`（支付成功 / 0 元领取后让顶导刷新积分），
 * 还承载结算页自有的支付状态机 `useCheckoutPayment`。
 *
 * 2026-11-04 从 `page.tsx` 抽出。抽出的边界是「怎么付」，不含「为什么付」：
 * 商品 / 会员套餐 / 续付订单的加载仍留在页面，因为那条链路决定的是结算对象；
 * 本 hook 只负责「下单 → 发起渠道支付 → 等到账 → 切结果页」。
 *
 * ⚠ `refreshPaymentStatus` 的引用必须稳定 —— 它在页面加载 effect 的依赖数组里
 * （渠道回跳时自动查单）。若此处的 useCallback 依赖发生漂移，该 effect 会反复
 * 重跑并持续打接口。现有依赖链 stopPolling([]) → completePaidOrder → 本函数
 * 全部落在稳定闭包上，改动时不要往里加会每次重建的依赖。
 *
 * 约定: `checkout/` 下的文件不从 `src/hooks` / `src/context` 直接取,
 * 一律经由本文件 —— 目录内新增依赖时在这里补一行 re-export。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_TIMEOUT_MS,
  type Phase,
  type ResultView,
} from './constants';
import { ApiError, creditsApi, ordersApi, paymentsApi } from './api';
import { blockedReasonOf, newIdempotencyKey } from './utils';
import { notifyCreditsChanged } from '../../context/CreditsContext';
import type { CreditBalance, MembershipPlan, Order, Product } from '../../types/api';
import type { PaymentIntent, PaymentProviderInfo } from '../../types/payment';

/** 余额变更通知: 支付成功 / 0 元领取后让顶导刷新积分 */
export { notifyCreditsChanged };

export interface UseCheckoutPaymentArgs {
  /** 积分商品；会员单为 null */
  product: Product | null;
  /** 会员套餐；积分单为 null */
  plan: MembershipPlan | null;
  /** 未建单前试算与下单都要带上的券码 */
  couponCode: string;
  /** 支付渠道接口需鉴权，未登录不请求 */
  token: string | null;
}

export function useCheckoutPayment({
  product,
  plan,
  couponCode,
  token,
}: UseCheckoutPaymentArgs) {
  const [order, setOrder] = useState<Order | null>(null);

  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('confirm');
  const [result, setResult] = useState<ResultView | null>(null);
  /** 真实通道的预下单结果 (微信二维码 / 支付宝跳转) */
  const [onlineIntent, setOnlineIntent] = useState<PaymentIntent | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [refreshingPayment, setRefreshingPayment] = useState(false);
  const [paymentStatusNotice, setPaymentStatusNotice] = useState<string | null>(null);

  /**
   * 可用支付渠道。
   *
   * 后端在渠道 > 1 时要求 intent 显式传 providerId；不加载列表就无法选择，
   * 用户会看到「存在多个可用支付渠道，请指定 providerId」而无法下单。
   */
  const [providers, setProviders] = useState<PaymentProviderInfo[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [helpImage, setHelpImage] = useState('');
  const [helpText, setHelpText] = useState('');

  const pollRef = useRef<number | null>(null);
  /**
   * 支付宝 App 唤起后的二维码兜底。
   *
   * App 成功切到后台时不再闪出二维码；切回页面仍未支付时立即展示备用二维码。
   * 定时器与监听器都挂在同一个 ref 上，轮询结束时统一清理，避免已进入结果页
   * 后又被迟到的 visibilitychange 拉回扫码态。
   */
  const deepLinkTimerRef = useRef<number | null>(null);
  const deepLinkVisibilityRef = useRef<(() => void) | null>(null);
  const deepLinkQrRef = useRef<string | null>(null);

  /**
   * ⚠ 必须用 ref 而非 state: 重渲染会让 state 拿到新 key,
   * 而幂等的前提是「同一次下单的所有重试用同一个 key」。
   */
  const idemKeyRef = useRef<string>(newIdempotencyKey());

  const clearDeepLinkAttempt = useCallback(() => {
    if (deepLinkTimerRef.current !== null) {
      window.clearTimeout(deepLinkTimerRef.current);
      deepLinkTimerRef.current = null;
    }
    if (deepLinkVisibilityRef.current) {
      document.removeEventListener('visibilitychange', deepLinkVisibilityRef.current);
      deepLinkVisibilityRef.current = null;
    }
    deepLinkQrRef.current = null;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    clearDeepLinkAttempt();
  }, [clearDeepLinkAttempt]);

  /** App 唤起后仅在页面仍可见时展示二维码；后台切回时再补展示。 */
  const armDeepLinkQrFallback = useCallback(
    (dataUrl: string) => {
      clearDeepLinkAttempt();
      deepLinkQrRef.current = dataUrl;
      const showIfVisible = () => {
        if (!deepLinkQrRef.current) return;
        if (document.visibilityState === 'visible') {
          setQrDataUrl(deepLinkQrRef.current);
        }
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') showIfVisible();
      };
      deepLinkVisibilityRef.current = onVisibilityChange;
      document.addEventListener('visibilitychange', onVisibilityChange);
      deepLinkTimerRef.current = window.setTimeout(() => {
        deepLinkTimerRef.current = null;
        showIfVisible();
      }, 1200);
    },
    [clearDeepLinkAttempt],
  );

  /** 渠道已确认到账：统一拉订单、刷新余额并切到结果页。 */
  const completePaidOrder = useCallback(
    async (orderId: string) => {
      stopPolling();
      const fresh = await ordersApi.detail(orderId);
      setOrder(fresh);
      setQrDataUrl(null);
      setOnlineIntent(null);
      setPaymentStatusNotice(null);
      notifyCreditsChanged();
      let balance: CreditBalance | null = null;
      try {
        balance = await creditsApi.balance();
      } catch {
        /* 余额回查失败不阻断结果展示 */
      }
      setResult({
        kind: 'success',
        title: '支付成功',
        desc: fresh.grantedCredits > 0 ? `${fresh.grantedCredits} 积分已到账` : '权益已生效',
        order: fresh,
        balance,
      });
      setPhase('result');
    },
    [stopPolling],
  );

  /**
   * 主动向渠道查单。
   *
   * `silent` 用于渠道同步跳回时自动确认；手动点击则会展示“尚未到账”等反馈。
   * 后端 POST /query 会绕过轮询节流，因此用户刚回来就点也能真正请求渠道。
   */
  const refreshPaymentStatus = useCallback(
    async (orderId: string, silent = false) => {
      if (!silent) {
        setError(null);
        setPaymentStatusNotice(null);
      }
      setRefreshingPayment(true);
      try {
        const state = await paymentsApi.query(orderId);
        if (state.status === 'paid') {
          await completePaidOrder(orderId);
          return;
        }
        if (state.status === 'cancelled' || state.status === 'refunded') {
          stopPolling();
          setQrDataUrl(null);
          setOnlineIntent(null);
          setError(`订单已${state.status === 'cancelled' ? '取消' : '退款'}，本次未完成支付。`);
          return;
        }
        if (!silent) {
          setPaymentStatusNotice('暂未查询到到账结果。若刚完成支付，请等待几秒后再次刷新。');
        }
      } catch (e) {
        const message = (e as Error).message || '支付状态查询失败，请稍后重试';
        setPaymentStatusNotice(silent ? `自动查单失败：${message}` : message);
        if (!silent) setError(message);
      } finally {
        setRefreshingPayment(false);
      }
    },
    [completePaidOrder, stopPolling],
  );

  /*
   * 支付渠道是全局配置，不依赖具体商品；进入结算页就拉一次。
   * 未登录不请求（/payments/providers 需鉴权），避免结算页首屏多一个 401。
   */
  useEffect(() => {
    if (!token) {
      setProviders([]);
      setSelectedProviderId('');
      setProvidersError(null);
      return;
    }
    let alive = true;
    setProvidersLoading(true);
    setProvidersError(null);
    paymentsApi
      .providers()
      .then((res) => {
        if (!alive) return;
        setProviders(res.items);
        setSelectedProviderId((prev) => {
          if (prev && res.items.some((p) => p.id === prev)) return prev;
          return res.items[0]?.id ?? '';
        });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setProviders([]);
        setSelectedProviderId('');
        setProvidersError((e as Error).message || '支付渠道加载失败');
      })
      .finally(() => {
        if (alive) setProvidersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  /** 帮助信息是公开设置，不依赖登录态；加载失败时静默隐藏，不阻断支付。 */
  useEffect(() => {
    let alive = true;
    paymentsApi
      .settings()
      .then((settings) => {
        if (!alive) return;
        setHelpImage(settings.helpImage || '');
        setHelpText(settings.helpText || '');
      })
      .catch(() => {
        if (!alive) return;
        setHelpImage('');
        setHelpText('');
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 下单。重复调用复用同一 key, 后端返回同一订单 */
  const placeOrder = useCallback(async (): Promise<Order> => {
    if (!product && !plan) throw new Error('商品未加载');
    if (order) return order; // 已建过单, 不重复建

    const created = await ordersApi.create({
      ...(plan
        ? {
            membershipPlanId: plan.id,
            // 会员单不接受券: 传了会被后端忽略并在 couponWarning 里说明,
            // 这里干脆不传, 免得用户以为折扣生效了
          }
        : {
            productId: product!.id,
            quantity: 1,
            couponCode: couponCode.trim() || undefined,
          }),
      idempotencyKey: idemKeyRef.current,
    });
    setOrder(created);
    return created;
  }, [product, plan, order, couponCode]);

  // 组件卸载时务必停掉轮询 —— 否则离开页面后仍在打接口, 且会在已卸载组件上 setState
  useEffect(() => stopPolling, [stopPolling]);

  /**
   * 轮询支付结果。
   *
   * 真实通道到账是**渠道回调**驱动的, 前端没有任何办法「知道」支付完成,
   * 只能问后端。5 分钟上限与订单过期时间一致: 超过之后即使到账,
   * 订单也已经不该被当作有效支付, 用户需要去订单页确认。
   */
  const startPolling = useCallback(
    (orderId: string, expiresAt?: string) => {
      stopPolling();
      const parsedDeadline = expiresAt ? new Date(expiresAt).getTime() : NaN;
      const deadline = Number.isFinite(parsedDeadline)
        ? parsedDeadline
        : Date.now() + PAYMENT_POLL_TIMEOUT_MS;
      pollRef.current = window.setInterval(async () => {
        if (Date.now() > deadline) {
          stopPolling();
          setQrDataUrl(null);
          setOnlineIntent(null);
          setError('支付确认超时。若已扣款，请稍后在「我的订单」查看状态');
          return;
        }
        try {
          const st = await paymentsApi.status(orderId);
          if (st.status !== 'paid') {
            // 渠道侧取消 / 关单后停止轮询，不要继续空转到截止时间
            if (st.status === 'cancelled' || st.status === 'refunded') {
              stopPolling();
              setQrDataUrl(null);
              setOnlineIntent(null);
              setError(`订单已${st.status === 'cancelled' ? '取消' : '退款'}，本次未完成支付。`);
            }
            return;
          }
          stopPolling();
          await completePaidOrder(orderId);
        } catch (e) {
          /*
           * 401/403 不是网络抖动：会话已失效或账号被禁用，继续轮询只会让
           * 用户等满整个订单有效期。网络/5xx 才继续下一轮。
           */
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            stopPolling();
            setQrDataUrl(null);
            setOnlineIntent(null);
            setError(e.message || '登录状态已失效，请重新登录后到「我的订单」查看结果');
          }
          // 其余单次失败不中断
        }
      }, PAYMENT_POLL_INTERVAL_MS);
    },
    [completePaidOrder, stopPolling],
  );

  /**
   * 真实通道支付。
   *
   * 五种 mode 的处理:
   *   sandbox      → 当前环境没配真实通道, 如实走站内模拟 (并保留沙箱声明)
   *   redirect     → 直接跳渠道收银台 (支付宝网页支付)
   *   qrcode       → 用 codeUrl 渲染二维码并开始轮询 (微信 Native)
   *   qrcode-image → codeUrl 本身就是二维码图片, 直接展示并开始轮询
   *   payment-element → 展示 Stripe Payment Element，确认后继续轮询
   */
  const payOnline = async () => {
    setPaying(true);
    setError(null);
    try {
      const o = order ?? (await placeOrder());
      const blocked = blockedReasonOf(o);
      if (blocked) {
        setError(blocked);
        return;
      }
      if (providersLoading) {
        setError('正在读取支付渠道，请稍候再试');
        return;
      }
      if (providers.length > 1 && !selectedProviderId) {
        setError('请先选择支付方式');
        return;
      }
      // 多通道路由：providers 已在进页面时加载；单渠道可留空由后端兜底，
      // 多渠道必须显式传，否则后端 400。
      const intent = await paymentsApi.intent(o.id, selectedProviderId || undefined);

      /*
       * 0 元单（免费体验包 / 100% 优惠）：后端在 createIntent 里已经直接入账，
       * 这里只负责把结果拿到并刷新余额。此前后端对 0 元单直接报错，
       * 「免费领取」是一条永远走不通的路。
       */
      if (intent.mode === 'free') {
        const fresh = await ordersApi.detail(o.id);
        setOrder(fresh);
        notifyCreditsChanged();
        let balance: CreditBalance | null = null;
        try {
          balance = await creditsApi.balance();
        } catch {
          /* 余额回查失败不阻断结果展示 */
        }
        setResult({
          kind: 'success',
          title: '领取成功',
          desc:
            fresh.grantedCredits > 0
              ? `${fresh.grantedCredits} 积分已到账`
              : '订单已完成',
          order: fresh,
          balance,
        });
        setPhase('result');
        return;
      }

      if (intent.mode === 'sandbox') {
        await pay('success');
        return;
      }
      if (intent.mode === 'redirect' && intent.payUrl) {
        window.location.href = intent.payUrl;
        return;
      }
      if (intent.mode === 'qrcode' && intent.codeUrl) {
        const dataUrl = await QRCode.toDataURL(intent.codeUrl, { width: 220, margin: 1 });
        setOnlineIntent(intent);
        // 以渠道返回的订单过期时间为轮询截止，而不是固定的 5 分钟
        startPolling(o.id, intent.expiresAt);
        if (intent.schemeUrl) {
          /*
           * 必须先把兜底与轮询装好，再同步尝试 App Scheme。App 成功接管时
           * 页面进入后台，定时器到点不会弹二维码；用户切回未支付时监听器补弹。
           */
          armDeepLinkQrFallback(dataUrl);
          try {
            window.location.assign(intent.schemeUrl);
          } catch {
            // 浏览器拒绝自定义协议时直接展示二维码，轮询仍在继续。
            setQrDataUrl(dataUrl);
          }
        } else {
          setQrDataUrl(dataUrl);
        }
        return;
      }
      if (intent.mode === 'qrcode-image' && intent.codeUrl) {
        // 渠道直接给了二维码图片地址，不能再次编码成二维码
        setQrDataUrl(intent.codeUrl);
        setOnlineIntent(intent);
        startPolling(o.id, intent.expiresAt);
        return;
      }
      if (intent.mode === 'payment-element') {
        if (!intent.clientSecret || !intent.publishableKey) {
          setError('Stripe 支付参数不完整，请联系客服');
          return;
        }
        setQrDataUrl(null);
        setOnlineIntent(intent);
        startPolling(o.id, intent.expiresAt);
        return;
      }
      setError('支付通道返回了无法识别的方式，请联系客服');
    } catch (e) {
      setError((e as Error).message || '发起支付失败');
    } finally {
      setPaying(false);
    }
  };

  /**
   * 沙箱支付三态演示。
   *
   * ⚠ `failed` 场景订单仍为 pending (可重试), 因此**不能**转结果页终态 ——
   * 用户要能直接再点一次成功。timeout 才是终态 (订单已 cancelled)。
   */
  const pay = async (scenario: 'success' | 'failed' | 'timeout') => {
    setPaying(true);
    setError(null);
    try {
      const o = order ?? (await placeOrder());
      const blocked = blockedReasonOf(o);
      if (blocked) {
        setError(blocked);
        return;
      }
      const res = await ordersApi.sandboxPay(o.id, scenario);
      const paid = res.order;
      setOrder(paid);

      if (scenario === 'failed') {
        // 保持确认页, 让用户可以改场景重试
        setError(res.message || '支付失败，可重新发起支付');
        return;
      }

      let balance: CreditBalance | null = null;
      try {
        balance = await creditsApi.balance();
      } catch {
        // 余额回查失败不阻断结果展示 —— 支付结果本身已落库, 余额可去明细页看
      }
      // 通知顶导刷新 (发积分已发生)。支付成功与超时都要通知:
      // 超时虽然没发积分, 但订单状态变了, 用户可能从别处进来看到旧数据
      notifyCreditsChanged();

      if (scenario === 'success') {
        setResult({
          kind: 'success',
          title: '支付成功',
          desc: `${paid.grantedCredits} 积分已到账`,
          order: paid,
          balance,
        });
      } else {
        setResult({
          kind: 'timeout',
          title: '支付超时',
          desc: '订单已关闭，未产生扣款',
          order: paid,
          balance,
        });
      }
      setPhase('result');
    } catch (e) {
      setError((e as Error).message || '支付失败');
    } finally {
      setPaying(false);
    }
  };
  return {
    order,
    setOrder,
    paying,
    error,
    setError,
    phase,
    result,
    onlineIntent,
    setOnlineIntent,
    qrDataUrl,
    setQrDataUrl,
    refreshingPayment,
    paymentStatusNotice,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    providersLoading,
    providersError,
    helpImage,
    helpText,
    stopPolling,
    refreshPaymentStatus,
    payOnline,
  };
}
