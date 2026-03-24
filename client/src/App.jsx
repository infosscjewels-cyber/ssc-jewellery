import { BrowserRouter, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
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

// Admin Protection
const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  return canAccessAdminDashboard(user) ? children : <Navigate to="/admin/login" replace />;
};

const RedirectAdminToDashboard = ({ children }) => {
  const { user } = useAuth();
  return shouldRedirectAdminToDashboard(user) ? <Navigate to="/admin/dashboard" replace /> : children;
};

const ClientRoute = ({ children, redirectTo = '/track-order' }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to={`/login?redirect=${encodeURIComponent(redirectTo)}`} replace />;
};

const StorefrontGate = ({ children }) => {
  return isStorefrontLaunchEnabled() ? children : <ComingSoon />;
};

// [UPDATED] Public Layout
// Changed 'pt-20 md:pt-24' to 'pt-[74px]'
// This perfectly matches the initial height of the Navbar (72px + border)
const PublicLayout = () => {
  const { user } = useAuth();
  const { companyInfo } = usePublicCompanyInfo();
  const tier = String(user?.loyaltyTier || 'regular').toLowerCase();
  const storefrontOpen = companyInfo?.storefrontOpen !== false;

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
      <main className="min-h-screen bg-secondary pt-[74px] pb-24 md:pb-0 tier-surface"> 
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
                  <GuestGoogleOneTap />
                  <PwaInstallPrompt />
                  <AppSeoDefaults />
                  <Suspense fallback={<RouteFallback />}>
                  <Routes>
              
              {/* Public Routes */}
              <Route element={<RedirectAdminToDashboard><StorefrontGate><PublicLayout /></StorefrontGate></RedirectAdminToDashboard>}>
                <Route path="/" element={<Home />} />
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
                <Route path="/checkout" element={<ClientRoute redirectTo="/checkout"><Checkout /></ClientRoute>} />
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
