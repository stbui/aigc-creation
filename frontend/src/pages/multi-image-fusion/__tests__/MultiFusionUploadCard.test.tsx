import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MultiFusionUploadCard } from '../MultiFusionUploadCard';

function renderFilledSubject(onUploadFiles = vi.fn()) {
  const result = render(
    <MultiFusionUploadCard
      subject={{ id: 'subject-1', url: '/subject.png', name: '主体图' }}
      accents={[]}
      uploading={false}
      totalCount={1}
      onUploadFiles={onUploadFiles}
      onRemoveSubject={vi.fn()}
      onRemoveAccent={vi.fn()}
      onOpenLibrary={vi.fn()}
      onOpenMobile={vi.fn()}
    />,
  );
  const area = screen.getByRole('group', { name: '上传主体图' });
  const input = area.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('主体图文件框未渲染');
  return { ...result, area, input, onUploadFiles };
}

describe('MultiFusionUploadCard 主体图替换', () => {
  it('点击满位主体图命中区会重新打开文件选择框', () => {
    const { area, input } = renderFilledSubject();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(area);

    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('满位主体图提供可点击、可聚焦的替换入口', async () => {
    const user = userEvent.setup();
    const { area, input, onUploadFiles } = renderFilledSubject();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const replace = within(area).getByRole('button', { name: '替换主体图' });

    replace.focus();
    expect(document.activeElement).toBe(replace);
    await user.keyboard('{Enter}');

    expect(click).toHaveBeenCalledTimes(1);
    expect(onUploadFiles).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('满位主体图拖拽仍会回传到主体图槽位', () => {
    const onUploadFiles = vi.fn();
    const { area } = renderFilledSubject(onUploadFiles);
    const file = new File(['image'], 'next.png', { type: 'image/png' });

    fireEvent.drop(area, { dataTransfer: { files: [file] } });

    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    expect(onUploadFiles.mock.calls[0][0]).toBe('subject');
    expect(onUploadFiles.mock.calls[0][1][0]).toBe(file);
  });
});
