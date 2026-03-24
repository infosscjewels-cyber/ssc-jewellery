console.log('Boot: entering server/index.js');
process.on('uncaughtException', (error) => {
    console.error('FATAL uncaughtException:', error?.stack || error?.message || error);
    process.exit(1);
});
process.on('unhandledRejection', (error) => {
    console.error('FATAL unhandledRejection:', error?.stack || error?.message || error);
    process.exit(1);
});

const path = require('path');
const fs = require('fs');
const http = require('http'); // [NEW] Import HTTP
const { Server } = require('socket.io'); // [NEW] Import Socket.io
const jwt = require('jsonwebtoken');

const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';
const shouldRunBackgroundJobs = isProduction || ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_BACKGROUND_JOBS_IN_DEV || '').trim().toLowerCase());
const projectRoot = path.join(__dirname, '..');
const rootDevEnvPath = path.join(projectRoot, '.env.dev');
const rootEnvPath = path.join(projectRoot, '.env');
const serverDevEnvPath = path.join(__dirname, '.env.dev');

if (isProduction) {
    if (fs.existsSync(rootEnvPath)) {
        require('dotenv').config({ path: rootEnvPath });
        console.log("🚀 PRODUCTION MODE: Loaded root .env");
    } else {
        require('dotenv').config();
        console.log("🚀 PRODUCTION MODE: Loaded default .env");
    }
} else {
    if (fs.existsSync(rootDevEnvPath)) {
        require('dotenv').config({ path: rootDevEnvPath });
        console.log("🛠️  DEVELOPMENT MODE: Loaded root .env.dev");
    } else if (fs.existsSync(serverDevEnvPath)) {
        require('dotenv').config({ path: serverDevEnvPath });
        console.log("🛠️  DEVELOPMENT MODE: Loaded server/.env.dev");
    } else if (fs.existsSync(rootEnvPath)) {
        require('dotenv').config({ path: rootEnvPath });
        console.log("🛠️  DEVELOPMENT MODE: Loaded root .env");
    } else {
        require('dotenv').config();
        console.log("🛠️  DEVELOPMENT MODE: Loaded default .env");
    }
}

if (!String(process.env.JWT_SECRET || '').trim()) {
    console.error('FATAL: JWT_SECRET is missing. Set JWT_SECRET in your environment before starting the server.');
    process.exit(1);
}
console.log('Boot: JWT secret present');

const { getSocketRoomsForUser, canAuthenticateSocketUser } = require('./utils/socketAudience');
const { getUploadsRoot } = require('./utils/uploadsRoot');
const { resolveBrandingAsset } = require('./utils/brandingAssets');
const db = require('./config/db');
console.log('Boot: DB module loaded');

