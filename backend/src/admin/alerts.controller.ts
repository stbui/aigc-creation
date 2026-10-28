import { Controller, Get } from '@nestjs/common';
import { AdminIdentityOnly, AdminUser, type AdminUser as AdminUserType } from './admin.decorator';
import { AdminAlertsService } from './alerts.service';

/**
 * 顶栏告警中心。
 *
 * 所有后台角色都需要看到「与自己有关」的告警，所以端点只要求身份，
 * 具体来源在 service 内按角色权限过滤 —— 用单一权限点会逼着前端
 * 为不同角色写不同请求，且新增来源时要再改一次权限矩阵。
 */
@Controller('admin/alerts')
export class AdminAlertsController {
  constructor(private readonly alerts: AdminAlertsService) {}

  @Get()
  @AdminIdentityOnly()
  list(@AdminUser() actor: AdminUserType) {
    return this.alerts.list(actor.role);
  }
}
