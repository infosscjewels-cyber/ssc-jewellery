import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { productService } from '../../services/productService';
import { adminService } from '../../services/adminService';
import { Plus, Search, Folder, ChevronRight, Loader2, Trash2, ArrowLeft, X } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import Modal from '../../components/Modal'; 
import CategoryDetail from './CategoryDetail'; // We will create this next
import CategoryModal from '../../components/CategoryModal';
import emptyIllustration from '../../assets/closed.svg';

const MOBILE_CATEGORY_CARD_THEMES = [
    {
        shell: 'border-sky-200/80 bg-gradient-to-br from-sky-50 via-white to-cyan-50 shadow-sky-100/80',
        accent: 'bg-sky-400',
        iconWrap: 'border-sky-200 bg-white text-sky-700',
        iconButton: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
        chevron: 'text-sky-400 group-hover:text-sky-700'
    },
    {
        shell: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-lime-50 shadow-emerald-100/80',
        accent: 'bg-emerald-400',
        iconWrap: 'border-emerald-200 bg-white text-emerald-700',
        iconButton: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        chevron: 'text-emerald-400 group-hover:text-emerald-700'
    },
    {
        shell: 'border-fuchsia-200/80 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50 shadow-fuchsia-100/80',
        accent: 'bg-fuchsia-400',
        iconWrap: 'border-fuchsia-200 bg-white text-fuchsia-700',
        iconButton: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100',
        chevron: 'text-fuchsia-400 group-hover:text-fuchsia-700'
    },
    {
        shell: 'border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 shadow-amber-100/80',
        accent: 'bg-amber-500',
        iconWrap: 'border-amber-200 bg-white text-amber-700',
        iconButton: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
        chevron: 'text-amber-500 group-hover:text-amber-700'
    }
];

const getMobileCategoryTheme = (index) => MOBILE_CATEGORY_CARD_THEMES[index % MOBILE_CATEGORY_CARD_THEMES.length];

