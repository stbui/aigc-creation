import { createContext, useContext } from 'react';

/**
 * 列表密度。
 *
 * 后台默认「宽松」档；个别页面（例如把明细表嵌在抽屉里）通过显式 `density` prop
 * 固定为紧凑。context 提供默认值，表格自己读，页面不需要各传一次 prop。
 */
export type Density = 'comfortable' | 'compact';

export const DensityContext = createContext<Density>('comfortable');

export function useDensity(): Density {
  return useContext(DensityContext);
}
