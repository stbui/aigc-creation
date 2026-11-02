import { Component } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

class Bomb extends Component {
  render(): never {
    throw new Error('boom');
  }
}

/**
 * 顶层 ErrorBoundary 未传 resetKeys。
 * 旧实现在 componentDidUpdate 里把 undefined 当成“变化”，错误一捕获就 reset，
 * 子树再次抛错 → 再捕获，形成循环，兜底页无法稳定停留。
 */
describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未传 resetKeys 时稳定渲染兜底页，而不是反复重置', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('页面渲染出错')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });
});
