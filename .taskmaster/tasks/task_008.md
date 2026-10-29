# Task ID: 8

**Title:** 后台模型线路页改版

**Status:** pending

**Dependencies:** 3, 6, 7

**Priority:** high

**Description:** 线路页展示 channels|none 来源横幅，新增权重/并发/限流/健康/最近测试列、冷却倒计时、恢复熔断与 CSV 导出；编辑器做模态-协议联动、协议只列已实现项、token 只写不回显。

**Details:**

落点：frontend/src/pages/admin/modelConfig/ChannelManagementTab.tsx、ChannelTable.tsx、ChannelEditDrawer.tsx、ChannelHealthCard.tsx、useModelConfigDraft.ts、AdminModelConfigPage.tsx。遵循 antd 原生组件、adminNav 与权限点、global.css token；不做移动端。导出走 common/csv.ts，排除 token 明文。

**Test Strategy:**

组件测试覆盖来源横幅/健康状态/恢复确认；e2e 创建-编辑-测试-恢复-导出；无 channel.route 时写按钮隐藏且接口仍拒绝；页面不出现 legacy/固化入口；导出无 token。
