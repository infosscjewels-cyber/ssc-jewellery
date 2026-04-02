const Product = require('../models/Product');
const CompanyProfile = require('../models/CompanyProfile');
const fs = require('fs');
const path = require('path');
const {
    queueCategoryDelete,
    queueCategoryRefresh,
    queueProductDelete,
    queueProductRefresh
} = require('../services/seoService');
const { refreshEnabledCategoryAutopilotCatalogs } = require('../services/categoryAutopilotService');

// --- Helper to parse JSON safely ---
const safeParse = (data, fallback = []) => {
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        return parsed == null ? fallback : parsed;
    } catch {
        return fallback;
    }
};
const asArray = (value, { allowSingleString = false } = {}) => {
    const parsed = safeParse(value, []);
    if (Array.isArray(parsed)) return parsed;
    if (allowSingleString && typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    return [];
};
const asObject = (value) => {
    const parsed = safeParse(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
const asString = (value = '') => String(value || '').trim();
const ALLOWED_POLISH_WARRANTY_MONTHS = [6, 7, 8, 9, 12];
const normalizePolishWarrantyMonths = (value) => {
    const parsed = Number(value);
    const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 6;
    return ALLOWED_POLISH_WARRANTY_MONTHS.includes(rounded) ? rounded : 6;
};
const normalizeVideoType = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'youtube' || raw === 'instagram') return raw;
    return '';
};
const normalizeUsageAudience = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    return ['men', 'women', 'kids'].includes(raw) ? raw : '';
};
const normalizeSubCategory = (value = '') => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
const normalizeSubCategoryList = (value = []) => {
    const parsed = safeParse(value, []);
    const input = Array.isArray(parsed) ? parsed : (Array.isArray(value) ? value : []);
    return [...new Set(
        input
            .map((entry) => normalizeSubCategory(entry))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
};

const normalizeVariantForPublic = (variant = {}) => {
    const tracked = variant.track_quantity === 1 || variant.track_quantity === true || variant.track_quantity === '1' || variant.track_quantity === 'true';
    const forcedOutOfStock = variant.force_out_of_stock === 1 || variant.force_out_of_stock === true || variant.force_out_of_stock === '1' || variant.force_out_of_stock === 'true';
    const trackLowStock = variant.track_low_stock === 1 || variant.track_low_stock === true || variant.track_low_stock === '1' || variant.track_low_stock === 'true';
    const quantity = Number(variant.quantity || 0);
    const lowStockThreshold = Number(variant.low_stock_threshold || 0);
    const hasStock = !forcedOutOfStock && (!tracked || Number(variant.quantity || 0) > 0);
    const isLowStock = tracked && trackLowStock && quantity > 0 && quantity <= lowStockThreshold;
    return {
        id: variant.id,
        variant_title: variant.variant_title,
        price: variant.price,
        discount_price: variant.discount_price,
        sku: variant.sku,
        weight_kg: variant.weight_kg,
        force_out_of_stock: forcedOutOfStock ? 1 : 0,
        available_quantity: tracked ? quantity : 0,
        quantity: tracked ? (isLowStock ? quantity : (hasStock ? 1 : 0)) : 0,
        track_quantity: tracked ? 1 : 0,
        track_low_stock: trackLowStock ? 1 : 0,
        low_stock_threshold: trackLowStock ? lowStockThreshold : 0,
        image_url: variant.image_url
    };
};

const serializePublicProduct = (product = {}) => {
    const tracked = product.track_quantity === 1 || product.track_quantity === true || product.track_quantity === '1' || product.track_quantity === 'true';
    const forcedOutOfStock = product.force_out_of_stock === 1 || product.force_out_of_stock === true || product.force_out_of_stock === '1' || product.force_out_of_stock === 'true';
    const trackLowStock = product.track_low_stock === 1 || product.track_low_stock === true || product.track_low_stock === '1' || product.track_low_stock === 'true';
    const quantity = Number(product.quantity || 0);
    const lowStockThreshold = Number(product.low_stock_threshold || 0);
    const hasStock = !forcedOutOfStock && (!tracked || quantity > 0);
    const isLowStock = tracked && trackLowStock && quantity > 0 && quantity <= lowStockThreshold;
    const categories = safeParse(product.categories, []);
    return {
        id: product.id,
        title: product.title,
        subtitle: product.subtitle,
        description: product.description,
        mrp: product.mrp,
        discount_price: product.discount_price,
        ribbon_tag: product.ribbon_tag,
        sku: product.sku,
        weight_kg: product.weight_kg,
        status: product.status,
        media: safeParse(product.media, []),
        categories,
        usageAudience: normalizeUsageAudience(product.usageAudience || product.usage_audience),
        subCategory: normalizeSubCategory(product.subCategory || product.sub_category),
        related_products: Product.normalizeRelatedProductsConfig(product.related_products, categories),
        additional_info: safeParse(product.additional_info, []),
        polish_warranty_months: product.polish_warranty_months,
        options: safeParse(product.options, []),
        force_out_of_stock: forcedOutOfStock ? 1 : 0,
        available_quantity: tracked ? quantity : 0,
        quantity: tracked ? (isLowStock ? quantity : (hasStock ? 1 : 0)) : 0,
        track_quantity: tracked ? 1 : 0,
        track_low_stock: trackLowStock ? 1 : 0,
        low_stock_threshold: trackLowStock ? lowStockThreshold : 0,
        variants: Array.isArray(product.variants) ? product.variants.map(normalizeVariantForPublic) : []
    };
};

const canViewAdminProductData = (req) => {
    const role = String(req?.user?.role || '').toLowerCase();
    return role === 'admin' || role === 'staff';
};

const emitProductEvent = (req, event, product) => {
    const io = req.app.get('io');
    if (!io || !product?.id) return;
    console.log(`Event: ${event}`, `for ID: ${product.id}`);
    io.except('admin').emit(event, serializePublicProduct(product));
    io.to('admin').emit(event, product);
};

// Helper to emit event
const notifyClients = (req, event = 'refresh:categories', payload = {}) => {
    const io = req.app.get('io');
    console.log(`Event: ${event}`, payload.id ? `for ID: ${payload.id}` : '');
    io.emit(event, payload);
};

const emitProductUpdatesForIds = async (req, productIds = []) => {
    const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    for (const productId of ids) {
        const product = await Product.findById(productId);
        if (!product) continue;
        emitProductEvent(req, 'product:update', product);
    }
};

const refreshSmartCategoryCatalogs = async () => {
    try {
        await refreshEnabledCategoryAutopilotCatalogs({
            force: true,
            staleOnly: false
        });
    } catch (error) {
        console.error('Forced smart-category autopilot refresh failed:', error?.message || error);
    }
};

const validateManagedSubCategory = async ({ categories = [], subCategory = '' } = {}) => {
    const normalizedSubCategory = normalizeSubCategory(subCategory);
    if (!normalizedSubCategory) return '';
    if (!Array.isArray(categories) || categories.length === 0) return '';
    const suggestions = await Product.getSubCategorySuggestionsByCategoryNames(categories);
    const allowed = suggestions.some(
        (entry) => String(entry || '').trim().toLowerCase() === normalizedSubCategory.toLowerCase()
    );
    if (!allowed) {
        throw new Error('Selected sub category is not managed under the chosen categories');
    }
    return normalizedSubCategory;
};
// --- 1. LIST PRODUCTS ---
const getProducts = async (req, res) => {
    try {
        const companyProfile = await CompanyProfile.get();
        const subCategoriesEnabled = companyProfile?.subCategoriesEnabled === true;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const category = req.query.category || 'all';
        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
        const usageAudience = normalizeUsageAudience(req.query.usageAudience || '');
        const subCategory = subCategoriesEnabled ? normalizeSubCategory(req.query.subCategory || '') : '';
        
        // Staff sees only Active? (Optional requirement, usually Staff sees all too)
        const status = req.query.status || 'all'; 
        const sort = req.query.sort || 'newest';

        const resolvedStatus = canViewAdminProductData(req) ? status : 'active';
        const viewerKey = req?.user?.id ? String(req.user.id) : 'guest';
        const result = await Product.getPaginated(page, limit, category, resolvedStatus, sort, categoryId, usageAudience, viewerKey, subCategory, subCategoriesEnabled);
        if (!canViewAdminProductData(req)) {
            result.products = (result.products || []).filter((product) => String(product.status || '').toLowerCase() === 'active').map(serializePublicProduct);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

const searchProducts = async (req, res) => {
    try {
        const companyProfile = await CompanyProfile.get();
        const subCategoriesEnabled = companyProfile?.subCategoriesEnabled === true;
        const query = String(req.query.q || '').trim();
        if (!query) {
            return res.json({ products: [], total: 0, totalPages: 0, page: 1, limit: 0 });
        }

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 40;
        const category = String(req.query.category || 'all');
        const status = String(req.query.status || 'active');
        const sort = String(req.query.sort || 'relevance');
        const usageAudience = normalizeUsageAudience(req.query.usageAudience || '');
        const subCategory = subCategoriesEnabled ? normalizeSubCategory(req.query.subCategory || '') : '';
        const inStockOnly = String(req.query.inStockOnly || 'false') === 'true';
        const minPrice = req.query.minPrice ?? null;
        const maxPrice = req.query.maxPrice ?? null;

        const resolvedStatus = canViewAdminProductData(req) ? status : 'active';
        const result = await Product.searchPaginated({
            query,
            page,
            limit,
            category,
            status: resolvedStatus,
            sort,
            usageAudience,
            subCategory,
            subCategoriesEnabled,
            inStockOnly,
            minPrice,
            maxPrice
        });
        if (!canViewAdminProductData(req)) {
            result.products = (result.products || []).filter((product) => String(product.status || '').toLowerCase() === 'active').map(serializePublicProduct);
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Search failed', error: error.message });
    }
};

// --- [NEW] GET SINGLE PRODUCT ---
const getSingleProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        if (!canViewAdminProductData(req) && String(product.status || '').toLowerCase() !== 'active') {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Safely parse JSON fields (Handles cases where DB returns stringified JSON)
        product.media = safeParse(product.media, []);
        product.categories = safeParse(product.categories, []);
        product.related_products = safeParse(product.related_products, {});
        product.additional_info = safeParse(product.additional_info, []);
        product.options = safeParse(product.options, []);
        product.variant_options = safeParse(product.variant_options, {});
        
        // Ensure variants are attached (Assuming Model joins them, otherwise they might need parsing)
        if (product.variants) {
             product.variants = product.variants.map(v => ({
                 ...v,
                 variant_options: safeParse(v.variant_options, {})
             }));
        }

        res.json(canViewAdminProductData(req) ? product : serializePublicProduct(product));
    } catch (error) {
        console.error("Get Single Product Error:", error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// --- 2. CREATE PRODUCT ---
const createProduct = async (req, res) => {
    try {
        const companyProfile = await CompanyProfile.get();
        const media = [];
        if (Array.isArray(req.files)) {
            req.files.forEach(file => media.push({ type: 'image', url: `/uploads/products/${file.filename}` }));
        }
        asArray(req.body.youtubeLinks, { allowSingleString: true }).forEach((link) => {
            const url = asString(link);
            if (!url) return;
            media.push({ type: 'youtube', url });
        });
        asArray(req.body.videoLinks).forEach((entry) => {
            if (!entry || typeof entry !== 'object') return;
                const type = normalizeVideoType(entry?.type);
                const url = asString(entry?.url);
                if (!type || !url) return;
                media.push({ type, url });
            });

        const productData = {
            ...req.body,
            polish_warranty_months: normalizePolishWarrantyMonths(req.body.polish_warranty_months),
            tax_config_id: Number.isFinite(Number(req.body.tax_config_id)) && Number(req.body.tax_config_id) > 0
                ? Number(req.body.tax_config_id)
                : null,
            track_quantity: req.body.track_quantity === 'true' || req.body.track_quantity === true ? 1 : 0,
            quantity: req.body.quantity || 0,
            force_out_of_stock: req.body.force_out_of_stock === 'true' || req.body.force_out_of_stock === true ? 1 : 0,
            track_low_stock: req.body.track_low_stock === 'true' || req.body.track_low_stock === true ? 1 : 0,
            low_stock_threshold: req.body.low_stock_threshold || 0,
            media: media,
            categories: asArray(req.body.categories, { allowSingleString: true }),
            usageAudience: normalizeUsageAudience(req.body.usageAudience || ''),
            subCategory: '',
            related_products: Product.normalizeRelatedProductsConfig(
                asObject(req.body.related_products),
                asArray(req.body.categories, { allowSingleString: true })
            ),
            additional_info: asArray(req.body.additional_info),
            options: asArray(req.body.options),
            variants: asArray(req.body.variants)
        };
        if (companyProfile?.usageAudienceEnabled && !productData.usageAudience) {
            return res.status(400).json({ message: 'Usage Audience is required when usage audience classification is enabled' });
        }
        if (companyProfile?.subCategoriesEnabled === true) {
            productData.subCategory = await validateManagedSubCategory({
                categories: productData.categories,
                subCategory: req.body.subCategory || ''
            });
        } else {
            productData.subCategory = normalizeSubCategory(req.body.subCategory || '');
        }

        const newProduct = await Product.create(productData);
        const createdProduct = await Product.findById(newProduct.id);
        await refreshSmartCategoryCatalogs();
        emitProductEvent(req, 'product:create', createdProduct || newProduct);
        notifyClients(req, 'refresh:categories', { action: 'sync_all' });
        queueProductRefresh({
            productId: newProduct.id,
            categoryNames: asArray(productData.categories, { allowSingleString: true }),
            reason: 'product_create'
        });
        res.status(201).json(newProduct);
    } catch (error) {
        console.error("Create Error:", error);
        const status = String(error.message || '').toLowerCase().includes('selected sub category') ? 400 : 500;
        res.status(status).json({ message: status === 400 ? error.message : 'Create Failed', error: error.message });
    }
};
// --- 3. DELETE PRODUCT ---
const deleteProduct = async (req, res) => {
    try {
        const existingProduct = await Product.findById(req.params.id).catch(() => null);
        const existingCategories = asArray(existingProduct?.categories, { allowSingleString: true });
        await Product.delete(req.params.id);
        await refreshSmartCategoryCatalogs();
        notifyClients(req, 'product:delete', { id: req.params.id }); // [NEW] Notify Sync
        notifyClients(req, 'refresh:categories', { action: 'sync_all' });
        queueProductDelete({
            productId: req.params.id,
            categoryNames: existingCategories,
            reason: 'product_delete'
        });
        res.json({ message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Delete Failed' });
    }
};

// --- 4. UPDATE PRODUCT ---
const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const companyProfile = await CompanyProfile.get();
        const existingProduct = await Product.findById(id).catch(() => null);
        const previousCategories = asArray(existingProduct?.categories, { allowSingleString: true });
        
        // Media Logic
        const newImages = [];
        if (Array.isArray(req.files)) {
            req.files.forEach(file => newImages.push({ type: 'image', url: `/uploads/products/${file.filename}` }));
        }
        const newYoutube = asArray(req.body.youtubeLinks, { allowSingleString: true }).reduce((acc, link) => {
            const url = asString(link);
            if (!url) return acc;
            acc.push({ type: 'youtube', url });
            return acc;
        }, []);
        const newVideoLinks = asArray(req.body.videoLinks).reduce((acc, entry) => {
            if (!entry || typeof entry !== 'object') return acc;
            const type = normalizeVideoType(entry?.type);
            const url = asString(entry?.url);
            if (!type || !url) return acc;
            acc.push({ type, url });
            return acc;
        }, []);
        const existingMedia = asArray(req.body.existingMedia)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                type: normalizeVideoType(entry.type) || 'image',
                url: asString(entry.url)
            }))
            .filter((entry) => entry.url);
        const finalMedia = [...existingMedia, ...newImages, ...newYoutube, ...newVideoLinks];

        const productData = {
            title: req.body.title,
            subtitle: req.body.subtitle || null,
            description: req.body.description || null,
            mrp: req.body.mrp,
            discount_price: req.body.discount_price || null,
            ribbon_tag: req.body.ribbon_tag || null,
            sku: req.body.sku || null,
            weight_kg: req.body.weight_kg || null,
            status: req.body.status || 'active',
            polish_warranty_months: normalizePolishWarrantyMonths(req.body.polish_warranty_months),
            tax_config_id: Number.isFinite(Number(req.body.tax_config_id)) && Number(req.body.tax_config_id) > 0
                ? Number(req.body.tax_config_id)
                : null,
            
            track_quantity: req.body.track_quantity === 'true' || req.body.track_quantity === true ? 1 : 0,
            quantity: req.body.quantity || 0,
            force_out_of_stock: req.body.force_out_of_stock === 'true' || req.body.force_out_of_stock === true ? 1 : 0,
            track_low_stock: req.body.track_low_stock === 'true' || req.body.track_low_stock === true ? 1 : 0,
            low_stock_threshold: req.body.low_stock_threshold || 0,

            media: finalMedia,
            categories: asArray(req.body.categories, { allowSingleString: true }),
            usageAudience: normalizeUsageAudience(req.body.usageAudience || existingProduct?.usageAudience || existingProduct?.usage_audience || ''),
            subCategory: '',
            related_products: Product.normalizeRelatedProductsConfig(
                asObject(req.body.related_products),
                asArray(req.body.categories, { allowSingleString: true })
            ),
            additional_info: asArray(req.body.additional_info),
            options: asArray(req.body.options),
            variants: asArray(req.body.variants)
        };
        if (companyProfile?.usageAudienceEnabled && !productData.usageAudience) {
            return res.status(400).json({ message: 'Usage Audience is required when usage audience classification is enabled' });
        }
        if (companyProfile?.subCategoriesEnabled === true) {
            productData.subCategory = await validateManagedSubCategory({
                categories: productData.categories,
                subCategory: req.body.subCategory || existingProduct?.subCategory || existingProduct?.sub_category || ''
            });
        } else {
            productData.subCategory = normalizeSubCategory(existingProduct?.subCategory || existingProduct?.sub_category || '');
        }

        await Product.update(id, productData);
        // 2. [FIX] Fetch the FRESH updated product from DB (ensures we get new Variant IDs)
        const updatedProduct = await Product.findById(id);
        await refreshSmartCategoryCatalogs();
        emitProductEvent(req, 'product:update', updatedProduct);
        notifyClients(req, 'refresh:categories', { action: 'sync_all' });
        const nextCategories = asArray(updatedProduct?.categories, { allowSingleString: true });
        queueProductRefresh({
            productId: id,
            categoryNames: [...new Set([...previousCategories, ...nextCategories])],
            reason: 'product_update'
        });
        res.json({ message: 'Product updated successfully' });
    } catch (error) {
        console.error("Update Error:", error);
        const status = String(error.message || '').toLowerCase().includes('selected sub category') ? 400 : 500;
        res.status(status).json({ message: status === 400 ? error.message : 'Update Failed', error: error.message });
    }


};

    // --- 5. GET CATEGORY LIST ---
const getCategories = async (req, res) => {
    try {
        const categories = await Product.getAllCategories({ publicOnly: !canViewAdminProductData(req) });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch categories' });
    }
}

// --- 6. CATEGORY MANAGEMENT ENDPOINTS ---

const getCategoryStats = async (req, res) => {
    try {
        const usageAudience = normalizeUsageAudience(req.query.usageAudience || '');
        const stats = await Product.getCategoriesWithStats({
            publicOnly: !canViewAdminProductData(req),
            usageAudience
        });
        res.json(stats);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching category stats' });
    }
};

const getCategoryDetails = async (req, res) => {
    try {
        const viewerKey = canViewAdminProductData(req) ? '' : (req?.user?.id ? String(req.user.id) : 'guest');
        const data = await Product.getCategoryDetails(req.params.id, { viewerKey });
        if (!data) return res.status(404).json({ message: 'Category not found' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching category details' });
    }
};

const updateCategory = async (req, res) => {
    try {
        const { name } = req.body;
        const subCategories = normalizeSubCategoryList(req.body.subCategories || []);
        const previousCategoryName = await Product.getCategoryName(req.params.id).catch(() => '');
        const imageUrl = req.file ? `/uploads/categories/${req.file.filename}` : null;
        const affectedProductIds = await Product.updateCategory(req.params.id, name, imageUrl, subCategories);
        const category = await Product.getCategoryStatsById(req.params.id);
        notifyClients(req, 'refresh:categories',{ action: 'update', category }); // [NEW] Notify Sync
        await emitProductUpdatesForIds(req, affectedProductIds);
        queueCategoryRefresh({
            categoryId: req.params.id,
            categoryName: name,
            previousCategoryName,
            affectedProductIds,
            reason: 'category_update'
        });
        res.json({ message: 'Category updated' });
    } catch (error) {
        const status = String(error.message || '').toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ message: error.message || 'Update failed' });
    }
};

const reorderCategory = async (req, res) => {
    try {
        const { productIds } = req.body; // Array of IDs in new order
        await Product.reorderCategoryProducts(req.params.id, productIds);
        // [FIX] Fetch Name to notify clients precisely
        const catName = await Product.getCategoryName(req.params.id);
        notifyClients(req, 'refresh:categories', { action: 'reorder', categoryId: req.params.id, categoryName: catName, orderedProductIds: productIds }); // [NEW] Notify Sync
        queueCategoryRefresh({
            categoryId: req.params.id,
            categoryName: catName,
            affectedProductIds: productIds,
            reason: 'category_reorder'
        });
        res.json({ message: 'Order updated' });
    } catch (error) {
        res.status(500).json({ message: 'Reorder failed' });
    }
};

const manageCategoryProduct = async (req, res) => {
    try {
        const { productId, action } = req.body; // action: 'add' or 'remove'
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!['add', 'remove'].includes(normalizedAction)) {
            return res.status(400).json({ message: 'Invalid action' });
        }
        await Product.manageCategoryProduct(req.params.id, productId, action);
        await refreshSmartCategoryCatalogs();
        // [FIX] Fetch Name
        const catName = await Product.getCategoryName(req.params.id);
        const updatedProduct = await Product.findById(productId);
        notifyClients(req, 'product:category_change', {
            id: productId,
            categoryId: req.params.id,
            categoryName: catName,
            action: normalizedAction,
            product: serializePublicProduct(updatedProduct)
        }); // [NEW] Notify Sync
        if (updatedProduct) {
            emitProductEvent(req, 'product:update', updatedProduct);
        }
        // 2. To update category stats (Jumbotron counts)
        const category = await Product.getCategoryStatsById(req.params.id);
        notifyClients(req, 'refresh:categories', { 
            action: 'count_update', 
            category
        });
        queueCategoryRefresh({
            categoryId: req.params.id,
            categoryName: catName,
            affectedProductIds: [productId],
            reason: 'category_membership'
        });
        res.json({ message: 'Success' });
    } catch (error) {
        const status = String(error.message || '').toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ message: error.message || 'Action failed' });
    }
};

const manageCategoryProductsBulk = async (req, res) => {
    try {
        const action = String(req.body?.action || '').trim().toLowerCase();
        const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
        if (!['add', 'remove'].includes(action)) {
            return res.status(400).json({ message: 'Invalid action' });
        }
        if (!productIds.length) {
            return res.status(400).json({ message: 'No products selected' });
        }

        const affectedProductIds = await Product.manageCategoryProductsBulk(req.params.id, productIds, action);
        await refreshSmartCategoryCatalogs();
        const catName = await Product.getCategoryName(req.params.id);
        notifyClients(req, 'product:category_change', {
            bulk: true,
            categoryId: req.params.id,
            categoryName: catName,
            action,
            productIds: affectedProductIds
        });
        await emitProductUpdatesForIds(req, affectedProductIds);
        const category = await Product.getCategoryStatsById(req.params.id);
        notifyClients(req, 'refresh:categories', {
            action: 'count_update',
            category
        });
        queueCategoryRefresh({
            categoryId: req.params.id,
            categoryName: catName,
            affectedProductIds,
            reason: 'category_membership_bulk'
        });
        res.json({ message: 'Success', updated: affectedProductIds.length });
    } catch (error) {
        const status = String(error.message || '').toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ message: error.message || 'Bulk action failed' });
    }
};

const createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        const subCategories = normalizeSubCategoryList(req.body.subCategories || []);
        const imageUrl = req.file ? `/uploads/categories/${req.file.filename}` : null;
        if (!name) return res.status(400).json({ message: 'Name is required' });
        
        const id = await Product.createCategory(name, imageUrl, subCategories);
        const category = await Product.getCategoryStatsById(id);
        notifyClients(req, 'refresh:categories', {action: 'create', category}); // [NEW] Notify Sync
        queueCategoryRefresh({
            categoryId: id,
            categoryName: name,
            reason: 'category_create'
        });
        res.status(201).json({ message: 'Category created' });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Create failed' });
    }
};

const deleteCategory = async (req, res) => {
    try {
        const catName = await Product.getCategoryName(req.params.id);
        const affectedProductIds = await Product.deleteCategory(req.params.id);
        notifyClients(req, 'refresh:categories',{ action: 'delete', categoryId: req.params.id, categoryName: catName }); // [NEW] Notify Sync
        await emitProductUpdatesForIds(req, affectedProductIds);
        queueCategoryDelete({
            categoryId: req.params.id,
            categoryName: catName,
            affectedProductIds,
            reason: 'category_delete'
        });
        res.json({ message: 'Category deleted' });
    } catch (error) {
        const status = String(error.message || '').toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ message: error.message || 'Delete failed' });
    }
};