export default function Categories({ onNavigate = () => {}, storefrontOpen = true }) {
    const [view, setView] = useState('list'); // 'list' or 'detail'
    const [selectedCategoryId, setSelectedCategoryId] = useState(null);
    
    const [categories, setCategories] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    // 2. Add Modal State (Copied pattern from Customers.jsx)
    const [modalConfig, setModalConfig] = useState({ 
        isOpen: false, type: 'default', title: '', message: '', targetId: null 
    });
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [subCategoriesEnabled, setSubCategoriesEnabled] = useState(false);
    const [isSubCategoryToggleSaving, setIsSubCategoryToggleSaving] = useState(false);
    const [isMobileSearchModalOpen, setIsMobileSearchModalOpen] = useState(false);
    const toast = useToast();
    const [showCreateModal, setShowCreateModal] = useState(false);
    // Load Stats
    useEffect(() => {
        if (view === 'list') loadCategories();
    }, [view]);

    useEffect(() => {
        const loadCompanyInfo = async () => {
            try {
                const data = await adminService.getCompanyInfo();
                setSubCategoriesEnabled(data?.company?.subCategoriesEnabled === true);
            } catch {
                setSubCategoriesEnabled(false);
            }
        };
        loadCompanyInfo();
    }, []);

    useAdminCrudSync({
        'refresh:categories': () => {
            if (view === 'list') loadCategories();
        },
        'company:info_update': ({ company } = {}) => {
            if (!company || typeof company !== 'object') return;
            setSubCategoriesEnabled(company.subCategoriesEnabled === true);
        }
    });

    const loadCategories = async () => {
        setIsLoading(true);
        try {
            const data = await productService.getCategoryStats(true);
            setCategories(data);
        } catch {
            toast.error("Failed to load categories");
        } finally {
            setIsLoading(false);
        }
    };

    // --- HANDLERS ---

    // [NEW] Handle Create
    const handleCreateCategory = async (name, imageFile, subCategories = []) => {
        setIsActionLoading(true);
        try {
            const formData = new FormData();
            formData.append('name', name);
            if (subCategoriesEnabled) {
                formData.append('subCategories', JSON.stringify(subCategories));
            }
            if (imageFile) formData.append('image', imageFile);

            await productService.createCategory(formData);
            toast.success("Category created successfully");
            setShowCreateModal(false);
            loadCategories();
        } catch (error) {
            toast.error(error.message || "Failed to create category");
        } finally {
            setIsActionLoading(false);
        }
    };
    
    

   // B. Open Delete Modal
    const openDeleteModal = (e, category) => {
        e.stopPropagation();
        setModalConfig({
            isOpen: true,
            type: 'delete',
            title: 'Delete Category?',
            message: `Are you sure you want to delete "${category.name}"? Products inside will be untagged, not deleted.`,
            confirmText: 'Delete', // [NEW] Overrides "Delete User"
            targetId: category.id
        });
    };

    // C. Confirm Action (Called by Modal)
    const handleModalConfirm = async () => {
        setIsActionLoading(true);
        try {
            if (modalConfig.type === 'delete') {
                await productService.deleteCategory(modalConfig.targetId);
                toast.success("Category deleted");
                loadCategories();
            }
            setModalConfig({ ...modalConfig, isOpen: false });
        } catch {
            toast.error("Action failed");
        } finally {
            setIsActionLoading(false);
        }
    };

    const openCategory = (id) => {
        setSelectedCategoryId(id);
        setView('detail');
    };

    const handleSubCategoryToggle = async (nextEnabled) => {
        setIsSubCategoryToggleSaving(true);
        try {
            const data = await adminService.updateCompanyInfo({ subCategoriesEnabled: nextEnabled });
            setSubCategoriesEnabled(data?.company?.subCategoriesEnabled === true);
            toast.success(`Sub category layer ${nextEnabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            toast.error(error.message || 'Failed to update sub category setting');
        } finally {
            setIsSubCategoryToggleSaving(false);
        }
    };

    // --- VIEW SWITCHER ---
    if (view === 'detail') {
        return <CategoryDetail categoryId={selectedCategoryId} onBack={() => setView('list')} subCategoriesEnabled={subCategoriesEnabled} />;
    }

    // --- LIST VIEW ---
    const filtered = categories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div className="animate-fade-in space-y-6">
            {/* 1. Render Custom Modal */}
            <CategoryModal 
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onConfirm={handleCreateCategory}
                isLoading={isActionLoading}
                subCategoriesEnabled={subCategoriesEnabled}
            />
            <Modal 
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onConfirm={handleModalConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                isLoading={isActionLoading}
            />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center justify-between gap-3 md:block">
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => onNavigate('products')}
                                className="inline-flex md:hidden h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm"
                                aria-label="Back to products"
                            >
                                <ArrowLeft size={18} />
                            </button>
                            <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Categories</h1>
                        </div>
                    </div>
                    <p className="text-gray-500 text-sm mt-1">Manage product organization</p>
                </div>
                <div className="hidden md:flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-3 text-sm font-semibold text-gray-700">
                        <span>Sub Categories</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={subCategoriesEnabled}
                            disabled={isSubCategoryToggleSaving}
                            onClick={() => handleSubCategoryToggle(!subCategoriesEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
                                subCategoriesEnabled ? 'bg-primary' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                    subCategoriesEnabled ? 'translate-x-5' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </label>
                    <div className="relative">
                        <Search className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                        <input 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search categories..." 
                            className="pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none w-64"
                        />
                    </div>
                    <button 
                        onClick={() => setShowCreateModal(true)} 
                        className="bg-primary hover:bg-primary-light text-accent px-4 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 transition-all"
                    >
                        <Plus size={20} strokeWidth={3} /> 
                        <span>New</span>
                    </button>
                </div>
            </div>

            <div className="md:hidden mb-3 flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={() => setIsMobileSearchModalOpen(true)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700 shadow-sm shadow-sky-100/70"
                    aria-label="Search categories"
                >
                    <Search size={17} />
                </button>
            </div>

            {isMobileSearchModalOpen && createPortal(
                <div className="fixed inset-0 z-[185] bg-black/40 backdrop-blur-sm flex items-end md:hidden">
                    <div className="w-full rounded-t-[28px] bg-white border-t border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Search Categories</h3>
                                <p className="text-xs text-gray-500 mt-1">Find categories by name.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsMobileSearchModalOpen(false)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500"
                                aria-label="Close category search"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mt-4 relative">
                            <Search className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
                            <input
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search categories..."
                                className="w-full pl-10 pr-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm focus:border-accent outline-none"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsMobileSearchModalOpen(false)}
                            className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light"
                        >
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {/* [UPDATED] UI GRID */}
            {isLoading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent w-10 h-10" /></div>
            ) : filtered.length === 0 ? (
                <div className="py-12 flex flex-col items-center text-center">
                    <img src={emptyIllustration} alt="No categories" className="w-40 h-40 object-contain opacity-85" />
                    {categories.length === 0 ? (
                        <>
                            <h3 className="mt-3 text-lg font-semibold text-gray-700">No categories available yet</h3>
                            <p className="text-sm text-gray-500 mt-1">Create your first category to organize products.</p>
                        </>
                    ) : (
                        <>
                            <h3 className="mt-3 text-lg font-semibold text-gray-700">No matching categories</h3>
                            <p className="text-sm text-gray-500 mt-1">Try a different search keyword.</p>
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="mt-4 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Clear Search
                            </button>
                        </>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((cat, index) => {
                        const theme = getMobileCategoryTheme(index);
                        return (
                        <>
                            <div 
                                key={`${cat.id}-mobile`}
                                onClick={() => openCategory(cat.id)}
                                className={`group relative overflow-hidden rounded-2xl border p-5 shadow-sm transition-all cursor-pointer md:hidden ${theme.shell}`}
                            >
                                <div className={`absolute inset-x-0 top-0 h-1.5 ${theme.accent}`} />
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-14 h-14 rounded-xl overflow-hidden shrink-0 border ${theme.iconWrap}`}>
                                            {cat.image_url ? (
                                                <img src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-primary/40">
                                                    <Folder size={24} />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                <span>{cat.name}</span>
                                                {Boolean(cat.is_immutable) && (
                                                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                                        system
                                                    </span>
                                                )}
                                            </h3>
                                            <p className="text-sm text-gray-500">{cat.product_count} products</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!Boolean(cat.is_immutable) && (
                                            <button 
                                                onClick={(e) => openDeleteModal(e, cat)}
                                                className={`rounded-xl border p-2 transition-colors ${theme.iconButton}`}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                        <ChevronRight className={theme.chevron} />
                                    </div>
                                </div>
                            </div>
                            <div 
                                key={`${cat.id}-desktop`}
                                onClick={() => openCategory(cat.id)}
                                className="group relative hidden cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-accent hover:shadow-md md:block"
                            >
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 overflow-hidden shrink-0">
                                            {cat.image_url ? (
                                                <img src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-primary/40">
                                                    <Folder size={24} />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                <span>{cat.name}</span>
                                                {Boolean(cat.is_immutable) && (
                                                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                                                        system
                                                    </span>
                                                )}
                                            </h3>
                                            <p className="text-sm text-gray-500">{cat.product_count} products</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!Boolean(cat.is_immutable) && (
                                            <button 
                                                onClick={(e) => openDeleteModal(e, cat)}
                                                className="rounded-lg p-2 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                        <ChevronRight className="text-gray-300 group-hover:text-primary" />
                                    </div>
                                </div>
                            </div>
                        </>
                    )})}
                </div>
            )}

            {!showCreateModal && (
                <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="fixed bottom-24 right-5 z-40 md:hidden inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-2xl shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-600 active:scale-95 transition"
                    aria-label="Add category"
                >
                    <Plus size={24} strokeWidth={2.75} />
                </button>
            )}
        </div>
    );
}
