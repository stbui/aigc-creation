import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Form, FormItem, useForm, type FormInstance } from '../form';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '~/admin-ui/components/ui/input-group';

describe('Form / FormItem', () => {
  it('label 指向真实输入框，错误信息通过 aria-describedby 关联', async () => {
    let form!: FormInstance<{ email: string }>;

    function Harness() {
      form = useForm<{ email: string }>({ defaultValues: { email: '' } });
      return (
        <Form
          form={form}
          onSubmit={async () => {
            await form.trigger();
          }}
        >
          <FormItem
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }]}
          >
            {({ field }) => <input {...field} />}
          </FormItem>
          <button type="submit">提交</button>
        </Form>
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('邮箱');
    expect(input).toHaveAttribute('id');

    await act(async () => {
      screen.getByRole('button', { name: '提交' }).click();
    });

    const error = await screen.findByText('请输入邮箱');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('description 在无错误时作为帮助文案关联到控件', () => {
    function Harness() {
      const form = useForm({ defaultValues: { email: '' } });
      return (
        <Form form={form}>
          <FormItem name="email" label="邮箱" description="用于接收通知">
            {({ field }) => <input {...field} />}
          </FormItem>
        </Form>
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('邮箱');
    const hint = screen.getByText('用于接收通知');
    expect(input).toHaveAttribute('aria-describedby', hint.id);
  });

  it('value/onChange 穿透 InputGroup，落到内部 input 而非 addon', async () => {
    let form!: FormInstance<{ email: string }>;

    function Harness() {
      form = useForm<{ email: string }>({ defaultValues: { email: '' } });
      return (
        <Form form={form}>
          <FormItem name="email" label="邮箱">
            {({ field }) => (
              <InputGroup>
                <InputGroupAddon>@</InputGroupAddon>
                <InputGroupInput {...field} />
              </InputGroup>
            )}
          </FormItem>
        </Form>
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('邮箱');
    expect(input.tagName).toBe('INPUT');

    await act(async () => {
      form.setValue('email', 'a@b.com');
    });
    expect(input).toHaveValue('a@b.com');
  });
});
