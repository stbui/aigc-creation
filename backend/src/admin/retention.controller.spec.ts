import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RetentionCleanupDto, RetentionPreviewQueryDto } from './retention.controller';

async function reasonHasError(input: Record<string, unknown>): Promise<boolean> {
  const dto = plainToInstance(RetentionCleanupDto, input);
  const errors = await validate(dto);
  return errors.some((error) => error.property === 'reason');
}

describe('RetentionCleanupDto', () => {
  it('清理原因必填，纯空白不能绕过', async () => {
    await expect(reasonHasError({ target: 'AdminAuditLog', retentionDays: 180 })).resolves.toBe(true);
    await expect(
      reasonHasError({ target: 'AdminAuditLog', retentionDays: 180, reason: '   ' }),
    ).resolves.toBe(true);
  });

  it('清理原因至少 2 个字符且最多 200 个字符', async () => {
    await expect(
      reasonHasError({ target: 'AdminAuditLog', retentionDays: 180, reason: '清' }),
    ).resolves.toBe(true);
    await expect(
      reasonHasError({
        target: 'AdminAuditLog',
        retentionDays: 180,
        reason: '清'.repeat(201),
      }),
    ).resolves.toBe(true);
  });

  it('合法原因在 trim 后通过校验', async () => {
    const dto = plainToInstance(RetentionCleanupDto, {
      target: 'AdminAuditLog',
      retentionDays: 180,
      reason: '  季度合规清理  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('季度合规清理');
  });
});

describe('RetentionPreviewQueryDto', () => {
  it('把 query 字符串转为天数并限制为 7–3650', async () => {
    const valid = plainToInstance(RetentionPreviewQueryDto, {
      target: 'AdminAuditLog',
      retentionDays: '30',
    });
    const tooSmall = plainToInstance(RetentionPreviewQueryDto, {
      target: 'AdminAuditLog',
      retentionDays: '6',
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.retentionDays).toBe(30);
    await expect(validate(tooSmall)).resolves.not.toHaveLength(0);
  });

  it('只允许预览白名单内的清理目标', async () => {
    const dto = plainToInstance(RetentionPreviewQueryDto, {
      target: 'User',
      retentionDays: '30',
    });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
