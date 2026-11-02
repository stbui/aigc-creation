import { useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { adminPluginsApi, adminProviderCatalogApi } from '../../lib/api';
import { useAdmin } from '../../context/AdminContext';
import { useToast } from '../../admin-ui/providers/ToastProvider';
import {
  ActionButton,
  AdminDataTable,
  ConfirmAction,
  Descriptions,
  Drawer,
  FormField,
  HelpTip,
  Notice,
  PageHeader,
  Panel,
  Skeleton,
  StatCard,
  StatusTag,
  StaleError,
  TextField,
  useAdminResource,
  type AdminColumn,
} from '../../admin-ui/primitives';
import type {
  PluginListResult,
  PluginView,
  ProviderCatalogEntry,
  ProviderCatalogView,
} from '../../types/model';

/**
 * 插件（`/admin/plugins`）。
 *
 * 插件是**协议来源**：启停会立即重注册协议，渠道模型可选的协议列表随之变化。
 * 关掉一个插件不一定立刻坏 —— 已有渠道模型仍引用该协议 id，只是发起调用时
 * 找不到注册表实现而失败（任务按 42201 失败并退款）。所以停用前要看
 * 「协议生效数」与使用该协议的模型数。
 *
 * 插件有两种来源（`origin`）：
 *   · `builtin` —— 随代码入库，只能启停、不能卸载；
 *   · `installed` —— 后台上传的 zip，落在独立安装目录，可卸载。
 * 卸载会被后端拒绝（40909）当仍有渠道模型引用它的协议 —— 页面先把
 * 「可能被拒绝」说清楚，而不是让用户点完再看报错。
 *
 * 服务商目录（下半页）是插件包的上游清单：配置了 `MODEL_PROVIDER_CATALOG_URL`
 * 才可用，未配置时展示空态与原因，不伪造一份假目录。
 */

/** 贡献项 → 非零条目文本 */
function contributionText(plugin: PluginView): string {
  const labels: Array<[keyof PluginView['contributions'], string]> = [
    ['providers', 'Provider'],
    ['smsProviders', '短信'],
    ['paymentProviders', '支付'],
    ['workflows', '工作流'],
    ['canvasNodes', '画布节点'],
    ['transforms', '变换'],
    ['commands', '命令'],
    ['assetSources', '素材源'],
    ['usageObservers', '用量观察'],
    ['aiCapabilities', 'AI 能力'],
    ['agents', '智能体'],
    ['importExport', '导入导出'],
  ];
  const parts = labels
    .filter(([key]) => Number(plugin.contributions?.[key] ?? 0) > 0)
    .map(([key, label]) => `${label} ${plugin.contributions[key]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function AdminPluginsPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const writable = can('plugin.write');

  const { data, loading, error, reload } = useAdminResource(() => adminPluginsApi.list());
  const items = data?.items ?? [];
  const summary = data?.summary;
  /** 当前环境不可用的插件数（清单已入库但本环境不执行其贡献） */
  const unavailableCount = items.filter((item) => !item.availability?.available).length;

  const [detail, setDetail] = useState<PluginView | null>(null);
  const [toggleTarget, setToggleTarget] = useState<PluginView | null>(null);
  const [toggleReason, setToggleReason] = useState('');
  const [installTarget, setInstallTarget] = useState<File | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PluginView | null>(null);
  /** 装卸共用：操作原因只进审计 */
  const [actionReason, setActionReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const catalog = useAdminResource<ProviderCatalogView>(() => adminProviderCatalogApi.list());
  const catalogItems = catalog.data?.items ?? [];

  const runToggle = async () => {
    if (!toggleTarget) return;
    setBusy(toggleTarget.id);
    try {
      const next = await adminPluginsApi.setEnabled(
        toggleTarget.id,
        !toggleTarget.enabled,
        toggleReason.trim() || undefined,
      );
      toast.success(
        `插件「${next.name}」已${next.enabled ? '启用' : '停用'}，协议注册表已刷新（当前生效 ${next.activeProtocols} 个协议）`,
      );
      setToggleTarget(null);
      setToggleReason('');
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async (plugin: PluginView) => {
    setBusy(plugin.id);
    try {
      /*
       * 校验接口返回的是校验结果本身（不是插件视图）。旧代码读 `next.verify`
       * 永远拿到 undefined，页面一律提示「未通过：未知原因」—— 这里直接用结果。
       */
      const result = await adminPluginsApi.verify(plugin.id);
      if (result.ok) toast.success(`「${plugin.name}」契约校验通过`);
      else toast.error(`「${plugin.name}」契约校验未通过：${result.reason || '未知原因'}`);
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '校验失败');
    } finally {
      setBusy(null);
    }
  };

  const runInstall = async () => {
    if (!installTarget) return;
    setBusy('install');
    try {
      const next = await adminPluginsApi.install(installTarget, actionReason.trim() || undefined);
      toast.success(`插件「${next.name}」已安装（v${next.version}，默认启用）`);
      setInstallTarget(null);
      setActionReason('');
      await reload({ silent: true });
      catalog.reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '安装失败');
    } finally {
      setBusy(null);
    }
  };

  const runUninstall = async () => {
    if (!uninstallTarget) return;
    setBusy(uninstallTarget.id);
    try {
      await adminPluginsApi.uninstall(uninstallTarget.id, actionReason.trim() || undefined);
      toast.success(`插件「${uninstallTarget.name}」已卸载，协议注册表已刷新`);
      setUninstallTarget(null);
      setActionReason('');
      await reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '卸载失败');
    } finally {
      setBusy(null);
    }
  };

  const runCatalogRefresh = async () => {
    setBusy('catalog:refresh');
    try {
      const next = await adminProviderCatalogApi.refresh();
      toast.success(`服务商目录已更新：${next.items.length} 个条目`);
      await catalog.reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拉取目录失败');
    } finally {
      setBusy(null);
    }
  };

  const runCatalogVerify = async (entry: ProviderCatalogEntry) => {
    setBusy(`catalog:${entry.id}`);
    try {
      const result = await adminProviderCatalogApi.verify(entry.id);
      if (result.ok) toast.success(`「${entry.name}」字段校验通过`);
      else toast.error(`「${entry.name}」字段校验未通过：${result.reason || '未知原因'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '校验失败');
    } finally {
      setBusy(null);
    }
  };

  const runCatalogInstall = async (entry: ProviderCatalogEntry) => {
    setBusy(`catalog:${entry.id}`);
    try {
      const next = await adminProviderCatalogApi.install(entry.id);
      toast.success(`插件「${next.name}」已从服务商目录安装（v${next.version}）`);
      await reload({ silent: true });
      await catalog.reload({ silent: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '安装失败');
    } finally {
      setBusy(null);
    }
  };

  const columns: Array<AdminColumn<PluginView>> = [
    {
      key: 'name',
      title: '插件',
      width: 240,
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{row.name}</span>
            {row.enabled ? (
              <StatusTag status="enabled" tone="success" label="启用" />
            ) : (
              <StatusTag status="disabled" tone="muted" label="停用" />
            )}
            <StatusTag
              status={row.origin}
              tone={row.origin === 'installed' ? 'brand' : 'muted'}
              label={row.origin === 'installed' ? '上传' : '内置'}
            />
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {row.id} · v{row.version}
          </div>
        </div>
      ),
    },
    {
      key: 'vendor',
      title: '厂商',
      width: 120,
      render: (row) => <span className="text-muted-foreground">{row.vendor || '—'}</span>,
    },
    {
      key: 'protocols',
      title: '协议生效',
      width: 90,
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.activeProtocols}</span>,
    },
    {
      key: 'availability',
      title: '当前环境',
      width: 150,
      render: (row) =>
        row.availability?.available ? (
          <StatusTag status="available" tone="success" label="可用" />
        ) : (
          <HelpTip tip={row.availability?.reason || '当前环境不可用'}>
            <StatusTag status="unavailable" tone="warn" label="不可用" />
          </HelpTip>
        ),
    },
    {
      key: 'providers',
      title: 'Provider',
      width: 180,
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.providers.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            row.providers.map((provider) => (
              <StatusTag
                key={provider.id}
                status={provider.registered ? 'registered' : 'unregistered'}
                tone={provider.registered ? 'success' : 'muted'}
                label={provider.label || provider.id}
              />
            ))
          )}
        </div>
      ),
    },
    {
      key: 'contributions',
      title: '贡献',
      render: (row) => (
        <span className="line-clamp-2 text-[11px] text-muted-foreground">
          {contributionText(row)}
        </span>
      ),
    },
    {
      key: 'verify',
      title: '契约校验',
      width: 130,
      render: (row) =>
        row.verify ? (
          <div className="flex flex-col gap-0.5 text-[11px]">
            {row.verify.ok ? (
              <StatusTag status="ok" tone="success" label="通过" />
            ) : (
              <StatusTag status="fail" tone="danger" label="未通过" />
            )}
            <span className="tabular-nums text-muted-foreground">
              {new Date(row.verify.checkedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">未校验</span>
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="xs" onClick={() => setDetail(row)}>
            详情
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            icon={ShieldCheck}
            disabled={busy === row.id}
            onClick={() => void runVerify(row)}
          >
            校验
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={!writable || busy === row.id}
            onClick={() => {
              setToggleReason('');
              setToggleTarget(row);
            }}
          >
            {row.enabled ? '停用' : '启用'}
          </ActionButton>
          {row.removable && (
            /*
             * 行内危险动作保持 ghost + 红字：实心红按钮在一列四颗动作里
             * 会盖过状态列，运营反而看不出哪个插件更该处理。
             */
            <ActionButton
              variant="ghost"
              size="xs"
              className="text-danger-text hover:text-danger-text"
              disabled={!writable || busy === row.id}
              onClick={() => {
                setActionReason('');
                setUninstallTarget(row);
              }}
            >
              卸载
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  const catalogColumns: Array<AdminColumn<ProviderCatalogEntry>> = [
    {
      key: 'name',
      title: '服务商',
      width: 220,
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{row.name}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{row.id}</div>
        </div>
      ),
    },
    {
      key: 'vendor',
      title: '厂商',
      width: 120,
      render: (row) => <span className="text-muted-foreground">{row.vendor || '—'}</span>,
    },
    {
      key: 'version',
      title: '版本',
      width: 80,
      render: (row) => <span className="font-mono text-[11px]">v{row.version}</span>,
    },
    {
      key: 'endpoint',
      title: '接口',
      width: 280,
      render: (row) => (
        <div className="min-w-0 text-[11px]">
          <div className="text-muted-foreground">{row.apiFormat || '—'}</div>
          <div className="truncate font-mono text-muted-foreground" title={row.baseUrl}>
            {row.baseUrl || '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'protocols',
      title: '协议',
      width: 200,
      render: (row) =>
        row.protocols.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            {row.protocols.join(' · ')}
          </span>
        ),
    },
    {
      key: 'installed',
      title: '状态',
      width: 100,
      render: (row) =>
        row.installed ? (
          <StatusTag status="installed" tone="success" label="已安装" />
        ) : (
          <StatusTag status="not_installed" tone="muted" label="未安装" />
        ),
    },
    {
      key: 'ops',
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (row) => (
        <div className="flex items-center gap-1">
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={busy === `catalog:${row.id}`}
            onClick={() => void runCatalogVerify(row)}
          >
            校验
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="xs"
            disabled={!writable || row.installed || busy === `catalog:${row.id}`}
            onClick={() => void runCatalogInstall(row)}
          >
            {row.installed ? '已安装' : '安装'}
          </ActionButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="插件"
        description="插件的启停会立即重注册协议；渠道模型可选的协议列表就是注册表的投影。"
        actions={
          <>
            {/*
              文件选择框隐藏在外壳后面：上传动作必须由按钮触发，否则页头会出现
              一个突兀的浏览器控件。`data-testid` 是安装流程的 e2e 锚点。
            */}
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              data-testid="admin-plugin-file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                // 同一文件连续选择两次时清空，否则第二次不会触发 change
                event.target.value = '';
                if (!file) return;
                setActionReason('');
                setInstallTarget(file);
              }}
            />
            <ActionButton
              variant="secondary"
              size="sm"
              icon={Upload}
              disabled={!writable}
              onClick={() => fileInput.current?.click()}
            >
              上传安装
            </ActionButton>
          </>
        }
      />

      {summary && (
        <div className="mb-3 grid grid-cols-4 gap-3">
          <StatCard
            label="插件总数"
            value={summary.total}
            hint={`启用 ${summary.enabled} · 停用 ${summary.disabled}`}
          />
          <StatCard label="Provider" value={summary.providers} hint="跨插件汇总" />
          <StatCard
            label="已注册协议"
            value={summary.protocol.registered}
            hint={
              summary.protocol.hostBacked.length > 0
                ? `宿主引擎未内置 ${summary.protocol.hostBacked.length} 个`
                : '声明式插件全部注册'
            }
            tone={summary.protocol.registered === 0 ? 'danger' : undefined}
          />
          <StatCard
            label="当前环境不可用"
            value={unavailableCount}
            hint={
              unavailableCount > 0
                ? '清单已入库，但本环境不执行其贡献'
                : '全部插件在本环境可用'
            }
            tone={unavailableCount > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      <Panel
        title="插件清单"
        note="停用只影响新建调用的协议解析：引用该协议的渠道模型会在调用时失败并退款。"
      >
        {loading && items.length === 0 ? (
          <div className="flex flex-col gap-2 py-2">
            <Skeleton rows={4} />
            <p className="text-center text-xs text-muted-foreground">加载插件清单…</p>
          </div>
        ) : (
          <>
            {error && <StaleError error={error} onRetry={() => void reload()} />}
            <AdminDataTable<PluginView>
              rows={items}
              columns={columns}
              rowKey={(row) => row.id}
              loading={loading}
              error={items.length === 0 ? error : null}
              onRetry={() => void reload()}
              emptyText="没有任何插件。内置插件随代码入库，缺失时协议注册表为空。"
              minWidth={1180}
            />
          </>
        )}
      </Panel>

      <Panel
        title="服务商目录"
        note="插件包的上游清单。安装会下载包并走与上传安装同一套校验，成功后立即注册协议。"
        extra={
          <ActionButton
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={!writable || busy === 'catalog:refresh'}
            onClick={() => void runCatalogRefresh()}
          >
            重新拉取
          </ActionButton>
        }
      >
        {catalog.data && !catalog.data.configured ? (
          <Notice tone="warn" title="服务商目录未配置">
            {catalog.data.reason || '配置 MODEL_PROVIDER_CATALOG_URL 后才会出现可安装的厂商插件。'}
          </Notice>
        ) : (
          <>
            {catalog.error && (
              <StaleError error={catalog.error} onRetry={() => void catalog.reload()} />
            )}
            <AdminDataTable<ProviderCatalogEntry>
              rows={catalogItems}
              columns={catalogColumns}
              rowKey={(row) => row.id}
              loading={catalog.loading}
              error={catalogItems.length === 0 ? catalog.error : null}
              onRetry={() => void catalog.reload()}
              emptyText="目录为空。点「重新拉取」获取最新清单。"
              minWidth={1020}
            />
          </>
        )}
      </Panel>

      <Drawer
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        width={680}
        title={detail ? `${detail.name} · ${detail.id}` : '插件详情'}
        description={detail ? `v${detail.version} · ${detail.vendor || '未知厂商'} · API ${detail.apiVersion}` : undefined}
        footer={
          <ActionButton variant="secondary" size="sm" onClick={() => setDetail(null)}>
            关闭
          </ActionButton>
        }
      >
        {detail && (
          <div className="flex flex-col gap-4">
            <Descriptions
              items={[
                { label: '状态', value: detail.enabled ? '启用' : '停用' },
                { label: '生效协议数', value: String(detail.activeProtocols) },
                { label: '来源', value: detail.source },
                { label: '可安装', value: detail.installable ? '是' : '否（随代码入库）' },
                { label: '运行时', value: `backend ${detail.runtime.backend} · web ${detail.runtime.web}` },
                {
                  label: '当前环境',
                  value: detail.availability?.available ? '可用' : '不可用',
                },
                { label: '最近更新', value: detail.updatedAt ? new Date(detail.updatedAt).toLocaleString('zh-CN') : '—' },
              ]}
              columns={2}
            />

            {/* 不可用原因必须说清楚：清单入库 ≠ 本环境会执行它 */}
            {!detail.availability?.available && detail.availability?.reason && (
              <Notice tone="warn" title="当前环境不可用">
                {detail.availability.reason}
              </Notice>
            )}

            {detail.description && (
              <p className="text-xs leading-5 text-muted-foreground">{detail.description}</p>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold text-foreground">Provider</div>
              <table className="w-full text-[11px]">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">ID</th>
                    <th className="px-2 py-1.5 text-left">名称</th>
                    <th className="px-2 py-1.5 text-left">能力</th>
                    <th className="px-2 py-1.5 text-left">注册</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.providers.map((provider) => (
                    <tr key={provider.id} className="border-t border-border">
                      <td className="px-2 py-1.5 font-mono">{provider.id}</td>
                      <td className="px-2 py-1.5">{provider.label}</td>
                      <td className="px-2 py-1.5">{provider.capabilities.join(', ') || '—'}</td>
                      <td className="px-2 py-1.5">
                        {provider.registered ? (
                          <StatusTag status="registered" tone="success" label="已注册" />
                        ) : (
                          <StatusTag status="unregistered" tone="muted" label="未注册" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-foreground">配置项</div>
              {detail.configuration.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">该插件没有声明配置项。</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {detail.configuration.map((field) => (
                    <li key={field.name} className="rounded-lg border border-border px-2.5 py-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-foreground">{field.name}</span>
                        <span className="text-muted-foreground">{field.type}</span>
                        {field.required && <StatusTag status="required" tone="warn" label="必填" />}
                        {field.secret && <StatusTag status="secret" tone="muted" label="密钥" />}
                      </div>
                      {field.label && <div className="mt-0.5 text-muted-foreground">{field.label}</div>}
                      {field.description && <div className="text-muted-foreground">{field.description}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Descriptions
              items={[
                { label: '贡献', value: contributionText(detail) },
                { label: '界面位置', value: detail.surfaces.join(', ') || '—' },
                { label: '权限', value: detail.permissions.join(', ') || '—' },
                {
                  label: '最近校验',
                  value: detail.verify
                    ? `${detail.verify.ok ? '通过' : '未通过'} · ${new Date(detail.verify.checkedAt).toLocaleString('zh-CN')}${detail.verify.reason ? ` · ${detail.verify.reason}` : ''}`
                    : '未校验',
                },
              ]}
              columns={2}
            />

            {detail.verify && !detail.verify.ok && (
              <Notice tone="danger" title="最近一次契约校验未通过">
                {detail.verify.reason || '原因未记录'}
              </Notice>
            )}

            {!detail.enabled && (
              <Notice tone="warn" title="插件已停用">
                该插件的协议不在注册表中；引用这些协议的渠道模型在调用时会失败（任务失败并退款）。
              </Notice>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmAction
        open={toggleTarget !== null}
        title={`${toggleTarget?.enabled ? '停用' : '启用'}插件「${toggleTarget?.name ?? ''}」？`}
        description="启停会立即重注册协议，已保存的渠道模型不受影响，但下发调用的协议解析会随注册表变化。"
        impact={
          toggleTarget?.enabled
            ? [
                `该插件当前生效 ${toggleTarget.activeProtocols} 个协议`,
                '引用这些协议的渠道模型在下一次调用时会失败并退款',
              ]
            : [`启用后重新注册该插件的 ${toggleTarget?.activeProtocols ?? 0} 个协议`]
        }
        danger={!!toggleTarget?.enabled}
        loading={busy !== null}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void runToggle()}
        extra={
          <FormField label="操作原因" hint="写入审计">
            <TextField
              ariaLabel="操作原因"
              value={toggleReason}
              onChange={setToggleReason}
              placeholder="如：上游维护，临时停用"
            />
          </FormField>
        }
      />

      <ConfirmAction
        open={installTarget !== null}
        title={`安装插件包「${installTarget?.name ?? ''}」？`}
        description="上传的包会写入独立安装目录（不覆盖内置插件），解析校验通过后立即注册协议。"
        impact={[
          `文件大小 ${installTarget ? (installTarget.size / 1024 / 1024).toFixed(2) : '0'} MB`,
          '与已安装插件同 id 会被拒绝，不做覆盖安装',
          '安装后默认启用，渠道模型可立即选择它的协议',
        ]}
        loading={busy === 'install'}
        onCancel={() => setInstallTarget(null)}
        onConfirm={() => void runInstall()}
        extra={
          <FormField label="操作原因" hint="写入审计">
            <TextField
              ariaLabel="安装原因"
              value={actionReason}
              onChange={setActionReason}
              placeholder="如：新增 MiniMax 视频厂商"
            />
          </FormField>
        }
      />

      <ConfirmAction
        open={uninstallTarget !== null}
        title={`卸载插件「${uninstallTarget?.name ?? ''}」？`}
        description="只会删除上传安装的包；内置插件随代码发布，不能卸载。"
        impact={[
          `该插件当前生效 ${uninstallTarget?.activeProtocols ?? 0} 个协议`,
          '仍有渠道模型引用这些协议时会被拒绝（先去渠道工作台改协议）',
          '卸载后协议从注册表移除，引用它的模型调用会失败并退款',
        ]}
        danger
        loading={busy === uninstallTarget?.id}
        onCancel={() => setUninstallTarget(null)}
        onConfirm={() => void runUninstall()}
        extra={
          <FormField label="操作原因" hint="写入审计">
            <TextField
              ariaLabel="卸载原因"
              value={actionReason}
              onChange={setActionReason}
              placeholder="如：厂商已下线，改用新插件包"
            />
          </FormField>
        }
      />
    </>
  );
}
