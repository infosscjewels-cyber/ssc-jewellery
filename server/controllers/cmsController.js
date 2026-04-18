const db = require('../config/db');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const CompanyProfile = require('../models/CompanyProfile');
const { sendEmailCommunication } = require('../services/communications/communicationService');
const { resolveUploadedAssetPath } = require('../utils/uploadsRoot');
const { queueStaticRefresh } = require('../services/seoService');

const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CONTACT_RATE_LIMIT_MAX = 5;
const contactRequestBuckets = new Map();

const notifyClients = (req, event, payload = {}) => {
    const io = req.app.get('io');
    if (!io) return;
    io.emit(event, payload);
};

const getPublicCmsAudience = (req) => {
    const io = req.app.get('io');
    if (!io) return null;
    if (typeof io.except === 'function') {
        return io.except('admin');
    }
    return io;
};

const getAdminCmsAudience = (req) => {
    const io = req.app.get('io');
    if (!io) return null;
    return io.to('admin');
};

const notifyCmsClients = (req, event, payload = {}) => {
    const adminAudience = getAdminCmsAudience(req);
    const publicAudience = getPublicCmsAudience(req);
    if (adminAudience) adminAudience.emit(event, payload);
    if (publicAudience) publicAudience.emit(event, payload);
};

const getOptionalAuthContext = (req) => {
    try {
        const header = String(req.headers?.authorization || '');
        if (!header.startsWith('Bearer ')) return { userId: null, role: null };
        const token = header.slice(7).trim();
        if (!token) return { userId: null, role: null };
        const secret = String(process.env.JWT_SECRET || '').trim();
        if (!secret) return { userId: null, role: null };
        const decoded = jwt.verify(token, secret);
        return {
            userId: decoded?.id ? String(decoded.id) : null,
            role: decoded?.role ? String(decoded.role).toLowerCase() : null
        };
    } catch {
        return { userId: null, role: null };
    }
};

const getWeekKey = () => {
    const now = new Date();
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dayOfYear = Math.floor((todayUtc - yearStart) / 86400000);
    return Math.floor(dayOfYear / 7);
};

const hashText = (text = '') => {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash;
};

const parseMaybeJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const removeCmsAssetIfUploaded = async (assetUrl = '') => {
    const absolutePath = resolveUploadedAssetPath(assetUrl);
    if (!absolutePath) return;
    try {
        await fs.promises.unlink(absolutePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
};

const isUploadedCarouselAsset = (assetUrl = '') => String(assetUrl || '').trim().startsWith('/uploads/carousel/');

const buildContactRateLimitKey = (req, email = '') => {
    const ip = String(req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').trim();
    return `${ip}|${String(email || '').trim().toLowerCase()}`;
};

const isContactRequestRateLimited = (req, email = '') => {
    const key = buildContactRateLimitKey(req, email);
    const now = Date.now();
    const current = contactRequestBuckets.get(key) || [];
    const recent = current.filter((ts) => now - ts < CONTACT_RATE_LIMIT_WINDOW_MS);
    if (recent.length >= CONTACT_RATE_LIMIT_MAX) {
        contactRequestBuckets.set(key, recent);
        return true;
    }
    recent.push(now);
    contactRequestBuckets.set(key, recent);
    return false;
};

const parseId = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

const normalizeCategoryText = (value = '') => String(value || '').trim().toLowerCase();
const HOME_VISIBLE_CATEGORY_SYSTEM_KEYS = new Set(['best_sellers', 'new_arrivals', 'offers']);
const HOME_VISIBLE_CATEGORY_NAMES = new Set(['best sellers', 'new arrivals', 'offers']);

const isHomeVisibleCategory = (category = {}) => {
    const systemKey = normalizeCategoryText(category?.system_key);
    if (HOME_VISIBLE_CATEGORY_SYSTEM_KEYS.has(systemKey)) return true;
    return HOME_VISIBLE_CATEGORY_NAMES.has(normalizeCategoryText(category?.name));
};

const pickRotatingCategory = (categories = [], { userId = null } = {}) => {
    if (!Array.isArray(categories) || categories.length === 0) return null;
    const rotationBase = getWeekKey();
    const personalizedOffset = userId ? (hashText(userId) % categories.length) : 0;
    const index = (rotationBase + personalizedOffset) % categories.length;
    return categories[index] || null;
};

const selectFeaturedAutopilotCategory = ({
    allCategories = [],
    seenCategoryIds = [],
    userId = null
} = {}) => {
    const nonVisibleCategories = (Array.isArray(allCategories) ? allCategories : []).filter((category) => !isHomeVisibleCategory(category));
    if (nonVisibleCategories.length === 0) {
        return null;
    }

    const seenSet = new Set(
        (Array.isArray(seenCategoryIds) ? seenCategoryIds : [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id))
    );

    const unseenCategories = userId
        ? nonVisibleCategories.filter((category) => !seenSet.has(Number(category.id)))
        : nonVisibleCategories;

    return pickRotatingCategory(
        unseenCategories.length > 0 ? unseenCategories : nonVisibleCategories,
        { userId }
    );
};

const ensureRowExists = async ({ table, id, idColumn = 'id' } = {}) => {
    const entityId = parseId(id);
    if (!entityId) throw new Error('Invalid id');
    const [rows] = await db.execute(`SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = ? LIMIT 1`, [entityId]);
    if (!rows.length) throw new Error('Not found');
    return entityId;
};

const ensureCategoryExists = async (categoryId) => {
    const parsedCategoryId = parseId(categoryId);
    if (!parsedCategoryId) throw new Error('Invalid category');
    const [rows] = await db.execute('SELECT id, name FROM categories WHERE id = ? LIMIT 1', [parsedCategoryId]);
    if (!rows.length) throw new Error('Category not found');
    return rows[0];
};

const ensureProductExists = async (productId) => {
    const normalized = String(productId || '').trim();
    if (!normalized) throw new Error('Product not found');
    const [rows] = await db.execute('SELECT id FROM products WHERE id = ? LIMIT 1', [normalized]);
    if (!rows.length) throw new Error('Product not found');
    return rows[0];
};

const validateCarouselCardPayload = async (payload = {}) => {
    if (!payload.title) throw new Error('Carousel card title is required');
    if (!payload.button_label) throw new Error('Carousel button label is required');
    if (payload.source_type === 'manual' && !payload.image_url) {
        throw new Error('Manual carousel cards require an image');
    }
    if (payload.source_type === 'product') {
        await ensureProductExists(payload.source_id);
    }
    if (payload.source_type === 'category') {
        await ensureCategoryExists(payload.source_id);
    }
    if (payload.link_target_type === 'product') {
        await ensureProductExists(payload.link_target_id);
    }
    if (payload.link_target_type === 'category') {
        await ensureCategoryExists(payload.link_target_id);
    }
    if (payload.link_target_type === 'custom' && !String(payload.button_link || '').trim()) {
        throw new Error('Custom carousel links require a URL');
    }
};

const normalizeCarouselCardPayload = (payload = {}) => {
    const sourceTypeRaw = String(payload.sourceType ?? payload.source_type ?? 'manual').toLowerCase();
    const sourceType = ['manual', 'product', 'category'].includes(sourceTypeRaw) ? sourceTypeRaw : 'manual';
    const linkTargetTypeRaw = String(payload.linkTargetType ?? payload.link_target_type ?? 'store').toLowerCase();
    const linkTargetType = ['store', 'category', 'product', 'custom'].includes(linkTargetTypeRaw) ? linkTargetTypeRaw : 'store';
    const rawDisplay = payload.displayOrder ?? payload.display_order;
    const parsedDisplay = Number(rawDisplay);
    const hasDisplayOrder = rawDisplay !== undefined && rawDisplay !== null && String(rawDisplay).trim() !== '';
    return {
        title: String(payload.title || '').trim(),
        description: String(payload.description || '').trim(),
        source_type: sourceType,
        source_id: String(payload.sourceId ?? payload.source_id ?? '').trim() || null,
        image_url: String(payload.imageUrl ?? payload.image_url ?? '').trim() || null,
        button_label: String(payload.buttonLabel ?? payload.button_label ?? '').trim(),
        link_target_type: linkTargetType,
        link_target_id: String(payload.linkTargetId ?? payload.link_target_id ?? '').trim() || null,
        button_link: String(payload.buttonLink ?? payload.button_link ?? '').trim() || '',
        status: String(payload.status || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
        display_order: Number.isFinite(parsedDisplay) ? Math.max(0, Math.trunc(parsedDisplay)) : 0,
        hasDisplayOrder
    };
};

const resolveCarouselCardImage = async (card = {}) => {
    const sourceType = String(card?.source_type || 'manual').toLowerCase();
    const sourceId = String(card?.source_id || '').trim();
    if (sourceType === 'product' && sourceId) {
        const [rows] = await db.execute('SELECT media FROM products WHERE id = ? LIMIT 1', [sourceId]);
        const media = parseMaybeJson(rows?.[0]?.media, []);
        const mediaList = Array.isArray(media) ? media : [];
        const firstImage = mediaList.find((entry) => entry && (entry.type === 'image' || !entry.type) && entry.url);
        if (firstImage?.url) return firstImage.url;
    }
    if (sourceType === 'category' && sourceId) {
        const categoryId = Number(sourceId);
        if (Number.isFinite(categoryId)) {
            const [rows] = await db.execute('SELECT image_url FROM categories WHERE id = ? LIMIT 1', [categoryId]);
            const imageUrl = String(rows?.[0]?.image_url || '').trim();
            if (imageUrl) return imageUrl;
        }
    }
    return String(card?.image_url || '').trim() || null;
};

const resolveCarouselCardLink = async (card = {}) => {
    const linkTargetType = String(card?.link_target_type || '').toLowerCase();
    const linkTargetId = String(card?.link_target_id || '').trim();
    if (linkTargetType === 'store') {
        return '/shop';
    }
    if (linkTargetType === 'product' && linkTargetId) {
        return `/product/${encodeURIComponent(linkTargetId)}`;
    }
    if (linkTargetType === 'category' && linkTargetId) {
        const categoryId = Number(linkTargetId);
        if (Number.isFinite(categoryId)) {
            const [rows] = await db.execute('SELECT name FROM categories WHERE id = ? LIMIT 1', [categoryId]);
            const categoryName = String(rows?.[0]?.name || '').trim();
            if (categoryName) {
                return `/shop/${encodeURIComponent(categoryName)}`;
            }
        }
    }
    if (linkTargetType === 'custom') {
        return String(card?.button_link || '').trim() || '';
    }

    // Backward compatibility for old rows where link target columns are absent/null.
    const sourceType = String(card?.source_type || 'manual').toLowerCase();
    const sourceId = String(card?.source_id || '').trim();
    if (sourceType === 'product' && sourceId) {
        return `/product/${encodeURIComponent(sourceId)}`;
    }
    if (sourceType === 'category' && sourceId) {
        const categoryId = Number(sourceId);
        if (Number.isFinite(categoryId)) {
            const [rows] = await db.execute('SELECT name FROM categories WHERE id = ? LIMIT 1', [categoryId]);
            const categoryName = String(rows?.[0]?.name || '').trim();
            if (categoryName) {
                return `/shop/${encodeURIComponent(categoryName)}`;
            }
        }
    }
    return String(card?.button_link || '').trim() || '';
};

// 1. GET ALL SLIDES (Public & Admin)
const getSlides = async (req, res) => {
    try {
        const auth = getOptionalAuthContext(req);
        const isAdmin = req.query.admin === 'true' && (auth.role === 'admin' || auth.role === 'staff');
        const [slides] = isAdmin
            ? await db.execute('SELECT * FROM hero_slides ORDER BY display_order ASC')
            : await db.execute("SELECT * FROM hero_slides WHERE status = 'active' ORDER BY display_order ASC");
        res.json(slides);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch slides' });
    }
};

// 1.0 GET HERO TEXTS (Public & Admin)
const getHeroTexts = async (req, res) => {
    try {
        const auth = getOptionalAuthContext(req);
        const isAdmin = req.query.admin === 'true' && (auth.role === 'admin' || auth.role === 'staff');
        const [rows] = isAdmin
            ? await db.execute('SELECT * FROM hero_texts ORDER BY display_order ASC')
            : await db.execute("SELECT * FROM hero_texts WHERE status = 'active' ORDER BY display_order ASC");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch hero texts' });
    }
};

// 1.1 GET HOME BANNER (Public & Admin)
const getBanner = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 1 LIMIT 1');
        res.json(rows[0] || null);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch banner' });
    }
};

const getSecondaryBanner = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 2 LIMIT 1');
        res.json(rows[0] || null);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch banner' });
    }
};

