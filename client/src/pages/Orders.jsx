import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, ChevronRight, MessageCircle, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMyOrders } from '../context/OrderContext';
import { useToast } from '../context/ToastContext';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { orderService } from '../services/orderService';
import ordersIllustration from '../assets/orders.svg';
import { getGstDisplayDetails } from '../utils/gst';
import { buildWhatsAppChatLink } from '../utils/publicContact';

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const formatTimelineDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const STATUS_STEPS = ['confirmed', 'shipped', 'completed'];
const normalizeStatus = (status) => {
    return status || 'confirmed';
};
const formatStatusLabel = (status) => {
    const normalized = normalizeStatus(status);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};
const getStatusBadgeClasses = (status) => {
    switch (normalizeStatus(status)) {
        case 'completed':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'shipped':
            return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'pending':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'cancelled':
            return 'bg-red-50 text-red-700 border-red-200';
        default:
            return 'bg-gray-100 text-gray-700 border-gray-200';
    }
};
const statusIndex = (status) => {
    const normalized = normalizeStatus(status);
    if (normalized === 'pending') return 0;
    const idx = STATUS_STEPS.indexOf(normalized);
    return idx >= 0 ? idx : 0;
};
const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const getItemSnapshot = (item) => {
    if (item?.item_snapshot && typeof item.item_snapshot === 'object') return item.item_snapshot;
    if (item?.itemSnapshot && typeof item.itemSnapshot === 'object') return item.itemSnapshot;
    if (item?.snapshot && typeof item.snapshot === 'object') return item.snapshot;
    return null;
};
const getItemQuantity = (item) => {
    const snapshot = getItemSnapshot(item);
    return toNumber(item?.quantity ?? snapshot?.quantity, 0);
};
const getItemUnitPrice = (item) => {
    const snapshot = getItemSnapshot(item);
    return toNumber(item?.price ?? snapshot?.unitPrice, 0);
};
const getItemOriginalPrice = (item) => {
    const snapshot = getItemSnapshot(item);
    return toNumber(item?.original_price ?? snapshot?.originalPrice ?? item?.compare_at ?? item?.mrp, 0);
};
const getItemLineTotal = (item) => {
    const snapshot = getItemSnapshot(item);
    const quantity = getItemQuantity(item);
    const unitPrice = getItemUnitPrice(item);
    return toNumber(item?.line_total ?? snapshot?.lineTotal, unitPrice * quantity);
};
const getItemTaxAmount = (item) => {
    const snapshot = getItemSnapshot(item);
    return toNumber(item?.tax_amount ?? item?.taxAmount ?? snapshot?.taxAmount, 0);
};
const getItemTaxRate = (item) => {
    const snapshot = getItemSnapshot(item);
    return toNumber(item?.tax_rate_percent ?? item?.taxRatePercent ?? snapshot?.taxRatePercent, 0);
};
const getItemTaxLabel = (item) => {
    const snapshot = getItemSnapshot(item);
    return item?.tax_code || item?.taxCode || item?.tax_name || item?.taxName || snapshot?.taxCode || snapshot?.taxName || '';
};
const getItemTitle = (item) => {
    const snapshot = getItemSnapshot(item);
    return item?.title || item?.product_title || item?.name || snapshot?.title || snapshot?.productTitle || 'Order item';
};
const getItemVariantTitle = (item) => {
    const snapshot = getItemSnapshot(item);
    return item?.variant_title || item?.variant_name || snapshot?.variantTitle || snapshot?.variant || '';
};
const getItemCategoryLabel = (item) => {
    const snapshot = getItemSnapshot(item);
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
const getItemSku = (item) => {
    const snapshot = getItemSnapshot(item);
    return item?.sku || snapshot?.sku || '';
};
const getItemImage = (item) => {
    const snapshot = getItemSnapshot(item);
    return item?.image_url || snapshot?.imageUrl || '';
};
const getItemDiscountPercent = (item) => {
    const unitPrice = getItemUnitPrice(item);
    const originalPrice = getItemOriginalPrice(item);
    if (originalPrice <= unitPrice || originalPrice <= 0) return 0;
    return Math.round(((originalPrice - unitPrice) / originalPrice) * 100);
};
const getItemSavings = (item) => {
    const unitPrice = getItemUnitPrice(item);
    const originalPrice = getItemOriginalPrice(item);
    const qty = getItemQuantity(item);
    if (originalPrice <= unitPrice) return 0;
    return Math.max(0, (originalPrice - unitPrice) * qty);
};
const getOrderSavings = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const productSavings = items.reduce((sum, item) => sum + getItemSavings(item), 0);
    const promoSavings = toNumber(order?.discount_total, 0);
    return productSavings + promoSavings;
};
const getClientTimeline = (order) => {
    const events = Array.isArray(order?.events) ? order.events : [];
    const status = normalizeStatus(order?.status);
    if (status === 'pending') return events;
    return events.filter((evt) => normalizeStatus(evt?.status) !== 'pending');
};
const isPendingDelayState = (order) => normalizeStatus(order?.status) === 'pending';
const getPaymentMethodLabel = (order) => {
    const method = String(order?.payment_gateway || order?.paymentGateway || 'razorpay').toLowerCase();
    if (method === 'razorpay') return 'Razorpay';
    if (method === 'cod') return 'Online Payment';
    return method ? method.toUpperCase() : '—';
};
const getPaymentReference = (order) => {
    return order?.razorpay_payment_id || order?.razorpayPaymentId || '—';
};
const getInvoiceNumber = (order) => {
    const ref = order?.order_ref || order?.orderRef || order?.id || 'N/A';
    return `INV-${ref}`;
};
const getPaymentStatusLabel = (order) => {
    const status = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
    if (!status) return '—';
    return status.charAt(0).toUpperCase() + status.slice(1);
};
const isRetryablePaymentStatus = (order) => {
    const status = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
    return status === 'failed' || status === 'expired';
};
const getRefundAmount = (order) => Number(order?.refund_amount ?? order?.refundAmount ?? 0);
const getRefundReference = (order) => order?.refund_reference || order?.refundReference || '';
const getRefundStatus = (order) => String(order?.refund_status || order?.refundStatus || '').trim();
const hasRefundInitiated = (order) => Boolean(
    getRefundReference(order)
    || getRefundStatus(order)
    || String(order?.payment_status || order?.paymentStatus || '').toLowerCase() === 'refunded'
    || getRefundAmount(order) > 0
);
const canCheckRefundStatus = (order) => hasRefundInitiated(order)
    && Boolean(order?.razorpay_order_id || order?.razorpayOrderId || order?.razorpay_payment_id || order?.razorpayPaymentId);
