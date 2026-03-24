const https = require('https');
const db = require('../../../config/db');
const { resolveWorkflowContent } = require('./whatsappContentRepo');
const { normalizeWhatsappModuleSettings } = require('../../../utils/whatsappModuleSettings');

const PROVIDER_NAME = 'mydreamstechnology';
const API_ENDPOINT = String(process.env.WHATSAPP_API_ENDPOINT || 'https://wa.mydreamstechnology.in/api/sendtemplate.php').trim();
const LICENSE_NUMBER = String(process.env.WHATSAPP_LICENSE_NUMBER || '').trim();
const API_KEY = String(process.env.WHATSAPP_API_KEY || '').trim();
const REQUEST_TIMEOUT_MS = Math.max(2000, Number(process.env.WHATSAPP_TIMEOUT_MS || 15000));
const ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.WHATSAPP_ENABLED || '').trim().toLowerCase())
    || Boolean(LICENSE_NUMBER && API_KEY);
const DB_CHANNEL_CACHE_TTL_MS = 15 * 1000;
let cachedDbChannelState = {
    masterEnabled: true,
    moduleSettings: normalizeWhatsappModuleSettings(null),
    ts: 0
};
const WORKFLOW_MODULE_MAP = {
    otp: 'loginOtp',
    login_otp: 'loginOtp',
    order: 'order',
    payment: 'payment',
    welcome: 'welcome',
    loyalty_upgrade: 'loyaltyUpgrade',
    loyalty_progress: 'loyaltyProgress',
    birthday: 'birthday',
    abandoned_cart_recovery: 'abandonedCartRecovery',
    coupon_issue: 'couponIssue',
    dashboard_alert: 'dashboardAlert'
};

const WORKFLOW_TEMPLATES = {
    default: String(process.env.WHATSAPP_TEMPLATE_DEFAULT || '').trim(),
    generic: String(process.env.WHATSAPP_TEMPLATE_GENERIC || '').trim(),
    welcome: String(process.env.WHATSAPP_TEMPLATE_WELCOME || '').trim(),
    loyalty_upgrade: String(process.env.WHATSAPP_TEMPLATE_LOYALTY_UPGRADE || '').trim(),
    loyalty_progress: String(process.env.WHATSAPP_TEMPLATE_LOYALTY_PROGRESS || '').trim(),
    birthday: String(process.env.WHATSAPP_TEMPLATE_BIRTHDAY || '').trim(),
    login_otp: String(process.env.WHATSAPP_TEMPLATE_LOGIN_OTP || '').trim(),
    order: String(process.env.WHATSAPP_TEMPLATE_ORDER || '').trim(),
    payment: String(process.env.WHATSAPP_TEMPLATE_PAYMENT || '').trim(),
    abandoned_cart_recovery: String(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART || '').trim(),
    dashboard_alert: String(process.env.WHATSAPP_TEMPLATE_DASHBOARD_ALERT || '').trim(),
    coupon_issue: String(process.env.WHATSAPP_TEMPLATE_COUPON_ISSUE || '').trim()
};

const toText = (value = '') => String(value == null ? '' : value).trim();
const stripUnsafe = (value = '') => toText(value).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeTemplateName = (value = '') => toText(value).replace(/\s+/g, '_').toLowerCase();

const normalizeMobile = (value = '') => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `91${digits}`;
    if (digits.length > 10 && digits.startsWith('0')) return digits.slice(1);
    return digits;
};

const resolveTemplateName = ({ payload = {}, workflow = 'generic', content = {} } = {}) => {
    const explicitTemplate = toText(
        payload.template
        || payload.templateName
        || payload.templateId
        || content.template
    );
    if (explicitTemplate && WORKFLOW_TEMPLATES[explicitTemplate]) return toText(WORKFLOW_TEMPLATES[explicitTemplate]);
    if (explicitTemplate) return toText(explicitTemplate);

    const workflowKey = toText(workflow || payload.type || '').toLowerCase();
    if (workflowKey && WORKFLOW_TEMPLATES[workflowKey]) return toText(WORKFLOW_TEMPLATES[workflowKey]);
    if (WORKFLOW_TEMPLATES.generic) return toText(WORKFLOW_TEMPLATES.generic);
    return toText(WORKFLOW_TEMPLATES.default || '');
};

