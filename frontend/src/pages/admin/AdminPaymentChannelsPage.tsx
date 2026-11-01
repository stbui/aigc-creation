import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../admin-ui/shadcn/kit';
import { adminPaymentChannelsApi } from '../../lib/api';
import { AdminDataTable, type AdminColumn } from '../../admin-ui/primitives/DataTable';
import { Notice } from '../../admin-ui/primitives';
import {
  AdminListError,
  AdminListLoading,
  AdminStaleError,
  useAdminResource,
} from '../../components/admin/AdminWidgets';
import { AdminEmpty, PageHeader, Panel, StatCard, StatusTag } from '../../components/admin/PageHeader';
import type { AdminPaymentChannelStatus, PaymentChannelId } from '../../types/api';

/** 通道的静态说明（后端只给状态, 文案与变量名放前端, 避免接口变成 i18n 字典） */
const META: Record<PaymentChannelId, { desc: string; envKeys: string[] }> = {
  sandbox: {
    desc: '站内模拟支付，不产生真实资金流转；仅用于开发与测试',
    envKeys: ['PAYMENT_PROVIDER=sandbox'],
  },
  alipay: {
    desc: '支付宝网页支付，RSA2 签名，用户跳转收银台完成付款',
    envKeys: ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_GATEWAY（可选）'],
  },
  wechat: {
    desc: '微信支付 API v3 Native，展示二维码由用户扫码付款',
    envKeys: [
      'WECHAT_MCH_ID',
      'WECHAT_APP_ID',
      'WECHAT_API_V3_KEY',
      'WECHAT_SERIAL_NO',
      'WECHAT_PRIVATE_KEY',
      'WECHAT_PLATFORM_PUBLIC_KEY',
    ],
  },
};

const ENV_LABELS: Record<string, string> = {
  development: '开发',
  test: '测试',
  production: '生产',
};

type Channel = AdminPaymentChannelStatus['channels'][number];

/**
 * 支付渠道状态（只读）。
 *
 * 存在的理由：支付通道配错时链路是**静默**的 ——
 *   · 生产仍走沙箱：用户付款「成功」，账上一分钱没有；
 *   · 真实通道缺凭据：发起支付直接 503，订单列表看不出异常；
 *   · 回调地址不可达：钱收了，订单永远 pending。
 * 三种问题都不会在别处报错，只有专门看这一屏才能提前发现。
 *
 * ⚠ **凭据只读**：与「存储配置」页同一安全边界。凭据只从部署环境变量读取，
 * 本页没有输入框、也没有写端点。切换通道 = 改 PAYMENT_PROVIDER 并重启，
 * 刻意不做成一键按钮：改错支付通道的代价是「收款成功但没有钱」。
 */
