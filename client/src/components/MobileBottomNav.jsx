import { useEffect, useRef, useState } from 'react';
import { Heart, Home, Package, ShoppingCart, User } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';

const TAB_TRANSFORM_HIDDEN = 'translateY(calc(100% + env(safe-area-inset-bottom, 0px) + 0.5rem))';
const TAB_TRANSFORM_VISIBLE = 'translateY(0)';

const getRedirectPath = (pathname = '/') => {
    if (!pathname || pathname.startsWith('/login')) return '/profile';
    return pathname;
};

const tabBaseClassName = 'group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 text-[11px] font-semibold tracking-wide transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.96] active:translate-y-0.5';
const HIDDEN_PATHS = new Set(['/checkout', '/payment/success', '/payment/failed']);

export default function MobileBottomNav() {
    const { user } = useAuth();
    const { itemCount, openCart, isOpen: isCartOpen } = useCart();
    const { wishlistCount } = useWishlist();
    const location = useLocation();
    const navigate = useNavigate();
    const navRef = useRef(null);
    const [isVisible, setIsVisible] = useState(false);
    const shouldHideNav = HIDDEN_PATHS.has(location.pathname);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleScroll = () => {
            setIsVisible(window.scrollY > 100);
        };

        handleScroll();
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    useEffect(() => {
        const navbar = navRef.current;
        if (!navbar) return;
        navbar.style.transform = (isVisible && !shouldHideNav) ? TAB_TRANSFORM_VISIBLE : TAB_TRANSFORM_HIDDEN;
    }, [isVisible, shouldHideNav]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.visualViewport) return undefined;

        const handleViewportResize = () => {
            const navbar = navRef.current;
            if (!navbar) return;
            navbar.style.bottom = '0px';
            void navbar.offsetHeight;
        };

        window.visualViewport.addEventListener('resize', handleViewportResize);
        window.visualViewport.addEventListener('scroll', handleViewportResize);
        return () => {
            window.visualViewport.removeEventListener('resize', handleViewportResize);
            window.visualViewport.removeEventListener('scroll', handleViewportResize);
        };
    }, []);

    const navigateProtected = (path) => {
        if (user) {
            navigate(path);
            return;
        }
        navigate(`/login?redirect=${encodeURIComponent(getRedirectPath(path))}`);
    };

    const tabs = [
        {
            key: 'home',
            label: 'Home',
            icon: Home,
            active: location.pathname === '/',
            onClick: null,
            to: '/'
        },
        {
            key: 'profile',
            label: 'Profile',
            icon: User,
            active: location.pathname === '/profile',
            onClick: () => navigateProtected('/profile')
        },
        {
            key: 'orders',
            label: 'Orders',
            icon: Package,
            active: location.pathname === '/orders' || location.pathname === '/track-order',
            onClick: () => navigateProtected('/orders')
        },
        {
            key: 'wishlist',
            label: 'Wishlist',
            icon: Heart,
            active: location.pathname === '/wishlist',
            badge: wishlistCount > 0 ? wishlistCount : null,
            onClick: () => navigateProtected('/wishlist')
        },
        {
            key: 'cart',
            label: 'Cart',
            icon: ShoppingCart,
            active: isCartOpen || location.pathname === '/cart' || location.pathname === '/checkout',
            badge: itemCount > 0 ? itemCount : null,
            onClick: () => openCart()
        }
    ];

    return (
        <div
            ref={navRef}
            className={`md:hidden fixed inset-x-0 bottom-0 z-[75] transition-transform duration-300 ease-out ${(isVisible && !shouldHideNav) ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ transform: TAB_TRANSFORM_HIDDEN }}
            aria-hidden={!isVisible || shouldHideNav}
        >
            <div
                className="pointer-events-auto flex w-full items-center gap-1 border-t border-white/70 bg-white/90 px-3 pt-1.5 pb-1 shadow-sm backdrop-blur-2xl"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.25rem)' }}
            >
                {tabs.map((tab) => {
                    const { key, label, active, badge, onClick, to } = tab;
                    const content = (
                        <>
                            <span
                                className={`absolute inset-x-1 inset-y-1 rounded-[22px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                                    active
                                        ? 'bg-slate-900/6 opacity-100 scale-100'
                                        : 'bg-transparent opacity-0 scale-90'
                                }`}
                            />
                            <span
                                className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-2xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                                    active
                                        ? 'bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.22)] scale-105'
                                        : 'bg-slate-100/70 text-slate-500 group-hover:bg-slate-200/80'
                                }`}
                            >
                                <tab.icon size={18} strokeWidth={2.1} />
                                {badge ? (
                                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-accent">
                                        {badge}
                                    </span>
                                ) : null}
                            </span>
                            <span className={`relative z-10 truncate transition-colors duration-300 ${active ? 'text-slate-900' : 'text-slate-500 group-hover:text-slate-700'}`}>{label}</span>
                        </>
                    );

                    if (to) {
                        return (
                            <Link key={key} to={to} className={tabBaseClassName}>
                                {content}
                            </Link>
                        );
                    }

                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={onClick}
                            className={tabBaseClassName}
                            aria-current={active ? 'page' : undefined}
                        >
                            {content}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