const getTertiaryBanner = async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 3 LIMIT 1');
        res.json(rows[0] || { id: 3, image_url: '/placeholder_banner.jpg', link: '' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch banner' });
    }
};

const getFeaturedCategory = async (req, res) => {
    try {
        const auth = getOptionalAuthContext(req);
        const isAdmin = req.query.admin === 'true' && (auth.role === 'admin' || auth.role === 'staff');
        const [rows] = await db.execute(
            `SELECT h.id, h.category_id, h.title, h.subtitle, c.name AS category_name
             FROM home_featured_category h
             LEFT JOIN categories c ON c.id = h.category_id
             WHERE h.id = 1
             LIMIT 1`
        );
        let config = rows[0] || null;
        const [autoRows] = await db.execute('SELECT is_enabled FROM cms_autopilot_config WHERE id = 1 LIMIT 1');
        const autopilotEnabled = Number(autoRows?.[0]?.is_enabled || 0) === 1;

        if (!config || !config.category_id || !config.category_name) {
            const [catRows] = await db.execute('SELECT id, name FROM categories ORDER BY name ASC LIMIT 1');
            if (catRows[0]) {
                config = {
                    id: 1,
                    category_id: catRows[0].id,
                    category_name: catRows[0].name,
                    title: config?.title || '',
                    subtitle: config?.subtitle || ''
                };
            }
        }

        const shouldApplyAutopilot = !isAdmin
            && autopilotEnabled
            && (!auth.role || auth.role === 'customer');

        if (shouldApplyAutopilot) {
            const [categoryRows] = await db.execute(
                `SELECT c.id, c.name, c.system_key, COUNT(pc.product_id) AS product_count
                 FROM categories c
                 JOIN product_categories pc ON pc.category_id = c.id
                 GROUP BY c.id, c.name, c.system_key
                 HAVING COUNT(pc.product_id) > 0
                 ORDER BY c.name ASC`
            );
            const allCategories = Array.isArray(categoryRows) ? categoryRows : [];
            if (allCategories.length > 0) {
                const userId = auth.userId;
                let seenCategoryIds = [];
                if (userId) {
                    const [seenRows] = await db.execute(
                        `SELECT DISTINCT c.id
                         FROM orders o
                         JOIN order_items oi ON oi.order_id = o.id
                         JOIN product_categories pc ON pc.product_id = oi.product_id
                         JOIN categories c ON c.id = pc.category_id
                         WHERE o.user_id = ?
                           AND o.payment_status = 'paid'`,
                        [userId]
                    );
                    seenCategoryIds = seenRows.map((row) => Number(row.id));
                }

                const selected = selectFeaturedAutopilotCategory({
                    allCategories,
                    seenCategoryIds,
                    userId
                });
                if (selected) {
                    config = {
                        ...(config || {}),
                        category_id: Number(selected.id),
                        category_name: String(selected.name || ''),
                        title: config?.title || '',
                        subtitle: config?.subtitle || '',
                        autopilot_enabled: true,
                        autopilot_applied: true,
                        autopilot_selection_source: userId ? 'personalized_category_rotation' : 'category_rotation'
                    };
                }
            }
        }

        const response = config ? { ...config } : null;
        if (!response) {
            return res.json({ autopilot_enabled: autopilotEnabled });
        }
        response.autopilot_enabled = autopilotEnabled;
        return res.json(response);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch featured category' });
    }
};

