import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AdminDrawer,
  DetailSection,
  EmptyState,
  ListError,
  SkeletonBody,
  StatusTag,
} from '~/admin-ui/primitives';
import { adminUsersApi, assetThumbUrl } from './api';
import { LOGIN_REASON_LABEL } from './constants';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  formatDateTime,
} from './utils';
import type { AdminLoginLogResult, AdminUserDetail } from '../../../types/api';

/** 描述列表的一项 */
function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}

/** 抽屉里的小计数格。不用 StatCard：那套是列表页首屏用的，96px 高度在抽屉里太占。 */
function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg leading-6 font-semibold text-foreground tabular-nums">
        {value}
      </div>
      {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * 详情抽屉里的「最近登录」区块。
 *
 * 单独取数（GET /admin/users/:id/logins，权限 audit.read）而不是并进 detail：
 * 只有运营 / 管理员持有 audit.read，塞进详情会让其他角色顺带看到全站登录 IP。
 * 403 时按「不可见」渲染说明 —— 这是权限边界，不是错误。
 */
function RecentLoginsSection({ userId }: { userId: string }) {
  const [data, setData] = useState<AdminLoginLogResult | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setState('loading');
    adminUsersApi
      .logins(userId, 20)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 403 = 没有 audit.read；其余错误如实标为加载失败，不伪装成空列表
        const status = (e as { status?: number }).status;
        setState(status === 403 ? 'forbidden' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [userId, reloadKey]);

  return (
    <DetailSection
      title="最近登录"
      note={
        state === 'ready' && data
          ? `共 ${data.total} 次 · 近 30 天失败 ${data.failedLast30Days} 次`
          : undefined
      }
    >
      {state === 'loading' ? <SkeletonBody rows={3} /> : null}
      {state === 'forbidden' ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          当前角色没有审计权限（audit.read），无法查看登录记录。
        </p>
      ) : null}
      {state === 'error' ? (
        <ListError error="登录记录加载失败" onRetry={() => setReloadKey((n) => n + 1)} />
      ) : null}
      {state === 'ready' && data ? (
        data.items.length === 0 ? (
          <EmptyState
            title="暂无登录记录"
            description="该用户尚未登录，或登录记录已过保留期。"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 py-1.5">
                <StatusTag
                  status={item.success ? 'success' : 'failed'}
                  label={item.success ? '成功' : '失败'}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {LOGIN_REASON_LABEL[item.reason] ?? item.reason}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                  {item.ip || '未知 IP'}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                  {formatDateTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </DetailSection>
  );
}

/**
 * 用户详情抽屉。
 *
 * 从页面拆出：详情的数据获取与列表筛选是两套生命周期；账号状态、角色、
 * 删除等写操作仍由页面统一承载，避免详情与行内菜单出现两个入口。
 */
export function UserDetailDrawer({
  detailId,
  onClose,
}: {
  detailId: string | null;
  onClose: () => void;
}) {
  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('用户不存在');
    return adminUsersApi.detail(detailId);
  }, [detailId]);

  return (
    <AdminDrawer<AdminUserDetail>
      open={detailId !== null}
      title="用户详情"
      onClose={onClose}
      fetcher={detailFetcher}
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          <DetailSection title="基本信息">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <div className="col-span-2 min-w-0">
                <dt className="text-[12px] text-muted-foreground">邮箱</dt>
                <dd className="mt-0.5 text-sm break-all text-foreground">{d.email}</dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-[12px] text-muted-foreground">关联记录</dt>
                <dd className="mt-0.5 flex flex-wrap gap-3 text-xs">
                  <Link className="text-brand hover:underline" to={adminTasksHref({ userId: d.id })}>
                    任务记录
                  </Link>
                  <Link className="text-brand hover:underline" to={adminOrderHref({ email: d.email })}>
                    订单记录
                  </Link>
                  <Link
                    className="text-brand hover:underline"
                    to={adminCreditHref({ userId: d.id, email: d.email })}
                  >
                    积分账本
                  </Link>
                </dd>
              </div>
              <InfoItem label="昵称" value={d.name} />
              <InfoItem label="角色" value={<StatusTag status={d.role} />} />
              <InfoItem label="状态" value={<StatusTag status={d.status} />} />
              <InfoItem
                label="手机号"
                value={
                  d.phone ? (
                    <span className="flex items-center gap-1.5">
                      {d.phone}
                      <span className="text-[12px] text-muted-foreground">
                        {d.phoneVerifiedAt ? '已验证' : '未验证'}
                      </span>
                    </span>
                  ) : (
                    '未绑定'
                  )
                }
              />
              <InfoItem label="注册时间" value={formatDateTime(d.createdAt)} />
              <InfoItem
                label="最近登录"
                value={d.lastLoginAt ? formatDateTime(d.lastLoginAt) : '从未登录'}
              />
            </dl>
          </DetailSection>

          {/* 登录审计：权限点 audit.read，无权限时静默显示说明而非报错 */}
          <RecentLoginsSection userId={d.id} />

          <DetailSection title="资源统计">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="项目" value={d.stats.projects} />
              <MiniStat
                label="任务"
                value={d.stats.tasks}
                hint={`成功 ${d.stats.taskStatus.succeeded} · 失败 ${d.stats.taskStatus.failed}`}
              />
              <MiniStat label="素材" value={d.stats.assets} />
            </div>
          </DetailSection>

          <DetailSection title="最近任务" note="20 条">
            {d.recentTasks.length === 0 ? (
              <EmptyState
                title="暂无任务记录"
                description="该用户创建生成任务后会显示在这里。"
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {d.recentTasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      className="flex items-center gap-2.5 py-1.5 hover:bg-muted/60"
                      to={adminTaskHref(t.id)}
                      aria-label={`查看任务详情：${t.capabilityName} ${t.id.slice(-8)}`}
                    >
                      {t.thumbnailUrl ? (
                        <img
                          className="size-9 shrink-0 rounded-md border border-border object-cover"
                          src={assetThumbUrl(t.thumbnailUrl, 96)}
                          alt=""
                        />
                      ) : (
                        <div className="size-9 shrink-0 rounded-md border border-dashed border-border bg-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {t.capabilityName}
                      </span>
                      <StatusTag status={t.status} />
                      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        {formatDateTime(t.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection title="最近素材" note="20 张">
            {d.recentAssets.length === 0 ? (
              <EmptyState
                title="暂无素材"
                description="该用户上传或生成的素材会显示在这里。"
              />
            ) : (
              <div className="grid grid-cols-5 gap-1.5">
                {d.recentAssets.map((a) => (
                  <Link
                    key={a.id}
                    className="block overflow-hidden rounded-md border border-border"
                    to={adminAssetHref(a.id)}
                    aria-label={`在素材库查看素材 ${a.id.slice(-8)}`}
                  >
                    <img
                      className="aspect-square w-full object-cover"
                      src={assetThumbUrl(a.sourceUrl, 240)}
                      alt=""
                      loading="lazy"
                    />
                  </Link>
                ))}
              </div>
            )}
          </DetailSection>
        </div>
      )}
    </AdminDrawer>
  );
}
