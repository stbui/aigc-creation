import { createContext, useContext } from 'react';

/**
 * 列表密度偏好。
 *
 * 外壳左栏底部有一个密度开关（宽松 / 紧凑），选择存 localStorage。它影响的是
 * 所有后台表格的行高，而不是某一页 —— 所以放在 context 里由外壳下发，表格自己读，
 * 29 个页面不需要各传一次 prop。
 *
 * 表格仍然接受显式的 `density` prop：个别页面（例如把明细表嵌在抽屉里）需要固定
 * 紧凑，不受用户开关影响，那种情况下 prop 优先。
 */
export type Density = 'comfortable' | 'compact';

export const DensityContext = createContext<Density>('comfortable');

export function useDensity(): Density {
  return useContext(DensityContext);
}