const resolveParamString = ({ payload = {}, content = {} } = {}) => {
    if (Array.isArray(payload.params) && payload.params.length > 0) {
        return payload.params.map((entry) => stripUnsafe(entry)).filter(Boolean).join(',');
    }
    if (toText(payload.param || payload.Param)) {
        return stripUnsafe(payload.param || payload.Param);
    }
    if (Array.isArray(content.params) && content.params.length > 0) {
        return content.params.map((entry) => stripUnsafe(entry)).filter(Boolean).join(',');
    }
    const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
    if (data) {
        const values = Object.values(data).map((entry) => stripUnsafe(entry)).filter(Boolean);
        if (values.length) return values.join(',');
    }
    const message = stripUnsafe(payload.message || content.message || '');
    if (message) return message;
    return '';
};

const looksSuccessful = (statusCode, body = '') => {
    if (Number(statusCode) < 200 || Number(statusCode) >= 300) return false;
    const normalized = String(body || '').trim().toLowerCase();
    if (!normalized) return true;
    if (
        normalized.includes('error')
        || normalized.includes('failed')
        || normalized.includes('fail')
        || normalized.includes('invalid')
        || normalized.includes('insufficient balance')
    ) return false;
    try {
        const parsed = JSON.parse(String(body || ''));
        const apiResponse = String(parsed?.ApiResponse || parsed?.apiResponse || '').trim().toLowerCase();
        const status = String(parsed?.ApiMessage?.Status || parsed?.apiMessage?.status || '').trim().toLowerCase();
        if (apiResponse === 'fail' || status === 'error') return false;
    } catch {}
    return true;
};

const httpGet = (url) => new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
            resolve({
                statusCode: Number(res.statusCode || 0),
                body: Buffer.concat(chunks).toString('utf8')
            });
        });
    });
    request.on('timeout', () => request.destroy(new Error('WhatsApp provider timeout')));
    request.on('error', reject);
});

const buildProviderUrl = (payload = {}, { templateOverride = '', includeTemplateAliases = false } = {}) => {
    const workflow = toText(payload.type || payload.template || 'generic').toLowerCase();
    const content = resolveWorkflowContent({ workflow, payload });
    const templateName = toText(templateOverride || resolveTemplateName({ payload, workflow, content }));
    if (!templateName) throw new Error('WhatsApp template is missing');

    const contact = normalizeMobile(payload.contact || payload.mobile || payload.to || '');
    if (!contact) throw new Error('WhatsApp mobile is missing');

    const url = new URL(API_ENDPOINT);
    url.searchParams.set('LicenseNumber', LICENSE_NUMBER);
    url.searchParams.set('APIKey', API_KEY);
    url.searchParams.set('Contact', contact);
    url.searchParams.set('Template', templateName);
    if (includeTemplateAliases) {
        url.searchParams.set('template', templateName);
        url.searchParams.set('TemplateName', templateName);
    }

    const paramString = resolveParamString({ payload, content });
    url.searchParams.set('Param', paramString || '');

    const fileUrl = toText(payload.fileUrl || payload.fileurl || content.fileUrl || '');
    url.searchParams.set('Fileurl', fileUrl || '');

    const explicitUrlParam = toText(payload.urlParam || payload.URLParam || content.urlParam || '');
    const isOtpWorkflow = ['otp', 'login_otp'].includes(String(workflow || '').toLowerCase());
    const otpButtonValue = toText(
        (Array.isArray(payload.params) && payload.params.length > 0 ? payload.params[0] : '')
        || (Array.isArray(content.params) && content.params.length > 0 ? content.params[0] : '')
        || payload?.data?.otp
        || ''
    );
    const urlParam = explicitUrlParam || (isOtpWorkflow ? otpButtonValue : '');
    url.searchParams.set('URLParam', urlParam || '');

    const headUrl = toText(payload.headUrl || payload.HeadURL || content.headUrl || '');
    url.searchParams.set('HeadURL', headUrl || '');

    const headParam = toText(payload.headParam || payload.HeadParam || content.headParam || '');
    url.searchParams.set('HeadParam', headParam || '');

    const name = stripUnsafe(payload.name || payload.Name || content.name || '');
    url.searchParams.set('Name', name || '');

    const pdfName = stripUnsafe(payload.pdfName || payload.PDFName || content.pdfName || '');
    url.searchParams.set('PDFName', pdfName || '');

    return { url, templateName, contact, workflow };
};

const maskSensitiveUrl = (urlObject) => {
    const cloned = new URL(urlObject.toString());
    if (cloned.searchParams.has('APIKey')) cloned.searchParams.set('APIKey', '***');
    return cloned.toString();
};

const hasMissingTemplateNameError = (body = '') => {
    const normalized = String(body || '').toLowerCase();
    return normalized.includes("template['name'] is required");
};

