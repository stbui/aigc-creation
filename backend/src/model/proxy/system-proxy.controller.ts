/**
 * 系统渠道中转的两个入口。
 *
 * · `ANY /api/v1/ai/system/:channelId/*path` —— 显式入口，路径里带渠道 id；
 * · `ANY /api/v1/:channelId/*path`          —— 短路径，兼容「把 base URL 配成
 *   `https://host/api/v1/{channelId}`」的第三方 SDK。
 *
 * 为什么用 `@All` + 原始 `@Res()`：中转要原样透传上游状态码、`text/event-stream`
 * 与二进制响应体，而全局 `ResponseInterceptor` 会把返回值包成
 * `{code,data,message}`。拿到原始响应对象后由 service 自行结束连接，
 * 与参考实现的 `c.Writer` 直写等价（见 `proxy.http.ts` 顶部说明）。
 *
 * 注册顺序：`ProxyModule` 在 `AppModule` 中最后一个导入，短路径 catch-all
 * 因此排在全部业务路由之后 —— 业务路由永远优先匹配。
 */

import { All, Controller, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { RateLimit } from '../../common/rate-limit.guard';
import { PROXY_IDEMPOTENCY_HEADER, PROXY_SCENE, PROXY_SCENE_HEADER } from './proxy.constants';
import { isReservedApiPrefix } from './proxy.paths';
import { ProxyBodyTooLargeError, readProxyBody, writeProxyError } from './proxy.http';
import { readProxyLimits } from './proxy.config';
import { SystemProxyService } from './system-proxy.service';

/** 系统中转的限流配额（每条渠道共用；`MODEL_PROXY_SYSTEM_RATE_LIMIT` 可覆盖） */
const SYSTEM_RATE_LIMIT = { limit: 120, windowSec: 60 };

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class SystemProxyController {
  constructor(
    private readonly config: ConfigService,
    private readonly proxy: SystemProxyService,
  ) {}

  /** 显式入口：`/ai/system/:channelId/...` */
  @All('system/:channelId/*path')
  @RateLimit({
    scope: 'user',
    name: 'proxy-system',
    limitEnv: 'MODEL_PROXY_SYSTEM_RATE_LIMIT',
    ...SYSTEM_RATE_LIMIT,
  })
  async relay(
    @Param('channelId') channelId: string,
    @Req() req: Request & { user?: { id: string } },
    @Res() res: Response,
  ): Promise<void> {
    await relaySystem(this.config, this.proxy, req, res, channelId, wildcardPath(req.params.path));
  }
}

/**
 * 短路径入口：`/api/v1/:channelId/...`。
 *
 * 只有「两段及以上、且首段不是保留前缀」才可能是中转；保留前缀（`tasks`、
 * `admin`、`models` 等）说明这是业务路由，回 404 交给标准信封 ——
 * **不能**把业务路由的错误吞成上游连接失败。
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ShortProxyController {
  constructor(
    private readonly config: ConfigService,
    private readonly proxy: SystemProxyService,
  ) {}

  @All(':channelId/*path')
  @RateLimit({
    scope: 'user',
    name: 'proxy-system',
    limitEnv: 'MODEL_PROXY_SYSTEM_RATE_LIMIT',
    ...SYSTEM_RATE_LIMIT,
  })
  async relay(
    @Param('channelId') channelId: string,
    @Req() req: Request & { user?: { id: string } },
    @Res() res: Response,
  ): Promise<void> {
    if (isReservedApiPrefix(channelId)) {
      // 与未匹配路由同样的 404，不泄漏「这里其实有个中转入口」
      writeProxyError(res, 404, 40401, '接口不存在');
      return;
    }
    await relaySystem(this.config, this.proxy, req, res, channelId, wildcardPath(req.params.path));
  }
}

// ── 共享处理 ──────────────────────────────────────────────────────────

/**
 * 两个入口的唯一差别是渠道 id 从哪来，其余（读体、配额、透传）必须完全一致 ——
 * 否则修好一个入口的 bug 会漏掉另一个。
 */
async function relaySystem(
  config: ConfigService,
  proxy: SystemProxyService,
  req: Request & { user?: { id: string } },
  res: Response,
  channelId: string,
  providerPath: string,
): Promise<void> {
  const limits = readProxyLimits(config);
  let body: Buffer;
  try {
    body = await readProxyBody(req, limits.systemRequestBytes);
  } catch (error) {
    if (error instanceof ProxyBodyTooLargeError) {
      writeProxyError(res, 413, 40001, `请求体超过中转上限（${Math.round(limits.systemRequestBytes / 1024 / 1024)}MB）`);
      // 剩余字节必须丢弃，否则连接会因未读完请求体而挂住
      req.resume();
      return;
    }
    writeProxyError(res, 400, 40001, messageOf(error) || '请求体读取失败');
    return;
  }

  await proxy.proxy({
    userId: String(req.user?.id ?? ''),
    channelId: String(channelId ?? ''),
    method: String(req.method ?? ''),
    providerPath,
    query: queryOf(req),
    contentType: headerText(req.headers['content-type']),
    accept: headerText(req.headers['accept']),
    scene: headerText(req.headers[PROXY_SCENE_HEADER]).trim() || PROXY_SCENE,
    idempotencyKey: headerText(req.headers[PROXY_IDEMPOTENCY_HEADER]).trim(),
    body,
    res,
  });
}

/**
 * Express 5 的通配参数是**分段数组**（`['v1','chat','completions']`），
 * 需要还原成带前导斜杠的路径交给 `normalizeProxyPath` 做点段归一。
 */
function wildcardPath(value: unknown): string {
  if (Array.isArray(value)) return `/${value.map((part) => String(part)).join('/')}`;
  return `/${String(value ?? '')}`;
}

/** 查询串从 `originalUrl` 取：`req.query` 已被 Express 解析并可能改形（数组/嵌套） */
function queryOf(req: Request): URLSearchParams {
  const raw = String(req.originalUrl ?? req.url ?? '');
  const index = raw.indexOf('?');
  return new URLSearchParams(index >= 0 ? raw.slice(index + 1) : '');
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}
