import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';

const isVariantInStock = (variant) => {
    const tracked = String(variant.track_quantity) === '1' || String(variant.track_quantity) === 'true' || variant.track_quantity === true;
    if (!tracked) return true;
    return Number((variant.available_quantity ?? variant.quantity) || 0) > 0;
};

export default function QuickAddModal({ product, onClose, onConfirm }) {
    const variants = useMemo(
        () => (Array.isArray(product?.variants) ? product.variants : []),
        [product?.variants]
    );
    const [selectedId, setSelectedId] = useState(variants[0]?.id || '');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [justAdded, setJustAdded] = useState(false);
    const closeTimerRef = useRef(null);

    useEffect(() => {
        setSelectedId(variants[0]?.id || '');
        setIsSubmitting(false);
        setJustAdded(false);
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, [product?.id, variants]);

    useEffect(() => () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
        }
    }, []);

    if (!product) return null;

    const selected = variants.find(v => String(v.id) === String(selectedId));
    const canAdd = selected ? isVariantInStock(selected) : true;

    const handleConfirm = async () => {
        if (!selected || !canAdd || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onConfirm(selected);
            setJustAdded(true);
            closeTimerRef.current = setTimeout(() => {
                onClose();
            }, 1200);
        } finally {
            setIsSubmitting(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800">Select Variant</h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {variants.map(v => (
                        <button
                            key={v.id}
                            onClick={() => setSelectedId(v.id)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${String(selectedId) === String(v.id) ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'}`}
                        >
                            <div>
                                <p className="text-sm font-bold text-gray-800">{v.variant_title || 'Variant'}</p>
                                <p className="text-xs text-gray-500">₹{Number(v.discount_price || v.price || 0).toLocaleString()}</p>
                            </div>
                            {String(selectedId) === String(v.id) && <Check size={16} className="text-primary" />}
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={!canAdd || isSubmitting}
                    className={`w-full mt-5 py-3 rounded-xl font-bold transition-colors ${
                        !canAdd
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : justAdded
                                ? 'bg-emerald-500 text-white'
                                : 'bg-primary text-accent hover:bg-primary-light'
                    }`}
                >
                    {!canAdd ? 'Out of Stock' : justAdded ? (
                        <span className="inline-flex items-center justify-center gap-2">
                            <Check size={18} />
                            Added
                        </span>
                    ) : 'Add to Cart'}
                </button>
            </div>
        </div>
        ,
        document.body
    );
}
