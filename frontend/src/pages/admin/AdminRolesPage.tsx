import { useCallback, useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { adminApi, adminRolesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  ConfirmAction,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';
import type { AdminRoleItem } from '../../types/api';

/** 权限点 → 中文说明。未登记的权限点原样显示 id, 不静默消失 */
const PERMISSION_LABELS: Record<string, string> = {
  'platform.dashboard': '查看平台概览',
  'user.read': '查看用户',
  'user.write': '变更用户角色',
  'user.disable': '禁用/启用账号',
  'user.delete': '删除用户',
  'user.reset_password': '重置用户密码',
  'project.read': '查看项目',
  'project.delete': '删除项目',
  'asset.read': '查看素材',
  'asset.hide': '下架/恢复素材',
  'asset.delete': '删除素材',
  'task.read': '查看任务',
  'task.retry': '重试失败任务',
  'task.cancel': '终止运行中任务',
  'product.read': '查看商品',
  'product.write': '编辑商品',
  'product.price': '调整消耗价',
  'product.publish': '商品上下架',
  'order.read': '查看订单',
  'order.mark_paid': '订单手工核销',
  'order.refund': '订单退款',
  'payment.read': '查看支付流水',
  'finance.dashboard': '查看财务概览',
  'invoice.write': '开具发票',
  'credit.read': '查看积分',
  'credit.adjust': '人工增减积分',
  'compliance.read': '查看合规记录',
  'compliance.gate': '能力开放管控',
  'compliance.takedown': '内容下架处置',
  'content.read': '查看内容审核',
  'capability.read': '查看能力配置',
  'capability.write': '调整能力配置',
  'channel.route': '配置通道路由',
  'channel.test': '通道连通性测试',
  'marketing.write': '管理营销活动',
  'message.write': '发送站内信与公告',
  'ticket.handle': '处理工单',
  'setting.read': '查看系统设置',
  'setting.write': '修改系统设置',
  'role.write': '调整角色权限',
  'audit.read': '查看操作审计',
  'data.export': '导出数据',
  'data.import': '导入数据',
  'data.batch': '批量操作',
  'data.search': '全局搜索',
  'backup.read': '查看备份',
  'backup.run': '执行备份',
};

const MODULE_LABELS: Record<string, string> = {
  platform: '平台',
  user: '用户',
  project: '项目',
  asset: '素材',
  task: '任务',
  product: '商品',
  order: '订单',
  payment: '支付',
  finance: '财务',
  invoice: '发票',
  credit: '积分',
  compliance: '合规',
  content: '内容',
  capability: '能力',
  channel: '通道',
  marketing: '营销',
  message: '消息',
  ticket: '工单',
  setting: '设置',
  role: '角色',
  audit: '审计',
  data: '数据',
  backup: '备份',
};

/** 高危权限点: 视觉上标记出来, 提醒运营收窄时要慎重 */
const HIGH_RISK = new Set([
  'user.delete',
  'user.reset_password',
  'asset.delete',
  'project.delete',
  'order.refund',
  'credit.adjust',
  'compliance.takedown',
  'capability.write',
  'setting.write',
  'role.write',
  'backup.run',
]);

interface PermModule {
  module: string;
  label: string;
  codes: string[];
}

export function AdminRolesPage() {
  const { message } = App.useApp();
  const { can, me } = useAdmin();
  const editable = can('role.write');

  const [roles, setRoles] = useState<AdminRoleItem[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 草稿为 roleCode -> Set<permission>; 直接改库会导致每次勾选都发一次请求
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [pending, setPending] = useState<{
    code: string;
    label: string;
    before: Set<string>;
    after: Set<string>;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roleRes, permRes] = await Promise.all([adminRolesApi.list(), adminApi.permissions()]);
      setRoles(roleRes.items);
      setAllPermissions(permRes.permissions);
      const next: Record<string, Set<string>> = {};
      for (const r of roleRes.items) next[r.code] = new Set(r.permissions);
      setDraft(next);
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

  /** 权限点按模块分组, 树状比平铺 47 行可读 */
  const modules: PermModule[] = useMemo(() => {
    const map = new Map<string, PermModule>();
    for (const code of allPermissions) {
      const m = code.split('.')[0];
      const entry = map.get(m) ?? { module: m, label: MODULE_LABELS[m] ?? m, codes: [] };
      entry.codes.push(code);
      map.set(m, entry);
    }
    return Array.from(map.values());
  }, [allPermissions]);

  const toggle = (roleCode: string, permission: string) => {
    if (!editable) return;
    setDraft((d) => {
      const next = new Set(d[roleCode] ?? []);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...d, [roleCode]: next };
    });
  };

  const toggleModule = (roleCode: string, codes: string[]) => {
    if (!editable) return;
    setDraft((d) => {
      const next = new Set(d[roleCode] ?? []);
      const allOn = codes.every((c) => next.has(c));
      for (const c of codes) {
        if (allOn) next.delete(c);
        else next.add(c);
      }
      return { ...d, [roleCode]: next };
    });
  };

  const save = async (code: string, after: Set<string>) => {
    setBusy(true);
    try {
      await adminRolesApi.updatePermissions(code, Array.from(after), '后台角色权限调整');
      await load();
      // 若改的是自己的角色, 刷新本地权限清单
      if (me?.role === code) await load();
      void message.success('权限已保存，立即生效');
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <AdminListLoading tip="加载角色权限…" />;
  if (error) return <AdminListError error={error} onRetry={() => void load()} />;
  if (roles.length === 0) return <AdminEmpty description="未配置任何后台角色" />;

  return (
    <>
      <PageHeader
        title="角色权限"
        description={
          editable
            ? '勾选变更后点右上角「保存」提交；保存立即生效，无需重启或重新登录'
            : '当前账号无 role.write 权限，仅可查看'
        }
        actions={
          editable
            ? roles.map((r) => {
                const current = draft[r.code] ?? new Set<string>();
                const original = new Set(r.permissions);
                const changed =
                  current.size !== original.size ||
                  Array.from(current).some((p) => !original.has(p));
                return (
                  <button
                    key={r.code}
                    type="button"
                    className="adm-btn is-primary"
                    disabled={!changed || busy}
                    onClick={() =>
                      setPending({
                        code: r.code,
                        label: r.label,
                        before: original,
                        after: new Set(current),
                      })
                    }
                  >
                    保存{r.label}权限
                    {changed ? ' *' : ''}
                  </button>
                );
              })
            : undefined
        }
      />

      <Panel isNarrow note={`共 ${allPermissions.length} 个权限点，内置角色不可删除，仅可调整权限`}>
        <div className="adm-legend">
          {roles.map((r) => (
            <span key={r.code} className="adm-legend-item">
              {r.label}
              <em>{(draft[r.code] ?? new Set()).size} / {allPermissions.length}</em>
            </span>
          ))}
        </div>

        {modules.map((mod) => (
          <div key={mod.module} className="adm-perm-module">
            <div className="adm-perm-module-head">
              <strong>{mod.label}</strong>
              <div className="adm-perm-module-actions">
                {roles.map((r) => {
                  const set = draft[r.code] ?? new Set<string>();
                  const all = mod.codes.every((c) => set.has(c));
                  const none = mod.codes.every((c) => !set.has(c));
                  return (
                    <button
                      key={r.code}
                      type="button"
                      className={`adm-perm-all-btn${all ? ' is-on' : ''}${none ? ' is-off' : ''}`}
                      onClick={() => toggleModule(r.code, mod.codes)}
                      disabled={!editable}
                      title={`${r.label}：全选/全不选`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="adm-perm-list">
              {mod.codes.map((code) => (
                <div
                  key={code}
                  className={`adm-perm-row${HIGH_RISK.has(code) ? ' is-high-risk' : ''}`}
                >
                  <div className="adm-perm-name">
                    {PERMISSION_LABELS[code] ?? code}
                    {HIGH_RISK.has(code) && <span className="adm-perm-risk">高危</span>}
                    <code className="adm-perm-code">{code}</code>
                  </div>
                  <div className="adm-perm-roles">
                    {roles.map((r) => (
                      <label key={r.code} className="adm-checkbox">
                        <input
                          type="checkbox"
                          checked={(draft[r.code] ?? new Set()).has(code)}
                          onChange={() => toggle(r.code, code)}
                          disabled={!editable}
                        />
                        <span>{r.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Panel>

      {pending && (
        <ConfirmAction
          open
          title={`保存「${pending.label}」的权限变更`}
          confirmText="确认保存"
          loading={busy}
          description={<p>以下变更将在保存后立即对该角色的所有用户生效。</p>}
          impact={(() => {
            const added = Array.from(pending.after).filter((p) => !pending.before.has(p));
            const removed = Array.from(pending.before).filter((p) => !pending.after.has(p));
            const lines: string[] = [];
            if (added.length) lines.push(`新增 ${added.length} 项：${added.join('、')}`);
            if (removed.length) lines.push(`移除 ${removed.length} 项：${removed.join('、')}`);
            return lines;
          })()}
          extra={
            pending.code === me?.role ? (
              <div className="adm-confirm-warn">
                你正在修改自己所属角色的权限，保存后会立即生效，可能导致部分入口消失。
              </div>
            ) : undefined
          }
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { code, after } = pending;
            setPending(null);
            void save(code, after);
          }}
        />
      )}
    </>
  );
}