import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
  type FormInstance,
} from '../../index';

describe('表单组合件（shadcn FormField + react-hook-form）', () => {
  it('label 指向真实输入框，错误信息通过 aria-describedby 关联', async () => {
    let form!: FormInstance<{ email: string }>;

    function Harness() {
      form = useForm<{ email: string }>({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(() => undefined)} noValidate>
            <FormField
              control={form.control}
              name="email"
              rules={{ required: '请输入邮箱' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <button type="submit">提交</button>
          </form>
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
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('description 在无错误时作为帮助文案关联到控件', () => {
    function Harness() {
      const form = useForm({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>邮箱</FormLabel>
                <FormControl>
                  <input {...field} />
                </FormControl>
                <FormDescription>用于接收通知</FormDescription>
              </FormItem>
            )}
          />
        </Form>
      );
    }

    render(<Harness />);
    const input = screen.getByLabelText('邮箱');
    const description = screen.getByText('用于接收通知');
    expect(input.getAttribute('aria-describedby')).toContain(description.id);
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });
});
