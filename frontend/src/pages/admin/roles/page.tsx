import { useEffect, useMemo, useState } from 'react';
import { PERMISSION_LABELS, MODULE_LABELS, ROLE_COL } from './constants';
import { useAdmin, useToast, useUnsavedGuard, useAdminResource } from './hooks';
import { adminApi, adminRolesApi } from '../../../lib/api';

import { AdminPage, ActionButton, CheckboxField, EmptyState, ListError, PageSkeleton, Panel, StaleError, ToneBadge } from '~/admin-ui/primitives';
import { cn } from '../../../admin-ui/lib/cn';

/** 权限点 → 中文说明。未登记的权限点原样显示 id, 不静默消失 */

/** 高危权限点: 视觉上标记出来, 提醒运营收窄时要慎重 */

/** 角色列宽：模块头的全选按钮与每行的勾选框必须共用同一列宽才能上下对齐 */

interface PermModule {
  module: string;
  label: string;
  codes: string[];
}

export function AdminRolesPage() {
  const toast = useToast();
  const { can, me, refresh, isHighRisk } = useAdmin();
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

  /**
   * 每个角色相对服务端的差异。
   *
   * 同时用于两处：顶部概览的计数，以及保存条只为「真的改过的角色」
   * 出按钮。把差异算在渲染路径上会让三个角色每次勾选都各扫一遍全部权限，
   * 尤其是这个页面有 50+ 权限点，统一放 useMemo 更稳。
   */
  const roleChanges = useMemo(
    () =>
      roles.map((role) => {
        const current = draft[role.code] ?? new Set<string>();
        const original = new Set(role.permissions);
        const added = Array.from(current).filter((code) => !original.has(code));
        const removed = Array.from(original).filter((code) => !current.has(code));
        return {
          code: role.code,
          label: role.label,
          current,
          changedCount: added.length + removed.length,
        };
      }),
    [draft, roles],
  );
  const dirtyRoles = roleChanges.filter((role) => role.changedCount > 0);

  useUnsavedGuard(editable && dirtyRoles.length > 0);

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

  /** 放弃所有未保存的勾选，回到服务端最后一次成功拉到的状态 */
  const resetDraft = () => {
    if (!data) return;
    const next: Record<string, Set<string>> = {};
    for (const role of data.roles) next[role.code] = new Set(role.permissions);
    setDraft(next);
  };

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

  /**
   * 一次保存所有改动角色。
   *
   * 不提供单角色保存：`reload()` 会用服务端结果重建全部草稿，如果只保存
   * 其中一个角色，其余角色的未保存勾选会被这次刷新一并抹掉。统一保存后
   * 再刷新，才不会出现「保存了运营，管理员的改动却消失了」。
   */
  const saveAll = async () => {
    const rolesToSave = dirtyRoles;
    if (rolesToSave.length === 0) return;
    setBusy(true);
    try {
      await adminRolesApi.updatePermissions(
        rolesToSave.map((role) => ({
          code: role.code,
          permissions: Array.from(role.current),
        })),
      );
      await reload();
      /*
       * 2026-10-23 修: 原写法是 `if (me?.role === code) await load();` 再调一次
       * load —— 注释写的是「刷新本地权限清单」, 但 load 只重拉本页的角色列表,
       * **根本没有更新 AdminContext 里那份生效权限**, 于是自己的角色被降权后,
       * 侧栏与按钮权限要等整页刷新才变。这里改调 context 的 refresh()。
       */
      if (rolesToSave.some((role) => role.code === me?.role)) await refresh();
      toast.success('权限已保存，立即生效');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * 页头照常渲染：加载期间标题与说明就该在位。
   * 之前的守卫整页替换，首屏先闪一段没有标题的灰条，再冒出完整页面 ——
   * 骨架该占住位置，不是把版面清空。
   */
  if (loading && !data) {
    return (
      <PageSkeleton
        title="角色权限"
        description={
          editable
            ? '勾选变更后使用保存条提交；保存立即生效，无需重启或重新登录'
            : '当前账号无 role.write 权限，仅可查看'
        }
        panels={1}
        panelRows={6}
      />
    );
  }
  if (error && !data) return <ListError error={error} onRetry={() => void reload()} />;
  if (roles.length === 0) return <EmptyState title="未配置任何后台角色" />;

  return (
    <AdminPage
      title="角色权限"
      description={
        editable
          ? '勾选变更后使用保存条提交；保存立即生效，无需重启或重新登录'
          : '当前账号无 role.write 权限，仅可查看'
      }
    >

      {/* 刷新失败但手上还有上一次的数据: 只挂提示, 不把整个列表藏起来 */}
      {error && <StaleError error={error} onRetry={reload} />}

      {editable && dirtyRoles.length > 0 && (
        <div
          role="status"
          data-testid="admin-role-save-bar"
          className="mb-3 flex flex-col gap-3 rounded-xl border border-warn-border bg-warn-soft px-3.5 py-2.5"
        >
          <div className="flex w-full items-center gap-3">
            <span className="min-w-0 flex-1 text-xs text-warn-text">
              有 {dirtyRoles.length} 个角色未保存：
              {dirtyRoles.map((role) => `${role.label} ${role.changedCount} 项`).join('、')}
            </span>
            <ActionButton variant="secondary" size="sm" disabled={busy} onClick={resetDraft}>
              放弃变更
            </ActionButton>
            <ActionButton
              variant="default"
              size="sm"
              disabled={busy}
              onClick={() => void saveAll()}
            >
              {busy ? '保存中…' : '保存全部变更'}
            </ActionButton>
          </div>
        </div>
      )}

      <Panel
        title="权限矩阵"
        note={`共 ${allPermissions.length} 个权限点，内置角色不可删除，仅可调整权限`}
      >
        {/* 图例：每个角色当前勾了多少，与右侧模块表同一份草稿 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border pb-3">
          {roles.map((r) => (
            <span key={r.code} className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
              {r.label}
              <em className="font-medium not-italic tabular-nums text-foreground">
                {(draft[r.code] ?? new Set()).size} / {allPermissions.length}
              </em>
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          {modules.map((mod) => (
            <section key={mod.module}>
              {/* 模块头：每个角色一个「全选 / 全不选」的快捷切换 */}
              <div className="flex items-center gap-3 border-b border-border pb-1.5">
                <strong className="min-w-0 flex-1 text-xs font-semibold text-foreground">
                  {mod.label}
                </strong>
                <div className="flex shrink-0">
                  {roles.map((r) => {
                    const set = draft[r.code] ?? new Set<string>();
                    const all = mod.codes.every((c) => set.has(c));
                    const none = mod.codes.every((c) => !set.has(c));
                    return (
                      <div key={r.code} className={cn(ROLE_COL, 'shrink-0')}>
                        {/*
                         * `ActionButton` 不透传 `aria-pressed`；这一枚需要把
                         * 「当前模块已全选」暴露给读屏，用原生按钮保留该状态。
                         */}
                        <button
                          type="button"
                          disabled={!editable}
                          aria-pressed={all}
                          onClick={() => toggleModule(r.code, mod.codes)}
                          className={cn(
                            'inline-flex h-6 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors',
                            'outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                            all && 'text-brand',
                            none && 'text-muted-foreground/60',
                          )}
                        >
                          {all ? '全不选' : '全选'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {mod.codes.map((code) => (
                <div
                  key={code}
                  className={cn(
                    'flex items-center gap-3 border-b border-border/60 py-1.5 last:border-b-0',
                    isHighRisk(code) && 'bg-danger-soft/30',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-xs text-foreground">
                      {PERMISSION_LABELS[code] ?? code}
                    </span>
                    {isHighRisk(code) && (
                      <ToneBadge tone="warn">
                        高危
                      </ToneBadge>
                    )}
                    <code className="truncate font-mono text-[12px] text-muted-foreground/60">{code}</code>
                  </div>
                  <div className="flex shrink-0">
                    {roles.map((r) => (
                      <div key={r.code} className={cn(ROLE_COL, 'shrink-0')}>
                        <CheckboxField
                          size="sm"
                          checked={(draft[r.code] ?? new Set()).has(code)}
                          disabled={!editable}
                          ariaLabel={`${r.label} · ${PERMISSION_LABELS[code] ?? code}`}
                          onChange={() => toggle(r.code, code)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </Panel>
    </AdminPage>
  );
}
