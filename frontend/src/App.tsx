import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCapabilities } from './hooks/useCapabilities';
import { Spin, Result, Button } from 'antd';
import { statsApi, toAbsoluteUrl } from './lib/api';
import type { StatsOverview } from './types/api';

/**
 * 路由级代码分割: 页面组件按需加载, 首屏只打入外壳 + 当前页。
 * 每个页面模块都是具名导出, 用 lazyNamed 适配 React.lazy 需要的 default 形态。
 */
function lazyNamed<T extends Record<string, ComponentType<any>>>(
  loader: () => Promise<T>,
  name: keyof T & string,
) {
  return lazy(() => loader().then((m) => ({ default: m[name] })));
}

const LoginPage = lazyNamed(() => import('./pages/LoginPage'), 'LoginPage');
const LandingPage = lazyNamed(() => import('./pages/LandingPage'), 'LandingPage');
const SitemapPage = lazyNamed(() => import('./pages/SitemapPage'), 'SitemapPage');
const LegalPage = lazyNamed(() => import('./pages/LegalPage'), 'LegalPage');
const WorkbenchPage = lazyNamed(() => import('./pages/WorkbenchPage'), 'WorkbenchPage');
const ProductKitPage = lazyNamed(() => import('./pages/ProductKitPage'), 'ProductKitPage');
const ProductDetailPage = lazyNamed(() => import('./pages/ProductDetailPage'), 'ProductDetailPage');
const ViralClonePage = lazyNamed(() => import('./pages/ViralClonePage'), 'ViralClonePage');
const FreeCreationPage = lazyNamed(() => import('./pages/FreeCreationPage'), 'FreeCreationPage');
const MultiFusionPage = lazyNamed(() => import('./pages/MultiFusionPage'), 'MultiFusionPage');
const ProductSkuPage = lazyNamed(() => import('./pages/ProductSkuPage'), 'ProductSkuPage');
const LocalRedrawPage = lazyNamed(() => import('./pages/LocalRedrawPage'), 'LocalRedrawPage');
const BackgroundRemovePage = lazyNamed(() => import('./pages/BackgroundRemovePage'), 'BackgroundRemovePage');
const WatermarkRemovePage = lazyNamed(() => import('./pages/WatermarkRemovePage'), 'WatermarkRemovePage');
const ProductRetouchPage = lazyNamed(() => import('./pages/ProductRetouchPage'), 'ProductRetouchPage');
const ImageTranslatePage = lazyNamed(() => import('./pages/ImageTranslatePage'), 'ImageTranslatePage');
const ImageExpandPage = lazyNamed(() => import('./pages/ImageExpandPage'), 'ImageExpandPage');
const ProductRecolorPage = lazyNamed(() => import('./pages/ProductRecolorPage'), 'ProductRecolorPage');
const RotateAnglePage = lazyNamed(() => import('./pages/RotateAnglePage'), 'RotateAnglePage');
const ToolPage = lazyNamed(() => import('./pages/ToolPage'), 'ToolPage');
const WorksPage = lazyNamed(() => import('./pages/WorksPage'), 'WorksPage');
const LibraryPage = lazyNamed(() => import('./pages/LibraryPage'), 'LibraryPage');
const StatsPage = lazyNamed(() => import('./pages/StatsPage'), 'StatsPage');
const InvitationsPage = lazyNamed(() => import('./pages/InvitationsPage'), 'InvitationsPage');
const PackagesPage = lazyNamed(() => import('./pages/PackagesPage'), 'PackagesPage');

