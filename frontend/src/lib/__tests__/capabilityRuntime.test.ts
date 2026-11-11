import { describe, expect, it } from 'vitest';

import { publicCapabilityRuntime, runtimeOf } from '../constants';
import type { CapabilityRuntime } from '../../types/api';

const internalUnavailableRuntime: CapabilityRuntime = {
  enabled: true,
  remoteAvailable: false,
  effective: 'unavailable',
  reason: '内部诊断：需要真实模型，当前无可用线路',
};

describe('capability runtime public copy', () => {
  it('clears the internal unavailable reason before it reaches C-end pages', () => {
    const runtime = runtimeOf({ mode: 'real', runtime: internalUnavailableRuntime });

    expect(runtime.reason).toBe('');
    expect(runtime.reason).not.toContain('真实模型');
    expect(runtime.reason).not.toContain('内部诊断');
  });

  it('sanitizes runtime data loaded from the public capability endpoint', () => {
    expect(publicCapabilityRuntime(internalUnavailableRuntime).reason).toBe('');
  });

  it('keeps the operator-provided reason when a capability is taken offline', () => {
    const runtime: CapabilityRuntime = {
      enabled: false,
      remoteAvailable: true,
      effective: 'disabled',
      reason: '设备维护中',
    };

    expect(runtimeOf({ mode: 'real', runtime }).reason).toBe('设备维护中');
  });
});