const express = require('express');
const cors = require('cors');
console.log('Boot: core packages loaded');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const productRoutes = require('./routes/productRoutes');
const cmsRoutes = require('./routes/cmsRoutes');
const cartRoutes = require('./routes/cartRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const shippingRoutes = require('./routes/shippingRoutes');
const orderRoutes = require('./routes/orderRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
console.log('Boot: route modules loaded');
const Order = require('./models/Order');
const User = require('./models/User');
const { PaymentAttempt } = require('./models/PaymentAttempt');
console.log('Boot: model modules loaded');
const { sendOrderLifecycleCommunication } = require('./services/communications/communicationService');
const { buildDeliveryConfirmationUrl } = require('./services/deliveryConfirmationService');
const {
    startAbandonedCartRecoveryScheduler,
    startAbandonedCartMaintenanceScheduler,
    setKnownPublicOriginFromRequest
} = require('./services/abandonedCartRecoveryService');
const { runMonthlyLoyaltyReassessment, ensureLoyaltyConfigLoaded, issueBirthdayCouponsForEligibleUsersToday } = require('./services/loyaltyService');
const { runDashboardAlertsJob, refreshDashboardDailyAggregates } = require('./controllers/adminController');
const {
    processQueuedCommunicationRetries,
    pruneCommunicationDeliveryLogs
} = require('./services/communications/communicationRetryService');
const {
    buildRobotsTxt,
    buildSitemapXml,
    initSeoAutomation,
    loadSitemapEntries,
    renderRouteHtml
} = require('./services/seoService');
const {
    refreshEnabledCategoryAutopilotCatalogs
} = require('./services/categoryAutopilotService');
const sanitizeRequest = require('./middleware/sanitizeRequest');
console.log('Boot: service and middleware modules loaded');

const app = express();
const server = http.createServer(app); // [NEW] Wrap Express app
console.log('Boot: express app created');

const buildSocketCorsOrigins = () => {
    const rawOrigins = [
        process.env.APP_BASE_URL,
        process.env.CLIENT_BASE_URL,
        process.env.FRONTEND_URL
    ]
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim().replace(/\/+$/, ''))
        .filter(Boolean);

    if (rawOrigins.length > 0) {
        return Array.from(new Set(rawOrigins));
    }

    if (!isProduction) {
        return ['http://localhost:5173', 'http://localhost:3000'];
    }

    return true;
};

// [NEW] Setup Socket.io
const io = new Server(server, {
    cors: {
        origin: buildSocketCorsOrigins(),
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    socket.on('auth', async (payload = {}) => {
        try {
            const token = String(payload.token || '').trim();
            if (!token || token === 'undefined' || token === 'null') {
                socket.emit('auth:error', { message: 'Authentication token is required' });
                return;
            }
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = decoded?.id ? String(decoded.id) : '';
            if (!userId) {
                socket.emit('auth:error', { message: 'Invalid socket token payload' });
                return;
            }
            const user = await User.findById(userId);
            if (!user || !canAuthenticateSocketUser(user)) {
                socket.emit('auth:error', { message: user ? 'Socket user is inactive' : 'Socket user not found' });
                return;
            }

            const normalizedRole = String(user.role || '').toLowerCase();
            const joinedRooms = [...socket.rooms].filter((room) => room !== socket.id);
            joinedRooms.forEach((room) => socket.leave(room));
            getSocketRoomsForUser({ userId, role: normalizedRole }).forEach((room) => socket.join(room));
            socket.data.userId = userId;
            socket.data.role = normalizedRole;
            socket.emit('auth:ok', { userId, role: normalizedRole });
        } catch (error) {
            socket.emit('auth:error', { message: 'Socket authentication failed' });
        }
    });
});

// [NEW] Make 'io' accessible in controllers via req.app.get('io')
app.set('io', io);

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use((req, _res, next) => {
    setKnownPublicOriginFromRequest(req);
    next();
});
app.use(express.json({
    verify: (req, _res, buf) => {
        if (req.originalUrl?.startsWith('/api/orders/razorpay/webhook')) {
            req.rawBody = buf.toString('utf8');
        }
    }
}));
app.use(sanitizeRequest);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/uploads', express.static(getUploadsRoot(), {
    setHeaders: (res, filePath) => {
        const normalizedPath = String(filePath || '').replace(/\\/g, '/');
        if (normalizedPath.includes('/banner/')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));
app.get(['/branding/logo', '/branding/logo.webp'], async (_req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const asset = await resolveBrandingAsset('logo');
        if (asset?.mode === 'redirect') return res.redirect(asset.target);
        if (asset?.target) return res.sendFile(asset.target);
        return next();
    } catch (error) {
        console.error('Failed to resolve branding logo:', error?.message || error);
        return next();
    }
});
app.get('/favicon.ico', async (_req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const asset = await resolveBrandingAsset('favicon');
        if (asset?.mode === 'redirect') return res.redirect(asset.target);
        if (asset?.target) return res.sendFile(asset.target);
        return next();
    } catch (error) {
        console.error('Failed to resolve favicon:', error?.message || error);
        return next();
    }
});
app.get('/apple-touch-icon.png', async (_req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        const asset = await resolveBrandingAsset('appleTouchIcon');
        if (asset?.mode === 'redirect') return res.redirect(asset.target);
        if (asset?.target) return res.sendFile(asset.target);
        return next();
    } catch (error) {
        console.error('Failed to resolve apple touch icon:', error?.message || error);
        return next();
    }
});
app.get([
    '/',
    '/shop',
    '/about',
    '/site-credits',
    '/sitemap',
    '/faq',
    '/contact',
    '/terms',
    '/shipping',
    '/refund',
    '/privacy',
    '/copyright',
    '/product/:id',
    '/shop/:category'
], async (req, res, next) => {
    try {
        const html = await renderRouteHtml(req.path);
        if (!html) return next();
        return res.type('html').send(html);
    } catch (error) {
        console.error(`SEO HTML render failed for ${req.path}:`, error?.message || error);
        return next();
    }
});
app.get('/robots.txt', (_req, res) => {
    const origin = `${_req.protocol}://${_req.get('host')}`;
    res.type('text/plain').send(buildRobotsTxt(origin));
});
app.get('/sitemap.xml', async (req, res) => {
    try {
        const entries = await loadSitemapEntries();
        const origin = `${req.protocol}://${req.get('host')}`;
        res.type('application/xml').send(buildSitemapXml(entries, origin));
    } catch (error) {
        console.error('Failed to generate sitemap.xml:', error?.message || error);
        const origin = `${req.protocol}://${req.get('host')}`;
        res.status(500).type('application/xml').send(buildSitemapXml([], origin));
    }
});
// Serve Frontend
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// [CHANGE] Use server.listen instead of app.listen
const startServer = async () => {
    console.log('Boot: startServer invoked');
    try {
        if (db?.ready && typeof db.ready.then === 'function') {
            console.log('Boot: waiting for DB readiness');
            await db.ready;
            console.log('Boot: DB ready');
        } else {
            console.log('Boot: DB readiness promise not found, continuing');
        }
        if (isProduction) {
            console.log('Boot: initializing SEO automation');
            await initSeoAutomation();
            console.log('Boot: SEO automation initialized');
        } else {
            console.log('Boot: skipping SEO automation in development');
        }
    } catch (error) {
        console.error('Database bootstrap failed. Server not started:', error?.message || error);
        process.exit(1);
    }
    initBackgroundJobs();
    console.log(`Boot: starting HTTP server on port ${PORT}`);
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

const scheduleMidnightJob = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
        try {
            const result = await Order.markStaleAsPending();
            const ids = Array.isArray(result?.ids) ? result.ids : [];
            if (ids.length > 0) {
                for (const orderId of ids) {
                    try {
                        const order = await Order.getById(orderId);
                        if (!order?.user_id) continue;
                        const customer = await User.findById(order.user_id);
                        if (!customer?.email) continue;
                        await sendOrderLifecycleCommunication({
                            stage: 'pending_delay',
                            customer,
                            order
                        });
                    } catch (error) {
                        console.error(`Pending-delay email failed for order ${orderId}:`, error?.message || error);
                    }
                }
            }
            const reminderCandidates = await Order.getShippedOrdersForCustomerConfirmation({ afterDays: 7, limit: 300 });
            for (const order of reminderCandidates) {
                try {
                    if (!order?.user_id) continue;
                    const customer = await User.findById(order.user_id);
                    if (!customer?.email) continue;
                    const deliveryConfirmUrl = buildDeliveryConfirmationUrl({
                        orderId: order.id,
                        userId: order.user_id
                    });
                    if (!deliveryConfirmUrl) continue;
                    await sendOrderLifecycleCommunication({
                        stage: 'shipped_followup',
                        customer,
                        order: {
                            ...order,
                            delivery_confirmation_url: deliveryConfirmUrl
                        }
                    });
                    await Order.markDeliveryConfirmationReminderSent(order.id);
                } catch (error) {
                    console.error(`Shipped follow-up email failed for order ${order?.id || 'unknown'}:`, error?.message || error);
                }
            }
        } catch (error) {
            console.error('Order pending job failed:', error);
        }
        scheduleMidnightJob();
    }, delay);
};

