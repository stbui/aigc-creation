import type { ReactNode } from 'react';
import {
  Tabs as ShadcnTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '~/admin-ui/components/ui/tabs';
import { cn } from '../lib/cn';

export interface TabItem {
  key: string;
  label: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  items: TabItem[];
  className?: string;
  tabBarClassName?: string;
}

/** antd Tabs 的兼容壳：items[].key/label/children。 */
export function Tabs({
  activeKey,
  defaultActiveKey,
  onChange,
  items,
  className,
  tabBarClassName,
}: TabsProps) {
  return (
    <ShadcnTabs
      value={activeKey}
      defaultValue={defaultActiveKey ?? items[0]?.key}
      onValueChange={onChange}
      className={className}
    >
      {/*
        线形页签（antd 默认观感）：C 端页签都是页面级导航，不用 shadcn 默认的灰底胶囊。
        宽度交给内容本身，`w-full` 会把两个页签拉成半屏宽的开关。
      */}
      <TabsList
        variant="line"
        className={cn('ui-tabs-list h-auto justify-start gap-6 overflow-x-auto', tabBarClassName)}
      >
        {items.map((item) => (
          <TabsTrigger key={item.key} value={item.key} disabled={item.disabled}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.key} value={item.key}>
          {item.children}
        </TabsContent>
      ))}
    </ShadcnTabs>
  );
}
