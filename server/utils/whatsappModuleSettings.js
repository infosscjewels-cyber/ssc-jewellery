const DEFAULT_WHATSAPP_MODULE_SETTINGS = {
    loginOtp: true,
    order: true,
    payment: true,
    welcome: true,
    loyaltyUpgrade: true,
    loyaltyProgress: true,
    birthday: true,
    abandonedCartRecovery: true,
    couponIssue: true,
    dashboardAlert: true
};

const normalizeWhatsappModuleSettings = (value = null) => {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            parsed = null;
        }
    }
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    return {
        ...DEFAULT_WHATSAPP_MODULE_SETTINGS,
        loginOtp: source.loginOtp !== false,
        order: source.order !== false,
        payment: source.payment !== false,
        welcome: source.welcome !== false,
        loyaltyUpgrade: source.loyaltyUpgrade !== false,
        loyaltyProgress: source.loyaltyProgress !== false,
        birthday: source.birthday !== false,
        abandonedCartRecovery: source.abandonedCartRecovery !== false,
        couponIssue: source.couponIssue !== false,
        dashboardAlert: source.dashboardAlert !== false
    };
};

module.exports = {
    DEFAULT_WHATSAPP_MODULE_SETTINGS,
    normalizeWhatsappModuleSettings
};
