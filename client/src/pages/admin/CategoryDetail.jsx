import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { productService } from '../../services/productService';
import { ArrowLeft, GripVertical, Trash2, Plus, X, Search, Loader2, Edit3, Check, Settings } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { useProducts } from '../../context/ProductContext';
// Add Modal to imports
import Modal from '../../components/Modal';
import CategoryModal from '../../components/CategoryModal';
export default function CategoryDetail({ categoryId, onBack, subCategoriesEnabled = false }) {
    const [category, setCategory] = useState(null);
    const [products, setProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Assign Modal State
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [isClient, setIsClient] = useState(false);
    const { allProducts, isDownloading, ensureAllProducts } = useProducts();
    const [assignSearch, setAssignSearch] = useState('');
    const [debouncedAssignSearch, setDebouncedAssignSearch] = useState('');
    const [selectedAssignIds, setSelectedAssignIds] = useState(new Set());
    // Custom Modal State
    const [modalConfig, setModalConfig] = useState({ 
        isOpen: false, type: 'delete', title: '', message: '', confirmText: '', targetId: null 
    });
    const [showEditModal, setShowEditModal] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [isReordering, setIsReordering] = useState(false);
    const toast = useToast();
    const isOffersCategory = String(category?.system_key || '').toLowerCase() === 'offers';
    const isNameImmutable = Boolean(category?.is_immutable);
    const isAutopilotCapable = ['best_sellers', 'new_arrivals', 'offers'].includes(String(category?.system_key || '').toLowerCase());
    const isAutopilotEnabled = isAutopilotCapable && Number(category?.autopilot_enabled || 0) === 1;

    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await productService.getCategoryDetails(categoryId);
            setCategory(data);
            setProducts(data.products || []);
        } catch {
            toast.error("Failed to load category details");
        } finally {
            setIsLoading(false);
        }
    }, [categoryId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCategoryRefresh = useCallback((payload = {}) => {
        const categoryIdStr = String(categoryId);
        const payloadCategoryId = payload?.categoryId ? String(payload.categoryId) : '';
        const payloadCategory = payload?.category?.id ? String(payload.category.id) : '';
        if (!payloadCategoryId && !payloadCategory) {
            loadData();
            return;
        }
        if (payloadCategoryId === categoryIdStr || payloadCategory === categoryIdStr) {
            loadData();
        }
    }, [categoryId, loadData]);

    const handleCategoryProductChange = useCallback((payload = {}) => {
        if (String(payload?.categoryId || '') !== String(categoryId)) return;
        loadData();
    }, [categoryId, loadData]);

    const handleAutopilotUpdate = useCallback((payload = {}) => {
        const payloadCategoryId = String(payload?.categoryId || payload?.category?.id || '');
        if (payloadCategoryId && payloadCategoryId !== String(categoryId)) return;
        if (payload?.details) {
            setCategory(payload.details);
            setProducts(Array.isArray(payload.details?.products) ? payload.details.products : []);
            return;
        }
        loadData();
    }, [categoryId, loadData]);

    useAdminCrudSync({
        'refresh:categories': handleCategoryRefresh,
        'product:category_change': handleCategoryProductChange,
        'category:autopilot_update': handleAutopilotUpdate
    });

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedAssignSearch(assignSearch.trim().toLowerCase());
        }, 120);
        return () => clearTimeout(timer);
    }, [assignSearch]);

    useEffect(() => {
        setIsClient(true);
    }, []);

    // [NEW] Handle Category Update (Name + Image)
    const handleUpdateCategory = async (name, imageFile, subCategories = []) => {
        setIsActionLoading(true);
        try {
            const formData = new FormData();
            
            const finalName = isNameImmutable ? category.name : name;

            formData.append('name', finalName);
            if (subCategoriesEnabled) {
                formData.append('subCategories', JSON.stringify(subCategories));
            }
            if (imageFile) formData.append('image', imageFile);

            await productService.updateCategory(categoryId, formData);
            
            // Refresh local data
            setCategory(prev => ({ 
                ...prev, 
                name: finalName,
                subCategories,
                image_url: imageFile ? URL.createObjectURL(imageFile) : prev.image_url 
            }));
            
            toast.success(isNameImmutable ? "Category updated (Name is immutable)" : "Category updated");
            setShowEditModal(false);
            productService.clearCache();
        } catch (error) {
            toast.error(error.message || "Update failed");
        } finally {
            setIsActionLoading(false);
        }
    };

    // --- DRAG AND DROP HANDLERS ---
    const handleDragStart = (index) => {
        if (isAutopilotEnabled) return;
        setDraggedIndex(index);
    };

    const handleDragOver = (e, index) => {
        if (isAutopilotEnabled) return;
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;
        
        // Reorder locally
        const newProducts = [...products];
        const draggedItem = newProducts[draggedIndex];
        newProducts.splice(draggedIndex, 1);
        newProducts.splice(index, 0, draggedItem);
        
        setDraggedIndex(index);
        setProducts(newProducts);
    };

    const handleDragEnd = async () => {
        if (isAutopilotEnabled) return;
        setDraggedIndex(null);
        // Save new order to backend
        try {
            setIsReordering(true);
            const productIds = products.map(p => p.id);
            await productService.reorderCategory(categoryId, productIds);
            // toast.success("Order saved"); // Optional: Silent save is better UX
        } catch {
            toast.error("Failed to save order");
            await loadData();
        } finally {
            setIsReordering(false);
        }
    };

   // A. Open Remove Modal
    const openRemoveModal = (product) => {
        if (isAutopilotEnabled) {
            toast.error("Auto-pilot is enabled. Turn it off to manage products manually.");
            return;
        }
        setModalConfig({
            isOpen: true,
            type: 'delete',
            title: 'Remove Product?',
            message: `Are you sure you want to remove "${product.title}" from this category?`,
            confirmText: 'Remove',
            targetId: product.id
        });
    };

    // B. Handle Confirmation (Actual Logic)
    const handleModalConfirm = async () => {
        setIsActionLoading(true);
        try {
            if (modalConfig.type === 'delete') {
                // Call API
                await productService.manageCategoryProduct(categoryId, modalConfig.targetId, 'remove');
                
                // Update UI State
                setProducts(prev => prev.filter(p => p.id !== modalConfig.targetId));
                toast.success("Product removed");
                
                // Sync Cache
                productService.clearCache();
            }
            // Close Modal
            setModalConfig({ ...modalConfig, isOpen: false });
        } catch {
            toast.error("Failed to remove product");
        } finally {
            setIsActionLoading(false);
        }
    };

    // --- ASSIGN PRODUCTS ---
    const openAssignModal = async () => {
        setIsAssignModalOpen(true);
        ensureAllProducts();
    };

    const closeAssignModal = () => {
        setIsAssignModalOpen(false);
        setAssignSearch('');
        setSelectedAssignIds(new Set());
    };

    const toggleAssignSelection = (productId) => {
        setSelectedAssignIds(prev => {
            const next = new Set(prev);
            if (next.has(productId)) {
                next.delete(productId);
            } else {
                next.add(productId);
            }
            return next;
        });
    };

    const handleAssignSubmit = async () => {
        if (isAutopilotEnabled) {
            toast.error("Auto-pilot is enabled. Turn it off to manage products manually.");
            return;
        }
        if (selectedAssignIds.size === 0) {
            toast.error("Select at least one product");
            return;
        }
        setIsActionLoading(true);
        try {
            await productService.manageCategoryProductsBulk(categoryId, Array.from(selectedAssignIds), 'add');
            toast.success("Products added");
            productService.clearCache();
            await loadData();
            closeAssignModal();
        } catch {
            toast.error("Failed to add products");
        } finally {
            setIsActionLoading(false);
        }
    };
   
    const assignedProductIds = useMemo(
        () => new Set(products.map((item) => String(item.id))),
        [products]
    );

    const searchableProducts = useMemo(() => (
        allProducts.map((p) => ({
            ...p,
            __search: `${String(p.title || '').toLowerCase()} ${String(p.sku || '').toLowerCase()}`
        }))
    ), [allProducts]);

    const assignableProducts = useMemo(() => {
        return searchableProducts
            .filter((p) => !assignedProductIds.has(String(p.id)))
            .filter((p) => (debouncedAssignSearch ? p.__search.includes(debouncedAssignSearch) : true));
    }, [searchableProducts, assignedProductIds, debouncedAssignSearch]);

    const filteredAssignableIds = useMemo(
        () => assignableProducts.map((p) => p.id),
        [assignableProducts]
    );

    const allFilteredSelected = useMemo(
        () => filteredAssignableIds.length > 0 && filteredAssignableIds.every((id) => selectedAssignIds.has(id)),
        [filteredAssignableIds, selectedAssignIds]
    );

    const toggleSelectAllFiltered = () => {
        setSelectedAssignIds((prev) => {
            const next = new Set(prev);
            if (allFilteredSelected) {
                filteredAssignableIds.forEach((id) => next.delete(id));
            } else {
                filteredAssignableIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const handleAutopilotToggle = async () => {
        if (!category?.id || !isAutopilotCapable || isActionLoading) return;
        setIsActionLoading(true);
        try {
            const nextEnabled = !isAutopilotEnabled;
            await productService.updateCategoryAutopilot(category.id, nextEnabled);
            await loadData();
            toast.success(nextEnabled ? 'Auto-pilot enabled' : 'Auto-pilot disabled');
        } catch (error) {
            toast.error(error.message || 'Failed to update category auto-pilot');
        } finally {
            setIsActionLoading(false);
        }
    };
   

    if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent w-10 h-10" /></div>;

    return (
        <div className="animate-fade-in space-y-6">
            {/* 1. Render Custom Modal */}
            {/* [NEW] Edit Modal */}
            <CategoryModal 
                isOpen={showEditModal}
                onClose={() => setShowEditModal(false)}
                onConfirm={handleUpdateCategory}
                isLoading={isActionLoading}
                disableNameEdit={isNameImmutable}
                initialData={category} // Pre-fill data
                subCategoriesEnabled={subCategoriesEnabled}
            />
            <Modal 
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onConfirm={handleModalConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                confirmText={modalConfig.confirmText}
                type={modalConfig.type}
                isLoading={isActionLoading}
            />
            {/* --- HEADER --- */}
            <div className="flex items-center gap-4 border-b border-gray-200 pb-4">
                <button onClick={onBack} className="p-2 hover:bg-white rounded-lg text-gray-500 transition-colors">
                    <ArrowLeft size={24} />
                </button>
                
                <div className="flex-1 flex items-center gap-4">
                    {/* [NEW] Header Image */}
                    <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                        {category?.image_url && <img src={category.image_url} className="w-full h-full object-cover" />}
                    </div>
                    
                    <div>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Category</p>
                        <div className="flex items-center gap-3 group">
                            <h1 className="text-3xl font-serif font-bold text-gray-800">{category?.name}</h1>
                            <button 
                                onClick={() => setShowEditModal(true)}
                                className="p-1.5 rounded-lg bg-gray-50 text-gray-400 hover:text-primary hover:bg-white border border-transparent hover:border-gray-200 transition-all"
                            >
                                <Edit3 size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {subCategoriesEnabled && (
                        <button
                            type="button"
                            onClick={() => setShowEditModal(true)}
                            className="bg-white border border-gray-200 text-gray-700 font-bold px-4 py-2 rounded-lg flex items-center gap-2 hover:border-primary hover:text-primary transition-colors"
                        >
                            <Settings size={16} />
                            Settings
                        </button>
                    )}
                    {isAutopilotCapable && (
                        <button
                            onClick={handleAutopilotToggle}
                            disabled={isActionLoading}
                            className={`font-bold px-4 py-2 rounded-lg border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                isAutopilotEnabled
                                    ? 'bg-primary text-white border-primary hover:bg-primary/90'
                                    : 'bg-white border-gray-200 text-primary hover:border-primary'
                            }`}
                        >
                            Auto-Pilot {isAutopilotEnabled ? 'On' : 'Off'}
                        </button>
                    )}
                    <button
                        onClick={openAssignModal}
                        disabled={isAutopilotEnabled}
                        className="bg-white border border-gray-200 text-primary font-bold px-4 py-2 rounded-lg flex items-center gap-2 hover:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Plus size={18} /> Assign products
                    </button>
                </div>
            </div>

            {/* --- PRODUCT GRID (DRAG & DROP) --- */}
            <div className="space-y-4">
                <p className="text-sm text-gray-500">
                    {isAutopilotEnabled
                        ? 'Auto-pilot is currently curating this category. Disable it to return to manual assignment and ordering.'
                        : 'Use drag & drop to change the order of products. Changes are saved automatically.'}
                </p>
                {isReordering && (
                    <p className="text-xs text-gray-400">
                        Saving order...
                    </p>
                )}
                {isAutopilotCapable && (
                    <p className={`text-xs rounded-lg px-3 py-2 border ${
                        isAutopilotEnabled
                            ? 'text-primary bg-blue-50 border-blue-200'
                            : 'text-gray-600 bg-gray-50 border-gray-200'
                    }`}>
                        {isAutopilotEnabled
                            ? 'Auto-pilot refreshes this system category roughly every 3 days using native signals plus smart rotation. Your manual assignments and ordering are preserved underneath and will return when Auto-Pilot is turned off.'
                            : 'Auto-pilot is off. This system category is currently using the normal manual assignment and ordering workflow.'}
                    </p>
                )}
                {isOffersCategory && !isAutopilotEnabled && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        Offers is currently in manual mode. Auto-Pilot can be enabled any time to switch back to discount-led smart curation.
                    </p>
                )}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {products.map((product, index) => (
                        <div 
                            key={product.id}
                            draggable={!isAutopilotEnabled}
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragEnd={handleDragEnd}
                            className={`bg-white rounded-xl border border-gray-200 p-3 shadow-sm flex flex-col gap-3 group transition-all 
                            ${draggedIndex === index ? 'opacity-50 scale-95 border-accent' : 'hover:shadow-md'}`}
                        >
                            <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden">
                                {product.media && product.media[0] ? (
                                    <img src={product.media[0].url} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-300">No Image</div>
                                )}
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!isAutopilotEnabled && (
                                        <button 
                                            onClick={() => openRemoveModal(product)}
                                            className="p-1.5 bg-white text-red-500 rounded-md shadow-sm hover:bg-red-50"
                                            title="Remove from category"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                                <div className={`absolute top-2 left-2 p-1 bg-white/80 rounded backdrop-blur-sm text-gray-500 ${
                                    isAutopilotEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'
                                }`}>
                                    <GripVertical size={14} />
                                </div>
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{product.title}</h4>
                                <p className="text-xs text-gray-500">{product.sku}</p>
                            </div>
                        </div>
                    ))}
                    {products.length === 0 && (
                        <div className="col-span-full py-12 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-400">
                            No products in this category yet.
                        </div>
                    )}
                </div>
            </div>

            {/* --- ASSIGN MODAL --- */}
            {isAssignModalOpen && isClient && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl p-6 space-y-4 animate-in zoom-in-95">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-bold font-serif text-gray-800">Assign Products</h3>
                            <button onClick={closeAssignModal}><X size={20} className="text-gray-400" /></button>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-gray-400 w-4 h-4" />
                            <input 
                                value={assignSearch} 
                                onChange={e => setAssignSearch(e.target.value)}
                                placeholder="Search products..." 
                                className="w-full pl-9 p-2 rounded-lg border border-gray-200 outline-none focus:border-accent"
                                autoFocus
                            />
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                            <button
                                type="button"
                                onClick={toggleSelectAllFiltered}
                                className="px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
                            >
                                {allFilteredSelected ? 'Unselect all filtered' : 'Select all filtered'}
                            </button>
                            <span>{assignableProducts.length.toLocaleString('en-IN')} result(s)</span>
                        </div>
                        <div className="max-h-60 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                            {isDownloading && allProducts.length === 0 && (
                                <div className="flex items-center justify-center py-6 text-xs text-gray-400">
                                    <Loader2 className="animate-spin mr-2" size={14} />
                                    Loading products...
                                </div>
                            )}
                            {!isDownloading && assignableProducts.length === 0 && (
                                <div className="text-center text-xs text-gray-400 py-6">
                                    No matching products.
                                </div>
                            )}
                            {assignableProducts.map(product => {
                                const isSelected = selectedAssignIds.has(product.id);
                                return (
                                    <button 
                                        key={product.id} 
                                        onClick={() => toggleAssignSelection(product.id)}
                                        className="w-full flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors text-left"
                                    >
                                        <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden shrink-0">
                                            {product.media && product.media[0] && <img src={product.media[0].url} className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-gray-800 line-clamp-1">{product.title}</p>
                                            <p className="text-xs text-gray-500">{product.sku}</p>
                                        </div>
                                        {isSelected ? (
                                            <Check size={18} className="text-green-500 shrink-0" />
                                        ) : (
                                            <Plus size={16} className="text-gray-400 shrink-0" />
                                        )}
                                    </button>
                                );
                            })
                            }
                        </div>
                        <div className="flex items-center justify-between gap-3 pt-2">
                            <p className="text-xs text-gray-500">
                                {selectedAssignIds.size} selected
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={closeAssignModal}
                                    className="px-4 py-2 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
                                    type="button"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAssignSubmit}
                                    disabled={isActionLoading}
                                    className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                                    type="button"
                                >
                                    {isActionLoading ? 'Assigning...' : 'Assign Selected'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            , document.body)}
        </div>
    );
}

// Helper Icon
function PencilIcon(props) {
    return (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
    );
}
