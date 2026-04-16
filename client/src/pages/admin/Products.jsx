import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { productService } from '../../services/productService';
import { adminService } from '../../services/adminService';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { 
    Loader2, Search, Plus, Package, 
    ChevronLeft, ChevronRight, Edit3, Trash2, Eye, EyeOff, Filter,
    Infinity as InfinityIcon, AlertTriangle, Upload, X, LayoutGrid, Settings, Users, PackageCheck, PackageX
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import AddProductModal from '../../components/AddProductModal';
import emptyIllustration from '../../assets/closed.svg';
import { isDiscoveryItemInStock } from '../../utils/shopDiscovery';

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

const ADMIN_CATEGORY_CACHE_PREFIX = 'admin_products_category_cache_v1';
const ADMIN_CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;
const ADMIN_FETCH_PAGE_LIMIT = 500;

const readCategoryCache = (category = '') => {
    const cleanCategory = String(category || '').trim().toLowerCase();
    if (!cleanCategory) return null;
    const key = `${ADMIN_CATEGORY_CACHE_PREFIX}:${cleanCategory}`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.products) || !parsed.timestamp) return null;
        if (Date.now() - Number(parsed.timestamp || 0) > ADMIN_CATEGORY_CACHE_TTL_MS) return null;
        return parsed.products;
    } catch {
        return null;
    }
};

const writeCategoryCache = (category = '', products = []) => {
    const cleanCategory = String(category || '').trim().toLowerCase();
    if (!cleanCategory) return;
    const key = `${ADMIN_CATEGORY_CACHE_PREFIX}:${cleanCategory}`;
    try {
        localStorage.setItem(key, JSON.stringify({ products, timestamp: Date.now() }));
    } catch {
        // Ignore storage errors
    }
};

const clearCategoryCache = (category = '') => {
    const cleanCategory = String(category || '').trim().toLowerCase();
    if (!cleanCategory) return;
    try {
        localStorage.removeItem(`${ADMIN_CATEGORY_CACHE_PREFIX}:${cleanCategory}`);
    } catch {
        // Ignore storage errors
    }
};

