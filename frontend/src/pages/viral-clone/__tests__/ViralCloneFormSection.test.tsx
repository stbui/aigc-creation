import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViralCloneFormSection } from '../ViralCloneFormSection';

describe('ViralCloneFormSection 参考图文案', () => {
  it('只承诺上传，不再提示会粘贴到参考图位', () => {
    render(
      <ViralCloneFormSection
        images={[]}
        maxImages={4}
        reference={null}
        uploading={false}
        productName=""
        brand=""
        platform=""
        language="zh"
        onProductFiles={vi.fn()}
        onReferenceFiles={vi.fn()}
        onRemoveImage={vi.fn()}
        onRemoveReference={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenMobile={vi.fn()}
        onProductNameChange={vi.fn()}
        onBrandChange={vi.fn()}
        onPlatformChange={vi.fn()}
        onLanguageChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/上传要复刻风格的参考图/)).toBeInTheDocument();
    expect(screen.queryByText(/上传或粘贴要复刻风格的参考图/)).not.toBeInTheDocument();
  });
});
