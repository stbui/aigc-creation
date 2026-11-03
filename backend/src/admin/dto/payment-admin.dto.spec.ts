import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PaymentProviderConfigUpdateDto } from './payment-admin.dto';

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
