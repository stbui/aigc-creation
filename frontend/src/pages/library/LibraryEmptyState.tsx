import { Upload } from 'lucide-react';

import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  cn,
} from './components';
import type { EmptyStateCopy } from './utils';

/**
 * 空态卡：只负责外观与按钮的强调级别。
 *
 * 文案由 `buildEmptyStateCopy()` 按登录态 / 项目 / 筛选给出，行动由页面处理。
 */
export interface LibraryEmptyStateProps {
  copy: EmptyStateCopy;
  /** 主行动（上传）为 true；「清除筛选」这类次要动作为 false */
  primary: boolean;
  onAction: () => void;
}

export function LibraryEmptyState({ copy, primary, onAction }: LibraryEmptyStateProps) {
  return (
    <Empty className="min-h-[300px] gap-2 rounded-[14px] border border-dashed border-border bg-[rgba(255,255,255,0.66)]">
      <EmptyMedia>
        <img src="/asset-library/empty.svg" alt="" width={160} height={160} className="size-40 object-contain" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="text-sm leading-5 font-semibold text-foreground">{copy.title}</EmptyTitle>
        <EmptyDescription className="text-xs leading-5 text-muted-foreground">
          {copy.description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant={primary ? 'default' : 'outline'}
          className={cn('mt-2', primary && 'bg-brand text-primary-foreground')}
          onClick={onAction}
        >
          {primary ? <Upload className="size-3.5" /> : undefined}
          {copy.action}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
