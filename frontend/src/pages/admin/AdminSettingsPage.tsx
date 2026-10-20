import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { adminSettingsApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  ConfirmAction,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader } from '../../components/admin/PageHeader';
import type { AdminSettingField, AdminSettings } from '../../types/api';

type SettingItem = AdminSettings['groups'][number]['items'][number];

export function AdminSettingsPage() {
  const { message } = App.useApp();
  const { can } = useAdmin();
  const editable = can('setting.write');

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 草稿: key -> value。仅存被改动过的项, 避免每次输入都发请求
  const [draft, setDraft] = useState<Partial<Record<AdminSettingField, string | number | boolean>>>({});
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminSettingsApi.read();
      setSettings(data);
      setActiveGroup((prev) => prev || data.groups[0]?.key || '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const group = useMemo(
    () => settings?.groups.find((g) => g.key === activeGroup),
    [settings, activeGroup],
  );

  const changed = Object.keys(draft) as AdminSettingField[];

  const setValue = (key: AdminSettingField, value: string | number | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** 恢复某项为已保存的值 */
  const revert = (key: AdminSettingField) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminSettingsApi.update({ ...draft, reason: '后台修改系统设置' });
      setDraft({});
      await load();
      setConfirming(false);
      void message.success(`已保存 ${res.updated.length} 项配置`);
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 变更说明: 逐项对比已保存值与草稿值 */
  const changeSummary = useMemo(() => {
    if (!settings) return [];
    const all = settings.groups.flatMap((g) => g.items);
    return changed.map((key) => {
      const item = all.find((i) => i.key === key);
      return {
        label: item?.label ?? key,
        from: item ? String(item.value) : '—',
        to: String(draft[key]),
      };
    });
  }, [settings, draft, changed]);

  if (loading) return <AdminListLoading tip="加载系统设置…" />;
  if (error) return <AdminListError error={error} onRetry={() => void load()} />;
  if (!settings) return <AdminEmpty description="暂无配置项" />;

  const renderControl = (item: SettingItem) => {
    const value = keyIn(item.key) in draft ? draft[keyIn(item.key)] : item.value;

    if (item.type === 'boolean') {
      return (
        <label className="adm-switch">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => setValue(item.key, e.target.checked)}
            disabled={!editable}
          />
          <span className="adm-switch-track" aria-hidden="true" />
          <span className="adm-switch-text">{Boolean(value) ? '已开启' : '已关闭'}</span>
        </label>
      );
    }

    if (item.type === 'number') {
      return (
        <input
          type="number"
          className="adm-input adm-input-number"
          value={Number(value)}
          min={item.min}
          max={item.max}
          onChange={(e) => setValue(item.key, Number(e.target.value))}
          disabled={!editable}
        />
      );
    }

    return (
      <input
        type="text"
        className="adm-input"
        value={String(value)}
        onChange={(e) => setValue(item.key, e.target.value)}
        disabled={!editable}
      />
    );
  };

  return (
    <>
      <PageHeader
        title="系统设置"
        description={
          editable
            ? '修改后点右下角「保存变更」提交；配置立即生效'
            : '当前账号无 setting.write 权限，仅可查看'
        }
      />

      <div className="adm-tabs">
        {settings.groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`adm-tab${activeGroup === g.key ? ' is-active' : ''}`}
            onClick={() => setActiveGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="adm-panel is-narrow">
        {group?.items.map((item) => {
          const dirty = item.key in draft;
          return (
            <div key={item.key} className={`adm-setting-row${dirty ? ' is-dirty' : ''}`}>
              <div className="adm-setting-label">
                <div className="adm-setting-name">
                  {item.label}
                  {item.overridden && (
                    <span className="adm-setting-tag" title="已覆盖代码默认值">
                      已自定义
                    </span>
                  )}
                </div>
                <div className="adm-setting-desc">{item.description}</div>
                {item.type === 'number' && (item.min !== undefined || item.max !== undefined) && (
                  <div className="adm-setting-range">
                    取值范围 {item.min ?? '—'} ~ {item.max ?? '—'}（默认 {item.default}）
                  </div>
                )}
              </div>

              <div className="adm-setting-control">
                {renderControl(item)}
                {dirty && (
                  <button
                    type="button"
                    className="adm-link"
                    onClick={() => revert(item.key)}
                    disabled={!editable}
                  >
                    撤销
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/*
       * 交易域未上线时, 后台只有 9 项配置, 页面下半会大片留白。
       * 与其在下方补装饰, 不如明确告知「还有哪些即将到来」——
       * 留白本身不可解释, 「未开放的模块」是可解释的。
       */}
      <div className="adm-panel is-narrow adm-planned">
        <div className="adm-planned-title">尚未开放</div>
        <ul className="adm-planned-list">
          <li>
            <strong>法务文本</strong>
            <span>用户协议 / 隐私政策的版本管理</span>
          </li>
          <li>
            <strong>投诉举报入口</strong>
            <span>需与内容安全服务一并接入</span>
          </li>
        </ul>
      </div>

      {editable && (
        <div className="adm-action-bar">
          <span className="adm-action-hint">
            {changed.length === 0 ? '无未保存的变更' : `有 ${changed.length} 项未保存的变更`}
          </span>
          <div className="adm-action-buttons">
            <button
              type="button"
              className="adm-btn"
              disabled={changed.length === 0 || busy}
              onClick={() => setDraft({})}
            >
              放弃变更
            </button>
            <button
              type="button"
              className="adm-btn is-primary"
              disabled={changed.length === 0 || busy}
              onClick={() => setConfirming(true)}
            >
              保存变更
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmAction
          open
          title="保存系统设置"
          confirmText="确认保存"
          loading={busy}
          description={<p>以下配置变更将立即生效，影响所有用户。</p>}
          impact={changeSummary.map((c) => `${c.label}：${c.from} → ${c.to}`)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </>
  );
}

/** 后端 key 已是扁平字段名 (siteName 等), 直接作AdminSettingField 用 */
function keyIn(key: AdminSettingField): AdminSettingField {
  return key;
}