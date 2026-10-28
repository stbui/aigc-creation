import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminProvider } from './context/AdminContext';
import { CreditsProvider } from './context/CreditsContext';
import { AppLayout } from './components/AppLayout';
import { LoginModalHost } from './components/LoginModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExceptionPage, NotFoundPage } from './components/ExceptionPage';
import { useCapabilities } from './hooks/useCapabilities';
import { StateLoading } from './components/StateViews';
import { statsApi, toAbsoluteUrl } from './lib/api';
import type { StatsOverview } from './types/api';

/**
 * 2026-10-19「路由对外开放」: 移除 RequireAuth 包裹 —— 未登录用户可直接浏览
 * 工作台/工具页/素材库等壳内页面, 需要身份的动作一律唤起登录弹窗
 * (`useAuth().openLogin()`), 与参考站的「顶栏按钮 → 遮罩弹窗」同构。
 * `/login` 独立页保留为深链接兜底。
 */

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
// 通用 OAuth 回调完成页：provider 授权后回跳，用短时 ticket 换正式会话
const OAuthCallbackPage = lazyNamed(() => import('./pages/OAuthCallbackPage'), 'OAuthCallbackPage');
// 扫码登录确认页 (B8): 手机相机扫开二维码即进入, 裸外壳
const QrLoginPage = lazyNamed(() => import('./pages/QrLoginPage'), 'QrLoginPage');
// 找回/重置密码 (B2): 独立页, 与登录页同为裸卡布局
const ForgotPasswordPage = lazyNamed(
  () => import('./pages/ForgotPasswordPage'),
  'ForgotPasswordPage',
);
const ResetPasswordPage = lazyNamed(
  () => import('./pages/ResetPasswordPage'),
  'ResetPasswordPage',
);
const LandingPage = lazyNamed(() => import('./pages/LandingPage'), 'LandingPage');
const SitemapPage = lazyNamed(() => import('./pages/SitemapPage'), 'SitemapPage');
const LegalPage = lazyNamed(() => import('./pages/LegalPage'), 'LegalPage');
const WorkbenchPage = lazyNamed(() => import('./pages/WorkbenchPage'), 'WorkbenchPage');
const ProductKitPage = lazyNamed(() => import('./pages/ProductKitPage'), 'ProductKitPage');
const ProductDetailPage = lazyNamed(() => import('./pages/ProductDetailPage'), 'ProductDetailPage');
const ViralClonePage = lazyNamed(() => import('./pages/ViralClonePage'), 'ViralClonePage');
const FreeCreationPage = lazyNamed(() => import('./pages/FreeCreationPage'), 'FreeCreationPage');
const MobileUploadPage = lazyNamed(() => import('./pages/MobileUploadPage'), 'MobileUploadPage');
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
const CheckoutPage = lazyNamed(() => import('./pages/CheckoutPage'), 'CheckoutPage');
const CreditsPage = lazyNamed(() => import('./pages/CreditsPage'), 'CreditsPage');
const OrdersPage = lazyNamed(() => import('./pages/OrdersPage'), 'OrdersPage');
const AccountPage = lazyNamed(() => import('./pages/AccountPage'), 'AccountPage');
const TicketsPage = lazyNamed(() => import('./pages/TicketsPage'), 'TicketsPage');

// 后台管理端: 独立外壳与鉴权, 不走 C 端 Shell (侧栏/顶导/促销条均为 C 端语义)
const AdminShell = lazyNamed(() => import('./pages/admin/AdminDashboardPage'), 'AdminShell');

/** 懒加载页面的统一兜底 (与 app-boot 同款居中骨架, 避免切页时闪烁空白) */
function RouteFallback() {
  return (
    <div className="app-boot">
      <StateLoading tip="加载页面…" full />
    </div>
  );
}

