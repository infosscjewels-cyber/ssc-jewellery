const db = require('../config/db');

class Product {
    static parseJsonSafe(value, fallback = null) {
        if (value == null) return fallback;
        if (typeof value === 'object') return value;
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    static normalizeCategoryName(value) {
        return String(value || '').trim().toLowerCase();
    }

    static normalizeUsageAudience(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return ['men', 'women', 'kids'].includes(normalized) ? normalized : '';
    }

    static normalizeSubCategory(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    }

    static normalizeSubCategoryList(values = []) {
        const input = Array.isArray(values)
            ? values
            : Product.parseJsonSafe(values, []);
        return [...new Set(
            (Array.isArray(input) ? input : [])
                .map((value) => Product.normalizeSubCategory(value))
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));
    }

    static getDefaultSystemCategories() {
        return [
            { key: 'best_sellers', name: 'Best Sellers', image: '/assets/category.jpg', immutable: true },
            { key: 'new_arrivals', name: 'New Arrivals', image: '/assets/category.jpg', immutable: true },
            { key: 'offers', name: 'Offers', image: '/assets/category.jpg', immutable: true }
        ];
    }

    static isImmutableSystemKey(systemKey = '') {
        return ['best_sellers', 'new_arrivals', 'offers'].includes(String(systemKey || '').trim().toLowerCase());
    }

    static shouldExposeCategoryPublicly(category = {}) {
        if (!category || typeof category !== 'object') return false;
        if (!String(category.name || '').trim()) return false;
        if (Number(category.product_count || 0) > 0) return true;
        return Number(category.autopilot_enabled || 0) === 1 && Product.isImmutableSystemKey(category.system_key);
    }

    static async getCategoryMetaById(id, { connection = db } = {}) {
        const [rows] = await connection.execute(
            `SELECT id, name, system_key, is_immutable, autopilot_enabled, autopilot_mode, autopilot_catalog_json, autopilot_refreshed_at, subcategories_json
             FROM categories
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows[0]) return null;
        return {
            ...rows[0],
            subCategories: Product.normalizeSubCategoryList(rows[0].subcategories_json)
        };
    }

    static async getOrCreateSystemCategory(connection, { key, name, image = '/assets/category.jpg', immutable = true }) {
        const [keyRows] = await connection.execute('SELECT id FROM categories WHERE system_key = ? LIMIT 1', [key]);
        if (keyRows.length > 0) return Number(keyRows[0].id);

        const [nameRows] = await connection.execute('SELECT id FROM categories WHERE name = ? LIMIT 1', [name]);
        if (nameRows.length > 0) {
            await connection.execute(
                'UPDATE categories SET system_key = ?, is_immutable = ? WHERE id = ?',
                [key, immutable ? 1 : 0, nameRows[0].id]
            );
            return Number(nameRows[0].id);
        }

        const [result] = await connection.execute(
            'INSERT INTO categories (name, image_url, system_key, is_immutable) VALUES (?, ?, ?, ?)',
            [name, image, key, immutable ? 1 : 0]
        );
        return Number(result.insertId);
    }

    static async isProductDiscounted(connection, productId) {
        const [rows] = await connection.execute(
            `SELECT p.id,
                    p.mrp,
                    p.discount_price,
                    EXISTS (
                        SELECT 1
                        FROM product_variants pv
                        WHERE pv.product_id = p.id
                          AND pv.discount_price IS NOT NULL
                          AND pv.discount_price > 0
                          AND (pv.price IS NULL OR pv.discount_price < pv.price)
                    ) AS has_variant_discount
             FROM products p
             WHERE p.id = ?
             LIMIT 1`,
            [productId]
        );
        const row = rows[0];
        if (!row) return false;
        const productDiscount = row.discount_price != null
            && Number(row.discount_price) > 0
            && (row.mrp == null || Number(row.discount_price) < Number(row.mrp));
        return productDiscount || Number(row.has_variant_discount) === 1;
    }

    static async ensureOffersCategoryMembership(connection, productId) {
        const offersId = await Product.getOrCreateSystemCategory(connection, {
            key: 'offers',
            name: 'Offers',
            image: '/assets/category.jpg',
            immutable: true
        });
        const [categoryRows] = await connection.execute(
            'SELECT autopilot_enabled FROM categories WHERE id = ? LIMIT 1',
            [offersId]
        );
        if (Number(categoryRows?.[0]?.autopilot_enabled || 0) !== 1) {
            return;
        }
        const discounted = await Product.isProductDiscounted(connection, productId);
        const [rows] = await connection.execute(
            'SELECT 1 FROM product_categories WHERE product_id = ? AND category_id = ? LIMIT 1',
            [productId, offersId]
        );
        const exists = rows.length > 0;

        if (discounted && !exists) {
            const [orderRows] = await connection.execute(
                'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM product_categories WHERE category_id = ?',
                [offersId]
            );
            const nextOrder = Number(orderRows?.[0]?.max_order ?? -1) + 1;
            await connection.execute(
                'INSERT INTO product_categories (product_id, category_id, display_order) VALUES (?, ?, ?)',
                [productId, offersId, nextOrder]
            );
        } else if (!discounted && exists) {
            await connection.execute(
                'DELETE FROM product_categories WHERE product_id = ? AND category_id = ?',
                [productId, offersId]
            );
        }
    }

    static parseProductRow(row = {}) {
        return {
            ...row,
            media: typeof row.media === 'string' ? JSON.parse(row.media) : (row.media || []),
            categories: typeof row.categories === 'string' ? JSON.parse(row.categories) : (row.categories || []),
            usageAudience: Product.normalizeUsageAudience(row.usage_audience),
            subCategory: Product.normalizeSubCategory(row.sub_category),
            related_products: typeof row.related_products === 'string' ? JSON.parse(row.related_products) : (row.related_products || {}),
            additional_info: typeof row.additional_info === 'string' ? JSON.parse(row.additional_info) : (row.additional_info || []),
            options: typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || []),
            variants: Array.isArray(row.variants) ? row.variants : []
        };
    }

    static async hydrateProductsByIds(rows = [], { connection = db } = {}) {
        const baseRows = Array.isArray(rows) ? rows : [];
        if (!baseRows.length) return [];

        const ids = baseRows.map((row) => String(row.id || '').trim()).filter(Boolean);
        if (!ids.length) return [];

        const placeholders = ids.map(() => '?').join(',');
        const [categoryRows, variantRows] = await Promise.all([
            connection.execute(
                `SELECT pc.product_id, c.name
                 FROM product_categories pc
                 JOIN categories c ON pc.category_id = c.id
                 WHERE pc.product_id IN (${placeholders})
                 ORDER BY pc.display_order ASC, c.name ASC`,
                ids
            ),
            connection.execute(
                `SELECT *
                 FROM product_variants
                 WHERE product_id IN (${placeholders})
                 ORDER BY product_id ASC, variant_title ASC, id ASC`,
                ids
            )
        ]);

        const categoriesByProduct = new Map(ids.map((id) => [id, []]));
        (categoryRows?.[0] || []).forEach((row) => {
            const key = String(row.product_id || '').trim();
            if (!categoriesByProduct.has(key)) categoriesByProduct.set(key, []);
            categoriesByProduct.get(key).push(String(row.name || '').trim());
        });

        const variantsByProduct = new Map(ids.map((id) => [id, []]));
        (variantRows?.[0] || []).forEach((row) => {
            const key = String(row.product_id || '').trim();
            if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
            variantsByProduct.get(key).push(row);
        });

        return baseRows.map((row) => Product.parseProductRow({
            ...row,
            categories: categoriesByProduct.get(String(row.id || '').trim()) || [],
            variants: variantsByProduct.get(String(row.id || '').trim()) || []
        }));
    }

    // --- 1. GET PAGINATED (Fetches Variants & Options) ---
    // --- 1. GET PAGINATED (Fetches Variants & Options) ---
    static async getPaginated(page = 1, limit = 10, category = null, status = null, sort = 'newest', categoryId = null, usageAudience = '', viewerKey = '', subCategory = '', subCategoriesEnabled = false) {
        const offset = (page - 1) * limit;
        const params = [];
        const conditions = [];
        const numericCategoryId = Number(categoryId);
        const hasCategoryId = Number.isFinite(numericCategoryId) && numericCategoryId > 0;
        const { fetchAutopilotCapableCategory, getAutopilotProductsForCategory } = require('../services/categoryAutopilotService');
        const autopilotCategory = await fetchAutopilotCapableCategory({
            categoryId: hasCategoryId ? numericCategoryId : null,
            categoryName: hasCategoryId ? '' : category
        }).catch(() => null);
        if (autopilotCategory && Number(autopilotCategory.autopilot_enabled || 0) === 1) {
            const autopilotResult = await getAutopilotProductsForCategory(autopilotCategory, {
                viewerKey,
                page,
                limit,
                usageAudience
            }).catch(() => null);
            if (autopilotResult) {
                return {
                    products: autopilotResult.products,
                    total: autopilotResult.total,
                    totalPages: autopilotResult.totalPages,
                    page: autopilotResult.page,
                    limit: autopilotResult.limit,
                    category: autopilotCategory.name,
                    categoryId: autopilotCategory.id,
                    autopilot: {
                        enabled: true,
                        mode: 'hybrid',
                        refreshedAt: autopilotCategory.autopilot_refreshed_at || null
                    }
                };
            }
        }
        const variantStatsJoin = `
            LEFT JOIN (
                SELECT
                    pv.product_id,
                    COUNT(*) AS variant_count,
                    MIN(COALESCE(NULLIF(pv.discount_price, 0), pv.price)) AS min_effective_price,
                    MAX(CASE
                        WHEN COALESCE(pv.track_quantity, 0) = 0 OR COALESCE(pv.quantity, 0) > 0 THEN 1
                        ELSE 0
                    END) AS has_in_stock_variant
                FROM product_variants pv
                GROUP BY pv.product_id
            ) pv_stats ON pv_stats.product_id = p.id
        `;
        const effectivePrice = `
            COALESCE(
                pv_stats.min_effective_price,
                NULLIF(p.discount_price, 0),
                p.mrp
            )
        `;

        // 1. Define Select Clauses
        const selectClause = 'SELECT DISTINCT p.*';
        const countSelectClause = 'SELECT COUNT(*) as total';

        // 2. Build FROM Clause & Category Logic
        let fromClause = ` FROM products p ${variantStatsJoin}`;
        
        // [FIX] If Sorting Manually, we MUST use JOIN to access 'display_order'
        // This also handles the category filtering more efficiently for this case.
        const normalizedCategory = String(category || '').trim().toLowerCase();

        if (sort === 'manual' && hasCategoryId) {
            fromClause += ' JOIN product_categories pc_sort ON p.id = pc_sort.product_id JOIN categories c_sort ON pc_sort.category_id = c_sort.id';

            conditions.push('c_sort.id = ?');
            params.push(numericCategoryId);
        } else if (sort === 'manual' && category && normalizedCategory !== 'all' && normalizedCategory !== 'uncategorized') {
            fromClause += ' JOIN product_categories pc_sort ON p.id = pc_sort.product_id JOIN categories c_sort ON pc_sort.category_id = c_sort.id';
            conditions.push('c_sort.name = ?');
            params.push(category);
        } else {
            if (hasCategoryId) {
                conditions.push('EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?)');
                params.push(numericCategoryId);
            } else if (normalizedCategory === 'uncategorized') {
                conditions.push('NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)');
            } else if (category && normalizedCategory !== 'all') {
                conditions.push('EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE pc.product_id = p.id AND c.name = ?)');
                params.push(category);
            }
        }

        // 3. Status Filter
        if (status && status !== 'all') {
            conditions.push('p.status = ?');
            params.push(status);
        }
        const normalizedUsageAudience = Product.normalizeUsageAudience(usageAudience);
        if (normalizedUsageAudience) {
            conditions.push('p.usage_audience = ?');
            params.push(normalizedUsageAudience);
        }
        const normalizedSubCategory = subCategoriesEnabled ? Product.normalizeSubCategory(subCategory).toLowerCase() : '';
        if (normalizedSubCategory) {
            conditions.push('LOWER(COALESCE(p.sub_category, \'\')) = ?');
            params.push(normalizedSubCategory);
        }

        // 4. Construct WHERE Clause
        let whereClause = '';
        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        // 5. Determine ORDER BY
        let orderByClause = 'ORDER BY p.created_at DESC'; // Default
        
        if (sort === 'manual' && (hasCategoryId || (category && normalizedCategory !== 'all' && normalizedCategory !== 'uncategorized'))) {
            orderByClause = 'ORDER BY pc_sort.display_order ASC';
        } 
        else if (sort === 'low' || sort === 'high') {
            orderByClause = `ORDER BY ${effectivePrice} ${sort === 'low' ? 'ASC' : 'DESC'}`;
        }

        // 6. Execute Queries
        // Main Query
        const query = selectClause + fromClause + whereClause + ` ${orderByClause} LIMIT ? OFFSET ?`;
        const finalParams = [...params, parseInt(limit), parseInt(offset)];
        const [rows] = await db.execute(query, finalParams);

        // Count Query (Reuses FROM + WHERE to ensure accuracy)
        const countQuery = countSelectClause + fromClause + whereClause;
        const [countResult] = await db.execute(countQuery, params);

        const products = await Product.hydrateProductsByIds(rows);
        const discoveryParams = [];
        const discoveryConditions = [];
        let discoveryFromClause = ' FROM products p';

        if (hasCategoryId) {
            discoveryConditions.push('EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?)');
            discoveryParams.push(numericCategoryId);
        } else if (normalizedCategory === 'uncategorized') {
            discoveryConditions.push('NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)');
        } else if (category && normalizedCategory !== 'all') {
            discoveryConditions.push('EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE pc.product_id = p.id AND c.name = ?)');
            discoveryParams.push(category);
        }
        if (status && status !== 'all') {
            discoveryConditions.push('p.status = ?');
            discoveryParams.push(status);
        }
        if (normalizedUsageAudience) {
            discoveryConditions.push('p.usage_audience = ?');
            discoveryParams.push(normalizedUsageAudience);
        }
        discoveryConditions.push('p.sub_category IS NOT NULL');
        discoveryConditions.push('TRIM(p.sub_category) <> \'\'');
        const discoveryWhereClause = ` WHERE ${discoveryConditions.join(' AND ')}`;
        const [subCategoryRows] = await db.execute(
            `SELECT DISTINCT p.sub_category
             ${discoveryFromClause}
             ${discoveryWhereClause}
             ORDER BY p.sub_category ASC`.replace(/\s+/g, ' '),
            discoveryParams
        );

        return {
            products,
            total: countResult[0].total,
            totalPages: Math.ceil(countResult[0].total / limit),
            availableSubCategories: subCategoriesEnabled
                ? (subCategoryRows || []).map((row) => Product.normalizeSubCategory(row.sub_category)).filter(Boolean)
                : []
        };
    }

    static async searchPaginated({
        query = '',
        page = 1,
        limit = 40,
        category = 'all',
        status = 'active',
        sort = 'relevance',
        usageAudience = '',
        subCategory = '',
        subCategoriesEnabled = false,
        inStockOnly = false,
        minPrice = null,
        maxPrice = null
    } = {}) {
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * safeLimit;
        const q = String(query || '').trim();

        const params = [];
        const conditions = [];
        const variantStatsJoin = `
            LEFT JOIN (
                SELECT
                    pv.product_id,
                    COUNT(*) AS variant_count,
                    MIN(COALESCE(NULLIF(pv.discount_price, 0), pv.price)) AS min_effective_price,
                    MAX(CASE
                        WHEN COALESCE(pv.track_quantity, 0) = 0 OR COALESCE(pv.quantity, 0) > 0 THEN 1
                        ELSE 0
                    END) AS has_in_stock_variant
                FROM product_variants pv
                GROUP BY pv.product_id
            ) pv_stats ON pv_stats.product_id = p.id
        `;
        let fromClause = ` FROM products p ${variantStatsJoin}`;

        const effectivePrice = `
            COALESCE(
                pv_stats.min_effective_price,
                NULLIF(p.discount_price, 0),
                p.mrp
            )
        `;

        const normalizedCategory = String(category || '').trim().toLowerCase();

        if (sort === 'manual' && category && normalizedCategory !== 'all' && normalizedCategory !== 'uncategorized') {
            fromClause += ' JOIN product_categories pc_sort ON p.id = pc_sort.product_id JOIN categories c_sort ON pc_sort.category_id = c_sort.id';
            conditions.push('c_sort.name = ?');
            params.push(category);
        } else if (normalizedCategory === 'uncategorized') {
            conditions.push('NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)');
        } else if (category && normalizedCategory !== 'all') {
            conditions.push(
                'EXISTS (SELECT 1 FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE pc.product_id = p.id AND c.name = ?)'
            );
            params.push(category);
        }

        if (status && status !== 'all') {
            conditions.push('p.status = ?');
            params.push(status);
        }
        const normalizedUsageAudience = Product.normalizeUsageAudience(usageAudience);
        if (normalizedUsageAudience) {
            conditions.push('p.usage_audience = ?');
            params.push(normalizedUsageAudience);
        }
        const normalizedSubCategory = subCategoriesEnabled ? Product.normalizeSubCategory(subCategory).toLowerCase() : '';
        if (normalizedSubCategory) {
            conditions.push('LOWER(COALESCE(p.sub_category, \'\')) = ?');
            params.push(normalizedSubCategory);
        }

        if (q) {
            const term = `%${q}%`;
            conditions.push(`(
                p.title LIKE ?
                OR p.sku LIKE ?
                OR EXISTS (
                    SELECT 1
                    FROM product_variants pvq
                    WHERE pvq.product_id = p.id
                      AND (pvq.variant_title LIKE ? OR pvq.sku LIKE ?)
                )
            )`);
            params.push(term, term, term, term);
        }

        if (inStockOnly) {
            conditions.push(`(
                (
                    COALESCE(pv_stats.variant_count, 0) = 0
                    AND (COALESCE(p.track_quantity, 0) = 0 OR COALESCE(p.quantity, 0) > 0)
                )
                OR
                (
                    COALESCE(pv_stats.variant_count, 0) > 0
                    AND COALESCE(pv_stats.has_in_stock_variant, 0) = 1
                )
            )`);
        }

        const min = minPrice != null && minPrice !== '' ? Number(minPrice) : null;
        const max = maxPrice != null && maxPrice !== '' ? Number(maxPrice) : null;
        if (Number.isFinite(min)) {
            conditions.push(`${effectivePrice} >= ?`);
            params.push(min);
        }
        if (Number.isFinite(max)) {
            conditions.push(`${effectivePrice} <= ?`);
            params.push(max);
        }

        const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';

        let orderByClause = ' ORDER BY p.created_at DESC';
        const orderParams = [];
        if (sort === 'manual' && category && normalizedCategory !== 'all' && normalizedCategory !== 'uncategorized') {
            orderByClause = ' ORDER BY pc_sort.display_order ASC';
        } else if (sort === 'low' || sort === 'high') {
            orderByClause = ` ORDER BY ${effectivePrice} ${sort === 'low' ? 'ASC' : 'DESC'}, p.created_at DESC`;
        } else if (sort === 'newest') {
            orderByClause = ' ORDER BY p.created_at DESC';
        } else if (sort === 'relevance' && q) {
            const prefix = `${q}%`;
            const anywhere = `%${q}%`;
            orderByClause = `
                ORDER BY
                    (CASE WHEN p.title LIKE ? THEN 0 ELSE 1 END),
                    (CASE WHEN p.title LIKE ? THEN 0 ELSE 1 END),
                    (CASE WHEN p.sku LIKE ? THEN 0 ELSE 1 END),
                    (CASE WHEN EXISTS (
                        SELECT 1 FROM product_variants pvr
                        WHERE pvr.product_id = p.id
                          AND (pvr.variant_title LIKE ? OR pvr.sku LIKE ?)
                    ) THEN 0 ELSE 1 END),
                    p.updated_at DESC,
                    p.created_at DESC
            `;
            orderParams.push(prefix, anywhere, anywhere, anywhere, anywhere);
        }

        const selectClause = 'SELECT DISTINCT p.*';

        const mainQuery = `${selectClause}${fromClause}${whereClause}${orderByClause} LIMIT ? OFFSET ?`;
        const mainParams = [...params, ...orderParams, safeLimit, offset];
        const [rows] = await db.execute(mainQuery, mainParams);

        const countQuery = `SELECT COUNT(*) AS total${fromClause}${whereClause}`;
        const [countRows] = await db.execute(countQuery, params);
        const total = Number(countRows?.[0]?.total || 0);

        const products = await Product.hydrateProductsByIds(rows);

        return {
            products,
            total,
            totalPages: Math.ceil(total / safeLimit),
            page: safePage,
            limit: safeLimit
        };
    }

    // --- [NEW] Find Single Product by ID (with Variants) ---
    static async findById(id) {
        // 1. Fetch the Product
        const [productRows] = await db.execute(
            'SELECT * FROM products WHERE id = ?', 
            [id]
        );

        if (productRows.length === 0) {
            return null; // Product not found
        }

        const product = productRows[0];
        // [FIX] Parse JSON fields (Ensure Socket receives Arrays/Objects, not Strings)
        product.media = typeof product.media === 'string' ? JSON.parse(product.media) : (product.media || []);
        product.categories = typeof product.categories === 'string' ? JSON.parse(product.categories) : (product.categories || []);
        product.usageAudience = Product.normalizeUsageAudience(product.usage_audience);
        product.subCategory = Product.normalizeSubCategory(product.sub_category);
        product.related_products = typeof product.related_products === 'string' ? JSON.parse(product.related_products) : (product.related_products || {});
        product.additional_info = typeof product.additional_info === 'string' ? JSON.parse(product.additional_info) : (product.additional_info || []);
        product.options = typeof product.options === 'string' ? JSON.parse(product.options) : (product.options || []);
        product.variant_options = typeof product.variant_options === 'string' ? JSON.parse(product.variant_options) : (product.variant_options || {});
        // 2. Fetch Variants (if any)
        // [FIX] Changed table to 'product_variants'. 
        // Removed 'ORDER BY created_at' to be safe since it wasn't in your schema snippet.
        const [variantRows] = await db.execute(
            'SELECT * FROM product_variants WHERE product_id = ?', 
            [id]
        );

        // 3. Attach variants to the product object
        product.variants = variantRows;

        return product;
    }
    // --- 2. CREATE PRODUCT (With Variants) ---
    static async create(data) {
        const uniqueId = `prod_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
        
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Insert Main Product
            const query = `
                INSERT INTO products 
                (id, title, subtitle, description, ribbon_tag, media, categories, usage_audience, sub_category, related_products, additional_info, polish_warranty_months, options, mrp, discount_price, sku, weight_kg, track_quantity, quantity, track_low_stock, low_stock_threshold, tax_config_id, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await connection.execute(query, [
                uniqueId, data.title, data.subtitle || null, data.description || null, data.ribbon_tag || null,
                JSON.stringify(data.media || []), 
                JSON.stringify(data.categories || []), 
                Product.normalizeUsageAudience(data.usageAudience) || null,
                Product.normalizeSubCategory(data.subCategory) || null,
                JSON.stringify(data.related_products || {}),
                JSON.stringify(data.additional_info || []),
                Number.isFinite(Number(data.polish_warranty_months)) ? Number(data.polish_warranty_months) : 6,
                JSON.stringify(data.options || []), // [NEW]
                data.mrp, data.discount_price || null, data.sku || null, data.weight_kg || null,
                data.track_quantity ? 1 : 0, data.quantity || 0, data.track_low_stock ? 1 : 0, data.low_stock_threshold || 0,
                data.tax_config_id || null,
                data.status || 'active'
            ]);
            // [NEW] Sync Relational Categories
            await Product.syncCategories(connection, uniqueId, data.categories);

            // 2. Insert Variants (if any)
            if (data.variants && data.variants.length > 0) {
                const variantQuery = `
                    INSERT INTO product_variants 
                    (id, product_id, variant_title, price, discount_price, sku, weight_kg, quantity, track_quantity, track_low_stock, low_stock_threshold, image_url)
                    VALUES ?
                `;
                const variantValues = data.variants.map(v => [
                    `var_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 5)}`, // ID
                    uniqueId,
                    v.title,
                    v.price,
                    v.discount_price || null,
                    v.sku || null,
                    v.weight_kg || null,
                    v.quantity || 0,
                    v.track_quantity ? 1 : 0,
                    v.track_low_stock ? 1 : 0,
                    v.low_stock_threshold || 0,
                    v.image_url || null
                ]);
                await connection.query(variantQuery, [variantValues]);
            }

            await Product.ensureOffersCategoryMembership(connection, uniqueId);
            await Product.rebuildCategoriesJsonForProducts([uniqueId], { connection });

            await connection.commit();
            return { id: uniqueId, ...data };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // --- 3. DELETE PRODUCT ---
    static async delete(id) {
        // Variants delete automatically due to ON DELETE CASCADE
        await db.execute('DELETE FROM products WHERE id = ?', [id]);
        return true;
    }

    // --- 4. UPDATE PRODUCT ---
    static async update(id, data) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Update Main Product Fields
            const fields = [];
            const values = [];
            Object.keys(data).forEach(key => {
                if(key === 'variants') return; // Handle separately
                // if(key === 'categories') return; // Handle separately
                const columnName = key === 'usageAudience'
                    ? 'usage_audience'
                    : key === 'subCategory'
                        ? 'sub_category'
                        : key;
                fields.push(`${columnName} = ?`);
                if (['media','categories','related_products','additional_info','options'].includes(key)) {
                    values.push(JSON.stringify(data[key]));
                } else if (key === 'usageAudience') {
                    values.push(Product.normalizeUsageAudience(data[key]) || null);
                } else if (key === 'subCategory') {
                    values.push(Product.normalizeSubCategory(data[key]) || null);
                } else {
                    values.push(data[key]);
                }
            });
            values.push(id);
            await connection.execute(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
            // [NEW] Sync Relational Categories
            if (data.categories) {
                await Product.syncCategories(connection, id, data.categories);
            }
            // 2. [FIXED] Sync Variants (Smart Diff Strategy)
            // Goal: Preserve IDs to maintain Order/Cart history.
            
            const incomingVariants = data.variants || [];
            
            // Step A: Separate IDs that are being kept
            const keepIds = incomingVariants
                .map(v => v.id)
                .filter(id => id && !id.startsWith('temp_')); // Filter out empty or temp frontend IDs

            // Step B: DELETE variants that are missing from the incoming list (Pruning)
            if (keepIds.length > 0) {
                // Delete only those NOT in the keep list
                // We construct a dynamic placeholder string like "?, ?, ?"
                const placeholders = keepIds.map(() => '?').join(',');
                await connection.execute(
                    `DELETE FROM product_variants WHERE product_id = ? AND id NOT IN (${placeholders})`,
                    [id, ...keepIds]
                );
            } else {
                // If the user removed ALL variants, clear the table for this product
                await connection.execute('DELETE FROM product_variants WHERE product_id = ?', [id]);
            }

            // Step C: UPSERT (Update Existing / Insert New)
            for (const v of incomingVariants) {
                // Check if this is an existing variant (has ID and we didn't just delete it)
                const isExisting = v.id && keepIds.includes(v.id);

                if (isExisting) {
                    // --- UPDATE ---
                    await connection.execute(
                        `UPDATE product_variants SET 
                            variant_title=?, price=?, discount_price=?, sku=?, weight_kg=?, 
                            quantity=?, track_quantity=?, track_low_stock=?, low_stock_threshold=?, image_url=?
                         WHERE id = ? AND product_id = ?`,
                        [
                            v.title, v.price, v.discount_price || null, v.sku || null, v.weight_kg || null,
                            v.quantity || 0, v.track_quantity ? 1 : 0, v.track_low_stock ? 1 : 0, 
                            v.low_stock_threshold || 0, v.image_url || null,
                            v.id, id
                        ]
                    );
                } else {
                    // --- INSERT ---
                    // Generate a consistent ID just like in Create
                    const newVarId = `var_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 5)}_${Math.random().toString(36).substring(2, 5)}`;
                    
                    await connection.execute(
                        `INSERT INTO product_variants 
                        (id, product_id, variant_title, price, discount_price, sku, weight_kg, quantity, track_quantity, track_low_stock, low_stock_threshold, image_url)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            newVarId, id, v.title, v.price, v.discount_price || null, v.sku || null, v.weight_kg || null,
                            v.quantity || 0, v.track_quantity ? 1 : 0, v.track_low_stock ? 1 : 0, 
                            v.low_stock_threshold || 0, v.image_url || null
                        ]
                    );
                }
            }

            await Product.ensureOffersCategoryMembership(connection, id);
            await Product.rebuildCategoriesJsonForProducts([id], { connection });

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // --- HELPER: SECURE CATEGORY SYNC ---
    static async syncCategories(connection, productId, categoryNames) {
        const normalized = [...new Set(
            (Array.isArray(categoryNames) ? categoryNames : [])
                .map((name) => String(name || '').trim())
                .filter(Boolean)
        )];

        // 1. Resolve category IDs (create missing)
        const targetCategoryIds = [];
        for (const name of normalized) {
            const [rows] = await connection.execute('SELECT id FROM categories WHERE name = ?', [name]);
            if (rows.length > 0) {
                targetCategoryIds.push(Number(rows[0].id));
            } else {
                const [result] = await connection.execute('INSERT INTO categories (name) VALUES (?)', [name]);
                targetCategoryIds.push(Number(result.insertId));
            }
        }

        // 2. Load existing mappings for this product
        const [existingRows] = await connection.execute(
            'SELECT category_id FROM product_categories WHERE product_id = ?',
            [productId]
        );
        const existingSet = new Set(existingRows.map((row) => Number(row.category_id)));
        const targetSet = new Set(targetCategoryIds);

        // 3. Remove categories no longer linked
        const toDelete = [...existingSet].filter((categoryId) => !targetSet.has(categoryId));
        if (toDelete.length > 0) {
            const placeholders = toDelete.map(() => '?').join(',');
            await connection.execute(
                `DELETE FROM product_categories WHERE product_id = ? AND category_id IN (${placeholders})`,
                [productId, ...toDelete]
            );
        }

        // 4. Add only new links; append to end to preserve admin manual order
        const toInsert = targetCategoryIds.filter((categoryId) => !existingSet.has(categoryId));
        for (const categoryId of toInsert) {
            const [orderRows] = await connection.execute(
                'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM product_categories WHERE category_id = ?',
                [categoryId]
            );
            const nextOrder = Number(orderRows?.[0]?.max_order ?? -1) + 1;
            await connection.execute(
                'INSERT INTO product_categories (product_id, category_id, display_order) VALUES (?, ?, ?)',
                [productId, categoryId, nextOrder]
            );
        }
    }

    static async rebuildCategoriesJsonForProducts(productIds = [], { connection = db } = {}) {
        const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
        if (!ids.length) return;

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await connection.execute(
            `SELECT pc.product_id, c.name
             FROM product_categories pc
             JOIN categories c ON c.id = pc.category_id
             WHERE pc.product_id IN (${placeholders})`,
            ids
        );

        const byProduct = new Map(ids.map((id) => [String(id), []]));
        rows.forEach((row) => {
            const key = String(row.product_id || '');
            if (!byProduct.has(key)) byProduct.set(key, []);
            byProduct.get(key).push(String(row.name || '').trim());
        });

        for (const productId of ids) {
            const categoryNames = (byProduct.get(String(productId)) || []).filter(Boolean);
            await connection.execute(
                'UPDATE products SET categories = ? WHERE id = ?',
                [JSON.stringify(categoryNames), productId]
            );
        }
    }

    // --- HELPER: GET ALL CATEGORIES ---
    static async getAllCategories({ publicOnly = false } = {}) {
        const query = publicOnly
            ? `SELECT c.name
               FROM categories c
               JOIN product_categories pc ON pc.category_id = c.id
               JOIN products p ON p.id = pc.product_id AND p.status = 'active'
               GROUP BY c.id, c.name
               HAVING COUNT(p.id) > 0
               ORDER BY c.name ASC`
            : 'SELECT name FROM categories ORDER BY name ASC';
        const [rows] = await db.execute(query);
        return rows.map(r => r.name);
    }

    // --- 5. CATEGORY MANAGEMENT ---
    
    // A. Get All Categories with Product Counts
    static async getCategoriesWithStats({ publicOnly = false, usageAudience = '' } = {}) {
        const normalizedUsageAudience = Product.normalizeUsageAudience(usageAudience);
        const audienceCondition = normalizedUsageAudience
            ? ` AND p.usage_audience = ${db.escape(normalizedUsageAudience)}`
            : '';
        const query = publicOnly
            ? `
                SELECT c.id, c.name, c.image_url, c.system_key, c.is_immutable, c.autopilot_enabled, c.autopilot_mode, c.autopilot_refreshed_at, c.autopilot_catalog_json, c.subcategories_json, COUNT(p.id) as product_count
                FROM categories c
                LEFT JOIN product_categories pc ON c.id = pc.category_id
                LEFT JOIN products p ON p.id = pc.product_id AND p.status = 'active'${audienceCondition}
                GROUP BY c.id
                ORDER BY c.name ASC
            `
            : `
                SELECT c.id, c.name, c.image_url, c.system_key, c.is_immutable, c.autopilot_enabled, c.autopilot_mode, c.autopilot_refreshed_at, c.autopilot_catalog_json, c.subcategories_json, COUNT(pc.product_id) as product_count
                FROM categories c
                LEFT JOIN product_categories pc ON c.id = pc.category_id
                LEFT JOIN products p ON p.id = pc.product_id${normalizedUsageAudience ? ` AND p.usage_audience = ${db.escape(normalizedUsageAudience)}` : ''}
                WHERE ${normalizedUsageAudience ? 'p.id IS NOT NULL' : '1=1'}
                GROUP BY c.id
                ORDER BY c.name ASC
        `;
        const [rows] = await db.execute(query);
        const [subCategoryRows] = await db.execute(
            `SELECT c.id AS category_id, p.sub_category
             FROM categories c
             LEFT JOIN product_categories pc ON c.id = pc.category_id
             LEFT JOIN products p ON p.id = pc.product_id
             WHERE LOWER(COALESCE(p.status, '')) = 'active'
               AND COALESCE(TRIM(p.sub_category), '') <> ''
               ${normalizedUsageAudience ? `AND p.usage_audience = ${db.escape(normalizedUsageAudience)}` : ''}
             ORDER BY c.id ASC, p.sub_category ASC`
        );
        const availableSubCategoriesByCategory = new Map();
        (subCategoryRows || []).forEach((row) => {
            const key = Number(row?.category_id || 0);
            if (!key) return;
            if (!availableSubCategoriesByCategory.has(key)) {
                availableSubCategoriesByCategory.set(key, []);
            }
            availableSubCategoriesByCategory.get(key).push(row?.sub_category);
        });
        const { applyAutopilotStats } = require('../services/categoryAutopilotService');
        const categories = await applyAutopilotStats(rows, { usageAudience: normalizedUsageAudience });
        const normalizedCategories = categories.map((category) => ({
            ...category,
            subCategories: Product.normalizeSubCategoryList(category?.subcategories_json),
            availableSubCategories: Product.normalizeSubCategoryList(
                availableSubCategoriesByCategory.get(Number(category?.id || 0)) || []
            )
        }));
        return publicOnly ? normalizedCategories.filter((category) => Product.shouldExposeCategoryPublicly(category)) : normalizedCategories;
    }

    static async getCategoryStatsById(categoryId) {
        const query = `
            SELECT c.id, c.name, c.image_url, c.system_key, c.is_immutable, c.autopilot_enabled, c.autopilot_mode, c.autopilot_refreshed_at, c.autopilot_catalog_json, c.subcategories_json, COUNT(pc.product_id) as product_count 
            FROM categories c 
            LEFT JOIN product_categories pc ON c.id = pc.category_id 
            WHERE c.id = ?
            GROUP BY c.id
            LIMIT 1
        `;
        const [rows] = await db.execute(query, [categoryId]);
        const row = rows[0] || null;
        if (!row) return null;
        const { applyAutopilotStats } = require('../services/categoryAutopilotService');
        const [withAutopilot] = await applyAutopilotStats([row]);
        const resolved = withAutopilot || row;
        return {
            ...resolved,
            subCategories: Product.normalizeSubCategoryList(resolved?.subcategories_json)
        };
    }

    // B. Get Single Category with Ordered Products
    static async getCategoryDetails(categoryId, { viewerKey = '' } = {}) {
        // 1. Get Category Info
        const [catRows] = await db.execute('SELECT * FROM categories WHERE id = ?', [categoryId]);
        if (catRows.length === 0) return null;
        const category = catRows[0];
        const { getAutopilotProductsForCategory } = require('../services/categoryAutopilotService');
        if (Number(category.autopilot_enabled || 0) === 1) {
            const autopilotResult = await getAutopilotProductsForCategory(category, {
                viewerKey,
                page: 1,
                limit: 25
            }).catch(() => null);
            if (autopilotResult) {
                return {
                    ...category,
                    products: autopilotResult.products.map((product, index) => ({
                        id: product.id,
                        title: product.title,
                        sku: product.sku,
                        status: product.status,
                        media: Array.isArray(product.media) ? product.media : [],
                        quantity: product.quantity,
                        display_order: index,
                        autopilot_generated: true
                    })),
                    autopilot_meta: {
                        enabled: true,
                        mode: 'hybrid',
                        total: autopilotResult.total,
                        refreshedAt: category.autopilot_refreshed_at || null
                    }
                };
            }
        }

        // 2. Get Products in this Category (Ordered by display_order)
        const productQuery = `
            SELECT p.id, p.title, p.sku, p.status, p.media, p.quantity, pc.display_order
            FROM products p
            JOIN product_categories pc ON p.id = pc.product_id
            WHERE pc.category_id = ?
            ORDER BY pc.display_order ASC, p.created_at DESC
        `;
        const [productRows] = await db.execute(productQuery, [categoryId]);

        // Parse media for the frontend
        const products = productRows.map(p => ({
            ...p,
            media: typeof p.media === 'string' ? JSON.parse(p.media) : (p.media || [])
        }));

        return {
            ...category,
            subCategories: Product.normalizeSubCategoryList(category?.subcategories_json),
            products
        };
    }

    // C. Update Category Name
    static async updateCategory(id, name, imageUrl, subCategories = null) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [catRows] = await connection.execute(
                'SELECT name, system_key, is_immutable, autopilot_enabled, subcategories_json FROM categories WHERE id = ? LIMIT 1',
                [id]
            );
            if (!catRows[0]) {
                throw new Error('Category not found');
            }
            const oldName = String(catRows?.[0]?.name || '').trim();
            const isImmutable = Number(catRows?.[0]?.is_immutable || 0) === 1 || Product.isImmutableSystemKey(catRows?.[0]?.system_key);
            if (isImmutable && String(name || '').trim() !== oldName) {
                throw new Error('This category name is immutable');
            }

            const [affectedRows] = await connection.execute(
                'SELECT DISTINCT product_id FROM product_categories WHERE category_id = ?',
                [id]
            );
            const affectedProductIds = new Set(
                affectedRows.map((row) => String(row.product_id || '').trim()).filter(Boolean)
            );

            const requestedName = String(name || '').trim();
            const finalName = isImmutable ? oldName : (requestedName || oldName);
            const nextSubCategories = subCategories == null
                ? Product.normalizeSubCategoryList(catRows?.[0]?.subcategories_json)
                : Product.normalizeSubCategoryList(subCategories);
            if (imageUrl) {
                await connection.execute(
                    'UPDATE categories SET name = ?, image_url = ?, subcategories_json = ? WHERE id = ?',
                    [finalName, imageUrl, JSON.stringify(nextSubCategories), id]
                );
            } else {
                await connection.execute(
                    'UPDATE categories SET name = ?, subcategories_json = ? WHERE id = ?',
                    [finalName, JSON.stringify(nextSubCategories), id]
                );
            }

            const relatedRefs = await Product.syncRelatedProductsCategoryReference(oldName, finalName, { connection });
            relatedRefs.forEach((productId) => affectedProductIds.add(productId));
            await Product.rebuildCategoriesJsonForProducts(Array.from(affectedProductIds), { connection });
            await connection.commit();
            return Array.from(affectedProductIds);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // D. Reorder Products in Category
    static async reorderCategoryProducts(categoryId, orderedProductIds) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const meta = await Product.getCategoryMetaById(categoryId, { connection });
            if (!meta) throw new Error('Category not found');
            if (Number(meta?.autopilot_enabled || 0) === 1 && Product.isImmutableSystemKey(meta?.system_key)) {
                throw new Error('Auto-pilot is enabled. Turn it off to reorder products manually');
            }

            const ids = Array.isArray(orderedProductIds)
                ? orderedProductIds.map((id) => String(id || '').trim()).filter(Boolean)
                : [];
            if (!ids.length) {
                throw new Error('Product order is required');
            }

            const uniqueIds = [...new Set(ids)];
            if (uniqueIds.length !== ids.length) {
                throw new Error('Duplicate product ids are not allowed');
            }

            const [currentRows] = await connection.execute(
                'SELECT product_id FROM product_categories WHERE category_id = ? ORDER BY display_order ASC, product_id ASC',
                [categoryId]
            );
            const currentIds = currentRows.map((row) => String(row.product_id || '').trim()).filter(Boolean);
            if (currentIds.length !== ids.length) {
                throw new Error('Reorder list must include every product in the category');
            }

            const currentSet = new Set(currentIds);
            const includesUnknown = ids.some((id) => !currentSet.has(id));
            if (includesUnknown) {
                throw new Error('Reorder list contains products outside this category');
            }

            for (let i = 0; i < ids.length; i++) {
                await connection.execute(
                    'UPDATE product_categories SET display_order = ? WHERE category_id = ? AND product_id = ?',
                    [i, categoryId, ids[i]]
                );
            }
            
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

   // E. Add/Remove Product from Category (With Sync)
    static async manageCategoryProduct(categoryId, productId, action) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const meta = await Product.getCategoryMetaById(categoryId, { connection });
            if (!meta) throw new Error('Category not found');
            if (Number(meta?.autopilot_enabled || 0) === 1 && Product.isImmutableSystemKey(meta?.system_key)) {
                throw new Error('Auto-pilot is enabled. Turn it off to manage products manually');
            }
            const normalizedAction = String(action || '').trim().toLowerCase();
            if (!['add', 'remove'].includes(normalizedAction)) {
                throw new Error('Invalid action');
            }

            const [productRows] = await connection.execute(
                'SELECT id FROM products WHERE id = ? LIMIT 1',
                [productId]
            );
            if (!productRows[0]) throw new Error('Product not found');

            // 1. Perform the Action on Link Table
            if (normalizedAction === 'add') {
                const [exists] = await connection.execute(
                    'SELECT 1 FROM product_categories WHERE category_id = ? AND product_id = ?', 
                    [categoryId, productId]
                );
                if (exists.length === 0) {
                    const [orderRows] = await connection.execute(
                        'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM product_categories WHERE category_id = ?',
                        [categoryId]
                    );
                    const nextOrder = Number(orderRows?.[0]?.max_order ?? -1) + 1;
                    await connection.execute(
                        'INSERT INTO product_categories (category_id, product_id, display_order) VALUES (?, ?, ?)', 
                        [categoryId, productId, nextOrder]
                    );
                }
            } else if (normalizedAction === 'remove') {
                await connection.execute(
                    'DELETE FROM product_categories WHERE category_id = ? AND product_id = ?', 
                    [categoryId, productId]
                );
            }

            // 2. Keep products.categories JSON aligned with relational mapping
            await Product.rebuildCategoriesJsonForProducts([productId], { connection });

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async manageCategoryProductsBulk(categoryId, productIds = [], action = 'add') {
        const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
        if (!ids.length) return [];

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const meta = await Product.getCategoryMetaById(categoryId, { connection });
            if (!meta) throw new Error('Category not found');
            if (Number(meta?.autopilot_enabled || 0) === 1 && Product.isImmutableSystemKey(meta?.system_key)) {
                throw new Error('Auto-pilot is enabled. Turn it off to manage products manually');
            }
            const placeholders = ids.map(() => '?').join(',');

            if (action === 'add') {
                const [existingRows] = await connection.execute(
                    `SELECT product_id
                     FROM product_categories
                     WHERE category_id = ? AND product_id IN (${placeholders})`,
                    [categoryId, ...ids]
                );
                const existing = new Set(existingRows.map((row) => String(row.product_id || '').trim()).filter(Boolean));
                const toInsert = ids.filter((id) => !existing.has(String(id)));
                if (toInsert.length > 0) {
                    const [orderRows] = await connection.execute(
                        'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM product_categories WHERE category_id = ?',
                        [categoryId]
                    );
                    let nextOrder = Number(orderRows?.[0]?.max_order ?? -1) + 1;

                    const values = [];
                    toInsert.forEach((productId) => {
                        values.push(categoryId, productId, nextOrder);
                        nextOrder += 1;
                    });
                    const tuplePlaceholders = toInsert.map(() => '(?, ?, ?)').join(',');
                    await connection.execute(
                        `INSERT INTO product_categories (category_id, product_id, display_order) VALUES ${tuplePlaceholders}`,
                        values
                    );
                }
            } else if (action === 'remove') {
                await connection.execute(
                    `DELETE FROM product_categories
                     WHERE category_id = ? AND product_id IN (${placeholders})`,
                    [categoryId, ...ids]
                );
            }

            await Product.rebuildCategoriesJsonForProducts(ids, { connection });
            await connection.commit();
            return ids;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // F. Create New Category
    static async createCategory(name, imageUrl, subCategories = []) {
        // Handle Duplicate Name Error at DB level
        try {
            const normalizedName = Product.normalizeCategoryName(name);
            const isReserved = Product.getDefaultSystemCategories().some(
                (category) => Product.normalizeCategoryName(category.name) === normalizedName
            );
            if (isReserved) {
                throw new Error('This category name is reserved');
            }
            const normalizedSubCategories = Product.normalizeSubCategoryList(subCategories);
            const [result] = await db.execute(
                'INSERT INTO categories (name, image_url, subcategories_json) VALUES (?, ?, ?)',
                [name, imageUrl, JSON.stringify(normalizedSubCategories)]
            );
            return result.insertId;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Category already exists');
            }
            throw error;
        }
    }

    // G. Delete Category
    static async deleteCategory(id) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [catRows] = await connection.execute(
                'SELECT name, system_key, is_immutable, autopilot_enabled FROM categories WHERE id = ? LIMIT 1',
                [id]
            );
            if (!catRows[0]) {
                throw new Error('Category not found');
            }
            const isImmutable = Number(catRows?.[0]?.is_immutable || 0) === 1 || Product.isImmutableSystemKey(catRows?.[0]?.system_key);
            if (isImmutable) {
                throw new Error('This category cannot be deleted');
            }
            const deletedCategoryName = String(catRows?.[0]?.name || '').trim();
            const [affectedRows] = await connection.execute(
                'SELECT DISTINCT product_id FROM product_categories WHERE category_id = ?',
                [id]
            );
            const affectedProductIds = new Set(
                affectedRows.map((row) => String(row.product_id || '').trim()).filter(Boolean)
            );

            // ON DELETE CASCADE in product_categories will untag mapped products
            await connection.execute('DELETE FROM categories WHERE id = ?', [id]);

            const relatedRefs = await Product.syncRelatedProductsCategoryReference(
                deletedCategoryName,
                '',
                { connection, disableIfMissing: true }
            );
            relatedRefs.forEach((productId) => affectedProductIds.add(productId));

            // Refresh products.categories JSON after unlink cascade
            await Product.rebuildCategoriesJsonForProducts(Array.from(affectedProductIds), { connection });
            await connection.commit();
            return Array.from(affectedProductIds);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getSubCategorySuggestionsByCategoryNames(categoryNames = [], { connection = db } = {}) {
        const normalizedNames = [...new Set(
            (Array.isArray(categoryNames) ? categoryNames : [])
                .map((name) => String(name || '').trim())
                .filter(Boolean)
        )];
        if (!normalizedNames.length) return [];

        const placeholders = normalizedNames.map(() => '?').join(',');
        const [rows] = await connection.execute(
            `SELECT subcategories_json
             FROM categories
             WHERE name IN (${placeholders})`,
            normalizedNames
        );

        const merged = rows.flatMap((row) => Product.normalizeSubCategoryList(row?.subcategories_json));
        return Product.normalizeSubCategoryList(merged);
    }

    static async updateCategoryAutopilot(id, enabled) {
        const { updateCategoryAutopilot } = require('../services/categoryAutopilotService');
        return updateCategoryAutopilot(id, { enabled });
    }

    static async syncRelatedProductsCategoryReference(
        oldCategoryName,
        newCategoryName,
        { connection = db, disableIfMissing = false } = {}
    ) {
        const previous = Product.normalizeCategoryName(oldCategoryName);
        if (!previous) return [];

        const [rows] = await connection.execute(
            'SELECT id, related_products FROM products WHERE related_products IS NOT NULL'
        );

        const nextCategory = String(newCategoryName || '').trim();
        const affected = [];

        for (const row of rows) {
            const related = Product.parseJsonSafe(row.related_products, {});
            if (!related || typeof related !== 'object') continue;
            const currentCategory = Product.normalizeCategoryName(related.category);
            if (currentCategory !== previous) continue;

            const nextRelated = { ...related };
            if (nextCategory) {
                nextRelated.category = nextCategory;
            } else {
                nextRelated.category = '';
                if (disableIfMissing) {
                    nextRelated.show = false;
                }
            }

            await connection.execute(
                'UPDATE products SET related_products = ? WHERE id = ?',
                [JSON.stringify(nextRelated), row.id]
            );
            affected.push(String(row.id));
        }

        return affected;
    }

    // --- H. Helper: Get Category Name (For Socket Events) ---
    static async getCategoryName(id) {
        const [rows] = await db.execute('SELECT name FROM categories WHERE id = ?', [id]);
        return rows[0] ? rows[0].name : null;
    }
}

module.exports = Product;