const getAdminWhatsappChannelState = async () => {
    const now = Date.now();
    if (now - cachedDbChannelState.ts < DB_CHANNEL_CACHE_TTL_MS) {
        return cachedDbChannelState;
    }
    try {
        const [rows] = await db.execute('SELECT whatsapp_channel_enabled, whatsapp_module_settings_json FROM company_profile WHERE id = 1 LIMIT 1');
        const masterEnabled = Number(rows?.[0]?.whatsapp_channel_enabled ?? 1) === 1;
        const moduleSettings = normalizeWhatsappModuleSettings(rows?.[0]?.whatsapp_module_settings_json);
        cachedDbChannelState = { masterEnabled, moduleSettings, ts: now };
        return cachedDbChannelState;
    } catch {
        cachedDbChannelState = {
            masterEnabled: true,
            moduleSettings: normalizeWhatsappModuleSettings(null),
            ts: now
        };
        return cachedDbChannelState;
    }
};

const sendWhatsapp = async (payload = {}) => {
    if (!ENABLED) {
        return {
            ok: false,
            skipped: true,
            reason: 'whatsapp_disabled',
            provider: PROVIDER_NAME
        };
    }
    const channelState = await getAdminWhatsappChannelState();
    if (!channelState.masterEnabled) {
        return {
            ok: false,
            skipped: true,
            reason: 'whatsapp_disabled_by_admin',
            provider: PROVIDER_NAME
        };
    }
    const workflowKey = toText(payload.type || payload.template || 'generic').toLowerCase();
    const moduleKey = WORKFLOW_MODULE_MAP[workflowKey] || null;
    if (moduleKey && channelState.moduleSettings?.[moduleKey] === false) {
        return {
            ok: false,
            skipped: true,
            reason: 'whatsapp_module_disabled_by_admin',
            module: moduleKey,
            workflow: workflowKey,
            provider: PROVIDER_NAME
        };
    }
    if (!LICENSE_NUMBER || !API_KEY) {
        return {
            ok: false,
            skipped: true,
            reason: 'whatsapp_credentials_missing',
            provider: PROVIDER_NAME
        };
    }

    const primary = buildProviderUrl(payload);
    let response = await httpGet(primary.url);
    let finalTemplate = primary.templateName;
    let finalUrl = primary.url;
    let retried = false;

    if (!looksSuccessful(response.statusCode, response.body) && hasMissingTemplateNameError(response.body)) {
        const fallbackTemplate = normalizeTemplateName(primary.templateName);
        if (fallbackTemplate && fallbackTemplate !== primary.templateName) {
            const fallback = buildProviderUrl(payload, {
                templateOverride: fallbackTemplate,
                includeTemplateAliases: true
            });
            const retryResponse = await httpGet(fallback.url);
            retried = true;
            if (looksSuccessful(retryResponse.statusCode, retryResponse.body)) {
                response = retryResponse;
                finalTemplate = fallback.templateName;
                finalUrl = fallback.url;
            } else {
                // Keep retry response visible for debugging since it is most explicit attempt.
                response = retryResponse;
                finalTemplate = fallback.templateName;
                finalUrl = fallback.url;
            }
        }
    }

    const ok = looksSuccessful(response.statusCode, response.body);
    return {
        ok,
        provider: PROVIDER_NAME,
        queued: ok,
        statusCode: response.statusCode,
        template: finalTemplate,
        workflow: primary.workflow,
        contact: primary.contact,
        response: response.body,
        requestUrl: maskSensitiveUrl(finalUrl),
        retried
    };
};

const sendOrderWhatsapp = async (payload = {}) => {
    return sendWhatsapp({
        ...payload,
        type: 'order',
        template: payload?.template || 'order',
        mobile: payload?.customer?.mobile || payload?.mobile || payload?.to
    });
};

const sendPaymentWhatsapp = async (payload = {}) => {
    return sendWhatsapp({
        ...payload,
        type: 'payment',
        template: payload?.template || 'payment',
        mobile: payload?.customer?.mobile || payload?.mobile || payload?.to
    });
};

const sendAbandonedCartWhatsapp = async (payload = {}) => {
    return sendWhatsapp({
        ...payload,
        type: 'abandoned_cart_recovery',
        template: payload?.template || 'abandoned_cart_recovery',
        mobile: payload?.customer?.mobile || payload?.mobile || payload?.to
    });
};

module.exports = {
    sendWhatsapp,
    sendOrderWhatsapp,
    sendPaymentWhatsapp,
    sendAbandonedCartWhatsapp,
    __test: {
        getAdminWhatsappChannelState,
        resetChannelCache() {
            cachedDbChannelState = {
                masterEnabled: true,
                moduleSettings: normalizeWhatsappModuleSettings(null),
                ts: 0
            };
        }
    }
};
