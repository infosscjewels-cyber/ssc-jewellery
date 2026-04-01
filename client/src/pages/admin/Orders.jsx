import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Filter, Package, IndianRupee, Clock3, CheckCircle2, X, ArrowUpDown, Download, RefreshCw, Trash2, MessageCircle, Plus, Send, Printer, Phone } from 'lucide-react';
import { orderService } from '../../services/orderService';
import { adminService } from '../../services/adminService';
import { productService } from '../../services/productService';
import orderWaitIllustration from '../../assets/order_wait.svg';
import { useToast } from '../../context/ToastContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { formatAdminDate, formatAdminDateTime } from '../../utils/dateFormat';
import { getGstDisplayDetails } from '../../utils/gst';
import { billingAddressEnabled } from '../../utils/billingAddressConfig';
import Modal from '../../components/Modal';
import { useAdminKPI } from '../../context/AdminKPIContext';
import { useAuth } from '../../context/AuthContext';
import {
    configurePreferredPrinter,
    getPreferredPrinterTransport,
    getPrinterSupportState,
    getStoredPrinterPreference,
    printFromLabel,
    printToLabel,
    validateFromLabelData,
    validateToLabelData
} from '../../utils/thermalLabelPrint';

const QUICK_RANGES = [
    { value: 'latest_10', label: 'Latest Orders (10)' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
    { value: 'last_90_days', label: 'Last 90 Days' },
    { value: 'custom', label: 'Custom Range' }
];

const MAX_RANGE_DAYS = 90;
const KPI_CARD_THEMES = {
    gold: {
        shell: 'bg-gradient-to-br from-amber-800 via-amber-900 to-stone-950 border-amber-300/70',
        label: 'text-amber-50',
        value: 'text-white',
        iconChip: 'text-amber-100 bg-amber-200/15 border-amber-200/30',
        iconGhost: 'text-amber-200/25'
    },
    sky: {
        shell: 'bg-gradient-to-br from-blue-800 via-blue-900 to-indigo-950 border-blue-300/65',
        label: 'text-blue-50',
        value: 'text-white',
        iconChip: 'text-blue-100 bg-blue-200/15 border-blue-200/30',
        iconGhost: 'text-blue-200/25'
    },
    emerald: {
        shell: 'bg-gradient-to-br from-emerald-800 via-green-900 to-emerald-950 border-green-300/65',
        label: 'text-green-50',
        value: 'text-white',
        iconChip: 'text-green-100 bg-green-200/15 border-green-200/30',
        iconGhost: 'text-green-200/25'
    },
    amber: {
        shell: 'bg-gradient-to-br from-red-800 via-red-900 to-rose-950 border-red-300/65',
        label: 'text-red-50',
        value: 'text-white',
        iconChip: 'text-red-100 bg-red-200/15 border-red-200/30',
        iconGhost: 'text-red-200/25'
    },
    violet: {
        shell: 'bg-gradient-to-br from-fuchsia-800 via-fuchsia-900 to-purple-950 border-fuchsia-300/65',
        label: 'text-fuchsia-50',
        value: 'text-white',
        iconChip: 'text-fuchsia-100 bg-fuchsia-200/15 border-fuchsia-200/30',
        iconGhost: 'text-fuchsia-200/25'
    },
    slate: {
        shell: 'bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900 border-slate-300/60',
        label: 'text-slate-50',
        value: 'text-white',
        iconChip: 'text-slate-100 bg-slate-200/15 border-slate-200/30',
        iconGhost: 'text-slate-200/25'
    }
};
const CANCELLATION_MODES = [
    { value: 'razorpay', label: 'Razorpay Refund' },
    { value: 'manual', label: 'Manual Refund' }
];
const MANUAL_REFUND_METHODS = ['Cash', 'NEFT/RTGS', 'UPI', 'Bank A/c Transfer', 'Voucher code'];
const MANUAL_PAYMENT_OPTIONS = [
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'card_swipe', label: 'Card Swipe' },
    { value: 'net_banking', label: 'Net Banking' },
    { value: 'manual', label: 'Manual' }
];
const EMPTY_ADDRESS = { line1: '', city: '', state: '', zip: '' };
const EMPTY_MANUAL_ITEM = { productId: '', variantId: '', quantity: 1 };
const normalizeOrderStatus = (status) => {
    const normalized = String(status || 'pending').trim().toLowerCase();
    if (normalized === 'shipped') return 'completed';
    return normalized || 'pending';
};
const formatStatusLabel = (status) => {
    const normalized = normalizeOrderStatus(status);
    if (!normalized) return 'Pending';
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
};
const getOrderStatusBadgeClasses = (status) => {
    const normalized = normalizeOrderStatus(status);
    if (normalized === 'confirmed') return 'bg-blue-900 text-blue-50 border border-blue-600';
    if (normalized === 'pending') return 'bg-amber-900 text-amber-50 border border-amber-600';
    if (normalized === 'completed') return 'bg-emerald-900 text-emerald-50 border border-emerald-600';
    if (normalized === 'failed') return 'bg-red-900 text-red-50 border border-red-600';
    if (normalized === 'cancelled') return 'bg-slate-700 text-slate-50 border border-slate-500';
    return 'bg-slate-800 text-slate-50 border border-slate-600';
};
const getOrderHeaderTheme = (status) => {
    const normalized = normalizeOrderStatus(status);
    if (normalized === 'cancelled') {
        return {
            shell: 'bg-gradient-to-br from-red-700 via-red-800 to-rose-950',
            accent: 'bg-red-200/20 text-red-50 border border-red-200/35',
            micro: 'text-red-100/80',
            subtle: 'text-red-50/90',
            rowLabel: 'text-red-100/75'
        };
    }
    if (normalized === 'pending') {
        return {
            shell: 'bg-gradient-to-br from-amber-600 via-amber-700 to-orange-950',
            accent: 'bg-amber-50/20 text-amber-50 border border-amber-100/35',
            micro: 'text-amber-50/80',
            subtle: 'text-amber-50/90',
            rowLabel: 'text-amber-100/75'
        };
    }
    return {
        shell: 'bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-950',
        accent: 'bg-emerald-50/20 text-emerald-50 border border-emerald-100/35',
        micro: 'text-emerald-50/80',
        subtle: 'text-emerald-50/90',
        rowLabel: 'text-emerald-100/75'
    };
};
const getOrderHeaderBadgeClasses = (status) => {
    const normalized = normalizeOrderStatus(status);
    if (normalized === 'cancelled') return 'bg-red-100 text-red-800 border border-red-200';
    if (normalized === 'pending') return 'bg-amber-100 text-amber-900 border border-amber-200';
    return 'bg-emerald-100 text-emerald-900 border border-emerald-200';
};
const getAvailableStatusOptions = (status) => {
    const current = normalizeOrderStatus(status);
    if (current === 'pending') {
        return [
            { value: 'pending', label: 'Pending' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' }
        ];
    }
    if (current === 'completed') {
        return [{ value: 'completed', label: 'Completed' }];
    }
    if (current === 'cancelled') {
        return [{ value: 'cancelled', label: 'Cancelled' }];
    }
    return [
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'pending', label: 'Pending' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' }
    ];
};
const orderMatchesStatusFilter = (order, filterValue = 'all') => {
    const filter = String(filterValue || 'all').trim().toLowerCase();
    if (!filter || filter === 'all') return true;
    const status = normalizeOrderStatus(order?.status || 'confirmed');
    const createdTs = new Date(order?.created_at || order?.createdAt || 0).getTime();
    const ageHours = Number.isFinite(createdTs) && createdTs > 0
        ? (Date.now() - createdTs) / (1000 * 60 * 60)
        : null;
    const isOverdueConfirmed = status === 'confirmed' && Number.isFinite(ageHours) && ageHours >= 24;
    if (filter === 'failed') {
        return status === 'failed' || String(order?.payment_status || '').trim().toLowerCase() === 'failed';
    }
    if (filter === 'pending') {
        return status === 'pending' || isOverdueConfirmed;
    }
    if (filter === 'confirmed') {
        return status === 'confirmed' && !isOverdueConfirmed;
    }
    return status === filter;
};
const getPaymentStatusBadgeClasses = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'paid') return 'bg-emerald-900 text-emerald-50 border border-emerald-600';
    if (['failed', 'expired'].includes(normalized)) return 'bg-red-900 text-red-50 border border-red-600';
    if (['pending', 'created', 'attempted'].includes(normalized)) return 'bg-amber-900 text-amber-50 border border-amber-600';
    if (normalized === 'refunded') return 'bg-sky-900 text-sky-50 border border-sky-600';
    return 'bg-slate-800 text-slate-50 border border-slate-600';
};
const getPaymentHeaderBadgeClasses = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'paid') return 'bg-white/90 text-emerald-900 border border-emerald-100';
    if (['failed', 'expired'].includes(normalized)) return 'bg-white/90 text-red-800 border border-red-100';
    if (['pending', 'created', 'attempted'].includes(normalized)) return 'bg-white/90 text-amber-900 border border-amber-100';
    if (normalized === 'refunded') return 'bg-white/90 text-sky-900 border border-sky-100';
    return 'bg-white/90 text-slate-800 border border-white/60';
};
const getManualUnitPrice = (product = {}, variant = null) => {
    return Number(
        variant?.discount_price
        ?? variant?.price
        ?? product?.discount_price
        ?? product?.mrp
        ?? product?.price
        ?? 0
    );
};

const toDateOnly = (value) => {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffInDays = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    const diff = endDate.getTime() - startDate.getTime();
    return Math.floor(diff / (24 * 60 * 60 * 1000));
};

