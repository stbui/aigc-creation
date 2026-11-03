import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PublishLegalDto } from './legal.controller';

async function reasonHasError(reason?: string): Promise<boolean> {
  const dto = plainToInstance(PublishLegalDto, reason === undefined ? {} : { reason });
  const errors = await validate(dto);
  return errors.some((error) => error.property === 'reason');
}

describe('PublishLegalDto', () => {
  it('发布法务版本必须填写原因', async () => {
    await expect(reasonHasError()).resolves.toBe(true);
    await expect(reasonHasError('   ')).resolves.toBe(true);
  });

  it('发布原因长度必须为 2–200 字', async () => {
    await expect(reasonHasError('发')).resolves.toBe(true);
    await expect(reasonHasError('发'.repeat(201))).resolves.toBe(true);
  });

  it('合法原因在 trim 后通过校验', async () => {
    const dto = plainToInstance(PublishLegalDto, { reason: '  更新用户协议条款  ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('更新用户协议条款');
  });
});
