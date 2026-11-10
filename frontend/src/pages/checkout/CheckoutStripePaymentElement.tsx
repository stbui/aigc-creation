import { useMemo, useState, type FormEvent } from 'react';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

const stripeCache = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  const cached = stripeCache.get(publishableKey);
  if (cached) return cached;
  const promise = loadStripe(publishableKey);
  stripeCache.set(publishableKey, promise);
  return promise;
}

/** Stripe 回跳时保留结算页路径，并带上续付所需订单号。 */
export function stripeReturnUrl(orderId: string, currentHref: string): string {
  const url = new URL(currentHref);
  url.searchParams.set('orderId', orderId);
  url.searchParams.set('paymentReturn', '1');
  return url.toString();
}

export function CheckoutStripePaymentElement({
  orderId,
  clientSecret,
  publishableKey,
  returnUrl,
}: {
  orderId: string;
  clientSecret: string;
  publishableKey: string;
  returnUrl?: string;
}) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);
  const resolvedReturnUrl =
    returnUrl || stripeReturnUrl(orderId, window.location.href);

  return (
    <div className="co-stripe">
      <Elements
        key={clientSecret}
        stripe={stripePromise}
        options={{ clientSecret }}
      >
        <StripePaymentForm returnUrl={resolvedReturnUrl} />
      </Elements>
    </div>
  );
}

function StripePaymentForm({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setSubmitted(false);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: 'if_required',
      });
      if (result.error) {
        setError(result.error.message || '支付确认失败，请检查支付信息后重试');
        return;
      }
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message || '支付确认失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="co-stripe-form" onSubmit={(event) => void handleSubmit(event)}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <button
        type="submit"
        className="co-pay-btn"
        disabled={!stripe || !elements || submitting}
      >
        {submitting ? '正在确认支付…' : '确认支付'}
      </button>
      <p className="co-hint">支付信息由 Stripe 安全处理，本页不会保存卡号。</p>
      {submitted && (
        <p className="co-hint" role="status">
          支付已提交，正在确认到账结果。
        </p>
      )}
      {error && (
        <p className="co-hint is-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