const updateCategoryAutopilot = async (req, res) => {
    try {
        const enabled = req.body?.enabled === true || req.body?.enabled === 1 || String(req.body?.enabled || '').toLowerCase() === 'true';
        const category = await Product.updateCategoryAutopilot(req.params.id, enabled);
        const categoryStats = await Product.getCategoryStatsById(req.params.id);
        const categoryDetails = await Product.getCategoryDetails(req.params.id, { viewerKey: '' });
        notifyClients(req, 'refresh:categories', { action: 'autopilot', category: categoryStats });
        notifyClients(req, 'category:autopilot_update', {
            categoryId: req.params.id,
            enabled,
            category: categoryStats,
            details: categoryDetails
        });
        queueCategoryRefresh({
            categoryId: req.params.id,
            categoryName: category?.name || categoryStats?.name || '',
            reason: enabled ? 'category_autopilot_enable' : 'category_autopilot_disable'
        });
        res.json({ category: categoryStats, enabled });
    } catch (error) {
        const status = String(error.message || '').toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ message: error.message || 'Failed to update category auto-pilot' });
    }
};

module.exports = { getProducts, searchProducts, getSingleProduct, createProduct, deleteProduct, updateProduct, getCategories,
    getCategoryStats, getCategoryDetails, updateCategory, reorderCategory, manageCategoryProduct,
    manageCategoryProductsBulk, createCategory, deleteCategory, updateCategoryAutopilot, emitProductEvent,
    __test: {
        serializePublicProduct,
        canViewAdminProductData,
        emitProductEvent
    }
 };
