import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmPayment } = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useElements: () => ({}),
  useStripe: () => ({ confirmPayment }),
}));

import {
  CheckoutStripePaymentElement,
  stripeReturnUrl,
} from '../CheckoutStripePaymentElement';

describe('CheckoutStripePaymentElement', () => {
  beforeEach(() => {
    confirmPayment.mockReset().mockResolvedValue({});
  });

  it('回跳地址保留当前页面查询参数并追加续付标记', () => {
    const result = stripeReturnUrl(
      'order_1',
      'https://shop.example.com/checkout/sku_1?from=pay#summary',
    );

    expect(result).toBe(
      'https://shop.example.com/checkout/sku_1?from=pay&orderId=order_1&paymentReturn=1#summary',
    );
  });

  it('确认支付时使用服务端回跳地址并显示提交状态', async () => {
    render(
      <CheckoutStripePaymentElement
        orderId="order_1"
        clientSecret="pi_1_secret"
        publishableKey="pk_test_1"
        returnUrl="https://shop.example.com/checkout/sku_1?orderId=order_1&paymentReturn=1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认支付' }));

    await waitFor(() => {
      expect(confirmPayment).toHaveBeenCalledWith({
        elements: {},
        confirmParams: {
          return_url:
            'https://shop.example.com/checkout/sku_1?orderId=order_1&paymentReturn=1',
        },
        redirect: 'if_required',
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      '支付已提交，正在确认到账结果。',
    );
  });

  it('Stripe 返回错误时展示可读提示', async () => {
    confirmPayment.mockResolvedValue({ error: { message: '卡被拒绝' } });
    render(
      <CheckoutStripePaymentElement
        orderId="order_1"
        clientSecret="pi_1_secret"
        publishableKey="pk_test_1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '确认支付' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('卡被拒绝');
  });
});
