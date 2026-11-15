import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { PageHeader, RadarPage } from './blocks';

export { TabsContent };

export function AdminPage({
  title,
  description,
  actions,
  tabs,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadarPage className={className}>
      <PageHeader title={title} description={description} actions={actions} className="mb-3" />
      {tabs && <div className="mb-3">{tabs}</div>}
      {children}
    </RadarPage>
  );
}

export function AdminTabs({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: ReadonlyArray<{ value: string; label: ReactNode }>;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={cn('gap-3', className)}>
      <TabsList aria-label={ariaLabel} className="h-9 w-fit gap-1 rounded-[8px] border border-radar-ink-200 bg-radar-surface p-1">
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="h-7 rounded-[6px] px-3 text-[13px] font-medium text-radar-ink-600 data-[state=active]:bg-radar-brand data-[state=active]:text-white"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
