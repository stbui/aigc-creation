import { ActionButton, Descriptions, Drawer, Notice, StatusTag } from './components';
import { contributionText } from './constants';
import type { PluginView } from '../../../types/model';

/**
 * 插件详情。
 *
 * 「清单入库 ≠ 本环境会执行它」必须写在页面上：不可用的原因比一个灰色的
 * 「不可用」标签更能阻止误判。
 */
export function PluginDetailDrawer({
  plugin,
  onClose,
}: {
  plugin: PluginView | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={plugin !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={680}
      title={plugin ? `${plugin.name} · ${plugin.id}` : '插件详情'}
      description={
        plugin
          ? `v${plugin.version} · ${plugin.vendor || '未知厂商'} · API ${plugin.apiVersion}`
          : undefined
      }
      footer={
        <ActionButton variant="secondary" size="sm" onClick={onClose}>
          关闭
        </ActionButton>
      }
    >
      {plugin && (
        <div className="flex flex-col gap-4">
          <Descriptions
            items={[
              { label: '状态', value: plugin.enabled ? '启用' : '停用' },
              { label: '生效协议数', value: String(plugin.activeProtocols) },
              { label: '来源', value: plugin.source },
              { label: '可安装', value: plugin.installable ? '是' : '否（随代码入库）' },
              {
                label: '运行时',
                value: `backend ${plugin.runtime.backend} · web ${plugin.runtime.web}`,
              },
              {
                label: '当前环境',
                value: plugin.availability?.available ? '可用' : '不可用',
              },
              {
                label: '最近更新',
                value: plugin.updatedAt
                  ? new Date(plugin.updatedAt).toLocaleString('zh-CN')
                  : '—',
              },
            ]}
            columns={2}
          />

          {/* 不可用原因必须说清楚：清单入库 ≠ 本环境会执行它 */}
          {!plugin.availability?.available && plugin.availability?.reason && (
            <Notice tone="warn" title="当前环境不可用">
              {plugin.availability.reason}
            </Notice>
          )}

          {plugin.description && (
            <p className="text-xs leading-5 text-muted-foreground">{plugin.description}</p>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold text-foreground">Provider</div>
            <table className="w-full text-[12px]">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">ID</th>
                  <th className="px-2 py-1.5 text-left">名称</th>
                  <th className="px-2 py-1.5 text-left">能力</th>
                  <th className="px-2 py-1.5 text-left">注册</th>
                </tr>
              </thead>
              <tbody>
                {plugin.providers.map((provider) => (
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
            {plugin.configuration.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">该插件没有声明配置项。</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {plugin.configuration.map((field) => (
                  <li
                    key={field.name}
                    className="rounded-lg border border-border px-2.5 py-2 text-[12px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-foreground">{field.name}</span>
                      <span className="text-muted-foreground">{field.type}</span>
                      {field.required && (
                        <StatusTag status="required" tone="warn" label="必填" />
                      )}
                      {field.secret && (
                        <StatusTag status="secret" tone="muted" label="密钥" />
                      )}
                    </div>
                    {field.label && (
                      <div className="mt-0.5 text-muted-foreground">{field.label}</div>
                    )}
                    {field.description && (
                      <div className="text-muted-foreground">{field.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Descriptions
            items={[
              { label: '贡献', value: contributionText(plugin) },
              { label: '界面位置', value: plugin.surfaces.join(', ') || '—' },
              { label: '权限', value: plugin.permissions.join(', ') || '—' },
              {
                label: '最近校验',
                value: plugin.verify
                  ? `${plugin.verify.ok ? '通过' : '未通过'} · ${new Date(plugin.verify.checkedAt).toLocaleString('zh-CN')}${plugin.verify.reason ? ` · ${plugin.verify.reason}` : ''}`
                  : '未校验',
              },
            ]}
            columns={2}
          />

          {plugin.verify && !plugin.verify.ok && (
            <Notice tone="danger" title="最近一次契约校验未通过">
              {plugin.verify.reason || '原因未记录'}
            </Notice>
          )}

          {!plugin.enabled && (
            <Notice tone="warn" title="插件已停用">
              该插件的协议不在注册表中；引用这些协议的渠道模型在调用时会失败（任务失败并退款）。
            </Notice>
          )}
        </div>
      )}
    </Drawer>
  );
}
