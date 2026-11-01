import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import {
  FormField,
  NumberField,
  PageTitle,
  Panel,
  SaveBar,
  SegmentedTabs,
  SelectField,
  SwitchField,
  TextField,
  ToneBadge,
  ClearableField,
} from '../index';

/**
 * shadcn 版后台控件的用法测试。
 *
 * 盯的是**本页自己写出来的约定**，不是 React 的活：
 *  - 控件必须带可访问名（后台 e2e 一律 `getByLabel` / `getByTestId`，不追类名）；
 *  - 数字框的 min/max 同时约束手打与步进；
 *  - 开关的 `aria-label` 在没有可见标签时是唯一的可读名来源。
 */
describe('shadcn 后台控件', () => {
  it('PageTitle 渲染标题与副标题', () => {
    render(<PageTitle title="系统设置" description="修改后提交" />);
    expect(screen.getByRole('heading', { name: '系统设置' })).toBeTruthy();
    expect(screen.getByText('修改后提交')).toBeTruthy();
  });

  it('Panel 渲染标题栏与内容', () => {
    render(
      <Panel title="上传" note="3 项可编辑">
        <span>内容</span>
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: '上传' })).toBeTruthy();
    expect(screen.getByText('3 项可编辑')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();
  });

  it('SaveBar 带 admin-save-bar 锚点', () => {
    render(<SaveBar>内容</SaveBar>);
    expect(screen.getByTestId('admin-save-bar')).toBeTruthy();
  });

  it('FormField 把标签关联到控件', () => {
    render(
      <FormField label="站点名称" htmlFor="site-name">
        <TextField value="" onChange={() => {}} id="site-name" />
      </FormField>,
    );
    expect(screen.getByLabelText('站点名称')).toBeTruthy();
  });

  it('FormField 未给 htmlFor 时自动生成 id 并注入控件', () => {
    render(
      <FormField label="站点名称">
        <TextField value="" onChange={() => {}} />
      </FormField>,
    );
    const input = screen.getByLabelText('站点名称') as HTMLInputElement;
    // 标签失联的控件在屏幕阅读器里没有名字，后台 e2e 的 getByLabel 也找不到
    expect(input.id).toBeTruthy();
  });

  it('FormField 必填时渲染星号', () => {
    render(
      <FormField label="变更原因" required>
        <TextField value="" onChange={() => {}} />
      </FormField>,
    );
    // 星号是 `aria-hidden` 的装饰字符：可访问名仍是「变更原因」，
    // 屏幕阅读器不会读出「变更原因星号」
    expect(screen.getByLabelText('变更原因')).toBeTruthy();
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('FormField 错误信息用 role=alert 暴露', () => {
    render(
      <FormField label="变更原因" error="请填写变更原因">
        <TextField value="" onChange={() => {}} />
      </FormField>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('请填写变更原因');
  });

  it('TextField 受控且可输入', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState('');
      return <TextField value={value} onChange={setValue} ariaLabel="站点名称" />;
    }
    render(<Controlled />);
    const input = screen.getByLabelText('站点名称') as HTMLInputElement;
    await user.type(input, '货觉');
    expect(input.value).toBe('货觉');
  });

  it('ClearableField 有值时显示清空按钮并清空', async () => {
    const user = userEvent.setup();
    let captured = 'abc';
    render(
      <ClearableField
        value={captured}
        onChange={(next) => {
          captured = next;
        }}
        ariaLabel="筛选"
      />,
    );
    await user.click(screen.getByRole('button', { name: '清空' }));
    expect(captured).toBe('');
  });

  it('NumberField 的步进受 min/max 约束', async () => {
    const user = userEvent.setup();
    const values: Array<number | undefined> = [];
    render(
      <NumberField
        value={1}
        min={1}
        max={2}
        onChange={(next) => values.push(next)}
        ariaLabel="上限"
      />,
    );
    const decrease = screen.getByRole('button', { name: '减少' });
    await user.click(decrease);
    // 已经到下限，再点不该低于 min
    expect(values.every((v) => v === undefined || v >= 1)).toBe(true);
  });

  it('SwitchField 用 aria-label 提供可读名', () => {
    render(
      <SwitchField checked={false} onChange={() => {}} ariaLabel="维护模式" />,
    );
    expect(screen.getByLabelText('维护模式')).toBeTruthy();
  });

  it('SegmentedTabs 标记选中项', async () => {
    const user = userEvent.setup();
    let captured = 'a';
    render(
      <SegmentedTabs
        value="a"
        onChange={(next) => {
          captured = next;
        }}
        options={[
          { value: 'a', label: '站点' },
          { value: 'b', label: '上传' },
        ]}
        ariaLabel="配置分组"
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    await user.click(tabs[1]);
    expect(captured).toBe('b');
  });

  it('SelectField 渲染选项', async () => {
    const user = userEvent.setup();
    render(
      <SelectField
        value="1"
        onChange={() => {}}
        options={[
          { value: '1', label: '一' },
          { value: '2', label: '二' },
        ]}
        ariaLabel="取值"
      />,
    );
    await user.click(screen.getByLabelText('取值'));
    expect(await screen.findByRole('option', { name: '二' })).toBeTruthy();
  });

  it('ToneBadge 按 tone 上语义色类', () => {
    render(<ToneBadge tone="danger">失败</ToneBadge>);
    const badge = screen.getByText('失败');
    expect(badge.className).toContain('bg-danger-soft');
    expect(badge.className).toContain('text-danger-text');
  });
});
