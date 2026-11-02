import { useEffect, useState } from 'react';
import { ActionButton, ConfirmAction, FormField, SkeletonBody, TextField } from './components';
import { adminUsersApi } from './api';
import { DELETE_CONFIRM_WORD } from './constants';
import type { AdminUserImpact, AdminUserListResult } from '../../../types/api';

type Row = AdminUserListResult['items'][number];

/**
 * 删除用户的二次确认。
 *
 * 原实现点「删除」直接执行，误触即不可恢复。这里补上三步：
 *
 * 1. 先取删除影响（项目 / 任务 / 素材数量）并具名展示；
 * 2. 必须手动输入确认词「删除」，避免回车 / 连点穿透；
 * 3. 说明资金记录不可删 —— 有订单等记录的账号会被后端拒绝，需改用注销。
 *
 * 确认词由后端逐字校验（`DeleteUserDto.confirm`），前端只做同一口径的
 * 输入门槛，真正的安全边界仍在服务端。
 */
export function UserDeleteConfirm({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: Row;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [word, setWord] = useState('');
  const [impact, setImpact] = useState<AdminUserImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setImpact(null);
    setImpactError(null);
    adminUsersApi
      .impact(target.id)
      .then((res) => {
        if (alive) setImpact(res);
      })
      .catch((e: unknown) => {
        if (alive) setImpactError(e instanceof Error ? e.message : '删除影响加载失败');
      });
    return () => {
      alive = false;
    };
  }, [target.id, reloadKey]);

  return (
    <ConfirmAction
      open
      title="删除用户"
      confirmText="确认删除"
      danger
      loading={loading}
      confirmDisabled={word.trim() !== DELETE_CONFIRM_WORD}
      onCancel={onCancel}
      onConfirm={onConfirm}
      description={
        <>
          <p>
            用户：<strong>{target.email}</strong>
          </p>
          <p className="mt-1 text-danger-text">
            删除后该账号的项目、任务、素材与积分批次将被清除，且无法恢复。
          </p>
        </>
      }
      impact={[
        '项目 / 任务 / 素材记录一并删除，对象存储文件同步清理',
        '订单、支付、退款、发票等资金记录依法保留',
        '存在资金记录的账号无法物理删除，接口会拒绝并提示改用注销',
        '写操作审计（含操作人）',
      ]}
      extra={
        <>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-[12px] text-muted-foreground">将删除的数据</div>
            {impactError ? (
              <div className="mt-1 flex items-center gap-2 text-xs text-danger-text">
                <span className="min-w-0 flex-1">{impactError}</span>
                <ActionButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setReloadKey((n) => n + 1)}
                >
                  重试
                </ActionButton>
              </div>
            ) : impact === null ? (
              <div className="mt-1.5">
                <SkeletonBody rows={2} />
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground tabular-nums">
                <span>项目 {impact.projects}</span>
                <span>任务 {impact.tasks}</span>
                <span>素材 {impact.assets}</span>
              </div>
            )}
          </div>
          <FormField label={`输入「${DELETE_CONFIRM_WORD}」以确认`}>
            <TextField
              ariaLabel="删除确认词"
              placeholder={DELETE_CONFIRM_WORD}
              value={word}
              onChange={setWord}
              maxLength={8}
            />
          </FormField>
        </>
      }
    />
  );
}
