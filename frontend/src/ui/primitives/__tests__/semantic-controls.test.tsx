import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl } from '../segmented-control';
import { TextAction } from '../text-action';
import { ImageDropzone } from '../dropzone';
import { ImageUploadArea } from '../image-upload-area';

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
  /*
   * 契约（T-030）：ImageDropzone 只负责「空态外观 + 点击开框」。拖拽落点归外层
   * `ImageUploadArea` 的命中区，本组件不再接管 drop —— 它内部的 `onFiles` 是
   * 旧契约遗留，生产调用点没有一处使用（2026-11-24 核对）。
   */
  it('只负责点击空态：点击触发文件选择', () => {
    const onClick = vi.fn();
    render(<ImageDropzone title="点击上传" hint="支持 PNG" onClick={onClick} />);

    const button = screen.getByRole('button', { name: /点击上传/ });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('禁用时不触发点击', () => {
    const onClick = vi.fn();
    render(<ImageDropzone title="点击上传" hint="支持 PNG" disabled onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: /点击上传/ }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('不接管拖拽：落在外层命中区的文件只回传一次', () => {
    const onFiles = vi.fn();
    const { container } = render(
      <ImageUploadArea
        images={[]}
        max={3}
        ariaLabel="上传区"
        onFiles={onFiles}
        emptyContent={(controls) => (
          <ImageDropzone title="点击上传" hint="支持 PNG" onClick={controls.open} />
        )}
      />,
    );
    const area = container.querySelector<HTMLElement>('[data-slot="image-upload-area"]');
    if (!area) throw new Error('找不到上传命中区');
    const button = screen.getByRole('button', { name: /点击上传/ });

    const file = new File(['image'], 'a.png', { type: 'image/png' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    button.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    // 只回传一次：若 ImageDropzone 重新接管 drop 又不阻止冒泡，这里会变成 2
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
  });
});
