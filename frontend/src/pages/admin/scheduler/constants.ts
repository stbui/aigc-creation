/**
 * AdminSchedulerPage 的本地常量与类型。
 */

import { CheckCircle2, XCircle, Clock } from 'lucide-react';

export const FRESHNESS_STYLE: Record<
  'ok' | 'failed' | 'never',
  { row: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  ok: { row: 'border-border bg-card', icon: 'text-success-text', Icon: CheckCircle2 },
  failed: { row: 'border-danger-soft bg-danger-soft/40', icon: 'text-danger-text', Icon: XCircle },
  never: { row: 'border-border bg-card', icon: 'text-muted-foreground', Icon: Clock },
};