/** 懒加载页面的统一兜底 (与 app-boot 同款居中骨架, 避免切页时闪烁空白) */
function RouteFallback() {
  return (
    <div className="app-boot">
      <Spin size="large" tip="加载页面…">
        <div style={{ width: 120, height: 120 }} />
      </Spin>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Shell() {
  const { data, loading, error } = useCapabilities();
  // 侧栏 hover 预览图与角标数量都来自真实的统计数据
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const location = useLocation();
  // 营销首页 / 站点索引 / 法务页走独立全宽外壳 (无侧栏), 与参考站一致
  const isBare =
    location.pathname === '/' ||
    location.pathname.startsWith('/sitemap.html') ||
    location.pathname.startsWith('/legal/');

  useEffect(() => {
    // 无侧栏的裸页面不消费统计 (侧栏预览/作品数), 无需发起这次请求
    if (isBare) return;
    let alive = true;
    statsApi
      .overview()
      .then((s) => {
        if (alive) setStats(s);
      })
      .catch((e: unknown) => {
        // 不静默吞错: 侧栏预览/作品数会退化为空态, 但失败原因必须可见
        console.warn('[shell] 统计数据加载失败, 侧栏预览与作品数回退为空', e);
        if (alive) setStats(null);
      });
    return () => {
      alive = false;
    };
  }, [isBare]);

  const thumbs = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const b of stats?.byCapability ?? []) {
      // 必须转绝对地址: sourceUrl 是 /uploads/... 相对路径, 渲染到别的容器/站点时会解析到错误的主机
      map[b.capability] = toAbsoluteUrl(b.thumbnailUrl) ?? null;
    }
    return map;
  }, [stats]);

  if (isBare) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/sitemap.html" element={<SitemapPage />} />
          <Route path="/legal/:slug" element={<LegalPage />} />
        </Routes>
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="app-boot">
        <Spin size="large" tip="加载能力清单…">
          <div style={{ width: 120, height: 120 }} />
        </Spin>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-boot">
        <Result
          status="warning"
          title="能力清单加载失败"
          subTitle={error ?? '无法连接后端服务，请确认 http://localhost:3001 已启动'}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <AppLayout
      groups={data.groups}
      items={data.items}
      thumbs={thumbs}
      statsTotal={stats?.totals.tasks ?? 0}
    >
      <ErrorBoundary resetKeys={[location.pathname]}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/workbench"
              element={
                <RequireAuth>
                  <WorkbenchPage workbenchIds={data.workbenchIds} groups={data.groups} />
                </RequireAuth>
              }
            />
            <Route
              path="/product-kit"
              element={
                <RequireAuth>
                  <ProductKitPage />
                </RequireAuth>
              }
            />
            <Route
              path="/product-detail"
              element={
                <RequireAuth>
                  <ProductDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/viral-clone"
              element={
                <RequireAuth>
                  <ViralClonePage />
                </RequireAuth>
              }
            />
            <Route
              path="/free-creation"
              element={
                <RequireAuth>
                  <FreeCreationPage />
                </RequireAuth>
              }
            />
            <Route
              path="/multi-image-fusion"
              element={
                <RequireAuth>
                  <MultiFusionPage />
                </RequireAuth>
              }
            />
            <Route
              path="/product-sku"
              element={
                <RequireAuth>
                  <ProductSkuPage />
                </RequireAuth>
              }
            />
            <Route
              path="/local-redraw"
              element={
                <RequireAuth>
                  <LocalRedrawPage />
                </RequireAuth>
              }
            />
            <Route
              path="/background-remove"
              element={
                <RequireAuth>
                  <BackgroundRemovePage />
                </RequireAuth>
              }
            />
            <Route
              path="/watermark-remove"
              element={
                <RequireAuth>
                  <WatermarkRemovePage />
                </RequireAuth>
              }
            />
            <Route
              path="/product-retouch"
              element={
                <RequireAuth>
                  <ProductRetouchPage />
                </RequireAuth>
              }
            />
            <Route
              path="/image-translate"
              element={
                <RequireAuth>
                  <ImageTranslatePage />
                </RequireAuth>
              }
            />
            <Route
              path="/image-expand"
              element={
                <RequireAuth>
                  <ImageExpandPage />
                </RequireAuth>
              }
            />
            <Route
              path="/product-recolor"
              element={
                <RequireAuth>
                  <ProductRecolorPage />
                </RequireAuth>
              }
            />
            <Route
              path="/rotate-angle"
              element={
                <RequireAuth>
                  <RotateAnglePage />
                </RequireAuth>
              }
            />
            <Route
              path="/tools/:capability"
              element={
                <RequireAuth>
                  <ToolPage />
                </RequireAuth>
              }
            />
            <Route
              path="/works"
              element={
                <RequireAuth>
                  <WorksPage />
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <LibraryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/stats"
              element={
                <RequireAuth>
                  <StatsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/invitations"
              element={
                <RequireAuth>
                  <InvitationsPage />
                </RequireAuth>
              }
            />
            {/* 积分商城: 参考站 /packages 挂在 workspace 外壳内, 需登录 */}
            <Route
              path="/packages"
              element={
                <RequireAuth>
                  <PackagesPage />
                </RequireAuth>
              }
            />
            {/* 参考站路径为 /my-works; /works 保留为等价别名, 两边都可直达 */}
            <Route
              path="/my-works"
              element={
                <RequireAuth>
                  <WorksPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/workbench" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Shell />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}
