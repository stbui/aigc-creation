import { describe, expect, it, vi } from 'vitest';

import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  it('项目列表只返回未删除项目', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ProjectsService({ project: { findMany } } as never);

    await expect(service.list('user-1')).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });
});
