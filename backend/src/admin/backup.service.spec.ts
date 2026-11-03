import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  let dir: string;
  let service: BackupService;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'huojue-backup-'));
    const source = join(dir, 'source.db');
    const db = new DatabaseSync(source);
    db.exec('CREATE TABLE Probe (id INTEGER PRIMARY KEY)');
    db.close();

    const rows = new Map<string, Record<string, unknown>>();
    let sequence = 0;
    create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (rows.has(String(data.filename))) {
        throw new Error('Unique constraint failed on the fields: (`filename`)');
      }
      const row = {
        id: `backup-${++sequence}`,
        ...data,
        status: data.status ?? 'pending',
        errorMessage: null,
        verified: false,
        verifiedAt: null,
        verifyReport: null,
        verifyWarnings: null,
        createdAt: new Date(),
      };
      rows.set(String(data.filename), row);
      return row;
    });
    const prisma = {
      backupRecord: {
        create,
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = [...rows.values()].find((item) => item.id === where.id);
          if (!row) throw new Error('backup record not found');
          Object.assign(row, data);
          return row;
        }),
      },
    };
    const config = {
      get: (key: string) => {
        if (key === 'path.backups') return join(dir, 'backups');
        if (key === 'db.url') return `file:${source}`;
        return undefined;
      },
    };

    service = new BackupService(prisma as never, config as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('同一秒内连续备份使用不同文件名', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T02:30:15.000Z'));

    const first = await service.run('manual');
    const second = await service.run('manual');

    expect(create).toHaveBeenCalledTimes(2);
    expect(second.filename).not.toBe(first.filename);
  });
});
