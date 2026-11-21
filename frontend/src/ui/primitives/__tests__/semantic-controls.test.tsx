import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from '../segmented-control';
import { TextAction } from '../text-action';
import { ImageDropzone } from '../dropzone';

describe('TextAction', () => {
  it('是按钮语义而不是链接，并把点击交给回调', () => {
    const onClick = vi.fn();
    render(<TextAction onClick={onClick}>从素材库导入</TextAction>);
    const button = screen.getByRole('button', { name: '从素材库导入' });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('禁用后不触发回调', () => {
    const onClick = vi.fn();
    render(
      <TextAction disabled onClick={onClick}>
        清空框选
      </TextAction>,
    );
    fireEvent.click(screen.getByRole('button', { name: '清空框选' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('输出 radiogroup 语义并回传单选值', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        onChange={onChange}
        ariaLabel="筛选"
        options={[
          { value: 'a', label: '全部' },
          { value: 'b', label: '图片' },
        ]}
      />,
    );
    // Radix ToggleGroup type="single" 输出 radiogroup + radiogroup 内的 radio
    expect(screen.getByRole('radiogroup', { name: '筛选' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '全部' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '图片' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ImageDropzone', () => {
  it('点击触发文件选择，拖拽落点回传文件列表', () => {
    const onClick = vi.fn();
    const onFiles = vi.fn();
    render(<ImageDropzone title="点击上传" hint="支持 PNG" onClick={onClick} onFiles={onFiles} />);

    const button = screen.getByRole('button', { name: /点击上传/ });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    const file = new File(['image'], 'a.png', { type: 'image/png' });
    fireEvent.drop(button, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
  });

  it('禁用时不触发点击与拖拽', () => {
    const onClick = vi.fn();
    const onFiles = vi.fn();
    render(
      <ImageDropzone
        title="点击上传"
        hint="支持 PNG"
        disabled
        onClick={onClick}
        onFiles={onFiles}
      />,
    );
    const button = screen.getByRole('button', { name: /点击上传/ });
    fireEvent.click(button);
    fireEvent.drop(button, { dataTransfer: { files: [new File(['x'], 'a.png')] } });
    expect(onClick).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });
});
