/**
 * 中转配置的读取入口。
 *
 * 配置树（`ENV_SPECS`）存的是**人类可读单位**（MB、分钟级毫秒数、每分钟次数），
 * 这里换算成运行期字节数。所有业务代码只读 `ProxyLimits`，不各自 `× 1024 × 1024`
 * —— 单位换算散在三处就会有一处写成 `<< 20` 而另一处写 `* 1000`。
 */

import type { ConfigService } from '@nestjs/config';
import { PROXY_LIMIT_DEFAULTS, type ProxyLimits } from './proxy.constants';

const MB = 1024 * 1024;

/** 从配置树读取中转上限；缺失或非法时回落默认值（`ENV_SPECS` 已做类型校验） */
export function readProxyLimits(config: ConfigService): ProxyLimits {
  const bool = (key: string, fallback: boolean): boolean => {
    const value = config.get<boolean>(key);
    return typeof value === 'boolean' ? value : fallback;
  };
  const num = (key: string, fallback: number): number => {
    const value = config.get<number>(key);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    enabled: bool('model.proxy.enabled', PROXY_LIMIT_DEFAULTS.enabled),
    systemRequestBytes: num('model.proxy.systemRequestMb', PROXY_LIMIT_DEFAULTS.systemRequestBytes / MB) * MB,
    systemResponseBytes: num('model.proxy.systemResponseMb', PROXY_LIMIT_DEFAULTS.systemResponseBytes / MB) * MB,
    systemTimeoutMs: num('model.proxy.systemTimeoutMs', PROXY_LIMIT_DEFAULTS.systemTimeoutMs),
    customRequestBytes: num('model.proxy.customRequestMb', PROXY_LIMIT_DEFAULTS.customRequestBytes / MB) * MB,
    customResponseBytes: num('model.proxy.customResponseMb', PROXY_LIMIT_DEFAULTS.customResponseBytes / MB) * MB,
    customTimeoutMs: num('model.proxy.customTimeoutMs', PROXY_LIMIT_DEFAULTS.customTimeoutMs),
    customConcurrency: num('model.proxy.customConcurrency', PROXY_LIMIT_DEFAULTS.customConcurrency),
  };
}
