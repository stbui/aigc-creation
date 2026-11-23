/**
 * 健康检查。
 *
 * 两个端点，用途不同，**不要合并**：
 *   · `GET /health`        —— 给人看的诊断面板：数据库、存储、三种模态的模型线路
 *                            各自的状态与冷却情况。永远返回 200（除非进程起不来），
 *                            部分降级时 `status='degraded'`。
 *   · `GET /health/ready`  —— 给编排系统看的就绪探针：只有「关键依赖可用」
 *                            才返回 200，否则 503。Docker/K8s 据此决定
 *                            要不要把流量打进来。
 *
 * 关键依赖只有数据库：模型线路全部不可用时，生成任务会明确失败并退款，
 * 但后台管理与排障入口仍应可用。存储不可用时上传/生成同样会失败 ——
 * 这些属于业务降级，不该让整个实例被摘除。容器探针走 `/health/ready`，
 * 不受线路状态影响。
 *
 * 存储探测带 30 秒缓存：OSS/MinIO 的连通性探测要发网络请求，
 * 探针 5 秒一次会把一个纯读接口变成对外部服务的压力源。
 *
 * Controller 只做 HTTP 适配，探测与判定在 HealthService。
 */
import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  report() {
    return this.health.report();
  }

  @Get('ready')
  ready() {
    return this.health.readiness();
  }
}
