import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Button,
  Input,
  Label,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../index';

/**
 * shadcn 基座的冒烟测试。
 *
 * 存在的理由不是「测组件能不能渲染」——那是 React 的活。这条用例盯的是
 * 本项目**特有的几个坑**：
 *
 *  ① `cn` 必须是 clsx + twMerge 的组合。tailwind-merge 单独用会丢掉条件
 *     对象（实测 `twMerge([{ 'p-4': true }])` 返回空串），shadcn 的
 *     `cn('base', { 'p-4': isActive })` 写法会整段失效。
 *  ② 主题令牌必须指向项目既有令牌，而不是 shadcn 默认的灰阶。
 *  ③ **描边必须有兜底颜色**。本项目刻意不导入 Tailwind preflight（只取
 *     theme + utilities），preflight 里那句 `border-color: var(--color-border)`
 *     因此不存在 —— 只写 `border` 不写颜色类时颜色退回 `currentColor`。
 *     实测 shadcn 的 `outline` 按钮因此渲染成近黑色描边。
 *  ④ **`--background` 必须接卡片底**，不能接页面底。`bg-background` 在 shadcn
 *     里是「表面」语义（输入框 / 弹层 / 对话框），接页面灰会让所有输入框变灰底，
 *     在白卡片上像禁用态。
 */
describe('shadcn 基座', () => {
  it('cn 收敛冲突的 Tailwind 类', async () => {
    const { cn } = await import('~/admin-ui/lib/cn');
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-lg')).toBe('text-lg');
  });

  it('cn 保留条件对象里的类（tailwind-merge 单独用会丢掉）', async () => {
    const { cn } = await import('~/admin-ui/lib/cn');
    expect(cn('p-2', { 'p-4': true })).toBe('p-4');
    expect(cn('p-2', { 'p-4': false })).toBe('p-2');
  });

  it('Button 用 shadcn 的语义色类（bg-primary），而非裸色值', () => {
    render(<Button>提交</Button>);
    const button = screen.getByRole('button', { name: '提交' });
    expect(button.className).toContain('bg-primary');
    expect(button.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('Button 的变体可切换', () => {
    render(
      <Button variant="destructive" size="sm">
        删除
      </Button>,
    );
    const button = screen.getByRole('button', { name: '删除' });
    expect(button.dataset.variant).toBe('destructive');
    expect(button.dataset.size).toBe('sm');
    expect(button.className).toContain('bg-destructive');
  });

  it('Card 组合渲染', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>渠道</CardTitle>
        </CardHeader>
        <CardContent>内容</CardContent>
      </Card>,
    );
    expect(screen.getByText('渠道')).toBeTruthy();
    expect(screen.getByText('内容')).toBeTruthy();
  });

  it('Input 受控输入可用', () => {
    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <>
          <Label htmlFor="name">名称</Label>
          <Input id="name" value={value} onChange={(e) => setValue(e.target.value)} />
        </>
      );
    }
    render(<Controlled />);
    const input = screen.getByLabelText('名称') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.className).toContain('border-input');
  });

  it('Badge 带语义变体', () => {
    render(<Badge variant="secondary">进行中</Badge>);
    const badge = screen.getByText('进行中');
    expect(badge.className).toContain('bg-secondary');
  });
});

/**
 * 主题桥接的静态断言。
 *
 * 这些是 CSS 层的约定，jsdom 拿不到计算样式（`getComputedStyle` 不解析
 * 外部样式表），所以直接读源文件断言。改坏了会在这里红，而不是等到
 * 「描边变成黑圈」时才发现。
 */
describe('shadcn 主题桥接', () => {
  const theme = readFileSync(
    resolve(import.meta.dirname, '../../../styles/shadcn-theme.css'),
    'utf8',
  );

  it('描边兜底存在且落在 base 层（不能压过 utilities 层的 border-transparent）', () => {
    expect(theme).toContain('@layer base');
    // base 层里的 [data-slot] 兜底
    const baseBlock = theme.slice(theme.indexOf('@layer base'));
    expect(baseBlock).toContain('[data-slot]');
    expect(baseBlock).toContain('border-color: var(--border)');
  });

  it('--background 接卡片底而不是页面底（否则输入框是灰底）', () => {
    expect(theme).toMatch(/--background:\s*var\(--card-bg\)/);
    expect(theme).not.toMatch(/--background:\s*var\(--page-bg\)/);
  });

  it('语义色令牌带 status- 前缀，避免与 global.css 同名变量自引用', () => {
    expect(theme).toContain('--status-success-soft: var(--success-soft-bg)');
    expect(theme).toContain('--status-danger-text: var(--danger-text)');
    // 自引用形态（--danger-text: var(--danger-text)）会让变量解析失败
    expect(theme).not.toMatch(/--danger-text:\s*var\(--danger-text\)/);
    expect(theme).not.toMatch(/--warn-text:\s*var\(--warn-text\)/);
  });

  it('用 @theme inline 而非普通 @theme（普通写法会覆盖 global.css 的同名变量）', () => {
    expect(theme).toContain('@theme inline');
    expect(theme).not.toMatch(/^@theme\s*\{/m);
  });
});
