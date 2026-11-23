import { render, screen } from '@testing-library/react';
import { Mail } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Form, FormControl, FormField, FormItem, FormLabel, useForm } from '../../index';
import { CharacterCountTextarea } from '../character-count-textarea';
import { IconInput } from '../icon-input';

function IconInputHarness() {
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
              <IconInput {...field} icon={<Mail />} placeholder="账号（邮箱）" />
            </FormControl>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe('输入语义组件', () => {
  it('IconInput 组合 shadcn InputGroup，并透传表单控件的无障碍属性', () => {
    render(<IconInputHarness />);
    const input = screen.getByLabelText('邮箱');

    expect(input).toHaveAttribute('data-slot', 'input-group-control');
    expect(input.closest('[data-slot="input-group"]')).not.toBeNull();
    expect(input).toHaveAttribute('id');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('CharacterCountTextarea 显示当前长度并把计数关联到输入框', () => {
    render(
      <CharacterCountTextarea
        aria-label="详细描述"
        value="abc"
        maxLength={10}
        onChange={() => undefined}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: '详细描述' });
    const count = screen.getByText('3/10');

    expect(textarea).toHaveAttribute('data-slot', 'textarea');
    expect(textarea).toHaveAttribute('maxlength', '10');
    expect(count).toHaveAttribute('data-slot', 'field-description');
    expect(textarea.getAttribute('aria-describedby')).toContain(count.id);
  });
});
