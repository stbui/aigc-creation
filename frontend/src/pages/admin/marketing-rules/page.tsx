import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AdminPage,
  AdminTabs,
  TabsContent,
} from '~/admin-ui/primitives';
import { CheckinRecordsTab } from './CheckinRecordsTab';
import { InviteRelationsTab } from './InviteRelationsTab';
import { MarketingRulesTab } from './MarketingRulesTab';
import { TAB_OPTIONS } from './constants';
import { useAdmin, useRuleDrafts, useUnsavedGuard } from './hooks';
import { resolveTab } from './utils';

/**
 * 邀请分销与签到（`/admin/marketing-rules`）：规则 (B-66 / B-67) + 两张流水表。
 *
 * 三个标签：规则配置 / 邀请关系 / 签到记录。规则是**配置**（全局各一条，表单
 * 直接改），另两块是**流水**（只能查、只能对账）。放在一起是因为它们共用同一套
 * 营销口径：运营改完「奖励多少分」，下一步就是查这笔钱该发给了谁、实际发出去
 * 多少。缺了流水，规则页就只是一张改完即忘的表单。
 *
 * **URL 是标签的事实源**：`?tab=` 决定显示哪个标签，前进后退能正确回到上一个
 * 标签；两张列表各自的筛选也写在同一个 URL 上，刷新可复原。
 *
 * 规则草稿是**页面级**状态（见 `useRuleDrafts`）：标签未激活时表单组件不挂载，
 * 草稿若留在表单里，切去查一次邀请关系回来就静默丢了未保存的修改。
 */
export function AdminMarketingRulesPage() {
  const { can } = useAdmin();
  const writable = can('marketing.write');
  const drafts = useRuleDrafts();

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get('tab'));

  const switchTab = useCallback(
    (next: string) => {
      if (!TAB_OPTIONS.some((item) => item.value === next)) return;
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useUnsavedGuard(writable && drafts.dirty);

  return (
    <AdminPage
      title="邀请与签到"
      description="邀请分销与每日签到的积分规则，以及邀请关系、签到记录两张流水表。规则保存后立即生效，已发放的积分不受影响。"
      actions={
        !writable ? (
          <span className="text-[12px] text-muted-foreground">
            当前账号无 marketing.write 权限，仅可查看
          </span>
        ) : undefined
      }
    >
      <AdminTabs value={tab} onValueChange={switchTab} items={TAB_OPTIONS} ariaLabel="邀请与签到标签">

        {/*
         * 标签未激活时不挂载（Radix 默认）：进页只发两次规则请求，不必并发
         * 拉两张流水表。规则表单反过来常驻页面状态，见上面的草稿说明。
         */}
        <TabsContent value="rules">
          <MarketingRulesTab writable={writable} drafts={drafts} />
        </TabsContent>
        <TabsContent value="invites">
          <InviteRelationsTab />
        </TabsContent>
        <TabsContent value="checkins">
          <CheckinRecordsTab />
        </TabsContent>
      </AdminTabs>
    </AdminPage>
  );
}