function Shell() {
  const { token } = useAuth();
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
    // guest 不发: 统计接口需鉴权, 未登录时侧栏预览/作品数天然为空 (路由已对外开放)
    if (!token) {
      setStats(null);
      return;
    }
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
  }, [isBare, token]); // token 变化 = 登录成功/退出, 此时重新拉取统计

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

  /*
   * 能力清单只驱动导航与创作工具。账户/积分/订单/工单/套餐/结算这些页面
   * 不依赖它 —— 清单接口挂了不能让它们一起白屏 (曾整壳拦截)。
   */
  const capabilityIndependent =
    /^\/(account|credits|orders|tickets|packages|checkout)(\/|$)/.test(location.pathname);

  if (loading && !capabilityIndependent) {
    return (
      <div className="app-boot">
        <StateLoading tip="加载能力清单…" full />
      </div>
    );
  }

  if ((error || !data) && !capabilityIndependent) {
    return (
      <ExceptionPage
        kind="warning"
        fullScreen
        title="无法连接服务"
        desc="能力清单加载失败，工具暂时不可用。请确认后端已启动；若持续失败，可能是网络或服务状态异常。"
        detail={error ?? undefined}
        footnote={`默认后端地址 http://localhost:4100，如已改端口请检查 .env 的 VITE_API_BASE 配置。`}
        action={
          <button type="button" className="exc-btn is-primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        }
      />
    );
  }

  // 加载中 data/error 都还是 null，不能把「尚未返回」当成「加载失败」。
  // 账户/交易页会先渲染骨架并继续等清单返回，这里只在请求真正结束后告警。
  if (!loading && (error || !data) && capabilityIndependent) {
    console.warn('[shell] 能力清单加载失败，账户/交易页以无导航降级模式渲染', error);
  }

  const groups = data?.groups ?? [];
  const items = data?.items ?? [];
  const workbenchIds = data?.workbenchIds ?? [];

  return (
    <AppLayout
      groups={groups}
      items={items}
      thumbs={thumbs}
      statsTotal={stats?.totals.tasks ?? 0}
    >
      <ErrorBoundary resetKeys={[location.pathname]}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/workbench"
              element={
                  <WorkbenchPage workbenchIds={workbenchIds} groups={groups} />
              }
            />
            <Route
              path="/product-kit"
              element={
                  <ProductKitPage />
              }
            />
            <Route
              path="/product-detail"
              element={
                  <ProductDetailPage />
              }
            />
            <Route
              path="/viral-clone"
              element={
                  <ViralClonePage />
              }
            />
            <Route
              path="/free-creation"
              element={
                  <FreeCreationPage />
              }
            />
            <Route
              path="/multi-image-fusion"
              element={
                  <MultiFusionPage />
              }
            />
            <Route
              path="/product-sku"
              element={
                  <ProductSkuPage />
              }
            />
            <Route
              path="/local-redraw"
              element={
                  <LocalRedrawPage />
              }
            />
            <Route
              path="/background-remove"
              element={
                  <BackgroundRemovePage />
              }
            />
            <Route
              path="/watermark-remove"
              element={
                  <WatermarkRemovePage />
              }
            />
            <Route
              path="/product-retouch"
              element={
                  <ProductRetouchPage />
              }
            />
            <Route
              path="/image-translate"
              element={
                  <ImageTranslatePage />
              }
            />
            <Route
              path="/image-expand"
              element={
                  <ImageExpandPage />
              }
            />
            <Route
              path="/product-recolor"
              element={
                  <ProductRecolorPage />
              }
            />
            <Route
              path="/rotate-angle"
              element={
                  <RotateAnglePage />
              }
            />
            <Route
              path="/tools/:capability"
              element={
                  <ToolPage />
              }
            />
            <Route
              path="/works"
              element={
                  <WorksPage />
              }
            />
            <Route
              path="/library"
              element={
                  <LibraryPage />
              }
            />
            {/* 参考站路径为 /asset-library; /library 保留为等价别名, 两边都可直达 */}
            <Route
              path="/asset-library"
              element={
                  <LibraryPage />
              }
            />
            <Route
              path="/stats"
              element={
                  <StatsPage />
              }
            />
            <Route
              path="/invitations"
              element={
                  <InvitationsPage />
              }
            />
            {/* 积分商城: 参考站 /packages 挂在 workspace 外壳内, 需登录 */}
            <Route
              path="/packages"
              element={
                  <PackagesPage />
              }
            />
            {/* 交易链路: 结算 → 沙箱支付 → 积分明细 / 我的订单 */}
            <Route
              path="/checkout/:sku"
              element={
                  <CheckoutPage />
              }
            />
            <Route
              path="/credits"
              element={
                  <CreditsPage />
              }
            />
            <Route
              path="/orders"
              element={
                  <OrdersPage />
              }
            />
            {/* 账户自助: 资料 / 改密 / 数据导出 / 注销 (B4) */}
            <Route
              path="/account"
              element={
                  <AccountPage />
              }
            />
            {/* 我的工单 (B7): 站内消息里的 ticket_reply 通知直接链到这里 */}
            <Route
              path="/tickets"
              element={
                  <TicketsPage />
              }
            />
            {/* 参考站路径为 /my-works; /works 保留为等价别名, 两边都可直达 */}
            <Route
              path="/my-works"
              element={
                  <WorksPage />
              }
            />
            {/* 2026-10-20: 此前是 <Navigate to="/workbench" replace />, 未知 URL 被静默
                弹回工作台 —— 用户输错路径时分不清是「页面不存在」还是「页面坏了」。
                这与 AdminDashboardPage.tsx:288 自定的原则相悖, 现改为显式 404。
                已核对 tests/ 与 e2e/: 无任何用例依赖 catch-all 跳工作台。 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      {/* CreditsProvider 依赖 useAuth 的 token, 故必须包在 AuthProvider 内 */}
      <CreditsProvider>
      <BrowserRouter>
        {/* 登录弹窗宿主必须在 Router 之内: 卡片里的 useNavigate 依赖路由上下文。
            放在 AuthProvider 里 (Router 之外) 会让弹窗渲染即抛错、点登录毫无反应。 */}
        <LoginModalHost />
        {/* AdminProvider 包在 BrowserRouter 内: useAdmin 依赖 useAuth 的 token,
            路由切到 /admin 时才加载身份, 不影响 C 端首屏 */}
        <AdminProvider>
          <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                {/* OAuth provider 回调后的落地页（不经过 AppLayout） */}
                <Route path="/auth/oauth/callback" element={<OAuthCallbackPage />} />
                {/* 扫码登录的手机侧确认页 (B8): 二维码内容指向这里 */}
                <Route path="/qr-login" element={<QrLoginPage />} />
                {/* 找回 / 重置密码: 邮件链接直达, 不经过 AppLayout */}
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                {/* 手机端上传页: 扫码后打开的独立落地页。
                    ⚠️ 走**裸外壳**而非 AppLayout —— 手机屏幕窄, 且用户此刻
                    的任务只有"选一张图传回去"; 更重要的是它不该依赖能力清单
                    (useCapabilities), 否则后端未起时连传图都传不了。 */}
                <Route path="/mobile-upload" element={<MobileUploadPage />} />
                {/* ⚠ /admin/* 必须注册在下面那条 catch-all 之前,
                    否则会被 `path="*"` 吞进 C 端 Shell */}
                <Route path="/admin/*" element={<AdminShell />} />
                <Route path="*" element={<Shell />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </AdminProvider>
      </BrowserRouter>
          </CreditsProvider>
</AuthProvider>
  );
}
