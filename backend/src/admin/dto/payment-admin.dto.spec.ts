import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  PaymentProviderConfigUpdateDto,
  PaymentSettingsUpdateDto,
} from './payment-admin.dto';

describe('PaymentProviderConfigUpdateDto', () => {
  it('保存渠道配置不需要审计原因', async () => {
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

  it('三个设置字段均为必填', async () => {
    const dto = plainToInstance(PaymentSettingsUpdateDto, {});
    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual([
      'alipaySource',
      'defaultCurrency',
      'wechatSource',
    ]);
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
