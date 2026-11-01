/**
 * 渠道 / 渠道模型排序的纯函数（无副作用）。
 *
 * ## 为什么排序要走「expectedIds」而不是直接写 sortOrder
 *
 * 排序是**共享状态**：两个运营同时打开排序弹窗，谁后保存谁覆盖谁。
 * 后端 `PUT /admin/channels/order` 的做法是「客户端提交它读到的原始顺序
 * （`expectedIds`）+ 新顺序（`ids`）」，服务端比对当前库里的顺序：
 * 不一致就整单拒绝（`ChannelOrderChangedError` → HTTP 409）。
 *
 * 这样不会出现「A 拖到一半，B 保存，C 保存，把 A 的调整悄悄吞掉」——
 * A 保存时会拿到明确报错，被要求重新加载。
 *
 * ## 排序值由服务端重排
 *
 * 保存后服务端把 `sortOrder` 重写为 0,1,2…（见 `saveChannelOrder`），
 * 所以前端只需要提交 id 顺序，不需要自己算 `sortOrder` 间隔。
 */

/** 排序列表项（渠道或渠道模型） */
export interface OrderItem {
  id: string;
  name: string;
  enabled: boolean;
}

/**
 * 把 `id` 移到第 `target` 位（0 起）。
 *
 * 越界、找不到、原地不动都返回原数组（引用不变）—— 调用方可以直接把返回值
 * 塞进 state，不需要额外判断。
 */
export function moveOrderItem<T extends { id: string }>(items: T[], id: string, target: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0 || !Number.isInteger(target) || target < 0 || target >= items.length || from === target) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * 顺序是否真的变了。
 *
 * 保存按钮的启用条件。逐项比对 id 序列 —— 只比长度不够（换位后长度不变）。
 */
export function orderChanged(items: OrderItem[], originalIds: string[]): boolean {
  if (items.length !== originalIds.length) return true;
  return items.some((item, index) => item.id !== originalIds[index]);
}
