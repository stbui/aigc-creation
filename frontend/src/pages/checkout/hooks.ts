/**
 * 结算页的 hooks / context 入口 —— 目录内文件的唯一 hook 来源。
 *
 * 本页没有自有 hook; 以后出现「只服务本页」的轮询或取数逻辑, 直接在本文件追加。
 *
 * 约定: `checkout/` 下的文件不从 `src/hooks` / `src/context` 直接取,
 * 一律经由本文件 —— 目录内新增依赖时在这里补一行 re-export。
 */

/** 余额变更通知: 支付成功 / 0 元领取后让顶导刷新积分 */
export { notifyCreditsChanged } from '../../context/CreditsContext';
