/**
 * 积分明细页面的 hooks —— 目录内文件的唯一 hooks 入口。
 *
 * 通用登录态 / SEO / 媒体查询从 `src` 转出；只服务本页的账本取数直接定义在这里。
 */

import { useCallback, useEffect, useState } from 'react';

import type { CreditBalance, CreditLedgerEntry, CreditLot } from '../../types/api';
import { creditsApi } from './api';
import { PAGE_SIZE, type LedgerFilter, type Tab } from './constants';
import { ledgerFilterParams } from './utils';

/** 登录态: 未登录不请求需鉴权的积分接口 */
export { useAuth } from '../../context/AuthContext';
/** 路由级 SEO 元信息 */
export { useDocumentMeta } from '../../hooks/useDocumentMeta';
/** 窄屏判定（表格换列表） */
export { useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * 积分余额 / 流水 / 批次。
 *
 * 数据全部来自 `/credits/*`，前端不做任何加减运算 —— 余额由后端按批次
 * 汇总推导，本地重算会与真实账本对不上。三个接口用 `allSettled` 并发取，
 * 任一失败不阻断其余两个；流水筛选与分页只重取流水本身。
 */
export function useCreditsData(token: string | null) {
  const [tab, setTab] = useState<Tab>('ledger');
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [lotsPage, setLotsPage] = useState(1);

  /** 只切流水页：不重取余额/批次，也不整页闪骨架 */
  const loadLedgerPage = useCallback(async (page: number, filter: LedgerFilter) => {
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      const response = await creditsApi.ledger({
        limit: PAGE_SIZE,
        offset: Math.max(0, (page - 1) * PAGE_SIZE),
        ...ledgerFilterParams(filter),
      });
      setLedger(response.items);
      setLedgerTotal(response.total);
      setLedgerPage(page);
    } catch (cause) {
      setLedgerError((cause as Error)?.message || '积分流水加载失败');
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const load = useCallback(async (filter: LedgerFilter = 'all') => {
    setLoading(true);
    setError(null);
    setLedgerError(null);
    try {
      const [balanceResult, ledgerResult, lotsResult] = await Promise.allSettled([
        creditsApi.balance(),
        creditsApi.ledger({ limit: PAGE_SIZE, offset: 0, ...ledgerFilterParams(filter) }),
        creditsApi.lots(),
      ]);
      if (balanceResult.status === 'fulfilled') setBalance(balanceResult.value);
      if (ledgerResult.status === 'fulfilled') {
        setLedger(ledgerResult.value.items);
        setLedgerTotal(ledgerResult.value.total);
        // 重新取数后回到第一页, 免得停在一个已经不存在的页码上
        setLedgerPage(1);
      }
      if (ledgerResult.status === 'rejected') {
        setLedgerError((ledgerResult.reason as Error)?.message || '积分流水加载失败');
      }
      if (lotsResult.status === 'fulfilled') {
        setLots(lotsResult.value);
        setLotsPage(1);
      }
      if (balanceResult.status === 'rejected' && ledgerResult.status === 'rejected') {
        setError((balanceResult.reason as Error)?.message || '积分数据加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLedgerFilterChange = useCallback(
    (filter: LedgerFilter) => {
      if (filter === ledgerFilter) return;
      setLedgerFilter(filter);
      setLedgerPage(1);
      void loadLedgerPage(1, filter);
    },
    [ledgerFilter, loadLedgerPage],
  );

  // 依赖 token: 登录 / 退出都要重取
  useEffect(() => {
    if (!token) {
      // guest: 三个积分接口都要鉴权, 不发就会连着 401 且渲染成「加载失败」
      setBalance(null);
      setLedger([]);
      setLedgerTotal(0);
      setLedgerError(null);
      setLedgerFilter('all');
      setLots([]);
      setLoading(false);
      return;
    }
    setLedgerFilter('all');
    void load('all');
  }, [token, load]);

  const retryLedger = useCallback(() => {
    // 与首屏同一入口：余额 / 批次 / 流水一起重取，避免只修好流水而余额仍是空的
    void load(ledgerFilter);
  }, [load, ledgerFilter]);

  const retryAll = useCallback(() => {
    void load();
  }, [load]);

  return {
    tab,
    setTab,
    balance,
    ledger,
    ledgerTotal,
    ledgerLoading,
    ledgerError,
    ledgerFilter,
    handleLedgerFilterChange,
    lots,
    loading,
    error,
    ledgerPage,
    lotsPage,
    setLotsPage,
    loadLedgerPage,
    retryLedger,
    retryAll,
  };
}