const schedulePaymentAttemptExpiryJob = () => {
    const intervalMs = 5 * 60 * 1000;
    setInterval(async () => {
        try {
            await PaymentAttempt.expireStaleAttempts({ ttlMinutes: 30 });
        } catch (error) {
            console.error('Payment attempt expiry job failed:', error);
        }
    }, intervalMs);
};

const scheduleMonthlyLoyaltyReassessment = () => {
    let lastRunKey = '';
    const runIfWindow = async () => {
        try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).formatToParts(now).reduce((acc, part) => {
                if (part.type !== 'literal') acc[part.type] = part.value;
                return acc;
            }, {});
            const year = parts.year;
            const month = parts.month;
            const day = Number(parts.day || 0);
            const hour = Number(parts.hour || 0);
            const minute = Number(parts.minute || 0);
            const runKey = `${year}-${month}`;
            const inWindow = day === 1 && hour === 0 && minute >= 30 && minute < 45;
            if (!inWindow || lastRunKey === runKey) return;
            const result = await runMonthlyLoyaltyReassessment();
            lastRunKey = runKey;
            console.log('Monthly loyalty reassessment completed:', result);
        } catch (error) {
            console.error('Monthly loyalty reassessment failed:', error);
        }
    };

    setInterval(runIfWindow, 15 * 60 * 1000);
    runIfWindow();
};

