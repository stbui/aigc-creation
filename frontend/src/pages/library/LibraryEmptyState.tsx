import { Upload } from 'lucide-react';

import {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
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
    <EmptyState className="min-h-[300px] gap-2 rounded-[14px] border border-dashed border-border bg-[rgba(255,255,255,0.66)]">
      <EmptyStateMedia>
        <img src="/asset-library/empty.svg" alt="" width={160} height={160} className="size-40 object-contain" />
      </EmptyStateMedia>
      <EmptyStateHeader>
        <EmptyStateTitle className="text-sm leading-5 font-semibold text-foreground">{copy.title}</EmptyStateTitle>
        <EmptyStateDescription className="text-xs leading-5 text-muted-foreground">
          {copy.description}
        </EmptyStateDescription>
      </EmptyStateHeader>
      <EmptyStateContent>
        <Button
          variant={primary ? 'default' : 'outline'}
          className={cn('mt-2', primary && 'bg-brand text-primary-foreground')}
          onClick={onAction}
        >
          {primary ? <Upload className="size-3.5" /> : undefined}
          {copy.action}
        </Button>
      </EmptyStateContent>
    </EmptyState>
  );
}