const addDays = (value, days) => {
    const date = toDateOnly(value);
    if (!date) return '';
    const copy = new Date(date);
    copy.setDate(copy.getDate() + Number(days || 0));
    const local = new Date(copy.getTime() - copy.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

const getWhatsappLink = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return '';
    const full = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${full}`;
};
const getCallLink = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return '';
    const full = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    return `tel:${full}`;
};
const normalizeMobileDigits = (value = '') => String(value || '').replace(/\D/g, '');

const buildVisiblePages = (currentPage, totalPages, windowSize = 5) => {
    const safeTotal = Math.max(1, Number(totalPages || 1));
    const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage || 1)));
    if (safeTotal <= windowSize) return Array.from({ length: safeTotal }, (_, idx) => idx + 1);
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, safeCurrent - half);
    let end = Math.min(safeTotal, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
};

const getCouponDiscountSplit = (order = {}) => {
    const type = String(order?.coupon_type || '').toLowerCase();
    const couponTotal = Number(order?.coupon_discount_value || 0);
    if (couponTotal <= 0) {
        return { productDiscount: 0, shippingDiscount: 0 };
    }
    if (type === 'shipping_full' || type === 'shipping_partial') {
        return { productDiscount: 0, shippingDiscount: couponTotal };
    }
    return { productDiscount: couponTotal, shippingDiscount: 0 };
};
const getOrderItemSnapshot = (item = {}) => {
    return item?.item_snapshot && typeof item.item_snapshot === 'object'
        ? item.item_snapshot
        : null;
};
const getOrderItemTitle = (item = {}) => {
    const snapshot = getOrderItemSnapshot(item);
    return item?.title || snapshot?.title || 'Product';
};
const getOrderItemVariantTitle = (item = {}) => {
    const snapshot = getOrderItemSnapshot(item);
    return item?.variant_title || snapshot?.variantTitle || '';
};
const getOrderItemCategoryLabel = (item = {}) => {
    const snapshot = getOrderItemSnapshot(item);
    const rawValue = item?.category_name
        || snapshot?.categoryName
        || snapshot?.category
        || snapshot?.primaryCategoryName
        || snapshot?.categoryTitle
        || snapshot?.category_name;
    if (rawValue) return String(rawValue).trim();
    const categoryList = snapshot?.categoryNames || snapshot?.categories || [];
    if (Array.isArray(categoryList) && categoryList.length > 0) {
        return categoryList
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
            .join(', ');
    }
    return '';
};
const getOrderItemImageUrl = (item = {}) => {
    const snapshot = getOrderItemSnapshot(item);
    return item?.image_url || snapshot?.imageUrl || '';
};
const getOrderCreatedTimestamp = (order = {}) => {
    const candidates = [
        order?.created_at,
        order?.createdAt,
        order?.updated_at,
        order?.updatedAt
    ];
    for (const value of candidates) {
        const ts = new Date(value || 0).getTime();
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    const numericId = Number(order?.id || 0);
    return Number.isFinite(numericId) ? numericId : 0;
};
const sortOrdersForView = (rows = [], sortBy = 'newest') => {
    const list = [...rows];
    const byCreatedDesc = (a, b) => getOrderCreatedTimestamp(b) - getOrderCreatedTimestamp(a);
    const byCreatedAsc = (a, b) => getOrderCreatedTimestamp(a) - getOrderCreatedTimestamp(b);
    if (sortBy === 'oldest') return list.sort(byCreatedAsc);
    if (sortBy === 'amount_high') return list.sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || byCreatedDesc(a, b));
    if (sortBy === 'amount_low') return list.sort((a, b) => Number(a.total || 0) - Number(b.total || 0) || byCreatedDesc(a, b));
    if (sortBy === 'priority') {
        const tierPriority = { platinum: 4, gold: 3, silver: 2, bronze: 1, regular: 0 };
        return list.sort((a, b) => {
            const aTier = String(a?.loyalty_tier || a?.loyaltyTier || 'regular').toLowerCase();
            const bTier = String(b?.loyalty_tier || b?.loyaltyTier || 'regular').toLowerCase();
            const diff = Number(tierPriority[bTier] ?? 0) - Number(tierPriority[aTier] ?? 0);
            if (diff !== 0) return diff;
            return byCreatedDesc(a, b);
        });
    }
    return list.sort(byCreatedDesc);
};

export function Orders({
    storefrontOpen = true,
    focusOrderId = null,
    onFocusHandled = () => {},
    initialStatusFilter = '',
    onInitialStatusApplied = () => {},
    initialQuickRange = '',
    onInitialQuickRangeApplied = () => {},
    initialStartDate = '',
    initialEndDate = '',
    onInitialDateRangeApplied = () => {},
    initialSortBy = '',
    onInitialSortApplied = () => {},
    initialSourceChannel = '',
    onInitialSourceChannelApplied = () => {},
    initialManualCustomerId = '',
    onInitialManualCustomerApplied = () => {}
}) {
    const toast = useToast();
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [metrics, setMetrics] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [draftStatusFilter, setDraftStatusFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [quickRange, setQuickRange] = useState('latest_10');
    const [draftQuickRange, setDraftQuickRange] = useState('latest_10');
    const [draftStartDate, setDraftStartDate] = useState('');
    const [draftEndDate, setDraftEndDate] = useState('');
    const [sourceChannel, setSourceChannel] = useState('all');
    const startDateInputRef = useRef(null);
    const endDateInputRef = useRef(null);
    const fetchSeqRef = useRef(0);
    const [sortBy, setSortBy] = useState('newest');
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [isMobileSortOpen, setIsMobileSortOpen] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [pendingStatus, setPendingStatus] = useState('');
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);
    const [detailsLastSyncedAt, setDetailsLastSyncedAt] = useState(null);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [cancellationMode, setCancellationMode] = useState('');
    const [manualRefundAmount, setManualRefundAmount] = useState('');
    const [manualRefundMethod, setManualRefundMethod] = useState('');
    const [manualRefundRef, setManualRefundRef] = useState('');
    const [manualRefundUtr, setManualRefundUtr] = useState('');
    const [isFetchingPaymentStatus, setIsFetchingPaymentStatus] = useState(false);
    const [attemptConversionMode, setAttemptConversionMode] = useState('cash');
    const [attemptConversionReference, setAttemptConversionReference] = useState('');
    const [attemptConversionReason, setAttemptConversionReason] = useState('');
    const [isConvertingAttempt, setIsConvertingAttempt] = useState(false);
    const [settlementContext, setSettlementContext] = useState({ mode: null, isTestMode: false });
    const [deletingOrderId, setDeletingOrderId] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [downloadingInvoiceId, setDownloadingInvoiceId] = useState(null);
    const [sendingInvoiceId, setSendingInvoiceId] = useState(null);
    const [printingLabelId, setPrintingLabelId] = useState(null);
    const [printingLabelType, setPrintingLabelType] = useState('');
    const [companyProfile, setCompanyProfile] = useState(null);
    const printerSupport = useMemo(() => getPrinterSupportState(), []);
    const preferredPrinterTransport = useMemo(() => getPreferredPrinterTransport(), []);
    const [preferredPrinter, setPreferredPrinter] = useState(() => getStoredPrinterPreference());
    const [labelPrintModalOrder, setLabelPrintModalOrder] = useState(null);
    const [isPrinterConnecting, setIsPrinterConnecting] = useState(false);
    const [selectedStatusCount, setSelectedStatusCount] = useState(0);
    const visiblePages = useMemo(() => buildVisiblePages(page, totalPages, 5), [page, totalPages]);
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Confirm',
        type: 'delete',
        action: null
    });
    const [isConfirmProcessing, setIsConfirmProcessing] = useState(false);
    const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
    const [manualCustomers, setManualCustomers] = useState([]);
    const [isManualCustomersLoading, setIsManualCustomersLoading] = useState(false);
    const [manualCustomerQuery, setManualCustomerQuery] = useState('');
    const [manualOrderForm, setManualOrderForm] = useState({
        userId: '',
        mobile: '',
        paymentMode: 'cash',
        paymentReference: '',
        couponCode: '',
        shippingAddress: { ...EMPTY_ADDRESS },
        billingAddress: { ...EMPTY_ADDRESS },
        billingSameAsShipping: true
    });
    const [manualDraftItem, setManualDraftItem] = useState({ ...EMPTY_MANUAL_ITEM });
    const [manualOrderItems, setManualOrderItems] = useState([]);
    const [manualProducts, setManualProducts] = useState([]);
    const [manualProductQuery, setManualProductQuery] = useState('');
    const [isManualProductsLoading, setIsManualProductsLoading] = useState(false);
    const [isManualCustomersFetchingMore, setIsManualCustomersFetchingMore] = useState(false);
    const [isManualProductsFetchingMore, setIsManualProductsFetchingMore] = useState(false);
    const [manualCoupons, setManualCoupons] = useState([]);
    const [isManualCouponsLoading, setIsManualCouponsLoading] = useState(false);
    const [manualSummary, setManualSummary] = useState(null);
    const [isManualSummaryLoading, setIsManualSummaryLoading] = useState(false);
    const [manualSummaryError, setManualSummaryError] = useState('');
    const [manualCouponError, setManualCouponError] = useState('');
    const [isCreatingManualOrder, setIsCreatingManualOrder] = useState(false);
    const [manualCreateAttempted, setManualCreateAttempted] = useState(false);
    const [manualCartTouched, setManualCartTouched] = useState(false);
    const customerFetchSeqRef = useRef(0);
    const productFetchSeqRef = useRef(0);
    const {
        orderMetricsByKey,
        registerOrderMetricsQuery,
        setOrderMetricsSnapshot,
        markOrderMetricsDirty,
        fetchOrderMetrics,
        toOrderMetricsKey
    } = useAdminKPI();
    const metricsQuery = useMemo(() => ({
        search,
        startDate,
        endDate,
        quickRange,
        sourceChannel,
        status: statusFilter
    }), [endDate, quickRange, search, sourceChannel, startDate, statusFilter]);
    const metricsKey = toOrderMetricsKey(metricsQuery);
    const sharedMetrics = orderMetricsByKey[metricsKey]?.metrics || null;
    const getPaymentMethodLabel = (order) => {
        const method = String(order?.payment_gateway || order?.paymentGateway || 'razorpay').toLowerCase();
        if (method === 'razorpay') return 'Razorpay';
        if (method === 'cod') return 'Online Payment';
        return method ? method.toUpperCase() : '—';
    };
    const getPaymentReference = (order) => order?.razorpay_payment_id || order?.razorpayPaymentId || '—';
    const getInvoiceNumber = (order) => {
        const ref = order?.order_ref || order?.orderRef || order?.id || 'N/A';
        return `INV-${ref}`;
    };
    const getPaymentStatusLabel = (order) => {
        const status = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
        if (!status) return '—';
        return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
    };
    const getTierLabel = (order) => {
        const tier = String(order?.loyalty_tier || order?.loyaltyTier || 'regular').toLowerCase();
        if (tier === 'regular') return 'Basic';
        return `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
    };
    const getTierBadgeClasses = (order) => {
        const tier = String(order?.loyalty_tier || order?.loyaltyTier || 'regular').toLowerCase();
        if (tier === 'platinum') return 'bg-sky-900 text-sky-50 border border-sky-600';
        if (tier === 'gold') return 'bg-yellow-800 text-yellow-50 border border-yellow-600';
        if (tier === 'silver') return 'bg-slate-700 text-slate-50 border border-slate-500';
        if (tier === 'bronze') return 'bg-amber-900 text-amber-50 border border-amber-600';
        return 'bg-gray-700 text-gray-50 border border-gray-500';
    };
    const isAttemptEntry = (order) => String(order?.entity_type || '').toLowerCase() === 'attempt';
    const isAbandonedRecoveryOrder = (order) => Boolean(order?.is_abandoned_recovery || order?.source_channel === 'abandoned_recovery');
    const formatRangeDate = (value) => {
        if (!value) return '—';
        return formatAdminDate(`${value}T00:00:00`);
    };
    const isFailedRow = (order) => String(order?.status || '').toLowerCase() === 'failed';
    const getRowKey = (order) => {
        if (isAttemptEntry(order)) return `attempt:${order?.attempt_id || order?.id}`;
        return `order:${order?.order_id || order?.id}`;
    };
    const isPaidPayment = (order) => String(order?.payment_status || '').toLowerCase() === 'paid';
    const canDeleteRow = (order) => !isPaidPayment(order);
    const canDownloadInvoice = (order) => {
        if (isAttemptEntry(order)) return false;
        const status = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
        return status === 'paid' || status === 'refunded';
    };
    const getFromLabelValidation = useCallback((order) => {
        if (!companyProfile) {
            return { ok: false, missing: ['company profile'] };
        }
        return validateFromLabelData(companyProfile, order);
    }, [companyProfile]);
    const getToLabelValidation = useCallback((order) => validateToLabelData(order), []);
    const canOpenShippingLabelModal = useCallback((order) => {
        if (isAttemptEntry(order)) return false;
        return getFromLabelValidation(order).ok || getToLabelValidation(order).ok;
    }, [getFromLabelValidation, getToLabelValidation]);
    const needsSettlementSync = (order) => {
        if (!order || isAttemptEntry(order)) return false;
        const paymentStatus = String(order?.payment_status || '').toLowerCase();
        return paymentStatus === 'paid'
            && Boolean(order?.razorpay_order_id || order?.razorpay_payment_id)
            && !order?.settlement_snapshot;
    };
    const canFetchPaymentStatus = (order) => {
        if (!order?.razorpay_order_id && !order?.razorpay_payment_id) return false;
        const paymentStatus = String(order?.payment_status || '').toLowerCase();
        if (['pending', 'created', 'attempted'].includes(paymentStatus)) return true;
        return paymentStatus === 'paid' && needsSettlementSync(order);
    };
    const filteredManualCustomers = useMemo(() => {
        const term = String(manualCustomerQuery || '').trim().toLowerCase();
        const rows = Array.isArray(manualCustomers) ? manualCustomers : [];
        if (!term) return rows;
        return rows.filter((customer) => {
            const haystack = [
                customer?.name,
                customer?.mobile,
                customer?.email
            ].map((v) => String(v || '').toLowerCase()).join(' ');
            return haystack.includes(term);
        });
    }, [manualCustomerQuery, manualCustomers]);
    const selectedManualCustomer = useMemo(
        () => (manualCustomers || []).find((row) => String(row?.id) === String(manualOrderForm.userId || '')) || null,
        [manualCustomers, manualOrderForm.userId]
    );
    const manualItemPayload = useMemo(() => (
        (manualOrderItems || [])
            .map((row) => ({
                productId: String(row?.productId || '').trim(),
                variantId: String(row?.variantId || '').trim(),
                quantity: Number(row?.quantity || 0)
            }))
            .filter((row) => row.productId && Number.isFinite(row.quantity) && row.quantity > 0)
    ), [manualOrderItems]);
    const isVariantInStock = (variant = {}) => {
        const track = String(variant?.track_quantity) === '1' || variant?.track_quantity === true;
        if (!track) return true;
        return Number(variant?.quantity || 0) > 0;
    };
    const isProductInStock = (product = {}) => {
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length > 0) return variants.some((variant) => isVariantInStock(variant));
        const track = String(product?.track_quantity) === '1' || product?.track_quantity === true;
        if (!track) return true;
        return Number(product?.quantity || 0) > 0;
    };
    const activeInStockProducts = useMemo(() => (
        (manualProducts || []).filter((product) =>
            String(product?.status || '').toLowerCase() === 'active' && isProductInStock(product)
        )
    ), [manualProducts]);
    const filteredManualProducts = useMemo(() => {
        const term = String(manualProductQuery || '').trim().toLowerCase();
        const rows = Array.isArray(activeInStockProducts) ? activeInStockProducts : [];
        if (!term) return rows;
        return rows.filter((product) => {
            const haystack = [
                product?.title,
                product?.sku,
                ...(Array.isArray(product?.variants) ? product.variants.map((v) => `${v?.variant_title || ''} ${v?.sku || ''}`) : [])
            ].map((v) => String(v || '').toLowerCase()).join(' ');
            return haystack.includes(term);
        });
    }, [activeInStockProducts, manualProductQuery]);
    const manualCartDisplayItems = useMemo(() => (
        (manualOrderItems || [])
            .filter((row) => String(row?.productId || '').trim())
            .map((row, idx) => {
            const product = (manualProducts || []).find((entry) => String(entry?.id || '') === String(row?.productId || ''));
            const variants = Array.isArray(product?.variants) ? product.variants : [];
            const variant = variants.find((entry) => String(entry?.id || '') === String(row?.variantId || ''));
            const qty = Math.max(1, Number(row?.quantity || 1));
            const unitPrice = Number(row?.unitPrice ?? getManualUnitPrice(product, variant));
            return {
                id: `${row?.productId || 'p'}:${row?.variantId || ''}:${idx}`,
                productId: row?.productId || '',
                variantId: row?.variantId || '',
                title: row?.title || product?.title || `Product #${row?.productId || ''}`,
                variantTitle: row?.variantTitle || variant?.variant_title || '',
                quantity: qty,
                lineTotal: Number((unitPrice * qty).toFixed(2))
            };
            })
    ), [manualOrderItems, manualProducts]);
    const fallbackManualSummary = useMemo(() => {
        const subtotal = (manualCartDisplayItems || []).reduce((sum, item) => sum + Number(item?.lineTotal || 0), 0);
        return {
            subtotal,
            shippingFee: null,
            couponDiscountTotal: null,
            loyaltyDiscountTotal: null,
            loyaltyShippingDiscountTotal: null,
            taxTotal: null,
            total: subtotal
        };
    }, [manualCartDisplayItems]);
    const syncManualOrderItemsFromUserCart = useCallback(async (userId) => {
        const id = String(userId || '').trim();
        if (!id) {
            setManualOrderItems([]);
            return [];
        }
        const data = await adminService.getUserCart(id);
        const rows = Array.isArray(data?.items) ? data.items : [];
        const normalizedRows = rows.map((item) => ({
            productId: String(item?.productId || ''),
            variantId: String(item?.variantId || ''),
            quantity: Math.max(1, Number(item?.quantity || 1)),
            title: String(item?.title || '').trim(),
            variantTitle: String(item?.variantTitle || '').trim(),
            unitPrice: Number(item?.price || 0)
        }));
        setManualOrderItems(normalizedRows);
        return normalizedRows;
    }, []);
    const refreshManualCartDerivedData = useCallback(async (userId, cartRows = null) => {
        const id = String(userId || '').trim();
        if (!id) return;
        const rows = Array.isArray(cartRows) ? cartRows : await syncManualOrderItemsFromUserCart(id);
        setIsManualCouponsLoading(true);
        try {
            const data = await adminService.getUserAvailableCoupons(id);
            const coupons = Array.isArray(data?.coupons) ? data.coupons : [];
            setManualCoupons(coupons);
            setManualCouponError('');
            const selectedCode = String(manualOrderForm.couponCode || '').trim().toUpperCase();
            if (selectedCode && !coupons.some((row) => String(row?.code || '').trim().toUpperCase() === selectedCode && row?.isEligible !== false)) {
                setManualOrderForm((prev) => ({ ...prev, couponCode: '' }));
            }
        } catch (error) {
            setManualCoupons([]);
            setManualCouponError(String(error?.message || 'Failed to load coupons'));
        } finally {
            setIsManualCouponsLoading(false);
        }

        if (!(rows || []).length) {
            setManualSummary(null);
            setManualSummaryError('');
            return;
        }
        const preferredShipping = resolvePrimaryAddress(manualOrderForm.shippingAddress, manualOrderForm.billingAddress);
        if (!isAddressComplete(preferredShipping)) {
            setManualSummary(null);
            setManualSummaryError('Shipping address is incomplete. Fill Address line, City, State, and PIN code.');
            return;
        }
        setIsManualSummaryLoading(true);
        try {
            const data = await adminService.getUserCartSummary(id, {
                couponCode: manualOrderForm.couponCode || '',
                shippingAddress: preferredShipping
            });
            setManualSummary(data?.summary || null);
            setManualSummaryError('');
        } catch (error) {
            setManualSummary(null);
            setManualSummaryError(String(error?.message || 'Failed to calculate order pricing'));
        } finally {
            setIsManualSummaryLoading(false);
        }
    }, [manualOrderForm.billingAddress, manualOrderForm.couponCode, manualOrderForm.shippingAddress, syncManualOrderItemsFromUserCart]);
    const effectiveManualSummary = useMemo(() => {
        if (manualSummary) return manualSummary;
        if ((manualOrderItems || []).length > 0) return fallbackManualSummary;
        return null;
    }, [fallbackManualSummary, manualOrderItems, manualSummary]);
    const isAddressComplete = (address = null) => {
        const value = address || {};
        return ['line1', 'city', 'state', 'zip'].every((field) => String(value?.[field] || '').trim());
    };
    const getMissingAddressFields = (address = null) => {
        const value = address || {};
        const labels = { line1: 'Address line', city: 'City', state: 'State', zip: 'PIN code' };
        return ['line1', 'city', 'state', 'zip']
            .filter((field) => !String(value?.[field] || '').trim())
            .map((field) => labels[field]);
    };
    const resolvePrimaryAddress = (shippingAddress = null, billingAddress = null) => {
        if (isAddressComplete(shippingAddress)) return shippingAddress;
        if (isAddressComplete(billingAddress)) return billingAddress;
        return shippingAddress || billingAddress || { ...EMPTY_ADDRESS };
    };
    const formatInrOrDash = (value) => {
        if (value == null || Number.isNaN(Number(value))) return '—';
        return `₹${Number(value).toLocaleString('en-IN')}`;
    };
    const effectiveBillingAddress = useMemo(
        () => (!billingAddressEnabled || manualOrderForm.billingSameAsShipping ? manualOrderForm.shippingAddress : manualOrderForm.billingAddress),
        [manualOrderForm.billingAddress, manualOrderForm.billingSameAsShipping, manualOrderForm.shippingAddress]
    );
    const resolvedManualMobile = useMemo(
        () => normalizeMobileDigits(selectedManualCustomer?.mobile || manualOrderForm.mobile || ''),
        [manualOrderForm.mobile, selectedManualCustomer?.mobile]
    );
    const customerNeedsManualMobile = useMemo(
        () => Boolean(manualOrderForm.userId) && !normalizeMobileDigits(selectedManualCustomer?.mobile || ''),
        [manualOrderForm.userId, selectedManualCustomer?.mobile]
    );
    const isManualMobileValid = useMemo(
        () => resolvedManualMobile.length >= 10 && resolvedManualMobile.length <= 14,
        [resolvedManualMobile]
    );
    const manualValidationState = useMemo(() => {
        const shippingMissing = getMissingAddressFields(manualOrderForm.shippingAddress);
        const billingMissing = (!billingAddressEnabled || manualOrderForm.billingSameAsShipping) ? [] : getMissingAddressFields(manualOrderForm.billingAddress);
        return {
            missingCustomer: !manualOrderForm.userId,
            missingCustomerMobile: !resolvedManualMobile,
            invalidCustomerMobile: Boolean(resolvedManualMobile) && !isManualMobileValid,
            missingItems: manualItemPayload.length === 0,
            shippingMissing,
            billingMissing
        };
    }, [isManualMobileValid, manualItemPayload.length, manualOrderForm.billingAddress, manualOrderForm.billingSameAsShipping, manualOrderForm.shippingAddress, manualOrderForm.userId, resolvedManualMobile]);
    const canSubmitManualOrder = useMemo(() => {
        if (!manualOrderForm.userId) return false;
        if (!resolvedManualMobile || !isManualMobileValid) return false;
        if (!isAddressComplete(manualOrderForm.shippingAddress)) return false;
        if (!isAddressComplete(effectiveBillingAddress)) return false;
        if (!manualItemPayload.length) return false;
        return true;
    }, [effectiveBillingAddress, isManualMobileValid, manualItemPayload.length, manualOrderForm.shippingAddress, manualOrderForm.userId, resolvedManualMobile]);
    const hasManualVariantGaps = useMemo(() => {
        for (const row of (manualOrderItems || [])) {
            const productId = String(row?.productId || '').trim();
            if (!productId) continue;
            const selectedProduct = (manualProducts || []).find((p) => String(p?.id || '') === productId);
            const hasVariants = Array.isArray(selectedProduct?.variants) && selectedProduct.variants.length > 0;
            if (hasVariants && !String(row?.variantId || '').trim()) return true;
        }
        return false;
    }, [manualOrderItems, manualProducts]);
    const getRefundAmount = (order) => Number(order?.refund_amount ?? order?.refundAmount ?? 0);
    const getRefundReference = (order) => order?.refund_reference || order?.refundReference || '';
    const getRefundVoucherCode = (order) => {
        const direct = String(order?.refund_coupon_code || '').trim();
        if (direct) return direct;
        const notes = (order?.refund_notes && typeof order.refund_notes === 'object') ? order.refund_notes : {};
        const fallback = String(
            notes?.refund_coupon_code
            || notes?.refundCouponCode
            || notes?.voucherCode
            || notes?.couponCode
            || notes?.issuedCouponCode
            || ''
        ).trim();
        return fallback;
    };
    const hasRefundInitiated = (order) => Boolean(
        getRefundReference(order)
        || String(order?.refund_status || '').trim()
        || String(order?.payment_status || '').toLowerCase() === 'refunded'
        || getRefundAmount(order) > 0
    );
    const isRefundLockedOrder = (order) => (
        String(order?.status || '').toLowerCase() === 'cancelled'
        && hasRefundInitiated(order)
    );
    const canCheckRefundStatus = (order) => {
        if (!order || isAttemptEntry(order)) return false;
        if (!hasRefundInitiated(order)) return false;
        return Boolean(order?.razorpay_order_id || order?.razorpay_payment_id);
    };
    const formatSettlementAmount = (value) => `₹${(Number(value || 0) / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
    const patchOrderRow = useCallback((nextOrder) => {
        if (!nextOrder?.id) return;
        setOrders((prev) => {
            const nextRow = { ...nextOrder, entity_type: 'order', order_id: nextOrder.id };
            const matchesCurrentFilter = orderMatchesStatusFilter(nextRow, statusFilter);
            const idx = prev.findIndex((row) =>
                !isAttemptEntry(row) && String(row.order_id || row.id) === String(nextOrder.id)
            );
            if (idx >= 0) {
                if (!matchesCurrentFilter) {
                    return prev.filter((row) => String(row.order_id || row.id) !== String(nextOrder.id));
                }
                const copy = [...prev];
                copy[idx] = { ...copy[idx], ...nextRow };
                return sortOrdersForView(copy, sortBy);
            }
            if (page === 1 && matchesCurrentFilter) {
                return sortOrdersForView([nextRow, ...prev], sortBy);
            }
            return prev;
        });
    }, [page, sortBy, statusFilter]);
    const patchAttemptRow = useCallback((attempt) => {
        if (!attempt?.id) return;
        setOrders((prev) => {
            const idx = prev.findIndex((row) => String(row.attempt_id || row.id) === String(attempt.id));
            if (idx < 0) return prev;
            const copy = [...prev];
            copy[idx] = {
                ...copy[idx],
                payment_status: attempt.status || copy[idx].payment_status,
                razorpay_payment_id: attempt.razorpay_payment_id || copy[idx].razorpay_payment_id,
                failure_reason: attempt.failure_reason || copy[idx].failure_reason
            };
            return copy;
        });
    }, []);
    const removeRow = useCallback((id, type = 'order') => {
        if (!id) return;
        setOrders((prev) => prev.filter((row) => {
            if (type === 'attempt') return String(row.attempt_id || row.id) !== String(id);
            return String(row.order_id || row.id) !== String(id);
        }));
    }, []);

    const fetchOrders = useCallback(async () => {
        const requestSeq = ++fetchSeqRef.current;
        setIsLoading(true);
        try {
            const listParams = {
                page,
                status: statusFilter,
                search,
                startDate,
                endDate,
                quickRange,
                sortBy,
                sourceChannel,
                limit: quickRange === 'latest_10' ? 10 : 12
            };
            const listData = await orderService.getAdminOrders(listParams);
            if (requestSeq !== fetchSeqRef.current) return;

            setOrders(sortOrdersForView(listData.orders || [], sortBy));
            setSelectedStatusCount(Number(listData?.pagination?.totalOrders || 0));
            const resolvedMetrics = listData?.metrics || null;
            setMetrics(resolvedMetrics);
            if (resolvedMetrics) {
                setOrderMetricsSnapshot(metricsQuery, resolvedMetrics);
            }
            setTotalPages(listData.pagination?.totalPages || 1);
        } catch (error) {
            toast.error(error.message || 'Failed to load orders');
        } finally {
            if (requestSeq === fetchSeqRef.current) {
                setIsLoading(false);
            }
        }
    }, [endDate, metricsQuery, page, quickRange, search, setOrderMetricsSnapshot, sortBy, sourceChannel, startDate, statusFilter, toast]);

    useEffect(() => {
        registerOrderMetricsQuery(metricsQuery);
        fetchOrderMetrics(metricsQuery).catch(() => {});
    }, [fetchOrderMetrics, metricsQuery, registerOrderMetricsQuery]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    useEffect(() => {
        let active = true;
        adminService.getCompanyInfo()
            .then((data) => {
                if (!active) return;
                setCompanyProfile(data?.company || null);
            })
            .catch(() => {
                if (!active) return;
                setCompanyProfile(null);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!selectedOrder) return;
        setPendingStatus(normalizeOrderStatus(selectedOrder.status || 'confirmed'));
        setCancellationMode('');
        setManualRefundAmount('');
        setManualRefundMethod('');
        setManualRefundRef('');
        setManualRefundUtr('');
    }, [selectedOrder?.id, selectedOrder?.status]);

    const handleOrderRealtimeUpdate = useCallback((payload = {}) => {
            if (payload?.deleted && payload?.orderId) {
                removeRow(payload.orderId, 'order');
                orderService.removeAdminEntityCache({ id: payload.orderId, entityType: 'order' });
                markOrderMetricsDirty(metricsQuery);
                fetchOrderMetrics(metricsQuery, { force: true }).catch(() => {});
                return;
            }
            if (payload?.order && selectedOrder?.id && String(payload.order.id) === String(selectedOrder.id)) {
                setSelectedOrder((prev) => ({ ...prev, ...payload.order }));
            }
            if (payload?.order) {
                orderService.patchAdminOrderCache(payload.order);
                patchOrderRow(payload.order);
                markOrderMetricsDirty(metricsQuery);
                fetchOrderMetrics(metricsQuery, { force: true }).catch(() => {});
            }
        }, [fetchOrderMetrics, markOrderMetricsDirty, metricsQuery, patchOrderRow, removeRow, selectedOrder?.id]);

    useAdminCrudSync({
        'order:create': handleOrderRealtimeUpdate,
        'order:update': handleOrderRealtimeUpdate,
        'payment:update': handleOrderRealtimeUpdate
    });

    useEffect(() => {
        const timer = setTimeout(() => {
            if (search === searchInput) return;
            setSearch(searchInput);
            setPage(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [search, searchInput]);

    useEffect(() => {
        const next = String(initialStatusFilter || '').trim().toLowerCase();
        if (!next || next === 'all') return;
        setDraftStatusFilter(next);
        if (statusFilter !== next) {
            setStatusFilter(next);
        }
        if (page !== 1) {
            setPage(1);
        }
        onInitialStatusApplied(next);
    }, [initialStatusFilter, onInitialStatusApplied, page, statusFilter]);

    useEffect(() => {
        const nextRange = String(initialQuickRange || '').trim().toLowerCase();
        if (!nextRange) return;
        setDraftQuickRange(nextRange);
        if (quickRange !== nextRange) {
            setQuickRange(nextRange);
        }
        if (page !== 1) {
            setPage(1);
        }
        onInitialQuickRangeApplied(nextRange);
    }, [initialQuickRange, onInitialQuickRangeApplied, page, quickRange]);

    useEffect(() => {
        const hasStart = String(initialStartDate || '').trim().length > 0;
        const hasEnd = String(initialEndDate || '').trim().length > 0;
        if (!hasStart && !hasEnd) return;
        const nextStart = hasStart ? String(initialStartDate).trim() : '';
        const nextEnd = hasEnd ? String(initialEndDate).trim() : '';
        setDraftQuickRange('custom');
        setDraftStartDate(nextStart);
        setDraftEndDate(nextEnd);
        setQuickRange('custom');
        setStartDate(nextStart);
        setEndDate(nextEnd);
        if (page !== 1) {
            setPage(1);
        }
        onInitialDateRangeApplied();
    }, [initialEndDate, initialStartDate, onInitialDateRangeApplied, page]);

    useEffect(() => {
        const nextSort = String(initialSortBy || '').trim().toLowerCase();
        if (!nextSort) return;
        setSortBy(nextSort);
        if (page !== 1) {
            setPage(1);
        }
        onInitialSortApplied(nextSort);
    }, [initialSortBy, onInitialSortApplied, page]);

    useEffect(() => {
        const nextChannel = String(initialSourceChannel || '').trim().toLowerCase();
        if (!nextChannel) return;
        setSourceChannel(nextChannel);
        if (page !== 1) {
            setPage(1);
        }
        onInitialSourceChannelApplied(nextChannel);
    }, [initialSourceChannel, onInitialSourceChannelApplied, page]);

    const handleStatusFilterChange = (nextStatus) => {
        setDraftStatusFilter(nextStatus);
        if (statusFilter !== nextStatus) {
            setStatusFilter(nextStatus);
            setPage(1);
        }
    };

    const handleApplyFilters = (closeAfter = false) => {
        const nextQuickRange = draftQuickRange;
        const nextStartDate = nextQuickRange === 'custom' ? draftStartDate : '';
        const nextEndDate = nextQuickRange === 'custom' ? draftEndDate : '';
        const start = toDateOnly(nextStartDate);
        const end = toDateOnly(nextEndDate);
        if (nextQuickRange === 'custom' && start && end) {
            const span = diffInDays(start, end);
            if (span > MAX_RANGE_DAYS) {
                toast.error(`Custom range cannot exceed ${MAX_RANGE_DAYS} days`);
                return;
            }
        }
        const hasChanges = (
            statusFilter !== draftStatusFilter ||
            quickRange !== nextQuickRange ||
            startDate !== nextStartDate ||
            endDate !== nextEndDate
        );

        setStatusFilter(draftStatusFilter);
        setQuickRange(nextQuickRange);
        setStartDate(nextStartDate);
        setEndDate(nextEndDate);
        if (closeAfter) {
            setIsFilterModalOpen(false);
        }

        if (page !== 1) {
            setPage(1);
            return;
        }
        if (!hasChanges) {
            fetchOrders();
        }
    };

    const toCsvCell = (value) => {
        const safe = String(value ?? '').replace(/"/g, '""');
        return `"${safe}"`;
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            let currentPage = 1;
            const batchLimit = quickRange === 'latest_10' ? 10 : 200;
            const exportRows = [];

            while (currentPage <= 100) {
                const data = await orderService.getAdminOrders({
                    page: currentPage,
                    limit: batchLimit,
                    status: statusFilter,
                    search,
                    startDate,
                    endDate,
                    quickRange,
                    sortBy,
                    sourceChannel
                });
                const pageOrders = data.orders || [];
                exportRows.push(...pageOrders);
                if (currentPage >= (data.pagination?.totalPages || 1) || pageOrders.length === 0) break;
                currentPage += 1;
            }

            if (exportRows.length === 0) {
                toast.error('No orders found for the selected filters');
                return;
            }

            const header = [
                'Order Ref',
                'Order Date',
                'Customer',
                'Mobile',
                'Member Tier',
                'Status',
                'Payment Status',
                'Payment Ref',
                'Settlement Status',
                'Settlement Date',
                'Subtotal',
                'Shipping',
                'Coupon Discount',
                'Member Discount',
                'Member Shipping Benefit',
                'Discount',
                'Tax',
                'Total',
                'Coupon Code',
                'Source Channel'
            ].join(',');

            const lines = exportRows.map((order) => ([
                toCsvCell(order.order_ref),
                toCsvCell(formatAdminDate(order.created_at)),
                toCsvCell(order.customer_name || 'Guest'),
                toCsvCell(order.customer_mobile || ''),
                toCsvCell(getTierLabel(order)),
                toCsvCell(order.status || 'pending'),
                toCsvCell(getPaymentStatusLabel(order)),
                toCsvCell(getPaymentReference(order)),
                toCsvCell(order?.settlement_snapshot?.status || '—'),
                toCsvCell(order?.settlement_snapshot?.created_at ? formatAdminDateTime(new Date(Number(order.settlement_snapshot.created_at) * 1000).toISOString()) : '—'),
                toCsvCell(Number(order.subtotal || 0).toFixed(2)),
                toCsvCell(Number(order.shipping_fee || 0).toFixed(2)),
                toCsvCell(Number(order.coupon_discount_value || 0).toFixed(2)),
                toCsvCell(Number(order.loyalty_discount_total || 0).toFixed(2)),
                toCsvCell(Number(order.loyalty_shipping_discount_total || 0).toFixed(2)),
                toCsvCell(Number(order.discount_total || 0).toFixed(2)),
                toCsvCell(Number(order.tax_total || 0).toFixed(2)),
                toCsvCell(Number(order.total || 0).toFixed(2)),
                toCsvCell(order.coupon_code || ''),
                toCsvCell(order.source_channel || '')
            ].join(',')));

            const csv = [header, ...lines].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `orders-report-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            toast.error(error.message || 'Failed to export order report');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadInvoice = async (order, e = null) => {
        if (e) e.stopPropagation();
        if (!order || isAttemptEntry(order) || !canDownloadInvoice(order)) return;
        const targetId = order.order_id || order.id;
        setDownloadingInvoiceId(targetId);
        try {
            await orderService.downloadAdminInvoice(targetId);
        } catch (error) {
            toast.error(error.message || 'Unable to generate invoice');
        } finally {
            setDownloadingInvoiceId(null);
        }
    };

    const handleSendInvoiceCommunication = async (order, e = null) => {
        if (e) e.stopPropagation();
        if (!order || isAttemptEntry(order) || !canDownloadInvoice(order)) return;
        const targetId = order.order_id || order.id;
        setSendingInvoiceId(targetId);
        try {
            const response = await orderService.sendAdminInvoiceCommunication(targetId);
            if (response?.queued === true) {
                toast.success(response?.message || 'Invoice communication queued');
                return;
            }
            const emailSent = response?.delivery?.email?.ok === true;
            const whatsappSent = response?.delivery?.whatsapp?.ok === true;
            if (emailSent && whatsappSent) {
                toast.success('Invoice sent to customer via email and WhatsApp');
                return;
            }
            if (emailSent || whatsappSent) {
                const sentChannels = [emailSent ? 'email' : '', whatsappSent ? 'WhatsApp' : ''].filter(Boolean).join(' + ');
                toast.success(`Invoice sent via ${sentChannels}`);
                return;
            }
            toast.error('Invoice could not be sent on email/WhatsApp for this customer');
        } catch (error) {
            toast.error(error.message || 'Unable to send invoice to customer');
        } finally {
            setSendingInvoiceId(null);
        }
    };
    const closeLabelPrintModal = useCallback(() => {
        if (printingLabelId || isPrinterConnecting) return;
        setLabelPrintModalOrder(null);
    }, [isPrinterConnecting, printingLabelId]);

    const handleOpenPrintLabelModal = (order, e = null) => {
        if (e) e.stopPropagation();
        if (!order || isAttemptEntry(order)) return;
        setLabelPrintModalOrder(order);
    };

    const handleConnectLabelPrinter = async (transport = preferredPrinterTransport) => {
        if (!printerSupport.supported) {
            toast.error(printerSupport.reason);
            return;
        }
        setIsPrinterConnecting(true);
        try {
            const printer = await configurePreferredPrinter({ transport });
            const storedPrinter = getStoredPrinterPreference();
            setPreferredPrinter(storedPrinter);
            const transportLabel = String(printer?.transport || transport).toLowerCase() === 'usb' ? 'USB' : 'Bluetooth';
            toast.success(`${printer?.name || 'Printer'} paired over ${transportLabel}`);
        } catch (error) {
            toast.error(error?.message || 'Failed to pair printer');
        } finally {
            setIsPrinterConnecting(false);
        }
    };

    const handlePrintSingleLabel = async (type, order) => {
        if (!printerSupport.supported) {
            toast.error(printerSupport.reason);
            return;
        }
        const validation = type === 'from' ? getFromLabelValidation(order) : getToLabelValidation(order);
        if (!validation.ok) {
            toast.error(`${type === 'from' ? 'From' : 'To'} label unavailable: missing ${validation.missing.join(', ')}`);
            return;
        }
        setPrintingLabelId(order.order_id || order.id);
        setPrintingLabelType(type);
        try {
            let result;
            try {
                result = type === 'from'
                    ? await printFromLabel({
                        order,
                        companyProfile,
                        forceReconnect: false,
                        transport: preferredPrinterTransport,
                        onProgress: () => {}
                    })
                    : await printToLabel({
                        order,
                        forceReconnect: false,
                        transport: preferredPrinterTransport,
                        onProgress: () => {}
                    });
            } catch (error) {
                result = type === 'from'
                    ? await printFromLabel({
                        order,
                        companyProfile,
                        forceReconnect: true,
                        transport: preferredPrinterTransport,
                        onProgress: () => {}
                    }).catch(() => { throw error; })
                    : await printToLabel({
                        order,
                        forceReconnect: true,
                        transport: preferredPrinterTransport,
                        onProgress: () => {}
                    }).catch(() => { throw error; });
            }
            const transportLabel = String(result?.printer?.transport || '').toLowerCase() === 'usb' ? 'USB' : 'Bluetooth';
            setPreferredPrinter(getStoredPrinterPreference());
            toast.success(`${type === 'from' ? 'From' : 'To'} label printed for ${order.order_ref} via ${transportLabel}`);
        } catch (error) {
            toast.error(error?.message || `Failed to print ${type} label`);
        } finally {
            setPrintingLabelId(null);
            setPrintingLabelType('');
        }
    };

    const normalizeUserAddress = (address = null) => {
        if (!address || typeof address !== 'object') return { ...EMPTY_ADDRESS };
        return {
            line1: String(address.line1 || address.address1 || address.street || address.address || '').trim(),
            city: String(address.city || address.town || '').trim(),
            state: String(address.state || address.province || '').trim(),
            zip: String(address.zip || address.pincode || address.pin || address.postalCode || '').trim()
        };
    };

    const loadManualCustomers = useCallback(async (query = '') => {
        const seq = ++customerFetchSeqRef.current;
        setIsManualCustomersLoading(true);
        try {
            const first = await adminService.getUsers(1, 'customer', 50, query);
            if (seq !== customerFetchSeqRef.current) return;
            const normalizeRows = (rows = []) => rows.map((row) => ({
                ...row,
                address: normalizeUserAddress(row?.address),
                billingAddress: normalizeUserAddress(row?.billingAddress || row?.address)
            }));
            const firstRows = normalizeRows(first?.users || []);
            setManualCustomers(firstRows);
            const totalPages = Math.max(1, Number(first?.pagination?.totalPages || 1));
            if (totalPages > 1) setIsManualCustomersFetchingMore(true);
            for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
                const next = await adminService.getUsers(pageNo, 'customer', 50, query);
                if (seq !== customerFetchSeqRef.current) return;
                const nextRows = normalizeRows(next?.users || []);
                setManualCustomers((prev) => {
                    const seen = new Set((prev || []).map((entry) => String(entry.id)));
                    const merged = [...(prev || [])];
                    for (const row of nextRows) {
                        if (!seen.has(String(row.id))) {
                            merged.push(row);
                        }
                    }
                    return merged;
                });
            }
        } catch (error) {
            if (seq === customerFetchSeqRef.current) {
                toast.error(error?.message || 'Failed to load customers');
            }
        } finally {
            if (seq === customerFetchSeqRef.current) {
                setIsManualCustomersLoading(false);
                setIsManualCustomersFetchingMore(false);
            }
        }
    }, [toast]);

    const loadManualProducts = useCallback(async (query = '') => {
        const seq = ++productFetchSeqRef.current;
        setIsManualProductsLoading(true);
        try {
            const term = String(query || '').trim();
            if (term) {
                const data = await productService.searchProducts({
                    query: term,
                    page: 1,
                    limit: 60,
                    category: 'all',
                    status: 'active',
                    sort: 'relevance',
                    inStockOnly: true
                });
                if (seq !== productFetchSeqRef.current) return;
                setManualProducts(Array.isArray(data?.products) ? data.products : []);
            } else {
                const first = await productService.getProducts(1, 'all', 'active', 'newest', 100);
                if (seq !== productFetchSeqRef.current) return;
                const firstRows = Array.isArray(first?.products) ? first.products : [];
                setManualProducts(firstRows);
                const totalPages = Math.max(1, Number(first?.totalPages || 1));
                if (totalPages > 1) setIsManualProductsFetchingMore(true);
                for (let pageNo = 2; pageNo <= Math.min(totalPages, 8); pageNo += 1) {
                    const next = await productService.getProducts(pageNo, 'all', 'active', 'newest', 100);
                    if (seq !== productFetchSeqRef.current) return;
                    const nextRows = Array.isArray(next?.products) ? next.products : [];
                    setManualProducts((prev) => {
                        const seen = new Set((prev || []).map((entry) => String(entry.id)));
                        const merged = [...(prev || [])];
                        for (const row of nextRows) {
                            if (!seen.has(String(row.id))) merged.push(row);
                        }
                        return merged;
                    });
                }
            }
        } catch (error) {
            if (seq === productFetchSeqRef.current) {
                toast.error(error?.message || 'Failed to load products');
            }
        } finally {
            if (seq === productFetchSeqRef.current) {
                setIsManualProductsLoading(false);
                setIsManualProductsFetchingMore(false);
            }
        }
    }, [toast]);

    const openCreateManualOrder = useCallback(async () => {
        setIsCreateOrderOpen(true);
        setManualCreateAttempted(false);
        setManualCartTouched(false);
        setManualDraftItem({ ...EMPTY_MANUAL_ITEM });
        setManualOrderItems([]);
        setManualCoupons([]);
        setManualProductQuery('');
        setManualSummaryError('');
        setManualCouponError('');
        setManualOrderForm((prev) => ({ ...prev, couponCode: '' }));
        await Promise.all([loadManualProducts(''), loadManualCustomers('')]);
    }, [loadManualCustomers, loadManualProducts]);

    const closeCreateManualOrder = useCallback(async () => {
        if (isCreatingManualOrder) return;
        const selectedUserId = String(manualOrderForm.userId || '').trim();
        const shouldClearCart = manualCartTouched && selectedUserId;
        setIsCreateOrderOpen(false);
        if (shouldClearCart) {
            try {
                await adminService.clearUserCart(selectedUserId);
            } catch {
                // no-op; close should not block on cleanup
            }
        }
        setManualDraftItem({ ...EMPTY_MANUAL_ITEM });
        setManualOrderItems([]);
        setManualCoupons([]);
        setManualSummary(null);
        setManualCreateAttempted(false);
        setManualCartTouched(false);
    }, [isCreatingManualOrder, manualCartTouched, manualOrderForm.userId]);

    const updateManualDraftItem = (patch = {}) => {
        setManualDraftItem((prev) => {
            const merged = { ...(prev || EMPTY_MANUAL_ITEM), ...patch };
            const qty = Math.max(1, Number(merged.quantity || 1));
            return { ...merged, quantity: qty };
        });
    };

    const addManualDraftToCart = async () => {
        if (!manualOrderForm.userId) {
            toast.error('Select customer first');
            return;
        }
        const productId = String(manualDraftItem?.productId || '').trim();
        if (!productId) {
            toast.error('Select a product first');
            return;
        }
        const product = (manualProducts || []).find((entry) => String(entry?.id) === productId);
        if (!product) {
            toast.error('Selected product is unavailable');
            return;
        }
        const variants = Array.isArray(product?.variants) ? product.variants.filter((variant) => isVariantInStock(variant)) : [];
        const hasVariants = variants.length > 0;
        const variantId = String(manualDraftItem?.variantId || '').trim();
        if (hasVariants && !variantId) {
            toast.error('Select a variant before adding');
            return;
        }
        if (variantId && !variants.some((entry) => String(entry?.id) === variantId)) {
            toast.error('Selected variant is unavailable');
            return;
        }
        const quantity = Math.max(1, Number(manualDraftItem?.quantity || 1));
        try {
            await adminService.addUserCartItem(manualOrderForm.userId, { productId, variantId, quantity });
            const rows = await syncManualOrderItemsFromUserCart(manualOrderForm.userId);
            setManualCartTouched(true);
            setManualDraftItem({ ...EMPTY_MANUAL_ITEM });
            await refreshManualCartDerivedData(manualOrderForm.userId, rows);
        } catch (error) {
            toast.error(error?.message || 'Failed to add item to customer cart');
        }
    };

    const removeManualCartItem = async (productId, variantId = '') => {
        if (!manualOrderForm.userId) return;
        try {
            await adminService.removeUserCartItem(manualOrderForm.userId, { productId, variantId });
            const rows = await syncManualOrderItemsFromUserCart(manualOrderForm.userId);
            setManualCartTouched(true);
            await refreshManualCartDerivedData(manualOrderForm.userId, rows);
        } catch (error) {
            toast.error(error?.message || 'Failed to remove item from customer cart');
        }
    };

    const updateManualAddress = (type, field, value) => {
        setManualOrderForm((prev) => {
            const next = {
                ...prev,
                [type]: {
                    ...(prev[type] || { ...EMPTY_ADDRESS }),
                    [field]: value
                }
            };
            if (type === 'shippingAddress' && prev.billingSameAsShipping) {
                next.billingAddress = { ...next.shippingAddress };
            }
            return next;
        });
    };

    const handleManualCustomerSelect = useCallback(async (userId) => {
        const customer = (manualCustomers || []).find((row) => String(row?.id) === String(userId || ''));
        const normalizedShipping = customer?.address ? normalizeUserAddress(customer.address) : { ...EMPTY_ADDRESS };
        const normalizedBilling = customer?.billingAddress ? normalizeUserAddress(customer.billingAddress) : normalizedShipping;
        const primaryAddress = resolvePrimaryAddress(normalizedShipping, normalizedBilling);
        setManualOrderForm((prev) => ({
            ...prev,
            userId: userId || '',
            mobile: customer?.mobile || '',
            couponCode: '',
            shippingAddress: { ...primaryAddress },
            billingAddress: prev.billingSameAsShipping ? { ...primaryAddress } : normalizedBilling
        }));
        setManualCoupons([]);
        setManualSummary(null);
        setManualSummaryError('');
        setManualCouponError('');
        const rows = await syncManualOrderItemsFromUserCart(userId);
        await refreshManualCartDerivedData(userId, rows);
    }, [manualCustomers, refreshManualCartDerivedData, syncManualOrderItemsFromUserCart]);

    useEffect(() => {
        const userId = String(initialManualCustomerId || '').trim();
        if (!userId) return;
        const boot = async () => {
            await openCreateManualOrder();
            await handleManualCustomerSelect(userId);
            onInitialManualCustomerApplied(userId);
        };
        boot();
    }, [handleManualCustomerSelect, initialManualCustomerId, onInitialManualCustomerApplied, openCreateManualOrder]);

    useEffect(() => {
        if (!isCreateOrderOpen) return;
        const timer = setTimeout(() => {
            loadManualCustomers(manualCustomerQuery);
        }, 220);
        return () => clearTimeout(timer);
    }, [isCreateOrderOpen, loadManualCustomers, manualCustomerQuery]);

    useEffect(() => {
        if (!isCreateOrderOpen) return;
        const timer = setTimeout(() => {
            loadManualProducts(manualProductQuery);
        }, 220);
        return () => clearTimeout(timer);
    }, [isCreateOrderOpen, loadManualProducts, manualProductQuery]);

    useEffect(() => {
        if (!isCreateOrderOpen || !manualOrderForm.userId) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            if (cancelled) return;
            await refreshManualCartDerivedData(manualOrderForm.userId);
        }, 120);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isCreateOrderOpen, manualOrderForm.billingAddress, manualOrderForm.couponCode, manualOrderForm.shippingAddress, manualOrderForm.userId, refreshManualCartDerivedData]);

    const validateManualAddress = (address = null) => {
        return isAddressComplete(address);
    };

    const handleCreateManualOrder = async () => {
        setManualCreateAttempted(true);
        if (!canSubmitManualOrder) {
            toast.error('Complete all mandatory fields before creating order');
            return;
        }
        if (!manualOrderForm.userId) {
            toast.error('Select a customer');
            return;
        }
        if (!validateManualAddress(manualOrderForm.shippingAddress)) {
            toast.error('Complete shipping address fields');
            return;
        }
        if (!validateManualAddress(effectiveBillingAddress)) {
            toast.error('Complete billing address fields');
            return;
        }
        if (!resolvedManualMobile) {
            toast.error('Enter a customer mobile number');
            return;
        }
        if (!isManualMobileValid) {
            toast.error('Customer mobile must contain 10-14 digits');
            return;
        }
        if (!manualItemPayload.length) {
            toast.error('Add at least one product item');
            return;
        }
        if (hasManualVariantGaps) {
            toast.error('Select variant for all variant products');
            return;
        }
        setIsCreatingManualOrder(true);
        try {
            const payload = {
                userId: manualOrderForm.userId,
                paymentMode: manualOrderForm.paymentMode,
                paymentReference: manualOrderForm.paymentReference || '',
                couponCode: manualOrderForm.couponCode || '',
                useCustomerCart: true,
                mobile: resolvedManualMobile,
                shippingAddress: manualOrderForm.shippingAddress,
                billingAddress: effectiveBillingAddress
            };
            const data = await orderService.createAdminManualOrder(payload);
            const nextOrder = data?.order || null;
            if (!nextOrder) throw new Error('Order creation failed');
            toast.success('Manual order created');
            setIsCreateOrderOpen(false);
            setManualCreateAttempted(false);
            setManualOrderForm({
                userId: '',
                mobile: '',
                paymentMode: 'cash',
                paymentReference: '',
                couponCode: '',
                shippingAddress: { ...EMPTY_ADDRESS },
                billingAddress: { ...EMPTY_ADDRESS },
                billingSameAsShipping: true
            });
            setManualDraftItem({ ...EMPTY_MANUAL_ITEM });
            setManualOrderItems([]);
            setManualCoupons([]);
            setManualProductQuery('');
            setManualCartTouched(false);
            setPage(1);
            fetchOrders(1);
            openDetails(nextOrder);
        } catch (error) {
            toast.error(error?.message || 'Failed to create manual order');
        } finally {
            setIsCreatingManualOrder(false);
        }
    };

    const handleConvertAttemptToPaidOrder = async () => {
        if (!selectedOrder || !isAttemptEntry(selectedOrder)) return;
        setIsConvertingAttempt(true);
        try {
            const payload = {
                paymentMode: attemptConversionMode,
                paymentReference: attemptConversionReference,
                conversionReason: attemptConversionReason
            };
            const data = await orderService.convertAdminPaymentAttemptToOrder(selectedOrder.attempt_id || selectedOrder.id, payload);
            const order = data?.order || null;
            if (!order) throw new Error('Attempt conversion failed');
            toast.success('Failed attempt converted to successful order');
            setSelectedOrder(order);
            setPendingStatus(normalizeOrderStatus(order.status || 'confirmed'));
            setDetailsLastSyncedAt(new Date().toISOString());
            setAttemptConversionReference('');
            setAttemptConversionReason('');
            setPage(1);
            fetchOrders(1);
        } catch (error) {
            toast.error(error?.message || 'Failed to convert payment attempt');
        } finally {
            setIsConvertingAttempt(false);
        }
    };

    const openDetails = async (order) => {
        setIsDetailsOpen(true);
        const hasSeedData = Boolean(order && !isAttemptEntry(order));
        setIsDetailsLoading(!hasSeedData);
        setSettlementContext({ mode: null, isTestMode: false });
        if (order) {
            setSelectedOrder((prev) => ({ ...(prev || {}), ...order }));
            setPendingStatus(normalizeOrderStatus(order.status || 'confirmed'));
            setDetailsLastSyncedAt(new Date().toISOString());
        }
        try {
            if (isAttemptEntry(order)) {
                const attemptOrder = {
                    ...order,
                    items: Array.isArray(order?.items) ? order.items : [],
                    events: Array.isArray(order?.events) ? order.events : []
                };
                setSelectedOrder(attemptOrder);
                setPendingStatus(attemptOrder.status || 'failed');
                setAttemptConversionMode('cash');
                setAttemptConversionReference('');
                setAttemptConversionReason('');
                setDetailsLastSyncedAt(new Date().toISOString());
                return;
            }
            const data = await orderService.getAdminOrder(order?.order_id || order?.id);
            const nextOrder = data.order || null;
            setSelectedOrder(nextOrder);
            setPendingStatus(normalizeOrderStatus(nextOrder?.status || 'confirmed'));
            setDetailsLastSyncedAt(new Date().toISOString());
            if (nextOrder && needsSettlementSync(nextOrder)) {
                try {
                    const sync = await orderService.fetchAdminPaymentStatus({
                        orderId: nextOrder.order_id || nextOrder.id,
                        attemptId: null,
                        razorpayOrderId: nextOrder.razorpay_order_id || '',
                        razorpayPaymentId: nextOrder.razorpay_payment_id || ''
                    });
                    if (sync?.order) {
                        setSelectedOrder(sync.order);
                        patchOrderRow(sync.order);
                        setDetailsLastSyncedAt(new Date().toISOString());
                    }
                    if (sync?.settlementContext) {
                        setSettlementContext(sync.settlementContext);
                    }
                } catch (error) {
                    void error;
                }
            }
        } catch (error) {
            toast.error(error.message || 'Failed to load order details');
        } finally {
            setIsDetailsLoading(false);
        }
    };

    const handleStatusUpdate = useCallback(async () => {
        if (!selectedOrder || !pendingStatus) return;
        const isPaid = isPaidPayment(selectedOrder);
        const refundableBase = Math.max(0, Number(selectedOrder?.total || 0) - Number(selectedOrder?.shipping_fee || 0));
        if (pendingStatus === 'cancelled' && isPaid) {
            if (!cancellationMode) {
                toast.error('Select cancellation mode before cancelling this paid order');
                return;
            }
            if (cancellationMode === 'manual') {
                const amount = Number(manualRefundAmount);
                if (!manualRefundMethod) {
                    toast.error('Select manual refund method');
                    return;
                }
                if (!Number.isFinite(amount) || amount <= 0) {
                    toast.error('Enter manual refunded amount');
                    return;
                }
                if (amount > refundableBase) {
                    toast.error(`Refund cannot exceed ₹${refundableBase.toLocaleString('en-IN')} (shipping excluded).`);
                    return;
                }
                if (manualRefundMethod === 'NEFT/RTGS' && !String(manualRefundUtr || '').trim()) {
                    toast.error('Enter UTR number for NEFT/RTGS');
                    return;
                }
                if ((manualRefundMethod === 'UPI' || manualRefundMethod === 'Bank A/c Transfer') && !String(manualRefundRef || '').trim()) {
                    toast.error(`Enter reference number for ${manualRefundMethod}`);
                    return;
                }
            }
        }
        setIsUpdatingStatus(true);
        try {
            const data = await orderService.updateAdminOrderStatus(
                selectedOrder.order_id || selectedOrder.id,
                pendingStatus,
                {
                    cancellationMode: pendingStatus === 'cancelled' ? cancellationMode : '',
                    manualRefundAmount: pendingStatus === 'cancelled' ? manualRefundAmount : '',
                    manualRefundMethod: pendingStatus === 'cancelled' ? manualRefundMethod : '',
                    manualRefundRef: pendingStatus === 'cancelled' ? manualRefundRef : '',
                    manualRefundUtr: pendingStatus === 'cancelled' ? manualRefundUtr : ''
                }
            );
            if (data?.order) {
                setSelectedOrder(data.order);
                patchOrderRow(data.order);
                markOrderMetricsDirty(metricsQuery);
                fetchOrderMetrics(metricsQuery, { force: true }).catch(() => {});
                if (pendingStatus === 'cancelled' && cancellationMode === 'razorpay' && data?.refund?.id) {
                    toast.success(`Order cancelled and refund initiated (${data.refund.id})`);
                } else if (pendingStatus === 'cancelled' && cancellationMode === 'manual') {
                    toast.success('Order cancelled and manual refund details recorded');
                } else {
                    toast.success('Order status updated');
                }
            }
        } catch (error) {
            toast.error(error.message || 'Failed to update status');
        } finally {
            setIsUpdatingStatus(false);
        }
    }, [cancellationMode, fetchOrderMetrics, manualRefundAmount, manualRefundMethod, manualRefundRef, manualRefundUtr, markOrderMetricsDirty, metricsQuery, patchOrderRow, pendingStatus, selectedOrder, toast]);

    const handleQuickComplete = useCallback(async (order, event) => {
        event?.stopPropagation?.();
        if (!order || isAttemptEntry(order)) return;
        const current = normalizeOrderStatus(order.status);
        if (current === 'completed' || current === 'cancelled') return;
        try {
            const data = await orderService.updateAdminOrderStatus(order.order_id || order.id, 'completed');
            if (data?.order) {
                patchOrderRow(data.order);
                if (selectedOrder && String(selectedOrder.id || selectedOrder.order_id) === String(data.order.id || data.order.order_id)) {
                    setSelectedOrder(data.order);
                }
                markOrderMetricsDirty(metricsQuery);
                fetchOrderMetrics(metricsQuery, { force: true }).catch(() => {});
                toast.success('Order marked as completed');
            }
        } catch (error) {
            toast.error(error.message || 'Failed to complete order');
        }
    }, [fetchOrderMetrics, markOrderMetricsDirty, metricsQuery, patchOrderRow, selectedOrder, toast]);

    const handleFetchPaymentStatus = async ({ reason = 'payment' } = {}) => {
        if (!selectedOrder) return;
        setIsFetchingPaymentStatus(true);
        try {
            const data = await orderService.fetchAdminPaymentStatus({
                orderId: isAttemptEntry(selectedOrder) ? null : (selectedOrder.order_id || selectedOrder.id),
                attemptId: selectedOrder.attempt_id || null,
                razorpayOrderId: selectedOrder.razorpay_order_id || '',
                razorpayPaymentId: selectedOrder.razorpay_payment_id || ''
            });

            if (data?.order) {
                setSelectedOrder(data.order);
                patchOrderRow(data.order);
                setDetailsLastSyncedAt(new Date().toISOString());
            } else if (data?.attempt) {
                patchAttemptRow(data.attempt);
                setSelectedOrder((prev) => ({
                    ...(prev || {}),
                    payment_status: data.attempt.status || prev?.payment_status || '',
                    razorpay_payment_id: data.attempt.razorpay_payment_id || prev?.razorpay_payment_id || '',
                    failure_reason: data.attempt.failure_reason || prev?.failure_reason || ''
                }));
                setDetailsLastSyncedAt(new Date().toISOString());
            } else if (data?.paymentStatus) {
                setSelectedOrder((prev) => ({ ...(prev || {}), payment_status: data.paymentStatus }));
                setDetailsLastSyncedAt(new Date().toISOString());
            }
            if (data?.settlementContext) {
                setSettlementContext(data.settlementContext);
            }
            if (reason === 'refund') {
                toast.success(`Refund status synced: ${data?.order?.refund_status || data?.paymentStatus || 'updated'}`);
            } else {
                toast.success(`Payment status synced: ${data?.paymentStatus || 'updated'}`);
            }
        } catch (error) {
            toast.error(error.message || (reason === 'refund' ? 'Failed to fetch refund status' : 'Failed to fetch payment status'));
        } finally {
            setIsFetchingPaymentStatus(false);
        }
    };

    useEffect(() => {
        if (!focusOrderId) return;
        if (isLoading) return;
        const hit = (orders || []).find((row) => !isAttemptEntry(row) && String(row.order_id || row.id) === String(focusOrderId));
        if (hit) {
            openDetails(hit);
            onFocusHandled();
            return;
        }
        const loadDirect = async () => {
            try {
                setIsDetailsOpen(true);
                setIsDetailsLoading(true);
                const data = await orderService.getAdminOrder(focusOrderId);
                const target = data?.order || null;
                if (target) {
                    setSelectedOrder(target);
                    setPendingStatus(normalizeOrderStatus(target.status || 'confirmed'));
                    setDetailsLastSyncedAt(new Date().toISOString());
                    setSettlementContext({ mode: null, isTestMode: false });
                }
            } catch (error) {
                toast.error(error.message || 'Failed to open focused order');
            } finally {
                setIsDetailsLoading(false);
                onFocusHandled();
            }
        };
        loadDirect();
    }, [focusOrderId, isLoading, onFocusHandled, orders, toast]);

    const handleDeleteOrder = async (e, order) => {
        e.stopPropagation();
        if (!order || !canDeleteRow(order)) return;
        const targetId = isAttemptEntry(order)
            ? (order.attempt_id || order.id)
            : (order.order_id || order.id);
        if (!targetId) return;
        setConfirmModal({
            isOpen: true,
            type: 'delete',
            title: 'Delete Order',
            message: `Delete order ${order.order_ref || targetId}? This cannot be undone.`,
            confirmText: 'Delete',
            action: { type: 'delete_single', order }
        });
    };

    const handleConfirmModalClose = () => {
        if (isConfirmProcessing) return;
        setConfirmModal((prev) => ({ ...prev, isOpen: false, action: null }));
    };

    const handleConfirmAction = async () => {
        const actionType = confirmModal?.action?.type;
        if (!actionType) {
            handleConfirmModalClose();
            return;
        }

        setIsConfirmProcessing(true);
        try {
            if (actionType === 'delete_single') {
                const row = confirmModal.action.order;
                const targetId = isAttemptEntry(row) ? (row.attempt_id || row.id) : (row.order_id || row.id);
                setDeletingOrderId(targetId);
                if (isAttemptEntry(row)) {
                    await orderService.deleteAdminPaymentAttempt(targetId);
                    removeRow(targetId, 'attempt');
                } else {
                    await orderService.deleteAdminOrder(targetId);
                    removeRow(targetId, 'order');
                }
                if (selectedOrder && String(selectedOrder.id || selectedOrder.order_id || selectedOrder.attempt_id) === String(targetId)) {
                    setIsDetailsOpen(false);
                    setSelectedOrder(null);
                }
                markOrderMetricsDirty(metricsQuery);
                fetchOrderMetrics(metricsQuery, { force: true }).catch(() => {});
                toast.success('Order deleted');
            }
        } catch (error) {
            toast.error(error.message || 'Action failed');
        } finally {
            setDeletingOrderId(null);
            setIsConfirmProcessing(false);
            setConfirmModal((prev) => ({ ...prev, isOpen: false, action: null }));
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
    const getPendingDurationLabel = (createdAt) => {
        if (!createdAt) return '';
        const created = new Date(createdAt);
        if (Number.isNaN(created.getTime())) return '';
        const now = new Date();
        const diffMs = Math.max(0, now.getTime() - created.getTime());
        const hourMs = 60 * 60 * 1000;
        const dayMs = 24 * hourMs;
        const weekMs = 7 * dayMs;
        const monthMs = 30 * dayMs;

        if (diffMs < dayMs) {
            const hours = Math.max(1, Math.floor(diffMs / hourMs));
            return `${hours}h pending`;
        }
        if (diffMs < weekMs) {
            const days = Math.floor(diffMs / dayMs);
            return `${days}d pending`;
        }
        if (diffMs < monthMs) {
            const weeks = Math.floor(diffMs / weekMs);
            return `${weeks}w pending`;
        }
        const months = Math.floor(diffMs / monthMs);
        return `${months}mo pending`;
    };

    const effectiveMetrics = sharedMetrics || metrics;
    const dynamicStatusLabel = useMemo(() => {
        const value = String(statusFilter || '').trim().toLowerCase();
        if (!value || value === 'all' || value === 'pending' || value === 'confirmed') return 'Confirmed';
        return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    }, [statusFilter]);
    const dynamicStatusValue = useMemo(() => {
        const value = String(statusFilter || '').trim().toLowerCase();
        if (!value || value === 'all' || value === 'pending' || value === 'confirmed') {
            return effectiveMetrics?.confirmedOrders || 0;
        }
        return selectedStatusCount;
    }, [effectiveMetrics?.confirmedOrders, selectedStatusCount, statusFilter]);
    const cards = useMemo(() => ([
        {
            label: 'Total Orders',
            value: effectiveMetrics?.totalOrders || 0,
            icon: Package,
            theme: 'violet'
        },
        {
            label: 'Total Revenue',
            value: `₹${Number(effectiveMetrics?.totalRevenue || 0).toLocaleString()}`,
            icon: IndianRupee,
            theme: 'emerald'
        },
        {
            label: 'Pending',
            value: effectiveMetrics?.pendingOrders || 0,
            icon: Clock3,
            theme: 'amber'
        },
        {
            label: dynamicStatusLabel,
            value: dynamicStatusValue,
            icon: CheckCircle2,
            theme: 'slate'
        }
    ]), [dynamicStatusLabel, dynamicStatusValue, effectiveMetrics]);
    const mobileSummaryCards = useMemo(() => cards.slice(0, 2), [cards]);
    const activeLabelOrder = labelPrintModalOrder;
    const activeLabelOrderId = activeLabelOrder?.order_id || activeLabelOrder?.id || '';
    const activeFromValidation = activeLabelOrder ? getFromLabelValidation(activeLabelOrder) : { ok: false, missing: [] };
    const activeToValidation = activeLabelOrder ? getToLabelValidation(activeLabelOrder) : { ok: false, missing: [] };
    const supportedTransports = Array.isArray(printerSupport?.transports) ? printerSupport.transports : [];
    const canPairBluetooth = supportedTransports.includes('bluetooth');
    const canPairUsb = !String(preferredPrinterTransport).toLowerCase().includes('bluetooth') && supportedTransports.includes('usb');
    const printerStatusLabel = preferredPrinter
        ? `${preferredPrinter.deviceName || preferredPrinter.productName || 'Saved printer'} (${preferredPrinter.transport === 'usb' ? 'USB' : 'Bluetooth'})`
        : (printerSupport.supported
            ? (preferredPrinterTransport === 'bluetooth'
                ? 'No paired printer yet. This device will use Bluetooth.'
                : 'No paired printer yet. You can pair via Bluetooth or USB.')
            : printerSupport.reason);
    const mobileStatusChips = [
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'pending', label: 'Pending' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' }
    ];
    const sortOptions = [
        { value: 'newest', label: 'Newest First' },
        { value: 'oldest', label: 'Oldest First' },
        { value: 'amount_high', label: 'Amount: High to Low' },
        { value: 'amount_low', label: 'Amount: Low to High' },
        { value: 'priority', label: 'Fulfillment Priority' }
    ];

    return (
        <div className="animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-start justify-between gap-3">
                    <div className="w-full">
                        <div className="flex items-center justify-between gap-3 md:block">
                            <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Orders</h1>
                            <div className={`inline-flex md:hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                storefrontOpen
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                    : 'border-gray-300 bg-gray-100 text-gray-800'
                            }`}>
                                <span className={`h-2 w-2 rounded-full ${storefrontOpen ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                                {storefrontOpen ? 'Store Open' : 'Store Closed'}
                            </div>
                        </div>
                        <p className="text-gray-500 text-sm mt-1">Track sales, payments, and order status.</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:hidden">
                    {mobileSummaryCards.map((card) => (
                        <div key={card.label} className={`emboss-card relative overflow-hidden rounded-2xl border shadow-sm p-4 aspect-square flex flex-col justify-between ${KPI_CARD_THEMES[card.theme || 'sky'].shell}`}>
                            <card.icon size={48} className={`bg-emboss-icon absolute right-2 bottom-2 ${KPI_CARD_THEMES[card.theme || 'sky'].iconGhost}`} />
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${KPI_CARD_THEMES[card.theme || 'sky'].iconChip}`}>
                                <card.icon size={18} />
                            </div>
                            <div className="relative z-10">
                                <p className={`text-[11px] uppercase tracking-widest font-semibold ${KPI_CARD_THEMES[card.theme || 'sky'].label}`}>{card.label}</p>
                                <p className={`mt-2 text-xl font-bold ${KPI_CARD_THEMES[card.theme || 'sky'].value}`}>{card.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="hidden md:block w-full">
                    <div className="flex flex-col md:flex-row md:flex-nowrap md:items-center gap-2 w-full md:w-auto">
                    <div className="relative w-full md:w-auto order-1">
                        <Filter className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                        <select
                            value={draftQuickRange}
                            onChange={(e) => {
                                const next = e.target.value;
                                setDraftQuickRange(next);
                                if (next !== 'custom') {
                                    setDraftStartDate('');
                                    setDraftEndDate('');
                                }
                            }}
                            className="w-full md:w-auto pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer"
                        >
                            {QUICK_RANGES.map((range) => (
                                <option key={range.value} value={range.value}>{range.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 order-2 md:order-2 w-full md:w-auto">
                        <input
                            ref={startDateInputRef}
                            type="date"
                            value={draftStartDate}
                            min={draftEndDate ? addDays(draftEndDate, -MAX_RANGE_DAYS) : undefined}
                            max={draftEndDate || undefined}
                            onChange={(e) => setDraftStartDate(e.target.value)}
                            className="sr-only"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                if (draftQuickRange !== 'custom') return;
                                if (startDateInputRef.current?.showPicker) startDateInputRef.current.showPicker();
                                else startDateInputRef.current?.click();
                            }}
                            disabled={draftQuickRange !== 'custom'}
                            className="px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-left whitespace-nowrap min-w-[170px]"
                        >
                            {draftStartDate ? formatRangeDate(draftStartDate) : 'Start Date'}
                        </button>
                        <input ref={endDateInputRef} type="date" value={draftEndDate} min={draftStartDate || undefined} max={draftStartDate ? addDays(draftStartDate, MAX_RANGE_DAYS) : undefined} onChange={(e) => setDraftEndDate(e.target.value)} className="sr-only" />
                        <button
                            type="button"
                            onClick={() => {
                                if (draftQuickRange !== 'custom') return;
                                if (endDateInputRef.current?.showPicker) endDateInputRef.current.showPicker();
                                else endDateInputRef.current?.click();
                            }}
                            disabled={draftQuickRange !== 'custom'}
                            className="px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-left whitespace-nowrap min-w-[170px]"
                        >
                            {draftEndDate ? formatRangeDate(draftEndDate) : 'End Date'}
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={handleExport}
                        disabled={isExporting || isLoading}
                        className="w-full md:w-auto px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-60 inline-flex items-center justify-center gap-2 order-3 md:order-3"
                    >
                        <Download size={16} />
                        {isExporting ? 'Exporting...' : 'Export Report'}
                    </button>
                    <div className="relative w-full md:w-auto order-4 md:order-4">
                        <button
                            type="button"
                            onClick={handleApplyFilters}
                            className="w-full md:w-auto px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                        >
                            Apply Filters
                        </button>
                    </div>
                    </div>
                </div>
            </div>

            {isFilterModalOpen && createPortal(
                <div className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Order Filters</h3>
                                <p className="text-xs text-gray-500 mt-1">Refine the table and export the current view.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsFilterModalOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close order filters"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 space-y-3">
                            <div className="relative w-full">
                                <Filter className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                                <select
                                    value={draftQuickRange}
                                    onChange={(e) => {
                                        const next = e.target.value;
                                        setDraftQuickRange(next);
                                        if (next !== 'custom') {
                                            setDraftStartDate('');
                                            setDraftEndDate('');
                                        }
                                    }}
                                    className="w-full pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer"
                                >
                                    {QUICK_RANGES.map((range) => (
                                        <option key={range.value} value={range.value}>{range.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                <input
                                    ref={startDateInputRef}
                                    type="date"
                                    value={draftStartDate}
                                    min={draftEndDate ? addDays(draftEndDate, -MAX_RANGE_DAYS) : undefined}
                                    max={draftEndDate || undefined}
                                    onChange={(e) => setDraftStartDate(e.target.value)}
                                    className="sr-only"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (draftQuickRange !== 'custom') return;
                                        if (startDateInputRef.current?.showPicker) startDateInputRef.current.showPicker();
                                        else startDateInputRef.current?.click();
                                    }}
                                    disabled={draftQuickRange !== 'custom'}
                                    className="px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-left"
                                >
                                    {draftStartDate ? formatRangeDate(draftStartDate) : 'Start Date'}
                                </button>
                                <input
                                    ref={endDateInputRef}
                                    type="date"
                                    value={draftEndDate}
                                    min={draftStartDate || undefined}
                                    max={draftStartDate ? addDays(draftStartDate, MAX_RANGE_DAYS) : undefined}
                                    onChange={(e) => setDraftEndDate(e.target.value)}
                                    className="sr-only"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (draftQuickRange !== 'custom') return;
                                        if (endDateInputRef.current?.showPicker) endDateInputRef.current.showPicker();
                                        else endDateInputRef.current?.click();
                                    }}
                                    disabled={draftQuickRange !== 'custom'}
                                    className="px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm text-sm text-gray-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-left"
                                >
                                    {draftEndDate ? formatRangeDate(draftEndDate) : 'End Date'}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={handleExport}
                                disabled={isExporting || isLoading}
                                className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                            >
                                <Download size={16} />
                                {isExporting ? 'Exporting...' : 'Export Report'}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleApplyFilters(true)}
                                className="w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                            >
                                Apply Filters
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isMobileSortOpen && createPortal(
                <div className="fixed inset-0 z-[185] bg-black/40 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Sort Orders</h3>
                                <p className="text-xs text-gray-500 mt-1">Choose how the mobile list should be ordered.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileSortOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close sort options"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 space-y-2">
                            {sortOptions.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                        setSortBy(option.value);
                                        setPage(1);
                                        setIsMobileSortOpen(false);
                                    }}
                                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                                        sortBy === option.value
                                            ? 'border-primary bg-primary/5 text-primary'
                                            : 'border-gray-200 bg-white text-gray-700'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <div className="hidden md:grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                {cards.map((card) => (
                    <div key={card.label} className={`emboss-card relative overflow-hidden rounded-2xl border shadow-sm p-5 flex items-center gap-4 ${KPI_CARD_THEMES[card.theme || 'sky'].shell}`}>
                        <card.icon size={56} className={`bg-emboss-icon absolute right-2 bottom-2 ${KPI_CARD_THEMES[card.theme || 'sky'].iconGhost}`} />
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${KPI_CARD_THEMES[card.theme || 'sky'].iconChip}`}>
                            <card.icon size={20} />
                        </div>
                        <div>
                            <p className={`text-xs uppercase tracking-widest font-semibold ${KPI_CARD_THEMES[card.theme || 'sky'].label}`}>{card.label}</p>
                            <p className={`text-lg font-bold ${KPI_CARD_THEMES[card.theme || 'sky'].value}`}>{card.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="md:hidden px-4 pt-4 pb-3 border-b border-gray-100 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsMobileSortOpen(true);
                                    setIsMobileSearchOpen(false);
                                }}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm"
                                aria-label="Sort orders"
                            >
                                <ArrowUpDown size={17} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsMobileSearchOpen((prev) => !prev)}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm ${
                                    isMobileSearchOpen ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-600'
                                }`}
                                aria-label="Search orders"
                            >
                                <Search size={17} />
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsFilterModalOpen(true)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm"
                            aria-label="Open order filters"
                        >
                            <Filter size={17} />
                        </button>
                    </div>
                    {isMobileSearchOpen && (
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
                            <input
                                placeholder="Search order / customer"
                                className="w-full pl-9 pr-3 py-2.5 bg-white rounded-xl border border-gray-200 text-sm focus:border-accent outline-none"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-4 gap-2">
                        {mobileStatusChips.map((chip) => {
                            const active = statusFilter === chip.value;
                            return (
                                <button
                                    key={chip.value}
                                    type="button"
                                    onClick={() => {
                                        const next = active ? 'all' : chip.value;
                                        setDraftStatusFilter(next);
                                        setStatusFilter(next);
                                        setPage(1);
                                    }}
                                    className={`w-full rounded-full border px-2 py-2 text-[11px] font-semibold leading-none transition ${
                                        active ? getOrderStatusBadgeClasses(chip.value) : 'border-gray-200 bg-white text-gray-600'
                                    }`}
                                >
                                    {chip.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="px-6 py-4 border-b border-gray-100 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-col md:flex-row md:items-center gap-2 w-full xl:w-auto">
                        <div className="relative hidden md:block w-full md:w-auto order-1">
                            <Filter className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
                            <select
                                value={draftStatusFilter}
                                onChange={(e) => handleStatusFilterChange(e.target.value)}
                                className="w-full md:w-auto pl-9 pr-7 py-2 bg-white rounded-lg border border-gray-200 text-sm focus:border-accent outline-none appearance-none cursor-pointer"
                            >
                                <option value="all">All Status</option>
                                <option value="confirmed">Confirmed</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>
                        <div className="relative hidden md:block w-full md:w-auto order-2 md:order-3">
                            <ArrowUpDown className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
                            <select
                                value={sortBy}
                                onChange={(e) => {
                                    setSortBy(e.target.value);
                                    setPage(1);
                                }}
                                className="w-full md:w-auto pl-9 pr-7 py-2 bg-white rounded-lg border border-gray-200 text-sm focus:border-accent outline-none appearance-none cursor-pointer"
                            >
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                                <option value="amount_high">Amount: High to Low</option>
                                <option value="amount_low">Amount: Low to High</option>
                                <option value="priority">Fulfillment Priority (Tier)</option>
                            </select>
                        </div>
                        <div className="relative hidden md:block w-full md:w-auto order-3 md:order-2">
                            <Search className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
                            <input
                                placeholder="Search order / customer"
                                className="w-full md:w-64 pl-9 pr-3 py-2.5 bg-white rounded-lg border border-gray-200 text-sm focus:border-accent outline-none"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={openCreateManualOrder}
                            className="hidden md:inline-flex w-full md:w-auto order-4 items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-semibold hover:bg-emerald-100"
                        >
                            <Plus size={15} />
                            Create Order
                        </button>
                    </div>
                </div>
                {isLoading ? (
                    <div className="py-16 text-center text-gray-400">Loading orders...</div>
                ) : orders.length === 0 ? (
                    <div className="py-12 text-center text-gray-400 flex flex-col items-center gap-4">
                        <img src={orderWaitIllustration} alt="No orders" className="w-40 h-40 object-contain opacity-85" />
                        <div>
                            <p className="text-gray-700 font-semibold">No orders available for the selected filters</p>
                            <p className="text-sm text-gray-500 mt-1">Try adjusting status, search, or date range.</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="hidden md:block">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Name</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Date</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Order ID</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Payment</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {orders.map((order) => {
                                        const pendingDurationLabel = order.status === 'pending'
                                            ? getPendingDurationLabel(order.created_at)
                                            : '';
                                        return (
                                        <tr
                                            key={order.id}
                                            onClick={() => openDetails(order)}
                                            className={`transition-colors cursor-pointer ${isFailedRow(order) ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50/50'}`}
                                        >
                                            <td className="px-6 py-4 text-sm text-gray-700">
                                                <div className="font-medium">{order.customer_name || 'Guest'}</div>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-xs text-gray-400">{order.customer_mobile || '—'}</span>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${getTierBadgeClasses(order)}`}>
                                                        {getTierLabel(order)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">{formatAdminDate(order.created_at)}</td>
                                            <td className="px-6 py-4 text-sm font-semibold text-gray-800">
                                                <div className="flex items-center gap-2">
                                                    <span>{order.order_ref}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-semibold text-gray-800">₹{Number(order.total || 0).toLocaleString()}</td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getPaymentStatusBadgeClasses(order.payment_status)}`}>
                                                    {getPaymentStatusLabel(order)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getOrderStatusBadgeClasses(order.status)}`}>
                                                        {formatStatusLabel(order.status || 'pending')}
                                                    </span>
                                                    {!!pendingDurationLabel && (
                                                        <span className="text-[10px] uppercase tracking-widest font-bold text-amber-100 bg-amber-950 border border-amber-700 px-2 py-0.5 rounded-full">
                                                            {pendingDurationLabel}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="inline-flex items-center gap-2">
                                                    {getWhatsappLink(order.customer_mobile) && (
                                                        <a
                                                            href={getWhatsappLink(order.customer_mobile)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                            title="Contact customer on WhatsApp"
                                                        >
                                                            <MessageCircle size={14} />
                                                        </a>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleOpenPrintLabelModal(order, e)}
                                                        disabled={printingLabelId === (order.order_id || order.id) || (!canOpenShippingLabelModal(order) && printerSupport.supported)}
                                                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-60"
                                                        title={canOpenShippingLabelModal(order)
                                                            ? 'Open label print options'
                                                            : 'Label printing requires at least sender or receiver address details'}
                                                    >
                                                        <Printer size={14} />
                                                    </button>
                                                    {canDownloadInvoice(order) && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleDownloadInvoice(order, e)}
                                                            disabled={downloadingInvoiceId === (order.order_id || order.id)}
                                                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                                            title="Download invoice"
                                                        >
                                                            <Download size={14} />
                                                        </button>
                                                    )}
                                                    {canDownloadInvoice(order) && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleSendInvoiceCommunication(order, e)}
                                                            disabled={sendingInvoiceId === (order.order_id || order.id)}
                                                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                                                            title="Send invoice to email + WhatsApp"
                                                        >
                                                            <Send size={14} />
                                                        </button>
                                                    )}
                                                    {canDeleteRow(order) && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => handleDeleteOrder(e, order)}
                                                            disabled={deletingOrderId === (isAttemptEntry(order) ? (order.attempt_id || order.id) : (order.order_id || order.id))}
                                                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                            title="Delete order"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );})}
                                </tbody>
                            </table>
                        </div>

                        <div className="md:hidden divide-y divide-gray-100">
                            {orders.map((order) => {
                                const pendingDurationLabel = order.status === 'pending'
                                    ? getPendingDurationLabel(order.created_at)
                                    : '';
                                return (
                                <div
                                    key={order.id}
                                    onClick={() => openDetails(order)}
                                    className={`w-full text-left p-4 transition-colors ${isFailedRow(order) ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}`}
                                >
                                    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-base font-semibold text-gray-900 break-all">#{order.order_ref}</p>
                                                <p className="mt-1 text-sm font-medium text-gray-700">{order.customer_name || 'Guest'}</p>
                                                {order.customer_mobile && (
                                                    <p className="mt-1 text-xs text-gray-400">{order.customer_mobile}</p>
                                                )}
                                            </div>
                                            <div className="flex shrink-0 items-start gap-2">
                                                <span className={`inline-flex min-w-[88px] items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold ${getOrderStatusBadgeClasses(order.status)}`}>
                                                    {formatStatusLabel(order.status || 'pending')}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold">Placed</p>
                                                <p className="mt-1 text-sm text-gray-700">{formatAdminDate(order.created_at)}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[11px] uppercase tracking-widest text-gray-400 font-semibold">Amount</p>
                                                <p className="mt-1 text-lg font-semibold text-gray-900">₹{Number(order.total || 0).toLocaleString()}</p>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex min-w-[88px] items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getPaymentStatusBadgeClasses(order.payment_status)}`}>
                                                {getPaymentStatusLabel(order)}
                                            </span>
                                            <span className={`inline-flex min-w-[88px] items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${getTierBadgeClasses(order)}`}>
                                                {getTierLabel(order)}
                                            </span>
                                            {!!pendingDurationLabel && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest text-amber-100 bg-amber-950 border border-amber-700">
                                                    {pendingDurationLabel}
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-4 flex items-center justify-end gap-2 flex-wrap">
                                        {getWhatsappLink(order.customer_mobile) && (
                                            <a
                                                href={getWhatsappLink(order.customer_mobile)}
                                                target="_blank"
                                                rel="noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                title="Contact customer on WhatsApp"
                                            >
                                                <MessageCircle size={14} />
                                            </a>
                                        )}
                                        {!isAttemptEntry(order) && !['completed', 'cancelled'].includes(normalizeOrderStatus(order.status)) && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleQuickComplete(order, e)}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                                title="Mark order as completed"
                                            >
                                                <CheckCircle2 size={14} />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => handleOpenPrintLabelModal(order, e)}
                                            disabled={printingLabelId === (order.order_id || order.id) || (!canOpenShippingLabelModal(order) && printerSupport.supported)}
                                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-60"
                                            title={canOpenShippingLabelModal(order)
                                                ? 'Open label print options'
                                                : 'Label printing requires at least sender or receiver address details'}
                                        >
                                            <Printer size={14} />
                                        </button>
                                        {canDownloadInvoice(order) && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleDownloadInvoice(order, e)}
                                                disabled={downloadingInvoiceId === (order.order_id || order.id)}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                                title="Download invoice"
                                            >
                                                <Download size={14} />
                                            </button>
                                        )}
                                        {canDownloadInvoice(order) && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleSendInvoiceCommunication(order, e)}
                                                disabled={sendingInvoiceId === (order.order_id || order.id)}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                                                title="Send invoice to email + WhatsApp"
                                            >
                                                <Send size={14} />
                                            </button>
                                        )}
                                        {canDeleteRow(order) && (
                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteOrder(e, order)}
                                                disabled={deletingOrderId === (isAttemptEntry(order) ? (order.attempt_id || order.id) : (order.order_id || order.id))}
                                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                title="Delete order"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                </div>
                            );})}
                        </div>
                    </>
                )}
                <div className="px-6 py-4 border-t border-gray-100">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <p className="text-xs text-gray-400 text-center md:text-left">Page {page} of {totalPages}</p>
                        <div className="flex items-center gap-3 md:justify-end">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="flex-1 md:flex-none md:w-28 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Previous
                            </button>
                            {visiblePages.map((pageNo) => (
                                <button
                                    key={pageNo}
                                    onClick={() => setPage(pageNo)}
                                    className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
                                        pageNo === page
                                            ? 'border-primary bg-primary text-accent'
                                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    {pageNo}
                                </button>
                            ))}
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="flex-1 md:flex-none md:w-28 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {isDetailsOpen && createPortal(
                <div className="fixed inset-0 z-[70] flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-xl h-full shadow-2xl p-6 overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-900">Order Details</h3>
                            <button
                                onClick={() => setIsDetailsOpen(false)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {!selectedOrder ? (
                            <div className="py-16 text-center text-gray-400">Loading order details...</div>
                        ) : (
                            <>
                                {isDetailsLoading && (
                                    <div className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-flex items-center gap-1">
                                        Refreshing latest details...
                                    </div>
                                )}
                                {(() => {
                                    const headerTheme = getOrderHeaderTheme(selectedOrder.status);
                                    const customerDetailsRows = [
                                        { label: 'Name', value: selectedOrder.customer_name || 'Guest' },
                                        { label: 'Customer Phone', value: selectedOrder.customer_mobile || '—' },
                                        { label: 'Shipping Address', value: formatAddress(selectedOrder.shipping_address) },
                                        ...(billingAddressEnabled ? [{ label: 'Billing Address', value: formatAddress(selectedOrder.billing_address) }] : []),
                                        { label: 'City & State', value: (() => {
                                            const shippingAddress = typeof selectedOrder.shipping_address === 'string'
                                                ? JSON.parse(selectedOrder.shipping_address || '{}')
                                                : (selectedOrder.shipping_address || {});
                                            return [shippingAddress.city, shippingAddress.state, shippingAddress.zip].filter(Boolean).join(', ') || '—';
                                        })() }
                                    ];
                                    return (
                                        <>
                                            <div className={`rounded-3xl p-5 shadow-lg ${headerTheme.shell}`}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className={`text-[11px] uppercase tracking-[0.24em] font-semibold ${headerTheme.rowLabel}`}>Order</p>
                                                        <h3 className="mt-2 text-2xl font-bold text-white">#{selectedOrder.order_ref}</h3>
                                                        <p className={`mt-2 text-sm font-medium ${headerTheme.subtle}`}>{formatAdminDateTime(selectedOrder.created_at)}</p>
                                                        {detailsLastSyncedAt && (
                                                            <p className={`mt-1 text-[11px] ${headerTheme.micro}`}>
                                                                Last synced: {formatAdminDateTime(detailsLastSyncedAt)}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getOrderHeaderBadgeClasses(selectedOrder.status)}`}>
                                                        {formatStatusLabel(selectedOrder.status || 'confirmed')}
                                                    </span>
                                                </div>
                                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getPaymentHeaderBadgeClasses(selectedOrder.payment_status)}`}>
                                                        {getPaymentStatusLabel(selectedOrder)}
                                                    </span>
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${headerTheme.accent}`}>
                                                        {getTierLabel(selectedOrder)}
                                                    </span>
                                                    {normalizeOrderStatus(selectedOrder.status) === 'pending' && (
                                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${headerTheme.accent}`}>
                                                            {getPendingDurationLabel(selectedOrder.created_at)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-4 border-t border-white/15 pt-4">
                                                    <p className="text-lg font-semibold text-white truncate">{selectedOrder.customer_name || 'Guest'}</p>
                                                    <p className={`mt-1 text-sm ${headerTheme.subtle}`}>{selectedOrder.customer_mobile || 'No mobile number'}</p>
                                                    <p className={`mt-2 text-xs ${headerTheme.micro}`}>Invoice No: <span className="font-mono">{getInvoiceNumber(selectedOrder)}</span></p>
                                                </div>
                                            </div>
                                            <div className="mt-4">
                                                {!isAttemptEntry(selectedOrder) && (
                                                    <div className="flex justify-end">
                                                        <div className="inline-flex items-center gap-2 justify-end">
                                                            {getCallLink(selectedOrder.customer_mobile) && (
                                                                <a
                                                                    href={getCallLink(selectedOrder.customer_mobile)}
                                                                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white/90 text-slate-700 hover:bg-white"
                                                                    title="Call customer"
                                                                >
                                                                    <Phone size={16} />
                                                                </a>
                                                            )}
                                                            {getWhatsappLink(selectedOrder.customer_mobile) && (
                                                                <a
                                                                    href={getWhatsappLink(selectedOrder.customer_mobile)}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                                                    title="Contact customer on WhatsApp"
                                                                >
                                                                    <MessageCircle size={16} />
                                                                </a>
                                                            )}
                                                            {canDownloadInvoice(selectedOrder) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => handleDownloadInvoice(selectedOrder, e)}
                                                                    disabled={downloadingInvoiceId === (selectedOrder.order_id || selectedOrder.id)}
                                                                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                                                    title={downloadingInvoiceId === (selectedOrder.order_id || selectedOrder.id) ? 'Generating invoice' : 'Download invoice'}
                                                                >
                                                                    <Download size={16} />
                                                                </button>
                                                            )}
                                                            {canDownloadInvoice(selectedOrder) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => handleSendInvoiceCommunication(selectedOrder, e)}
                                                                    disabled={sendingInvoiceId === (selectedOrder.order_id || selectedOrder.id)}
                                                                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                                                                    title={sendingInvoiceId === (selectedOrder.order_id || selectedOrder.id) ? 'Sending invoice' : 'Send invoice to email + WhatsApp'}
                                                                >
                                                                    <Send size={16} />
                                                                </button>
                                                            )}
                                                            {canDeleteRow(selectedOrder) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => handleDeleteOrder(e, selectedOrder)}
                                                                    disabled={deletingOrderId === (selectedOrder.order_id || selectedOrder.id)}
                                                                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60"
                                                                    title="Delete order"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                {isAttemptEntry(selectedOrder) && String(user?.role || '').toLowerCase() === 'admin' && (
                                                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-3">
                                                        <p className="text-xs text-emerald-800 font-semibold">
                                                            Convert this failed attempt into a successful manual order.
                                                        </p>
                                                        <div>
                                                            <label className="text-xs uppercase tracking-widest text-emerald-700 font-semibold">Payment Mode</label>
                                                            <select
                                                                value={attemptConversionMode}
                                                                onChange={(e) => setAttemptConversionMode(e.target.value)}
                                                                disabled={isConvertingAttempt}
                                                                className="mt-2 w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm text-gray-700"
                                                            >
                                                                {MANUAL_PAYMENT_OPTIONS.map((mode) => (
                                                                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-xs uppercase tracking-widest text-emerald-700 font-semibold">Reference (Optional)</label>
                                                            <input
                                                                type="text"
                                                                value={attemptConversionReference}
                                                                onChange={(e) => setAttemptConversionReference(e.target.value)}
                                                                disabled={isConvertingAttempt}
                                                                placeholder="Transaction / receipt reference"
                                                                className="mt-2 w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm text-gray-700"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs uppercase tracking-widest text-emerald-700 font-semibold">Reason</label>
                                                            <textarea
                                                                value={attemptConversionReason}
                                                                onChange={(e) => setAttemptConversionReason(e.target.value)}
                                                                disabled={isConvertingAttempt}
                                                                placeholder="Document why this attempt is being converted manually"
                                                                className="mt-2 w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm text-gray-700 min-h-[88px]"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={handleConvertAttemptToPaidOrder}
                                                            disabled={isConvertingAttempt || String(attemptConversionReason || '').trim().length < 8}
                                                            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                                                        >
                                                            {isConvertingAttempt ? 'Converting...' : 'Mark as Successful Order'}
                                                        </button>
                                                    </div>
                                                )}
                                                {!isAttemptEntry(selectedOrder) && !isRefundLockedOrder(selectedOrder) && (
                                                    <div className="mt-4">
                                                        <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Update Status</label>
                                                        <select
                                                            value={pendingStatus || normalizeOrderStatus(selectedOrder.status) || 'confirmed'}
                                                            onChange={(e) => setPendingStatus(e.target.value)}
                                                            disabled={isUpdatingStatus}
                                                            className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none"
                                                        >
                                                            {getAvailableStatusOptions(selectedOrder.status).map((option) => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                        {pendingStatus === 'cancelled' && isPaidPayment(selectedOrder) && (
                                                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
                                                                <p className="text-xs text-amber-800 font-semibold">
                                                                    Shipping charge is non-refundable. Maximum refundable amount: ₹{Math.max(0, Number(selectedOrder?.total || 0) - Number(selectedOrder?.shipping_fee || 0)).toLocaleString('en-IN')}
                                                                </p>
                                                                <div>
                                                                    <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Cancellation Mode</label>
                                                                    <select
                                                                        value={cancellationMode}
                                                                        onChange={(e) => setCancellationMode(e.target.value)}
                                                                        disabled={isUpdatingStatus}
                                                                        className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none"
                                                                    >
                                                                        <option value="">Select cancellation mode</option>
                                                                        {CANCELLATION_MODES.map((mode) => (
                                                                            <option key={mode.value} value={mode.value}>{mode.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                {cancellationMode === 'manual' && (
                                                                    <div className="grid grid-cols-1 gap-3">
                                                                        <div>
                                                                            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Refunded Amount</label>
                                                                            <input type="number" min="0" step="0.01" value={manualRefundAmount} onChange={(e) => setManualRefundAmount(e.target.value)} disabled={isUpdatingStatus} placeholder="Enter refunded amount" className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none" />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Refund Method</label>
                                                                            <select value={manualRefundMethod} onChange={(e) => setManualRefundMethod(e.target.value)} disabled={isUpdatingStatus} className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none">
                                                                                <option value="">Select refund method</option>
                                                                                {MANUAL_REFUND_METHODS.map((method) => (
                                                                                    <option key={method} value={method}>{method}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        {(manualRefundMethod === 'UPI' || manualRefundMethod === 'Bank A/c Transfer') && (
                                                                            <div>
                                                                                <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Reference Number</label>
                                                                                <input type="text" value={manualRefundRef} onChange={(e) => setManualRefundRef(e.target.value)} disabled={isUpdatingStatus} placeholder="Enter reference number" className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none" />
                                                                            </div>
                                                                        )}
                                                                        {manualRefundMethod === 'NEFT/RTGS' && (
                                                                            <div>
                                                                                <label className="text-xs uppercase tracking-widest text-gray-500 font-semibold">UTR Number</label>
                                                                                <input type="text" value={manualRefundUtr} onChange={(e) => setManualRefundUtr(e.target.value)} disabled={isUpdatingStatus} placeholder="Enter UTR number" className="mt-2 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white shadow-sm focus:border-accent outline-none" />
                                                                            </div>
                                                                        )}
                                                                        {manualRefundMethod === 'Voucher code' && (
                                                                            <p className="text-xs text-amber-700">
                                                                                A customer-specific coupon will be auto-generated with 180 days validity after cancellation.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={handleStatusUpdate}
                                                            disabled={isUpdatingStatus || !selectedOrder || !pendingStatus || pendingStatus === normalizeOrderStatus(selectedOrder.status || 'confirmed')}
                                                            className="mt-3 w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60"
                                                        >
                                                            {isUpdatingStatus ? 'Updating...' : 'Update Status'}
                                                        </button>
                                                    </div>
                                                )}
                                                {!isAttemptEntry(selectedOrder) && isRefundLockedOrder(selectedOrder) && (
                                                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                                        Refund has been initiated for this cancelled order. Status changes are locked.
                                                    </div>
                                                )}
                                            </div>

                                            <div className="mt-5 border border-gray-200 rounded-xl overflow-hidden">
                                                <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">Items</div>
                                                <div className="divide-y divide-gray-100">
                                                    {(selectedOrder.items || []).map((item) => {
                                                        const snapshot = item?.item_snapshot && typeof item.item_snapshot === 'object' ? item.item_snapshot : null;
                                                        const quantity = Number(item.quantity ?? snapshot?.quantity ?? 0);
                                                        const unitPrice = Number(item.price ?? snapshot?.unitPrice ?? 0);
                                                        const lineTotal = Number(item.line_total ?? snapshot?.lineTotal ?? (unitPrice * quantity));
                                                        const itemTax = Number(item.tax_amount ?? snapshot?.taxAmount ?? 0);
                                                        const itemTaxRate = Number(item.tax_rate_percent ?? snapshot?.taxRatePercent ?? 0);
                                                        const itemTaxCode = item.tax_code || snapshot?.taxCode || item.tax_name || snapshot?.taxName || '';
                                                        const parsedWarrantyMonths = Number(snapshot?.polishWarrantyMonths ?? 0);
                                                        const itemWarrantyMonths = [6, 7, 8, 9, 12].includes(parsedWarrantyMonths) ? parsedWarrantyMonths : null;
                                                        const itemTitle = getOrderItemTitle(item);
                                                        const itemVariantTitle = getOrderItemVariantTitle(item);
                                                        const itemCategoryLabel = getOrderItemCategoryLabel(item);
                                                        const itemImageUrl = getOrderItemImageUrl(item);
                                                        return (
                                                            <div key={item.id} className="flex items-center gap-4 p-4">
                                                                <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                                                                    {itemImageUrl && <img src={itemImageUrl} alt={itemTitle} className="w-full h-full object-cover" />}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-semibold text-gray-800 line-clamp-1">{itemTitle}</p>
                                                                    {itemVariantTitle && <p className="text-xs text-gray-500 line-clamp-1">{itemVariantTitle}</p>}
                                                                    {itemCategoryLabel && <p className="text-[11px] text-gray-400 line-clamp-1">Category: {itemCategoryLabel}</p>}
                                                                    {itemWarrantyMonths && <p className="text-[11px] text-gray-400 line-clamp-1">Polish Warranty: {itemWarrantyMonths} months</p>}
                                                                    <p className="text-xs text-gray-400 mt-1">₹{unitPrice.toLocaleString()} x {quantity}</p>
                                                                </div>
                                                                <div className="text-right text-sm font-semibold text-gray-800">
                                                                    ₹{lineTotal.toLocaleString()}
                                                                    {itemTax > 0 && (
                                                                        <p className="text-[11px] text-gray-500 font-medium">
                                                                            {(() => {
                                                                                const gst = getGstDisplayDetails({ taxAmount: itemTax, taxRatePercent: itemTaxRate, taxLabel: itemTaxCode });
                                                                                return `${gst.title}: ${gst.totalAmountLabel}`;
                                                                            })()}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="mt-5 grid grid-cols-1 gap-2 text-sm border border-gray-200 rounded-xl p-4 bg-gray-50">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-gray-500">Subtotal</span>
                                                    <span className="font-semibold text-gray-800">₹{Number(selectedOrder.subtotal || 0).toLocaleString()}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-gray-500">Shipping</span>
                                                    <span className="font-semibold text-gray-800">₹{Number(selectedOrder.shipping_fee || 0).toLocaleString()}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-gray-500">Base Price (Before Discounts)</span>
                                                    <span className="font-semibold text-gray-800">₹{Math.max(0, Number(selectedOrder.subtotal || 0) + Number(selectedOrder.shipping_fee || 0)).toLocaleString()}</span>
                                                </div>
                                                {Number(selectedOrder.coupon_discount_value || 0) > 0 && (
                                                    <div className="flex items-center justify-between text-emerald-700">
                                                        <span>Coupon{selectedOrder.coupon_code ? ` (${selectedOrder.coupon_code})` : ''}</span>
                                                        <span className="font-semibold">- ₹{Number(selectedOrder.coupon_discount_value || 0).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                {Number(selectedOrder.loyalty_discount_total || 0) > 0 && (
                                                    <div className="flex items-center justify-between text-blue-700">
                                                        <span>Member Discount</span>
                                                        <span className="font-semibold">- ₹{Number(selectedOrder.loyalty_discount_total || 0).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                {Number(selectedOrder.loyalty_shipping_discount_total || 0) > 0 && (
                                                    <div className="flex items-center justify-between text-blue-700">
                                                        <span>Member Shipping Benefit</span>
                                                        <span className="font-semibold">- ₹{Number(selectedOrder.loyalty_shipping_discount_total || 0).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between text-emerald-700">
                                                    <span>Total Savings</span>
                                                    <span className="font-semibold">₹{Number(selectedOrder.discount_total || 0).toLocaleString()}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-gray-500">Taxable Value After Discounts</span>
                                                    <span className="font-semibold text-gray-800">₹{Math.max(0, Number(selectedOrder.subtotal || 0) + Number(selectedOrder.shipping_fee || 0) - Number(selectedOrder.coupon_discount_value || 0) - Number(selectedOrder.loyalty_discount_total || 0) - Number(selectedOrder.loyalty_shipping_discount_total || 0)).toLocaleString()}</span>
                                                </div>
                                                {Number(selectedOrder.tax_total || 0) > 0 && (
                                                    <div className="flex items-start justify-between">
                                                        <span className="text-gray-500">
                                                            GST
                                                            <span className="block text-[11px] text-gray-400">
                                                                {getGstDisplayDetails({ taxAmount: Number(selectedOrder.tax_total || 0) }).splitAmountLabel}
                                                            </span>
                                                        </span>
                                                        <span className="font-semibold text-gray-800">₹{Number(selectedOrder.tax_total || 0).toLocaleString()}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between text-base font-semibold">
                                                    <span>Total</span>
                                                    <span>₹{Number(selectedOrder.total || 0).toLocaleString()}</span>
                                                </div>
                                            </div>

                                            <div className="mt-5 border border-gray-200 rounded-xl overflow-hidden">
                                                <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase">Customer Details</div>
                                                <div className="divide-y divide-gray-100">
                                                    {customerDetailsRows.map((row) => (
                                                        <div key={row.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 px-4 py-3 text-sm">
                                                            <div className="text-gray-500">{row.label}</div>
                                                            <div className="text-gray-800 whitespace-pre-line break-words">{row.value || '—'}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="mt-5 border border-gray-200 rounded-xl p-4 bg-gray-50">
                                                <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Status Timeline</p>
                                                <div className="mt-3 space-y-3">
                                                    {(selectedOrder.events || []).map((evt) => (
                                                        <div key={evt.id} className="flex items-center justify-between text-sm">
                                                            <span className="font-semibold text-gray-700 capitalize">{evt.status}</span>
                                                            <span className="text-xs text-gray-400">{formatAdminDateTime(evt.created_at)}</span>
                                                        </div>
                                                    ))}
                                                    {(!selectedOrder.events || selectedOrder.events.length === 0) && (
                                                        <p className="text-sm text-gray-400">No timeline data yet.</p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-5 grid grid-cols-1 gap-4">
                                                <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                                                    <p className="text-xs text-gray-400 font-semibold uppercase">Payment Details</p>
                                                    <div className="mt-2 space-y-1 text-sm text-gray-700">
                                                        <p><span className="text-gray-500">Method:</span> {getPaymentMethodLabel(selectedOrder)}</p>
                                                        <p><span className="text-gray-500">Status:</span> {getPaymentStatusLabel(selectedOrder)}</p>
                                                        <p><span className="text-gray-500">Reference:</span> <span className="font-mono text-xs">{getPaymentReference(selectedOrder)}</span></p>
                                                        <p><span className="text-gray-500">Invoice No:</span> <span className="font-mono text-xs">{getInvoiceNumber(selectedOrder)}</span></p>
                                                        {selectedOrder?.failure_reason && (
                                                            <p><span className="text-gray-500">Failure:</span> {selectedOrder.failure_reason}</p>
                                                        )}
                                                        {hasRefundInitiated(selectedOrder) && (
                                                            <>
                                                                <p><span className="text-gray-500">Refund Amount:</span> {getRefundAmount(selectedOrder) > 0 ? `₹${getRefundAmount(selectedOrder).toLocaleString()}` : '—'}</p>
                                                                <p><span className="text-gray-500">Refund Ref:</span> <span className="font-mono text-xs">{getRefundReference(selectedOrder) || '—'}</span></p>
                                                                <p><span className="text-gray-500">Refund Status:</span> {String(selectedOrder?.refund_status || '').trim() || '—'}</p>
                                                                <p><span className="text-gray-500">Refund Mode:</span> {selectedOrder?.refund_mode || '—'}</p>
                                                                <p><span className="text-gray-500">Refund Method:</span> {selectedOrder?.refund_method || '—'}</p>
                                                                <p><span className="text-gray-500">Manual Ref:</span> <span className="font-mono text-xs">{selectedOrder?.manual_refund_ref || '—'}</span></p>
                                                                <p><span className="text-gray-500">Manual UTR:</span> <span className="font-mono text-xs">{selectedOrder?.manual_refund_utr || '—'}</span></p>
                                                                <p><span className="text-gray-500">Refund Voucher:</span> <span className="font-mono text-xs">{getRefundVoucherCode(selectedOrder) || '—'}</span></p>
                                                                <p><span className="text-gray-500">Non-refundable Shipping:</span> ₹{Number(selectedOrder?.refund_notes?.nonRefundableShippingFee ?? selectedOrder?.shipping_fee ?? 0).toLocaleString('en-IN')}</p>
                                                            </>
                                                        )}
                                                        {String(selectedOrder?.payment_gateway || '').toLowerCase() === 'razorpay' && (
                                                            <p className="text-xs text-amber-700 mt-2">
                                                                EMI refund reversals are controlled by the customer&apos;s issuing bank timeline. Shipping charge is non-refundable.
                                                            </p>
                                                        )}
                                                        {normalizeOrderStatus(selectedOrder.status) === 'pending' && (
                                                            <p><span className="text-gray-500">Pending For:</span> {getPendingDurationLabel(selectedOrder.created_at)}</p>
                                                        )}
                                                        {canFetchPaymentStatus(selectedOrder) && (
                                                            <button type="button" onClick={() => handleFetchPaymentStatus({ reason: 'payment' })} disabled={isFetchingPaymentStatus} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60">
                                                                <RefreshCw size={14} className={isFetchingPaymentStatus ? 'animate-spin' : ''} />
                                                                {isFetchingPaymentStatus ? 'Syncing...' : 'Sync Payment / Settlement'}
                                                            </button>
                                                        )}
                                                        {canCheckRefundStatus(selectedOrder) && (
                                                            <button type="button" onClick={() => handleFetchPaymentStatus({ reason: 'refund' })} disabled={isFetchingPaymentStatus} className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-xs font-semibold hover:bg-blue-100 disabled:opacity-60">
                                                                <RefreshCw size={14} className={isFetchingPaymentStatus ? 'animate-spin' : ''} />
                                                                {isFetchingPaymentStatus ? 'Checking...' : 'Check Refund Status'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {!isAttemptEntry(selectedOrder) && (
                                                    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                                                        <p className="text-xs text-gray-400 font-semibold uppercase">Settlement Details</p>
                                                        {selectedOrder?.settlement_snapshot ? (
                                                            <div className="mt-2 space-y-1 text-sm text-gray-700">
                                                                <p><span className="text-gray-500">Settlement ID:</span> <span className="font-mono text-xs">{selectedOrder.settlement_snapshot.id || selectedOrder.settlement_id || '—'}</span></p>
                                                                <p><span className="text-gray-500">Status:</span> {selectedOrder.settlement_snapshot.status || '—'}</p>
                                                                <p><span className="text-gray-500">Settlement Amount:</span> {formatSettlementAmount(selectedOrder.settlement_snapshot.amount)}</p>
                                                                <p><span className="text-gray-500">Charges (Fees):</span> {formatSettlementAmount(selectedOrder.settlement_snapshot.fees)}</p>
                                                                <p><span className="text-gray-500">Tax:</span> {formatSettlementAmount(selectedOrder.settlement_snapshot.tax)}</p>
                                                                <p><span className="text-gray-500">Net Credited:</span> {formatSettlementAmount(selectedOrder.settlement_snapshot.net_amount ?? (Number(selectedOrder.settlement_snapshot.amount || 0) - Number(selectedOrder.settlement_snapshot.fees || 0) - Number(selectedOrder.settlement_snapshot.tax || 0)))}</p>
                                                                <p><span className="text-gray-500">UTR:</span> <span className="font-mono text-xs">{selectedOrder.settlement_snapshot.utr || '—'}</span></p>
                                                                <p><span className="text-gray-500">Created At:</span> {selectedOrder.settlement_snapshot.created_at ? formatAdminDateTime(new Date(Number(selectedOrder.settlement_snapshot.created_at) * 1000).toISOString()) : '—'}</p>
                                                            </div>
                                                        ) : (
                                                            <div className="mt-2 space-y-1">
                                                                <p className="text-sm text-gray-500">Settlement info is not available yet for this payment.</p>
                                                                {settlementContext?.isTestMode && (
                                                                    <p className="text-xs text-amber-700">
                                                                        Razorpay is in test mode. Settlement records are usually not generated in test mode.
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                                                    <p className="text-xs text-gray-400 font-semibold uppercase">Promotion</p>
                                                    <div className="mt-2 space-y-1 text-sm text-gray-700">
                                                        {(() => {
                                                            const couponSplit = getCouponDiscountSplit(selectedOrder);
                                                            const memberProductDiscount = Number(selectedOrder.loyalty_discount_total || 0);
                                                            const memberShippingDiscount = Number(selectedOrder.loyalty_shipping_discount_total || 0);
                                                            const hasMemberBenefit = memberProductDiscount > 0 || memberShippingDiscount > 0;
                                                            return (
                                                                <>
                                                                    <p><span className="text-gray-500">Membership Tier:</span> {getTierLabel(selectedOrder)}</p>
                                                                    <p><span className="text-gray-500">Coupon:</span> {selectedOrder.coupon_code || '—'}</p>
                                                                    <p><span className="text-gray-500">Type:</span> {selectedOrder.coupon_type || '—'}</p>
                                                                    <p><span className="text-gray-500">Coupon Discount:</span> ₹{Number(selectedOrder.coupon_discount_value || 0).toLocaleString()}</p>
                                                                    <p><span className="text-gray-500">Coupon Product Discount:</span> ₹{couponSplit.productDiscount.toLocaleString()}</p>
                                                                    <p><span className="text-gray-500">Coupon Shipping Discount:</span> ₹{couponSplit.shippingDiscount.toLocaleString()}</p>
                                                                    <p><span className="text-gray-500">Member Product Discount:</span> ₹{memberProductDiscount.toLocaleString()}</p>
                                                                    <p><span className="text-gray-500">Member Shipping Discount:</span> ₹{memberShippingDiscount.toLocaleString()}</p>
                                                                    {!hasMemberBenefit && Number(selectedOrder.coupon_discount_value || 0) > 0 && (
                                                                        <p className="text-xs text-emerald-700">
                                                                            Discount is fully from coupon benefits. No membership perk applied.
                                                                        </p>
                                                                    )}
                                                                    <p><span className="text-gray-500">Total Discount:</span> ₹{Number(selectedOrder.discount_total || 0).toLocaleString()}</p>
                                                                    <p><span className="text-gray-500">Source:</span> {isAbandonedRecoveryOrder(selectedOrder) ? 'Abandoned cart recovery' : (selectedOrder.source_channel || 'checkout')}</p>
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}
            {!isDetailsOpen && (
                <button
                    type="button"
                    onClick={openCreateManualOrder}
                    className="md:hidden fixed bottom-24 right-4 z-[175] inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xl shadow-emerald-600/30 hover:bg-emerald-500"
                    aria-label="Create order"
                >
                    <Plus size={22} />
                </button>
            )}
            {isCreateOrderOpen && createPortal(
                <div className="fixed inset-0 z-[90]">
                    <div className="absolute inset-0 bg-black/50" onClick={() => { if (!isCreatingManualOrder) void closeCreateManualOrder(); }}></div>
                    <div className="relative z-10 flex min-h-full items-center justify-center p-4">
                        <div className="w-full max-w-3xl rounded-2xl bg-white border border-gray-200 shadow-2xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Manual Order</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <h3 className="text-lg font-semibold text-gray-900">Create Order</h3>
                                        {selectedManualCustomer && (
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getTierBadgeClasses(selectedManualCustomer)}`}>
                                                {getTierLabel(selectedManualCustomer)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { if (!isCreatingManualOrder) void closeCreateManualOrder(); }}
                                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="p-5 space-y-4 overflow-y-auto">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <label className="text-sm text-gray-600">
                                        Search Customer
                                        <input
                                            className="input-field mt-1"
                                            value={manualCustomerQuery}
                                            onChange={(e) => setManualCustomerQuery(e.target.value)}
                                            placeholder="Name / mobile / email"
                                        />
                                    </label>
                                    <label className="text-sm text-gray-600">
                                        Customer
                                        <select
                                            className={`input-field mt-1 ${manualCreateAttempted && manualValidationState.missingCustomer ? 'border-red-300 focus:border-red-400' : ''}`}
                                            value={manualOrderForm.userId}
                                            onChange={(e) => { void handleManualCustomerSelect(e.target.value); }}
                                            disabled={isManualCustomersLoading}
                                        >
                                            <option value="">{isManualCustomersLoading ? 'Loading customers...' : 'Select customer'}</option>
                                            {filteredManualCustomers.map((customer) => (
                                                <option key={customer.id} value={customer.id}>
                                                    {customer.name || 'Customer'} ({customer.mobile || customer.email || customer.id})
                                                </option>
                                            ))}
                                            {isManualCustomersFetchingMore && <option value="" disabled>Loading more customers...</option>}
                                        </select>
                                        {selectedManualCustomer && (
                                            <p className="mt-1 text-xs text-gray-500">
                                                Selected: {selectedManualCustomer.name} {selectedManualCustomer.mobile ? `• ${selectedManualCustomer.mobile}` : ''}
                                            </p>
                                        )}
                                        {isManualCustomersFetchingMore && (
                                            <p className="mt-1 text-xs text-gray-400 inline-flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Fetching more customers...</p>
                                        )}
                                        {manualCreateAttempted && manualValidationState.missingCustomer && (
                                            <p className="mt-1 text-xs text-red-600">Select a customer to continue.</p>
                                        )}
                                    </label>
                                    <label className="text-sm text-gray-600">
                                        Payment Mode
                                        <select
                                            className="input-field mt-1"
                                            value={manualOrderForm.paymentMode}
                                            onChange={(e) => setManualOrderForm((prev) => ({ ...prev, paymentMode: e.target.value }))}
                                        >
                                            {MANUAL_PAYMENT_OPTIONS.map((mode) => (
                                                <option key={mode.value} value={mode.value}>{mode.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="text-sm text-gray-600">
                                        Payment Reference (Optional)
                                        <input
                                            className="input-field mt-1"
                                            value={manualOrderForm.paymentReference}
                                            onChange={(e) => setManualOrderForm((prev) => ({ ...prev, paymentReference: e.target.value }))}
                                            placeholder="Receipt / transaction reference"
                                        />
                                    </label>
                                    {selectedManualCustomer && customerNeedsManualMobile && (
                                        <label className="text-sm text-gray-600 md:col-span-2">
                                            Customer Mobile
                                            <input
                                                className={`input-field mt-1 ${manualCreateAttempted && (manualValidationState.missingCustomerMobile || manualValidationState.invalidCustomerMobile) ? 'border-red-300 focus:border-red-400' : ''}`}
                                                value={manualOrderForm.mobile}
                                                onChange={(e) => setManualOrderForm((prev) => ({ ...prev, mobile: normalizeMobileDigits(e.target.value).slice(0, 14) }))}
                                                inputMode="numeric"
                                                maxLength={14}
                                                placeholder="Enter customer mobile number"
                                            />
                                            <p className="mt-1 text-xs text-gray-500">This mobile will be saved to the customer profile when the order is created.</p>
                                            {manualCreateAttempted && manualValidationState.missingCustomerMobile && (
                                                <p className="mt-1 text-xs text-red-600">Enter a customer mobile number to continue.</p>
                                            )}
                                            {manualCreateAttempted && !manualValidationState.missingCustomerMobile && manualValidationState.invalidCustomerMobile && (
                                                <p className="mt-1 text-xs text-red-600">Mobile must contain 10-14 digits.</p>
                                            )}
                                        </label>
                                    )}
                                    <label className="text-sm text-gray-600 md:col-span-2">
                                        Coupon (Optional)
                                        <select
                                            className="input-field mt-1"
                                            value={manualOrderForm.couponCode}
                                            onChange={(e) => setManualOrderForm((prev) => ({ ...prev, couponCode: e.target.value }))}
                                            disabled={!manualOrderForm.userId || isManualCouponsLoading}
                                        >
                                            <option value="">
                                                {!manualOrderForm.userId
                                                    ? 'Select customer first'
                                                    : isManualCouponsLoading
                                                        ? 'Loading coupons...'
                                                        : 'No coupon'}
                                            </option>
                                            {manualCoupons.map((coupon) => (
                                                <option
                                                    key={coupon.code}
                                                    value={coupon.code}
                                                    disabled={coupon?.isEligible === false}
                                                >
                                                    {coupon.code} - {coupon.name || coupon.code}{coupon?.isEligible === false ? ' (Not eligible yet)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {manualOrderForm.userId && manualItemPayload.length > 0 && !isManualCouponsLoading && manualCoupons.length === 0 && (
                                            <p className="mt-1 text-xs text-amber-600">No eligible coupons available for current cart value/category.</p>
                                        )}
                                        {manualCouponError && (
                                            <p className="mt-1 text-xs text-amber-600">{manualCouponError}</p>
                                        )}
                                    </label>
                                </div>
                                <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Products & Variants</p>
                                    </div>
                                    <input
                                        className="input-field"
                                        placeholder="Search products by name / sku / variant"
                                        value={manualProductQuery}
                                        onChange={(e) => setManualProductQuery(e.target.value)}
                                    />
                                    {isManualProductsFetchingMore && (
                                        <p className="text-xs text-gray-400 inline-flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Fetching more products...</p>
                                    )}
                                    {(() => {
                                        const selectedProduct = (manualProducts || []).find((p) => String(p?.id) === String(manualDraftItem?.productId || ''));
                                        const variants = Array.isArray(selectedProduct?.variants) ? selectedProduct.variants.filter((variant) => isVariantInStock(variant)) : [];
                                        const hasVariants = variants.length > 0;
                                        return (
                                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                                <label className="text-xs text-gray-500 md:col-span-6">
                                                    Product
                                                    <select
                                                        className="input-field mt-1"
                                                        value={manualDraftItem?.productId || ''}
                                                        onChange={(e) => updateManualDraftItem({ productId: e.target.value, variantId: '' })}
                                                    >
                                                        <option value="">{isManualProductsLoading ? 'Loading products...' : 'Select product'}</option>
                                                        {filteredManualProducts.map((product) => (
                                                            <option key={product.id} value={product.id}>
                                                                {product.title} ({product.sku || `#${product.id}`})
                                                            </option>
                                                        ))}
                                                        {isManualProductsFetchingMore && <option value="" disabled>Loading more products...</option>}
                                                    </select>
                                                </label>
                                                <label className="text-xs text-gray-500 md:col-span-3">
                                                    Variant
                                                    <select
                                                        className="input-field mt-1"
                                                        value={manualDraftItem?.variantId || ''}
                                                        onChange={(e) => updateManualDraftItem({ variantId: e.target.value })}
                                                        disabled={!manualDraftItem?.productId || !hasVariants}
                                                    >
                                                        <option value="">
                                                            {!manualDraftItem?.productId
                                                                ? 'Select product'
                                                                : hasVariants
                                                                    ? 'Select variant'
                                                                    : 'No variant'}
                                                        </option>
                                                        {variants.map((variant) => (
                                                            <option key={variant.id} value={variant.id}>
                                                                {variant.variant_title || `Variant #${variant.id}`} ({variant.sku || variant.id})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label className="text-xs text-gray-500 md:col-span-2">
                                                    Qty
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        className="input-field mt-1"
                                                        value={manualDraftItem?.quantity || 1}
                                                        onChange={(e) => updateManualDraftItem({ quantity: e.target.value })}
                                                    />
                                                </label>
                                                <div className="md:col-span-1">
                                                    <button
                                                        type="button"
                                                        onClick={addManualDraftToCart}
                                                        className="w-full h-10 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                                                        title="Add to cart"
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                <div className="rounded-xl border border-gray-200 p-4">
                                    <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">In-Cart Summary</p>
                                    {isManualSummaryLoading && (
                                        <p className="mt-3 text-xs text-gray-500">Calculating order summary...</p>
                                    )}
                                    {!isManualSummaryLoading && !manualSummary && (
                                        <p className="mt-3 text-xs text-gray-500">Add customer, items, and shipping address to view summary.</p>
                                    )}
                                    {manualSummaryError && (
                                        <p className="mt-2 text-xs text-amber-600">{manualSummaryError}</p>
                                    )}
                                    {manualOrderItems.length > 0 && (
                                        <div className="mt-3 space-y-2 border border-gray-100 rounded-lg p-2 bg-gray-50/50">
                                            {(manualSummary?.items?.length ? manualSummary.items : manualCartDisplayItems).map((item, idx) => (
                                                <div key={`sum-item-${item?.productId || 'p'}-${item?.variantId || ''}-${idx}`} className="grid grid-cols-[1fr_auto] gap-2 text-xs items-start">
                                                    <div>
                                                        <p className="font-semibold text-gray-700 line-clamp-1">{item.title || 'Product'}</p>
                                                        <p className="text-gray-500">{item.variantTitle || 'Default'} • Qty {item.quantity}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-right">
                                                            <span className="font-semibold text-gray-700">₹{Number(item.lineTotal || 0).toLocaleString('en-IN')}</span>
                                                            {Number(item.taxAmount || 0) > 0 && (
                                                                <p className="text-[10px] text-gray-500">
                                                                    {(() => {
                                                                        const gst = getGstDisplayDetails({
                                                                            taxAmount: Number(item.taxAmount || 0),
                                                                            taxRatePercent: Number(item.taxRatePercent || 0),
                                                                            taxLabel: item.taxCode || item.taxName || ''
                                                                        });
                                                                        return `${gst.title}: ${gst.totalAmountLabel} (${gst.splitAmountLabel})`;
                                                                    })()}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeManualCartItem(item?.productId, item?.variantId)}
                                                            className="inline-flex items-center justify-center p-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50"
                                                            title="Delete item"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {manualCreateAttempted && manualValidationState.missingItems && (
                                        <p className="mt-2 text-xs text-red-600">Add at least one product to cart.</p>
                                    )}
                                    {!isManualSummaryLoading && effectiveManualSummary && (
                                        <div className="mt-3 space-y-2 text-sm">
                                            <div className="flex items-center justify-between"><span className="text-gray-500">Subtotal</span><span className="font-semibold">{formatInrOrDash(effectiveManualSummary.subtotal)}</span></div>
                                            <div className="flex items-center justify-between"><span className="text-gray-500">Shipping</span><span className="font-semibold">{formatInrOrDash(effectiveManualSummary.shippingFee)}</span></div>
                                            <div className="flex items-center justify-between"><span className="text-gray-500">Base Price (Before Discounts)</span><span className="font-semibold">{formatInrOrDash(Math.max(0, Number(effectiveManualSummary.subtotal || 0) + Number(effectiveManualSummary.shippingFee || 0)))}</span></div>
                                            {Number(effectiveManualSummary.couponDiscountTotal || 0) > 0 && (
                                                <div className="flex items-center justify-between text-emerald-700"><span>Coupon Discount</span><span className="font-semibold">- {formatInrOrDash(effectiveManualSummary.couponDiscountTotal)}</span></div>
                                            )}
                                            {Number(effectiveManualSummary.loyaltyDiscountTotal || 0) > 0 && (
                                                <div className="flex items-center justify-between text-blue-700"><span>Member Discount</span><span className="font-semibold">- {formatInrOrDash(effectiveManualSummary.loyaltyDiscountTotal)}</span></div>
                                            )}
                                            {Number(effectiveManualSummary.loyaltyShippingDiscountTotal || 0) > 0 && (
                                                <div className="flex items-center justify-between text-blue-700"><span>Member Shipping Benefit</span><span className="font-semibold">- {formatInrOrDash(effectiveManualSummary.loyaltyShippingDiscountTotal)}</span></div>
                                            )}
                                            <div className="flex items-center justify-between"><span className="text-emerald-700">Total Savings</span><span className="font-semibold text-emerald-700">{formatInrOrDash(effectiveManualSummary.discountTotal)}</span></div>
                                            <div className="flex items-center justify-between"><span className="text-gray-500">Taxable Value After Discounts</span><span className="font-semibold">{formatInrOrDash(Math.max(0, Number(effectiveManualSummary.subtotal || 0) + Number(effectiveManualSummary.shippingFee || 0) - Number(effectiveManualSummary.couponDiscountTotal || 0) - Number(effectiveManualSummary.loyaltyDiscountTotal || 0) - Number(effectiveManualSummary.loyaltyShippingDiscountTotal || 0)))}</span></div>
                                            {Number(effectiveManualSummary.taxTotal || 0) > 0 && (
                                                <div className="flex items-start justify-between">
                                                    <span className="text-gray-500">
                                                        GST
                                                        <span className="block text-[10px] text-gray-400">
                                                            {getGstDisplayDetails({ taxAmount: Number(effectiveManualSummary.taxTotal || 0) }).splitAmountLabel}
                                                        </span>
                                                    </span>
                                                    <span className="font-semibold">{formatInrOrDash(effectiveManualSummary.taxTotal)}</span>
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between text-base border-t border-gray-100 pt-2"><span className="font-semibold text-gray-700">Total</span><span className="font-bold text-gray-900">{formatInrOrDash(effectiveManualSummary.total)}</span></div>
                                            {!manualSummary && (
                                                <p className="text-xs text-gray-500">
                                                    Add shipping address and select coupon to fetch exact shipping and membership benefit calculations.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="rounded-xl border border-gray-200 p-4">
                                    <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Shipping Address</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                        <input className={`input-field ${manualCreateAttempted && !String(manualOrderForm.shippingAddress.line1 || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="Address line" value={manualOrderForm.shippingAddress.line1} onChange={(e) => updateManualAddress('shippingAddress', 'line1', e.target.value)} />
                                        <input className={`input-field ${manualCreateAttempted && !String(manualOrderForm.shippingAddress.city || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="City" value={manualOrderForm.shippingAddress.city} onChange={(e) => updateManualAddress('shippingAddress', 'city', e.target.value)} />
                                        <input className={`input-field ${manualCreateAttempted && !String(manualOrderForm.shippingAddress.state || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="State" value={manualOrderForm.shippingAddress.state} onChange={(e) => updateManualAddress('shippingAddress', 'state', e.target.value)} />
                                        <input className={`input-field ${manualCreateAttempted && !String(manualOrderForm.shippingAddress.zip || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="PIN code" value={manualOrderForm.shippingAddress.zip} onChange={(e) => updateManualAddress('shippingAddress', 'zip', e.target.value)} />
                                    </div>
                                    {manualCreateAttempted && manualValidationState.shippingMissing.length > 0 && (
                                        <p className="mt-2 text-xs text-red-600">Shipping missing: {manualValidationState.shippingMissing.join(', ')}</p>
                                    )}
                                </div>
                                {billingAddressEnabled && (
                                    <div className="rounded-xl border border-gray-200 p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">Billing Address</p>
                                            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                                                <input
                                                    type="checkbox"
                                                    checked={manualOrderForm.billingSameAsShipping}
                                                    onChange={(e) => {
                                                        const checked = e.target.checked;
                                                        setManualOrderForm((prev) => ({
                                                            ...prev,
                                                            billingSameAsShipping: checked,
                                                            billingAddress: checked ? { ...prev.shippingAddress } : prev.billingAddress
                                                        }));
                                                    }}
                                                />
                                                Same as shipping
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                            <input className={`input-field ${manualCreateAttempted && !manualOrderForm.billingSameAsShipping && !String(manualOrderForm.billingAddress.line1 || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="Address line" value={manualOrderForm.billingAddress.line1} onChange={(e) => updateManualAddress('billingAddress', 'line1', e.target.value)} disabled={manualOrderForm.billingSameAsShipping} />
                                            <input className={`input-field ${manualCreateAttempted && !manualOrderForm.billingSameAsShipping && !String(manualOrderForm.billingAddress.city || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="City" value={manualOrderForm.billingAddress.city} onChange={(e) => updateManualAddress('billingAddress', 'city', e.target.value)} disabled={manualOrderForm.billingSameAsShipping} />
                                            <input className={`input-field ${manualCreateAttempted && !manualOrderForm.billingSameAsShipping && !String(manualOrderForm.billingAddress.state || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="State" value={manualOrderForm.billingAddress.state} onChange={(e) => updateManualAddress('billingAddress', 'state', e.target.value)} disabled={manualOrderForm.billingSameAsShipping} />
                                            <input className={`input-field ${manualCreateAttempted && !manualOrderForm.billingSameAsShipping && !String(manualOrderForm.billingAddress.zip || '').trim() ? 'border-red-300 focus:border-red-400' : ''}`} placeholder="PIN code" value={manualOrderForm.billingAddress.zip} onChange={(e) => updateManualAddress('billingAddress', 'zip', e.target.value)} disabled={manualOrderForm.billingSameAsShipping} />
                                        </div>
                                        {manualCreateAttempted && manualValidationState.billingMissing.length > 0 && (
                                            <p className="mt-2 text-xs text-red-600">Billing missing: {manualValidationState.billingMissing.join(', ')}</p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => { void closeCreateManualOrder(); }}
                                    disabled={isCreatingManualOrder}
                                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCreateManualOrder}
                                    disabled={isCreatingManualOrder}
                                    className="px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60"
                                >
                                    {isCreatingManualOrder ? 'Creating...' : 'Create Order'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {activeLabelOrder && createPortal(
                <div className="fixed inset-0 z-[190] flex items-center justify-center p-4 animate-fade-in">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={closeLabelPrintModal}
                    />
                    <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-400">Printer Labels</p>
                                <h3 className="mt-2 text-xl font-semibold text-gray-900">Order {activeLabelOrder.order_ref}</h3>
                                <p className="mt-1 text-sm text-gray-500">Print sender and recipient labels separately so each label stays readable.</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeLabelPrintModal}
                                disabled={Boolean(printingLabelId) || isPrinterConnecting}
                                className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-60"
                                aria-label="Close label print modal"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="grid gap-5 px-6 py-6 md:grid-cols-[1.2fr_0.8fr]">
                            <div className="space-y-4">
                                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 rounded-xl bg-violet-100 p-2 text-violet-700">
                                            <Printer size={18} />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-gray-900">Printer Status</p>
                                            <p className="mt-1 text-sm text-gray-600">{printerStatusLabel}</p>
                                            <p className="mt-2 text-xs text-gray-500">
                                                {preferredPrinter
                                                    ? 'If the saved printer is offline, pair again before printing.'
                                                    : 'No printer is paired yet. Pair once here and reuse it from order print actions.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                                    <p className="text-sm font-semibold text-gray-900">Pair Printer</p>
                                    <div className="flex flex-wrap gap-2">
                                        {canPairBluetooth && (
                                            <button
                                                type="button"
                                                onClick={() => handleConnectLabelPrinter('bluetooth')}
                                                disabled={!printerSupport.supported || isPrinterConnecting || Boolean(printingLabelId)}
                                                className="inline-flex items-center rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60"
                                            >
                                                {isPrinterConnecting ? 'Pairing...' : 'Pair via Bluetooth'}
                                            </button>
                                        )}
                                        {canPairUsb && (
                                            <button
                                                type="button"
                                                onClick={() => handleConnectLabelPrinter('usb')}
                                                disabled={!printerSupport.supported || isPrinterConnecting || Boolean(printingLabelId)}
                                                className="inline-flex items-center rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60"
                                            >
                                                {isPrinterConnecting ? 'Pairing...' : 'Pair via USB'}
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid gap-3 text-xs text-gray-500 md:grid-cols-2">
                                        <div className="rounded-xl border border-gray-200 bg-white p-3">
                                            <p className="font-semibold text-gray-700">Bluetooth guidance</p>
                                            <p className="mt-1">Turn on the printer, place it in pairing mode, keep it nearby, and select it when the browser prompt opens.</p>
                                        </div>
                                        <div className="rounded-xl border border-gray-200 bg-white p-3">
                                            <p className="font-semibold text-gray-700">USB guidance</p>
                                            <p className="mt-1">Connect the printer with a cable first, then choose it from the browser's USB device picker.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <p className="text-sm font-semibold text-gray-900">Print From Label</p>
                                    <p className="mt-1 text-xs text-gray-500">Always uses the saved company info.</p>
                                    {!activeFromValidation.ok && (
                                        <p className="mt-2 text-xs text-red-600">Missing: {activeFromValidation.missing.join(', ')}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handlePrintSingleLabel('from', activeLabelOrder)}
                                        disabled={!activeFromValidation.ok || printingLabelId === activeLabelOrderId || isPrinterConnecting}
                                        className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent hover:bg-primary-light disabled:opacity-60"
                                    >
                                        {printingLabelId === activeLabelOrderId && printingLabelType === 'from' ? 'Printing...' : 'Print From Label'}
                                    </button>
                                </div>
                                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                    <p className="text-sm font-semibold text-gray-900">Print To Label</p>
                                    <p className="mt-1 text-xs text-gray-500">Always uses the saved order address snapshot.</p>
                                    {!activeToValidation.ok && (
                                        <p className="mt-2 text-xs text-red-600">Missing: {activeToValidation.missing.join(', ')}</p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handlePrintSingleLabel('to', activeLabelOrder)}
                                        disabled={!activeToValidation.ok || printingLabelId === activeLabelOrderId || isPrinterConnecting}
                                        className="mt-4 w-full rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
                                    >
                                        {printingLabelId === activeLabelOrderId && printingLabelType === 'to' ? 'Printing...' : 'Print To Label'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            <Modal
                isOpen={confirmModal.isOpen}
                onClose={handleConfirmModalClose}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
                confirmText={confirmModal.confirmText}
                onConfirm={handleConfirmAction}
                isLoading={isConfirmProcessing}
            />
        </div>
    );
}

export default Orders;
