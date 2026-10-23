import { ApiError, unauthorized } from './errors.js';

/**
 * 失败注入。
 *
 * 渠道联调最需要验证的恰恰是失败路径：令牌失效、限流、上游 5xx、
 * 多渠道故障转移。真实厂商很难按需制造这些状态，故在 prompt 里埋标记：
 *
 *   [[fail]] / [[500]]  → HTTP 500
 *   [[401]]             → HTTP 401（令牌被拒）
 *   [[429]]             → HTTP 429（限流）
 *   MOCK_FAIL_RATE=0.2  → 每次生成按概率随机失败
 *
 * OPTIONS 探活与模型列表**永远不会**被注入失败 —— 否则后台连配置都测不了。
 */
export function maybeFail(cfg, text) {
  const s = String(text ?? '');
  if (s.includes('[[fail]]') || s.includes('[[500]]')) {
    throw new ApiError(500, '仿真失败：命中 [[fail]] 注入标记', { code: 'mock_injected_failure' });
  }
  if (s.includes('[[401]]')) {
    throw unauthorized('仿真失败：命中 [[401]] 注入标记（令牌被拒绝）');
  }
  if (s.includes('[[429]]')) {
    throw new ApiError(429, '仿真失败：命中 [[429]] 注入标记（触发限流）', {
      code: 'rate_limit_exceeded',
    });
  }
  if (cfg.failRate > 0 && Math.random() < cfg.failRate) {
    throw new ApiError(503, '仿真失败：命中 MOCK_FAIL_RATE 随机失败', { code: 'mock_random_failure' });
  }
}
