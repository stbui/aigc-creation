import { useEffect, useMemo, useState } from 'react';
import { App, Button, Checkbox } from 'antd';
import { adminApi, adminRolesApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel } from '../../components/admin/PageHeader';

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
  'finance.reconcile': '渠道对账',
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
  'model.config_read': '查看模型配置',
  'model.config_write': '修改模型配置',
  'model.call_read': '查看调用记录',
  'marketing.write': '管理营销活动',
  'message.write': '发送站内信与公告',
  'legal.read': '查看法务文档',
  'legal.write': '编辑/发布法务文档',
  'ticket.read': '查看工单',
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
  model: '模型',
  legal: '法务',
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
  const { can, me, refresh } = useAdmin();
  const editable = can('role.write');

  const [busy, setBusy] = useState(false);

  // 草稿为 roleCode -> Set<permission>; 直接改库会导致每次勾选都发一次请求
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});

  /*
   * 角色清单与权限点清单必然一起用 (勾选框由后者铺开), 分两次拉会出现
   * 「角色有了但权限点还没到」的空树。一个 fetcher 拉齐。
   */
  const { data, loading, error, reload } = useAdminResource(async () => {
    const [roleRes, permRes] = await Promise.all([adminRolesApi.list(), adminApi.permissions()]);
    return { roles: roleRes.items, allPermissions: permRes.permissions };
  });
  const roles = data?.roles ?? [];
  const allPermissions = data?.allPermissions ?? [];

  /*
   * 草稿按服务端的权限重置: 拉到新数据即重建「已保存态」。
   * 依赖写 `data` 而不是 `roles`(每次渲染都是新数组), 否则每渲染都 setDraft 一次。
   */
  useEffect(() => {
    if (!data) return;
    const next: Record<string, Set<string>> = {};
    for (const r of data.roles) next[r.code] = new Set(r.permissions);
    setDraft(next);
  }, [data]);

  /*
   * 权限点按模块分组, 树状比平铺 54 行可读。
   * 依赖写 `data?.allPermissions` 而不是上面的 `allPermissions` —— 后者是
   * `?? []` 兜出来的新数组, 每渲染都变, 会让这个 useMemo 白算一遍。
   */
  const modules: PermModule[] = useMemo(() => {
    const map = new Map<string, PermModule>();
    for (const code of data?.allPermissions ?? []) {
      const m = code.split('.')[0];
      const entry = map.get(m) ?? { module: m, label: MODULE_LABELS[m] ?? m, codes: [] };
      entry.codes.push(code);
      map.set(m, entry);
    }
    return Array.from(map.values());
  }, [data?.allPermissions]);

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
      await reload();
      /*
       * 2026-10-23 修: 原写法是 `if (me?.role === code) await load();` 再调一次
       * load —— 注释写的是「刷新本地权限清单」, 但 load 只重拉本页的角色列表,
       * **根本没有更新 AdminContext 里那份生效权限**, 于是自己的角色被降权后,
       * 侧栏与按钮权限要等整页刷新才变。这里改调 context 的 refresh()。
       */
      if (me?.role === code) refresh();
      void message.success('权限已保存，立即生效');
    } catch (e) {
      void message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <AdminListLoading tip="加载角色权限…" />;
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;
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
                  <Button
                    key={r.code}
                    type="primary"
                    className="adm-btn is-primary"
                    disabled={!changed || busy}
                    onClick={() => void save(r.code, current)}
                  >
                    保存{r.label}权限
                    {changed ? ' *' : ''}
                  </Button>
                );
              })
            : undefined
        }
      />

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && <AdminStaleError error={error} onRetry={reload} />}

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
                    <Button
                      key={r.code}
                      type="text"
                      className={`adm-perm-all-btn${all ? ' is-on' : ''}${none ? ' is-off' : ''}`}
                      onClick={() => toggleModule(r.code, mod.codes)}
                      disabled={!editable}
                      title={`${r.label}：全选/全不选`}
                    >
                      {r.label}
                    </Button>
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
                      <Checkbox
                        key={r.code}
                        checked={(draft[r.code] ?? new Set()).has(code)}
                        onChange={() => toggle(r.code, code)}
                        disabled={!editable}
                      >
                        {r.label}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Panel>

    </>
  );
}
