import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app.exception';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, name: string) {
    return this.prisma.project.create({ data: { ownerId, name: name.trim() } });
  }

  async list(ownerId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { assets: true, tasks: true } } },
    });

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      ownerId: project.ownerId,
      createdAt: project.createdAt,
      assetCount: project._count.assets,
      taskCount: project._count.tasks,
    }));
  }

  async update(ownerId: string, id: string, name: string) {
    await this.findOwned(ownerId, id);
    return this.prisma.project.update({
      where: { id },
      data: { name: name.trim() },
    });
  }

  /**
   * 软删除项目。项目下仍有素材时，调用方必须显式选择迁移目标。
   *
   * 只迁移 Asset.projectId，保留 GenerationTask.projectId：任务记录的是生成发生时的
   * 历史归属，素材归档到哪个项目是后续组织行为，不能改写历史。
   */
  async remove(ownerId: string, id: string, moveAssetsTo?: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        ownerId: true,
        deletedAt: true,
        _count: { select: { assets: true, tasks: true } },
      },
    });
    if (!project) throw new AppError(40400, '项目不存在', 404);

    // 重复删除保持幂等，不覆盖首次删除时间。
    if (project.deletedAt) {
      return { id, deletedAt: project.deletedAt, movedAssets: 0 };
    }

    const assetCount = project._count.assets;
    const targetId = moveAssetsTo?.trim() || undefined;
    if (assetCount > 0 && !targetId) {
      throw new AppError(40901, '项目下还有素材，请选择迁移目标项目', 409);
    }
    if (targetId === id) {
      throw new AppError(40001, '迁移目标不能是当前项目', 400);
    }

    const deletedAt = new Date();
    const movedAssets = await this.prisma.$transaction(async (tx) => {
      let moved = 0;
      if (assetCount > 0 && targetId) {
        const target = await tx.project.findFirst({
          where: { id: targetId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (!target) {
          throw new AppError(40001, '迁移目标项目不存在或不可用', 400);
        }
        const result = await tx.asset.updateMany({
          where: { projectId: id, ownerId },
          data: { projectId: targetId },
        });
        moved = result.count;
      }

      await tx.project.update({
        where: { id },
        data: { deletedAt },
      });
      return moved;
    });

    return { id, deletedAt, movedAssets };
  }

  private async findOwned(ownerId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, ownerId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new AppError(40400, '项目不存在', 404);
    return project;
  }
}
