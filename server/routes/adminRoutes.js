const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');
const { getUsers, createUser, deleteUser, setUserStatus, resetUserPassword, getUserCart, addUserCartItem, updateUserCartItem, removeUserCartItem, clearUserCart, getUserCartSummary, getUserAvailableCoupons, verifyEmailChannel, sendTestEmail, sendTestWhatsapp, getCompanyInfo, updateCompanyInfo, listTaxConfigs, createTaxConfig, updateTaxConfig, deleteTaxConfig, getLoyaltyConfig, updateLoyaltyConfig, getLoyaltyPopupConfig, updateLoyaltyPopupConfig, listLoyaltyPopupTemplates, createLoyaltyPopupTemplate, updateLoyaltyPopupTemplate, deleteLoyaltyPopupTemplate, listCoupons, createCoupon, deleteCoupon, deleteUserCoupon, issueCouponToUser, getUserActiveCoupons, getDashboardInsights, getDashboardOverview, getDashboardTrends, getDashboardFunnel, getDashboardProducts, getDashboardCustomers, getDashboardActions, listDashboardGoals, upsertDashboardGoal, deleteDashboardGoal, getDashboardAlertSettings, updateDashboardAlertSettings, runDashboardAlerts, trackDashboardEvent } = require('../controllers/adminController');
const { getZones, createZone, updateZone, deleteZone } = require('../controllers/shippingController');
const {
    getAbandonedCartCampaign,
    updateAbandonedCartCampaign,
    processAbandonedCartRecoveriesNow,
    listAbandonedCartJourneys,
    getAbandonedCartJourneyTimeline,
    getAbandonedCartInsights,
    getCommunicationDeliveryLogs
} = require('../controllers/communicationsController');

// All routes here require login (protect) and must be either Admin or Staff
router.use(protect);
router.use(authorize('admin', 'staff'));

router.get('/users', getUsers);
router.get('/dashboard/insights', getDashboardInsights);
router.get('/dashboard/overview', getDashboardOverview);
router.get('/dashboard/trends', getDashboardTrends);
router.get('/dashboard/funnel', getDashboardFunnel);
router.get('/dashboard/products', getDashboardProducts);
router.get('/dashboard/customers', getDashboardCustomers);
router.get('/dashboard/actions', getDashboardActions);
router.get('/dashboard/goals', listDashboardGoals);
router.post('/dashboard/goals', upsertDashboardGoal);
router.put('/dashboard/goals/:id', upsertDashboardGoal);
router.delete('/dashboard/goals/:id', deleteDashboardGoal);
router.get('/dashboard/alerts', getDashboardAlertSettings);
router.put('/dashboard/alerts', updateDashboardAlertSettings);
router.post('/dashboard/alerts/run', runDashboardAlerts);
router.post('/dashboard/events', trackDashboardEvent);
router.post('/users', createUser);
router.delete('/users/:id', deleteUser);
router.put('/users/:id/status', setUserStatus);
router.get('/users/:id/cart', getUserCart);
router.post('/users/:id/cart/items', addUserCartItem);
router.put('/users/:id/cart/items', updateUserCartItem);
router.delete('/users/:id/cart/items', removeUserCartItem);
router.delete('/users/:id/cart', clearUserCart);
router.post('/users/:id/cart/summary', getUserCartSummary);
router.get('/users/:id/coupons/available', getUserAvailableCoupons);
router.get('/users/:id/coupons/active', getUserActiveCoupons);
router.post('/users/:id/coupons', issueCouponToUser);
router.delete('/users/:id/coupons/:couponId', deleteUserCoupon);

// ✅ REVERTED TO ORIGINAL PATH:
router.put('/users/:id/reset-password', resetUserPassword);

router.get('/shipping/zones', getZones);
router.post('/shipping/zones', createZone);
router.put('/shipping/zones/:id', updateZone);
router.delete('/shipping/zones/:id', deleteZone);

// Communications (Email now, WhatsApp later)
router.get('/communications/email/verify', verifyEmailChannel);
router.post('/communications/email/test', sendTestEmail);
router.post('/communications/whatsapp/test', sendTestWhatsapp);
router.get('/communications/delivery-logs', getCommunicationDeliveryLogs);
router.get('/communications/abandoned-carts/campaign', getAbandonedCartCampaign);
router.put('/communications/abandoned-carts/campaign', updateAbandonedCartCampaign);
router.post('/communications/abandoned-carts/process', processAbandonedCartRecoveriesNow);
router.get('/communications/abandoned-carts/insights', getAbandonedCartInsights);
router.get('/communications/abandoned-carts/journeys', listAbandonedCartJourneys);
router.get('/communications/abandoned-carts/journeys/:id/timeline', getAbandonedCartJourneyTimeline);
router.get('/company-info', getCompanyInfo);
router.put('/company-info', updateCompanyInfo);
router.get('/taxes', listTaxConfigs);
router.post('/taxes', createTaxConfig);
router.put('/taxes/:id', updateTaxConfig);
router.delete('/taxes/:id', deleteTaxConfig);
router.get('/loyalty/config', getLoyaltyConfig);
router.put('/loyalty/config', updateLoyaltyConfig);
router.get('/loyalty/popup', getLoyaltyPopupConfig);
router.put('/loyalty/popup', updateLoyaltyPopupConfig);
router.get('/loyalty/popup/templates', listLoyaltyPopupTemplates);
router.post('/loyalty/popup/templates', createLoyaltyPopupTemplate);
router.put('/loyalty/popup/templates/:id', updateLoyaltyPopupTemplate);
router.delete('/loyalty/popup/templates/:id', deleteLoyaltyPopupTemplate);
router.get('/loyalty/coupons', listCoupons);
router.post('/loyalty/coupons', createCoupon);
router.delete('/loyalty/coupons/:couponId', deleteCoupon);

module.exports = router;
