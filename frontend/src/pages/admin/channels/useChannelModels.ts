import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminChannelModelView,
  ChannelModelHealthRowView,
  ProtocolCatalogEntryView,
} from '../../../types/model';

import { adminChannelModelsApi, adminChannelsApi } from './api';

/** 渠道下的模型清单：读取与手动刷新 */
export function useChannelModels(channelId: string) {
  const [models, setModels] = useState<AdminChannelModelView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!channelId) return;
    setLoading(true);
    try {
      const list = await adminChannelsApi.models(channelId);
      setModels(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { models, loading, error, load };
}

/**
 * 24h 稳定性按渠道模型 id 索引。
 *
 * 与「全部模型」同一个数据源：排障时先看「这条渠道哪条线在坏」，
 * 每条线都要切到另一个视图去查等于把定位和处置拆成两件事。
 * 读取失败不影响清单 —— 稳定性只是辅助信息。
 */
export function useChannelModelHealth(channelId: string) {
  const [healthById, setHealthById] = useState<Map<string, ChannelModelHealthRowView>>(new Map());
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setHealthLoading(true);
    void adminChannelModelsApi
      .health()
      .then((res) => {
        if (active) setHealthById(new Map(res.items.map((row) => [row.id, row])));
      })
      .catch(() => {
        if (active) setHealthById(new Map());
      })
      .finally(() => {
        if (active) setHealthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [channelId]);

  return { healthById, healthLoading };
}

/** 协议目录：按能力过滤，表单下拉直接消费 */
export function useProtocolCatalog(capability: string) {
  const [protocols, setProtocols] = useState<ProtocolCatalogEntryView[]>([]);

  useEffect(() => {
    let active = true;
    void adminChannelsApi
      .protocols(capability)
      .then((res) => {
        if (active) setProtocols(res.protocols.filter((item) => item.selectable));
      })
      .catch(() => {
        if (active) setProtocols([]);
      });
    return () => {
      active = false;
    };
  }, [capability]);

  const options = useMemo(
    () => protocols.map((item) => ({ value: item.id, label: `${item.label}（${item.id}）` })),
    [protocols],
  );

  return { protocols, options };
}
