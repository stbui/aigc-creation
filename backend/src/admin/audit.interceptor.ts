import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTION_KEY } from './admin.decorator';

/** 写操作方法 —— 只有这些方法会被审计 */
const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** 请求体中需要写入 detail 的字段 (其余字段不记录, 避免把凭据写进审计) */
const DETAIL_FIELDS = [
  'status',
  'role',
  'name',
  'email',
  'sku',
  'priceCents',
  'credits',
  'creditsValidDays',
  'grantPlan',
  'enabled',
  'mode',
  'capability',
  'modality',
  'protocol',
  'model',
  'priority',
  'dir',
  'amount',
  'reason',
  'type',
];

/** 绝不写进审计 detail 的字段名片段 (大小写不敏感) */
const SENSITIVE_PATTERNS = ['password', 'token', 'secret', 'hash', 'credential'];

/**
 * 操作审计拦截器。
 *
 * 记录所有后台写操作 (POST/PATCH/PUT/DELETE), 以及**显式声明了
 * `@AuditAction` 的读操作** (导出 / 备份下载) —— 后者同样是把数据带出系统。
 *
 * 关键取舍: **审计失败不阻断业务**。
 * 审计表写失败时只打WARN 日志 —— 若让业务随审计失败, 审计系统就成了单点故障,
 * 用户操作会被日志问题拖垮, 反而降低了可追溯性。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    // 全局拦截器: 只审计后台动作, C 端流量不受影响
    const url: string = request.originalUrl ?? request.url ?? '';
    if (!url.split('?')[0].includes('/admin')) return next.handle();

    const method: string = request.method ?? 'GET';
    const adminUser = request.adminUser;
    // 显式声明优先; 未声明时回退到 URL 推断, 保证审计条目不丢失
    const declaredAction = this.reflector.get<string | undefined>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    /*
     * 写操作一律审计; **导出 / 下载这类 GET 只要显式声明了动作也要审计**。
     *
     * 2026-10-29 修: 此前只按方法白名单放行, 所有 `@Get('export')` 上的
     * `@AuditAction('data.export')` 实际从未落库 —— 代码与文档都写着
     * 「导出即把用户数据带出系统, 留审计」, 但审计表里查不到任何导出记录。
     * 显式声明了动作就说明该端点需要留痕, 与 HTTP 方法无关。
     */
    if (!AUDITED_METHODS.has(method) && !declaredAction) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.write(request, method, adminUser, declaredAction, true, null);
        },
        error: (err: unknown) => {
          void this.write(request, method, adminUser, declaredAction, false, err);
        },
      }),
    );
  }

  private async write(
    request: {
      url: string;
      ip?: string;
      body?: Record<string, unknown>;
    },
    method: string,
    adminUser: { id: string; email: string; role: string } | undefined,
    declaredAction: string | undefined,
    success: boolean,
    err: unknown,
  ): Promise<void> {
    try {
      const { action, targetType, targetId } = this.resolveTarget(request.url, declaredAction);

      await this.prisma.adminAuditLog.create({
        data: {
          actorId: adminUser?.id ?? 'unknown',
          actorRole: adminUser?.role ?? 'unknown',
          action,
          targetType,
          targetId,
          detail: JSON.stringify(this.buildDetail(request, success, err)),
          reason: this.readReason(request.body),
          ip: request.ip ?? 'unknown',
          success,
        },
      });
    } catch (e) {
      this.logger.warn(
        `审计写入失败 (不阻断业务): ${method} ${request.url} — ${(e as Error).message}`,
      );
    }
  }

  /**
   * 解析 action / targetType / targetId。
   *
   * action: 优先用 @AuditAction 声明值; 未声明时从 URL 推断。
   * 其余字段: 格式 /admin/<resource>/<id?>[/<sub?>]
   *   例: /admin/users/u_123/disable → resource='users', targetId='u_123'
   * 解析失败时回退为原始路径, 审计条目不会因解析失败而丢失。
   */
  private resolveTarget(
    url: string,
    declaredAction?: string,
  ): { action: string; targetType: string; targetId: string } {
    const path = url.split('?')[0].replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean); // ['api','v1','admin', ...]
    const idx = parts.indexOf('admin');
    const rest = idx >= 0 ? parts.slice(idx + 1) : parts;
    const resource = rest[0] ?? 'unknown';
    // `export` / `download` 是动作而不是对象 id, 不能写进 targetId
    const targetId = rest[1] && rest[1] !== 'export' && rest[1] !== 'download' ? rest[1] : '-';

    const action = declaredAction ?? resource;
    return { action, targetType: resource, targetId };
  }

  /** 只保留白名单字段, 过滤敏感字段 */
  private buildDetail(
    request: { body?: Record<string, unknown> },
    success: boolean,
    err: unknown,
  ): Record<string, unknown> {
    const source = request.body ?? {};
    const detail: Record<string, unknown> = { ok: success };
    for (const field of DETAIL_FIELDS) {
      // 双保险: 白名单已限定字段, 这里再挡一次敏感词, 防止后续往 DETAIL_FIELDS
      // 追加字段时误把凭据类内容写进审计 (审计本身对所有后台角色可读)
      if (SENSITIVE_PATTERNS.some((p) => field.toLowerCase().includes(p))) continue;
      if (field in source) detail[field] = source[field];
    }
    if (!success && err instanceof Error) {
      detail.error = err.message.slice(0, 200);
    }
    return detail;
  }

  /**
   * 提取操作原因。
   *
   * 高危动作必须带原因 (前端强制输入确认词), 这里做二次兜底:
   * 有 reason 字段就用, 没有则记录缺失标记, 便于后续补录。
   */
  private readReason(body: Record<string, unknown> | undefined): string | null {
    const raw = body?.['reason'];
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 200);
    return null;
  }
}