import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminExport, type AppliedFilter } from '~/admin-ui/primitives';
import { useToast } from '~/admin-ui/providers/ToastProvider';
import type {
  AdminPageResult,
  AdminPaymentOrderRow,
  PaymentDisplayStatus,
} from '../../../types/payment';
import { adminPaymentOrdersApi } from './api';
import {
  EMPTY_PAYMENT_ORDER_FILTERS,
  ORDER_PROVIDER_IDS,
  PAYMENT_ORDER_STATUS_OPTIONS,
  PAYMENT_ORDER_TIME_FIELD_OPTIONS,
  PAYMENT_STATUS_META,
  type PaymentOrderFilterKey,
  type PaymentOrderFilterValues,
} from './constants';
import { providerLabel } from './utils';
import { useDraftList, type ListParams } from './useDraftList';

/** 支付订单的筛选、地址栏同步与导出。 */

type PaymentOrderQuery = {
  status?: string;
  keyword?: string;
  providerId?: string;
  timeField?: string;
  from?: string;
  to?: string;
};

const ORDER_STATUS_VALUES = new Set<string>(PAYMENT_ORDER_STATUS_OPTIONS.map((o) => o.value));
const ORDER_TIME_FIELD_VALUES = new Set<string>(PAYMENT_ORDER_TIME_FIELD_OPTIONS.map((o) => o.value));
const ORDER_PROVIDER_VALUE_SET = new Set<string>(ORDER_PROVIDER_IDS);

function readInitialOrderFilters(searchParams: URLSearchParams): PaymentOrderFilterValues {
  const rawStatus = searchParams.get('status');
  const rawProvider = searchParams.get('providerId');
  const rawTimeField = searchParams.get('timeField');

  return {
    keyword: searchParams.get('keyword') ?? '',
    status:
      rawStatus && ORDER_STATUS_VALUES.has(rawStatus)
        ? (rawStatus as PaymentDisplayStatus)
        : undefined,
    providerId: rawProvider && ORDER_PROVIDER_VALUE_SET.has(rawProvider) ? rawProvider : undefined,
    timeField: rawTimeField && ORDER_TIME_FIELD_VALUES.has(rawTimeField) ? rawTimeField : undefined,
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };
}

function orderQueryOf(values: PaymentOrderFilterValues): PaymentOrderQuery {
  return {
    status: values.status,
    keyword: values.keyword.trim() || undefined,
    providerId: values.providerId,
    timeField: values.timeField,
    from: values.from || undefined,
    to: values.to || undefined,
  };
}

function orderChips(
  applied: PaymentOrderFilterValues,
  clear: (keys: Array<keyof PaymentOrderFilterValues>) => void,
): AppliedFilter[] {
  const chips: AppliedFilter[] = [];

  if (applied.keyword) {
    chips.push({
      key: 'keyword',
      label: `关键词：${applied.keyword}`,
      onClear: () => clear(['keyword']),
    });
  }
  if (applied.status) {
    chips.push({
      key: 'status',
      label: `状态：${PAYMENT_STATUS_META[applied.status]?.label ?? applied.status}`,
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
  if (applied.timeField) {
    chips.push({
      key: 'timeField',
      label: `时间口径：${
        PAYMENT_ORDER_TIME_FIELD_OPTIONS.find((o) => o.value === applied.timeField)?.label ??
        applied.timeField
      }`,
      onClear: () => clear(['timeField']),
    });
  }
  // 起止日期同属一个条件：合成一枚 chip，避免撤掉一半留下半个时间窗
  if (applied.from || applied.to) {
    const label =
      applied.from && applied.to
        ? `时间：${applied.from} ~ ${applied.to}`
        : applied.from
          ? `时间：${applied.from} 起`
          : `时间：截至 ${applied.to}`;
    chips.push({ key: 'dateRange', label, onClear: () => clear(['from', 'to']) });
  }

  return chips;
}

export function usePaymentOrderFilters() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const list = useDraftList<
    AdminPageResult<AdminPaymentOrderRow>,
    PaymentOrderFilterValues,
    PaymentOrderQuery
  >({
    fetcher: useCallback(
      (params: ListParams & PaymentOrderQuery) =>
        adminPaymentOrdersApi.list({
          page: params.page,
          pageSize: params.pageSize,
          status: params.status,
          keyword: params.keyword,
          providerId: params.providerId,
          timeField: params.timeField as 'created' | 'paid' | 'credited' | undefined,
          from: params.from,
          to: params.to,
        }),
      [],
    ),
    initial: readInitialOrderFilters(searchParams),
    empty: EMPTY_PAYMENT_ORDER_FILTERS,
    toQuery: orderQueryOf,
    sync: (params) => ({
      keyword: params.keyword,
      status: params.status,
      providerId: params.providerId,
      timeField: params.timeField,
      from: params.from,
      to: params.to,
    }),
    buildChips: orderChips,
    normalize: (values) => ({ ...values, keyword: values.keyword.trim() }),
  });

  const { exporting, runExport } = useAdminExport(toast);

  const exportCsv = () =>
    runExport(() => {
      const query = orderQueryOf(list.applied);
      return adminPaymentOrdersApi.exportCsv({
        status: query.status,
        keyword: query.keyword,
        providerId: query.providerId,
        timeField: query.timeField as 'created' | 'paid' | 'credited' | undefined,
        from: query.from,
        to: query.to,
      });
    }, '导出已开始下载');

  return {
    ...list,
    exporting,
    exportCsv,
    updateFilter: list.updateFilter as (key: PaymentOrderFilterKey, value: string | undefined) => void,
  };
}
