import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  PaymentExceptionConfirmRefundDto,
  PaymentProviderConfigUpdateDto,
  PaymentSettingsUpdateDto,
} from './payment-admin.dto';

describe('PaymentProviderConfigUpdateDto', () => {
  it('保存渠道配置不要求额外原因', async () => {
    const dto = plainToInstance(PaymentProviderConfigUpdateDto, {
      enabled: true,
      closeAfterMinutes: 30,
      values: {},
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('仍校验渠道配置字段', async () => {
    const dto = plainToInstance(PaymentProviderConfigUpdateDto, {
      enabled: true,
      closeAfterMinutes: 4,
      values: {},
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'closeAfterMinutes')).toBe(true);
  });
});

describe('PaymentSettingsUpdateDto', () => {
  it('接受合法币种和三种来源值', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {
      defaultCurrency: 'CNY',
      alipaySource: 'official',
      wechatSource: 'epay',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('允许只提交需要修改的设置字段', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {
      defaultCurrency: 'USD',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('空对象可通过 DTO 校验，由服务层拒绝无变更请求', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {});
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('币种只允许 CNY / USD', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {
      defaultCurrency: 'EUR',
      alipaySource: 'unset',
      wechatSource: 'unset',
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'defaultCurrency')).toBe(true);
  });

  it('支付来源只允许 unset / official / epay', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {
      defaultCurrency: 'USD',
      alipaySource: 'stripe',
      wechatSource: 'sandbox',
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'alipaySource')).toBe(true);
    expect(errors.some((error) => error.property === 'wechatSource')).toBe(true);
  });
});


describe('PaymentExceptionConfirmRefundDto', () => {
  it('接受成功/失败核销与可选渠道退款单号', async () => {
    const dto = plainToInstance(PaymentExceptionConfirmRefundDto, {
      outcome: 'succeeded',
      providerRefundId: 'wx-refund-1',
      reason: '渠道商户后台已核对退款成功',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('拒绝非法核销结果、过短依据和超长渠道退款单号', async () => {
    const dto = plainToInstance(PaymentExceptionConfirmRefundDto, {
      outcome: 'maybe',
      providerRefundId: 'x'.repeat(201),
      reason: '短',
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'outcome')).toBe(true);
    expect(errors.some((error) => error.property === 'providerRefundId')).toBe(true);
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });
});
