import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, Crown, Gem, Megaphone, Pencil, Plus, Search, Shield, Sparkles, Star, Save, TicketPercent, Trash2, X, CircleOff } from 'lucide-react';
import { createPortal } from 'react-dom';
import { adminService } from '../../services/adminService';
import { productService } from '../../services/productService';
import { useToast } from '../../context/ToastContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import Modal from '../../components/Modal';
import { formatAdminDate } from '../../utils/dateFormat';
import EmptyState from '../../components/EmptyState';
import giftIllustration from '../../assets/gift.svg';

const ORDER = ['regular', 'bronze', 'silver', 'gold', 'platinum'];

const getTodayDateInput = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};
const MAX_COUPON_RANGE_DAYS = 90;
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

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const formatCouponExpiry = (value) => {
    if (!value) return 'No expiry';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'No expiry';
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};
const formatDiscountOffer = (type, value) => {
    const discountType = String(type || '').toLowerCase();
    const discountValue = Number(value || 0);
    if (discountType === 'fixed') return `₹${discountValue.toLocaleString('en-IN')} OFF`;
    if (discountType === 'shipping_full') return 'Free Shipping';
    if (discountType === 'shipping_partial') return `${discountValue}% Shipping Off`;
    return `${discountValue}% OFF`;
};
const formatShippingApplicability = (discountType) => {
    const type = String(discountType || '').toLowerCase();
    if (type === 'shipping_full') return 'Shipping-only discount (full shipping waived)';
    if (type === 'shipping_partial') return 'Shipping-only discount (partial shipping)';
    return 'Product/cart discount';
};
const formatScopeSummary = (coupon, categories = []) => {
    const scope = String(coupon?.scope_type || 'generic').toLowerCase();
    if (scope === 'customer') return 'Customer specific voucher';
    if (scope === 'tier') {
        const tier = String(coupon?.tier_scope || '').trim();
        return tier ? `Tier specific (${tier.toUpperCase()})` : 'Tier specific';
    }
    if (scope === 'category') {
        const ids = Array.isArray(coupon?.category_scope_json) ? coupon.category_scope_json : [];
        if (!ids.length) return 'Category specific';
        const names = ids
            .map((id) => categories.find((cat) => Number(cat.id) === Number(id))?.name || `Category #${id}`)
            .slice(0, 3);
        return `Category specific (${names.join(', ')}${ids.length > 3 ? ', ...' : ''})`;
    }
    return 'Generic (all eligible users)';
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
const buildCouponCodeOptions = (count = 8) => {
    const target = Math.max(1, Number(count) || 1);
    const out = new Set();
    while (out.size < target) {
        out.add(buildCouponCodeDraft());
    }
    return Array.from(out);
};

const shippingPriorityLabel = (value = 'standard') => {
    const map = {
        standard: 'Standard',
        standard_plus: 'Standard+',
        high: 'High',
        higher: 'Higher',
        highest: 'Highest'
    };
    return map[String(value || '').toLowerCase()] || 'Standard';
};

const tierLabel = (tier = 'regular') => (String(tier).toLowerCase() === 'regular' ? 'Basic' : String(tier));

const SHIPPING_PRIORITY_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'standard_plus', label: 'Standard+' },
    { value: 'high', label: 'High' },
    { value: 'higher', label: 'Higher' },
    { value: 'highest', label: 'Highest' }
];

const TIER_STYLE = {
    regular: { card: 'from-slate-100 via-slate-50 to-slate-100 text-slate-800', stat: 'bg-white/80 border-slate-200', icon: Shield },
    bronze: { card: 'from-amber-100 via-orange-50 to-amber-100 text-amber-900', stat: 'bg-white/80 border-amber-200', icon: Sparkles },
    silver: { card: 'from-gray-100 via-slate-50 to-gray-100 text-slate-800', stat: 'bg-white/80 border-gray-200', icon: Star },
    gold: { card: 'from-yellow-100 via-amber-50 to-yellow-100 text-amber-950', stat: 'bg-white/75 border-yellow-300', icon: Crown },
    platinum: { card: 'from-sky-100 via-blue-50 to-sky-100 text-sky-900', stat: 'bg-white/75 border-sky-200', icon: Gem }
};

const buildBenefitsPreview = (row) => {
    const tier = String(row?.tier || 'regular').toLowerCase();
    if (tier === 'regular') return ['Standard pricing', 'Standard shipping', 'Progress tracking to next tier'];
    return [
        `${toNumber(row.extraDiscountPct)}% extra member discount`,
        `${toNumber(row.shippingDiscountPct)}% shipping fee discount`,
        `${toNumber(row.birthdayDiscountPct ?? 10)}% birthday coupon offer`,
        `${toNumber(row.abandonedCartBoostPct)}% abandoned cart offer boost`,
        `${shippingPriorityLabel(row.shippingPriority)} dispatch priority`
    ];
};

const getDefaultCouponForm = () => ({
    code: buildCouponCodeDraft(),
    name: '',
    scopeType: 'generic',
    discountType: 'percent',
    discountValue: 5,
    maxDiscountValue: 1000,
    minCartValue: 0,
    usageLimitPerUser: 1,
    tierScope: 'bronze',
    categoryIds: [],
    startsAt: getTodayDateInput(),
    expiresAt: ''
});

const getDefaultPopupForm = () => ({
    isActive: false,
    title: '',
    summary: '',
    content: '',
    encouragement: '',
    imageUrl: '',
    audioUrl: '',
    buttonLabel: 'Shop Now',
    buttonLink: '/shop',
    couponCode: '',
    endsAt: ''
});

const getDefaultTemplateName = () => {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `Template ${yyyy}-${mm}-${dd}`;
};

const DEFAULT_POPUP_TEMPLATE_ID = '__default_popup_template__';
const DEFAULT_POPUP_TEMPLATE_NAME = 'Default (Coupon + Pop)';
const DEFAULT_POPUP_TEMPLATE_PAYLOAD = {
    imageUrl: '/assets/coupon.jpg',
    audioUrl: '/assets/pop.mp3'
};

const toDateInput = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

const isCouponCurrentlyValid = (coupon = {}) => {
    const activeValue = coupon?.is_active ?? coupon?.isActive ?? 1;
    if (Number(activeValue) !== 1) return false;
    const now = Date.now();
    const startsAtRaw = coupon?.starts_at ?? coupon?.startsAt ?? null;
    if (startsAtRaw) {
        const startsAt = new Date(startsAtRaw).getTime();
        if (Number.isFinite(startsAt) && now < startsAt) return false;
    }
    const expiresAtRaw = coupon?.expires_at ?? coupon?.expiresAt ?? null;
    if (expiresAtRaw) {
        const expiresAt = new Date(expiresAtRaw).getTime();
        if (Number.isFinite(expiresAt) && now > expiresAt) return false;
    }
    return true;
};

const normalizeCategoryOptions = (value) => {
    const rows = Array.isArray(value) ? value : [];
    const mapped = rows.map((row) => {
        if (row == null) return null;
        if (typeof row === 'string') return null;
        const id = Number(row.id ?? row.category_id ?? row.categoryId ?? 0);
        const name = String(row.name ?? row.category_name ?? row.title ?? '').trim();
        if (!Number.isFinite(id) || id <= 0 || !name) return null;
        return { id, name };
    }).filter(Boolean);
    const seen = new Set();
    return mapped.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    });
};

