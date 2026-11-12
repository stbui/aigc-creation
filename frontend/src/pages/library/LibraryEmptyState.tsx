import { Upload } from 'lucide-react';

import {
  Button,
  EmptyState,
  EmptyStateContent,
  EmptyStateDescription,
  EmptyStateHeader,
  EmptyStateMedia,
  EmptyStateTitle,
} from './components';
import type { EmptyStateCopy } from './utils';

/**
 * 空态卡：只负责外观与按钮的强调级别。
 *
 * 文案由 `buildEmptyStateCopy()` 按登录态 / 项目 / 筛选给出，行动由页面处理。
 */
export function LibraryEmptyState({
  copy,
  primary,
  onAction,
}: {
  copy: EmptyStateCopy;
  /** 主行动（上传）为 true；「清除筛选」这类次要动作为 false */
  primary: boolean;
  onAction: () => void;
}) {
  return (
    <EmptyState className="asset-library-empty asset-library-state-empty">
      <EmptyStateMedia>
        <img src="/asset-library/empty.svg" alt="" width={160} height={160} />
      </EmptyStateMedia>
      <EmptyStateHeader>
        <EmptyStateTitle>{copy.title}</EmptyStateTitle>
        <EmptyStateDescription>{copy.description}</EmptyStateDescription>
      </EmptyStateHeader>
      <EmptyStateContent>
        <Button
          type={primary ? 'primary' : 'default'}
          icon={primary ? <Upload className="size-3.5" /> : undefined}
          className={
            primary
              ? 'asset-library-button asset-library-button-primary asset-library-empty-action'
              : 'asset-library-button asset-library-empty-action'
          }
          onClick={onAction}
        >
          {copy.action}
        </Button>
      </EmptyStateContent>
    </EmptyState>
  );
}
