import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import {
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
} from '../../../admin-ui/primitives';
import { useAdmin } from '../../../context/AdminContext';
import { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import type { CheckinRule, InviteRule } from '../../../types/api';
import { marketingApi } from './api';

/**
 * AdminMarketingRulesPage 的 hook 入口 —— 目录内文件的唯一外部 hook 来源。
 *
 * 约定: 本目录的文件不从 `src/admin-ui/providers` / `src/context` / `src/hooks`
 * 直接取 hook, 一律经由本文件 —— 页面用到的外部 hook 集中可见, 换实现或加埋点
 * 只改一处。新增外部 hook 引用时在这里补一行 re-export。
 *
 * 本文件自己的 `useRuleDrafts` 只服务本页, 与外部 hook 一起从这里出去。
 */
export {
  useAdmin,
  useAdminList,
  useAdminResource,
  useAdminUrlFilterSync,
  useToast,
  useUnsavedGuard,
};

/**
 * 两块规则表单的草稿状态（页面持有，表单组件只负责渲染）。
 *
 * 状态必须在页面而不是表单组件里：本页是标签式的，切到「邀请关系」时表单组件
 * 会卸载，草稿留在组件内就等于**静默丢掉未保存的修改**。
 */
export interface RuleDrafts {
  invite: InviteRule | null;
  checkin: CheckinRule | null;
  /** 服务端最后一次成功保存的快照，用于判断未保存修改与「放弃变更」 */
  inviteBase: InviteRule | null;
  checkinBase: CheckinRule | null;
  setInvite: (next: InviteRule | null) => void;
  setCheckin: (next: CheckinRule | null) => void;
  inviteDirty: boolean;
  checkinDirty: boolean;
  /** 任一板块有未保存修改，页面用它挂离开拦截 */
  dirty: boolean;
  /** 两块规则共用一个 busy：同一时刻只有一个保存在飞 */
  busy: boolean;
  /** 规则接口成功返回过至少一次。首屏塌骨架，之后只报 stale */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
  saveInvite: () => void;
  saveCheckin: () => void;
}

export function useRuleDrafts(): RuleDrafts {
  const toast = useToast();

  const [invite, setInvite] = useState<InviteRule | null>(null);
  const [checkin, setCheckin] = useState<CheckinRule | null>(null);
  const [inviteBase, setInviteBase] = useState<InviteRule | null>(null);
  const [checkinBase, setCheckinBase] = useState<CheckinRule | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * 两条规则是同一次加载: 表单里常在两块之间来回对照(邀请奖励 vs 签到奖励),
   * 分开加载会让其中一块停留在旧值上, 而用户以为看到的是同一时刻的配置。
   */
  const { data, loading, error, reload } = useAdminResource(
    () => Promise.all([marketingApi.inviteRule(), marketingApi.checkinRule()]),
    [],
  );

  /*
   * 草稿依赖 data 而不是 invite/checkin: 后者是本页可编辑的副本,
   * 把同步逻辑挂在自己的 state 上会边打字边被覆盖。
   */
  useEffect(() => {
    if (!data) return;
    setInvite(data[0]);
    setCheckin(data[1]);
    setInviteBase(data[0]);
    setCheckinBase(data[1]);
  }, [data]);

  const inviteDirty = Boolean(
    invite && inviteBase && JSON.stringify(invite) !== JSON.stringify(inviteBase),
  );
  const checkinDirty = Boolean(
    checkin && checkinBase && JSON.stringify(checkin) !== JSON.stringify(checkinBase),
  );

  const saveInvite = useCallback(() => {
    void (async () => {
      if (!invite) return;
      setBusy(true);
      try {
        const saved = await marketingApi.updateInviteRule(invite);
        setInvite(saved);
        setInviteBase(saved);
        toast.success('邀请规则已保存，立即生效');
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [invite, toast]);

  const saveCheckin = useCallback(() => {
    void (async () => {
      if (!checkin) return;
      setBusy(true);
      try {
        const saved = await marketingApi.updateCheckinRule(checkin);
        setCheckin(saved);
        setCheckinBase(saved);
        toast.success('签到规则已保存，立即生效');
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [checkin, toast]);

  return {
    invite,
    checkin,
    inviteBase,
    checkinBase,
    setInvite,
    setCheckin,
    inviteDirty,
    checkinDirty,
    dirty: inviteDirty || checkinDirty,
    busy,
    loaded: Boolean(data),
    loading,
    error,
    reload: () => void reload(),
    saveInvite,
    saveCheckin,
  };
}
