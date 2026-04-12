import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { adminService } from '../../services/adminService';
import { useAuth } from '../../context/AuthContext';
import {
    Archive,
    Ban,
    Calendar,
    Download,
    Loader2,
    Mail,
    Phone,
    Plus,
    Search,
    SlidersHorizontal,
    ShoppingCart,
    Sparkles,
    TicketPercent,
    Trash2,
    Users,
    X
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import Modal from '../../components/Modal';
import AddCustomerModal from '../../components/AddCustomerModal';
import { useCustomers } from '../../context/CustomerContext';
import { formatAdminDate, formatAdminDateTime } from '../../utils/dateFormat';
import { formatTierLabel, TIER_ORDER } from '../../utils/tierFormat';
import { billingAddressEnabled } from '../../utils/billingAddressConfig';
import customerIllustration from '../../assets/customer.svg';
import EmptyState from '../../components/EmptyState';
import TierBadge from '../../components/TierBadge';
import WhatsAppIcon from '../../components/WhatsAppIcon';

const CUSTOMER_PAGE_SIZE = 20;
const MAX_COUPON_RANGE_DAYS = 90;
const CUSTOMER_TIER_FILTER_OPTIONS = [
    { value: 'all', label: 'All Tiers' },
    ...TIER_ORDER.map((tier) => ({ value: tier, label: formatTierLabel(tier) }))
];
const getTodayDateInput = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};
const toDateOnly = (value) => {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const addDaysToInput = (value, days) => {
    const date = toDateOnly(value);
    if (!date) return '';
    const copy = new Date(date);
    copy.setDate(copy.getDate() + Number(days || 0));
    const local = new Date(copy.getTime() - copy.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};
const buildCouponCodeDraft = (prefix = 'SSC') => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = (len = 4) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const seed = `${String(prefix || 'SSC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SSC'}-${part(4)}-${part(4)}`;
    return seed.slice(0, 15);
};
const sanitizeCouponCode = (value = '') => String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 15);

const buildVisiblePages = (currentPage, totalPages, windowSize = 4) => {
    const safeTotal = Math.max(1, Number(totalPages || 1));
    const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage || 1)));
    if (safeTotal <= windowSize) return Array.from({ length: safeTotal }, (_, idx) => idx + 1);
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, safeCurrent - half);
    let end = Math.min(safeTotal, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
};

