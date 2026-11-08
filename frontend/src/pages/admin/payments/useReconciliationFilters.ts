import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAdminExport, type AppliedFilter } from '~/admin-ui/primitives';
import { useToast } from '~/admin-ui/providers/ToastProvider';
import type { AdminPageResult, AdminReconciliationRun } from '../../../types/payment';
import { adminPaymentReconciliationApi } from './api';
import {
  EMPTY_RECONCILIATION_FILTERS,
  RECONCILIATION_PROVIDER_IDS,
  RECONCILIATION_RUN_STATUS_META,
  type ReconciliationFilterKey,
  type ReconciliationFilterValues,
} from './constants';
import { providerLabel } from './utils';
import { useDraftList, type ListParams } from './useDraftList';

/**
 * 对账列表的筛选、URL 同步与导出。
 *
 * 渠道与账单日既是筛选条件，也是「执行对账」的入参；执行成功后页面调用
 * `applyFilters()` 把列表切到本次执行的条件，不再另设一组重复控件。
 */

type ReconciliationQuery = {
  providerId?: string;
  status?: string;
  billDate?: string;
};

const BILL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function readInitialReconciliationFilters(
  searchParams: URLSearchParams,
): ReconciliationFilterValues {
  const rawProvider = searchParams.get('providerId');
  const rawStatus = searchParams.get('status');
  const rawBillDate = searchParams.get('billDate');

  return {
    providerId:
      rawProvider && (RECONCILIATION_PROVIDER_IDS as readonly string[]).includes(rawProvider)
        ? rawProvider
        : undefined,
    status:
      rawStatus && Object.prototype.hasOwnProperty.call(RECONCILIATION_RUN_STATUS_META, rawStatus)
        ? rawStatus
        : undefined,
    // 首次进入不预设任何筛选条件；账单日由用户显式选择（也是执行对账的前提）
    billDate: rawBillDate && BILL_DATE_PATTERN.test(rawBillDate) ? rawBillDate : '',
  };
}

function reconciliationQueryOf(values: ReconciliationFilterValues): ReconciliationQuery {
  return {
    providerId: values.providerId,
    status: values.status,
    billDate: values.billDate || undefined,
  };
}

function reconciliationChips(
  applied: ReconciliationFilterValues,
  clear: (keys: Array<keyof ReconciliationFilterValues>) => void,
): AppliedFilter[] {
  const chips: AppliedFilter[] = [];

  if (applied.providerId) {
    chips.push({
      key: 'providerId',
      label: `渠道：${providerLabel(applied.providerId)}`,
      onClear: () => clear(['providerId']),
    });
  }
  if (applied.status) {
    chips.push({
      key: 'status',
      label: `状态：${
        RECONCILIATION_RUN_STATUS_META[
          applied.status as keyof typeof RECONCILIATION_RUN_STATUS_META
        ]?.label ?? applied.status
      }`,
      onClear: () => clear(['status']),
    });
  }
  if (applied.billDate) {
    chips.push({
      key: 'billDate',
      label: `账单日：${applied.billDate}`,
      onClear: () => clear(['billDate']),
    });
  }

  return chips;
}

export function useReconciliationFilters() {
  const toast = useToast();
  const [searchParams] = useSearchParams();

  const list = useDraftList<
    AdminPageResult<AdminReconciliationRun>,
    ReconciliationFilterValues,
    ReconciliationQuery
  >({
    fetcher: useCallback(
      (params: ListParams & ReconciliationQuery) =>
        adminPaymentReconciliationApi.list({
          page: params.page,
          pageSize: params.pageSize,
          providerId: params.providerId,
          status: params.status,
          // 列表按账单日区间过滤；单日条件写成 from = to
          from: params.billDate,
          to: params.billDate,
        }),
      [],
    ),
    initial: readInitialReconciliationFilters(searchParams),
    empty: EMPTY_RECONCILIATION_FILTERS,
    toQuery: reconciliationQueryOf,
    sync: (params) => ({
      providerId: params.providerId,
      status: params.status,
      billDate: params.billDate,
    }),
    buildChips: reconciliationChips,
  });

  const { exporting, runExport } = useAdminExport(toast);

  const exportCsv = () =>
    runExport(
      () =>
        adminPaymentReconciliationApi.exportCsv({
          providerId: list.applied.providerId,
          status: list.applied.status,
          from: list.applied.billDate || undefined,
          to: list.applied.billDate || undefined,
        }),
      '导出已开始下载',
    );

  return {
    ...list,
    exporting,
    exportCsv,
    updateFilter: list.updateFilter as (
      key: ReconciliationFilterKey,
      value: string | undefined,
    ) => void,
  };
}
