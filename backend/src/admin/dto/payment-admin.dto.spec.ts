import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  PaymentOrderActionDto,
  PaymentProviderConfigUpdateDto,
} from './payment-admin.dto';

describe('PaymentProviderConfigUpdateDto', () => {
  it('保存渠道配置不要求填写变更原因', async () => {
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

describe('PaymentOrderActionDto', () => {
  it('查单/关单必须填写操作原因', async () => {
    const dto = plainToInstance(PaymentOrderActionDto, {});

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });

  it('操作原因至少 2 个字符且最多 200 个字符', async () => {
    const tooShort = plainToInstance(PaymentOrderActionDto, { reason: '查' });
    const tooLong = plainToInstance(PaymentOrderActionDto, {
      reason: '查'.repeat(201),
    });

    await expect(validate(tooShort)).resolves.not.toHaveLength(0);
    await expect(validate(tooLong)).resolves.not.toHaveLength(0);
  });

  it('纯空白原因视为未填写', async () => {
    const dto = plainToInstance(PaymentOrderActionDto, { reason: '   ' });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('合法原因通过校验', async () => {
    const dto = plainToInstance(PaymentOrderActionDto, {
      reason: '用户反馈已付款但页面未到账',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
