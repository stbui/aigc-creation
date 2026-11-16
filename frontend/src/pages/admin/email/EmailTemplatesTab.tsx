import { ActionButton, Notice } from './components';
import { EmailTemplatesPanel } from './EmailTemplatesPanel';

/**
 * 「邮件模板」分区。
 *
 * 模板保存即时生效，投递配置却要回上一个分区单独保存 —— 两种生效时机混在同一
 * 页面上，必须在这里明说，否则用户会以为当前未保存的投递改动也一起提交了。
 */
export function EmailTemplatesTab({
  dirtyCount,
  canManage,
  onChangeTab,
}: {
  dirtyCount: number;
  canManage: boolean;
  onChangeTab: (tab: string) => void;
}) {
  return (
    <>
      {dirtyCount > 0 ? (
        <Notice tone="warn" title={`投递配置有 ${dirtyCount} 项修改未保存`} className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>邮件模板保存后即时生效；投递配置需返回对应分区保存，否则本次修改不会生效。</span>
            <ActionButton
              variant="outline"
              size="xs"
              onClick={() => onChangeTab('delivery')}
            >
              返回投递配置
            </ActionButton>
          </div>
        </Notice>
      ) : null}
      <EmailTemplatesPanel canManage={canManage} />
    </>
  );
}
