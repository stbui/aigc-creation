import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  ActionButton,
  AdminDrawer,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailSection,
  EmptyState,
  ListError,
  MiniStat,
  SkeletonBody,
  StatusTag,
} from '~/admin-ui/primitives';
import { cn } from '~/admin-ui/lib/cn';
import { adminUsersApi, assetThumbUrl } from './api';
import { LOGIN_REASON_LABEL } from './constants';
import { UserGenerationSection } from './UserGenerationSection';
import { UserMembershipSection } from './UserMembershipSection';
import { UserSpendingSection } from './UserSpendingSection';
import {
  adminAssetHref,
  adminCreditHref,
  adminOrderHref,
  adminTaskHref,
  adminTasksHref,
  formatDateTime,
} from './utils';
import type { AdminLoginLogResult, AdminUserDetail } from '../../../types/api';
import type { DeleteUserTarget } from './types';

/**
 * 描述列表的一项：标签在左、内容在右，同一行。
 *
 * 标签固定 80px 让两列里的值对齐；内容用 min-w-0 flex-1 承接长 ID /
 * 长分组名，窄空间内换行而不是把整列撑宽。
 */
function InfoItem({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-baseline gap-3', className)}>
      <dt className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] leading-5 break-words text-foreground">{value}</dd>
    </div>
  );
}

/** 抽屉里的资源计数。统一放在一条统计带里，避免三张独立小卡重复描边。 */
/**
 * 详情抽屉里的「最近登录」区块。
 *
 * 单独取数（GET /admin/users/:id/logins，权限 user.read）而不是并进 detail：
 * 登录 IP / UA 属于安全数据，权限沿用用户读取，避免另设一套权限。
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
        // 403 = 没有 user.read；其余错误如实标为加载失败，不伪装成空列表
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
        <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs leading-5 text-muted-foreground">
          当前角色没有用户读取权限（user.read），无法查看登录记录。
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
            className="border-0 px-4 py-7"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border/70">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5 px-1 py-2">
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
 * 从页面拆出：详情的数据获取与列表筛选是两套生命周期。删除入口由页面按
 * `user.delete` 权限与「不能删自己」下发 `onDelete`，点击后复用页面同一个
 * `UserDeleteConfirm` 与写操作锁 —— 详情里不另起一套确认流程。
 *
 * 「最近登录」只保留独立的登录记录区块：账户信息里那个同名字段只是一次
 * `lastLoginAt` 快照，与区块首条记录重复，去掉后账户信息正好两行。
 */
