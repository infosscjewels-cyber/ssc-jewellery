import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Truck, PackageCheck, Clock3, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMyOrders } from '../context/OrderContext';
import courierIllustration from '../assets/courier.svg';

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const normalizeStatus = (status = '') => String(status || '').trim().toLowerCase() || 'confirmed';

const getStatusPill = (status = '') => {
    const value = normalizeStatus(status);
    if (value === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (value === 'shipped') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (value === 'pending') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (value === 'cancelled') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
};

const getPrimaryLabel = (order = null) => {
    const status = normalizeStatus(order?.status);
    if (status === 'completed') return 'Delivered';
    if (status === 'shipped') return 'Out for delivery';
    if (status === 'pending') return 'Processing';
    if (status === 'cancelled') return 'Cancelled';
    return 'Confirmed';
};

export default function TrackOrder() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const {
        orders = [],
        isLoading = false,
        error: ordersError
    } = useMyOrders({ page: 1, limit: 5, duration: 'latest_10', autoLoad: true });
    const error = ordersError?.message || '';

    const filtered = useMemo(() => {
        const term = String(query || '').trim().toLowerCase();
        if (!term) return orders;
        return orders.filter((order) => {
            const haystack = [
                order?.order_ref,
                order?.id,
                order?.razorpay_order_id,
                order?.razorpay_payment_id,
                order?.status
            ].map((item) => String(item || '').toLowerCase()).join(' ');
            return haystack.includes(term);
        });
    }, [orders, query]);

    const openOrderDetails = (orderId) => {
        if (!orderId) return;
        navigate(`/orders?order=${encodeURIComponent(String(orderId))}`);
    };

    if (!user) return null;

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="max-w-5xl mx-auto px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">Track Order</span>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
                    <div className="grid md:grid-cols-[1.2fr_0.8fr] gap-6 items-center">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-serif text-primary">Track Your Orders</h1>
                            <p className="text-gray-500 mt-2">
                                Search by order ID, order reference, or payment reference. You can only view your own orders.
                            </p>
                            <div className="mt-5 relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Try: SSC-ORDER-001 or razorpay payment id"
                                    className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-sm text-gray-700 focus:outline-none focus:border-accent"
                                />
                            </div>
                        </div>
                        <div className="flex justify-center md:justify-end">
                            <img src={courierIllustration} alt="Track order" className="w-40 md:w-56 h-auto" />
                        </div>
                    </div>
                </div>

                {isLoading && <div className="text-sm text-gray-500">Loading orders...</div>}
                {error && <div className="text-sm text-red-600">{error}</div>}

                {!isLoading && !error && filtered.length === 0 && (
                    <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-500">
                        No matching orders found.
                    </div>
                )}

                <div className="space-y-4">
                    {filtered.map((order) => {
                        const statusLabel = getPrimaryLabel(order);
                        const events = Array.isArray(order?.events) ? order.events : [];
                        const latestEvent = events[events.length - 1] || null;
                        return (
                            <button
                                key={order.id}
                                type="button"
                                onClick={() => openOrderDetails(order.id)}
                                className="w-full text-left bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:border-primary/30 hover:shadow cursor-pointer transition-colors"
                            >
                                <div className="flex flex-wrap gap-3 items-center justify-between">
                                    <div>
                                        <p className="text-xs text-gray-400 uppercase tracking-wider">Order Ref</p>
                                        <p className="text-lg font-semibold text-gray-900">{order?.order_ref || `#${order?.id}`}</p>
                                        <p className="text-xs text-gray-500 mt-1">Placed on {formatDate(order?.created_at)}</p>
                                    </div>
                                    <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-semibold ${getStatusPill(order?.status)}`}>
                                        {statusLabel}
                                    </span>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <StatusTile title="Current Status" value={String(order?.status || 'confirmed')}>
                                        <Clock3 size={14} />
                                    </StatusTile>
                                    <StatusTile title="Last Update" value={formatDate(order?.updated_at || latestEvent?.created_at)}>
                                        <Truck size={14} />
                                    </StatusTile>
                                    <StatusTile title="Payment" value={String(order?.payment_status || 'pending')}>
                                        <PackageCheck size={14} />
                                    </StatusTile>
                                </div>

                                {latestEvent?.description && (
                                    <div className="mt-3 text-xs text-gray-500 flex items-start gap-2">
                                        <AlertCircle size={14} className="mt-0.5 text-gray-400" />
                                        <span>{latestEvent.description}</span>
                                    </div>
                                )}
                                <div className="mt-3 text-xs font-semibold text-primary">
                                    Click to view full order details
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-6 flex justify-center">
                    <Link
                        to="/orders"
                        className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        View All Orders in Profile
                    </Link>
                </div>
            </div>
        </div>
    );
}

function StatusTile({ title, value, children = null }) {
    return (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-gray-500 text-xs uppercase tracking-wider font-semibold">
                {children}
                <span>{title}</span>
            </div>
            <p className="text-sm text-gray-800 font-medium mt-2">{value || '—'}</p>
        </div>
    );
}
