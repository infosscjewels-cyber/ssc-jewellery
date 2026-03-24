import { CheckCircle2, ChevronRight, CreditCard, ShoppingBag, UserRound, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function CheckoutFlowHeader({ state = 'checkout' }) {
    const normalized = String(state || 'checkout').toLowerCase();
    const isFailed = normalized === 'failed';
    const progressWidth = normalized === 'cart'
        ? 'w-1/4'
        : normalized === 'checkout'
            ? 'w-1/2'
            : normalized === 'payment'
                ? 'w-3/4'
                : 'w-full';
    const doneLabel = isFailed ? 'Failed' : 'Done';
    const DoneIcon = isFailed ? XCircle : CheckCircle2;
    const steps = [
        {
            key: 'cart',
            icon: ShoppingBag,
            label: 'Shopping Cart',
            shortLabel: 'Cart',
            active: normalized !== 'cart',
            href: '/cart'
        },
        {
            key: 'checkout',
            icon: UserRound,
            label: 'Contact Information',
            shortLabel: 'Checkout',
            active: normalized !== 'cart'
        },
        {
            key: 'payment',
            icon: CreditCard,
            label: 'Payment Method',
            shortLabel: 'Payment',
            active: normalized === 'payment' || normalized === 'confirmation' || normalized === 'failed'
        },
        {
            key: 'confirmation',
            icon: DoneIcon,
            label: 'Confirmation',
            shortLabel: doneLabel,
            active: normalized === 'confirmation',
            error: isFailed
        }
    ];

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:text-sm text-gray-500">
                {steps.map((step, index) => {
                    const Icon = step.icon;
                    const textClass = step.error
                        ? 'text-red-600'
                        : step.active
                            ? 'text-primary font-semibold'
                            : '';
                    const content = (
                        <span className={`inline-flex min-w-0 items-center justify-center sm:justify-start gap-1.5 rounded-full border border-gray-200 px-3 py-2 sm:border-0 sm:px-0 sm:py-0 ${textClass}`}>
                            <Icon size={14} />
                            <span className="truncate">{step.label}</span>
                        </span>
                    );
                    return (
                        <div key={step.key} className="contents">
                            {step.href ? <Link to={step.href}>{content}</Link> : content}
                            {index < steps.length - 1 && (
                                <ChevronRight size={14} className="hidden sm:block text-gray-300" />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 sm:mt-4 relative">
                <div className="h-1 rounded-full bg-gray-100" />
                <div className={`absolute top-0 left-0 h-1 rounded-full ${isFailed ? 'bg-red-500' : 'bg-primary'} ${progressWidth}`} />
                <div className="mt-2 sm:mt-3 grid grid-cols-4 gap-1.5 sm:gap-2 text-[11px] sm:flex sm:items-center sm:justify-between sm:text-xs text-gray-400">
                    {steps.map((step) => {
                        const Icon = step.icon;
                        const textClass = step.error
                            ? 'text-red-600'
                            : step.active
                                ? 'text-primary'
                                : '';
                        return (
                            <span
                                key={step.key}
                                className={`font-semibold inline-flex min-w-0 flex-col items-center justify-center gap-1 text-center sm:flex-row sm:text-left ${textClass}`}
                            >
                                <Icon size={12} />
                                <span className="truncate">{step.shortLabel}</span>
                            </span>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
