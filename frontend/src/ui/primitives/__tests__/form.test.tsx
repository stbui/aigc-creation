import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Form, FormItem, type FormInstance } from '../form';

describe('FormItem 兼容层', () => {
  it('label 指向真实输入框，错误信息通过 aria-describedby 关联', () => {
    let form!: FormInstance;

    function Harness() {
      [form] = Form.useForm();
      return (
        <Form form={form}>
          <FormItem name="email" label="邮箱">
            <input />
          </FormItem>
        </Form>
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('邮箱');
    expect(input).toHaveAttribute('id');

    act(() => form.setFields([{ name: 'email', errors: ['请输入邮箱'] }]));

    const error = screen.getByText('请输入邮箱');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('shouldUpdate 只在比较函数返回 true 时渲染内容', () => {
    let form!: FormInstance;

    function Harness() {
      [form] = Form.useForm();
      return (
        <Form form={form}>
          <FormItem
            shouldUpdate={(previous, next) => previous.watched !== next.watched}
          >
            <span>联动内容</span>
          </FormItem>
        </Form>
      );
    }

    render(<Harness />);
    expect(screen.getByText('联动内容')).toBeInTheDocument();

    act(() => form.setFieldsValue({ watched: 1 }));
    expect(screen.getByText('联动内容')).toBeInTheDocument();

    act(() => form.setFieldsValue({ unrelated: 1 }));
    expect(screen.queryByText('联动内容')).not.toBeInTheDocument();
  });
});
