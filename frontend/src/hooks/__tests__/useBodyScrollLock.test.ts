import { afterEach, describe, expect, it } from 'vitest';
import { lockBodyScroll } from '../useBodyScrollLock';

const originalInnerWidth = window.innerWidth;
const originalClientWidth = document.documentElement.clientWidth;

function setViewportAndScrollbar(innerWidth: number, clientWidth: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: clientWidth });
}

afterEach(() => {
  document.body.removeAttribute('style');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: originalClientWidth,
  });
});

describe('lockBodyScroll', () => {
  it('reserves the lost scrollbar width and restores the original styles', () => {
    setViewportAndScrollbar(1000, 985);
    document.body.style.overflow = 'scroll';
    document.body.style.paddingRight = '4px';

    const unlock = lockBodyScroll();

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.paddingRight).toBe('19px');

    unlock();

    expect(document.body.style.overflow).toBe('scroll');
    expect(document.body.style.paddingRight).toBe('4px');
  });

  it('ref-counts nested locks and restores only after the last unlock', () => {
    setViewportAndScrollbar(1000, 985);
    const unlockOuter = lockBodyScroll();
    const unlockInner = lockBodyScroll();

    unlockInner();
    expect(document.body.style.overflow).toBe('hidden');

    unlockOuter();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.paddingRight).toBe('');
  });
});
