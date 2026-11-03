import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PruneBackupDto } from './backup.controller';

async function hasError(dto: object, property: string): Promise<boolean> {
  const errors = await validate(dto);
  return errors.some((error) => error.property === property);
}

describe('PruneBackupDto', () => {
  it('保留份数有上限，不能通过额外参数绕过', async () => {
    const dto = plainToInstance(PruneBackupDto, { keepCount: 101 });

    await expect(hasError(dto, 'keepCount')).resolves.toBe(true);
  });

  it('只接收保留份数', async () => {
    const dto = plainToInstance(PruneBackupDto, { keepCount: 7 });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