const getWhatsappLink = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return null;
    const full = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${full}`;
};

const getCallLink = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    return digits ? `tel:${digits}` : null;
};

const isBirthdayToday = (dob) => {
    if (!dob) return false;
    const [_, month, day] = String(dob).split('T')[0].split('-');
    if (!month || !day) return false;
    const now = new Date();
    return Number(month) === now.getMonth() + 1 && Number(day) === now.getDate();
};

const tierLabel = (tier = 'regular') => formatTierLabel(tier);
const getCustomerProfileImage = (user = {}) => {
    return String(
        user?.profileImage
        || user?.profile_image
        || user?.avatar
        || user?.avatar_url
        || ''
    ).trim();
};
const formatLongDate = (value) => {
    if (!value) return 'No expiry';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No expiry';
    const day = date.getDate();
    const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const year = date.getFullYear();
    return `${day}${suffix} ${month} ${year}`;
};
const formatCouponOffer = (coupon = {}) => {
    const type = String(coupon.discountType || coupon.discount_type || '').toLowerCase();
    const value = Number(coupon.discountValue ?? coupon.discount_value ?? 0);
    if (type === 'fixed') return `₹${value.toLocaleString('en-IN')} off`;
    if (type === 'shipping_full') return 'Free shipping';
    if (type === 'shipping_partial') return `${value}% shipping off`;
    return `${value}% off`;
};
const canDeleteCouponFromDrawer = (coupon = {}) => {
    const sourceType = String(coupon.sourceType || coupon.source_type || '').toLowerCase();
    if (sourceType === 'abandoned') return true;
    const scopeType = String(coupon.scopeType || coupon.scope_type || '').toLowerCase();
    return scopeType === 'customer';
};
const getCartLastActivityLabel = (user = {}) => {
    const raw = user?.abandoned_cart_last_activity_at || user?.abandonedCartLastActivityAt || '';
    if (!raw) return '';
    const formatted = formatAdminDateTime(raw);
    return formatted === '—' ? '' : formatted;
};
const MOBILE_CARD_THEMES = [
    {
        shell: 'border-sky-200 bg-gradient-to-br from-white via-sky-50/60 to-cyan-50/70 shadow-sky-100/70',
        strip: 'from-sky-400 via-cyan-400 to-sky-300',
        avatar: 'bg-sky-100 text-sky-900 ring-sky-200',
        contactIcon: 'bg-sky-100 text-sky-700',
        emailIcon: 'bg-fuchsia-100 text-fuchsia-700',
        divider: 'border-sky-100',
        section: 'bg-sky-50/80 text-sky-800 border-sky-100',
        cartNote: 'border-sky-200 bg-sky-50 text-sky-800'
    },
    {
        shell: 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/60 to-lime-50/70 shadow-emerald-100/70',
        strip: 'from-emerald-400 via-lime-400 to-emerald-300',
        avatar: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
        contactIcon: 'bg-emerald-100 text-emerald-700',
        emailIcon: 'bg-lime-100 text-lime-700',
        divider: 'border-emerald-100',
        section: 'bg-emerald-50/80 text-emerald-800 border-emerald-100',
        cartNote: 'border-emerald-200 bg-emerald-50 text-emerald-800'
    },
    {
        shell: 'border-fuchsia-200 bg-gradient-to-br from-white via-fuchsia-50/55 to-rose-50/70 shadow-fuchsia-100/70',
        strip: 'from-fuchsia-400 via-pink-400 to-rose-300',
        avatar: 'bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-200',
        contactIcon: 'bg-fuchsia-100 text-fuchsia-700',
        emailIcon: 'bg-rose-100 text-rose-700',
        divider: 'border-fuchsia-100',
        section: 'bg-fuchsia-50/80 text-fuchsia-800 border-fuchsia-100',
        cartNote: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800'
    },
    {
        shell: 'border-amber-200 bg-gradient-to-br from-white via-amber-50/60 to-orange-50/70 shadow-amber-100/70',
        strip: 'from-amber-400 via-orange-400 to-amber-300',
        avatar: 'bg-amber-100 text-amber-900 ring-amber-200',
        contactIcon: 'bg-amber-100 text-amber-700',
        emailIcon: 'bg-orange-100 text-orange-700',
        divider: 'border-amber-100',
        section: 'bg-amber-50/80 text-amber-800 border-amber-100',
        cartNote: 'border-amber-200 bg-amber-50 text-amber-800'
    }
];
const MOBILE_CUSTOMER_THEME_BY_KEY = {
    blue: MOBILE_CARD_THEMES[0],
    green: MOBILE_CARD_THEMES[1],
    rose: MOBILE_CARD_THEMES[2],
    orange: MOBILE_CARD_THEMES[3]
};

const getMobileCustomerCardTheme = (user = {}) => {
    const hasMobile = Boolean(String(user?.mobile || '').trim());
    const hasEmail = Boolean(String(user?.email || '').trim());
    const hasActiveCart = Number(user?.cart_count ?? 0) > 0;
    const isTieredCustomer = String(user?.loyaltyTier || 'regular').toLowerCase() !== 'regular';

    if (!hasMobile) return MOBILE_CUSTOMER_THEME_BY_KEY.orange;
    if (hasActiveCart) return MOBILE_CUSTOMER_THEME_BY_KEY.green;
    if (hasMobile && hasEmail) return MOBILE_CUSTOMER_THEME_BY_KEY.blue;
    if (isTieredCustomer) return MOBILE_CUSTOMER_THEME_BY_KEY.rose;
    return MOBILE_CUSTOMER_THEME_BY_KEY.green;
};

export default function Customers({
    onCreateOrderForCustomer,
    focusCustomerId = null,
    onFocusCustomerHandled = () => {}
}) {
    const { users, loading: isLoading, refreshUsers } = useCustomers();
    const { user: currentUser } = useAuth();
    const toast = useToast();

    const [searchTerm, setSearchTerm] = useState('');
    const [tierFilter, setTierFilter] = useState('all');
    const [birthdayOnly, setBirthdayOnly] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [page, setPage] = useState(1);
    const [isMobileBirthdayModalOpen, setIsMobileBirthdayModalOpen] = useState(false);
    const [isMobileTierModalOpen, setIsMobileTierModalOpen] = useState(false);
    const [isMobileSearchModalOpen, setIsMobileSearchModalOpen] = useState(false);

    const [modalConfig, setModalConfig] = useState({ isOpen: false, type: 'default', title: '', message: '', targetUser: null });
    const [customerDeleteChoice, setCustomerDeleteChoice] = useState({ isOpen: false, targetUser: null });
    const [addModalRole, setAddModalRole] = useState(null);
    const [isActionLoading, setIsActionLoading] = useState(false);

    const [selectedUser, setSelectedUser] = useState(null);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [cartItems, setCartItems] = useState([]);
    const [isCartLoading, setIsCartLoading] = useState(false);
    const [activeCoupons, setActiveCoupons] = useState([]);
    const [activeCouponsLoading, setActiveCouponsLoading] = useState(false);

    const [couponModalUser, setCouponModalUser] = useState(null);
    const [couponSaving, setCouponSaving] = useState(false);
    const [couponDeletingId, setCouponDeletingId] = useState(null);
    const [couponDeleteLoading, setCouponDeleteLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [couponDeleteConfirm, setCouponDeleteConfirm] = useState({
        isOpen: false,
        userId: null,
        couponId: null,
        couponCode: ''
    });
    const [couponForm, setCouponForm] = useState({
        code: buildCouponCodeDraft(),
        name: '',
        discountType: 'percent',
        discountValue: 5,
        maxDiscountValue: 1000,
        minCartValue: 0,
        usageLimitPerUser: 1,
        startsAt: getTodayDateInput(),
        expiresAt: ''
    });
    const [cartCountOverrides, setCartCountOverrides] = useState({});

    useEffect(() => {
        refreshUsers(false);
    }, [refreshUsers]);

    const handleArchivedToggle = useCallback(() => {
        const nextShowArchived = !showArchived;
        setShowArchived(nextShowArchived);
        refreshUsers(true, { archiveMode: nextShowArchived ? 'archived' : 'active' }).catch((error) => {
            toast.error(error?.message || 'Failed to refresh customers');
        });
    }, [refreshUsers, showArchived, toast]);

    useAdminCrudSync({
        'coupon:changed': async (payload = {}) => {
            await refreshUsers(true);
            if (selectedUser?.id) {
                const affectedUserId = payload?.userId ? String(payload.userId) : null;
                if (!affectedUserId || affectedUserId === String(selectedUser.id)) {
                    try {
                        setActiveCouponsLoading(true);
                        const data = await adminService.getUserActiveCoupons(selectedUser.id);
                        setActiveCoupons(Array.isArray(data?.coupons) ? data.coupons : []);
                    } catch (error) {
                        toast.error(error?.message || 'Failed to load active coupons');
                    } finally {
                        setActiveCouponsLoading(false);
                    }
                }
            }
        }
    });

    const canDeleteUser = (targetUser) => {
        if (!currentUser) return false;
        if (String(targetUser.role || '').toLowerCase() === 'customer') {
            return currentUser.role === 'admin' || currentUser.role === 'staff';
        }
        if (currentUser.role === 'admin' && targetUser.role !== 'admin') return true;
        return false;
    };

    const customersOnly = useMemo(
        () => users.filter((u) => !u.role || u.role === 'customer'),
        [users]
    );

    const archivedCustomerCount = useMemo(
        () => customersOnly.filter((u) => u.isArchived).length,
        [customersOnly]
    );

    const filteredCustomers = useMemo(() => {
        let rows = customersOnly.filter((u) => (showArchived ? u.isArchived : !u.isArchived));
        const term = String(searchTerm || '').trim().toLowerCase();
        if (term) {
            rows = rows.filter((u) =>
                String(u.name || '').toLowerCase().includes(term)
                || String(u.mobile || '').includes(term)
                || String(u.email || '').toLowerCase().includes(term)
            );
        }
        if (tierFilter !== 'all') {
            rows = rows.filter((u) => String(u.loyaltyTier || 'regular').toLowerCase() === tierFilter);
        }
        if (birthdayOnly) {
            rows = rows.filter((u) => isBirthdayToday(u.dob));
        }
        return rows;
    }, [customersOnly, showArchived, searchTerm, tierFilter, birthdayOnly]);

    const customerTotalPages = useMemo(
        () => Math.max(1, Math.ceil(filteredCustomers.length / CUSTOMER_PAGE_SIZE)),
        [filteredCustomers.length]
    );

    const paginatedCustomersOnly = useMemo(() => {
        const start = (Math.max(1, Number(page || 1)) - 1) * CUSTOMER_PAGE_SIZE;
        return filteredCustomers.slice(start, start + CUSTOMER_PAGE_SIZE);
    }, [filteredCustomers, page]);

    const visiblePages = useMemo(
        () => buildVisiblePages(page, customerTotalPages, 4),
        [customerTotalPages, page]
    );

    useEffect(() => {
        setPage(1);
    }, [searchTerm, tierFilter, birthdayOnly, showArchived]);

    useEffect(() => {
        setPage((prev) => Math.min(Math.max(1, Number(prev || 1)), customerTotalPages));
    }, [customerTotalPages]);

    useEffect(() => {
        if (!selectedUser?.id) return;
        const latest = users.find((entry) => String(entry.id) === String(selectedUser.id));
        if (latest) {
            setSelectedUser((prev) => ({ ...prev, ...latest }));
        }
    }, [users, selectedUser?.id]);

    const handleAddUser = async (userData) => {
        const payload = { ...userData, role: addModalRole };
        await adminService.createUser(payload);
        await refreshUsers(true);
        setAddModalRole(null);
        toast.success('Customer added successfully');
    };

    const handleExportCustomers = async () => {
        setIsExporting(true);
        try {
            await adminService.exportCustomers();
            toast.success('Customer export started');
        } catch (error) {
            toast.error(error?.message || 'Failed to export customers');
        } finally {
            setIsExporting(false);
        }
    };

    const openDeleteModal = (user) => {
        const isCustomer = String(user.role || '').toLowerCase() === 'customer';
        if (isCustomer) {
            setCustomerDeleteChoice({ isOpen: true, targetUser: user });
            return;
        }
        setModalConfig({
            isOpen: true,
            type: 'delete',
            title: 'Delete User?',
            message: `Are you sure you want to remove ${user.name}?`,
            targetUser: user
        });
    };

    const handleDeactivateCustomer = async (targetUser) => {
        if (!targetUser?.id) return;
        setIsActionLoading(true);
        try {
            await adminService.setUserStatus(targetUser.id, {
                isActive: false,
                reason: 'Deactivated by admin'
            });
            await refreshUsers(true);
            setCustomerDeleteChoice({ isOpen: false, targetUser: null });
            toast.success('Customer deactivated successfully');
        } catch (error) {
            toast.error(error?.message || 'Unable to deactivate customer');
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleArchiveCustomer = async (targetUser) => {
        if (!targetUser?.id) return;
        setIsActionLoading(true);
        try {
            await adminService.setUserArchiveStatus(targetUser.id, {
                isArchived: true,
                reason: 'Archived by admin'
            });
            await refreshUsers(true, { archiveMode: showArchived ? 'all' : 'active' });
            if (selectedUser?.id && String(selectedUser.id) === String(targetUser.id) && !showArchived) {
                setSelectedUser(null);
                setIsProfileOpen(false);
                setIsCartOpen(false);
            }
            setCustomerDeleteChoice({ isOpen: false, targetUser: null });
            toast.success('Customer archived successfully');
        } catch (error) {
            toast.error(error?.message || 'Unable to archive customer');
        } finally {
            setIsActionLoading(false);
        }
    };

    const handlePermanentDeleteCustomer = async (targetUser) => {
        if (!targetUser?.id) return;
        setIsActionLoading(true);
        try {
            await adminService.deleteUser(targetUser.id, { mode: 'delete' });
            await refreshUsers(true);
            if (selectedUser?.id && String(selectedUser.id) === String(targetUser.id)) {
                setSelectedUser(null);
                setIsProfileOpen(false);
                setIsCartOpen(false);
            }
            setCustomerDeleteChoice({ isOpen: false, targetUser: null });
            toast.success('Customer deleted permanently');
        } catch (error) {
            toast.error(error?.message || 'Unable to delete customer');
        } finally {
            setIsActionLoading(false);
        }
    };

    const handleModalConfirm = async (inputValue) => {
        setIsActionLoading(true);
        const { type, targetUser } = modalConfig;
        try {
            if (type === 'delete') {
                await adminService.deleteUser(targetUser.id);
                toast.success('User deleted successfully');
                await refreshUsers(true);
            } else if (type === 'password') {
                if (!inputValue || inputValue.length < 6) {
                    toast.error('Password must be at least 6 characters');
                    setIsActionLoading(false);
                    return;
                }
                await adminService.resetPassword(targetUser.id, inputValue);
                toast.success('Password updated successfully');
            }
            setModalConfig((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
            toast.error(error?.message || 'Action failed');
        } finally {
            setIsActionLoading(false);
        }
    };

    const openCart = async (user) => {
        setSelectedUser(user);
        setIsCartOpen(true);
        setIsCartLoading(true);
        try {
            const data = await adminService.getUserCart(user.id);
            const nextItems = data.items || [];
            const nextLastActivity = data.lastActivityAt || user?.abandoned_cart_last_activity_at || user?.abandonedCartLastActivityAt || null;
            setCartItems(nextItems);
            setSelectedUser((prev) => ({
                ...(prev || user),
                abandoned_cart_last_activity_at: nextLastActivity,
                abandonedCartLastActivityAt: nextLastActivity
            }));
            const nextCount = nextItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            setCartCountOverrides((prev) => ({ ...prev, [user.id]: nextCount }));
        } catch {
            toast.error('Failed to load cart');
        } finally {
            setIsCartLoading(false);
        }
    };

    const openProfile = useCallback(async (user) => {
        if (String(user.role || 'customer') !== 'customer') return;
        setSelectedUser(user);
        setIsProfileOpen(true);
        setActiveCoupons([]);
        setActiveCouponsLoading(true);
        try {
            const data = await adminService.getUserActiveCoupons(user.id);
            setActiveCoupons(Array.isArray(data?.coupons) ? data.coupons : []);
        } catch (error) {
            toast.error(error?.message || 'Failed to load active coupons');
        } finally {
            setActiveCouponsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        const targetId = String(focusCustomerId || '').trim();
        if (!targetId) return;
        const customer = users.find((entry) => String(entry.id) === targetId);
        if (customer && String(customer.role || 'customer') === 'customer') {
            openProfile(customer);
        }
        onFocusCustomerHandled();
    }, [focusCustomerId, onFocusCustomerHandled, openProfile, users]);

    const openIssueCouponModal = (user) => {
        setCouponModalUser(user);
        setCouponForm({
            code: buildCouponCodeDraft(),
            name: `Offer for ${user.name || 'Customer'}`,
            discountType: 'percent',
            discountValue: 5,
            maxDiscountValue: 1000,
            minCartValue: 0,
            usageLimitPerUser: 1,
            startsAt: getTodayDateInput(),
            expiresAt: ''
        });
    };

    const handleIssueCouponToUser = async () => {
        if (!couponModalUser?.id) return;
        if (!couponForm.startsAt) return toast.error('Start date is required');
        if (couponForm.expiresAt && couponForm.expiresAt < couponForm.startsAt) {
            return toast.error('End date must be on or after start date');
        }
        if (couponForm.startsAt && couponForm.expiresAt) {
            const start = toDateOnly(couponForm.startsAt);
            const end = toDateOnly(couponForm.expiresAt);
            const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
            if (Number.isFinite(diffDays) && diffDays > MAX_COUPON_RANGE_DAYS) {
                return toast.error(`Coupon validity cannot exceed ${MAX_COUPON_RANGE_DAYS} days`);
            }
        }
        if (couponForm.code && String(couponForm.code).length > 15) {
            return toast.error('Coupon code cannot exceed 15 characters');
        }
        if (String(couponForm.discountType || '').toLowerCase() === 'percent') {
            const maxDiscountValue = Number(couponForm.maxDiscountValue || 0);
            if (!Number.isFinite(maxDiscountValue) || maxDiscountValue <= 0) {
                return toast.error('Maximum discount must be greater than 0 for percentage coupons');
            }
        }
        setCouponSaving(true);
        try {
            const payload = {
                code: sanitizeCouponCode(couponForm.code || ''),
                name: couponForm.name || `Offer for ${couponModalUser.name || ''}`,
                discountType: couponForm.discountType,
                discountValue: Number(couponForm.discountValue || 0),
                maxDiscountValue: String(couponForm.discountType || '').toLowerCase() === 'percent'
                    ? Number(couponForm.maxDiscountValue || 0)
                    : 0,
                minCartValue: Number(couponForm.minCartValue || 0),
                usageLimitPerUser: Math.max(1, Number(couponForm.usageLimitPerUser || 1)),
                startsAt: new Date(`${couponForm.startsAt}T00:00:00`).toISOString(),
                expiresAt: couponForm.expiresAt ? new Date(`${couponForm.expiresAt}T23:59:59`).toISOString() : null
            };
            const res = await adminService.issueCouponToUser(couponModalUser.id, payload);
            toast.success(`Coupon issued: ${res?.coupon?.code || ''}`);
            setCouponModalUser(null);
            if (selectedUser?.id === couponModalUser.id) {
                const data = await adminService.getUserActiveCoupons(couponModalUser.id);
                setActiveCoupons(Array.isArray(data?.coupons) ? data.coupons : []);
            }
        } catch (error) {
            toast.error(error?.message || 'Failed to issue coupon');
        } finally {
            setCouponSaving(false);
        }
    };

    const handleDeleteUserCoupon = async (userId, couponId, couponCode = '', force = false) => {
        if (!userId || !couponId) return;
        if (!force) {
            setCouponDeleteConfirm({
                isOpen: true,
                userId,
                couponId,
                couponCode: String(couponCode || couponId || '').trim()
            });
            return;
        }
        setCouponDeleteLoading(true);
        setCouponDeletingId(String(couponId));
        try {
            await adminService.deleteUserCoupon(userId, couponId);
            toast.success('Coupon deleted');
            const data = await adminService.getUserActiveCoupons(userId);
            setActiveCoupons(Array.isArray(data?.coupons) ? data.coupons : []);
            await refreshUsers(true);
            setCouponDeleteConfirm({ isOpen: false, userId: null, couponId: null, couponCode: '' });
        } catch (error) {
            toast.error(error?.message || 'Failed to delete coupon');
        } finally {
            setCouponDeleteLoading(false);
            setCouponDeletingId(null);
        }
    };

    const formatAddress = (address) => {
        if (!address) return '—';
        if (typeof address === 'string') {
            try {
                const parsed = JSON.parse(address);
                return [parsed.line1, parsed.city, parsed.state, parsed.zip].filter(Boolean).join(', ') || '—';
            } catch {
                return address;
            }
        }
        return [address.line1, address.city, address.state, address.zip].filter(Boolean).join(', ') || '—';
    };
    const parseAddress = (address) => {
        if (!address) return null;
        if (typeof address === 'string') {
            try {
                const parsed = JSON.parse(address);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
                return null;
            }
        }
        return typeof address === 'object' ? address : null;
    };

    return (
        <div className="animate-fade-in">
            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={handleModalConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                isLoading={isActionLoading}
            />
            <Modal
                isOpen={couponDeleteConfirm.isOpen}
                onClose={() => setCouponDeleteConfirm({ isOpen: false, userId: null, couponId: null, couponCode: '' })}
                onConfirm={() => handleDeleteUserCoupon(couponDeleteConfirm.userId, couponDeleteConfirm.couponId, couponDeleteConfirm.couponCode, true)}
                title="Delete Coupon?"
                message={`Are you sure you want to delete ${couponDeleteConfirm.couponCode || 'this coupon'}?`}
                type="delete"
                isLoading={couponDeleteLoading}
                confirmText="Delete Coupon"
            />
            {customerDeleteChoice.isOpen && createPortal(
                <div className="fixed inset-0 z-[210] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
                        onClick={() => (isActionLoading ? null : setCustomerDeleteChoice({ isOpen: false, targetUser: null }))}
                    />
                    <div className="relative z-10 my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
                        <div className="h-1.5 w-full shrink-0 bg-primary" />
                        <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Customer Actions</p>
                                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Choose customer action</h3>
                                    <p className="mt-1.5 text-sm text-slate-600">
                                        Archive to hide inactive customers, deactivate to block future sign-ins, or permanently delete linked history.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setCustomerDeleteChoice({ isOpen: false, targetUser: null })}
                                    disabled={isActionLoading}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                                    aria-label="Close customer action modal"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-4 overflow-y-auto p-5">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                <p className="font-semibold text-slate-900">{customerDeleteChoice.targetUser?.name || 'Customer'}</p>
                                <p className="mt-1 text-slate-600">{customerDeleteChoice.targetUser?.email || customerDeleteChoice.targetUser?.mobile || 'No contact details saved'}</p>
                            </div>
                            <div className="grid gap-3">
                                <button
                                    type="button"
                                    disabled={isActionLoading || customerDeleteChoice.targetUser?.isArchived}
                                    onClick={() => handleArchiveCustomer(customerDeleteChoice.targetUser)}
                                    className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                        <Archive size={16} />
                                        Archive customer
                                    </span>
                                    <span className="mt-1 block pl-6 text-xs leading-5 text-slate-700">Hide from the default customers list without blocking login, checkout, or order history.</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={isActionLoading || customerDeleteChoice.targetUser?.isActive === false}
                                    onClick={() => handleDeactivateCustomer(customerDeleteChoice.targetUser)}
                                    className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4 text-left transition hover:border-amber-300 hover:bg-amber-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                                        <Ban size={16} />
                                        Deactivate customer
                                    </span>
                                    <span className="mt-1 block pl-6 text-xs leading-5 text-amber-900">Keep the profile and order history, but stop future sign-ins.</span>
                                </button>
                                <button
                                    type="button"
                                    disabled={isActionLoading}
                                    onClick={() => handlePermanentDeleteCustomer(customerDeleteChoice.targetUser)}
                                    className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-4 text-left transition hover:border-rose-300 hover:bg-rose-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                                        <Trash2 size={16} />
                                        Delete customer permanently
                                    </span>
                                    <span className="mt-1 block pl-6 text-xs leading-5 text-rose-700">Remove the customer and all linked orders, payment attempts, loyalty data, coupons, and cart history. This cannot be undone.</span>
                                </button>
                            </div>
                            <div className="flex justify-end border-t border-slate-100 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setCustomerDeleteChoice({ isOpen: false, targetUser: null })}
                                    disabled={isActionLoading}
                                    className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <AddCustomerModal
                isOpen={!!addModalRole}
                onClose={() => setAddModalRole(null)}
                onConfirm={handleAddUser}
                roleToAdd={addModalRole}
            />

            {isMobileBirthdayModalOpen && createPortal(
                <div className="fixed inset-0 z-[120] flex items-end md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                        onClick={() => setIsMobileBirthdayModalOpen(false)}
                        aria-label="Close birthday filter"
                    />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Birthdays</h3>
                        <p className="mt-1 text-sm text-gray-500">Highlight customers celebrating today.</p>
                        <button
                            type="button"
                            onClick={() => setBirthdayOnly((prev) => !prev)}
                            className={`mt-4 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                birthdayOnly
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-gray-200 bg-white text-gray-700'
                            }`}
                        >
                            <span className="inline-flex items-center gap-2">
                                <Sparkles size={16} />
                                Birthdays Today
                            </span>
                            <span>{birthdayOnly ? 'On' : 'Off'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsMobileBirthdayModalOpen(false)}
                            className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light"
                        >
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileTierModalOpen && createPortal(
                <div className="fixed inset-0 z-[120] flex items-end md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                        onClick={() => setIsMobileTierModalOpen(false)}
                        aria-label="Close tier filter"
                    />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Customer Tier</h3>
                        <p className="mt-1 text-sm text-gray-500">Filter customers by loyalty tier.</p>
                        <select
                            value={tierFilter}
                            onChange={(e) => setTierFilter(e.target.value)}
                            className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-accent"
                        >
                            {CUSTOMER_TIER_FILTER_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setIsMobileTierModalOpen(false)}
                            className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light"
                        >
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileSearchModalOpen && createPortal(
                <div className="fixed inset-0 z-[120] flex items-end md:hidden">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                        onClick={() => setIsMobileSearchModalOpen(false)}
                        aria-label="Close customer search"
                    />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Search Customers</h3>
                        <p className="mt-1 text-sm text-gray-500">Search by name, mobile, or email.</p>
                        <div className="relative mt-4">
                            <Search className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
                            <input
                                placeholder="Search customers..."
                                className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-accent"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsMobileSearchModalOpen(false)}
                            className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light"
                        >
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {couponModalUser && createPortal(
                <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl p-6 space-y-4 max-h-[calc(100vh-2rem)] overflow-y-auto my-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-gray-800">Issue Coupon to {couponModalUser.name}</h3>
                            <button onClick={() => setCouponModalUser(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="md:col-span-2 text-xs text-gray-600">
                                Coupon Code
                                <input maxLength={15} className="input-field mt-1" placeholder="SSC-AB12-CD34" value={couponForm.code} onChange={(e) => setCouponForm((p) => ({ ...p, code: sanitizeCouponCode(e.target.value) }))} />
                            </label>
                            <label className="md:col-span-2 text-xs text-gray-600">
                                Coupon Name
                                <input className="input-field mt-1" placeholder="Coupon name" value={couponForm.name} onChange={(e) => setCouponForm((p) => ({ ...p, name: e.target.value }))} />
                            </label>
                            <label className="text-xs text-gray-600">
                                Discount Type
                                <select className="input-field mt-1" value={couponForm.discountType} onChange={(e) => setCouponForm((p) => ({ ...p, discountType: e.target.value, discountValue: e.target.value === 'shipping_full' ? 0 : p.discountValue, maxDiscountValue: e.target.value === 'percent' ? (Number(p.maxDiscountValue || 0) || 1000) : 0 }))}>
                                    <option value="percent">Percent</option>
                                    <option value="fixed">Fixed INR</option>
                                    <option value="shipping_full">Shipping Full</option>
                                    <option value="shipping_partial">Shipping Partial (%)</option>
                                </select>
                            </label>
                            <label className="text-xs text-gray-600">
                                Discount Value
                                <input className="input-field mt-1" type="number" disabled={couponForm.discountType === 'shipping_full'} placeholder="Discount value" value={couponForm.discountValue} onChange={(e) => setCouponForm((p) => ({ ...p, discountValue: e.target.value }))} />
                            </label>
                            <label className="text-xs text-gray-600">
                                Maximum Discount (INR)
                                <input className="input-field mt-1" type="number" min="0" disabled={couponForm.discountType !== 'percent'} placeholder="Maximum discount" value={couponForm.maxDiscountValue} onChange={(e) => setCouponForm((p) => ({ ...p, maxDiscountValue: e.target.value }))} />
                            </label>
                            <label className="text-xs text-gray-600">
                                Minimum Cart Value (INR)
                                <input className="input-field mt-1" type="number" placeholder="Min cart value" value={couponForm.minCartValue} onChange={(e) => setCouponForm((p) => ({ ...p, minCartValue: e.target.value }))} />
                            </label>
                            <label className="text-xs text-gray-600">
                                Usage Limit Per User
                                <input className="input-field mt-1" type="number" placeholder="Usage per user" value={couponForm.usageLimitPerUser} onChange={(e) => setCouponForm((p) => ({ ...p, usageLimitPerUser: e.target.value }))} />
                            </label>
                            <label className="text-xs text-gray-600">
                                Start Date <span className="text-red-500">*</span>
                                <div className="relative mt-1">
                                    <input
                                        className="input-field pr-10"
                                        type="text"
                                        placeholder="18th Feb 2026"
                                        value={formatLongDate(couponForm.startsAt)}
                                        readOnly
                                        required
                                    />
                                    <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                    <input
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        type="date"
                                        value={couponForm.startsAt}
                                        min={couponForm.expiresAt ? addDaysToInput(couponForm.expiresAt, -MAX_COUPON_RANGE_DAYS) : undefined}
                                        max={couponForm.expiresAt || undefined}
                                        onChange={(e) => setCouponForm((p) => ({ ...p, startsAt: e.target.value }))}
                                        required
                                    />
                                </div>
                            </label>
                            <label className="text-xs text-gray-600">
                                End Date (Optional)
                                <div className="relative mt-1">
                                    <input
                                        className="input-field pr-10"
                                        type="text"
                                        placeholder="18th Feb 2026"
                                        value={formatLongDate(couponForm.expiresAt)}
                                        readOnly
                                    />
                                    <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                    <input
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        type="date"
                                        min={couponForm.startsAt || undefined}
                                        max={couponForm.startsAt ? addDaysToInput(couponForm.startsAt, MAX_COUPON_RANGE_DAYS) : undefined}
                                        value={couponForm.expiresAt}
                                        onChange={(e) => setCouponForm((p) => ({ ...p, expiresAt: e.target.value }))}
                                    />
                                </div>
                            </label>
                        </div>
                        <p className="text-xs text-gray-500">Date format: 18th Feb 2026. Coupon will be sent via email and WhatsApp (if mobile is available).</p>
                        <div className="flex justify-end gap-2">
                            <button className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50" onClick={() => setCouponModalUser(null)}>Cancel</button>
                            <button disabled={couponSaving} className="px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60" onClick={handleIssueCouponToUser}>
                                {couponSaving ? 'Issuing...' : 'Issue Coupon'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isCartOpen && selectedUser && createPortal(
                <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 space-y-4 max-h-[calc(100vh-2rem)] overflow-y-auto my-auto">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800">{selectedUser.name}'s Cart</h3>
                                {getCartLastActivityLabel(selectedUser) && (
                                    <p className="mt-1 text-xs text-amber-700">
                                        Last cart activity: {getCartLastActivityLabel(selectedUser)}
                                    </p>
                                )}
                            </div>
                            <button onClick={() => setIsCartOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
                        </div>
                        <div className="max-h-80 overflow-y-auto space-y-3">
                            {isCartLoading && <div className="flex items-center justify-center text-xs text-gray-400 py-6"><Loader2 className="animate-spin mr-2" size={14} />Loading cart...</div>}
                            {!isCartLoading && cartItems.length === 0 && (
                                <EmptyState
                                    image={customerIllustration}
                                    alt="Cart is empty"
                                    title="Cart is empty"
                                    description="This customer has no saved items in cart right now."
                                    compact
                                />
                            )}
                            {cartItems.map((item) => (
                                <div key={`${item.productId}_${item.variantId}`} className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">{item.imageUrl && <img src={item.imageUrl} className="w-full h-full object-cover" />}</div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-gray-800 line-clamp-1">{item.title}</p>
                                        {item.variantTitle && <p className="text-xs text-gray-500 line-clamp-1">{item.variantTitle}</p>}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                                        <p className="text-sm font-bold text-primary">₹{Number(item.price || 0).toLocaleString()}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isProfileOpen && selectedUser && createPortal(
                <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-xl h-full shadow-2xl overflow-hidden">
                        <div className="h-full overflow-y-auto p-6">
                        {(() => {
                            const drawerTheme = getMobileCustomerCardTheme(selectedUser);
                            const profileImage = getCustomerProfileImage(selectedUser);
                            const callLink = getCallLink(selectedUser.mobile);
                            const waLink = getWhatsappLink(selectedUser.mobile);
                            const isBasicTier = String(selectedUser.loyaltyTier || 'regular').toLowerCase() === 'regular';
                            const shippingAddress = parseAddress(selectedUser.address) || {};
                            return (
                                <>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-gray-800">Customer Profile</h3>
                            <button onClick={() => setIsProfileOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18} /></button>
                        </div>
                        <div className={`relative mb-6 overflow-hidden rounded-3xl border px-5 pb-5 pt-5 shadow-sm ${drawerTheme.shell}`}>
                            <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${drawerTheme.strip}`} />
                            <div className="flex items-start gap-4">
                                <div className={`mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-lg ring-1 ${drawerTheme.avatar}`}>
                                    {profileImage ? (
                                        <img src={profileImage} alt={selectedUser.name || 'Customer'} className="h-full w-full object-cover" />
                                    ) : (
                                        String(selectedUser.name || 'U').charAt(0)
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h4 className="text-lg font-bold text-gray-900">{selectedUser.name}</h4>
                                            <p className="mt-1 text-sm text-gray-600">{isBasicTier ? 'Basic tier customer' : tierLabel(selectedUser.loyaltyTier || 'regular')}</p>
                                        </div>
                                        {selectedUser.isActive === false && (
                                            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className={`mt-3 space-y-2 rounded-2xl border px-4 py-3 ${drawerTheme.section}`}>
                                <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3">
                                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${drawerTheme.contactIcon}`}>
                                        <Phone size={13} />
                                    </span>
                                    <p className={`min-w-0 text-left justify-self-start text-sm ${selectedUser.mobile ? 'text-gray-700' : 'text-gray-400'}`}>{selectedUser.mobile || '—'}</p>
                                </div>
                                <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3">
                                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${drawerTheme.emailIcon}`}>
                                        <Mail size={13} />
                                    </span>
                                    <p className={`min-w-0 text-left justify-self-start break-all text-sm ${selectedUser.email ? 'text-gray-700' : 'text-gray-400'}`}>{selectedUser.email || '—'}</p>
                                </div>
                            </div>
                            <div className={`mt-4 flex flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible border-t pt-4 ${drawerTheme.divider}`}>
                                {callLink && (
                                    <a
                                        href={callLink}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 px-2.5 py-2 text-xs sm:text-sm font-semibold text-sky-700 shadow-sm shadow-sky-100/60 hover:from-sky-100 hover:to-cyan-100"
                                    >
                                        <Phone size={13} className="sm:h-[14px] sm:w-[14px]" />
                                        <span className="hidden md:inline">Call</span>
                                    </a>
                                )}
                                {waLink && (
                                    <a
                                        href={waLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-lime-50 px-2.5 py-2 text-xs sm:text-sm font-semibold text-emerald-700 shadow-sm shadow-emerald-100/60 hover:from-emerald-100 hover:to-lime-100"
                                    >
                                        <WhatsAppIcon size={13} />
                                        <span className="hidden md:inline">WhatsApp</span>
                                    </a>
                                )}
                                <button
                                    type="button"
                                    onClick={() => openCart(selectedUser)}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-2.5 py-2 text-xs sm:text-sm font-semibold text-amber-700 shadow-sm shadow-amber-100/60 hover:from-amber-100 hover:to-orange-100"
                                >
                                    <ShoppingCart size={13} className="sm:h-[14px] sm:w-[14px]" />
                                    <span className="hidden md:inline">View Cart</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsProfileOpen(false);
                                        onCreateOrderForCustomer?.(selectedUser.id);
                                    }}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 px-2.5 py-2 text-xs sm:text-sm font-semibold text-violet-700 shadow-sm shadow-violet-100/60 hover:from-violet-100 hover:to-fuchsia-100"
                                >
                                    <Plus size={13} className="sm:h-[14px] sm:w-[14px]" />
                                    <span className="hidden md:inline">Create Order</span>
                                </button>
                                {canDeleteUser(selectedUser) && (
                                    <button
                                        type="button"
                                        onClick={() => openDeleteModal(selectedUser)}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-red-50 px-2.5 py-2 text-xs sm:text-sm font-semibold text-rose-700 shadow-sm shadow-rose-100/60 hover:from-rose-100 hover:to-red-100"
                                    >
                                        <Trash2 size={13} className="sm:h-[14px] sm:w-[14px]" />
                                        <span className="hidden lg:inline">Customer Actions</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 rounded-xl border border-gray-200 bg-white"><p className="text-xs text-gray-400 font-bold uppercase">Overall Volume</p><p className="text-lg font-bold text-gray-800 mt-1">₹{Number(selectedUser.totalSpend || 0).toLocaleString('en-IN')}</p></div>
                            <div className="p-4 rounded-xl border border-gray-200 bg-white"><p className="text-xs text-gray-400 font-bold uppercase">Avg Order</p><p className="text-lg font-bold text-gray-800 mt-1">₹{Number(selectedUser.avgOrderValue || 0).toLocaleString('en-IN')}</p></div>
                            <div className="p-4 rounded-xl border border-gray-200 bg-white"><p className="text-xs text-gray-400 font-bold uppercase">Total Orders</p><p className="text-lg font-bold text-gray-800 mt-1">{Number(selectedUser.totalOrders || 0)}</p></div>
                            <div className="p-4 rounded-xl border border-gray-200 bg-white"><p className="text-xs text-gray-400 font-bold uppercase">Last Order</p><p className="text-sm font-bold text-gray-800 mt-1">{selectedUser.lastOrderAt ? formatAdminDate(selectedUser.lastOrderAt) : '—'}</p></div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 mb-6">
                            <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                <p className="text-xs text-gray-400 font-bold uppercase">Date of Birth</p>
                                <p className="text-sm text-gray-700 mt-2">{selectedUser.dob ? formatAdminDate(String(selectedUser.dob).split('T')[0]) : '—'}</p>
                            </div>
                            {billingAddressEnabled && (
                                <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                    <p className="text-xs text-gray-400 font-bold uppercase">Billing Address</p>
                                    <p className="text-sm text-gray-700 mt-2">{formatAddress(selectedUser.billingAddress)}</p>
                                </div>
                            )}
                            <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                <p className="text-xs text-gray-400 font-bold uppercase">Shipping Address</p>
                                <p className="text-sm text-gray-700 mt-2">{formatAddress(selectedUser.address)}</p>
                            </div>
                            {shippingAddress.landmark && (
                                <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                    <p className="text-xs text-gray-400 font-bold uppercase">Landmark</p>
                                    <p className="text-sm text-gray-700 mt-2">{shippingAddress.landmark}</p>
                                </div>
                            )}
                            {shippingAddress.additionalPhone && (
                                <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                    <p className="text-xs text-gray-400 font-bold uppercase">Additional Phone</p>
                                    <p className="text-sm text-gray-700 mt-2">{shippingAddress.additionalPhone}</p>
                                </div>
                            )}
                            <div className="p-4 rounded-xl border border-gray-200 bg-white">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-gray-400 font-bold uppercase">Active Coupons</p>
                                    <button type="button" onClick={() => openIssueCouponModal(selectedUser)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600">
                                        <TicketPercent size={12} /> Issue
                                    </button>
                                </div>
                                <p className="text-sm text-gray-700 mt-2">{activeCoupons.length} active coupon(s)</p>
                                <div className={`mt-2 space-y-2 ${activeCoupons.length > 3 ? 'max-h-56 overflow-y-auto pr-1' : ''}`}>
                                    {activeCouponsLoading && <p className="text-xs text-gray-400">Loading coupons...</p>}
                                    {!activeCouponsLoading && activeCoupons.map((cp) => (
                                        <div key={cp.id || cp.code} className="rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-gray-800 truncate">{cp.code}</p>
                                                <p className="text-[11px] text-gray-600 mt-1">
                                                    {formatCouponOffer(cp)}
                                                    {(cp.sourceType || cp.source_type) === 'abandoned' ? ' • Abandoned cart' : ''}
                                                    {(cp.expiresAt || cp.expires_at) ? ` • Expires ${formatLongDate(cp.expiresAt || cp.expires_at)}` : ' • No expiry'}
                                                </p>
                                            </div>
                                            {canDeleteCouponFromDrawer(cp) && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteUserCoupon(selectedUser.id, cp.id || cp.code, cp.code)}
                                                    disabled={couponDeletingId === String(cp.id || cp.code)}
                                                    className="inline-flex items-center justify-center p-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                    title="Delete coupon"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {!activeCouponsLoading && activeCoupons.length === 0 && (
                                        <EmptyState
                                            image={customerIllustration}
                                            alt="No active coupons"
                                            title="No active coupons"
                                            description="Issue a coupon to this customer to see it listed here."
                                            compact
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                                </>
                            );
                        })()}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="flex items-center justify-between gap-3 md:block">
                        <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Customers</h1>
                    </div>
                    <p className="text-gray-500 text-sm mt-1">Manage customers</p>
                </div>
                <div className="hidden md:flex flex-col md:flex-row gap-2 w-full md:w-auto">
                    <button type="button" onClick={() => setBirthdayOnly((prev) => !prev)} className={`flex items-center gap-2 px-4 py-3 rounded-xl border shadow-sm text-sm font-semibold transition-all ${birthdayOnly ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:border-accent'}`}>
                        <Sparkles size={16} /> Birthdays Today
                    </button>
                    <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none">
                        {CUSTOMER_TIER_FILTER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <div className="relative flex-1 md:w-72">
                        <Search className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                        <input placeholder="Search customers..." className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                    <button
                        type="button"
                        onClick={handleArchivedToggle}
                        className={`font-bold px-4 py-3 rounded-xl shadow-sm border flex items-center justify-center gap-2 transition-all active:scale-95 ${
                            showArchived
                                ? 'border-slate-300 bg-slate-900 text-white shadow-slate-200'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                    >
                        <Archive size={18} />
                        <span className="whitespace-nowrap">Archived</span>
                        {archivedCustomerCount > 0 && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${showArchived ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                {archivedCustomerCount}
                            </span>
                        )}
                    </button>
                </div>
                <div className="flex items-center justify-end gap-2 md:hidden">
                    <button
                        type="button"
                        onClick={() => setIsMobileBirthdayModalOpen(true)}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                            birthdayOnly
                                ? 'border-amber-200 bg-amber-50 text-amber-700 shadow-amber-100/70'
                                : 'border-amber-100 bg-gradient-to-br from-white to-amber-50/70 text-amber-700 shadow-amber-100/50'
                        }`}
                        title="Birthdays Today"
                        aria-label="Birthdays Today"
                    >
                        <Sparkles size={18} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsMobileTierModalOpen(true)}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                            tierFilter !== 'all'
                                ? 'border-sky-200 bg-sky-50 text-sky-700 shadow-sky-100/70'
                                : 'border-sky-100 bg-gradient-to-br from-white to-sky-50/70 text-sky-700 shadow-sky-100/50'
                        }`}
                        title="Filter by Tier"
                        aria-label="Filter by Tier"
                    >
                        <SlidersHorizontal size={18} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsMobileSearchModalOpen(true)}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                            searchTerm
                                ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 shadow-fuchsia-100/70'
                                : 'border-fuchsia-100 bg-gradient-to-br from-white to-fuchsia-50/70 text-fuchsia-700 shadow-fuchsia-100/50'
                        }`}
                        title="Search Customers"
                        aria-label="Search Customers"
                    >
                        <Search size={18} />
                    </button>
                    <button
                        type="button"
                        onClick={handleArchivedToggle}
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                            showArchived
                                ? 'border-slate-300 bg-slate-900 text-white shadow-slate-200'
                                : 'border-slate-100 bg-gradient-to-br from-white to-slate-50/70 text-slate-700 shadow-slate-100/50'
                        }`}
                        title="Show archived customers"
                        aria-label="Show archived customers"
                    >
                        <Archive size={18} />
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent w-10 h-10" /></div>
            ) : (
                <>
                    <div className="emboss-card relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <Users size={72} className="bg-emboss-icon absolute right-2 bottom-2 text-gray-100" />
                        <div className="hidden px-6 py-4 border-b border-gray-100 items-center justify-between gap-3 md:flex">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Customers</h3>
                            <div className="hidden md:flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleExportCustomers}
                                    disabled={isExporting || isLoading}
                                    className="inline-flex min-w-36 bg-white hover:bg-gray-50 text-gray-700 font-bold px-3 py-2 rounded-lg text-xs shadow-sm border border-gray-200 items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    <Download size={14} strokeWidth={2.5} />
                                    {isExporting ? 'Exporting...' : 'Export Customers'}
                                </button>
                                <button onClick={() => setAddModalRole('customer')} className="inline-flex w-36 bg-primary hover:bg-primary-light text-accent font-bold px-3 py-2 rounded-lg text-xs shadow-lg shadow-primary/20 items-center justify-center gap-2 transition-all active:scale-95">
                                    <Plus size={14} strokeWidth={3} /> Add Customer
                                </button>
                            </div>
                        </div>
                        <table className="hidden md:table w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Customer</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Tier</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Contact</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {paginatedCustomersOnly.map((user) => {
                                    const waLink = getWhatsappLink(user.mobile);
                                    const callLink = getCallLink(user.mobile);
                                    const cartCount = Number(cartCountOverrides[user.id] ?? user.cart_count ?? 0);
                                    const cartLastActivity = getCartLastActivityLabel(user);
                                    const profileImage = getCustomerProfileImage(user);
                                    return (
                                        <tr key={user.id} onClick={() => openProfile(user)} className={`hover:bg-gray-50/50 transition-colors cursor-pointer ${isBirthdayToday(user.dob) ? 'bg-amber-50/60' : ''} ${user.isArchived ? 'bg-slate-50/70' : ''}`}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs bg-primary/10 text-primary overflow-hidden">
                                                        {profileImage ? (
                                                            <img src={profileImage} alt={user.name || 'Customer'} className="w-full h-full object-cover" />
                                                        ) : (
                                                            String(user.name || 'U').charAt(0)
                                                        )}
                                                    </div>
                                                    <div>
                                                        <span className="font-medium text-gray-900">{user.name}</span>
                                                        {user.isArchived && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">Archived</span>}
                                                        {user.isActive === false && <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">Inactive</span>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <TierBadge
                                                    tier={user.loyaltyTier || 'regular'}
                                                    label={tierLabel(user.loyaltyTier || 'regular')}
                                                    className="px-2.5 py-0.5 text-xs font-medium"
                                                    iconSize={12}
                                                />
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-sm text-gray-900">
                                                    <Mail size={14} className="shrink-0 text-gray-400" />
                                                    <span>{user.email || '—'}</span>
                                                </div>
                                                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                                                    <Phone size={13} className="shrink-0 text-gray-400" />
                                                    <span>{user.mobile || '—'}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                                                {callLink && (
                                                    <a href={callLink} onClick={(e) => e.stopPropagation()} className="text-gray-400 hover:text-sky-700 hover:bg-sky-50 p-2 rounded-lg transition-all" title="Call Customer">
                                                        <Phone size={18} />
                                                    </a>
                                                )}
                                                <button onClick={(e) => { e.stopPropagation(); openIssueCouponModal(user); }} className="text-gray-400 hover:text-indigo-700 hover:bg-indigo-50 p-2 rounded-lg transition-all" title="Issue Coupon">
                                                    <TicketPercent size={18} />
                                                </button>
                                                {waLink && (
                                                    <a href={waLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-gray-400 hover:text-green-700 hover:bg-green-50 p-2 rounded-lg transition-all" title="Open WhatsApp">
                                                        <WhatsAppIcon size={18} />
                                                    </a>
                                                )}
                                                <button onClick={(e) => { e.stopPropagation(); openCart(user); }} className={`relative p-2 rounded-lg border transition-colors ${cartCount > 0 ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100' : 'text-gray-500 bg-gray-50 border-gray-200 hover:text-primary'}`} title="View Cart">
                                                    <ShoppingCart size={16} />
                                                    {cartCount > 0 && <span className="absolute -top-1 -right-1 text-[10px] font-bold bg-green-600 text-white rounded-full px-1.5 py-0.5">{cartCount}</span>}
                                                </button>
                                                {cartLastActivity && (
                                                    <span className="hidden xl:inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800" title={`Last cart activity: ${cartLastActivity}`}>
                                                        {cartLastActivity}
                                                    </span>
                                                )}
                                                {canDeleteUser(user) && <button onClick={(e) => { e.stopPropagation(); openDeleteModal(user); }} className="p-2 rounded-lg text-gray-400 transition-all hover:bg-red-50 hover:text-red-600" title="Customer actions"><Trash2 size={18} /></button>}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {paginatedCustomersOnly.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-10">
                                            <div className="flex flex-col items-center justify-center text-center">
                                                <img src={customerIllustration} alt="No customers" className="w-40 h-40 object-contain opacity-85" />
                                                <p className="mt-3 text-sm font-semibold text-gray-700">No customers available</p>
                                                <p className="text-xs text-gray-500 mt-1">Try adjusting filters or search to view matching customers.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        <div className="md:hidden p-4">
                            {paginatedCustomersOnly.length === 0 && (
                                <div className="py-10">
                                    <div className="flex flex-col items-center justify-center text-center">
                                        <img src={customerIllustration} alt="No customers" className="w-36 h-36 object-contain opacity-85" />
                                        <p className="mt-3 text-sm font-semibold text-gray-700">No customers available</p>
                                        <p className="text-xs text-gray-500 mt-1">Try adjusting filters or search to view matching customers.</p>
                                    </div>
                                </div>
                            )}
                            {paginatedCustomersOnly.length > 0 && (
                                <div className="grid grid-cols-1 gap-3">
                                    {paginatedCustomersOnly.map((user) => {
                                        const waLink = getWhatsappLink(user.mobile);
                                        const callLink = getCallLink(user.mobile);
                                        const cartCount = Number(cartCountOverrides[user.id] ?? user.cart_count ?? 0);
                                        const cartLastActivity = getCartLastActivityLabel(user);
                                        const profileImage = getCustomerProfileImage(user);
                                        const theme = getMobileCustomerCardTheme({
                                            ...user,
                                            cart_count: cartCount
                                        });
                                        return (
                                            <div
                                                key={`m-${user.id}`}
                                                onClick={() => openProfile(user)}
                                                className={`relative overflow-hidden rounded-2xl border px-3.5 pb-3.5 pt-4 shadow-sm ${theme.shell} ${isBirthdayToday(user.dob) ? 'ring-1 ring-amber-200/80' : ''} ${user.isArchived ? 'opacity-85 grayscale-[0.25]' : ''}`}
                                            >
                                                <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.strip}`} />
                                                <div className="flex items-start gap-3">
                                                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-sm ring-1 ${theme.avatar}`}>
                                                        {profileImage ? (
                                                            <img src={profileImage} alt={user.name || 'Customer'} className="w-full h-full object-cover" />
                                                        ) : (
                                                            String(user.name || 'U').charAt(0)
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-semibold text-gray-900 line-clamp-1">{user.name}</p>
                                                                <p className="mt-0.5 text-[10px] text-gray-500">Customer profile</p>
                                                            </div>
                                                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                                                <TierBadge
                                                                    tier={user.loyaltyTier || 'regular'}
                                                                    label={tierLabel(user.loyaltyTier || 'regular')}
                                                                    className="px-2.5 py-1 text-[10px] font-medium"
                                                                    iconSize={11}
                                                                />
                                                                {user.isArchived && <span className="inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">Archived</span>}
                                                                {user.isActive === false && <span className="inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800 border border-red-200">Inactive</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className={`mt-2.5 space-y-1.5 rounded-xl border px-3 py-2.5 ${theme.section}`}>
                                                    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2">
                                                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${theme.contactIcon}`}>
                                                            <Phone size={12} />
                                                        </span>
                                                        <p className={`min-w-0 text-left text-[11px] leading-5 line-clamp-1 ${user.mobile ? 'text-gray-700' : 'text-gray-400'}`}>{user.mobile || '—'}</p>
                                                    </div>
                                                    <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2">
                                                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${theme.emailIcon}`}>
                                                            <Mail size={12} />
                                                        </span>
                                                        <p className={`min-w-0 text-left text-[11px] leading-5 line-clamp-1 ${user.email ? 'text-gray-700' : 'text-gray-400'}`}>{user.email || '—'}</p>
                                                    </div>
                                                </div>
                                                <div className={`mt-2.5 flex items-center justify-end gap-2 border-t pt-2.5 ${theme.divider}`}>
                                                    <div className="flex shrink-0 items-center justify-end gap-1">
                                                        {callLink && (
                                                            <a href={callLink} onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center rounded-lg border border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 p-2 text-sky-700 shadow-sm shadow-sky-100/60 transition-all hover:from-sky-100 hover:to-cyan-100" title="Call Customer">
                                                                <Phone size={16} />
                                                            </a>
                                                        )}
                                                        {waLink && (
                                                            <a href={waLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-lime-50 p-2 text-emerald-700 shadow-sm shadow-emerald-100/60 transition-all hover:from-emerald-100 hover:to-lime-100" title="Open WhatsApp">
                                                                <WhatsAppIcon size={16} />
                                                            </a>
                                                        )}
                                                        <button onClick={(e) => { e.stopPropagation(); openIssueCouponModal(user); }} className="inline-flex items-center justify-center rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-2 text-violet-700 shadow-sm shadow-violet-100/60 transition-all hover:from-violet-100 hover:to-fuchsia-100" title="Issue Coupon">
                                                            <TicketPercent size={16} />
                                                        </button>
                                                        <button onClick={(e) => { e.stopPropagation(); openCart(user); }} className={`relative rounded-lg border p-2 shadow-sm transition-colors ${cartCount > 0 ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50 text-emerald-700 shadow-emerald-100/60 hover:from-emerald-100 hover:to-green-100' : 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 text-amber-700 shadow-amber-100/60 hover:from-amber-100 hover:to-orange-100'}`} title="View Cart">
                                                            <ShoppingCart size={14} />
                                                            {cartCount > 0 && <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-green-600 text-white rounded-full px-1 py-0.5">{cartCount}</span>}
                                                        </button>
                                                        {canDeleteUser(user) && <button onClick={(e) => { e.stopPropagation(); openDeleteModal(user); }} className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-gradient-to-br from-rose-50 to-red-50 p-2 text-rose-600 shadow-sm shadow-rose-100/60 transition-all hover:from-rose-100 hover:to-red-100" title="Customer actions"><Trash2 size={16} /></button>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {customerTotalPages > 1 && (
                        <div className="mt-6 flex max-w-full flex-wrap items-center justify-center gap-2 overflow-x-hidden">
                            <button onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1} className="px-3 py-2 rounded-lg border border-gray-200 text-xs md:text-sm text-gray-600 disabled:opacity-40">Prev</button>
                            {visiblePages.map((p) => (
                                <button key={p} onClick={() => setPage(p)} className={`min-w-9 px-3 py-2 rounded-lg border text-xs md:text-sm ${page === p ? 'bg-primary text-accent border-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                                    {p}
                                </button>
                            ))}
                            <button onClick={() => setPage((prev) => Math.min(customerTotalPages, prev + 1))} disabled={page === customerTotalPages} className="px-3 py-2 rounded-lg border border-gray-200 text-xs md:text-sm text-gray-600 disabled:opacity-40">Next</button>
                        </div>
                    )}

                    {!addModalRole && (
                        <button
                            type="button"
                            onClick={() => setAddModalRole('customer')}
                            className="fixed bottom-24 right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 transition hover:bg-emerald-600 md:hidden"
                            aria-label="Add Customer"
                            title="Add Customer"
                        >
                            <Plus size={24} strokeWidth={2.5} />
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
