import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useLocation, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { ProductProvider } from './context/ProductContext';
import { CartProvider } from './context/CartContext';
import { CustomerProvider } from './context/CustomerContext';
import { ShippingProvider } from './context/ShippingContext';
import { OrderProvider } from './context/OrderContext';
import { WishlistProvider } from './context/WishlistContext';
import { useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';

// Components & Pages
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import FloatingWhatsApp from './components/FloatingWhatsApp';
import MobileBottomNav from './components/MobileBottomNav';
import CustomerCouponPopup from './components/CustomerCouponPopup';
import GuestGoogleOneTap from './components/GuestGoogleOneTap';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import AppSeoDefaults from './components/AppSeoDefaults';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import { usePublicCompanyInfo } from './hooks/usePublicSiteShell';
import ComingSoon from './pages/ComingSoon';
import { canAccessAdminDashboard, shouldRedirectAdminToDashboard } from './utils/authRoutePolicy';
import { BRAND_APPLE_TOUCH_ICON_URL, BRAND_FAVICON_URL, buildBrandAssetUrl } from './utils/branding.js';
import { clearGuestPreviewMode, isGuestPreviewMode } from './utils/authSession';
import { BUILD_VERSION } from './generated/buildInfo.js';
import { ArrowLeft, Eye } from 'lucide-react';

const Shop = lazy(() => import('./pages/Shop'));
const CategoryStore = lazy(() => import('./pages/CategoryStore'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const ProductPage = lazy(() => import('./pages/ProductPage'));
const Contact = lazy(() => import('./pages/Contact'));
const Profile = lazy(() => import('./pages/Profile'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Checkout = lazy(() => import('./pages/Checkout'));
const CartPage = lazy(() => import('./pages/CartPage'));
const Orders = lazy(() => import('./pages/Orders'));
const PaymentSuccess = lazy(() => import('./pages/PaymentSuccess'));
const PaymentFailed = lazy(() => import('./pages/PaymentFailed'));
const TrackOrder = lazy(() => import('./pages/TrackOrder'));
const PolicyPage = lazy(() => import('./pages/PolicyPage'));
const About = lazy(() => import('./pages/About'));
const SiteCredits = lazy(() => import('./pages/SiteCredits'));
const SitemapPage = lazy(() => import('./pages/SitemapPage'));
const Faq = lazy(() => import('./pages/Faq'));
const NotFound = lazy(() => import('./pages/NotFound'));
const StorefrontClosed = lazy(() => import('./pages/StorefrontClosed'));

const isStorefrontLaunchEnabled = () => {
  if (!import.meta.env.PROD) return true;
  const raw = String(import.meta.env.VITE_STOREFRONT_ENABLED || '').trim().toLowerCase();
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const RouteFallback = () => (
  <div className="min-h-[40vh] bg-secondary flex items-center justify-center px-4">
    <div className="rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 text-sm text-gray-500 shadow-sm">
      Loading page...
    </div>
  </div>
);

const BUILD_SYNC_RELOAD_KEY = 'app_build_reload_target_v1';
const BUILD_SYNC_LAST_SEEN_KEY = 'app_build_last_seen_v1';
const BUILD_SYNC_RELOAD_META_KEY = 'app_build_reload_meta_v1';
const BUILD_SYNC_MAX_RELOADS_PER_BUILD = 1;
const BUILD_SYNC_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

// Admin Protection
const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  return canAccessAdminDashboard(user) ? children : <Navigate to="/admin/login" replace />;
};

const RedirectAdminToDashboard = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  return shouldRedirectAdminToDashboard(user) && !isGuestPreviewMode() && !String(location.search || '').includes('preview=guest')
    ? <Navigate to="/admin/dashboard" replace />
    : children;
};

const ClientRoute = ({ children, redirectTo = '/track-order' }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to={`/login?redirect=${encodeURIComponent(redirectTo)}`} replace />;
};

const StorefrontGate = ({ children }) => {
  return isStorefrontLaunchEnabled() ? children : <ComingSoon />;
};

const LegacyStoreRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/shop${location.search}`} replace />;
};

const LegacyStoreCategoryRedirect = () => {
  const { category = '' } = useParams();
  const location = useLocation();
  return <Navigate to={`/shop/${encodeURIComponent(category)}${location.search}`} replace />;
};

// [UPDATED] Public Layout
// Changed 'pt-20 md:pt-24' to 'pt-[74px]'
// This perfectly matches the initial height of the Navbar (72px + border)
const PublicLayout = () => {
  const { user } = useAuth();
  const location = useLocation();
  const { companyInfo } = usePublicCompanyInfo();
  const tier = String(user?.loyaltyTier || 'regular').toLowerCase();
  const storefrontOpen = companyInfo?.storefrontOpen !== false;
  const guestPreview = isGuestPreviewMode() || String(location.search || '').includes('preview=guest');

  useEffect(() => {
    const tiers = ['regular', 'bronze', 'silver', 'gold', 'platinum'];
    document.body.classList.remove(...tiers.map((entry) => `tier-${entry}`));
    document.body.classList.add(`tier-${tiers.includes(tier) ? tier : 'regular'}`);
    return () => {
      document.body.classList.remove(...tiers.map((entry) => `tier-${entry}`));
      document.body.classList.add('tier-regular');
    };
  }, [tier]);

  useEffect(() => {
    const version = companyInfo?.updatedAt || '';
    const faviconHref = buildBrandAssetUrl(BRAND_FAVICON_URL, version);
    const appleHref = buildBrandAssetUrl(BRAND_APPLE_TOUCH_ICON_URL, version);

    const upsertLink = (selector, rel, href) => {
      if (!href) return;
      let link = document.head.querySelector(selector);
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', rel);
        document.head.appendChild(link);
      }
      link.setAttribute('href', href);
    };

    upsertLink('link[rel="icon"]', 'icon', faviconHref);
    upsertLink('link[rel="apple-touch-icon"]', 'apple-touch-icon', appleHref);
  }, [companyInfo?.updatedAt]);

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-secondary pb-32 md:pb-0 tier-surface"> 
        {guestPreview && (
          <div className="border-b border-sky-200 bg-sky-50 px-4 text-sm text-sky-900">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="inline-flex items-center gap-2 font-medium">
                <Eye size={16} />
                Previewing the storefront as a guest. Your admin session stays available in the other tab.
              </p>
              <button
                type="button"
                onClick={() => {
                  clearGuestPreviewMode();
                  window.location.href = '/admin/dashboard';
                }}
                className="inline-flex items-center gap-2 self-start rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100"
              >
                <ArrowLeft size={14} />
                Return to Admin
              </button>
            </div>
          </div>
        )}
        {!storefrontOpen && (
          <div className="border-b border-amber-200 bg-amber-50/95 px-4 text-sm text-amber-900">
            <div className="mx-auto flex min-h-[64px] max-w-7xl items-center justify-center py-4 text-center">
              <p className="leading-6 mb-0">
                Storefront is temporarily closed for new orders. Existing orders already placed will still be fulfilled.
              </p>
            </div>
          </div>
        )}
        <Outlet />
      </main>
      <FloatingWhatsApp />
      <MobileBottomNav />
      <CustomerCouponPopup />
      <Footer />
    </>
  );
};

function App() {
  const buildCheckInFlightRef = useRef(false);
  const [buildRefreshNotice, setBuildRefreshNotice] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const isStandalonePwa = () => {
      if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
      return Boolean(window.navigator?.standalone);
    };

    const isAdminRoute = () => String(window.location?.pathname || '').startsWith('/admin');
    const shouldShowBuildRefreshBanner = () => isAdminRoute() || isStandalonePwa();

    const readReloadMeta = () => {
      try {
        const raw = window.sessionStorage.getItem(BUILD_SYNC_RELOAD_META_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        return {
          targetBuildVersion: String(parsed.targetBuildVersion || '').trim(),
          attempts: Math.max(0, Number(parsed.attempts || 0)),
          lastAttemptAt: Math.max(0, Number(parsed.lastAttemptAt || 0))
        };
      } catch {
        return null;
      }
    };

    const writeReloadMeta = (value = null) => {
      try {
        if (!value) {
          window.sessionStorage.removeItem(BUILD_SYNC_RELOAD_META_KEY);
          return;
        }
        window.sessionStorage.setItem(BUILD_SYNC_RELOAD_META_KEY, JSON.stringify(value));
      } catch {
        // Ignore storage write failures; safety falls back to single-flight checks.
      }
    };

    try {
      if (window.sessionStorage.getItem(BUILD_SYNC_RELOAD_KEY) === BUILD_VERSION) {
        window.sessionStorage.removeItem(BUILD_SYNC_RELOAD_KEY);
      }
      const reloadMeta = readReloadMeta();
      if (reloadMeta?.targetBuildVersion === BUILD_VERSION) {
        writeReloadMeta(null);
      }
      window.localStorage.setItem(BUILD_SYNC_LAST_SEEN_KEY, BUILD_VERSION);
    } catch {
      // Ignore storage access issues and continue without version persistence.
    }

    const clearClientCachesForBuildRefresh = async () => {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
      }
      if ('caches' in window) {
        const keys = await window.caches.keys().catch(() => []);
        await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
      }
    };

    const checkForBuildMismatch = async () => {
      if (buildCheckInFlightRef.current) return;
      buildCheckInFlightRef.current = true;
      try {
        const res = await fetch(`/api/app/version?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({}));
        const serverBuildVersion = String(payload?.buildVersion || '').trim();
        if (!serverBuildVersion || serverBuildVersion === BUILD_VERSION) {
          setBuildRefreshNotice(null);
          try {
            window.localStorage.setItem(BUILD_SYNC_LAST_SEEN_KEY, BUILD_VERSION);
          } catch {}
          return;
        }

        let alreadyReloadedForTarget = false;
        try {
          alreadyReloadedForTarget = window.sessionStorage.getItem(BUILD_SYNC_RELOAD_KEY) === serverBuildVersion;
        } catch {}
        if (alreadyReloadedForTarget) return;

        const now = Date.now();
        const reloadMeta = readReloadMeta();
        const isSameTarget = reloadMeta?.targetBuildVersion === serverBuildVersion;
        const attempts = isSameTarget ? Math.max(0, Number(reloadMeta?.attempts || 0)) : 0;
        const lastAttemptAt = isSameTarget ? Math.max(0, Number(reloadMeta?.lastAttemptAt || 0)) : 0;
        const withinCooldown = lastAttemptAt > 0 && (now - lastAttemptAt) < BUILD_SYNC_RETRY_COOLDOWN_MS;
        if (attempts >= BUILD_SYNC_MAX_RELOADS_PER_BUILD || withinCooldown) {
          if (shouldShowBuildRefreshBanner()) {
            setBuildRefreshNotice({
              serverBuildVersion,
              buildLabel: String(payload?.buildLabel || '').trim() || serverBuildVersion
            });
          }
          return;
        }

        try {
          window.sessionStorage.setItem(BUILD_SYNC_RELOAD_KEY, serverBuildVersion);
        } catch {}
        writeReloadMeta({
          targetBuildVersion: serverBuildVersion,
          attempts: attempts + 1,
          lastAttemptAt: now
        });
        await clearClientCachesForBuildRefresh();
        window.location.reload();
      } catch {
        // Best-effort only; leave the current app running if version check fails.
      } finally {
        buildCheckInFlightRef.current = false;
      }
    };

    void checkForBuildMismatch();

    const handleFocus = () => {
      void checkForBuildMismatch();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForBuildMismatch();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleRefreshToLatestBuild = async () => {
    if (typeof window === 'undefined') return;
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
      }
      if ('caches' in window) {
        const keys = await window.caches.keys().catch(() => []);
        await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToastProvider>
        <AuthProvider>
            <SocketProvider>
          <ProductProvider>
              <OrderProvider>
                <CustomerProvider>
                  <ShippingProvider>
                    <WishlistProvider>
                    <CartProvider>
                  {buildRefreshNotice && (
                    <div className="fixed inset-x-0 top-0 z-[220] flex justify-center px-3 pt-3">
                      <div className="w-full max-w-2xl rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-lg backdrop-blur">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-amber-950">A newer version is available.</p>
                            <p className="text-xs text-amber-900/80">
                              Latest build: {buildRefreshNotice.buildLabel}. Refresh to load the updated app.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { void handleRefreshToLatestBuild(); }}
                            className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-950"
                          >
                            Refresh now
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <GuestGoogleOneTap />
                  <PwaInstallPrompt />
                  <AppSeoDefaults />
                  <Suspense fallback={<RouteFallback />}>
                  <Routes>
              
              {/* Public Routes */}
              <Route element={<RedirectAdminToDashboard><StorefrontGate><PublicLayout /></StorefrontGate></RedirectAdminToDashboard>}>
                <Route path="/" element={<Home />} />
                <Route path="/store" element={<LegacyStoreRedirect />} />
                <Route path="/store/:category" element={<LegacyStoreCategoryRedirect />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="/shop/:category" element={<CategoryStore />} />
                <Route path="/about" element={<About />} />
                <Route path="/site-credits" element={<SiteCredits />} />
                <Route path="/sitemap" element={<SitemapPage />} />
                <Route path="/faq" element={<Faq />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/profile" element={<ClientRoute redirectTo="/profile"><Profile /></ClientRoute>} />
                <Route path="/wishlist" element={<ClientRoute redirectTo="/wishlist"><Wishlist /></ClientRoute>} />
                <Route path="/orders" element={<ClientRoute redirectTo="/orders"><Orders /></ClientRoute>} />
                <Route
                  path="/track-order"
                  element={
                    <ClientRoute redirectTo="/track-order">
                      <TrackOrder />
                    </ClientRoute>
                  }
                />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/storefront-closed" element={<StorefrontClosed />} />
                <Route path="/payment/success" element={<PaymentSuccess />} />
                <Route path="/payment/failed" element={<PaymentFailed />} />
                <Route path="/terms" element={<PolicyPage />} />
                <Route path="/shipping" element={<PolicyPage />} />
                <Route path="/refund" element={<PolicyPage />} />
                <Route path="/privacy" element={<PolicyPage />} />
                <Route path="/copyright" element={<PolicyPage />} />
                {/* Product Details Route */}
                <Route path="/product/:id" element={<ProductPage />} />
              </Route>

              {/* Auth Pages (No Navbar) */}
              <Route path="/login" element={<RedirectAdminToDashboard><Login /></RedirectAdminToDashboard>} />
              <Route path="/register" element={<RedirectAdminToDashboard><Register /></RedirectAdminToDashboard>} />
              <Route path="/forgot-password" element={<RedirectAdminToDashboard><ForgotPassword /></RedirectAdminToDashboard>} />

              {/* Admin Routes */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route 
                path="/admin/dashboard" 
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                } 
              />

              <Route path="/coming-soon" element={<ComingSoon />} />
              <Route path="*" element={<NotFound />} />
                  </Routes>
                  </Suspense>
                    </CartProvider>
                    </WishlistProvider>
                  </ShippingProvider>
                </CustomerProvider>
              </OrderProvider>
          </ProductProvider>
            </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
