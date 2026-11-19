import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Button } from '../button';

describe('Button asChild', () => {
  it('把外观交给链接子元素，并保留链接语义', () => {
    render(
      <MemoryRouter>
        <Button asChild variant="secondary">
          <Link to="/works">查看作品</Link>
        </Button>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: '查看作品' });
    expect(link).toHaveAttribute('href', '/works');
    expect(link).toHaveClass('ui-btn');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