const getCarouselCards = async (req, res) => {
    try {
        const auth = getOptionalAuthContext(req);
        const canViewAdmin = auth.role === 'admin' || auth.role === 'staff';
        const isAdmin = req.query.admin === 'true' && canViewAdmin;
        const query = isAdmin
            ? 'SELECT * FROM cms_carousel_cards ORDER BY display_order ASC, id ASC'
            : "SELECT * FROM cms_carousel_cards WHERE status = 'active' ORDER BY display_order ASC, id ASC";
        const [rows] = await db.execute(query);
        const cards = await Promise.all(
            (Array.isArray(rows) ? rows : []).map(async (row) => ({
                ...row,
                resolved_image_url: await resolveCarouselCardImage(row),
                resolved_button_link: await resolveCarouselCardLink(row)
            }))
        );
        res.json(cards);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch carousel cards' });
    }
};

const getAutopilotConfig = async (_req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, is_enabled, updated_at FROM cms_autopilot_config WHERE id = 1 LIMIT 1');
        const row = rows[0] || { id: 1, is_enabled: 0, updated_at: null };
        res.json({
            id: row.id,
            is_enabled: Number(row.is_enabled || 0) === 1,
            updated_at: row.updated_at || null
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch autopilot config' });
    }
};

const updateAutopilotConfig = async (req, res) => {
    try {
        const enabled = req.body?.is_enabled === true || String(req.body?.is_enabled).toLowerCase() === 'true';
        await db.execute(
            `INSERT INTO cms_autopilot_config (id, is_enabled)
             VALUES (1, ?)
             ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)`,
            [enabled ? 1 : 0]
        );
        notifyClients(req, 'cms:autopilot_update', { is_enabled: enabled });
        res.json({ message: 'Autopilot updated', is_enabled: enabled });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update autopilot config' });
    }
};

const getCompanyInfo = async (_req, res) => {
    try {
        const profile = await CompanyProfile.get();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.json({
            company: {
                displayName: profile.displayName,
                contactNumber: profile.contactNumber,
                supportEmail: profile.supportEmail,
                address: profile.address,
                instagramUrl: profile.instagramUrl,
                youtubeUrl: profile.youtubeUrl,
                facebookUrl: profile.facebookUrl,
                whatsappNumber: profile.whatsappNumber,
                gstNumber: profile.gstNumber || '',
                taxEnabled: Boolean(profile.taxEnabled),
                contactJumbotronImageUrl: profile.contactJumbotronImageUrl,
                storefrontOpen: profile.storefrontOpen !== false,
                razorpayKeyId: profile.razorpayKeyId || '',
                razorpayEmiMinAmount: Number(profile.razorpayEmiMinAmount || 3000),
                razorpayStartingTenureMonths: Number(profile.razorpayStartingTenureMonths || 12),
                usageAudienceEnabled: profile.usageAudienceEnabled === true,
                usageAudienceMenImageUrl: profile.usageAudienceMenImageUrl || '',
                usageAudienceWomenImageUrl: profile.usageAudienceWomenImageUrl || '',
                usageAudienceKidsImageUrl: profile.usageAudienceKidsImageUrl || '',
                subCategoriesEnabled: profile.subCategoriesEnabled === true,
                updatedAt: profile.updatedAt || null
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch company info' });
    }
};

const escapeHtml = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const submitContactForm = async (req, res) => {
    try {
        const payload = req.body || {};
        const name = String(payload.name || '').trim();
        const email = String(payload.email || '').trim();
        const phone = String(payload.phone || '').trim();
        const orderId = String(payload.orderId || '').trim();
        const message = String(payload.message || '').trim();

        if (!name || !email || !message) {
            return res.status(400).json({ message: 'Name, email, and message are required' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: 'Please provide a valid email address' });
        }
        if (isContactRequestRateLimited(req, email)) {
            return res.status(429).json({ message: 'Too many contact requests. Please try again later.' });
        }

        const profile = await CompanyProfile.get();
        const to = String(profile.supportEmail || '').trim();
        if (!to) {
            return res.status(400).json({ message: 'Support email is not configured by admin' });
        }

        const subject = `Contact Request - ${profile.displayName || 'SSC Jewellery'}`;
        const text = [
            `Name: ${name}`,
            `Email: ${email}`,
            `Phone: ${phone || 'N/A'}`,
            `Order ID: ${orderId || 'N/A'}`,
            '',
            'Message:',
            message
        ].join('\n');
        const html = `
            <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6;">
                <h2 style="margin:0 0 12px;">New Contact Request</h2>
                <p><strong>Name:</strong> ${escapeHtml(name)}</p>
                <p><strong>Email:</strong> ${escapeHtml(email)}</p>
                <p><strong>Phone:</strong> ${escapeHtml(phone || 'N/A')}</p>
                <p><strong>Order ID:</strong> ${escapeHtml(orderId || 'N/A')}</p>
                <p><strong>Message:</strong></p>
                <p style="white-space:pre-line;">${escapeHtml(message)}</p>
            </div>
        `;

        await sendEmailCommunication({
            to,
            subject,
            text,
            html,
            replyTo: email
        });

        return res.json({ ok: true, message: 'Contact request submitted successfully' });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to submit contact request' });
    }
};

// 2. CREATE SLIDE
const createSlide = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'Image is required' });
        
        const imageUrl = `/uploads/hero/${req.file.filename}`;
        const { title, subtitle, link } = req.body;

        // Get max order to append at end
        const [rows] = await db.execute('SELECT MAX(display_order) as maxOrder FROM hero_slides');
        const nextOrder = (rows[0].maxOrder || 0) + 1;

        const [result] = await db.execute(
            'INSERT INTO hero_slides (image_url, title, subtitle, link, display_order) VALUES (?, ?, ?, ?, ?)',
            [imageUrl, title || '', subtitle || '', link || '', nextOrder]
        );

        notifyCmsClients(req, 'cms:hero_update', { action: 'create', id: result.insertId });
        queueStaticRefresh('cms_hero_create');
        res.status(201).json({ message: 'Slide added', id: result.insertId, imageUrl });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create slide' });
    }
};