export default function LoyaltySettings({ onBack }) {
    const toast = useToast();
    const [rows, setRows] = useState([]);
    const [activeTier, setActiveTier] = useState('regular');
    const [editingTier, setEditingTier] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [couponForm, setCouponForm] = useState(getDefaultCouponForm());
    const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
    const [couponCodeOptions, setCouponCodeOptions] = useState(() => buildCouponCodeOptions());
    const [categories, setCategories] = useState([]);
    const [couponList, setCouponList] = useState([]);
    const [couponPage, setCouponPage] = useState(1);
    const [couponTotalPages, setCouponTotalPages] = useState(1);
    const [couponSearch, setCouponSearch] = useState('');
    const [couponLoading, setCouponLoading] = useState(false);
    const [couponCreating, setCouponCreating] = useState(false);
    const [couponDeletingId, setCouponDeletingId] = useState(null);
    const [bulkCouponDeleting, setBulkCouponDeleting] = useState(false);
    const [selectedCouponIds, setSelectedCouponIds] = useState([]);
    const [selectedCoupon, setSelectedCoupon] = useState(null);
    const [isCouponDetailsOpen, setIsCouponDetailsOpen] = useState(false);
    const [couponRefreshKey, setCouponRefreshKey] = useState(0);
    const [openSection, setOpenSection] = useState('coupon');
    const [popupForm, setPopupForm] = useState(getDefaultPopupForm());
    const [popupSaving, setPopupSaving] = useState(false);
    const [popupImageUploading, setPopupImageUploading] = useState(false);
    const [popupAudioUploading, setPopupAudioUploading] = useState(false);
    const [popupCouponOptions, setPopupCouponOptions] = useState([]);
    const [popupTemplates, setPopupTemplates] = useState([]);
    const [selectedPopupTemplateId, setSelectedPopupTemplateId] = useState('');
    const [popupTemplateName, setPopupTemplateName] = useState(getDefaultTemplateName());
    const [saveAsTemplate, setSaveAsTemplate] = useState(false);
    const [popupTemplateSaving, setPopupTemplateSaving] = useState(false);
    const [popupTemplateDeleting, setPopupTemplateDeleting] = useState(false);
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Delete',
        type: 'delete',
        coupon: null,
        coupons: []
    });
    const [isConfirmProcessing, setIsConfirmProcessing] = useState(false);
    const couponStartDateInputRef = useRef(null);
    const couponEndDateInputRef = useRef(null);
    const popupEndDateInputRef = useRef(null);
    const isPersistedTemplateSelection = (value) => {
        const id = Number(value || 0);
        return Number.isFinite(id) && id > 0;
    };

    const applyConfigRows = (config = []) => {
        const byTier = Object.fromEntries((Array.isArray(config) ? config : []).map((item) => [String(item.tier || '').toLowerCase(), item]));
        setRows(ORDER.map((tier) => {
            const item = byTier[tier] || {};
            const rowLabel = String(item.label || tierLabel(tier));
            return {
                tier,
                label: rowLabel.toLowerCase() === 'regular' ? 'Basic' : rowLabel,
                threshold: toNumber(item.threshold),
                windowDays: toNumber(item.windowDays, 30),
                extraDiscountPct: toNumber(item.extraDiscountPct),
                shippingDiscountPct: toNumber(item.shippingDiscountPct),
                birthdayDiscountPct: toNumber(item.birthdayDiscountPct, 10),
                abandonedCartBoostPct: toNumber(item.abandonedCartBoostPct),
                priorityWeight: toNumber(item.priorityWeight),
                shippingPriority: item.shippingPriority || 'standard',
                benefits: Array.isArray(item.benefits) ? item.benefits : buildBenefitsPreview({ ...item, tier })
            };
        }));
    };

    const loadPopupAdminState = useCallback(async () => {
        const [popupData, templateData, popupCouponsData] = await Promise.all([
            adminService.getLoyaltyPopupConfig().catch(() => ({ popup: null })),
            adminService.listLoyaltyPopupTemplates().catch(() => ({ templates: [] })),
            adminService.getLoyaltyCoupons({ page: 1, limit: 500, search: '', sourceType: 'all' }).catch(() => ({ coupons: [] }))
        ]);

        const popup = popupData?.popup || null;
        setPopupForm({
            isActive: Boolean(popup?.isActive),
            title: popup?.title || '',
            summary: popup?.summary || '',
            content: popup?.content || '',
            encouragement: popup?.encouragement || '',
            imageUrl: popup?.imageUrl || '',
            audioUrl: popup?.audioUrl || '',
            buttonLabel: popup?.buttonLabel || 'Shop Now',
            buttonLink: popup?.buttonLink || '/shop',
            couponCode: popup?.couponCode || '',
            endsAt: toDateInput(popup?.endsAt)
        });

        const templates = Array.isArray(templateData?.templates) ? templateData.templates : [];
        setPopupTemplates(templates);
        if (!popupTemplateName) {
            setPopupTemplateName(getDefaultTemplateName());
        }

        const popupCouponRows = Array.isArray(popupCouponsData?.coupons) ? popupCouponsData.coupons : [];
        const popupEligible = popupCouponRows
            .filter((row) => isCouponCurrentlyValid(row))
            .filter((row) => !['tier', 'customer'].includes(String(row?.scope_type || '').toLowerCase()))
            .map((row) => ({
                code: String(row.code || '').toUpperCase(),
                name: row.name || 'Coupon',
                scopeType: String(row.scope_type || 'generic').toLowerCase()
            }))
            .filter((row) => row.code);
        setPopupCouponOptions(popupEligible);
        if (popup?.couponCode && !popupEligible.some((row) => row.code === String(popup.couponCode).toUpperCase())) {
            setPopupForm((prev) => ({ ...prev, couponCode: '' }));
        }
    }, [popupTemplateName]);

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            adminService.getLoyaltyConfig(),
            productService.getCategoryStats().catch(() => null),
            productService.getCategories().catch(() => ({ categories: [] }))
        ]).then(async ([data, categoryStats, cats]) => {
            if (cancelled) return;
            applyConfigRows(Array.isArray(data?.config) ? data.config : []);
            await loadPopupAdminState();
            const statRows = Array.isArray(categoryStats)
                ? categoryStats
                : (Array.isArray(categoryStats?.categories) ? categoryStats.categories : []);
            const categoryRows = Array.isArray(cats)
                ? cats
                : (Array.isArray(cats?.categories) ? cats.categories : []);
            const resolved = normalizeCategoryOptions(statRows);
            setCategories(resolved.length ? resolved : normalizeCategoryOptions(categoryRows));
        }).catch((error) => {
            toast.error(error?.message || 'Failed to load loyalty settings');
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [loadPopupAdminState, toast]);

    useEffect(() => {
        let cancelled = false;
        setCouponLoading(true);
        adminService.getLoyaltyCoupons({ page: couponPage, limit: 10, search: couponSearch, sourceType: 'all' })
            .then((data) => {
                if (cancelled) return;
                setCouponList(Array.isArray(data?.coupons) ? data.coupons : []);
                setCouponTotalPages(Number(data?.pagination?.totalPages || 1));
            })
            .catch(() => {
                if (!cancelled) setCouponList([]);
            })
            .finally(() => {
                if (!cancelled) setCouponLoading(false);
            });
        return () => { cancelled = true; };
    }, [couponPage, couponSearch, couponRefreshKey]);

    useEffect(() => {
        const visible = new Set((couponList || []).map((cp) => String(cp.id ?? cp.code ?? '')));
        setSelectedCouponIds((prev) => prev.filter((id) => visible.has(String(id))));
    }, [couponList]);

    useAdminCrudSync({
        'coupon:changed': () => {
            adminService.invalidateLoyaltyCouponCache();
            setCouponRefreshKey((v) => v + 1);
            adminService.getLoyaltyCoupons({ page: 1, limit: 500, search: '', sourceType: 'all' })
                .then((data) => {
                    const rows = Array.isArray(data?.coupons) ? data.coupons : [];
                    const options = rows
                        .filter((row) => isCouponCurrentlyValid(row))
                        .filter((row) => !['tier', 'customer'].includes(String(row?.scope_type || '').toLowerCase()))
                        .map((row) => ({
                            code: String(row.code || '').toUpperCase(),
                            name: row.name || 'Coupon',
                            scopeType: String(row.scope_type || 'generic').toLowerCase()
                        }))
                        .filter((row) => row.code);
                    setPopupCouponOptions(options);
                    setPopupForm((prev) => {
                        const currentCode = String(prev?.couponCode || '').toUpperCase();
                        if (!currentCode) return prev;
                        if (options.some((row) => row.code === currentCode)) return prev;
                        return { ...prev, couponCode: '' };
                    });
                })
                .catch(() => {});
        },
        'loyalty:config_update': ({ config } = {}) => {
            if (Array.isArray(config)) {
                applyConfigRows(config);
                return;
            }
            adminService.getLoyaltyConfig()
                .then((data) => applyConfigRows(Array.isArray(data?.config) ? data.config : []))
                .catch(() => {});
        },
        'loyalty:popup_update': () => {
            loadPopupAdminState().catch(() => {});
        }
    });

    const updateRow = (tier, patch) => {
        setRows((prev) => prev.map((row) => (row.tier === tier ? { ...row, ...patch } : row)));
    };

    const activeRow = useMemo(
        () => rows.find((row) => row.tier === activeTier) || rows[0] || null,
        [rows, activeTier]
    );

    const editRow = useMemo(
        () => rows.find((row) => row.tier === editingTier) || null,
        [rows, editingTier]
    );

    const handleSaveTier = async () => {
        if (!editRow) return;
        setSaving(true);
        try {
            const payload = rows.map((row) => ({
                tier: row.tier,
                label: row.label,
                threshold: toNumber(row.threshold),
                windowDays: Math.max(1, toNumber(row.windowDays, 30)),
                extraDiscountPct: toNumber(row.extraDiscountPct),
                shippingDiscountPct: toNumber(row.shippingDiscountPct),
                birthdayDiscountPct: toNumber(row.birthdayDiscountPct, 10),
                abandonedCartBoostPct: toNumber(row.abandonedCartBoostPct),
                priorityWeight: toNumber(row.priorityWeight),
                shippingPriority: row.shippingPriority || 'standard'
            }));
            await adminService.updateLoyaltyConfig(payload);
            toast.success(`${editRow.label} tier updated`);
            setEditingTier(null);
        } catch (error) {
            toast.error(error?.message || 'Failed to save loyalty config');
        } finally {
            setSaving(false);
        }
    };

    const handleIssueCoupon = async () => {
        if (!couponForm.startsAt) {
            toast.error('Start date is required');
            return;
        }
        if (couponForm.expiresAt && couponForm.expiresAt < couponForm.startsAt) {
            toast.error('End date must be on or after start date');
            return;
        }
        if (couponForm.startsAt && couponForm.expiresAt) {
            const start = toDateOnly(couponForm.startsAt);
            const end = toDateOnly(couponForm.expiresAt);
            const diffDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
            if (Number.isFinite(diffDays) && diffDays > MAX_COUPON_RANGE_DAYS) {
                toast.error(`Coupon validity cannot exceed ${MAX_COUPON_RANGE_DAYS} days`);
                return;
            }
        }
        if (couponForm.code && String(couponForm.code).length > 15) {
            toast.error('Coupon code cannot exceed 15 characters');
            return;
        }
        if (String(couponForm.discountType || '').toLowerCase() === 'percent') {
            const maxDiscountValue = Number(couponForm.maxDiscountValue || 0);
            if (!Number.isFinite(maxDiscountValue) || maxDiscountValue <= 0) {
                toast.error('Maximum discount must be greater than 0 for percentage coupons');
                return;
            }
        }
        setCouponCreating(true);
        try {
            const normalizedDiscountType = String(couponForm.discountType || '').toLowerCase();
            const normalizedMaxDiscount = normalizedDiscountType === 'percent'
                ? Math.max(0, Number(couponForm.maxDiscountValue || 0))
                : 0;
            const payload = {
                code: sanitizeCouponCode(couponForm.code || ''),
                name: couponForm.name || 'Admin Coupon',
                scopeType: couponForm.scopeType,
                discountType: couponForm.discountType,
                discountValue: couponForm.discountType === 'shipping_full'
                    ? 0
                    : Number(couponForm.discountValue || 0),
                maxDiscountValue: normalizedMaxDiscount,
                max_discount_value: normalizedMaxDiscount,
                minCartValue: Math.max(0, Number(couponForm.minCartValue || 0)),
                usageLimitPerUser: Math.max(1, Number(couponForm.usageLimitPerUser || 1)),
                tierScope: couponForm.scopeType === 'tier' ? couponForm.tierScope : undefined,
                categoryIds: couponForm.scopeType === 'category' ? couponForm.categoryIds : [],
                startsAt: new Date(`${couponForm.startsAt}T00:00:00`).toISOString(),
                expiresAt: couponForm.expiresAt ? new Date(`${couponForm.expiresAt}T23:59:59`).toISOString() : null,
                sourceType: 'admin'
            };
            const res = await adminService.createLoyaltyCoupon(payload);
            toast.success(`Coupon created: ${res?.coupon?.code || ''}`);
            setCouponRefreshKey((v) => v + 1);
            setCouponForm(getDefaultCouponForm());
            setCouponCodeOptions(buildCouponCodeOptions());
            setIsCouponModalOpen(false);
        } catch (error) {
            toast.error(error?.message || 'Failed to create coupon');
        } finally {
            setCouponCreating(false);
        }
    };

    const openDeleteCouponConfirm = (coupon) => {
        if (!coupon) return;
        setConfirmModal({
            isOpen: true,
            type: 'delete',
            title: 'Deactivate Coupon',
            message: `Deactivate coupon ${coupon.code || coupon.id}? It will be archived from active use.`,
            confirmText: 'Deactivate',
            coupon,
            coupons: []
        });
    };

    const openBulkDeleteCouponConfirm = () => {
        if (selectedCouponIds.length === 0) return;
        setConfirmModal({
            isOpen: true,
            type: 'delete',
            title: 'Deactivate Coupons',
            message: `Deactivate ${selectedCouponIds.length} selected coupon(s)? They will be archived from active use.`,
            confirmText: 'Deactivate All',
            coupon: null,
            coupons: [...selectedCouponIds]
        });
    };

    const closeConfirmModal = () => {
        if (isConfirmProcessing) return;
        setConfirmModal((prev) => ({ ...prev, isOpen: false, coupon: null, coupons: [] }));
    };

    const handleDeleteCoupon = async () => {
        const bulkCoupons = Array.isArray(confirmModal?.coupons) ? confirmModal.coupons : [];
        if (bulkCoupons.length > 0) {
            setIsConfirmProcessing(true);
            setBulkCouponDeleting(true);
            try {
                const results = await Promise.allSettled(
                    bulkCoupons.map((couponId) => adminService.deleteLoyaltyCoupon(couponId))
                );
                const successCount = results.filter((entry) => entry.status === 'fulfilled').length;
                const failedCount = results.length - successCount;
                if (successCount > 0) {
                    toast.success(`Deactivated ${successCount} coupon(s)`);
                    setCouponRefreshKey((v) => v + 1);
                }
                if (failedCount > 0) {
                    toast.error(`${failedCount} coupon(s) could not be deactivated`);
                }
                setSelectedCouponIds([]);
                setConfirmModal((prev) => ({ ...prev, isOpen: false, coupon: null, coupons: [] }));
            } finally {
                setBulkCouponDeleting(false);
                setIsConfirmProcessing(false);
            }
            return;
        }

        const coupon = confirmModal?.coupon || null;
        const couponId = coupon?.id ?? coupon?.code ?? null;
        if (!couponId) return;
        const deletingKey = coupon?.id ?? coupon?.code ?? null;
        setIsConfirmProcessing(true);
        setCouponDeletingId(deletingKey);
        try {
            await adminService.deleteLoyaltyCoupon(couponId);
            toast.success('Coupon deactivated');
            setCouponRefreshKey((v) => v + 1);
            setSelectedCouponIds((prev) => prev.filter((id) => String(id) !== String(couponId)));
            setConfirmModal((prev) => ({ ...prev, isOpen: false, coupon: null, coupons: [] }));
        } catch (error) {
            toast.error(error?.message || 'Failed to deactivate coupon');
        } finally {
            setCouponDeletingId(null);
            setIsConfirmProcessing(false);
        }
    };

    const openCouponDetails = (coupon) => {
        if (!coupon) return;
        setSelectedCoupon(coupon);
        setIsCouponDetailsOpen(true);
    };

    const closeCouponDetails = () => {
        setIsCouponDetailsOpen(false);
        setSelectedCoupon(null);
    };

    const toggleCouponSelection = (coupon, checked) => {
        const key = String(coupon?.id ?? coupon?.code ?? '');
        if (!key) return;
        setSelectedCouponIds((prev) => {
            if (checked) {
                if (prev.includes(key)) return prev;
                return [...prev, key];
            }
            return prev.filter((entry) => entry !== key);
        });
    };

    const handlePopupImageUpload = async (file) => {
        if (!file) return;
        setPopupImageUploading(true);
        try {
            const data = await adminService.uploadLoyaltyPopupImage(file);
            setPopupForm((prev) => ({ ...prev, imageUrl: data?.url || prev.imageUrl }));
            toast.success('Popup image uploaded');
        } catch (error) {
            toast.error(error?.message || 'Failed to upload popup image');
        } finally {
            setPopupImageUploading(false);
        }
    };

    const handlePopupAudioUpload = async (file) => {
        if (!file) return;
        setPopupAudioUploading(true);
        try {
            const data = await adminService.uploadLoyaltyPopupAudio(file);
            setPopupForm((prev) => ({ ...prev, audioUrl: data?.url || prev.audioUrl }));
            toast.success('Popup audio uploaded');
        } catch (error) {
            toast.error(error?.message || 'Failed to upload popup audio');
        } finally {
            setPopupAudioUploading(false);
        }
    };

    const loadTemplateToForm = (templateId) => {
        if (String(templateId || '') === DEFAULT_POPUP_TEMPLATE_ID) {
            setPopupForm((prev) => ({
                ...prev,
                ...DEFAULT_POPUP_TEMPLATE_PAYLOAD
            }));
            setPopupTemplateName(DEFAULT_POPUP_TEMPLATE_NAME);
            toast.success(`Template loaded: ${DEFAULT_POPUP_TEMPLATE_NAME}`);
            return;
        }
        const id = Number(templateId || 0);
        if (!Number.isFinite(id) || id <= 0) return;
        const template = popupTemplates.find((entry) => Number(entry?.id) === id);
        if (!template?.payload) return;
        setPopupForm((prev) => ({
            ...prev,
            ...template.payload
        }));
        setPopupTemplateName(String(template.templateName || getDefaultTemplateName()));
        toast.success(`Template loaded: ${template.templateName || 'Unnamed template'}`);
    };

    const handleTemplateSelection = (templateId) => {
        setSelectedPopupTemplateId(String(templateId || ''));
        if (!templateId) {
            setPopupTemplateName(getDefaultTemplateName());
            return;
        }
        loadTemplateToForm(templateId);
    };

    const handleDeleteTemplate = async () => {
        const id = Number(selectedPopupTemplateId || 0);
        if (!isPersistedTemplateSelection(selectedPopupTemplateId) || popupTemplateDeleting) return;
        setPopupTemplateDeleting(true);
        try {
            await adminService.deleteLoyaltyPopupTemplate(id);
            const next = popupTemplates.filter((entry) => Number(entry.id) !== id);
            setPopupTemplates(next);
            setSelectedPopupTemplateId('');
            setPopupTemplateName(getDefaultTemplateName());
            toast.success('Popup template deleted');
        } catch (error) {
            toast.error(error?.message || 'Failed to delete popup template');
        } finally {
            setPopupTemplateDeleting(false);
        }
    };

    const handleSavePopup = async () => {
        setPopupSaving(true);
        try {
            const payload = {
                isActive: Boolean(popupForm.isActive),
                title: popupForm.title,
                summary: popupForm.summary,
                content: popupForm.content,
                encouragement: popupForm.encouragement,
                imageUrl: popupForm.imageUrl,
                audioUrl: popupForm.audioUrl,
                buttonLabel: popupForm.buttonLabel,
                buttonLink: popupForm.buttonLink,
                couponCode: popupForm.couponCode || null,
                endsAt: popupForm.endsAt ? new Date(`${popupForm.endsAt}T23:59:59`).toISOString() : null
            };
            const data = await adminService.updateLoyaltyPopupConfig(payload);
            if (saveAsTemplate) {
                const templateName = String(popupTemplateName || '').trim();
                if (!templateName) {
                    throw new Error('Template name is required when saving as template');
                }
                setPopupTemplateSaving(true);
                let templateRes = null;
                if (isPersistedTemplateSelection(selectedPopupTemplateId)) {
                    templateRes = await adminService.updateLoyaltyPopupTemplate(selectedPopupTemplateId, {
                        templateName,
                        payload: {
                            ...popupForm,
                            ...payload,
                            endsAt: popupForm.endsAt || ''
                        }
                    });
                } else {
                    templateRes = await adminService.createLoyaltyPopupTemplate({
                        templateName,
                        payload: {
                            ...popupForm,
                            ...payload,
                            endsAt: popupForm.endsAt || ''
                        }
                    });
                }
                const savedTemplate = templateRes?.template || null;
                if (savedTemplate?.id) {
                    setPopupTemplates((prev) => {
                        const exists = prev.some((entry) => Number(entry.id) === Number(savedTemplate.id));
                        if (exists) {
                            return prev.map((entry) => (Number(entry.id) === Number(savedTemplate.id) ? savedTemplate : entry));
                        }
                        return [savedTemplate, ...prev];
                    });
                    setSelectedPopupTemplateId(String(savedTemplate.id));
                    setPopupTemplateName(String(savedTemplate.templateName || templateName));
                }
            }
            const popup = data?.popup || null;
            setPopupForm((prev) => ({
                ...prev,
                isActive: Boolean(popup?.isActive),
                endsAt: toDateInput(popup?.endsAt)
            }));
            toast.success(saveAsTemplate ? 'Popup settings and template saved' : 'Popup settings saved');
        } catch (error) {
            toast.error(error?.message || 'Failed to save popup settings');
        } finally {
            setPopupTemplateSaving(false);
            setPopupSaving(false);
        }
    };

    if (loading) return <div className="py-16 text-center text-gray-400">Loading loyalty settings...</div>;

    const visibleCouponIds = couponList.map((cp) => String(cp.id ?? cp.code ?? '')).filter(Boolean);
    const allVisibleCouponsSelected = visibleCouponIds.length > 0 && visibleCouponIds.every((id) => selectedCouponIds.includes(id));
    const selectedCouponsCount = selectedCouponIds.length;
    const style = TIER_STYLE[activeRow?.tier || 'regular'] || TIER_STYLE.regular;
    const TierIcon = style.icon || Sparkles;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl md:text-3xl font-serif text-primary font-bold">Loyalty Settings</h2>
                    <p className="text-gray-500 text-sm mt-1">Manage tiers, coupons, and popup settings.</p>
                </div>
                <button type="button" onClick={onBack} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    <ArrowLeft size={16} /> Back
                </button>
            </div>

            <div className="flex flex-col gap-4">
            <div className="order-2 rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <button
                    type="button"
                    onClick={() => setOpenSection((prev) => (prev === 'tier' ? '' : 'tier'))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Tier Management</h3>
                        <p className="text-sm text-gray-500">Edit thresholds, discounts and shipping priority by tier.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Crown size={34} className="text-amber-200" />
                        <span className="text-sm font-semibold text-gray-500">{openSection === 'tier' ? '−' : '+'}</span>
                    </div>
                </button>
                <div className={`${openSection === 'tier' ? 'block' : 'hidden'} border-t border-gray-100 p-3`}>
                    <div className="flex flex-wrap gap-2">
                        {ORDER.map((tier) => (
                            <button
                                key={tier}
                                type="button"
                                onClick={() => setActiveTier(tier)}
                                className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${activeTier === tier ? 'bg-primary text-accent border-primary' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                            >
                                {tierLabel(tier).toUpperCase()}
                            </button>
                        ))}
                    </div>

                    {activeRow && (
                        <div className={`relative mt-3 rounded-2xl border border-gray-200 bg-gradient-to-br ${style.card} p-5 shadow-sm overflow-hidden`}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.25em] font-semibold opacity-70">Tier</p>
                                    <p className="text-2xl font-bold mt-1">{activeRow.label}</p>
                                    <p className="text-sm mt-1 opacity-80">Threshold ₹{toNumber(activeRow.threshold).toLocaleString('en-IN')} in {toNumber(activeRow.windowDays)} days</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditingTier(activeRow.tier)}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 bg-white/80 text-sm font-semibold hover:bg-white"
                                >
                                    <Pencil size={14} /> Edit
                                </button>
                            </div>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className={`rounded-xl border px-3 py-2 ${style.stat}`}><p className="text-[11px] uppercase tracking-wider opacity-70">Extra Discount</p><p className="text-lg font-bold mt-1">{toNumber(activeRow.extraDiscountPct)}%</p></div>
                                <div className={`rounded-xl border px-3 py-2 ${style.stat}`}><p className="text-[11px] uppercase tracking-wider opacity-70">Shipping Discount</p><p className="text-lg font-bold mt-1">{toNumber(activeRow.shippingDiscountPct)}%</p></div>
                                <div className={`rounded-xl border px-3 py-2 ${style.stat}`}><p className="text-[11px] uppercase tracking-wider opacity-70">Birthday Discount</p><p className="text-lg font-bold mt-1">{toNumber(activeRow.birthdayDiscountPct, 10)}%</p></div>
                                <div className={`rounded-xl border px-3 py-2 ${style.stat}`}><p className="text-[11px] uppercase tracking-wider opacity-70">Abandoned Boost</p><p className="text-lg font-bold mt-1">{toNumber(activeRow.abandonedCartBoostPct)}%</p></div>
                            </div>
                            <div className={`mt-3 rounded-xl border px-3 py-2 ${style.stat}`}>
                                <p className="text-[11px] uppercase tracking-wider opacity-70">Shipping Priority</p>
                                <p className="text-lg font-bold mt-1">{shippingPriorityLabel(activeRow.shippingPriority)}</p>
                            </div>
                            <div className={`mt-3 rounded-xl border p-3 ${style.stat}`}>
                                <p className="text-[11px] uppercase tracking-wider opacity-70">Benefit Preview</p>
                                <ul className="mt-2 space-y-2">
                                    {(activeRow.benefits?.length ? activeRow.benefits : buildBenefitsPreview(activeRow)).map((line) => (
                                        <li key={line} className="text-sm leading-6">- {line}</li>
                                    ))}
                                </ul>
                            </div>
                            <TierIcon size={82} className="absolute right-4 bottom-4 opacity-20" />
                        </div>
                    )}
                </div>
            </div>

            <div className="order-1 rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <button
                    type="button"
                    onClick={() => setOpenSection((prev) => (prev === 'coupon' ? '' : 'coupon'))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Coupon Management</h3>
                        <p className="text-sm text-gray-500">Issue and deactivate loyalty coupons.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <TicketPercent size={34} className="text-slate-200" />
                        <span className="text-sm font-semibold text-gray-500">{openSection === 'coupon' ? '−' : '+'}</span>
                    </div>
                </button>
                <div className={`${openSection === 'coupon' ? 'block' : 'hidden'} border-t border-gray-100 p-4 space-y-4`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 w-full justify-end">
                            {selectedCouponsCount > 0 && (
                                <button
                                    type="button"
                                    onClick={openBulkDeleteCouponConfirm}
                                    disabled={bulkCouponDeleting}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-60"
                                >
                                    <Trash2 size={14} />
                                    {bulkCouponDeleting ? 'Deactivating...' : `Deactivate Selected (${selectedCouponsCount})`}
                                </button>
                            )}
                            <div className="relative w-full max-w-xs">
                                <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                                <input value={couponSearch} onChange={(e) => { setCouponSearch(e.target.value); setCouponPage(1); }} placeholder="Search coupons" className="input-field pl-8 py-2.5" />
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setCouponForm(getDefaultCouponForm());
                                    setCouponCodeOptions(buildCouponCodeOptions());
                                    setIsCouponModalOpen(true);
                                }}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light"
                            >
                                <Plus size={14} /> Issue New Coupon
                            </button>
                        </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 overflow-hidden hidden md:block">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 w-10">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleCouponsSelected}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                if (!checked) {
                                                    setSelectedCouponIds((prev) => prev.filter((id) => !visibleCouponIds.includes(id)));
                                                    return;
                                                }
                                                setSelectedCouponIds((prev) => Array.from(new Set([...prev, ...visibleCouponIds])));
                                            }}
                                            className="rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Code</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Name</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Scope</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Discount</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Used</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Expiry</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {couponLoading && <tr><td className="px-3 py-4 text-gray-400" colSpan={8}>Loading coupons...</td></tr>}
                                {!couponLoading && couponList.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-4" colSpan={8}>
                                            <EmptyState
                                                image={giftIllustration}
                                                alt="No coupons found"
                                                title="No coupons found"
                                                description="Create a coupon or adjust your filters to see matching results."
                                                compact
                                            />
                                        </td>
                                    </tr>
                                )}
                                {!couponLoading && couponList.map((cp) => (
                                    <tr key={cp.id || cp.code} onClick={() => openCouponDetails(cp)} className="cursor-pointer hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedCouponIds.includes(String(cp.id ?? cp.code ?? ''))}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => toggleCouponSelection(cp, e.target.checked)}
                                                className="rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-gray-800">{cp.code}</td>
                                        <td className="px-3 py-2 text-gray-600">{cp.name || 'Coupon'}</td>
                                        <td className="px-3 py-2 text-gray-600">{String(cp.scope_type || 'generic')}</td>
                                        <td className="px-3 py-2 text-gray-600">{formatDiscountOffer(cp.discount_type, cp.discount_value)}</td>
                                        <td className="px-3 py-2 text-gray-600">{Number(cp.used_count || 0)}</td>
                                        <td className="px-3 py-2 text-gray-600">{formatCouponExpiry(cp.expires_at || cp.expiresAt)}</td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openDeleteCouponConfirm(cp);
                                                }}
                                                disabled={couponDeletingId === (cp.id || cp.code)}
                                                className="inline-flex items-center justify-center p-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                title="Deactivate Coupon"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="rounded-xl border border-gray-200 overflow-hidden md:hidden">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 w-10">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleCouponsSelected}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                if (!checked) {
                                                    setSelectedCouponIds((prev) => prev.filter((id) => !visibleCouponIds.includes(id)));
                                                    return;
                                                }
                                                setSelectedCouponIds((prev) => Array.from(new Set([...prev, ...visibleCouponIds])));
                                            }}
                                            className="rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                    </th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500">Coupon</th>
                                    <th className="px-3 py-2 text-xs uppercase tracking-wider text-gray-500 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {couponLoading && <tr><td className="px-3 py-4 text-gray-400" colSpan={3}>Loading coupons...</td></tr>}
                                {!couponLoading && couponList.length === 0 && (
                                    <tr>
                                        <td className="px-3 py-4" colSpan={3}>
                                            <EmptyState
                                                image={giftIllustration}
                                                alt="No coupons found"
                                                title="No coupons found"
                                                description="Create a coupon or adjust your filters to see matching results."
                                                compact
                                            />
                                        </td>
                                    </tr>
                                )}
                                {!couponLoading && couponList.map((cp) => (
                                    <tr key={cp.id || cp.code} onClick={() => openCouponDetails(cp)} className="cursor-pointer hover:bg-gray-50">
                                        <td className="px-3 py-2 align-top">
                                            <input
                                                type="checkbox"
                                                checked={selectedCouponIds.includes(String(cp.id ?? cp.code ?? ''))}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => toggleCouponSelection(cp, e.target.checked)}
                                                className="mt-1 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <p className="font-semibold text-gray-800">{cp.code}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">{cp.name || 'Coupon'}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {String(cp.scope_type || 'generic')} • {formatDiscountOffer(cp.discount_type, cp.discount_value)} • Used {Number(cp.used_count || 0)}
                                            </p>
                                            <p className="text-xs text-gray-500 mt-0.5">Expiry: {formatCouponExpiry(cp.expires_at || cp.expiresAt)}</p>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openDeleteCouponConfirm(cp);
                                                }}
                                                disabled={couponDeletingId === (cp.id || cp.code)}
                                                className="inline-flex items-center justify-center p-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                                title="Deactivate Coupon"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setCouponPage((p) => Math.max(1, p - 1))} disabled={couponPage <= 1} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-50">Prev</button>
                        <span className="text-sm text-gray-500">Page {couponPage} / {Math.max(1, couponTotalPages)}</span>
                        <button type="button" onClick={() => setCouponPage((p) => Math.min(couponTotalPages, p + 1))} disabled={couponPage >= couponTotalPages} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-50">Next</button>
                    </div>
                </div>
            </div>
            <div className="order-3 rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <button
                    type="button"
                    onClick={() => setOpenSection((prev) => (prev === 'popup' ? '' : 'popup'))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Popup Management</h3>
                        <p className="text-sm text-gray-500">Configure customer popup card and media.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Megaphone size={34} className="text-slate-200" />
                        <span className="text-sm font-semibold text-gray-500">{openSection === 'popup' ? '−' : '+'}</span>
                    </div>
                </button>
                <div className={`${openSection === 'popup' ? 'block' : 'hidden'} border-t border-gray-100 p-4 space-y-4`}>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <input type="checkbox" checked={Boolean(popupForm.isActive)} onChange={(e) => setPopupForm((prev) => ({ ...prev, isActive: e.target.checked }))} />
                        Popup enabled
                    </label>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
                        <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Template Library</p>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
                            <select
                                className="input-field"
                                value={selectedPopupTemplateId}
                                onChange={(e) => handleTemplateSelection(e.target.value)}
                            >
                                <option value="">Select template</option>
                                <option value={DEFAULT_POPUP_TEMPLATE_ID}>{DEFAULT_POPUP_TEMPLATE_NAME}</option>
                                {popupTemplates.map((template) => (
                                    <option key={template.id} value={template.id}>
                                        {template.templateName}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => selectedPopupTemplateId && loadTemplateToForm(selectedPopupTemplateId)}
                                disabled={!selectedPopupTemplateId}
                                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-60"
                            >
                                Load
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteTemplate}
                                disabled={!isPersistedTemplateSelection(selectedPopupTemplateId) || popupTemplateDeleting}
                                className="px-3 py-2 rounded-lg border border-red-200 text-xs font-semibold text-red-700 bg-white hover:bg-red-50 disabled:opacity-60"
                            >
                                {popupTemplateDeleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                    <div className="relative">
                        <div className={`${popupForm.isActive ? '' : 'blur-[2px] opacity-55 pointer-events-none select-none'} space-y-4 transition-all`}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="text-sm text-gray-600">Title<input className="input-field mt-1" value={popupForm.title} onChange={(e) => setPopupForm((prev) => ({ ...prev, title: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Summary<input className="input-field mt-1" value={popupForm.summary} onChange={(e) => setPopupForm((prev) => ({ ...prev, summary: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600 md:col-span-2">Content<textarea className="input-field mt-1 min-h-[88px]" value={popupForm.content} onChange={(e) => setPopupForm((prev) => ({ ...prev, content: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600 md:col-span-2">Encouragement Message<input className="input-field mt-1" value={popupForm.encouragement} onChange={(e) => setPopupForm((prev) => ({ ...prev, encouragement: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Button Label<input className="input-field mt-1" value={popupForm.buttonLabel} onChange={(e) => setPopupForm((prev) => ({ ...prev, buttonLabel: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Button Link<input className="input-field mt-1" value={popupForm.buttonLink} onChange={(e) => setPopupForm((prev) => ({ ...prev, buttonLink: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">
                                    Coupon Code
                                    <select
                                        className="input-field mt-1"
                                        value={popupForm.couponCode}
                                        onChange={(e) => setPopupForm((prev) => ({ ...prev, couponCode: e.target.value }))}
                                    >
                                        <option value="">No coupon</option>
                                        {popupCouponOptions.map((cp) => (
                                            <option key={cp.code} value={cp.code}>
                                                {cp.code} - {cp.name} ({cp.scopeType})
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="text-sm text-gray-600">
                                    Expiry Date
                                    <div className="relative mt-1">
                                        <input
                                            ref={popupEndDateInputRef}
                                            className="sr-only"
                                            type="date"
                                            value={popupForm.endsAt}
                                            onChange={(e) => setPopupForm((prev) => ({ ...prev, endsAt: e.target.value }))}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (popupEndDateInputRef.current?.showPicker) popupEndDateInputRef.current.showPicker();
                                                else popupEndDateInputRef.current?.click();
                                            }}
                                            className="w-full input-field pr-10 text-left"
                                        >
                                            {popupForm.endsAt ? formatAdminDate(`${popupForm.endsAt}T00:00:00`) : 'No expiry'}
                                        </button>
                                        <Calendar size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPopupForm((prev) => ({ ...prev, endsAt: '' }))}
                                        className="mt-1 text-xs text-gray-500 underline hover:text-gray-700"
                                    >
                                        Clear expiry
                                    </button>
                                    <p className="mt-1 text-xs text-gray-500">
                                        Leave empty to keep popup active until edited or deleted.
                                    </p>
                                </label>
                                <label className="text-sm text-gray-600 md:col-span-2">Popup Image URL<input className="input-field mt-1" value={popupForm.imageUrl} onChange={(e) => setPopupForm((prev) => ({ ...prev, imageUrl: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600 md:col-span-2">Audio URL<input className="input-field mt-1" value={popupForm.audioUrl} onChange={(e) => setPopupForm((prev) => ({ ...prev, audioUrl: e.target.value }))} /></label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <label
                                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        handlePopupImageUpload(e.dataTransfer?.files?.[0]);
                                    }}
                                >
                                    {popupImageUploading ? 'Uploading image...' : 'Upload Popup Image'}
                                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePopupImageUpload(e.target.files?.[0])} />
                                </label>
                                <label
                                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        handlePopupAudioUpload(e.dataTransfer?.files?.[0]);
                                    }}
                                >
                                    {popupAudioUploading ? 'Uploading audio...' : 'Upload Popup Audio'}
                                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => handlePopupAudioUpload(e.target.files?.[0])} />
                                </label>
                            </div>
                            <div className="w-full flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                                <div className="space-y-2 md:max-w-sm">
                                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={saveAsTemplate}
                                            onChange={(e) => setSaveAsTemplate(e.target.checked)}
                                        />
                                        Save this popup as template
                                    </label>
                                    {saveAsTemplate && (
                                        <input
                                            className="input-field text-sm w-full"
                                            value={popupTemplateName}
                                            onChange={(e) => setPopupTemplateName(e.target.value)}
                                            placeholder="Template name (e.g., Diwali 2026)"
                                        />
                                    )}
                                </div>
                                <div>
                                    <button type="button" onClick={handleSavePopup} disabled={popupSaving || popupTemplateSaving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60">
                                        <Save size={16} /> {(popupSaving || popupTemplateSaving) ? 'Saving...' : 'Save Popup'}
                                    </button>
                                </div>
                            </div>
                            <div className="text-xs text-gray-500">
                                Tip: choose an existing template, edit popup content, and save again to replace it for future campaigns.
                            </div>
                        </div>
                        {!popupForm.isActive && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/35">
                                <div className="flex flex-col items-center gap-2">
                                    <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/95 border border-gray-200 text-gray-500 shadow-sm">
                                        <CircleOff size={18} />
                                    </span>
                                    <p className="px-3 py-1.5 rounded-md bg-white/90 border border-gray-200 text-xs font-semibold text-gray-600">
                                        Popup is disabled. Enable the checkbox to edit.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>

            {isCouponModalOpen && createPortal(
                <div className="fixed inset-0 z-[210]">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsCouponModalOpen(false)}></div>
                    <div className="relative z-10 flex min-h-full items-start sm:items-center justify-center p-4 sm:p-6 overflow-y-auto">
                    <div className="w-full max-w-3xl rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col my-auto">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div><p className="text-xs uppercase tracking-[0.25em] text-gray-400 font-semibold">Coupon</p><h3 className="text-lg font-semibold text-gray-900 mt-1">Issue New Coupon</h3></div>
                            <button onClick={() => setIsCouponModalOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                        </div>
                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="text-sm text-gray-600">
                                    Coupon Code
                                    <input
                                        list="coupon-code-options"
                                        maxLength={15}
                                        className="input-field mt-1"
                                        placeholder="SSC-AB12-CD34"
                                        value={couponForm.code}
                                        onChange={(e) => setCouponForm((p) => ({ ...p, code: sanitizeCouponCode(e.target.value) }))}
                                    />
                                    <datalist id="coupon-code-options">
                                        {couponCodeOptions.map((code) => <option key={code} value={code} />)}
                                    </datalist>
                                </label>
                                <label className="text-sm text-gray-600">Coupon Name<input className="input-field mt-1" placeholder="Coupon name" value={couponForm.name} onChange={(e) => setCouponForm((p) => ({ ...p, name: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Discount Type<select className="input-field mt-1" value={couponForm.discountType} onChange={(e) => setCouponForm((p) => ({ ...p, discountType: e.target.value, discountValue: e.target.value === 'shipping_full' ? 0 : p.discountValue, maxDiscountValue: e.target.value === 'percent' ? (Number(p.maxDiscountValue || 0) || 1000) : 0 }))}><option value="percent">Percent</option><option value="fixed">Fixed INR</option><option value="shipping_full">Shipping Full</option><option value="shipping_partial">Shipping Partial (%)</option></select></label>
                                <label className="text-sm text-gray-600">Discount Value<input className="input-field mt-1" type="number" disabled={couponForm.discountType === 'shipping_full'} value={couponForm.discountValue} onChange={(e) => setCouponForm((p) => ({ ...p, discountValue: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Minimum Cart Value (INR)<input className="input-field mt-1" type="number" min="0" value={couponForm.minCartValue} onChange={(e) => setCouponForm((p) => ({ ...p, minCartValue: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">Maximum Discount (INR)<input className="input-field mt-1" type="number" min="0" disabled={couponForm.discountType !== 'percent'} value={couponForm.maxDiscountValue} onChange={(e) => setCouponForm((p) => ({ ...p, maxDiscountValue: e.target.value }))} /></label>
                                <label className="text-sm text-gray-600">
                                    Start Date <span className="text-red-500">*</span>
                                    <input
                                        ref={couponStartDateInputRef}
                                        className="sr-only"
                                        type="date"
                                        value={couponForm.startsAt}
                                        min={couponForm.expiresAt ? addDaysToInput(couponForm.expiresAt, -MAX_COUPON_RANGE_DAYS) : undefined}
                                        max={couponForm.expiresAt || undefined}
                                        onChange={(e) => setCouponForm((p) => ({ ...p, startsAt: e.target.value }))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (couponStartDateInputRef.current?.showPicker) couponStartDateInputRef.current.showPicker();
                                            else couponStartDateInputRef.current?.click();
                                        }}
                                        className="w-full input-field mt-1 text-left"
                                    >
                                        {couponForm.startsAt ? formatAdminDate(`${couponForm.startsAt}T00:00:00`) : 'Start Date'}
                                    </button>
                                </label>
                                <label className="text-sm text-gray-600">
                                    End Date (Optional)
                                    <input
                                        ref={couponEndDateInputRef}
                                        className="sr-only"
                                        type="date"
                                        value={couponForm.expiresAt}
                                        min={couponForm.startsAt || undefined}
                                        max={couponForm.startsAt ? addDaysToInput(couponForm.startsAt, MAX_COUPON_RANGE_DAYS) : undefined}
                                        onChange={(e) => setCouponForm((p) => ({ ...p, expiresAt: e.target.value }))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (couponEndDateInputRef.current?.showPicker) couponEndDateInputRef.current.showPicker();
                                            else couponEndDateInputRef.current?.click();
                                        }}
                                        className="w-full input-field mt-1 text-left"
                                    >
                                        {couponForm.expiresAt ? formatAdminDate(`${couponForm.expiresAt}T00:00:00`) : 'End Date'}
                                    </button>
                                </label>
                                <label className="text-sm text-gray-600">Coupon Scope<select className="input-field mt-1" value={couponForm.scopeType} onChange={(e) => setCouponForm((p) => ({ ...p, scopeType: e.target.value }))}><option value="generic">Generic</option><option value="category">Category specific</option><option value="tier">Tier specific</option></select></label>
                                <label className="text-sm text-gray-600">Usage Limit Per User<input className="input-field mt-1" type="number" value={couponForm.usageLimitPerUser} onChange={(e) => setCouponForm((p) => ({ ...p, usageLimitPerUser: e.target.value }))} /></label>
                                {couponForm.scopeType === 'tier' && (
                                    <label className="text-sm text-gray-600">Tier Scope<select className="input-field mt-1" value={couponForm.tierScope} onChange={(e) => setCouponForm((p) => ({ ...p, tierScope: e.target.value }))}>{ORDER.map((tier) => <option key={tier} value={tier}>{tierLabel(tier).toUpperCase()}</option>)}</select></label>
                                )}
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="text-xs text-gray-500">Coupon code suggestions are dynamic. Pick from dropdown or type your own code.</p>
                                <button
                                    type="button"
                                    onClick={() => setCouponCodeOptions(buildCouponCodeOptions())}
                                    className="text-xs font-semibold text-primary hover:text-primary-light"
                                >
                                    Regenerate codes
                                </button>
                            </div>
                            {couponForm.scopeType === 'category' && (
                                <label className="text-sm text-gray-600 block">Category Scope (Multi-select)
                                    <select
                                        multiple
                                        className="input-field mt-1 min-h-[140px]"
                                        value={couponForm.categoryIds.map(String)}
                                        onChange={(e) => {
                                            const selected = Array.from(e.target.selectedOptions).map((op) => Number(op.value)).filter((n) => Number.isFinite(n) && n > 0);
                                            setCouponForm((p) => ({ ...p, categoryIds: selected }));
                                        }}
                                    >
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                    {categories.length === 0 && (
                                        <p className="mt-2 text-[11px] text-amber-700">No categories found. Create categories first to issue category-scoped coupons.</p>
                                    )}
                                </label>
                            )}
                            <p className="text-sm text-gray-500">Date format: DD MMM YYYY (eg 17th Feb 2026). End date is optional.</p>
                        </div>
                        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
                            <button type="button" onClick={() => setIsCouponModalOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button type="button" onClick={handleIssueCoupon} disabled={couponCreating} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60">
                                <Plus size={16} /> {couponCreating ? 'Issuing...' : 'Issue Coupon'}
                            </button>
                        </div>
                    </div>
                    </div>
                </div>,
                document.body
            )}

            {editRow && createPortal(
                <div className="fixed inset-0 z-[95] bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
                    <div className="w-full max-w-2xl rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col my-auto">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div><p className="text-xs uppercase tracking-[0.25em] text-gray-400 font-semibold">Edit Tier</p><h3 className="text-lg font-semibold text-gray-900 mt-1">{editRow.label}</h3></div>
                            <button onClick={() => setEditingTier(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                        </div>
                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <label className="text-sm text-gray-600">Threshold (INR)<input className="input-field mt-1" type="number" value={editRow.threshold} onChange={(e) => updateRow(editRow.tier, { threshold: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Window Days<input className="input-field mt-1" type="number" value={editRow.windowDays} onChange={(e) => updateRow(editRow.tier, { windowDays: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Extra Discount %<input className="input-field mt-1" type="number" step="0.1" value={editRow.extraDiscountPct} onChange={(e) => updateRow(editRow.tier, { extraDiscountPct: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Shipping Discount %<input className="input-field mt-1" type="number" step="0.1" value={editRow.shippingDiscountPct} onChange={(e) => updateRow(editRow.tier, { shippingDiscountPct: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Birthday Discount %<input className="input-field mt-1" type="number" step="0.1" value={editRow.birthdayDiscountPct} onChange={(e) => updateRow(editRow.tier, { birthdayDiscountPct: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Abandoned Cart Boost %<input className="input-field mt-1" type="number" step="0.1" value={editRow.abandonedCartBoostPct} onChange={(e) => updateRow(editRow.tier, { abandonedCartBoostPct: e.target.value })} /></label>
                                <label className="text-sm text-gray-600">Priority Weight<input className="input-field mt-1" type="number" value={editRow.priorityWeight} onChange={(e) => updateRow(editRow.tier, { priorityWeight: e.target.value })} /></label>
                            </div>
                            <label className="text-sm text-gray-600 block">
                                Shipping Priority
                                <select className="input-field mt-1" value={editRow.shippingPriority} onChange={(e) => updateRow(editRow.tier, { shippingPriority: e.target.value })}>
                                    {SHIPPING_PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
                            <button type="button" onClick={() => setEditingTier(null)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
                            <button type="button" onClick={handleSaveTier} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60">
                                <Save size={16} /> {saving ? 'Saving...' : 'Save Tier'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {isCouponDetailsOpen && selectedCoupon && createPortal(
                <div className="fixed inset-0 z-[220] flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-xl h-full shadow-2xl p-6 overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-900">Voucher Details</h3>
                            <button
                                type="button"
                                onClick={closeCouponDetails}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2 text-sm text-gray-700">
                            <p><span className="text-gray-500">Code:</span> <span className="font-semibold text-gray-900">{selectedCoupon.code || '—'}</span></p>
                            <p><span className="text-gray-500">Name:</span> {selectedCoupon.name || 'Coupon'}</p>
                            <p><span className="text-gray-500">Source:</span> {String(selectedCoupon.source_type || 'admin')}</p>
                            <p><span className="text-gray-500">Scope:</span> {String(selectedCoupon.scope_type || 'generic')}</p>
                            <p><span className="text-gray-500">Scope Details:</span> {formatScopeSummary(selectedCoupon, categories)}</p>
                            <p><span className="text-gray-500">Tier Scope:</span> {selectedCoupon.tier_scope || '—'}</p>
                            <p><span className="text-gray-500">Discount:</span> {formatDiscountOffer(selectedCoupon.discount_type, selectedCoupon.discount_value)}</p>
                            <p><span className="text-gray-500">Max Discount:</span> ₹{Number(selectedCoupon.max_discount_value ?? selectedCoupon.maxDiscountValue ?? ((selectedCoupon.max_discount_subunits ?? selectedCoupon.maxDiscountSubunits) != null ? Number(selectedCoupon.max_discount_subunits ?? selectedCoupon.maxDiscountSubunits) / 100 : 0)).toLocaleString('en-IN')}</p>
                            <p><span className="text-gray-500">Discount Applies To:</span> {formatShippingApplicability(selectedCoupon.discount_type)}</p>
                            <p><span className="text-gray-500">Min Cart Value:</span> ₹{Number(selectedCoupon.min_cart_value || 0).toLocaleString('en-IN')}</p>
                            <p><span className="text-gray-500">Usage Limit / User:</span> {Number(selectedCoupon.usage_limit_per_user || 0)}</p>
                            <p><span className="text-gray-500">Used Count:</span> {Number(selectedCoupon.used_count || 0)}</p>
                            <p><span className="text-gray-500">Starts:</span> {selectedCoupon.starts_at ? formatAdminDate(selectedCoupon.starts_at) : '—'}</p>
                            <p><span className="text-gray-500">Expires:</span> {formatCouponExpiry(selectedCoupon.expires_at || selectedCoupon.expiresAt)}</p>
                            <p><span className="text-gray-500">Created:</span> {selectedCoupon.created_at ? formatAdminDate(selectedCoupon.created_at) : '—'}</p>
                            {!!selectedCoupon.created_by_name && (
                                <p><span className="text-gray-500">Created By:</span> {selectedCoupon.created_by_name}</p>
                            )}
                            {String(selectedCoupon.scope_type || '').toLowerCase() === 'customer' && (
                                <div>
                                    <p className="text-gray-500 mb-1">Assigned Customers:</p>
                                    {Array.isArray(selectedCoupon.customer_targets) && selectedCoupon.customer_targets.length > 0 ? (
                                        <div className="space-y-1">
                                            {selectedCoupon.customer_targets.map((target) => (
                                                <p key={`${target.user_id}-${target.mobile || ''}`} className="text-xs">
                                                    <span className="font-semibold text-gray-800">{target.name || 'Customer'}</span>
                                                    {target.mobile ? ` | ${target.mobile}` : ''}
                                                    {target.email ? ` | ${target.email}` : ''}
                                                    {target.user_id ? ` | ID: ${target.user_id}` : ''}
                                                </p>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500">No explicit customer mapping found.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
            <Modal
                isOpen={confirmModal.isOpen}
                onClose={closeConfirmModal}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
                confirmText={confirmModal.confirmText}
                onConfirm={handleDeleteCoupon}
                isLoading={isConfirmProcessing}
            />
        </div>
    );
}
