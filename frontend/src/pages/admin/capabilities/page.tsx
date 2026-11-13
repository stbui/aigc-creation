import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useConfirm } from '../../../admin-ui/providers/ConfirmProvider';
import { useToast } from '../../../admin-ui/providers/ToastProvider';
import {
  ActionButton,
  AdminPage,
  AppliedFilters,
  Button,
  ClearableField,
  EmptyState,
  FilterActions,
  FilterBar,
  ListError,
  Panel,
  SelectField,
  useAdminResource,
  useAdminUrlFilterSync,
  type AppliedFilter,
} from '~/admin-ui/primitives';
import { useAdmin } from '../../../context/AdminContext';
import { adminCapabilitiesApi, adminCapabilityModelsApi } from '../../../lib/api';
import type { AdminCapabilityControl } from '../../../types/api';
import { CapabilityList } from './CapabilityList';
import { CapabilityWorkspace } from './CapabilityWorkspace';
import {
  RUNTIME_FILTER_OPTIONS,
  isCapabilityTab,
  isRuntimeFilter,
} from './constants';
import type { CapabilityRuntimeFilter, CapabilityTab } from './types';
import { matchesCapabilityFilters } from './utils';

/**
 * 能力与模型（`/admin/capabilities`）。
 *
 * 能力是售卖单元，页面围绕四个问题组织：现在能不能卖、由哪些商品承接、
 * 卖多少钱、改动会影响到谁。筛选、当前能力与页签均写入地址栏，便于运营
 * 把同一个排查现场直接转给同事。
 */
