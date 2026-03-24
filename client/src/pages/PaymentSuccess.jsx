import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { orderService } from '../services/orderService';
import { useToast } from '../context/ToastContext';
import { useCart } from '../context/CartContext';
import successDing from '../assets/success_ding.mp3';
import { burstConfetti, playCue } from '../utils/celebration';
import CheckoutFlowHeader from '../components/CheckoutFlowHeader';
import { getGstDisplayDetails } from '../utils/gst';
import { BRAND_LOGO_URL } from '../utils/branding.js';

export default function PaymentSuccess() {
    const toast = useToast();
    const { clearCart } = useCart();
    const [searchParams] = useSearchParams();
    const orderId = searchParams.get('orderId');
    const paymentRef = searchParams.get('razorpay_payment_id') || '';
    const paymentStatus = String(searchParams.get('razorpay_payment_link_status') || '').toLowerCase();
    const isFailed = paymentStatus && paymentStatus !== 'paid';
    const [isLoading, setIsLoading] = useState(true);
    const [order, setOrder] = useState(null);
    const [pollState, setPollState] = useState({ attempts: 0, exhausted: false });
    const clearedRecoveryCartRef = useRef(false);
    const celebratedRef = useRef(false);

    useEffect(() => {
        let ignore = false;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const load = async () => {
            setIsLoading(true);
            try {
                if (ignore) return;
                if (paymentRef) {
                    let resolved = null;
                    const maxAttempts = 10;
                    for (let i = 0; i < maxAttempts; i += 1) {
                        if (!ignore) setPollState({ attempts: i + 1, exhausted: false });
                        try {
                            const payload = await orderService.getMyOrderByPaymentRef(paymentRef);
                            resolved = payload?.order || null;
                            if (resolved) break;
                        } catch (error) {
                            const msg = String(error?.message || '').toLowerCase();
                            if (!msg.includes('not found') || i === maxAttempts - 1) throw error;
                        }
                        await wait(1000 + (i * 500));
                    }
                    if (!ignore) setPollState((prev) => ({ attempts: Math.max(prev.attempts, resolved ? prev.attempts : maxAttempts), exhausted: !resolved }));
                    setOrder(resolved || null);
                    return;
                }
                const data = await orderService.getMyOrders({ page: 1, limit: 20, duration: 'all', force: true });
                const rows = data?.orders || [];
                const found = orderId
                    ? rows.find((row) => String(row.id) === String(orderId))
                    : null;
                setOrder(found || null);
            } catch (error) {
                if (!ignore) toast.error(error?.message || 'Failed to load order summary');
            } finally {
                if (!ignore) setIsLoading(false);
            }
        };
        load();
        return () => { ignore = true; };
    }, [orderId, paymentRef, toast]);

    const items = useMemo(() => Array.isArray(order?.items) ? order.items : [], [order?.items]);
    const isRecoveryOrder = Boolean(order?.is_abandoned_recovery || order?.isAbandonedRecovery);
    const orderRef = order?.order_ref || order?.orderRef || null;
    const getItemImage = (item) => (
        item?.image_url
        || item?.imageUrl
        || item?.item_snapshot?.imageUrl
        || item?.snapshot?.imageUrl
        || null
    );

    useEffect(() => {
        if (isFailed) return;
        if (!order?.id) return;
        if (!isRecoveryOrder) return;
        if (clearedRecoveryCartRef.current) return;
        clearedRecoveryCartRef.current = true;
        clearCart().catch(() => {});
    }, [clearCart, isFailed, isRecoveryOrder, order?.id]);

    useEffect(() => {
        if (isFailed || !order?.id) {
            celebratedRef.current = false;
            return;
        }
        if (celebratedRef.current) return;
        celebratedRef.current = true;
        burstConfetti();
        playCue(successDing);
    }, [isFailed, order?.id]);

    return (
        <div className="min-h-screen bg-secondary px-4 py-10 md:py-12">
            <div className="max-w-3xl mx-auto space-y-6">
                <CheckoutFlowHeader state={isFailed ? 'failed' : 'confirmation'} />
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm max-w-xl w-full p-6 mx-auto">
                    <img src={BRAND_LOGO_URL} alt="SSC Jewellery" className="h-10 w-auto mb-4" />
                    <h1 className="text-2xl font-serif text-primary">
                        {isFailed ? 'Order Failed' : 'Order Received'}
                    </h1>
                    <p className={`text-sm mt-3 ${isFailed ? 'text-red-600' : 'text-gray-600'}`}>
                        {isFailed
                            ? 'Payment was not completed. You can retry payment from your pending order.'
                            : 'Your payment was completed successfully.'}
                    </p>

                    {(orderRef || orderId || paymentRef) && (
                        <div className="mt-4 text-xs text-gray-500 space-y-1">
                            {orderRef && <p>Order Ref: <span className="font-mono">{orderRef}</span></p>}
                            {orderId && <p>Order ID: <span className="font-mono">{orderId}</span></p>}
                            {paymentRef && <p>Payment Ref: <span className="font-mono">{paymentRef}</span></p>}
                        </div>
                    )}

                    <div className="mt-5 border border-gray-200 rounded-xl p-4">
                        {isLoading ? (
                            <p className="text-sm text-gray-500">Loading order summary...</p>
                        ) : !order ? (
                            <div className="space-y-2">
                                <p className="text-sm text-gray-500">
                                    {paymentRef ? 'Payment confirmed. Finalizing your order summary...' : 'Order summary will appear shortly.'}
                                </p>
                                {paymentRef && pollState.attempts > 0 && (
                                    <p className="text-xs text-gray-400">Status checks attempted: {pollState.attempts}</p>
                                )}
                                {paymentRef && pollState.exhausted && (
                                    <p className="text-xs text-amber-700">
                                        The payment is captured, but the order summary is taking longer than usual. Check `Orders` shortly.
                                    </p>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    {items.map((item) => (
                                        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="flex items-center justify-between text-sm">
                                            <div className="min-w-0 flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
                                                    {getItemImage(item) ? (
                                                        <img src={getItemImage(item)} alt={item.title} className="w-full h-full object-cover" />
                                                    ) : null}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-medium text-gray-800 truncate">{item.title}</p>
                                                    <p className="text-xs text-gray-500">Qty: {Number(item.quantity || 0)}</p>
                                                </div>
                                            </div>
                                            <p className="font-semibold text-gray-800">₹{Number(item.line_total || 0).toLocaleString()}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 pt-3 border-t border-gray-100 text-sm text-gray-700 space-y-1">
                                    {(() => {
                                        const subtotal = Number(order.subtotal || 0);
                                        const couponDiscount = Number(order.coupon_discount_value || 0);
                                        const memberDiscount = Number(order.loyalty_discount_total || 0);
                                        const memberShippingBenefit = Number(order.loyalty_shipping_discount_total || 0);
                                        const discount = Number(order.discount_total || (couponDiscount + memberDiscount + memberShippingBenefit));
                                        const shipping = Number(order.shipping_fee || 0);
                                        const tax = Number(order.tax_total || 0);
                                        const taxableTotal = Math.max(0, subtotal + shipping - couponDiscount - memberDiscount - memberShippingBenefit);
                                        const grossBeforeDiscounts = Math.max(0, subtotal + shipping);
                                        return (
                                            <>
                                                <p>Subtotal: ₹{subtotal.toLocaleString()}</p>
                                                <p>Shipping: ₹{shipping.toLocaleString()}</p>
                                                <p>Base Price (Before Discounts): ₹{grossBeforeDiscounts.toLocaleString()}</p>
                                                {couponDiscount > 0 && <p>Coupon{order.coupon_code ? ` (${order.coupon_code})` : ''}: -₹{couponDiscount.toLocaleString()}</p>}
                                                {memberDiscount > 0 && <p>Member Discount: -₹{memberDiscount.toLocaleString()}</p>}
                                                {memberShippingBenefit > 0 && <p>Member Shipping Benefit: -₹{memberShippingBenefit.toLocaleString()}</p>}
                                                <p>Total Savings: ₹{discount.toLocaleString()}</p>
                                                <p>Taxable Value After Discounts: ₹{taxableTotal.toLocaleString()}</p>
                                                {tax > 0 && (
                                                    <p>
                                                        GST: ₹{tax.toLocaleString()}
                                                        <span className="block text-[11px] text-gray-500">
                                                            {getGstDisplayDetails({ taxAmount: tax }).splitAmountLabel}
                                                        </span>
                                                    </p>
                                                )}
                                            </>
                                        );
                                    })()}
                                    <p className="font-semibold text-gray-900">Total: ₹{Number(order.total || 0).toLocaleString()}</p>
                                    <p>Payment Method: {String(order.payment_gateway || 'razorpay').toUpperCase()}</p>
                                    <p className="pt-2 text-gray-600">Your items will be dispatched in 2-3 working days.</p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="mt-6 flex items-center justify-center gap-3">
                        <Link to="/" className="px-4 py-2 rounded-xl bg-primary text-accent font-semibold">
                            Home
                        </Link>
                        <Link to="/orders" className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-semibold">
                            View Orders
                        </Link>
                        {isFailed && (
                            <Link to="/checkout" className="px-4 py-2 rounded-xl border border-red-200 text-red-700 font-semibold">
                                Retry Payment
                            </Link>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
