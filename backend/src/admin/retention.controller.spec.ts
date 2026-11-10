import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RetentionCleanupDto, RetentionPreviewQueryDto } from './retention.controller';

describe('RetentionCleanupDto', () => {
  it('清理请求只包含目标与保留天数', async () => {
    const dto = plainToInstance(RetentionCleanupDto, {
      target: 'ApiCallLog',
      retentionDays: 180,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('限制保留天数与清理目标', async () => {
    const tooShort = plainToInstance(RetentionCleanupDto, {
      target: 'ApiCallLog',
      retentionDays: 6,
    });
    const unknownTarget = plainToInstance(RetentionCleanupDto, {
      target: 'User',
      retentionDays: 180,
    });

    await expect(validate(tooShort)).resolves.not.toHaveLength(0);
    await expect(validate(unknownTarget)).resolves.not.toHaveLength(0);
  });
});

describe('RetentionPreviewQueryDto', () => {
  it('把 query 字符串转为天数并限制为 7–3650', async () => {
    const valid = plainToInstance(RetentionPreviewQueryDto, {
      target: 'ApiCallLog',
      retentionDays: '30',
    });
    const tooSmall = plainToInstance(RetentionPreviewQueryDto, {
      target: 'ApiCallLog',
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
