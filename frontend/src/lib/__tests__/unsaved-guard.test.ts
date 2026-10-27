import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges, registerUnsavedGuard } from '../unsaved-guard';

/**
 * 未保存变更登记处。
 *
 * 这是后台「改了没保存就点侧栏」的唯一拦截依据。关键不是注册成功，
 * 而是：注销后不再生效、多个编辑页只要有一个脏就拦、单个守卫抛错
 * 不能把整次跳转判定带崩。
 */
describe('unsaved guard', () => {
  it('没有登记时判定为干净', () => {
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('登记脏页后返回 true，注销后恢复 false', () => {
    const unregister = registerUnsavedGuard(() => true);
    expect(hasUnsavedChanges()).toBe(true);

    unregister();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('多个编辑页只要有一个脏就拦截', () => {
    const clean = registerUnsavedGuard(() => false);
    const dirty = registerUnsavedGuard(() => true);

    expect(hasUnsavedChanges()).toBe(true);

    dirty();
    expect(hasUnsavedChanges()).toBe(false);
    clean();
  });

  it('单个守卫抛错不影响其它守卫的判定', () => {
    const broken = registerUnsavedGuard(() => {
      throw new Error('guard blew up');
    });
    const dirty = registerUnsavedGuard(() => true);

    expect(hasUnsavedChanges()).toBe(true);

    broken();
    dirty();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('重复注销同一守卫是幂等的', () => {
    const unregister = registerUnsavedGuard(() => true);
    unregister();
    unregister();

    expect(hasUnsavedChanges()).toBe(false);
  });
});
