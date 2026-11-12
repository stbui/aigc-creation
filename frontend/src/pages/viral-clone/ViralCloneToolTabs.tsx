import { useNavigate } from 'react-router-dom';

import { NavigationTabs, NavigationTabsList, NavigationTabsTrigger } from './components';

/**
 * 业务类型切换 tab。
 *
 * 参考站只在窄屏显示这组 tab（桌面端 `display: none` 实拍确认），
 * 所以这里保持相同的 DOM 顺序与类名，显隐交给 `pk-editor-tabs` 的样式。
 */
export function ViralCloneToolTabs() {
  const navigate = useNavigate();

  return (
    <NavigationTabs
      value="viral-clone"
      onValueChange={(value) => {
        if (value === 'product-kit') navigate('/product-kit');
        if (value === 'product-detail') navigate('/product-detail');
      }}
      className="vc-editor-tabs"
      aria-label="业务类型"
    >
      <NavigationTabsList className="grid w-full grid-cols-3">
        <NavigationTabsTrigger value="product-kit">商品主图</NavigationTabsTrigger>
        <NavigationTabsTrigger value="product-detail">商品详情</NavigationTabsTrigger>
        <NavigationTabsTrigger value="viral-clone">爆款复刻</NavigationTabsTrigger>
      </NavigationTabsList>
    </NavigationTabs>
  );
}