const isCancelledWithoutRefund = (order) => String(order?.status || '').toLowerCase() === 'cancelled' && !hasRefundInitiated(order);
const getOrderSupportLink = (order) => {
    const orderRef = order?.order_ref || order?.orderRef || order?.id || 'N/A';
    const text = `Hi, I need support for my order ${orderRef}. I have a query regarding this order.`;
    return buildWhatsAppChatLink({ text });
};

const buildVisiblePages = (currentPage, totalPages, windowSize = 5) => {
    const safeTotal = Math.max(1, Number(totalPages || 1));
    const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage || 1)));
    if (safeTotal <= windowSize) return Array.from({ length: safeTotal }, (_, idx) => idx + 1);
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, safeCurrent - half);
    let end = Math.min(safeTotal, start + windowSize - 1);
    if (end - start + 1 < windowSize) {
        start = Math.max(1, end - windowSize + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
};

export default function Orders() {
    const { user } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [duration, setDuration] = useState('latest_10');
    const [page, setPage] = useState(1);
    const [isRetryingPayment, setIsRetryingPayment] = useState(false);
    const [isCheckingRefundStatus, setIsCheckingRefundStatus] = useState(false);
    const [downloadingInvoiceId, setDownloadingInvoiceId] = useState(null);
    const limit = 10;
    const selectedOrderId = selectedOrder?.id;
    const { orders, isLoading, pagination, error, lastOrderEvent } = useMyOrders({ page, limit, duration });
    const visiblePages = useMemo(
        () => buildVisiblePages(page, pagination.totalPages, 5),
        [page, pagination.totalPages]
    );

    useEffect(() => {
        if (!error) return;
        toast.error(error.message || 'Failed to load orders');
    }, [error, toast]);

    useEffect(() => {
        if (!selectedOrderId) return;
        const latest = orders.find((order) => String(order.id) === String(selectedOrderId));
        if (!latest) return;
        setSelectedOrder((prev) => {
            if (!prev || String(prev.id) !== String(latest.id)) return prev;
            const next = { ...prev, ...latest };
            const isSame =
                prev.status === next.status &&
                prev.updated_at === next.updated_at &&
                prev.total === next.total &&
                prev.payment_status === next.payment_status &&
                prev.payment_gateway === next.payment_gateway &&
                prev.razorpay_payment_id === next.razorpay_payment_id &&
                (prev.events?.length || 0) === (next.events?.length || 0);
            return isSame ? prev : next;
        });
    }, [orders, selectedOrderId]);

    useEffect(() => {
        if (!selectedOrderId || !lastOrderEvent) return;
        if (String(selectedOrderId) !== String(lastOrderEvent.id)) return;
        setSelectedOrder((prev) => ({ ...prev, ...lastOrderEvent }));
    }, [lastOrderEvent, selectedOrderId]);

    useEffect(() => {
        const totalPages = Number(pagination?.totalPages || 1);
        if (page > totalPages) {
            setPage(Math.max(1, totalPages));
        }
    }, [page, pagination?.totalPages]);

    useEffect(() => {
        const targetOrderId = String(searchParams.get('order') || '').trim();
        if (!targetOrderId || !orders.length) return;
        const match = orders.find((order) => String(order.id) === targetOrderId);
        if (!match) return;
        setSelectedOrder(match);
        setDetailsOpen(true);
    }, [orders, searchParams]);

    const openOrderDetails = (order) => {
        if (!order?.id) return;
        setSelectedOrder(order);
        setDetailsOpen(true);
        const next = new URLSearchParams(searchParams);
        next.set('order', String(order.id));
        setSearchParams(next, { replace: true });
    };

    const closeOrderDetails = () => {
        setDetailsOpen(false);
        const next = new URLSearchParams(searchParams);
        if (next.has('order')) {
            next.delete('order');
            setSearchParams(next, { replace: true });
        }
    };

    const canDownloadInvoice = (order) => {
        const status = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
        return status === 'paid' || status === 'refunded';
    };
    const handleCheckRefundStatus = async (order) => {
        if (!order?.id || !canCheckRefundStatus(order) || isCheckingRefundStatus) return;
        setIsCheckingRefundStatus(true);
        try {
            const data = await orderService.fetchMyPaymentStatus({ orderId: order.id });
            if (data?.order) {
                setSelectedOrder((prev) => (prev && String(prev.id) === String(data.order.id) ? { ...prev, ...data.order } : prev));
            }
            toast.success(`Refund status synced: ${data?.order?.refund_status || data?.paymentStatus || 'updated'}`);
        } catch (error) {
            toast.error(error.message || 'Failed to fetch refund status');
        } finally {
            setIsCheckingRefundStatus(false);
        }
    };
    const handleDownloadInvoice = async (order) => {
        if (!canDownloadInvoice(order)) return;
        const targetId = order?.id;
        setDownloadingInvoiceId(targetId);
        try {
            await orderService.downloadMyInvoice(targetId);
        } catch (error) {
            toast.error(error.message || 'Unable to generate invoice');
        } finally {
            setDownloadingInvoiceId(null);
        }
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-secondary">
            <div className="max-w-5xl mx-auto px-4 md:px-8 py-10 md:py-12">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <Link to="/profile" className="hover:text-primary">Profile</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-primary font-semibold">Orders</span>
                </div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-serif text-primary">My Orders</h1>
                        <p className="text-sm text-gray-500 mt-2">Track your recent purchases and delivery status.</p>
                    </div>
                    <Link to="/shop" className="text-sm font-semibold text-primary">Continue shopping</Link>
                </div>

                {isLoading ? (
                    <div className="py-16 text-center text-gray-400">Loading orders...</div>
                ) : orders.length === 0 && Number(pagination?.totalOrders || 0) === 0 ? (
                    <div className="py-10 flex flex-col items-center text-center gap-6">
                        <img src={ordersIllustration} alt="No orders" className="w-52 md:w-64" />
                        <div className="text-gray-400">
                            No orders yet. <Link to="/shop" className="text-primary font-semibold">Start shopping</Link>
                        </div>
                    </div>
                ) : orders.length === 0 ? (
                    <div className="py-14 text-center">
                        <p className="text-gray-500 text-sm">No orders on this page.</p>
                        <button
                            type="button"
                            onClick={() => setPage(1)}
                            className="mt-3 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                            Go to Page 1
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                            <p className="text-sm text-gray-500">Filter by duration</p>
                            <select
                                value={duration}
                                onChange={(e) => {
                                    setDuration(e.target.value);
                                    setPage(1);
                                }}
                                className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 bg-white"
                            >
                                <option value="latest_10">Latest Orders (10)</option>
                                <option value="7">Last 7 days</option>
                                <option value="30">Last 30 days</option>
                                <option value="90">Last 90 days</option>
                            </select>
                        </div>
                        {orders.map((order) => (
                            <div
                                key={order.id}
                                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"
                            >
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-14 h-14 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                                            {order.items?.[0]?.image_url && (
                                                <img src={order.items[0].image_url} alt={order.items[0].title || 'Order item'} className="w-full h-full object-cover" />
                                            )}
                                        </div>
                                        <div>
                                        <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Order Ref</p>
                                        <p className="text-lg font-semibold text-gray-800">{order.order_ref}</p>
                                        <p className="text-sm text-gray-500 mt-1">Placed on {formatDate(order.created_at)}</p>
                                        <span className={`mt-2 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getStatusBadgeClasses(order.status)}`}>
                                            {formatStatusLabel(order.status)}
                                        </span>
                                        </div>
                                    </div>
                                        <div className="text-sm text-gray-600 md:min-w-[220px]">
                                            <div className="flex items-center gap-2">
                                                <Package size={16} className="text-primary" />
                                                <span>{order.items?.length || 0} items</span>
                                            </div>
                                            <p className="mt-1 font-semibold text-gray-800">₹{Number(order.total || 0).toLocaleString()}</p>
                                            {getOrderSavings(order) > 0 && (
                                                <span className="mt-2 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                    Total savings worth ₹{getOrderSavings(order).toLocaleString()}
                                                </span>
                                            )}
                                    </div>
                                        <div className="flex items-center gap-2">
                                            {canDownloadInvoice(order) && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDownloadInvoice(order)}
                                                    disabled={downloadingInvoiceId === order.id}
                                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                                                >
                                                    <Download size={15} />
                                                    {downloadingInvoiceId === order.id ? 'Generating...' : 'Invoice'}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => openOrderDetails(order)}
                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                                            >
                                                View Details <ChevronRight size={16} />
                                            </button>
                                        </div>
                                </div>
                            </div>
                        ))}
                        {Number(pagination.totalPages || 1) >= 1 && (
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                                <p className="text-sm text-gray-600">
                                    Showing page {Number(pagination.currentPage || page)} of {Number(pagination.totalPages || 1)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                        disabled={page <= 1}
                                        className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 disabled:opacity-50"
                                    >
                                        Previous
                                    </button>
                                    {visiblePages.map((pageNo) => (
                                        <button
                                            key={pageNo}
                                            type="button"
                                            onClick={() => setPage(pageNo)}
                                            className={`min-w-9 px-3 py-2 rounded-lg border text-sm font-semibold ${
                                                pageNo === page
                                                    ? 'border-primary bg-primary text-accent'
                                                    : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
                                            }`}
                                        >
                                            {pageNo}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setPage((prev) => Math.min(Number(pagination.totalPages || 1), prev + 1))}
                                        disabled={page >= Number(pagination.totalPages || 1)}
                                        className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {detailsOpen && selectedOrder && createPortal(
                    <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-md h-full shadow-2xl p-6 overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-semibold text-gray-900">{selectedOrder.order_ref}</h3>
                                <button onClick={closeOrderDetails} className="text-gray-400 hover:text-gray-600">Close</button>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">Placed on {formatDate(selectedOrder.created_at)}</p>
                            <p className="text-xs text-gray-500 mt-1">Invoice No: <span className="font-mono">{getInvoiceNumber(selectedOrder)}</span></p>

                            <div className="mt-5">
                                <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Track Order</p>
                            {selectedOrder.status === 'cancelled' ? (
                                <div className="mt-3 text-sm font-semibold text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                                    Order cancelled
                                </div>
                            ) : (
                                    <div className="mt-3">
                                        {isPendingDelayState(selectedOrder) && (
                                            <div className="mb-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                                                Processing delay: your order is still in queue and will move to shipped once dispatch begins.
                                            </div>
                                        )}
                                        <input
                                            type="range"
                                            min="0"
                                            max={STATUS_STEPS.length - 1}
                                            value={statusIndex(selectedOrder.status)}
                                            readOnly
                                            className="w-full accent-emerald-500"
                                        />
                                        <div className="mt-3 flex items-center justify-between gap-2">
                                        {STATUS_STEPS.map((step, idx) => {
                                            const active = idx <= statusIndex(selectedOrder.status);
                                            return (
                                                <div key={step} className="flex-1 flex flex-col items-center">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                                        active ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'
                                                    }`}>
                                                        {idx + 1}
                                                    </div>
                                                    <p className={`mt-2 text-[11px] uppercase tracking-widest ${
                                                        active ? 'text-emerald-600' : 'text-gray-400'
                                                    }`}>
                                                        {step}
                                                    </p>
                                                </div>
                                            );
                                        })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-5">
                                <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Status Timeline</p>
                                <div className="mt-3 space-y-2">
                                    {getClientTimeline(selectedOrder).map((evt) => (
                                        <div key={evt.id} className="flex items-center justify-between text-sm">
                                            <span className="font-semibold text-gray-700 capitalize">{evt.status}</span>
                                            <span className="text-xs text-gray-400">{formatTimelineDate(evt.created_at)}</span>
                                        </div>
                                    ))}
                                    {getClientTimeline(selectedOrder).length === 0 && (
                                        <p className="text-sm text-gray-400">No timeline data yet.</p>
                                    )}
                                </div>
                            </div>
                            <div className="mt-4 border border-gray-200 rounded-xl divide-y">
                                {(selectedOrder.items || []).map((item) => (
                                    <div key={item.id} className="flex items-center gap-3 p-4">
                                        <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden">
                                            {getItemImage(item) && <img src={getItemImage(item)} alt={getItemTitle(item)} className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-800 line-clamp-1">{getItemTitle(item)}</p>
                                            <p className="text-xs text-gray-500 line-clamp-1">
                                                {getItemVariantTitle(item) || 'Default variant'}
                                                {getItemSku(item) ? ` • SKU: ${getItemSku(item)}` : ''}
                                            </p>
                                            {getItemCategoryLabel(item) && (
                                                <p className="text-[11px] text-gray-400 line-clamp-1">Category: {getItemCategoryLabel(item)}</p>
                                            )}
                                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                <p className="text-xs text-gray-700 font-semibold">₹{getItemUnitPrice(item).toLocaleString()}</p>
                                                {getItemOriginalPrice(item) > getItemUnitPrice(item) && (
                                                    <>
                                                        <p className="text-[11px] text-gray-400 line-through">₹{getItemOriginalPrice(item).toLocaleString()}</p>
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                                                            {getItemDiscountPercent(item)}% OFF
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">₹{getItemUnitPrice(item).toLocaleString()} x {getItemQuantity(item)}</p>
                                        </div>
                                        <div className="text-sm font-semibold text-gray-800">
                                            ₹{getItemLineTotal(item).toLocaleString()}
                                            {getItemTaxAmount(item) > 0 && (
                                                <p className="text-[11px] text-gray-500 font-medium">
                                                    {(() => {
                                                        const gst = getGstDisplayDetails({
                                                            taxAmount: getItemTaxAmount(item),
                                                            taxRatePercent: getItemTaxRate(item),
                                                            taxLabel: getItemTaxLabel(item)
                                                        });
                                                        return `${gst.title}: ${gst.totalAmountLabel}`;
                                                    })()}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 space-y-2 text-sm">
                                <div className="flex justify-center">
                                    <a
                                        href={getOrderSupportLink(selectedOrder)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 text-xs font-semibold hover:bg-green-100"
                                    >
                                        <MessageCircle size={14} />
                                        Need Support
                                    </a>
                                </div>
                                {isCancelledWithoutRefund(selectedOrder) && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        Refund was not initiated for this cancelled order. Please contact admin for refund via WhatsApp support.
                                    </div>
                                )}
                                {String(selectedOrder?.payment_gateway || '').toLowerCase() === 'razorpay' && (
                                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                                        For EMI transactions, refund reversal timelines are decided by your card issuing bank. Shipping charges are non-refundable.
                                    </div>
                                )}
                                {canDownloadInvoice(selectedOrder) && (
                                    <div className="flex justify-center">
                                        <button
                                            type="button"
                                            onClick={() => handleDownloadInvoice(selectedOrder)}
                                            disabled={downloadingInvoiceId === selectedOrder.id}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-60"
                                        >
                                            <Download size={14} />
                                            {downloadingInvoiceId === selectedOrder.id ? 'Generating...' : 'Download Invoice'}
                                        </button>
                                    </div>
                                )}
                                {canCheckRefundStatus(selectedOrder) && (
                                    <div className="flex justify-center">
                                        <button
                                            type="button"
                                            onClick={() => handleCheckRefundStatus(selectedOrder)}
                                            disabled={isCheckingRefundStatus}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100 disabled:opacity-60"
                                        >
                                            <RefreshCw size={14} className={isCheckingRefundStatus ? 'animate-spin' : ''} />
                                            {isCheckingRefundStatus ? 'Checking...' : 'Check Refund Status'}
                                        </button>
                                    </div>
                                )}
                                {isRetryablePaymentStatus(selectedOrder) && (
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                if (isRetryingPayment) return;
                                                setIsRetryingPayment(true);
                                                try {
                                                    await orderService.retryRazorpayOrder({ orderId: selectedOrder.id });
                                                    toast.success('New payment session created. Redirecting to checkout while ordering is available...');
                                                    navigate('/checkout');
                                                } catch (error) {
                                                    toast.error(error?.message || 'Unable to retry payment');
                                                } finally {
                                                    setIsRetryingPayment(false);
                                                }
                                            }}
                                            className="px-3 py-1.5 rounded-lg bg-primary text-accent text-xs font-semibold disabled:opacity-60"
                                            disabled={isRetryingPayment}
                                        >
                                            {isRetryingPayment ? 'Retrying...' : 'Retry Payment'}
                                        </button>
                                    </div>
                                )}
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Payment Method</span>
                                    <span>{getPaymentMethodLabel(selectedOrder)}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Payment Status</span>
                                    <span>{getPaymentStatusLabel(selectedOrder)}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Payment Ref</span>
                                    <span className="font-mono text-xs text-gray-700">{getPaymentReference(selectedOrder)}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Invoice No</span>
                                    <span className="font-mono text-xs text-gray-700">{getInvoiceNumber(selectedOrder)}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Coupon</span>
                                    <span>{selectedOrder.coupon_code || '—'}</span>
                                </div>
                                {hasRefundInitiated(selectedOrder) && (
                                    <>
                                        <div className="flex items-center justify-between text-gray-600">
                                            <span>Refund Amount</span>
                                            <span>{getRefundAmount(selectedOrder) > 0 ? `₹${getRefundAmount(selectedOrder).toLocaleString()}` : '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-gray-600">
                                            <span>Refund Ref</span>
                                            <span className="font-mono text-xs text-gray-700">{getRefundReference(selectedOrder) || '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-gray-600">
                                            <span>Refund Status</span>
                                            <span>{getRefundStatus(selectedOrder) || '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-gray-600">
                                            <span>Refund Method</span>
                                            <span>{selectedOrder?.refund_method || '—'}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-gray-600">
                                            <span>Refund Voucher</span>
                                            <span className="font-mono text-xs text-gray-700">{selectedOrder?.refund_coupon_code || '—'}</span>
                                        </div>
                                    </>
                                )}
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Subtotal</span>
                                    <span>₹{toNumber(selectedOrder.subtotal).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Shipping</span>
                                    <span>₹{toNumber(selectedOrder.shipping_fee).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Base Price (Before Discounts)</span>
                                    <span>₹{Math.max(0, toNumber(selectedOrder.subtotal) + toNumber(selectedOrder.shipping_fee)).toLocaleString()}</span>
                                </div>
                                {toNumber(selectedOrder.coupon_discount_value) > 0 && (
                                    <div className="flex items-center justify-between text-emerald-700">
                                        <span>Coupon{selectedOrder.coupon_code ? ` (${selectedOrder.coupon_code})` : ''}</span>
                                        <span>- ₹{toNumber(selectedOrder.coupon_discount_value).toLocaleString()}</span>
                                    </div>
                                )}
                                {toNumber(selectedOrder.loyalty_discount_total) > 0 && (
                                    <div className="flex items-center justify-between text-blue-700">
                                        <span>Member Discount</span>
                                        <span>- ₹{toNumber(selectedOrder.loyalty_discount_total).toLocaleString()}</span>
                                    </div>
                                )}
                                {toNumber(selectedOrder.loyalty_shipping_discount_total) > 0 && (
                                    <div className="flex items-center justify-between text-blue-700">
                                        <span>Member Shipping Benefit</span>
                                        <span>- ₹{toNumber(selectedOrder.loyalty_shipping_discount_total).toLocaleString()}</span>
                                    </div>
                                )}
                                {toNumber(selectedOrder.discount_total) > 0 && (
                                    <div className="flex items-center justify-between text-emerald-700">
                                        <span>Total savings</span>
                                        <span>₹{toNumber(selectedOrder.discount_total).toLocaleString()}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between text-gray-600">
                                    <span>Taxable Value After Discounts</span>
                                    <span>₹{Math.max(0, toNumber(selectedOrder.subtotal) + toNumber(selectedOrder.shipping_fee) - toNumber(selectedOrder.coupon_discount_value) - toNumber(selectedOrder.loyalty_discount_total) - toNumber(selectedOrder.loyalty_shipping_discount_total)).toLocaleString()}</span>
                                </div>
                                {toNumber(selectedOrder.tax_total) > 0 && (
                                    <div className="flex items-start justify-between text-gray-600">
                                        <span>
                                            GST
                                            <span className="block text-[11px] text-gray-400">
                                                {getGstDisplayDetails({ taxAmount: toNumber(selectedOrder.tax_total) }).splitAmountLabel}
                                            </span>
                                        </span>
                                        <span>₹{toNumber(selectedOrder.tax_total).toLocaleString()}</span>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-gray-200 flex items-center justify-between font-semibold text-gray-900">
                                    <span>Total</span>
                                    <span>₹{toNumber(selectedOrder.total).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ,
                    document.body
                )}
            </div>
        </div>
    );
}
