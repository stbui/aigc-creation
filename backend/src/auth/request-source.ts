import type { Request } from 'express';
import type { RequestContext } from './auth.service';

/**
 * 请求来源提取。
 *
 * `req.ip` 默认是 socket 地址；本项目**默认不信任** `x-forwarded-for`
 * （见 B5 的 `RATE_LIMIT_TRUST_PROXY` 说明）—— 直接读该头等于让任何人
 * 伪造来源 IP，会污染登录记录与安全排障证据。
 *
 * 独立成文件: 认证、扫码登录、OAuth 三个 controller 都要用, 从某个
 * controller 反向导入会形成无意义的模块耦合。
 */
export function contextOf(req: Request): RequestContext {
  return {
    ip: req.ip,
    ua: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}