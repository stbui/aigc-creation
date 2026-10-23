/**
 * CORS 允许来源解析。
 *
 * 背景: 原先白名单写死单条前端地址, 于是换成任何一个等价入口
 * (127.0.0.1 / [::1] / vite preview 的 4173 / 局域网 IP 供手机调试) 就全线 CORS 失败,
 * 且表现为浏览器控制台报错、请求根本没发出, 排查成本高。
 *
 * 规则 (优先级从高到低):
 *   1. CORS_ORIGINS      逗号分隔的显式白名单, 覆盖默认值 (生产用这个)
 *   2. CORS_ALLOW_PRIVATE_LAN=1 时额外放行私有网段任意端口 (192.168.x / 10.x / 172.16-31.x)
 *   3. 默认开发白名单: localhost / 127.0.0.1 / [::1] × 5100(dev) / 4173(preview)
 *
 * 安全取向: 默认只放行本机开发端口, 不含通配符; 局域网与生产来源都必须显式开启。
 */

export const DEFAULT_DEV_PORTS = [5100, 4173];

export const PRIVATE_LAN_RE =
  /^https?:\/\/(?:(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?::\d{1,5})?$/;

export interface CorsAllowList {
  /** 交给 cors 的 origin: 精确来源数组 + 可选私有网段正则 */
  origin: Array<string | RegExp>;
  /** 实际生效的来源清单 (供启动日志打印, 便于确认) */
  effective: string[];
  /** 是否启用了私有网段放行 */
  privateLan: boolean;
}

export function buildCorsAllowList(
  env: NodeJS.ProcessEnv = process.env,
  devPorts: number[] = DEFAULT_DEV_PORTS,
): CorsAllowList {
  const explicit = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const privateLan = env.CORS_ALLOW_PRIVATE_LAN === '1' || env.CORS_ALLOW_PRIVATE_LAN === 'true';

  if (explicit.length > 0) {
    // 显式白名单优先: 只按字符串精确匹配, 不叠加任何隐式放行
    return { origin: explicit, effective: explicit, privateLan: false };
  }

  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  const effective: string[] = [];
  for (const port of devPorts) {
    for (const host of hosts) {
      effective.push(`http://${host}:${port}`);
    }
  }

  const origin: Array<string | RegExp> = [...effective];
  if (privateLan) origin.push(PRIVATE_LAN_RE);

  return { origin, effective, privateLan };
}
