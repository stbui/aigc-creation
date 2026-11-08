import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MultiFusionAnalysisCard } from '../MultiFusionAnalysisCard';

describe('MultiFusionAnalysisCard 画面描述入口', () => {
  it('未做 AI 分析时也始终提供手动填写入口', () => {
    const onToggleDescription = vi.fn();
    render(
      <MultiFusionAnalysisCard
        analyzing={false}
        message={null}
        descriptionOpen={false}
        prompt=""
        onAnalyze={() => {}}
        onPromptChange={() => {}}
        onToggleDescription={onToggleDescription}
      />,
    );

    const toggle = screen.getByRole('button', { name: '手动填写画面描述' });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: '画面描述' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggleDescription).toHaveBeenCalledOnce();
  });
});
