import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { RequirePermission, AdminUser, type AdminUser as AdminUserType } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { StorageService, type StorageConfigValues } from '../storage/storage.service';
import { PERMISSIONS } from './permissions';
import { isStorageBackend, type StorageBackend } from '../storage/storage.contract';
import { SaveStorageConfigDto, TestStorageDraftDto } from './dto/storage-admin.dto';

/**
 * 存储后端管理 (admin-prd.md §3.11 B-62/B-63)。
 *
 * 2026-11 起凭据改为页面可编辑、加密落库 (见 docs/non-upstream-extensions.md)：
 * 配置经 `PUT /admin/storage/config/:backend` 保存，StorageService 即时重建 provider。
 * 明文密钥永不出现在响应里 —— status 只回脱敏值与「是否已配置」标记。
 */
@Controller('admin/storage')
export class AdminStorageController {
  constructor(private readonly storage: StorageService) {}

  /** 各后端状态 + 可编辑字段定义 + 脱敏凭据（B-62/B-63）。 */
  @Get('status')
  @RequirePermission(PERMISSIONS.settingRead)
  async status() {
    const backends = await this.storage.status();
    return {
      active: this.storage.activeBackend,
      backends,
      // 2026-11 变更：凭据已支持页面编辑（加密落库），不再是只读环境变量。
      credentialSource: '后台存储配置页（加密落库）',
      editable: true,
    };
  }

  /**
   * 保存某个后端的配置，即时生效（无需重启）。
   *
   * local 只保存公开访问地址；oss / minio 保存完整连接配置。
   * @AdminUser 仅用于审计日志的 updatedBy，不作为凭据。
   */
  @Put('config/:backend')
  @RequirePermission(PERMISSIONS.settingWrite)
  async saveConfig(
    @Param('backend') backend: string,
    @Body() body: SaveStorageConfigDto,
    @AdminUser() admin: AdminUserType,
  ) {
    if (!isStorageBackend(backend)) {
      throw new AppError(40001, '非法后端', 400);
    }
    const view = await this.storage.saveConfig(backend, body.values as StorageConfigValues, admin.id);
    return { backend, config: view, note: '配置已保存并即时生效；密钥留空表示沿用原值' };
  }

  /**
   * 连通性测试 (B-62): 发真实请求, 返回耗时与结果。
   *
   * 主动测试带 `verifyWrite`: 云端会写 1 字节探针并读回，证明 put/get 权限也通了，
   * 而不只是「桶能列出来」。status 的被动轮询与健康检查不传这个参数，避免高频写云。
   *
   * 带 `body.values` 时先用**草稿**测（不落库、不切换默认后端）：配置写错时应当
   * 停在抽屉里看到原因，而不是先保存再回滚。
   */
  @Post('probe')
  @RequirePermission(PERMISSIONS.channelTest)
  async probe(
    @Query('backend') backend?: string,
    @Body() body?: TestStorageDraftDto,
  ) {
    if (backend !== undefined && !isStorageBackend(backend)) {
      throw new AppError(40001, '非法后端', 400);
    }
    const target = backend as StorageBackend | undefined;
    // 草稿测试：用页面当前输入构造临时 provider，不落库、不影响默认后端
    if (body?.values) {
      if (!target) throw new AppError(40001, '缺少 backend 参数', 400);
      return { backend: target, ...(await this.storage.testDraft(target, body.values as StorageConfigValues)) };
    }
    const p = target !== undefined ? this.storage.get(target) : this.storage.getActive();
    if (!p) throw new AppError(40400, `后端未启用: ${backend}`, 404);
    return { backend: p.backend, ...(await p.probe({ verifyWrite: true })) };
  }

  /**
   * 切换默认后端。
   *
   * ⚠ 不影响已写入的素材 —— Asset.storageBackend 记录了写入时的后端,
   * 老素材仍从原后端读取。切换只决定**新上传**走哪里。
   */
  @Post('active')
  @RequirePermission(PERMISSIONS.settingWrite)
  async setActive(@Query('backend') backend: string) {
    if (!isStorageBackend(backend)) {
      throw new AppError(40001, '非法后端', 400);
    }
    if (!this.storage.get(backend)) {
      throw new AppError(40001, `后端未启用: ${backend}`, 400);
    }
    await this.storage.setActive(backend);
    return { active: backend, note: '仅对新上传生效, 已写入的素材仍按原后端读取' };
  }
}