export function AdminPaymentChannelsPage() {
  const { data, loading, error, reload } = useAdminResource(() => adminPaymentChannelsApi.status());

  if (loading && !data) return <AdminListLoading tip="加载支付渠道状态…" />;
  if (error && !data) return <AdminListError error={error} onRetry={() => void reload()} />;
  if (!data) return <AdminEmpty description="暂无支付渠道信息" />;

  const activeChannel = data.channels.find((c) => c.channel === data.active);
  const hasDanger = (data.warnings ?? []).some((w) => w.level === 'danger');

  const columns: Array<AdminColumn<Channel>> = [
    {
      key: 'label',
      title: '通道',
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            {row.label}
            {row.active && <StatusTag status="active" tone="brand" label="当前生效" />}
          </span>
          <span className="text-[11px] text-text-tertiary">{META[row.channel].desc}</span>
        </div>
      ),
    },
    {
      key: 'configured',
      title: '凭据',
      width: 200,
      render: (row) =>
        row.configured ? (
          <StatusTag
            status="configured"
            tone="success"
            label={row.channel === 'sandbox' ? '无需凭据' : '已齐全'}
          />
        ) : (
          <StatusTag status="missing" tone="danger" label={`缺 ${row.missing.length} 项`} />
        ),
    },
    {
      key: 'missing',
      title: '缺失的环境变量',
      render: (row) =>
        row.missing.length === 0 ? (
          <span className="text-text-placeholder">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.missing.map((key) => (
              <code
                key={key}
                className="rounded border border-border-table bg-background-secondary-default px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
              >
                {key}
              </code>
            ))}
          </div>
        ),
    },
    {
      key: 'notifyUrl',
      title: '渠道回调地址',
      render: (row) =>
        row.notifyUrl ? (
          <code className="break-all font-mono text-[11px] text-text-secondary">{row.notifyUrl}</code>
        ) : (
          <span className="text-text-placeholder">站内模拟，无需回调</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="支付渠道"
        description="当前生效的收款通道与凭据状态。切换通道需修改部署环境变量并重启，页面不提供编辑。"
        actions={
          <Button
            variant="secondary"
            size="small"
            leadingIcon={RefreshCw}
            disabled={loading}
            onClick={() => void reload()}
          >
            刷新
          </Button>
        }
      />

      {/* 刷新失败但手上有旧数据: 本页的结论是「能不能安全收钱」,
          看着旧状态而不知道它已经过期, 比看不到更危险 */}
      {error && <AdminStaleError error={error} onRetry={() => void reload()} />}

      <Notice tone="locked" title="凭据不在界面配置。">
        <div>
          商户号、私钥等只从部署环境变量读取，页面只展示是否配齐与缺失的变量名，不回传任何凭据值。
        </div>
        <code className="mt-1 block break-all font-mono text-[11px] text-text-secondary">
          {data.credentialSource}
        </code>
      </Notice>

      {(data.warnings ?? []).map((w) => (
        <Notice key={w.message} tone={w.level === 'danger' ? 'danger' : 'warn'}>
          {w.message}
        </Notice>
      ))}

      {/* 三张卡用 auto-fit 而不是固定列数: 桌面端固定 6 列时只放 3 张会剩下半屏空白 */}
      <div className="mb-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <StatCard
          label="当前生效通道"
          value={activeChannel?.label ?? data.active}
          hint={<code className="font-mono text-[11px]">PAYMENT_PROVIDER={data.active}</code>}
          tone={hasDanger ? 'danger' : undefined}
        />
        <StatCard
          label="凭据状态"
          value={activeChannel?.configured ? '已配齐' : '不完整'}
          hint={
            activeChannel?.configured
              ? '发起支付可正常选路'
              : `缺少 ${activeChannel?.missing.join('、') || '未知配置'}，支付将返回 503`
          }
          tone={activeChannel?.configured ? undefined : 'danger'}
        />
        <StatCard
          label="运行环境"
          value={ENV_LABELS[data.environment] ?? data.environment}
          hint={<code className="font-mono text-[11px]">{data.environment}</code>}
        />
      </div>

      <Panel
        title="通道清单"
        note="状态由后端 PaymentProviderFactory 直接判定，与真实支付链路同一份逻辑"
      >
        <AdminDataTable<Channel>
          rows={data.channels}
          columns={columns}
          rowKey={(row) => row.channel}
          minWidth={800}
          emptyText="没有可展示的支付通道"
        />
      </Panel>

      <Panel title="如何切换通道" note="改配置 + 重启，不在界面里做">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-5 text-text-secondary">
          <li>
            <strong className="text-text-primary">切换生效通道</strong>：修改{' '}
            <Code>PAYMENT_PROVIDER</Code> 为 <Code>alipay</Code> 或 <Code>wechat</Code> 后重启服务。
          </li>
          <li>
            <strong className="text-text-primary">不放一键按钮的原因</strong>：支付通道改错不会报错，只会让「用户付款成功、账上没有钱」，
            必须经过部署流程与重启，留下可追溯的配置变更。
          </li>
          <li>
            <strong className="text-text-primary">回调地址</strong>：真实通道的 <Code>notifyUrl</Code> 必须是渠道服务器
            能公网访问的地址（由 <Code>PAYMENT_NOTIFY_BASE</Code> 决定），并在支付宝 / 微信商户后台登记。
          </li>
          <li>
            <strong className="text-text-primary">缺凭据不降级</strong>：真实通道缺任一项凭据时发起支付返回 503，绝不会静默回落到沙箱 ——
            沙箱「支付成功」在生产等于白送积分。
          </li>
        </ul>
      </Panel>

      <Panel title="各通道所需环境变量" note="缺失项在上表已标红；此处列全量，便于部署时逐项核对">
        <ul className="flex flex-col gap-3 text-xs">
          {data.channels.map((channel) => (
            <li key={channel.channel}>
              <strong className="text-text-primary">{channel.label}</strong>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {META[channel.channel].envKeys.map((key) => (
                  <Code key={key}>{key}</Code>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-border-table bg-background-secondary-default px-1 py-0.5 font-mono text-[11px] text-text-secondary">
      {children}
    </code>
  );
}
