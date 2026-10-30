/**
 * 后台外壳切换开关。
 *
 * `VITE_ADMIN_UI=legacy` 整站回滚到 antd 外壳；缺省或任何其它值都走 BoardUI。
 * 默认必须是 boardui —— 回滚是应急动作，不能因为漏配一个环境变量就让新外壳
 * 在开发档失效。
 *
 * 读取点只有两处：外壳本身（AdminDashboardPage）与共享控件（PageHeader /
 * AdminWidgets）。页面级组件不直接读这个开关，一律消费共享控件，否则回滚时
 * 会出现「外壳是旧的、页面里混着新控件」的中间态。
 */
export const USE_BOARDUI_ADMIN = import.meta.env.VITE_ADMIN_UI !== 'legacy';
