import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AppliedFilter } from '~/admin-ui/primitives';
import type { AdminPageResult, AdminPaymentException } from '../../../types/payment';
import { adminPaymentExceptionsApi } from './api';
import {
  EMPTY_PAYMENT_EXCEPTION_FILTERS,
  ORDER_PROVIDER_IDS,
  PAYMENT_EXCEPTION_PRIORITY_OPTIONS,
  PAYMENT_EXCEPTION_STATUS_OPTIONS,
  type PaymentExceptionFilterKey,
  type PaymentExceptionFilterValues,
} from './constants';
import { providerLabel } from './utils';
import { useDraftList, type ListParams } from './useDraftList';

/** 支付异常单的筛选与地址栏同步。 */

type PaymentExceptionQuery = {
  status?: string;
  providerId?: string;
  priority?: string;
  overdue?: boolean;
};

const EXCEPTION_STATUS_VALUES = new Set<string>(
  PAYMENT_EXCEPTION_STATUS_OPTIONS.map((o) => o.value),
);
const EXCEPTION_PRIORITY_VALUES = new Set<string>(
  PAYMENT_EXCEPTION_PRIORITY_OPTIONS.map((o) => o.value),
);
const ORDER_PROVIDER_VALUE_SET = new Set<string>(ORDER_PROVIDER_IDS);

function readInitialExceptionFilters(searchParams: URLSearchParams): PaymentExceptionFilterValues {
  const rawStatus = searchParams.get('status');
  const rawProvider = searchParams.get('providerId');
  const rawPriority = searchParams.get('priority');
  const rawOverdue = searchParams.get('overdue');

  return {
    status: rawStatus && EXCEPTION_STATUS_VALUES.has(rawStatus) ? rawStatus : undefined,
    providerId: rawProvider && ORDER_PROVIDER_VALUE_SET.has(rawProvider) ? rawProvider : undefined,
    priority: rawPriority && EXCEPTION_PRIORITY_VALUES.has(rawPriority) ? rawPriority : undefined,
    overdue: rawOverdue === 'true' || rawOverdue === 'false' ? rawOverdue : undefined,
  };
}

function exceptionQueryOf(values: PaymentExceptionFilterValues): PaymentExceptionQuery {
  return {
    status: values.status,
    providerId: values.providerId,
    priority: values.priority,
    overdue: values.overdue === undefined ? undefined : values.overdue === 'true',
  };
}

function exceptionChips(
  applied: PaymentExceptionFilterValues,
  clear: (keys: Array<keyof PaymentExceptionFilterValues>) => void,
): AppliedFilter[] {
  const chips: AppliedFilter[] = [];

  if (applied.status) {
    chips.push({
      key: 'status',
      label: `状态：${
        PAYMENT_EXCEPTION_STATUS_OPTIONS.find((o) => o.value === applied.status)?.label ??
        applied.status
      }`,
      onClear: () => clear(['status']),
    });
  }
  if (applied.providerId) {
    chips.push({
      key: 'providerId',
      label: `渠道：${providerLabel(applied.providerId)}`,
      onClear: () => clear(['providerId']),
    });
  }
  if (applied.priority) {
    chips.push({
      key: 'priority',
      label: `优先级：${PAYMENT_EXCEPTION_PRIORITY_OPTIONS.find((o) => o.value === applied.priority)?.label ?? applied.priority}`,
      onClear: () => clear(['priority']),
    });
  }
  if (applied.overdue !== undefined) {
    chips.push({
      key: 'overdue',
      label: `SLA：${applied.overdue === 'true' ? '已逾期' : '含未逾期'}`,
      onClear: () => clear(['overdue']),
    });
  }

  return chips;
}

export function usePaymentExceptionFilters() {
  const [searchParams] = useSearchParams();

  const list = useDraftList<
    AdminPageResult<AdminPaymentException>,
    PaymentExceptionFilterValues,
    PaymentExceptionQuery
  >({
    fetcher: useCallback(
      (params: ListParams & PaymentExceptionQuery) =>
        adminPaymentExceptionsApi.list({
          page: params.page,
          pageSize: params.pageSize,
          status: params.status,
          providerId: params.providerId,
          priority: params.priority,
          overdue: params.overdue,
        }),
      [],
    ),
    initial: readInitialExceptionFilters(searchParams),
    empty: EMPTY_PAYMENT_EXCEPTION_FILTERS,
    toQuery: exceptionQueryOf,
    sync: (params) => ({
      status: params.status,
      providerId: params.providerId,
      priority: params.priority,
      overdue: params.overdue,
    }),
    buildChips: exceptionChips,
  });

  return {
    ...list,
    updateFilter: list.updateFilter as (key: PaymentExceptionFilterKey, value: string | undefined) => void,
  };
}