export function AdminCapabilitiesPage() {
  const { can } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [initialSearch] = useSearchParams();
  const readable = can('capability.read') || can('logical_model.read');
  const bindingReadable = can('logical_model.read');
  const capabilityWritable = can('capability.write');
  const bindingWritable = can('logical_model.write');
  const pricingReadable = can('product.price');
  const pricingWritable = can('product.price');

  const [keyword, setKeyword] = useState(() => initialSearch.get('q') ?? '');
  const [runtime, setRuntime] = useState<CapabilityRuntimeFilter | undefined>(() => {
    const value = initialSearch.get('runtime');
    return isRuntimeFilter(value) ? value : undefined;
  });
  const [tab, setTab] = useState<CapabilityTab>(() => {
    const value = initialSearch.get('tab');
    return isCapabilityTab(value) ? value : 'overview';
  });
  const [selectedId, setSelectedId] = useState(() => initialSearch.get('id') ?? '');
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [pruningAll, setPruningAll] = useState(false);

  const list = useAdminResource<AdminCapabilityControl[]>(
    () => (readable ? adminCapabilitiesApi.list() : Promise.resolve([])),
    [readable],
  );
  const rows = list.data ?? [];
  const filtered = useMemo(
    () => rows.filter((row) => matchesCapabilityFilters(row, keyword, runtime)),
    [rows, keyword, runtime],
  );
  const selected = useMemo(
    () => filtered.find((row) => row.capabilityId === selectedId) ?? null,
    [filtered, selectedId],
  );
  const hasFilters = Boolean(keyword.trim() || runtime);

  useAdminUrlFilterSync({
    q: keyword.trim() || undefined,
    runtime,
    tab,
    id: selectedId || undefined,
  });

  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((row) => row.capabilityId === selectedId)) {
      setSelectedId(filtered[0].capabilityId);
    }
  }, [filtered, selectedId]);

  const resetFilters = () => {
    setKeyword('');
    setRuntime(undefined);
  };

  const pruneAllInvalid = async () => {
    const confirmed = await confirm({
      title: '清理全部失效绑定？',
      description:
        '将清理所有能力中指向缺失 / 已删除商品的绑定，以及能力定义已不存在的绑定。有效绑定、能力售价与上线状态不会改变；此操作不可撤销。',
      confirmText: '确认清理',
      danger: true,
    });
    if (confirmed === null) return;

    setPruningAll(true);
    try {
      const result = await adminCapabilityModelsApi.pruneAllInvalid();
      toast.success(`已清理 ${result.removed} 条失效绑定`);
      setWorkspaceRevision((value) => value + 1);
      await list.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理失败');
    } finally {
      setPruningAll(false);
    }
  };

  const appliedFilters: AppliedFilter[] = [];
  if (keyword.trim()) {
    appliedFilters.push({
      key: 'q',
      label: `关键词：${keyword.trim()}`,
      onClear: () => setKeyword(''),
    });
  }
  if (runtime) {
    const label =
      RUNTIME_FILTER_OPTIONS.find((option) => option.value === runtime)?.label ?? runtime;
    appliedFilters.push({
      key: 'runtime',
      label: `运行结论：${label}`,
      onClear: () => setRuntime(undefined),
    });
  }

  return (
    <AdminPage
      title="能力与模型"
      description="能力是售卖单元：绑定可承接的渠道模型，设置能力级售价，运行时自动切换线路。"
      actions={
        <>
          {bindingReadable && bindingWritable && (
            <ActionButton
              variant="secondary"
              size="sm"
              disabled={pruningAll}
              onClick={() => void pruneAllInvalid()}
            >
              {pruningAll ? '清理中…' : '清理全部失效绑定'}
            </ActionButton>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/channels">模型商品</Link>
          </Button>
        </>
      }
    >
      <FilterBar>
        <ClearableField
          ariaLabel="搜索能力"
          placeholder="能力名称 / ID / 分组"
          icon={<Search className="size-3.5" aria-hidden />}
          value={keyword}
          onChange={setKeyword}
          className="w-64"
        />
        <SelectField
          ariaLabel="运行结论"
          value={runtime}
          onChange={(value) =>
            setRuntime(isRuntimeFilter(value) ? value : undefined)
          }
          options={[...RUNTIME_FILTER_OPTIONS]}
          clearLabel="全部运行结论"
          allowClear
          className="w-40"
        />
        <FilterActions>
          <span className="text-xs tabular-nums text-muted-foreground">
            {list.loading ? '读取中…' : `${filtered.length} 项能力`}
          </span>
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={!hasFilters}
            onClick={resetFilters}
          >
            重置
          </ActionButton>
        </FilterActions>
        <AppliedFilters items={appliedFilters} />
      </FilterBar>

      {!readable ? (
        <Panel title="能力">
          <EmptyState
            title="无能力读取权限"
            description="需要 capability.read 或 logical_model.read 权限。"
          />
        </Panel>
      ) : list.error && rows.length === 0 ? (
        <ListError error={list.error} onRetry={() => void list.reload()} />
      ) : (
        <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-4">
          <CapabilityList
            rows={filtered}
            loading={list.loading}
            error={list.error}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRetry={() => void list.reload()}
          />
          <div className="min-w-0">
            {selected ? (
              <CapabilityWorkspace
                key={selected.capabilityId}
                capability={selected}
                tab={tab}
                onTabChange={setTab}
                capabilityWritable={capabilityWritable}
                bindingReadable={bindingReadable}
                bindingWritable={bindingWritable}
                pricingReadable={pricingReadable}
                pricingWritable={pricingWritable}
                revision={workspaceRevision}
                onChanged={() => void list.reload()}
              />
            ) : (
              <Panel title="能力">
                <EmptyState
                  title={
                    hasFilters
                      ? '没有符合当前筛选的能力或模型。'
                      : list.loading
                        ? '正在读取能力清单'
                        : '暂无能力'
                  }
                  description={
                    hasFilters
                      ? '换一个关键词或运行结论，也可以直接清除全部筛选。'
                      : '能力清单由后端能力定义提供，当前没有可展示的售卖单元。'
                  }
                  action={
                    hasFilters ? (
                      <ActionButton variant="secondary" size="sm" onClick={resetFilters}>
                        清除筛选
                      </ActionButton>
                    ) : undefined
                  }
                />
              </Panel>
            )}
          </div>
        </div>
      )}
    </AdminPage>
  );
}
