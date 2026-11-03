import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { Transform } from "class-transformer";
import {
  AuditAction,
  RequireAllPermissions,
  RequirePermission,
} from "./admin.decorator";
import { BackupService } from "./backup.service";
import { PERMISSIONS } from "./permissions";
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/** 手动触发备份 */
export class RunBackupDto {
  /**
   * 操作原因。手动备份在高危权限清单 (HIGH_RISK_PERMISSIONS) 内,
   * AuditInterceptor 只从 body.reason 取值 —— 不声明这个字段会被
   * 全局 ValidationPipe(whitelist) 剥掉, 审计里永远记 null。
   */
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString({ message: "请填写备份原因" })
  @MinLength(2, { message: "备份原因至少 2 个字符" })
  @MaxLength(200, { message: "备份原因最多 200 个字符" })
  reason!: string;
}

/** 保留份数清理 */
export class PruneBackupDto {
  @IsInt()
  @Min(1)
  @Max(100)
  keepCount!: number;

  /** 批量删除备份不可逆，原因同时写入审计 */
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString({ message: "请填写清理原因" })
  @MinLength(2, { message: "清理原因至少 2 个字符" })
  @MaxLength(200, { message: "清理原因最多 200 个字符" })
  reason!: string;
}

/**
 * 数据备份与保留期 (admin-prd.md §3.19 B-96~B-101)。
 *
 * 权限点分离:
 *   backup.read  查看备份列表与统计
 *   backup.run   手动备份 / 恢复验证 / 清理
 *   data.export  下载备份文件 (归到导出, 因为它本质是数据流出)
 *
 * 下载刻意要求 **已验证** 才放行 (B-97): 未验证的备份在事故时才发现损坏就晚了。
 */
@Controller("admin/backups")
export class AdminBackupController {
  constructor(private readonly backup: BackupService) {}

  /** 备份概览: 份数、占用、是否过期 */
  @Get("stats")
  @RequirePermission(PERMISSIONS.backupRead)
  stats() {
    return this.backup.stats();
  }

  /** 备份列表 */
  @Get()
  @RequirePermission(PERMISSIONS.backupRead)
  list() {
    return this.backup.list();
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.backupRead)
  detail(@Param("id") id: string) {
    return this.backup.detail(id);
  }

  /**
   * 手动备份。
   *
   * 同步执行 (备份本身耗时很短), 返回 201 与记录详情。
   * 前端以 busy 状态防重复点击；后端不承诺未落库的跨请求幂等。
   */
  @Post()
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction("backup.run")
  run(@Body() _dto: RunBackupDto) {
    return this.backup.run("manual");
  }

  /**
   * 恢复验证 (B-97)。
   *
   * 只读打开备份文件做完整性/结构/可读性检查, **绝不触碰生产库**。
   * 这是不可逆操作前唯一的保险, 验证本身必须零副作用。
   */
  @Post(":id/verify")
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction("backup.verify")
  verify(@Param("id") id: string) {
    return this.backup.verify(id);
  }

  /**
   * 下载备份文件。
   *
   * 只允许下载已验证的备份 —— 未验证的视为无效 (B-97)。
   */
  @Get(":id/download")
  @RequireAllPermissions(PERMISSIONS.backupRead, PERMISSIONS.dataExport)
  @AuditAction("backup.download")
  async download(@Param("id") id: string, @Res() res: Response) {
    const { filename, buffer } = await this.backup.readForDownload(id);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** 删除备份 (保留至少一份已验证备份) */
  @Delete(":id")
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction("backup.delete")
  remove(@Param("id") id: string) {
    return this.backup.remove(id);
  }

  /**
   * 保留份数清理。
   *
   * 只允许显式指定 1–100 份，避免 query/body 两套参数出现校验绕过。
   */
  @Post("prune")
  @RequirePermission(PERMISSIONS.backupRun)
  @AuditAction("backup.prune")
  prune(@Body() dto: PruneBackupDto) {
    return this.backup.prune(dto.keepCount);
  }
}