// 2.1 UPDATE HOME BANNER (Image + Link)
const updateBanner = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 1 LIMIT 1');
        const current = rows[0] || { image_url: '', link: '' };
        const previousImageUrl = String(current.image_url || '').trim();
        const removeImage = String(req.body?.removeImage || '').toLowerCase() === 'true';
        const imageUrl = removeImage
            ? null
            : (req.file ? `/uploads/banner/${req.file.filename}` : current.image_url);
        const link = typeof req.body.link === 'string' ? req.body.link : current.link;

        await db.execute(
            'UPDATE home_banner SET image_url = ?, link = ? WHERE id = 1',
            [imageUrl, link]
        );
        if (previousImageUrl && previousImageUrl !== imageUrl) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:banner_update', { image_url: imageUrl, link });
        queueStaticRefresh('cms_banner_update');
        res.json({ message: 'Banner updated', image_url: imageUrl, link });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update banner' });
    }
};

const updateSecondaryBanner = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 2 LIMIT 1');
        const current = rows[0] || { image_url: '', link: '' };
        const previousImageUrl = String(current.image_url || '').trim();
        const removeImage = String(req.body?.removeImage || '').toLowerCase() === 'true';
        const imageUrl = removeImage
            ? null
            : (req.file ? `/uploads/banner/${req.file.filename}` : current.image_url);
        const link = typeof req.body.link === 'string' ? req.body.link : current.link;

        await db.execute(
            'UPDATE home_banner SET image_url = ?, link = ? WHERE id = 2',
            [imageUrl, link]
        );
        if (previousImageUrl && previousImageUrl !== imageUrl) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:banner_secondary_update', { image_url: imageUrl, link });
        queueStaticRefresh('cms_banner_secondary_update');
        res.json({ message: 'Banner updated', image_url: imageUrl, link });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update banner' });
    }
};

