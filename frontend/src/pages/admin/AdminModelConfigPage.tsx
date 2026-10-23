import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Flex,
  Result,
  Skeleton,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { adminModelApi, adminModelChannelsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import type { AdminModelChannelsSnapshot, AdminModelConfig } from '../../types/api';
import { AdminStaleError } from '../../components/admin/AdminWidgets';
import { AntConfirm } from './modelConfig/AntConfirm';
import { ChannelManagementTab } from './modelConfig/ChannelManagementTab';
import { GlobalSettingsTab } from './modelConfig/GlobalSettingsTab';
import { ModelCatalogTab } from './modelConfig/ModelCatalogTab';
import { RouteSettingsTab } from './modelConfig/RouteSettingsTab';
import { useModelConfigDraft } from './modelConfig/useModelConfigDraft';

type TabKey = 'channels' | 'catalog' | 'routes' | 'settings';

/**
 * 模型配置页（antd 版）。
 *
 * 结构：Typography 页头 + antd Tabs + 三块内容 + 底部保存条。
 * 业务约束不变：
 *   1. 某模态一旦有线路，旧版 baseUrl/token/model/provider 不再参与调度；
 *   2. 测试只验证地址/模型可达，不代表真实生成健康。
 */
export function AdminModelConfigPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { can } = useAdmin();
  const canWrite = can('model.config_write');
  const canChannelWrite = can('channel.route');
  const canTest = can('channel.test');

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabKey =
    tabParam === 'catalog' || tabParam === 'routes' || tabParam === 'settings'
      ? tabParam
      : 'channels';

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
      void message.success(`已保存 ${draftState.changed.length + draftState.clearKeys.length} 项，立即生效`);
      setConfirmOpen(false);
      await load();
      draftState.reset();
    } catch (e) {
      void message.error((e as Error).message || '保存失败');
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

  const tabItems = [
    {
      key: 'channels',
      label: '线路管理',
      children: config && channels && (
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
      key: 'catalog',
      label: '可用模型',
      children: config && channels && (
        <ModelCatalogTab config={config} snapshot={channels} canTest={canTest} />
      ),
    },
    {
      key: 'routes',
      label: (
        <Space size={6}>
          逐能力路由
          {routeDirty && <Badge status="warning" />}
        </Space>
      ),
      children: config && (
        <RouteSettingsTab config={config} draftState={draftState} canWrite={canWrite} />
      ),
    },
    {
      key: 'settings',
      label: (
        <Space size={6}>
          全局设置
          {settingsDirty && <Badge status="warning" />}
        </Space>
      ),
      children: config && (
        <GlobalSettingsTab config={config} draftState={draftState} canWrite={canWrite} canTest={canTest} />
      ),
    },
  ];

  if (loading && !config) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  // 已有配置时失败不塌整页: 线路表还要能看, 由下方 stale 提示交代刷新失败
  if (error && !config) {
    return (
      <Result
        status="warning"
        title="无法加载模型配置"
        subTitle={error}
        extra={
          <Button type="primary" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!config || !channels) return null;

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <Flex vertical gap={16}>
      <Flex justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            模型配置
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            按模态管理真实模型线路；没有线路时沿用旧版单通道配置。保存后立即生效，无需重启。
          </Typography.Paragraph>
        </div>
        <Space style={{ marginLeft: 'auto' }}>
          <Button
            onClick={() => {
              if (draftState.dirty) {
                void message.warning('有未保存的修改，请先保存或放弃后再离开');
                return;
              }
              navigate('/admin/model-calls');
            }}
          >
            调用记录
          </Button>
          <Button disabled={draftState.dirty} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Flex>

      {/* 刷新失败但手上还有上一次的配置: 明说是旧值, 别让人拿过期线路做判断 */}
      {error && <AdminStaleError error={error} onRetry={() => void load()} />}

      {!canWrite && (
        <Alert
          type="info"
          showIcon
          title="你当前的角色只能查看配置与线路健康；连通性测试可用，修改配置与线路需要管理员权限。"
        />
      )}

      {tab === 'channels' && (settingsDirty || routeDirty) && (
        <Alert
          type="warning"
          showIcon
          title="全局设置 / 逐能力路由还有未保存修改"
          description="线路的新增、删除或排序会重新加载配置，可能丢弃这些修改；请先保存或放弃。"
        />
      )}

      <Tabs activeKey={tab} onChange={switchTab} items={tabItems} />

      {draftState.dirty && (
        <Card
          size="small"
          style={{
            position: 'sticky',
            bottom: 16,
            zIndex: 10,
            boxShadow: '0 -2px 12px rgba(23, 26, 43, 0.08)',
          }}
          styles={{ body: { padding: '10px 16px' } }}
        >
          <Flex justify="space-between" align="center" gap={12} wrap>
            <Typography.Text type="secondary">
              有 {draftState.changed.length + draftState.clearKeys.length} 项未保存修改
            </Typography.Text>
            <Space>
              <Button
                disabled={saving}
                onClick={() => {
                  draftState.reset();
                }}
              >
                放弃变更
              </Button>
              <Button type="primary" disabled={saving || !canWrite} onClick={() => setConfirmOpen(true)}>
                保存变更
              </Button>
            </Space>
          </Flex>
        </Card>
      )}

      <AntConfirm
        open={confirmOpen}
        title="确认保存模型配置"
        description="保存后立即生效，无需重启。错误的地址会让生成静默回落到本地算法，或直接失败。"
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
      </Flex>
    </ConfigProvider>
  );
}
