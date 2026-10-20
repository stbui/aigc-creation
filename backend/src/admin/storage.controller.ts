import { Controller, Get, Post, Query } from '@nestjs/common';
import { AuditAction, RequirePermission } from './admin.decorator';
import { AppError } from '../common/app.exception';
import { StorageService } from '../storage/storage.service';
import { PERMISSIONS } from './permissions';
import type { StorageBackend } from '../storage/storage.provider';

/**
 * 存储后端管理 (admin-prd.md §3.11 B-62/B-63)。
 *
 * 凭据只从环境变量读 (PRD 明确约束: 界面不可编辑), 因此这里只有
 * 「状态查看」「连通测试」「切换默认后端」三个动作, 没有任何写凭据的端点。
 */
@Controller('admin/storage')
export class AdminStorageController {
  constructor(private readonly storage: StorageService) {}

  /** 各后端状态: 是否启用、凭据是否配置(脱敏)、连通性 */
  @Get('status')
  @RequirePermission(PERMISSIONS.settingRead)
  async status() {
    const backends = await this.storage.status();
    return {
      active: this.storage.activeBackend,
      backends,
      // 明确告知凭据来源, 避免运营到处找"在哪里配"
      credentialSource: '环境变量（STORAGE_BACKEND / OSS_* / MINIO_*）',
      editable: false,
    };
  }

  /** 连通性测试 (B-62): 发真实请求, 返回耗时与结果 */
  @Post('probe')
  @RequirePermission(PERMISSIONS.channelTest)
  @AuditAction('storage.probe')
  async probe(@Query('backend') backend?: string) {
    const p = backend ? this.storage.get(backend as StorageBackend) : this.storage.getActive();
    if (!p) throw new AppError(40400, `后端未启用: ${backend}`, 404);
    return { backend: p.backend, ...(await p.probe()) };
  }

  /**
   * 切换默认后端。
   *
   * ⚠ 不影响已写入的素材 —— Asset.storageBackend 记录了写入时的后端,
   * 老素材仍从原后端读取。切换只决定**新上传**走哪里。
   */
  @Post('active')
  @RequirePermission(PERMISSIONS.settingWrite)
  @AuditAction('storage.switch')
  setActive(@Query('backend') backend: string) {
    const b = backend as StorageBackend;
    if (!['local', 'oss', 'minio'].includes(b)) {
      throw new AppError(40001, '非法后端', 400);
    }
    this.storage.setActive(b);
    return { active: b, note: '仅对新上传生效, 已写入的素材仍按原后端读取' };
  }
}