const updateTertiaryBanner = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM home_banner WHERE id = 3 LIMIT 1');
        const current = rows[0] || { image_url: '', link: '' };
        const previousImageUrl = String(current.image_url || '').trim();
        const removeImage = String(req.body?.removeImage || '').toLowerCase() === 'true';
        const imageUrl = removeImage
            ? null
            : (req.file ? `/uploads/banner/${req.file.filename}` : current.image_url);
        const link = typeof req.body.link === 'string' ? req.body.link : current.link;

        await db.execute(
            `INSERT INTO home_banner (id, image_url, link)
             VALUES (3, ?, ?)
             ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), link = VALUES(link)`,
            [imageUrl, link]
        );
        if (previousImageUrl && previousImageUrl !== imageUrl) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:banner_tertiary_update', { image_url: imageUrl, link });
        queueStaticRefresh('cms_banner_tertiary_update');
        res.json({ message: 'Banner updated', image_url: imageUrl, link });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update banner' });
    }
};

const updateFeaturedCategory = async (req, res) => {
    try {
        const { categoryId, title, subtitle } = req.body;
        if (categoryId != null && categoryId !== '') {
            await ensureCategoryExists(categoryId);
        }
        await db.execute(
            'UPDATE home_featured_category SET category_id = ?, title = ?, subtitle = ? WHERE id = 1',
            [categoryId || null, title || '', subtitle || '']
        );
        const [rows] = await db.execute(
            `SELECT h.id, h.category_id, h.title, h.subtitle, c.name AS category_name
             FROM home_featured_category h
             LEFT JOIN categories c ON c.id = h.category_id
             WHERE h.id = 1
             LIMIT 1`
        );
        const payload = rows[0] || { category_id: categoryId || null, title: title || '', subtitle: subtitle || '' };
        notifyCmsClients(req, 'cms:featured_category_update', payload);
        queueStaticRefresh('cms_featured_category_update');
        res.json({ message: 'Featured category updated', ...payload });
    } catch (error) {
        const statusCode = /category/i.test(String(error?.message || '')) ? 400 : 500;
        res.status(statusCode).json({ message: error?.message || 'Failed to update featured category' });
    }
};

