import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PruneBackupDto, RunBackupDto } from './backup.controller';

async function hasError(dto: object, property: string): Promise<boolean> {
  const errors = await validate(dto);
  return errors.some((error) => error.property === property);
}

describe('RunBackupDto', () => {
  it('手动备份必须填写原因', async () => {
    const dto = plainToInstance(RunBackupDto, {});

    await expect(hasError(dto, 'reason')).resolves.toBe(true);
  });

  it('纯空白原因视为未填写', async () => {
    const dto = plainToInstance(RunBackupDto, { reason: '   ' });

    await expect(hasError(dto, 'reason')).resolves.toBe(true);
  });

  it('原因长度必须为 2–200 字', async () => {
    const tooShort = plainToInstance(RunBackupDto, { reason: '备' });
    const tooLong = plainToInstance(RunBackupDto, { reason: '备'.repeat(201) });

    await expect(hasError(tooShort, 'reason')).resolves.toBe(true);
    await expect(hasError(tooLong, 'reason')).resolves.toBe(true);
  });

  it('合法原因在 trim 后通过校验', async () => {
    const dto = plainToInstance(RunBackupDto, { reason: '  结构变更前留档  ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('结构变更前留档');
  });
});

describe('PruneBackupDto', () => {
  it('保留份数有上限，不能通过额外参数绕过', async () => {
    const dto = plainToInstance(PruneBackupDto, {
      keepCount: 101,
      reason: '季度容量清理',
    });

    await expect(hasError(dto, 'keepCount')).resolves.toBe(true);
  });

  it('批量清理备份必须填写有效原因', async () => {
    const missing = plainToInstance(PruneBackupDto, { keepCount: 7 });
    const whitespace = plainToInstance(PruneBackupDto, { keepCount: 7, reason: '  ' });
    const valid = plainToInstance(PruneBackupDto, {
      keepCount: 7,
      reason: '  季度容量清理  ',
    });

    await expect(hasError(missing, 'reason')).resolves.toBe(true);
    await expect(hasError(whitespace, 'reason')).resolves.toBe(true);
    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.reason).toBe('季度容量清理');
  });
});
