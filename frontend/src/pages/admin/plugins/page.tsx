import { useRef, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { adminPluginsApi, adminProviderCatalogApi } from './api';
import { ActionButton, Notice, PageHeader, Panel, SkeletonBody, StaleError } from './components';
import { useAdmin, useAdminResource, useToast } from './hooks';
import { auditReason } from '../../../admin-ui/lib/auditReason';
import { PluginStats } from './PluginStats';
import { PluginTable } from './PluginTable';
import { CatalogTable } from './CatalogTable';
import { PluginDetailDrawer } from './PluginDetailDrawer';
import {
  InstallPluginConfirm,
  TogglePluginConfirm,
  UninstallPluginConfirm,
} from './PluginActionDialogs';
import type { PluginView, ProviderCatalogEntry, ProviderCatalogView } from '../../../types/model';

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
  const [installTarget, setInstallTarget] = useState<File | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PluginView | null>(null);
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
        auditReason(toggleTarget.enabled ? '停用插件' : '启用插件'),
      );
      toast.success(
        `插件「${next.name}」已${next.enabled ? '启用' : '停用'}，协议注册表已刷新（当前生效 ${next.activeProtocols} 个协议）`,
      );
      setToggleTarget(null);
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
      const next = await adminPluginsApi.install(
        installTarget,
        auditReason('安装插件'),
      );
      toast.success(`插件「${next.name}」已安装（v${next.version}，默认启用）`);
      setInstallTarget(null);
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
      await adminPluginsApi.uninstall(uninstallTarget.id, auditReason('卸载插件'));
      toast.success(`插件「${uninstallTarget.name}」已卸载，协议注册表已刷新`);
      setUninstallTarget(null);
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

      <PluginStats summary={summary} unavailableCount={unavailableCount} />

      <Panel
        title="插件清单"
        note="停用只影响新建调用的协议解析：引用该协议的渠道模型会在调用时失败并退款。"
      >
        {loading && items.length === 0 ? (
          /* 面板外壳已经是实的，只替内容行 */
          <SkeletonBody rows={4} />
        ) : (
          <>
            {error && <StaleError error={error} onRetry={() => void reload()} />}
            <PluginTable
              items={items}
              loading={loading}
              error={error}
              writable={writable}
              busy={busy}
              onDetail={setDetail}
              onVerify={(row) => void runVerify(row)}
              onToggle={(row) => {
                setToggleTarget(row);
              }}
              onUninstall={(row) => {
                setUninstallTarget(row);
              }}
              onRetry={() => void reload()}
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
            {catalog.data.reason ||
              '配置 MODEL_PROVIDER_CATALOG_URL 后才会出现可安装的厂商插件。'}
          </Notice>
        ) : (
          <>
            {catalog.error && (
              <StaleError error={catalog.error} onRetry={() => void catalog.reload()} />
            )}
            <CatalogTable
              items={catalogItems}
              loading={catalog.loading}
              error={catalog.error}
              writable={writable}
              busy={busy}
              onVerify={(entry) => void runCatalogVerify(entry)}
              onInstall={(entry) => void runCatalogInstall(entry)}
              onRetry={() => void catalog.reload()}
            />
          </>
        )}
      </Panel>

      <PluginDetailDrawer plugin={detail} onClose={() => setDetail(null)} />

      <TogglePluginConfirm
        target={toggleTarget}
        loading={busy !== null}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void runToggle()}
      />

      <InstallPluginConfirm
        file={installTarget}
        loading={busy === 'install'}
        onCancel={() => setInstallTarget(null)}
        onConfirm={() => void runInstall()}
      />

      <UninstallPluginConfirm
        target={uninstallTarget}
        loading={busy === uninstallTarget?.id}
        onCancel={() => setUninstallTarget(null)}
        onConfirm={() => void runUninstall()}
      />
    </>
  );
}