const createCarouselCard = async (req, res) => {
    try {
        const payload = normalizeCarouselCardPayload(req.body || {});
        await validateCarouselCardPayload(payload);
        let orderValue = payload.display_order;
        if (!payload.hasDisplayOrder) {
            const [maxRows] = await db.execute('SELECT MAX(display_order) AS maxOrder FROM cms_carousel_cards');
            orderValue = Number(maxRows?.[0]?.maxOrder ?? -1) + 1;
        }
        const [result] = await db.execute(
            `INSERT INTO cms_carousel_cards
             (title, description, source_type, source_id, image_url, button_label, link_target_type, link_target_id, button_link, status, display_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.title,
                payload.description,
                payload.source_type,
                payload.source_id,
                payload.image_url,
                payload.button_label,
                payload.link_target_type,
                payload.link_target_id,
                await resolveCarouselCardLink(payload),
                payload.status,
                orderValue
            ]
        );
        notifyCmsClients(req, 'cms:carousel_cards_update', { action: 'create', id: result.insertId });
        queueStaticRefresh('cms_carousel_create');
        res.status(201).json({ message: 'Carousel card created', id: result.insertId });
    } catch (error) {
        res.status(400).json({ message: error?.message || 'Failed to create carousel card' });
    }
};

const updateCarouselCard = async (req, res) => {
    try {
        const cardId = Number(req.params.id);
        if (!Number.isFinite(cardId)) {
            return res.status(400).json({ message: 'Invalid card id' });
        }
        const [existingRows] = await db.execute('SELECT * FROM cms_carousel_cards WHERE id = ? LIMIT 1', [cardId]);
        const existing = existingRows?.[0];
        if (!existing) {
            return res.status(404).json({ message: 'Carousel card not found' });
        }
        const previousImageUrl = String(existing.image_url || '').trim();
        const payload = normalizeCarouselCardPayload(req.body || {});
        await validateCarouselCardPayload(payload);
        const orderValue = payload.hasDisplayOrder ? payload.display_order : Number(existing.display_order || 0);
        await db.execute(
            `UPDATE cms_carousel_cards
             SET title = ?, description = ?, source_type = ?, source_id = ?, image_url = ?, button_label = ?, link_target_type = ?, link_target_id = ?, button_link = ?, status = ?, display_order = ?
             WHERE id = ?`,
            [
                payload.title,
                payload.description,
                payload.source_type,
                payload.source_id,
                payload.image_url,
                payload.button_label,
                payload.link_target_type,
                payload.link_target_id,
                await resolveCarouselCardLink(payload),
                payload.status,
                orderValue,
                cardId
            ]
        );
        if (previousImageUrl && previousImageUrl !== payload.image_url && isUploadedCarouselAsset(previousImageUrl)) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:carousel_cards_update', { action: 'update', id: cardId });
        queueStaticRefresh('cms_carousel_update');
        res.json({ message: 'Carousel card updated', id: cardId });
    } catch (error) {
        const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 400;
        res.status(statusCode).json({ message: error?.message || 'Failed to update carousel card' });
    }
};

const deleteCarouselCard = async (req, res) => {
    try {
        const cardId = Number(req.params.id);
        if (!Number.isFinite(cardId)) {
            return res.status(400).json({ message: 'Invalid card id' });
        }
        const [existingRows] = await db.execute('SELECT id FROM cms_carousel_cards WHERE id = ? LIMIT 1', [cardId]);
        const existing = existingRows?.[0] || null;
        if (!existing) {
            return res.status(404).json({ message: 'Carousel card not found' });
        }
        const [imageRows] = await db.execute('SELECT image_url FROM cms_carousel_cards WHERE id = ? LIMIT 1', [cardId]);
        const previousImageUrl = String(imageRows?.[0]?.image_url || '').trim();
        await db.execute('DELETE FROM cms_carousel_cards WHERE id = ?', [cardId]);
        if (previousImageUrl && isUploadedCarouselAsset(previousImageUrl)) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:carousel_cards_update', { action: 'delete', id: cardId });
        queueStaticRefresh('cms_carousel_delete');
        res.json({ message: 'Carousel card deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete carousel card' });
    }
};

// HERO TEXTS: CREATE
const createHeroText = async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !String(text).trim()) {
            return res.status(400).json({ message: 'Text is required' });
        }
        const [rows] = await db.execute('SELECT MAX(display_order) as maxOrder FROM hero_texts');
        const nextOrder = (rows[0].maxOrder || 0) + 1;
        const [result] = await db.execute(
            'INSERT INTO hero_texts (text, display_order, status) VALUES (?, ?, ?)',
            [String(text).trim(), nextOrder, 'active']
        );
        notifyCmsClients(req, 'cms:texts_update', { action: 'create', id: result.insertId });
        queueStaticRefresh('cms_text_create');
        res.status(201).json({ message: 'Text added', id: result.insertId });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create hero text' });
    }
};

// HERO TEXTS: UPDATE
const updateHeroText = async (req, res) => {
    try {
        const { text, status } = req.body;
        await ensureRowExists({ table: 'hero_texts', id: req.params.id });
        await db.execute(
            'UPDATE hero_texts SET text = ?, status = ? WHERE id = ?',
            [text || '', status || 'active', req.params.id]
        );
        notifyCmsClients(req, 'cms:texts_update', { action: 'update', id: req.params.id });
        queueStaticRefresh('cms_text_update');
        res.json({ message: 'Text updated' });
    } catch (error) {
        const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 500;
        res.status(statusCode).json({ message: error?.message || 'Failed to update hero text' });
    }
};

// HERO TEXTS: DELETE
const deleteHeroText = async (req, res) => {
    try {
        await ensureRowExists({ table: 'hero_texts', id: req.params.id });
        await db.execute('DELETE FROM hero_texts WHERE id = ?', [req.params.id]);
        notifyCmsClients(req, 'cms:texts_update', { action: 'delete', id: req.params.id });
        queueStaticRefresh('cms_text_delete');
        res.json({ message: 'Text deleted' });
    } catch (error) {
        const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 500;
        res.status(statusCode).json({ message: error?.message || 'Failed to delete hero text' });
    }
};

// HERO TEXTS: REORDER
const reorderHeroTexts = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { textIds } = req.body;
        if (!Array.isArray(textIds) || !textIds.length) {
            return res.status(400).json({ message: 'Text order is required' });
        }
        await connection.beginTransaction();
        for (let i = 0; i < textIds.length; i++) {
            await connection.execute(
                'UPDATE hero_texts SET display_order = ? WHERE id = ?',
                [i, textIds[i]]
            );
        }
        await connection.commit();
        notifyCmsClients(req, 'cms:texts_update', { action: 'reorder', textIds });
        queueStaticRefresh('cms_text_reorder');
        res.json({ message: 'Order updated' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: 'Reorder failed' });
    } finally {
        connection.release();
    }
};

// 3. DELETE SLIDE
const deleteSlide = async (req, res) => {
    try {
        const slideId = await ensureRowExists({ table: 'hero_slides', id: req.params.id });
        const [rows] = await db.execute('SELECT image_url FROM hero_slides WHERE id = ? LIMIT 1', [slideId]);
        const previousImageUrl = String(rows?.[0]?.image_url || '').trim();
        await db.execute('DELETE FROM hero_slides WHERE id = ?', [req.params.id]);
        if (previousImageUrl) {
            await removeCmsAssetIfUploaded(previousImageUrl);
        }
        notifyCmsClients(req, 'cms:hero_update', { action: 'delete', id: req.params.id });
        queueStaticRefresh('cms_hero_delete');
        res.json({ message: 'Slide deleted' });
    } catch (error) {
        const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 500;
        res.status(statusCode).json({ message: error?.message || 'Failed to delete slide' });
    }
};

// 4. REORDER SLIDES
const reorderSlides = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { slideIds } = req.body; // Array of IDs in new order
        if (!Array.isArray(slideIds) || !slideIds.length) {
            return res.status(400).json({ message: 'Slide order is required' });
        }
        await connection.beginTransaction();

        for (let i = 0; i < slideIds.length; i++) {
            await connection.execute(
                'UPDATE hero_slides SET display_order = ? WHERE id = ?',
                [i, slideIds[i]]
            );
        }

        await connection.commit();
        notifyCmsClients(req, 'cms:hero_update', { action: 'reorder', slideIds });
        queueStaticRefresh('cms_hero_reorder');
        res.json({ message: 'Order updated' });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: 'Reorder failed' });
    } finally {
        connection.release();
    }
};

// 5. UPDATE SLIDE (Status/Text)
const updateSlide = async (req, res) => {
    try {
        const { title, subtitle, link, status } = req.body;
        await ensureRowExists({ table: 'hero_slides', id: req.params.id });
        await db.execute(
            'UPDATE hero_slides SET title = ?, subtitle = ?, link = ?, status = ? WHERE id = ?',
            [title, subtitle, link, status, req.params.id]
        );
        notifyCmsClients(req, 'cms:hero_update', { action: 'update', id: req.params.id });
        queueStaticRefresh('cms_hero_update');
        res.json({ message: 'Slide updated' });
    } catch (error) {
        const statusCode = /not found/i.test(String(error?.message || '')) ? 404 : 500;
        res.status(statusCode).json({ message: error?.message || 'Update failed' });
    }
};

module.exports = {
    getSlides,
    getHeroTexts,
    getBanner,
    getSecondaryBanner,
    getTertiaryBanner,
    getFeaturedCategory,
    getCarouselCards,
    getAutopilotConfig,
    submitContactForm,
    getCompanyInfo,
    createSlide,
    updateBanner,
    updateSecondaryBanner,
    updateTertiaryBanner,
    updateFeaturedCategory,
    createCarouselCard,
    updateCarouselCard,
    deleteCarouselCard,
    updateAutopilotConfig,
    createHeroText,
    updateHeroText,
    deleteHeroText,
    reorderHeroTexts,
    deleteSlide,
    reorderSlides,
    updateSlide
};