const clearAllCategoryCaches = () => {
    try {
        const keysToDelete = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${ADMIN_CATEGORY_CACHE_PREFIX}:`)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach((key) => localStorage.removeItem(key));
    } catch {
        // Ignore storage errors
    }
};

const extractCategoryNames = (value) => {
    const input = value && typeof value === 'object' && value.product ? value.product.categories : value;
    if (!input) return [];
    let parsed = input;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            parsed = [parsed];
        }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .map((entry) => {
            if (typeof entry === 'string') return entry.trim();
            if (entry && typeof entry === 'object') {
                const name = String(entry.name || entry.label || entry.title || '').trim();
                return name;
            }
            return '';
        })
        .filter(Boolean);
};

const ADMIN_FILTER_ALL = 'all';
const ADMIN_FILTER_UNCATEGORIZED = 'uncategorized';
const POST_CRUD_REFRESH_DELAY_MS = 180;
const USAGE_AUDIENCE_ITEMS = [
    { key: 'men', label: 'Men', field: 'usageAudienceMenImageUrl' },
    { key: 'women', label: 'Women', field: 'usageAudienceWomenImageUrl' },
    { key: 'kids', label: 'Kids', field: 'usageAudienceKidsImageUrl' }
];
const productStatusToggleEnabled = String(import.meta.env.VITE_ENABLE_PRODUCT_STATUS_TOGGLE || '')
    .trim()
    .toLowerCase() === 'true';
const inventoryTrackingEnabled = String(import.meta.env.VITE_ENABLE_INVENTORY_TRACKING || '')
    .trim()
    .toLowerCase() === 'true';
const isTrackedStock = (item = {}) => String(item?.track_quantity) === '1' || String(item?.track_quantity) === 'true' || item?.track_quantity === true;
const getStockFilterLabel = (value = 'all') => {
    if (value === 'in') return 'Showing in-stock products';
    if (value === 'out') return 'Showing out-of-stock products';
    return 'Showing all stock states';
};
const getNextStockFilter = (value = 'all') => {
    if (value === 'all') return 'in';
    if (value === 'in') return 'out';
    return 'all';
};
const getStockFilterIcon = (value = 'all') => {
    if (value === 'in') return PackageCheck;
    if (value === 'out') return PackageX;
    return Package;
};
const getStockBadgeMeta = (product = {}) => {
    const inStock = isDiscoveryItemInStock(product);
    if (inStock) {
        return {
            label: 'In Stock',
            classes: 'bg-emerald-100 text-emerald-700',
            icon: PackageCheck
        };
    }
    return {
        label: 'Out of Stock',
        classes: 'bg-rose-100 text-rose-700',
        icon: PackageX
    };
};
const MOBILE_PRODUCT_CARD_THEMES = [
    {
        shell: 'border-sky-200 bg-gradient-to-br from-white via-sky-50/65 to-cyan-50/80 shadow-sky-100/60',
        strip: 'from-sky-400 via-cyan-400 to-sky-300',
        media: 'border-sky-100 bg-sky-50/60',
        chip: 'border-sky-100 bg-sky-50 text-sky-700',
        divider: 'border-sky-100',
        action: 'border-gray-200 bg-white/90'
    },
    {
        shell: 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/65 to-lime-50/80 shadow-emerald-100/60',
        strip: 'from-emerald-400 via-lime-400 to-emerald-300',
        media: 'border-emerald-100 bg-emerald-50/60',
        chip: 'border-emerald-100 bg-emerald-50 text-emerald-700',
        divider: 'border-emerald-100',
        action: 'border-gray-200 bg-white/90'
    },
    {
        shell: 'border-fuchsia-200 bg-gradient-to-br from-white via-fuchsia-50/60 to-rose-50/80 shadow-fuchsia-100/60',
        strip: 'from-fuchsia-400 via-pink-400 to-rose-300',
        media: 'border-fuchsia-100 bg-fuchsia-50/60',
        chip: 'border-fuchsia-100 bg-fuchsia-50 text-fuchsia-700',
        divider: 'border-fuchsia-100',
        action: 'border-gray-200 bg-white/90'
    },
    {
        shell: 'border-amber-200 bg-gradient-to-br from-white via-amber-50/60 to-orange-50/80 shadow-amber-100/60',
        strip: 'from-amber-400 via-orange-400 to-amber-300',
        media: 'border-amber-100 bg-amber-50/60',
        chip: 'border-amber-100 bg-amber-50 text-amber-700',
        divider: 'border-amber-100',
        action: 'border-gray-200 bg-white/90'
    }
];
const getMobileProductCardTheme = (index = 0) => MOBILE_PRODUCT_CARD_THEMES[index % MOBILE_PRODUCT_CARD_THEMES.length];

export default function Products({
    onNavigate,
    storefrontOpen = true,
    focusProductId = null,
    onFocusHandled = () => {},
    mobilePageHeaderActive = false
}) {
    const [allProducts, setAllProducts] = useState([]);
    const [isDownloading, setIsDownloading] = useState(false);
    
    // Pagination & Filters
    const [page, setPage] = useState(1);
    const [filterCategory, setFilterCategory] = useState('');
    const [filterUsageAudience, setFilterUsageAudience] = useState('');
    const [filterStatus, setFilterStatus] = useState(productStatusToggleEnabled ? 'active' : 'active');
    const [filterStock, setFilterStock] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [categories, setCategories] = useState([]); // <--- New State
    const [isCategoriesLoading, setIsCategoriesLoading] = useState(false);

    // Modals State
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [productToDelete, setProductToDelete] = useState(null); // For Delete Confirmation
    const [refreshTick, setRefreshTick] = useState(0);
    const [isMobileSearchModalOpen, setIsMobileSearchModalOpen] = useState(false);
    const [isMobileFilterModalOpen, setIsMobileFilterModalOpen] = useState(false);
    const [isMobileAudienceModalOpen, setIsMobileAudienceModalOpen] = useState(false);
    const [usageAudienceConfig, setUsageAudienceConfig] = useState({
        enabled: false,
        usageAudienceMenImageUrl: '',
        usageAudienceWomenImageUrl: '',
        usageAudienceKidsImageUrl: ''
    });
    const [usageAudienceDraft, setUsageAudienceDraft] = useState({
        enabled: true,
        usageAudienceMenImageUrl: '',
        usageAudienceWomenImageUrl: '',
        usageAudienceKidsImageUrl: ''
    });
    const [subCategoriesEnabled, setSubCategoriesEnabled] = useState(false);
    const [isUsageAudienceModalOpen, setIsUsageAudienceModalOpen] = useState(false);
    const [isUsageAudienceSaving, setIsUsageAudienceSaving] = useState(false);
    const [uploadingAudienceKey, setUploadingAudienceKey] = useState('');
    const toast = useToast();

    const applyUsageAudienceConfig = useCallback((company = {}) => {
        const next = {
            enabled: company?.usageAudienceEnabled === true,
            usageAudienceMenImageUrl: String(company?.usageAudienceMenImageUrl || '').trim(),
            usageAudienceWomenImageUrl: String(company?.usageAudienceWomenImageUrl || '').trim(),
            usageAudienceKidsImageUrl: String(company?.usageAudienceKidsImageUrl || '').trim()
        };
        setUsageAudienceConfig(next);
        setUsageAudienceDraft({ enabled: true, ...next });
    }, []);

    const loadCategories = useCallback(async () => {
        setIsCategoriesLoading(true);
        try {
            const data = await productService.getCategories();
            const nextCategories = Array.isArray(data) ? data : [];
            setCategories(nextCategories);
            setFilterCategory((prev) => {
                if (prev === ADMIN_FILTER_ALL || prev === ADMIN_FILTER_UNCATEGORIZED) return prev;
                if (prev && nextCategories.includes(prev)) return prev;
                return ADMIN_FILTER_ALL;
            });
        } catch (error) {
            console.error('Failed to load categories', error);
            setCategories([]);
            setFilterCategory(ADMIN_FILTER_ALL);
            setAllProducts([]);
        } finally {
            setIsCategoriesLoading(false);
        }
    }, []);

    const fetchCategoryProducts = useCallback(async ({ category, force = false, silent = false } = {}) => {
        const selected = String(category || '').trim();
        if (!selected) {
            setAllProducts([]);
            return [];
        }
        const cached = !force ? readCategoryCache(selected) : null;
        if (cached) {
            setAllProducts(cached);
            return cached;
        }
        if (!silent) setIsDownloading(true);
        try {
            const first = await productService.getProducts(1, selected, 'all', 'newest', ADMIN_FETCH_PAGE_LIMIT);
            const totalPages = Math.max(1, Number(first?.totalPages || 1));
            let combined = Array.isArray(first?.products) ? [...first.products] : [];
            for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
                const pageData = await productService.getProducts(pageNo, selected, 'all', 'newest', ADMIN_FETCH_PAGE_LIMIT);
                const chunk = Array.isArray(pageData?.products) ? pageData.products : [];
                combined = combined.concat(chunk);
            }
            setAllProducts(combined);
            writeCategoryCache(selected, combined);
            return combined;
        } catch (error) {
            console.error('Failed to load products for category', selected, error);
            setAllProducts([]);
            return [];
        } finally {
            if (!silent) setIsDownloading(false);
        }
    }, []);

    const patchCurrentCategoryList = useCallback((updater) => {
        setAllProducts((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : prev;
            writeCategoryCache(filterCategory, next);
            return next;
        });
    }, [filterCategory]);

    const scheduleCurrentCategoryRefresh = useCallback(() => {
        window.clearTimeout(scheduleCurrentCategoryRefresh.timerId);
        scheduleCurrentCategoryRefresh.timerId = window.setTimeout(() => {
            setRefreshTick((prev) => prev + 1);
        }, POST_CRUD_REFRESH_DELAY_MS);
    }, []);

    const matchesCurrentFilter = useCallback((product = {}) => {
        const categoryNames = extractCategoryNames(product.categories);
        const normalizedCurrent = String(filterCategory || '').trim().toLowerCase();
        if (normalizedCurrent === ADMIN_FILTER_ALL) return true;
        if (normalizedCurrent === ADMIN_FILTER_UNCATEGORIZED) return categoryNames.length === 0;
        return categoryNames.some((name) => name.toLowerCase() === normalizedCurrent);
    }, [filterCategory]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    useEffect(() => {
        const loadUsageAudienceConfig = async () => {
            try {
                const data = await adminService.getCompanyInfo();
                applyUsageAudienceConfig(data?.company || {});
                setSubCategoriesEnabled(data?.company?.subCategoriesEnabled === true);
            } catch (error) {
                console.error('Failed to load usage audience settings', error);
            }
        };
        loadUsageAudienceConfig();
    }, [applyUsageAudienceConfig]);

    useEffect(() => {
        setPage(1);
        fetchCategoryProducts({ category: filterCategory, force: false });
    }, [filterCategory, fetchCategoryProducts]);

    useEffect(() => {
        if (!refreshTick) return;
        fetchCategoryProducts({ category: filterCategory, force: true, silent: true });
    }, [fetchCategoryProducts, filterCategory, refreshTick]);

    useEffect(() => {
        if (!usageAudienceConfig.enabled && filterUsageAudience) {
            setFilterUsageAudience('');
        }
    }, [filterUsageAudience, usageAudienceConfig.enabled]);

    useAdminCrudSync({
        'refresh:categories': (payload = {}) => {
            if (String(payload?.action || '').toLowerCase() === 'sync_all') {
                clearAllCategoryCaches();
            } else if (payload?.category?.name) {
                clearCategoryCache(payload.category.name);
            }
            loadCategories();
            scheduleCurrentCategoryRefresh();
        },
        'product:create': (payload = {}) => {
            const product = payload && payload.id ? payload : payload?.product;
            const categoryNames = extractCategoryNames(product);
            categoryNames.forEach(clearCategoryCache);
            if (!product?.id) return;
            const isInCurrent = matchesCurrentFilter(product);
            if (isInCurrent) {
                patchCurrentCategoryList((prev) => {
                    const exists = prev.some((item) => String(item?.id || '') === String(product.id));
                    if (exists) return prev.map((item) => String(item?.id || '') === String(product.id) ? { ...item, ...product } : item);
                    return [product, ...prev];
                });
            }
            scheduleCurrentCategoryRefresh();
        },
        'product:update': (payload = {}) => {
            const product = payload && payload.id ? payload : payload?.product;
            if (!product?.id) return;
            const categoryNames = extractCategoryNames(product);
            categoryNames.forEach(clearCategoryCache);
            const isInCurrent = matchesCurrentFilter(product);
            patchCurrentCategoryList((prev) => {
                const exists = prev.some((item) => String(item?.id || '') === String(product.id));
                if (exists && !isInCurrent) {
                    return prev.filter((item) => String(item?.id || '') !== String(product.id));
                }
                if (!exists && !isInCurrent) return prev;
                if (exists) {
                    return prev.map((item) => String(item?.id || '') === String(product.id) ? { ...item, ...product } : item);
                }
                return [product, ...prev];
            });
            scheduleCurrentCategoryRefresh();
        },
        'product:delete': ({ id } = {}) => {
            clearAllCategoryCaches();
            if (!id) return;
            patchCurrentCategoryList((prev) => prev.filter((item) => String(item?.id || '') !== String(id)));
            scheduleCurrentCategoryRefresh();
        },
        'company:info_update': ({ company } = {}) => {
            if (!company || typeof company !== 'object') return;
            applyUsageAudienceConfig(company);
        }
    });

    // --- HANDLERS ---
    const handleSaveProduct = async (formData, id) => {
        if (id) {
            await productService.updateProduct(id, formData);
            toast.success("Product updated successfully!");
        } else {
            await productService.createProduct(formData);
            toast.success("Product created successfully!");
        }
        productService.clearCache();
        await loadCategories();
        await fetchCategoryProducts({ category: filterCategory, force: true });
    };

    // Open Delete Confirmation Modal
    const initiateDelete = (product) => {
        setProductToDelete(product);
    };

    // Confirm Delete Action
    const confirmDelete = async () => {
        if (!productToDelete) return;
        try {
            await productService.deleteProduct(productToDelete.id);
            toast.success(`"${productToDelete.title}" has been deleted.`);
            productService.clearCache();
            await loadCategories();
            await fetchCategoryProducts({ category: filterCategory, force: true });
        } catch {
            toast.error("Failed to delete product.");
        } finally {
            setProductToDelete(null); // Close modal
        }
    };

    const openEditModal = (product) => {
        setEditingProduct(product);
        setIsAddModalOpen(true);
    };

    useEffect(() => {
        const targetId = String(focusProductId || '').trim();
        if (!targetId) return;
        const targetProduct = (allProducts || []).find((product) => String(product?.id || '') === targetId);
        if (targetProduct) {
            setEditingProduct(targetProduct);
            setIsAddModalOpen(true);
            onFocusHandled(targetId);
            return;
        }
        productService.getProduct(targetId)
            .then((product) => {
                if (!product) return;
                setEditingProduct(product);
                setIsAddModalOpen(true);
                onFocusHandled(targetId);
            })
            .catch(() => {});
    }, [allProducts, focusProductId, onFocusHandled]);

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
        setEditingProduct(null);
    };

    const handleOpenUsageAudienceModal = () => {
        setUsageAudienceDraft({
            enabled: usageAudienceConfig.enabled === true,
            usageAudienceMenImageUrl: usageAudienceConfig.usageAudienceMenImageUrl || '',
            usageAudienceWomenImageUrl: usageAudienceConfig.usageAudienceWomenImageUrl || '',
            usageAudienceKidsImageUrl: usageAudienceConfig.usageAudienceKidsImageUrl || ''
        });
        setIsUsageAudienceModalOpen(true);
    };

    const handleUsageAudienceToggle = async () => {
        if (usageAudienceConfig.enabled) {
            setIsUsageAudienceSaving(true);
            try {
                const data = await adminService.updateCompanyInfo({
                    usageAudienceEnabled: false,
                    usageAudienceMenImageUrl: usageAudienceConfig.usageAudienceMenImageUrl || '',
                    usageAudienceWomenImageUrl: usageAudienceConfig.usageAudienceWomenImageUrl || '',
                    usageAudienceKidsImageUrl: usageAudienceConfig.usageAudienceKidsImageUrl || ''
                });
                applyUsageAudienceConfig(data?.company || {});
                toast.success('Usage audience classification disabled');
            } catch (error) {
                toast.error(error?.message || 'Failed to disable usage audience classification');
            } finally {
                setIsUsageAudienceSaving(false);
            }
            return;
        }
        handleOpenUsageAudienceModal();
    };

    const handleUsageAudienceImageUpload = async (key, file) => {
        if (!file) return;
        setUploadingAudienceKey(key);
        try {
            const data = await adminService.uploadUsageAudienceImage(file);
            const imageUrl = String(data?.url || '').trim();
            if (!imageUrl) throw new Error('Upload did not return an image URL');
            const field = USAGE_AUDIENCE_ITEMS.find((item) => item.key === key)?.field;
            if (!field) throw new Error('Invalid usage audience image target');
            setUsageAudienceDraft((prev) => ({ ...prev, [field]: imageUrl }));
            toast.success(`${USAGE_AUDIENCE_ITEMS.find((item) => item.key === key)?.label || 'Usage'} image uploaded`);
        } catch (error) {
            toast.error(error?.message || 'Failed to upload usage audience image');
        } finally {
            setUploadingAudienceKey('');
        }
    };

    const handleSaveUsageAudienceSettings = async () => {
        if (usageAudienceDraft.enabled) {
            const missing = USAGE_AUDIENCE_ITEMS.find((item) => !String(usageAudienceDraft[item.field] || '').trim());
            if (missing) {
                toast.error(`${missing.label} image is required`);
                return;
            }
        }
        setIsUsageAudienceSaving(true);
        try {
            const data = await adminService.updateCompanyInfo({
                usageAudienceEnabled: usageAudienceDraft.enabled === true,
                usageAudienceMenImageUrl: usageAudienceDraft.usageAudienceMenImageUrl || '',
                usageAudienceWomenImageUrl: usageAudienceDraft.usageAudienceWomenImageUrl || '',
                usageAudienceKidsImageUrl: usageAudienceDraft.usageAudienceKidsImageUrl || ''
            });
            applyUsageAudienceConfig(data?.company || {});
            setIsUsageAudienceModalOpen(false);
            toast.success('Usage audience classification saved');
        } catch (error) {
            toast.error(error?.message || 'Failed to save usage audience settings');
        } finally {
            setIsUsageAudienceSaving(false);
        }
    };

    // --- SEARCH FILTER ---
    const PAGE_SIZE = 10;
    const filteredProducts = useMemo(() => {
        return allProducts
            .filter((p) => {
                if (!productStatusToggleEnabled) return String(p?.status || '').toLowerCase() === 'active';
                return filterStatus === 'all' || p.status === filterStatus;
            })
            .filter((p) => {
                if (filterStock === 'all') return true;
                const inStock = isDiscoveryItemInStock(p);
                return filterStock === 'in' ? inStock : !inStock;
            })
            .filter((p) => {
                if (!filterUsageAudience) return true;
                return String(p?.usageAudience || p?.usage_audience || '').trim().toLowerCase() === filterUsageAudience;
            })
            .filter(p =>
                p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()))
            );
    }, [allProducts, filterStatus, filterStock, filterUsageAudience, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
    const visiblePages = useMemo(() => buildVisiblePages(page, totalPages, 4), [page, totalPages]);
    const paginatedProducts = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredProducts.slice(start, start + PAGE_SIZE);
    }, [filteredProducts, page]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    return (
        <div className="animate-fade-in space-y-6 relative overflow-x-hidden">
            {/* --- ADD/EDIT MODAL --- */}
            <AddProductModal 
                isOpen={isAddModalOpen} 
                onClose={handleCloseModal} 
                onConfirm={handleSaveProduct}
                productToEdit={editingProduct}
                usageAudienceConfig={usageAudienceConfig}
                subCategoriesEnabled={subCategoriesEnabled}
            />

            {isUsageAudienceModalOpen && createPortal(
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Usage Audience Settings</h3>
                                <p className="text-sm text-gray-500 mt-1">Control audience tagging, storefront filtering, and tile images.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsUsageAudienceModalOpen(false)}
                                className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5 overflow-y-auto flex-1">
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-gray-800">Classify products by usage audience</p>
                                        <p className="text-xs text-gray-500 mt-1">Enable Men, Women, and Kids tagging for products and storefront browsing.</p>
                                    </div>
                                    <label className={`inline-flex w-auto shrink-0 items-center justify-between gap-1.5 px-2.5 py-2 rounded-full text-sm font-bold min-w-[116px] transition-colors ${
                                        usageAudienceDraft.enabled ? 'bg-primary text-accent' : 'bg-gray-200 text-gray-700'
                                    }`}>
                                        <span>{usageAudienceDraft.enabled ? 'Enabled' : 'Disabled'}</span>
                                        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${usageAudienceDraft.enabled ? 'translate-x-0 text-primary' : 'text-gray-400'}`} />
                                        <input
                                            type="checkbox"
                                            className="sr-only"
                                            checked={Boolean(usageAudienceDraft.enabled)}
                                            onChange={(e) => setUsageAudienceDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                                        />
                                    </label>
                                </div>
                                <div className="mt-4">
                                    <p className="text-sm text-gray-600">
                                        The audience filter will appear on the Products page when this feature is enabled.
                                    </p>
                                </div>
                            </div>
                            <div className={`${usageAudienceDraft.enabled ? '' : 'blur-[2px] opacity-55 pointer-events-none select-none'} transition-all`}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            {USAGE_AUDIENCE_ITEMS.map((item) => (
                                <div key={item.key} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                    <p className="text-sm font-bold text-gray-800">{item.label}</p>
                                    <div className="mt-3 aspect-[4/5] rounded-2xl overflow-hidden border border-gray-200 bg-white">
                                        {usageAudienceDraft[item.field] ? (
                                            <img src={usageAudienceDraft[item.field]} alt={item.label} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-sm text-gray-400">
                                                No image uploaded
                                            </div>
                                        )}
                                    </div>
                                    <label className="mt-4 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-accent text-sm font-semibold cursor-pointer hover:bg-primary-light">
                                        <Upload size={16} />
                                        {uploadingAudienceKey === item.key ? 'Uploading...' : `Upload ${item.label}`}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                handleUsageAudienceImageUpload(item.key, file);
                                                event.target.value = '';
                                            }}
                                        />
                                    </label>
                                </div>
                            ))}
                        </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white shrink-0">
                            <button
                                type="button"
                                onClick={() => setIsUsageAudienceModalOpen(false)}
                                className="px-4 py-2 rounded-xl font-bold text-gray-500 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveUsageAudienceSettings}
                                disabled={isUsageAudienceSaving}
                                className="px-5 py-2.5 rounded-xl font-bold bg-primary text-accent hover:bg-primary-light disabled:opacity-60"
                            >
                                {isUsageAudienceSaving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* --- DELETE CONFIRMATION MODAL --- */}
            {productToDelete && createPortal(
                 <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                     <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in zoom-in-95">
                         <div className="flex items-center gap-4 mb-4">
                             <div className="p-3 bg-red-100 text-red-600 rounded-full">
                                 <AlertTriangle size={24} />
                             </div>
                             <div>
                                 <h3 className="text-lg font-bold text-gray-800">Delete Product?</h3>
                                 <p className="text-sm text-gray-500">This action cannot be undone.</p>
                             </div>
                         </div>
                         <p className="text-gray-600 mb-6">
                             Are you sure you want to delete <span className="font-bold">"{productToDelete.title}"</span>?
                         </p>
                         <div className="flex justify-end gap-3">
                             <button onClick={() => setProductToDelete(null)} className="px-4 py-2 rounded-xl font-bold text-gray-500 hover:bg-gray-50">Cancel</button>
                             <button onClick={confirmDelete} className="px-4 py-2 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700">Delete</button>
                         </div>
                     </div>
                 </div>,
                 document.body
            )}

            {/* --- HEADER & ACTIONS --- */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="w-full">
                    <div className="flex items-center justify-between gap-3 md:block">
                        <h1 className={`${mobilePageHeaderActive ? 'hidden md:block' : ''} text-2xl md:text-3xl font-serif text-primary font-bold`}>Products</h1>
                    </div>
                    <p className={`${mobilePageHeaderActive ? 'hidden md:block' : ''} text-gray-500 text-sm mt-1`}>Manage your catalogue</p>
                </div>
                
                <div className="hidden md:flex flex-col md:flex-row gap-2 w-full md:w-auto">
                    {usageAudienceConfig.enabled && (
                        <div className="relative hidden md:block">
                            <Filter className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                            <select
                                id="admin-usage-audience-filter"
                                value={filterUsageAudience}
                                onChange={(e) => {
                                    setFilterUsageAudience(e.target.value);
                                    setPage(1);
                                }}
                                className="pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer min-w-[180px]"
                            >
                                <option value="">All Audiences</option>
                                <option value="men">Men</option>
                                <option value="women">Women</option>
                                <option value="kids">Kids</option>
                            </select>
                        </div>
                    )}
                    {/* --- CATEGORY FILTER --- */}
                    <div className="relative flex-1 md:w-64">
                        <Filter className="hidden md:block absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                        <select 
                            value={filterCategory}
                            onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
                            className="hidden md:block w-full pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer md:max-w-[200px]"
                            disabled={isCategoriesLoading}
                        >
                            <option value={ADMIN_FILTER_ALL}>All Products</option>
                            <option value={ADMIN_FILTER_UNCATEGORIZED}>Uncategorized</option>
                            {categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>

                    <div className="relative flex-1 md:w-64">
                        <Search className="hidden md:block absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                        <input 
                            placeholder="Search products..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="hidden md:block w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none"
                        />
                    </div>
                    <button 
                        onClick={() => setIsAddModalOpen(true)}
                        className="hidden md:flex bg-primary hover:bg-primary-light text-accent font-bold px-6 py-3 rounded-xl shadow-lg shadow-primary/20 items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        <Plus size={20} strokeWidth={3} />
                        <span className="whitespace-nowrap">Add Product</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleOpenUsageAudienceModal}
                        className="hidden md:inline-flex h-[50px] w-[50px] items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50"
                        aria-label="Usage audience settings"
                        title="Usage audience settings"
                    >
                        <Settings size={18} />
                    </button>
                </div>
            </div>

            <div className="md:hidden mb-3 flex items-center justify-end gap-2">
                {productStatusToggleEnabled ? (
                <button
                    type="button"
                    onClick={() => {
                        setFilterStatus((prev) => (prev === 'inactive' ? 'active' : 'inactive'));
                        setPage(1);
                    }}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-100 bg-gradient-to-br from-white to-slate-50/80 text-slate-700 shadow-sm shadow-slate-100/50"
                    aria-label={filterStatus === 'inactive' ? 'Showing hidden products' : 'Showing active products'}
                    title={filterStatus === 'inactive' ? 'Showing hidden products' : 'Showing active products'}
                >
                    {filterStatus === 'inactive' ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
                ) : null}
                <button
                    type="button"
                    onClick={() => {
                        setFilterStock((prev) => getNextStockFilter(prev));
                        setPage(1);
                    }}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/80 text-emerald-700 shadow-sm shadow-emerald-100/50"
                    aria-label={getStockFilterLabel(filterStock)}
                    title={getStockFilterLabel(filterStock)}
                >
                    {(() => {
                        const StockIcon = getStockFilterIcon(filterStock);
                        return <StockIcon size={17} />;
                    })()}
                </button>
                <button
                    type="button"
                    onClick={() => onNavigate('categories')}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/80 text-amber-700 shadow-sm shadow-amber-100/50"
                    aria-label="Manage categories"
                >
                    <LayoutGrid size={17} />
                </button>
                <button
                    type="button"
                    onClick={() => setIsMobileSearchModalOpen(true)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-fuchsia-100 bg-gradient-to-br from-white to-fuchsia-50/80 text-fuchsia-700 shadow-sm shadow-fuchsia-100/50"
                    aria-label="Search products"
                >
                    <Search size={17} />
                </button>
                {usageAudienceConfig.enabled && (
                    <button
                        type="button"
                        onClick={() => setIsMobileAudienceModalOpen(true)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-100 bg-gradient-to-br from-white to-sky-50/80 text-sky-700 shadow-sm shadow-sky-100/50"
                        aria-label="Filter by audience"
                        title="Filter by audience"
                    >
                        <Users size={17} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => setIsMobileFilterModalOpen(true)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/80 text-rose-700 shadow-sm shadow-rose-100/50"
                    aria-label="Filter products"
                >
                    <Filter size={17} />
                </button>
            </div>

            {isMobileSearchModalOpen && createPortal(
                <div className="fixed inset-0 z-[185] bg-black/40 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Search Products</h3>
                                <p className="text-xs text-gray-500 mt-1">Find products by title or SKU.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileSearchModalOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close product search"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 relative">
                            <Search className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
                            <input
                                placeholder="Search products..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsMobileSearchModalOpen(false)}
                            className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                        >
                            Search
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileAudienceModalOpen && createPortal(
                <div className="fixed inset-0 z-[182] bg-black/50 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Audience Filter</h3>
                                <p className="text-xs text-gray-500 mt-1">Filter products by usage audience.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileAudienceModalOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close audience filter"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4">
                            <div className="relative">
                                <Users className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
                                <select
                                    value={filterUsageAudience}
                                    onChange={(e) => {
                                        setFilterUsageAudience(e.target.value);
                                        setPage(1);
                                    }}
                                    className="w-full pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer"
                                >
                                    <option value="">All Audiences</option>
                                    <option value="men">Men</option>
                                    <option value="women">Women</option>
                                    <option value="kids">Kids</option>
                                </select>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileAudienceModalOpen(false)}
                                className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isMobileFilterModalOpen && createPortal(
                <div className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Product Filters</h3>
                                <p className="text-xs text-gray-500 mt-1">Refine the mobile product list.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileFilterModalOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close product filters"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 space-y-3">
                            <div className="relative">
                                <Filter className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
                                <select
                                    value={filterCategory}
                                    onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
                                    className="w-full pl-10 pr-8 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none appearance-none cursor-pointer"
                                    disabled={isCategoriesLoading}
                                >
                                    <option value={ADMIN_FILTER_ALL}>All Products</option>
                                    <option value={ADMIN_FILTER_UNCATEGORIZED}>Uncategorized</option>
                                    {categories.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileFilterModalOpen(false)}
                                className="w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* --- LIST VIEW --- */}
            {filteredProducts.length > 0 ? (
                <>
                    {/* 1. MOBILE LIST (Card View) */}
                    <div className="grid grid-cols-1 gap-4 md:hidden">
                        {paginatedProducts.map((product, index) => {
                            // --- 1. CALCULATE PRICE DISPLAY (Same as Desktop) ---
                            let priceDisplay;
                            if (product.variants && product.variants.length > 1) { // FIX: Only range if >1 variant
                                const prices = product.variants.map(v => Number(v.discount_price || v.price || 0));
                                const minPrice = Math.min(...prices);
                                const maxPrice = Math.max(...prices);
                                priceDisplay = minPrice === maxPrice 
                                    ? `₹${minPrice}` 
                                    : `₹${minPrice} - ₹${maxPrice}`;
                            } else {
                                priceDisplay = `₹${product.discount_price || product.mrp}`;
                            }

                            // --- 2. INACTIVE STATUS VISUALS ---
                            const isInactive = product.status !== 'active';
                            const stockBadge = getStockBadgeMeta(product);
                            const StockBadgeIcon = stockBadge.icon;
                            const theme = getMobileProductCardTheme(index);
                            const cardClasses = isInactive 
                                ? `relative overflow-hidden rounded-2xl border px-3.5 pb-3.5 pt-4 shadow-sm grayscale opacity-80 ${theme.shell}` 
                                : `relative overflow-hidden rounded-2xl border px-3.5 pb-3.5 pt-4 shadow-sm ${theme.shell}`;

                            // --- 3. ROBUST TRACKING CHECK ---
                            const isTracked = isTrackedStock(product);

                            return (
                                <div key={product.id} className={cardClasses}>
                                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.strip}`} />
                                    <div className="flex gap-3.5">
                                        <div className={`h-24 w-20 shrink-0 overflow-hidden rounded-xl border ${theme.media}`}>
                                            {product.media && product.media.find(m => m.type === 'image') ? (
                                                <img src={product.media.find(m => m.type === 'image').url} className="w-full h-full object-cover" alt="" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-300"><Package size={20}/></div>
                                            )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <h3 className="font-bold text-gray-800 line-clamp-2 mr-2">{product.title}</h3>
                                                    <p className="mt-0.5 text-[11px] text-gray-500 line-clamp-1">{product.sku || 'No SKU'}</p>
                                                </div>
                                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                                    {productStatusToggleEnabled ? (
                                                        isInactive ? (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600 uppercase tracking-wide">Hidden</span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 uppercase tracking-wide">Active</span>
                                                        )
                                                    ) : null}
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${stockBadge.classes}`}>
                                                        <StockBadgeIcon size={11} />
                                                        {stockBadge.label}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className={`mt-3 rounded-xl border px-3 py-2.5 ${theme.chip}`}>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-500">Price</p>
                                                <p className="mt-1 text-base font-bold text-primary">{priceDisplay}</p>
                                            </div>
                                            {inventoryTrackingEnabled && isTracked && (
                                                <div className="text-right">
                                                    <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-500">Tracked</p>
                                                    <p className="mt-1 text-xs font-medium text-gray-700">
                                                        {product.variants?.length > 0
                                                            ? `${product.variants.reduce((acc, v) => {
                                                                const vTracked = String(v.track_quantity) === '1' || String(v.track_quantity) === 'true' || v.track_quantity === true;
                                                                return acc + (vTracked ? Number(v.quantity || 0) : 0);
                                                            }, 0)} units`
                                                            : `${product.quantity || 0} units`
                                                        }
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className={`mt-3 flex items-center justify-end gap-2 border-t pt-3 ${theme.divider}`}>
                                        <button onClick={() => openEditModal(product)} className={`p-2 rounded-lg text-gray-600 hover:text-accent-deep ${theme.action}`}><Edit3 size={16}/></button>
                                        <button onClick={() => initiateDelete(product)} className="p-2 bg-red-50 rounded-lg text-red-500 hover:bg-red-100 border border-red-100"><Trash2 size={16}/></button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 2. DESKTOP LIST (Table View) */}
                    <div className="hidden md:block overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        <div className="inline-flex items-center gap-2">
                                            <span>Product</span>
                                            {productStatusToggleEnabled ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFilterStatus((prev) => (prev === 'inactive' ? 'active' : 'inactive'));
                                                    setPage(1);
                                                }}
                                                className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                                title={filterStatus === 'inactive' ? 'Showing hidden products' : 'Showing active products'}
                                                aria-label={filterStatus === 'inactive' ? 'Showing hidden products' : 'Showing active products'}
                                            >
                                                {filterStatus === 'inactive' ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                            ) : null}
                                        </div>
                                    </th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Price</th>
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        <div className="inline-flex items-center gap-2">
                                            <span>Stock</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFilterStock((prev) => getNextStockFilter(prev));
                                                    setPage(1);
                                                }}
                                                className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                                title={getStockFilterLabel(filterStock)}
                                                aria-label={getStockFilterLabel(filterStock)}
                                            >
                                                {(() => {
                                                    const StockIcon = getStockFilterIcon(filterStock);
                                                    return <StockIcon size={14} />;
                                                })()}
                                            </button>
                                        </div>
                                    </th>
                                    {productStatusToggleEnabled ? (
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                            Status
                                        </th>
                                    ) : null}
                                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {paginatedProducts.map((product) => {
                                    // --- 1. ROBUST PRICE DISPLAY ---
                                    let priceDisplay;
                                    if (product.variants && product.variants.length > 1) { // FIX: Only range if >1 variant
                                        const prices = product.variants.map(v => Number(v.discount_price || v.price || 0));
                                        const minPrice = Math.min(...prices);
                                        const maxPrice = Math.max(...prices);
                                        priceDisplay = minPrice === maxPrice 
                                            ? `₹${minPrice}` 
                                            : `₹${minPrice} - ₹${maxPrice}`;
                                    } else {
                                        priceDisplay = `₹${product.discount_price || product.mrp}`;
                                    }

                                    // --- 2. ROBUST TRACKING CHECK ---
                                    const isTracked = isTrackedStock(product);
                                    const stockBadge = getStockBadgeMeta(product);
                                    const StockBadgeIcon = stockBadge.icon;

                                    // --- 3. STOCK DISPLAY LOGIC ---
                                    let stockDisplay = null;
                                    if (inventoryTrackingEnabled && product.variants && product.variants.length > 0) {
                                        const isAnyVariantTracked = product.variants.some(v => String(v.track_quantity) === '1' || String(v.track_quantity) === 'true' || v.track_quantity === true);
                                        
                                        if (isAnyVariantTracked) {
                                            const totalStock = product.variants.reduce((sum, v) => {
                                                const vTracked = String(v.track_quantity) === '1' || String(v.track_quantity) === 'true' || v.track_quantity === true;
                                                return sum + (vTracked ? (Number(v.quantity) || 0) : 0);
                                            }, 0);
                                            stockDisplay = (
                                                <div className="text-sm font-medium text-gray-600">
                                                    {totalStock} units <span className="text-xs text-gray-400">(Total)</span>
                                                </div>
                                            );
                                        } else {
                                            stockDisplay = (
                                                <div className="flex items-center gap-1 text-gray-400">
                                                    <InfinityIcon size={18} /> <span className="text-xs">Unlimited</span>
                                                </div>
                                            );
                                        }
                                    } else if (inventoryTrackingEnabled) {
                                        // Single Product
                                        stockDisplay = isTracked ? (
                                            <div className={`text-sm font-medium ${product.quantity <= (product.low_stock_threshold || 0) ? 'text-red-500' : 'text-gray-600'}`}>
                                                {product.quantity} units
                                            </div>
                                        ) : null;
                                    }

                                    // --- 4. ROW CLASSES (Grayscale) ---
                                    const isInactive = product.status !== 'active';
                                    const rowClasses = isInactive 
                                        ? "hover:bg-gray-50/50 transition-colors group grayscale opacity-75 bg-gray-50" 
                                        : "hover:bg-gray-50/50 transition-colors group";

                                    return (
                                        <tr key={product.id} className={rowClasses}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0 border border-gray-200">
                                                        {product.media && product.media.find(m => m.type === 'image') ? (
                                                            <img src={product.media.find(m => m.type === 'image').url} className="w-full h-full object-cover" alt="" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-gray-300"><Package size={20}/></div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h3 className="font-bold text-gray-800 text-sm">{product.title}</h3>
                                                        <p className="text-xs text-gray-500 line-clamp-1 max-w-[200px]">{product.sku || 'No SKU'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900">{priceDisplay}</span>
                                                </div>
                                            </td>
                                            
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-2">
                                                    {stockDisplay}
                                                    <span className={`inline-flex w-fit items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${stockBadge.classes}`}>
                                                        <StockBadgeIcon size={12} />
                                                        {stockBadge.label}
                                                    </span>
                                                </div>
                                            </td>
                                            
                                            {productStatusToggleEnabled ? (
                                            <td className="px-6 py-4">
                                                {(
                                                    product.status === 'active' ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700"><Eye size={12}/> Active</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"><EyeOff size={12}/> Hidden</span>
                                                    )
                                                )}
                                            </td>
                                            ) : null}
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-2 opacity-100">
                                                    <button
                                                        onClick={() => openEditModal(product)}
                                                        className="rounded-xl border border-amber-100 bg-gradient-to-br from-white to-amber-50/80 p-2 text-amber-700 shadow-sm shadow-amber-100/40 transition-colors hover:from-amber-50 hover:to-amber-100"
                                                    >
                                                        <Edit3 size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => initiateDelete(product)}
                                                        className="rounded-xl border border-rose-100 bg-gradient-to-br from-white to-rose-50/80 p-2 text-rose-600 shadow-sm shadow-rose-100/40 transition-colors hover:from-rose-50 hover:to-rose-100"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    {/* --- PAGINATION --- */}
                     {filteredProducts.length > 0 && (
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-6 border-t border-gray-200 mt-4 overflow-x-hidden">
                            <p className="text-sm text-gray-500 font-medium order-2 md:order-1">
                                Page <span className="text-primary font-bold">{page}</span> of {totalPages}
                            </p>
                            <div className="flex max-w-full flex-wrap items-center justify-center gap-2 order-1 md:order-2">
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 text-xs md:text-sm font-bold bg-gray-50">
                                    <ChevronLeft size={18} /> Prev
                                </button>
                                {visiblePages.map((pageNo) => (
                                    <button
                                        key={pageNo}
                                        onClick={() => setPage(pageNo)}
                                        className={`min-w-9 px-3 py-2 border rounded-lg text-xs md:text-sm font-bold ${
                                            pageNo === page
                                                ? 'border-primary bg-primary text-accent'
                                                : 'border-gray-200 hover:bg-white bg-gray-50 text-gray-600'
                                        }`}
                                    >
                                        {pageNo}
                                    </button>
                                ))}
                                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg hover:bg-white disabled:opacity-50 text-xs md:text-sm font-bold bg-gray-50">
                                    Next <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            ) : isDownloading ? (
                <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
                    <Loader2 className="animate-spin text-accent w-4 h-4 mr-2" />
                    Syncing products in background...
                </div>
            ) : filterCategory && allProducts.length > 0 ? (
                <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
                    <img
                        src={emptyIllustration}
                        alt="No matching products"
                        className="w-36 h-36 object-contain opacity-85 mb-4"
                    />
                    <h3 className="text-xl font-bold text-gray-800 mb-2">No matching products</h3>
                    <p className="text-gray-500 text-center max-w-md mb-6">
                        Try adjusting filters or search terms to see results.
                    </p>
                    <button
                        onClick={() => { setFilterStatus('all'); setFilterStock('all'); setFilterUsageAudience(''); setSearchTerm(''); setPage(1); }}
                        className="bg-primary hover:bg-primary-light text-accent font-bold px-6 py-3 rounded-xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        Reset Filters
                    </button>
                </div>
            ) : (// --- EMPTY STATE ILLUSTRATION ---
                <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
                    <img 
                        src="/product_add.svg" 
                        alt="No products" 
                        className="w-48 h-48 md:w-64 md:h-64 mb-6 opacity-90"
                    />
                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                        {categories.length ? 'No products in selected category' : 'No categories available yet'}
                    </h3>
                    <p className="text-gray-500 text-center max-w-md mb-6">
                        {categories.length
                            ? 'Try another category or add products to this category.'
                            : 'Create categories first, then add products to manage inventory.'}
                    </p>
                    <button 
                        onClick={() => setIsAddModalOpen(true)}
                        className="bg-primary hover:bg-primary-light text-accent font-bold px-6 py-3 rounded-xl shadow-lg shadow-primary/20 flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        <Plus size={20} strokeWidth={3} />
                        <span>Add First Product</span>
                    </button>
                </div>)}

            {!isAddModalOpen && (
                <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    className="md:hidden fixed bottom-24 right-4 z-[175] inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xl shadow-emerald-600/30 hover:bg-emerald-500"
                    aria-label="Add product"
                >
                    <Plus size={22} />
                </button>
            )}
        </div>
    );
}