const scheduleDailyBirthdayCoupons = () => {
    let lastRunKey = '';
    const runIfWindow = async () => {
        try {
            const now = new Date();
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).formatToParts(now).reduce((acc, part) => {
                if (part.type !== 'literal') acc[part.type] = part.value;
                return acc;
            }, {});
            const runKey = `${parts.year}-${parts.month}-${parts.day}`;
            const hour = Number(parts.hour || 0);
            const minute = Number(parts.minute || 0);
            const inWindow = hour === 9 && minute >= 0 && minute < 20;
            if (!inWindow || lastRunKey === runKey) return;
            const result = await issueBirthdayCouponsForEligibleUsersToday();
            lastRunKey = runKey;
            console.log('Daily birthday coupon job completed:', result);
        } catch (error) {
            console.error('Daily birthday coupon job failed:', error);
        }
    };
    setInterval(runIfWindow, 10 * 60 * 1000);
    runIfWindow();
};

const scheduleDashboardAlerts = () => {
    const run = async () => {
        try {
            await runDashboardAlertsJob();
        } catch (error) {
            console.error('Dashboard alert scheduler failed:', error?.message || error);
        }
    };
    setInterval(run, 10 * 60 * 1000);
    run();
};

const scheduleDashboardAggregatesRefresh = () => {
    const run = async () => {
        try {
            await refreshDashboardDailyAggregates({ lookbackDays: 120 });
        } catch (error) {
            console.error('Dashboard aggregate refresh failed:', error?.message || error);
        }
    };
    setInterval(run, 60 * 60 * 1000);
    run();
};

const scheduleCommunicationRetryProcessing = () => {
    const run = async () => {
        try {
            await processQueuedCommunicationRetries();
        } catch (error) {
            console.error('Communication retry scheduler failed:', error?.message || error);
        }
    };
    setInterval(run, 5 * 60 * 1000);
    run();
};

const scheduleCommunicationRetryMaintenance = () => {
    const run = async () => {
        try {
            await pruneCommunicationDeliveryLogs();
        } catch (error) {
            console.error('Communication retry maintenance failed:', error?.message || error);
        }
    };
    setInterval(run, 12 * 60 * 60 * 1000);
    run();
};

const scheduleCategoryAutopilotRefresh = () => {
    const run = async ({ force = false } = {}) => {
        try {
            const results = await refreshEnabledCategoryAutopilotCatalogs({
                force,
                staleOnly: !force
            });
            if (force || (Array.isArray(results) && results.length > 0)) {
                console.log('Category auto-pilot refresh completed:', Array.isArray(results) ? results.length : 0);
            }
        } catch (error) {
            console.error('Category auto-pilot refresh failed:', error?.message || error);
        }
    };

    setInterval(() => run({ force: false }), 12 * 60 * 60 * 1000);
    run({ force: false });
};

let backgroundJobsStarted = false;
const broadcastJourneyUpdate = (payload = {}) => {
    io.to('admin').emit('abandoned_cart:journey:update', {
        ...payload,
        ts: new Date().toISOString()
    });
};

const initBackgroundJobs = () => {
    if (backgroundJobsStarted) return;
    if (!shouldRunBackgroundJobs) {
        console.log('Boot: background jobs disabled for this environment');
        return;
    }
    backgroundJobsStarted = true;
    console.log('Boot: starting background jobs');

    scheduleMidnightJob();
    schedulePaymentAttemptExpiryJob();
    ensureLoyaltyConfigLoaded({ force: true }).catch(() => {});
    scheduleMonthlyLoyaltyReassessment();
    scheduleDailyBirthdayCoupons();
    scheduleDashboardAlerts();
    scheduleDashboardAggregatesRefresh();
    scheduleCommunicationRetryProcessing();
    scheduleCommunicationRetryMaintenance();
    scheduleCategoryAutopilotRefresh();
    startAbandonedCartRecoveryScheduler({ onJourneyUpdate: broadcastJourneyUpdate });
    startAbandonedCartMaintenanceScheduler({ onJourneyUpdate: broadcastJourneyUpdate });
};

startServer();