export function UserDetailDrawer({
  detailId,
  onClose,
  onDelete,
  deleteBusy = false,
}: {
  detailId: string | null;
  onClose: () => void;
  /** 有值才渲染删除入口；页面已完成权限与「不能删自己」的过滤 */
  onDelete?: (target: DeleteUserTarget) => void;
  deleteBusy?: boolean;
}) {
  const detailFetcher = useCallback(async () => {
    if (!detailId) throw new Error('用户不存在');
    return adminUsersApi.detail(detailId);
  }, [detailId]);

  return (
    <AdminDrawer<AdminUserDetail>
      open={detailId !== null}
      title="用户详情"
      description="账号、会员、积分、消费与生成概览"
      onClose={onClose}
      fetcher={detailFetcher}
      footer={(d) =>
        onDelete && d.status !== 'deleted' ? (
          <ActionButton
            variant="destructive"
            size="sm"
            icon={Trash2}
            disabled={deleteBusy}
            onClick={() => onDelete({ id: d.id, email: d.email })}
          >
            删除用户
          </ActionButton>
        ) : undefined
      }
    >
      {(d) => (
        <div className="flex flex-col gap-5">
          <Card className="gap-0 rounded-xl border-border bg-muted/30 py-0 shadow-none">
            <CardHeader className="gap-2 px-4 pt-4 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>
                  <h2 className="text-lg leading-6 font-semibold tracking-tight text-foreground">
                    {d.name}
                  </h2>
                </CardTitle>
                <StatusTag status={d.role} />
                <StatusTag status={d.status} showDot />
              </div>
              <p className="break-all text-[13px] leading-5 text-muted-foreground">{d.email}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 px-4 pb-4">
              <Button variant="outline" size="sm" className="bg-background/80" asChild>
                <Link to={adminTasksHref({ userId: d.id })}>任务记录</Link>
              </Button>
              <Button variant="outline" size="sm" className="bg-background/80" asChild>
                <Link to={adminOrderHref({ email: d.email })}>订单记录</Link>
              </Button>
              <Button variant="outline" size="sm" className="bg-background/80" asChild>
                <Link to={adminCreditHref({ userId: d.id, email: d.email })}>积分账本</Link>
              </Button>
            </CardContent>
          </Card>

          <DetailSection title="账户信息">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoItem label="昵称" value={d.name} />
              <InfoItem
                label="手机号"
                value={
                  d.phone ? (
                    <span className="flex items-center gap-1.5">
                      {d.phone}
                      <span className="text-xs text-muted-foreground">
                        {d.phoneVerifiedAt ? '已验证' : '未验证'}
                      </span>
                    </span>
                  ) : (
                    '未绑定'
                  )
                }
              />
              <InfoItem
                label="用户 ID"
                className="col-span-2 sm:col-span-1"
                value={<span className="font-mono text-xs text-muted-foreground">{d.id}</span>}
              />
              <InfoItem label="注册时间" value={formatDateTime(d.createdAt)} />
            </dl>
          </DetailSection>

          <DetailSection title="积分与分组">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoItem
                label="可用积分"
                value={
                  <span className="text-base font-semibold tabular-nums">
                    {d.credit?.balance ?? '—'}
                  </span>
                }
              />
              <InfoItem
                label="30 天内到期"
                value={
                  <span className="tabular-nums">
                    {d.credit ? d.credit.expiringSoon : '—'}
                  </span>
                }
              />
              <InfoItem
                label="累计获得"
                value={
                  <span className="tabular-nums">
                    {d.credit?.totalEarned ?? '—'}
                  </span>
                }
              />
              <InfoItem
                label="累计消耗"
                value={
                  <span className="tabular-nums">
                    {d.credit?.totalConsumed ?? '—'}
                  </span>
                }
              />
              <InfoItem
                label="计费分组"
                value={
                  d.group
                    ? `${d.group.name}（${d.group.code} · 倍率 ${(d.group.ratioBasisPoints / 10000).toFixed(2)}）`
                    : '—'
                }
              />
              <InfoItem
                label="有效积分批次"
                value={<span className="tabular-nums">{d.credit?.activeLots ?? '—'}</span>}
              />
            </dl>
          </DetailSection>

          <UserMembershipSection
            membership={d.membership}
            history={d.membershipHistory}
          />

          <UserSpendingSection
            spending={d.spending}
            orders={d.recentOrders}
            email={d.email}
          />

          <UserGenerationSection generation={d.generation} userId={d.id} />

          {/* 登录记录：权限点 user.read，无权限时静默显示说明而非报错 */}
          <RecentLoginsSection userId={d.id} />

          <DetailSection title="资源统计">
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <dl className="grid grid-cols-3 divide-x divide-border/70 px-4">
                <MiniStat size="xl" label="项目" value={d.stats.projects} />
                <MiniStat size="xl" label="任务" value={d.stats.tasks} />
                <MiniStat size="xl" label="素材" value={d.stats.assets} />
              </dl>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <Link
                className="rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-primary/40"
                to={adminOrderHref({ email: d.email })}
              >
                <span className="text-muted-foreground">订单</span>
                <strong className="ml-2 tabular-nums text-foreground">
                  {d.stats.orders}
                </strong>
              </Link>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <span className="text-muted-foreground">工单</span>
                <strong className="ml-2 tabular-nums text-foreground">
                  {d.stats.tickets}
                </strong>
              </div>
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <span className="text-muted-foreground">发票</span>
                <strong className="ml-2 tabular-nums text-foreground">
                  {d.stats.invoices}
                </strong>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="最近任务" note="20 条">
            {d.recentTasks.length === 0 ? (
              <EmptyState
                title="暂无任务记录"
                description="该用户创建生成任务后会显示在这里。"
                className="border-0 px-4 py-7"
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border/70">
                {d.recentTasks.map((t) => (
                  <li key={t.id}>
                    <Link
                      className="flex items-center gap-3 rounded-md px-1.5 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {t.capabilityName}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                          #{t.id.slice(-8)}
                        </span>
                      </span>
                      <StatusTag status={t.status} />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
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
                className="border-0 px-4 py-7"
              />
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {d.recentAssets.map((a) => (
                  <Link
                    key={a.id}
                    className="block overflow-hidden rounded-md border border-border transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
