import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../vendor/boardui/components/base/buttons/button';
import { Chip } from '../../vendor/boardui/components/base/badges/chip';
import { adminModelApi, adminModelChannelsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { Notice, Result, Skeleton } from '../../admin-ui/primitives';
import { TabGroup } from '../../admin-ui/controls';
import type { AdminModelChannelsSnapshot, AdminModelConfig } from '../../types/api';
import { AdminStaleError } from '../../components/admin/AdminWidgets';
import { PageHeader } from '../../components/admin/PageHeader';
import { InlineConfirm } from './modelConfig/InlineConfirm';
import { ChannelManagementTab } from './modelConfig/ChannelManagementTab';
import { GlobalSettingsTab } from './modelConfig/GlobalSettingsTab';
import { ModelCatalogTab } from './modelConfig/ModelCatalogTab';
import { RouteSettingsTab } from './modelConfig/RouteSettingsTab';
import { useModelConfigDraft } from './modelConfig/useModelConfigDraft';

type TabKey = 'channels' | 'catalog' | 'routes' | 'settings';

/**
 * 模型配置页。
 *
 * 结构：页头 + 页签 + 底部保存条。
 *
 * ## 两条不能破的约束
 *
 * 1. 某模态一旦有线路，旧版 baseUrl/token/model/provider 不再参与调度 ——
 *    页面上必须把「当前生效的是哪一套」说清楚，否则运营改了不生效的字段会
 *    以为功能坏了。
 * 2. 测试只验证地址与模型可达，不代表真实生成健康 —— 所以「测试通过」
 *    在这一页永远不写成「正常」。
 */
export function AdminModelConfigPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAdmin();
  const canWrite = can('model.config_write');
  const canChannelWrite = can('channel.route');
  const canTest = can('channel.test');

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabKey =
    tabParam === 'catalog' || tabParam === 'routes' || tabParam === 'settings' ? tabParam : 'channels';

  const [config, setConfig] = useState<AdminModelConfig | null>(null);
  const [channels, setChannels] = useState<AdminModelChannelsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const draftState = useModelConfigDraft(config);

  /*
   * 2026-10-23: 原 `load()` 从不置 `loading=true` —— 失败后点「重试」页面
   * 没有任何反馈, 用户只能反复点、猜是否生效。进入即置 true (与其它后台页一致),
   * 骨架屏仍只在「还没有 config」时出现, 已加载过则只换内容不塌整页。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, ch] = await Promise.all([adminModelApi.config(), adminModelChannelsApi.list()]);
      setConfig(c);
      setChannels(ch);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 有未保存的全局/路由修改时拦截离开 (刷新 + 站内跳转都拦) */
  useUnsavedGuard(draftState.dirty);

  const switchTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === 'channels') p.delete('tab');
    else p.set('tab', next);
    setParams(p, { replace: true });
  };

  const save = async (_typed: string, reason: string) => {
    if (!draftState.dirty) return;
    setSaving(true);
    try {
      const { settings, clears } = draftState.buildPayload();
      await adminModelApi.updateConfig(settings, clears, reason.trim() || undefined);
      toast.success(`已保存 ${draftState.changed.length + draftState.clearKeys.length} 项，立即生效`);
      setConfirmOpen(false);
      await load();
      draftState.reset();
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const routeDirty = useMemo(() => {
    const changed = draftState.changed.some((c) => c.key.startsWith('gateway.route.'));
    const cleared = draftState.clearKeys.some((k) => k.startsWith('gateway.route.'));
    return changed || cleared;
  }, [draftState.changed, draftState.clearKeys]);

  const settingsDirty = useMemo(() => {
    const changed = draftState.changed.some((c) => !c.key.startsWith('gateway.route.'));
    const cleared = draftState.clearKeys.some((k) => !k.startsWith('gateway.route.'));
    return changed || cleared;
  }, [draftState.changed, draftState.clearKeys]);

  if (loading && !config) {
    return (
      <div className="rounded-xl border border-border-table bg-white p-4">
        <Skeleton rows={6} />
      </div>
    );
  }

  // 已有配置时失败不塌整页: 线路表还要能看, 由下方 stale 提示交代刷新失败
  if (error && !config) {
    return (
      <Result
        tone="error"
        title="无法加载模型配置"
        description={error}
        actions={
          <Button variant="primary" size="small" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!config || !channels) return null;

  return (
    <>
      <PageHeader
        title="模型配置"
        description="按模态管理真实模型线路；没有线路时沿用旧版单通道配置。保存后立即生效，无需重启。"
        actions={
          <>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                if (draftState.dirty) {
                  toast.warning('有未保存的修改，请先保存或放弃后再离开');
                  return;
                }
                navigate('/admin/model-calls');
              }}
            >
              调用记录
            </Button>
            <Button variant="secondary" size="small" disabled={draftState.dirty} onClick={() => void load()}>
              刷新
            </Button>
          </>
        }
      />

      {/* 刷新失败但手上还有上一次的配置: 明说是旧值, 别让人拿过期线路做判断 */}
      {error && <AdminStaleError error={error} onRetry={() => void load()} />}

      {!canWrite && (
        <Notice
          tone="info"
          title="你当前的角色只能查看配置与线路健康；连通性测试可用，修改配置与线路需要管理员权限。"
        />
      )}

      {tab === 'channels' && (settingsDirty || routeDirty) && (
        <Notice
          tone="warn"
          title="全局设置 / 逐能力路由还有未保存修改"
          className="mb-3"
        >
          线路的新增、删除或排序会重新加载配置，可能丢弃这些修改；请先保存或放弃。
        </Notice>
      )}

      <TabGroup
        value={tab}
        onChange={switchTab}
        ariaLabel="模型配置分组"
        tabs={[
          {
            id: 'channels',
            label: '线路管理',
            content: (
              <ChannelManagementTab
                config={config}
                snapshot={channels}
                canWrite={canChannelWrite}
                canTest={canTest}
                onReload={load}
              />
            ),
          },
          {
            id: 'catalog',
            label: '可用模型',
            content: <ModelCatalogTab config={config} snapshot={channels} canTest={canTest} />,
          },
          {
            id: 'routes',
            label: (
              <span className="flex items-center gap-1.5">
                逐能力路由
                {routeDirty && <Chip variant="caption" color="yellow">未保存</Chip>}
              </span>
            ),
            content: (
              <RouteSettingsTab config={config} draftState={draftState} canWrite={canWrite} />
            ),
          },
          {
            id: 'settings',
            label: (
              <span className="flex items-center gap-1.5">
                全局设置
                {settingsDirty && <Chip variant="caption" color="yellow">未保存</Chip>}
              </span>
            ),
            content: (
              <GlobalSettingsTab
                config={config}
                draftState={draftState}
                canWrite={canWrite}
                canTest={canTest}
              />
            ),
          },
        ]}
      />

      {draftState.dirty && (
        <div className="sticky bottom-4 z-10 mt-3 rounded-xl border border-border-table bg-white px-4 py-2.5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-text-secondary">
              有 {draftState.changed.length + draftState.clearKeys.length} 项未保存修改
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                disabled={saving}
                onClick={() => {
                  draftState.reset();
                }}
              >
                放弃变更
              </Button>
              <Button
                variant="primary"
                size="small"
                disabled={saving || !canWrite}
                onClick={() => setConfirmOpen(true)}
              >
                保存变更
              </Button>
            </div>
          </div>
        </div>
      )}

      <InlineConfirm
        open={confirmOpen}
        title="确认保存模型配置"
        description="保存后立即生效，无需重启。错误的地址会让模型调用失败，任务会失败并自动退款。"
        impact={draftState.changed.map(
          (c) => `${c.label}：${String(c.value ?? '')} → ${String(draftState.draft[c.key] ?? '')}`,
        )}
        needReason
        reasonPlaceholder="如：切换图像模型线路"
        confirmText="确认保存"
        loading={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(typed, reason) => void save(typed, reason)}
      />
    </>
  );
}
