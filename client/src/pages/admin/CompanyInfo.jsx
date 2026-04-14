import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Building2,
    ChevronDown,
    ChevronUp,
    CreditCard,
    Facebook,
    LocateFixed,
    Instagram,
    Key,
    Mail,
    Printer,
    Plus,
    Save,
    ShieldCheck,
    Trash2,
    UserCog,
    Upload,
    Youtube
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useCustomers } from '../../context/CustomerContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../../hooks/usePublicSiteShell';
import { getGstRateSplit } from '../../utils/gst';
import WhatsAppIcon from '../../components/WhatsAppIcon';
import {
    clearStoredPrinterPreference,
    configurePreferredPrinter,
    getPreferredPrinterTransport,
    getPrinterSupportState,
    getStoredPrinterPreference
} from '../../utils/thermalLabelPrint';
import AddCustomerModal from '../../components/AddCustomerModal';
import Modal from '../../components/Modal';
import fallbackContactImage from '../../assets/contact.jpg';
import { BRAND_APPLE_TOUCH_ICON_URL, BRAND_FAVICON_URL, BRAND_LOGO_URL } from '../../utils/branding.js';

const DEFAULT_FORM = {
    displayName: '',
    contactNumber: '',
    supportEmail: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
    openingHours: '',
    latitude: '',
    longitude: '',
    gstNumber: '',
    taxEnabled: false,
    taxPriceMode: 'exclusive',
    instagramUrl: '',
    youtubeUrl: '',
    facebookUrl: '',
    whatsappNumber: '',
    logoUrl: '/logo.webp',
    faviconUrl: '',
    appleTouchIconUrl: '',
    contactJumbotronImageUrl: '/assets/contact.jpg',
    emailChannelEnabled: true,
    whatsappChannelEnabled: true,
    whatsappModuleSettings: {
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
    },
    subCategoriesEnabled: false,
    razorpayKeyId: '',
    razorpayKeySecret: '',
    razorpayWebhookSecret: '',
    razorpayEmiMinAmount: 3000,
    razorpayStartingTenureMonths: 12
};

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidContact = (value = '') => /^[0-9+\-\s()]{7,20}$/.test(String(value || '').trim());
const isValidWhatsApp = (value = '') => /^\d{10,14}$/.test(String(value || '').trim());
const isValidGst = (value = '') => /^[0-9A-Za-z]{15}$/.test(String(value || '').trim());
const isValidPostalCode = (value = '') => /^[0-9A-Za-z\-\s]{3,12}$/.test(String(value || '').trim());
const isValidUrl = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return true;
    try {
        const parsed = new URL(raw);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

const isDevMode = import.meta.env.DEV;
const WHATSAPP_MODULES = [
    { key: 'loginOtp', label: 'Login OTP', template: 'WHATSAPP_TEMPLATE_LOGIN_OTP', note: 'Otp' },
    { key: 'order', label: 'Order Updates', template: 'WHATSAPP_TEMPLATE_ORDER', note: 'Order_status' },
    { key: 'welcome', label: 'Welcome', template: 'WHATSAPP_TEMPLATE_WELCOME', note: 'Welcome' },
    { key: 'loyaltyUpgrade', label: 'Loyalty Upgrade', template: 'WHATSAPP_TEMPLATE_LOYALTY_UPGRADE', note: 'Loyalty_upgrade' },
    { key: 'loyaltyProgress', label: 'Loyalty Progress', template: 'WHATSAPP_TEMPLATE_LOYALTY_PROGRESS', note: 'Loyalty_progress' },
    { key: 'birthday', label: 'Birthday', template: 'WHATSAPP_TEMPLATE_BIRTHDAY', note: 'Birthday' },
    { key: 'abandonedCartRecovery', label: 'Abandoned Cart', template: 'WHATSAPP_TEMPLATE_ABANDONED_CART_WITH_OFFER / WITHOUT_OFFER', note: 'Cart_with_offer / Cart_without_offer' },
    { key: 'couponIssue', label: 'Coupon Issue', template: 'WHATSAPP_TEMPLATE_COUPON_ISSUE', note: 'Coupon_code' },
    { key: 'dashboardAlert', label: 'Dashboard Alerts', template: 'WHATSAPP_TEMPLATE_DASHBOARD_ALERT', note: 'Optional ops template' },
    { key: 'payment', label: 'Payment Updates', template: 'WHATSAPP_TEMPLATE_PAYMENT', note: 'Optional payment template' }
];

export default function CompanyInfo() {
    const toast = useToast();
    const { user: currentUser } = useAuth();
    const { users, refreshUsers } = useCustomers();
    const { applyCompanyInfo } = usePublicCompanyInfo();
    const refreshUsersRef = useRef(refreshUsers);
    const [form, setForm] = useState(DEFAULT_FORM);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isJumbotronUploading, setIsJumbotronUploading] = useState(false);
    const [isLogoUploading, setIsLogoUploading] = useState(false);
    const [isFaviconUploading, setIsFaviconUploading] = useState(false);
    const [isAppleTouchIconUploading, setIsAppleTouchIconUploading] = useState(false);
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [taxRates, setTaxRates] = useState([]);
    const [taxRateEdits, setTaxRateEdits] = useState({});
    const [taxDraft, setTaxDraft] = useState({ name: '', code: '', ratePercent: '' });
    const [isTaxLoading, setIsTaxLoading] = useState(false);
    const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
    const [modalConfig, setModalConfig] = useState({
        isOpen: false,
        type: 'default',
        title: '',
        message: '',
        targetUser: null
    });
    const [whatsappTestForm, setWhatsappTestForm] = useState({
        mobile: '',
        template: 'generic',
        params: '',
        message: '',
        name: 'Customer'
    });
    const [isWhatsappTestSending, setIsWhatsappTestSending] = useState(false);
    const [whatsappTestResult, setWhatsappTestResult] = useState(null);
    const [communicationLogs, setCommunicationLogs] = useState([]);
    const [isCommunicationLogsLoading, setIsCommunicationLogsLoading] = useState(false);
    const [isWhatsappModulesOpen, setIsWhatsappModulesOpen] = useState(false);
    const [preferredPrinter, setPreferredPrinter] = useState(() => getStoredPrinterPreference());
    const [isPrinterConnecting, setIsPrinterConnecting] = useState(false);
    const [isCapturingLocation, setIsCapturingLocation] = useState(false);

    const printerSupport = useMemo(() => getPrinterSupportState(), []);
    const preferredPrinterTransport = useMemo(() => getPreferredPrinterTransport(), []);

    const staffAndAdmins = useMemo(
        () => users.filter((u) => u.role === 'admin' || u.role === 'staff'),
        [users]
    );

    useEffect(() => {
        refreshUsersRef.current = refreshUsers;
    }, [refreshUsers]);

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            try {
                const data = await adminService.getCompanyInfo();
                setForm({
                    ...DEFAULT_FORM,
                    ...(data?.company || {}),
                    razorpayKeySecret: '',
                    razorpayWebhookSecret: ''
                });
                normalizeTaxRates(data?.taxes);
                await refreshUsersRef.current?.(false);
            } catch (error) {
                toast.error(error.message || 'Failed to load settings');
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [toast]);

    useEffect(() => {
        if (!isDevMode) return undefined;
        const loadLogs = async () => {
            setIsCommunicationLogsLoading(true);
            try {
                const data = await adminService.getCommunicationDeliveryLogs({ status: 'all', limit: 20 });
                setCommunicationLogs(Array.isArray(data?.logs) ? data.logs : []);
            } catch (error) {
                toast.error(error?.message || 'Failed to load communication delivery logs');
            } finally {
                setIsCommunicationLogsLoading(false);
            }
        };
        loadLogs();
        return undefined;
    }, [toast]);

    useAdminCrudSync({
        'company:info_update': ({ company } = {}) => {
            if (!company || typeof company !== 'object') return;
            setForm((prev) => ({
                ...prev,
                ...DEFAULT_FORM,
                ...company,
                razorpayKeySecret: '',
                razorpayWebhookSecret: ''
            }));
        }
    });

    const formErrors = useMemo(() => {
        const errors = {};
        if (!String(form.displayName || '').trim()) {
            errors.displayName = 'Company name is required';
        }
        if (!String(form.contactNumber || '').trim()) {
            errors.contactNumber = 'Contact number is required';
        } else if (!isValidContact(form.contactNumber)) {
            errors.contactNumber = 'Contact number format is invalid';
        }
        if (!String(form.supportEmail || '').trim()) {
            errors.supportEmail = 'Support email is required';
        } else if (!isValidEmail(form.supportEmail)) {
            errors.supportEmail = 'Support email is invalid';
        }
        if (String(form.postalCode || '').trim() && !isValidPostalCode(form.postalCode)) {
            errors.postalCode = 'Postal code format is invalid';
        }
        if (String(form.latitude || '').trim() && !Number.isFinite(Number(form.latitude))) {
            errors.latitude = 'Latitude must be a valid number';
        }
        if (String(form.longitude || '').trim() && !Number.isFinite(Number(form.longitude))) {
            errors.longitude = 'Longitude must be a valid number';
        }
        if ((String(form.latitude || '').trim() && !String(form.longitude || '').trim()) || (!String(form.latitude || '').trim() && String(form.longitude || '').trim())) {
            errors.longitude = 'Both latitude and longitude are required together';
        }
        const gstRaw = String(form.gstNumber || '').trim();
        if (gstRaw && !isValidGst(gstRaw)) {
            errors.gstNumber = 'GST number must be 15 alphanumeric characters';
        }
        if (form.taxEnabled && !gstRaw) {
            errors.gstNumber = 'GST number is required to enable GST';
        }
        if (!String(form.whatsappNumber || '').trim()) {
            errors.whatsappNumber = 'WhatsApp number is required';
        } else if (!isValidWhatsApp(form.whatsappNumber)) {
            errors.whatsappNumber = 'WhatsApp number must be 10-14 digits';
        }
        const logoUrl = String(form.logoUrl || '').trim();
        const faviconUrl = String(form.faviconUrl || '').trim();
        const appleTouchIconUrl = String(form.appleTouchIconUrl || '').trim();
        if (!logoUrl) {
            errors.logoUrl = 'Company logo is required';
        } else if (!isValidUrl(logoUrl) && !logoUrl.startsWith('/')) {
            errors.logoUrl = 'Company logo must be a valid URL or an absolute asset path';
        }
        if (faviconUrl && !isValidUrl(faviconUrl) && !faviconUrl.startsWith('/')) {
            errors.faviconUrl = 'Favicon must be a valid URL or an absolute asset path';
        }
        if (appleTouchIconUrl && !isValidUrl(appleTouchIconUrl) && !appleTouchIconUrl.startsWith('/')) {
            errors.appleTouchIconUrl = 'Apple touch icon must be a valid URL or an absolute asset path';
        }
        if (!String(form.razorpayKeyId || '').trim()) {
            errors.razorpayKeyId = 'Razorpay Key ID is required';
        } else if (!/^rzp_(test|live)_[a-zA-Z0-9]+$/.test(String(form.razorpayKeyId || '').trim())) {
            errors.razorpayKeyId = 'Razorpay Key ID format is invalid';
        }
        if (!Number.isFinite(Number(form.razorpayEmiMinAmount)) || Number(form.razorpayEmiMinAmount) < 1) {
            errors.razorpayEmiMinAmount = 'Minimum EMI amount must be greater than 0';
        }
        if (!Number.isFinite(Number(form.razorpayStartingTenureMonths)) || Number(form.razorpayStartingTenureMonths) < 1) {
            errors.razorpayStartingTenureMonths = 'Starting tenure must be greater than 0';
        }
        if (!isValidUrl(form.instagramUrl) || !isValidUrl(form.youtubeUrl) || !isValidUrl(form.facebookUrl)) {
            errors.socialUrl = 'One or more social URLs are invalid';
        }
        const jumbotron = String(form.contactJumbotronImageUrl || '').trim();
        if (jumbotron && !isValidUrl(jumbotron) && !jumbotron.startsWith('/')) {
            errors.contactJumbotronImageUrl = 'Contact jumbotron image must be a valid URL or an absolute asset path';
        }
        return errors;
    }, [form]);

    const hasGstNumber = useMemo(
        () => Boolean(String(form.gstNumber || '').trim()),
        [form.gstNumber]
    );

    useEffect(() => {
        if (!hasGstNumber && form.taxEnabled) {
            setForm((prev) => ({ ...prev, taxEnabled: false }));
        }
    }, [hasGstNumber, form.taxEnabled]);

    useEffect(() => {
        if (!form.whatsappChannelEnabled) {
            setIsWhatsappModulesOpen(false);
        }
    }, [form.whatsappChannelEnabled]);

    const canResetPassword = (targetUser) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin' && targetUser.role !== 'customer') return true;
        if (currentUser.role === 'staff' && targetUser.id === currentUser.id) return true;
        return false;
    };

    const canDeleteUser = (targetUser) => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin' && targetUser.role !== 'admin') return true;
        return false;
    };

    const handleChange = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleWhatsappModuleToggle = (key, value) => {
        setForm((prev) => ({
            ...prev,
            whatsappModuleSettings: {
                ...(prev.whatsappModuleSettings || DEFAULT_FORM.whatsappModuleSettings),
                [key]: value
            }
        }));
    };

    const handleContactJumbotronUpload = async (file) => {
        if (!file) return;
        setIsJumbotronUploading(true);
        try {
            const data = await adminService.uploadContactJumbotronImage(file);
            const imageUrl = String(data?.url || '').trim();
            if (!imageUrl) throw new Error('Upload did not return an image URL');
            setForm((prev) => ({ ...prev, contactJumbotronImageUrl: imageUrl }));
            toast.success('Contact jumbotron image uploaded');
        } catch (error) {
            toast.error(error?.message || 'Failed to upload contact jumbotron image');
        } finally {
            setIsJumbotronUploading(false);
        }
    };

    const handleBrandingUpload = async ({ file, uploader, successMessage, errorMessage, field, setUploading }) => {
        if (!file) return;
        setUploading(true);
        try {
            const data = await uploader(file);
            const assetUrl = String(data?.url || '').trim();
            if (!assetUrl) throw new Error('Upload did not return an asset URL');
            const nextPayload = { ...form, [field]: assetUrl };
            const saved = await adminService.updateCompanyInfo({
                ...nextPayload,
                gstNumber: String(nextPayload.gstNumber || '').trim().toUpperCase(),
                postalCode: String(nextPayload.postalCode || '').trim(),
                latitude: String(nextPayload.latitude || '').trim(),
                longitude: String(nextPayload.longitude || '').trim(),
                razorpayEmiMinAmount: Number(nextPayload.razorpayEmiMinAmount || 0),
                razorpayStartingTenureMonths: Number(nextPayload.razorpayStartingTenureMonths || 0)
            });
            const nextCompany = {
                ...DEFAULT_FORM,
                ...(saved?.company || {}),
                razorpayKeySecret: '',
                razorpayWebhookSecret: ''
            };
            setForm(nextCompany);
            applyCompanyInfo(saved?.company || {});
            toast.success(successMessage);
        } catch (error) {
            toast.error(error?.message || errorMessage);
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const firstError = Object.values(formErrors)[0];
        if (firstError) {
            toast.error(firstError);
            return;
        }
        setIsSaving(true);
        try {
            const data = await adminService.updateCompanyInfo({
                ...form,
                gstNumber: String(form.gstNumber || '').trim().toUpperCase(),
                postalCode: String(form.postalCode || '').trim(),
                latitude: String(form.latitude || '').trim(),
                longitude: String(form.longitude || '').trim(),
                razorpayEmiMinAmount: Number(form.razorpayEmiMinAmount || 0),
                razorpayStartingTenureMonths: Number(form.razorpayStartingTenureMonths || 0)
            });
            setForm({
                ...DEFAULT_FORM,
                ...(data?.company || {}),
                razorpayKeySecret: '',
                razorpayWebhookSecret: ''
            });
            toast.success('Settings updated');
        } catch (error) {
            toast.error(error.message || 'Failed to update settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTaxSectionKeyDown = (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const tagName = String(target.tagName || '').toLowerCase();
        if (!['input', 'select'].includes(tagName)) return;
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
    };

    const handleCaptureLocation = async () => {
        if (!navigator.geolocation) {
            toast.error('Geolocation is not supported in this browser');
            return;
        }
        setIsCapturingLocation(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setForm((prev) => ({
                    ...prev,
                    latitude: String(Number(position.coords.latitude).toFixed(7)),
                    longitude: String(Number(position.coords.longitude).toFixed(7))
                }));
                setIsCapturingLocation(false);
                toast.success('Coordinates captured');
            },
            (error) => {
                setIsCapturingLocation(false);
                toast.error(error?.message || 'Unable to capture location');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    };

    const normalizeTaxRates = (rows = []) => {
        const nextRows = Array.isArray(rows) ? rows : [];
        setTaxRates(nextRows);
        setTaxRateEdits((prev) => {
            const next = { ...prev };
            nextRows.forEach((row) => {
                next[row.id] = {
                    name: String(row.name || ''),
                    code: String(row.code || ''),
                    ratePercent: String(row.ratePercent ?? '')
                };
            });
            return next;
        });
    };

    const handleCreateTax = async () => {
        const name = String(taxDraft.name || '').trim();
        const code = String(taxDraft.code || '').trim().toUpperCase();
        const ratePercent = Number(taxDraft.ratePercent || 0);
        if (!name) return toast.error('Tax name is required');
        if (!code) return toast.error('Tax code is required');
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
            return toast.error('Tax rate must be between 0 and 100');
        }
        setIsTaxLoading(true);
        try {
            const data = await adminService.createTaxConfig({ name, code, ratePercent, isActive: true });
            normalizeTaxRates(data?.taxes);
            setTaxDraft({ name: '', code: '', ratePercent: '' });
            toast.success('Tax rate added');
        } catch (error) {
            toast.error(error?.message || 'Failed to add tax rate');
        } finally {
            setIsTaxLoading(false);
        }
    };

    const updateTaxRate = async (taxId, patch = {}) => {
        setIsTaxLoading(true);
        try {
            const data = await adminService.updateTaxConfig(taxId, patch);
            normalizeTaxRates(data?.taxes);
        } catch (error) {
            toast.error(error?.message || 'Failed to update tax rate');
        } finally {
            setIsTaxLoading(false);
        }
    };

    const deleteTaxRate = async (taxId) => {
        setIsTaxLoading(true);
        try {
            const data = await adminService.deleteTaxConfig(taxId);
            normalizeTaxRates(data?.taxes);
            toast.success('Tax rate deleted');
        } catch (error) {
            toast.error(error?.message || 'Failed to delete tax rate');
        } finally {
            setIsTaxLoading(false);
        }
    };

    const handleAddStaff = async (userData) => {
        const payload = {
            ...userData,
            role: 'staff'
        };
        delete payload.addressLine1;
        delete payload.city;
        delete payload.state;
        delete payload.zip;

        await adminService.createUser(payload);
        await refreshUsers(true);
        setIsAddStaffOpen(false);
        toast.success('Staff added successfully');
    };

    const openDeleteModal = (user) => {
        setModalConfig({
            isOpen: true,
            type: 'delete',
            title: 'Delete User?',
            message: `Are you sure you want to remove ${user.name}?`,
            targetUser: user
        });
    };

    const openResetModal = (user) => {
        setModalConfig({
            isOpen: true,
            type: 'password',
            title: 'Reset Password',
            message: `Enter a new password for ${user.name}.`,
            targetUser: user
        });
    };

    const handleModalConfirm = async (inputValue) => {
        setIsActionLoading(true);
        const { type, targetUser } = modalConfig;
        try {
            if (type === 'delete') {
                await adminService.deleteUser(targetUser.id);
                await refreshUsers(true);
                toast.success('User deleted successfully');
            } else if (type === 'password') {
                if (!inputValue || inputValue.length < 6) {
                    toast.error('Password must be at least 6 characters');
                    setIsActionLoading(false);
                    return;
                }
                await adminService.resetPassword(targetUser.id, inputValue);
                toast.success('Password updated successfully');
            }
            setModalConfig((prev) => ({ ...prev, isOpen: false }));
        } catch (error) {
            toast.error(error?.message || 'Action failed');
        } finally {
            setIsActionLoading(false);
        }
    };

    const saveTaxEdit = async (taxId) => {
        const draft = taxRateEdits[taxId] || {};
        await updateTaxRate(taxId, {
            name: String(draft.name || '').trim(),
            code: String(draft.code || '').trim().toUpperCase(),
            ratePercent: Number(draft.ratePercent || 0)
        });
    };

    const handleSendWhatsappTest = async () => {
        const mobile = String(whatsappTestForm.mobile || form.whatsappNumber || '').replace(/\D/g, '');
        if (!mobile || mobile.length < 10) {
            toast.error('Enter a valid recipient mobile number');
            return;
        }
        setIsWhatsappTestSending(true);
        setWhatsappTestResult(null);
        try {
            const params = String(whatsappTestForm.params || '')
                .split(',')
                .map((entry) => String(entry || '').trim())
                .filter(Boolean);
            const result = await adminService.sendTestWhatsapp({
                mobile,
                template: String(whatsappTestForm.template || 'generic').trim(),
                params,
                message: String(whatsappTestForm.message || '').trim(),
                name: String(whatsappTestForm.name || 'Customer').trim() || 'Customer'
            });
            setWhatsappTestResult(result);
            if (result?.ok) {
                toast.success('WhatsApp test request sent');
            } else {
                toast.error(result?.message || 'WhatsApp test failed');
            }
        } catch (error) {
            const message = error?.message || 'Failed to send WhatsApp test';
            setWhatsappTestResult({ ok: false, message });
            toast.error(message);
        } finally {
            setIsWhatsappTestSending(false);
        }
    };

    const refreshCommunicationLogs = async () => {
        setIsCommunicationLogsLoading(true);
        try {
            const data = await adminService.getCommunicationDeliveryLogs({ status: 'all', limit: 20 });
            setCommunicationLogs(Array.isArray(data?.logs) ? data.logs : []);
        } catch (error) {
            toast.error(error?.message || 'Failed to refresh communication delivery logs');
        } finally {
            setIsCommunicationLogsLoading(false);
        }
    };

    const formatLogDateTime = (value) => {
        if (!value) return 'N/A';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleConnectPrinter = async () => {
        setIsPrinterConnecting(true);
        try {
            const printer = await configurePreferredPrinter({ transport: preferredPrinterTransport });
            setPreferredPrinter(getStoredPrinterPreference());
            toast.success(`${printer?.name || 'Printer'} connected as preferred printer`);
        } catch (error) {
            toast.error(error?.message || 'Failed to connect printer');
        } finally {
            setIsPrinterConnecting(false);
        }
    };

    const handleForgetPrinter = () => {
        clearStoredPrinterPreference();
        setPreferredPrinter(null);
        toast.success('Preferred printer cleared');
    };

    if (isLoading) {
        return <div className="py-16 text-center text-gray-400">Loading settings...</div>;
    }

    const brandingPreviews = [
        {
            key: 'logoUrl',
            label: 'Company Logo',
            required: true,
            routePath: BRAND_LOGO_URL,
            previewUrl: form.logoUrl || BRAND_LOGO_URL,
            uploadLabel: isLogoUploading ? 'Uploading logo...' : 'Upload Logo',
            helper: 'Mandatory. Used across storefront, admin panels, invoices, SEO, and PWA branding.',
            error: formErrors.logoUrl,
            uploading: isLogoUploading,
            uploader: (file) => handleBrandingUpload({
                file,
                uploader: adminService.uploadCompanyLogo,
                successMessage: 'Logo uploaded',
                errorMessage: 'Failed to upload logo',
                field: 'logoUrl',
                setUploading: setIsLogoUploading
            }),
            accept: 'image/*,.ico'
        },
        {
            key: 'faviconUrl',
            label: 'Favicon',
            required: false,
            routePath: BRAND_FAVICON_URL,
            previewUrl: form.faviconUrl || BRAND_FAVICON_URL,
            uploadLabel: isFaviconUploading ? 'Uploading favicon...' : 'Upload Favicon',
            helper: 'Optional. Used for browser tab icon through the stable /favicon.ico route.',
            error: formErrors.faviconUrl,
            uploading: isFaviconUploading,
            uploader: (file) => handleBrandingUpload({
                file,
                uploader: adminService.uploadCompanyFavicon,
                successMessage: 'Favicon uploaded',
                errorMessage: 'Failed to upload favicon',
                field: 'faviconUrl',
                setUploading: setIsFaviconUploading
            }),
            accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/webp,.ico'
        },
        {
            key: 'appleTouchIconUrl',
            label: 'Apple Touch Icon',
            required: false,
            routePath: BRAND_APPLE_TOUCH_ICON_URL,
            previewUrl: form.appleTouchIconUrl || BRAND_APPLE_TOUCH_ICON_URL,
            uploadLabel: isAppleTouchIconUploading ? 'Uploading apple touch icon...' : 'Upload Apple Touch Icon',
            helper: 'Optional. Used for iOS home-screen icon via the stable /apple-touch-icon.png route.',
            error: formErrors.appleTouchIconUrl,
            uploading: isAppleTouchIconUploading,
            uploader: (file) => handleBrandingUpload({
                file,
                uploader: adminService.uploadCompanyAppleTouchIcon,
                successMessage: 'Apple touch icon uploaded',
                errorMessage: 'Failed to upload apple touch icon',
                field: 'appleTouchIconUrl',
                setUploading: setIsAppleTouchIconUploading
            }),
            accept: 'image/*,.ico'
        }
    ];

    return (
        <div className="animate-fade-in">
            <Modal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig((prev) => ({ ...prev, isOpen: false }))}
                onConfirm={handleModalConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                type={modalConfig.type}
                isLoading={isActionLoading}
            />

            <AddCustomerModal
                isOpen={isAddStaffOpen}
                onClose={() => setIsAddStaffOpen(false)}
                onConfirm={handleAddStaff}
                roleToAdd="staff"
            />

            <div className="mb-6">
                <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Settings</h1>
                <p className="text-gray-500 text-sm mt-1">Manage company profile, channels, and payment configuration.</p>
            </div>

            <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden mb-6">
                <WhatsAppIcon size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                <div className="relative z-10">
                    <h3 className="text-sm font-semibold text-gray-800">Communication Channels</h3>
                    <p className="text-xs text-gray-500 mt-1">Global channel controls for customer communications.</p>
                </div>
                <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-start gap-3">
                        <Mail size={18} className="mt-0.5 text-gray-500" />
                        <div className="flex-1">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-gray-800">Email channel</p>
                                    <p className="text-xs text-gray-500 mt-1">Always on. Email remains the required baseline channel for customer communication.</p>
                                </div>
                                <input type="checkbox" checked readOnly disabled className="cursor-not-allowed" />
                            </div>
                        </div>
                    </label>
                    <label className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-start gap-3">
                        <WhatsAppIcon size={18} className="mt-0.5 text-green-600" />
                        <div className="flex-1">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-gray-800">WhatsApp channel</p>
                                    <p className="text-xs text-gray-500 mt-1">Disabling this stops WhatsApp sends across OTP, loyalty, order, abandoned cart, and dashboard alert flows.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsWhatsappModulesOpen((prev) => !prev)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                                    >
                                        Modules
                                        {isWhatsappModulesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(form.whatsappChannelEnabled)}
                                        onChange={(e) => handleChange('whatsappChannelEnabled', e.target.checked)}
                                    />
                                </div>
                            </div>
                            <div className="mt-3">
                                <button
                                    type="button"
                                    onClick={() => setIsWhatsappModulesOpen((prev) => !prev)}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-700"
                                >
                                    {isWhatsappModulesOpen ? 'Hide module controls' : 'Show module controls'}
                                    {isWhatsappModulesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                            </div>
                        </div>
                    </label>
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-start gap-3">
                        <Printer size={18} className="mt-0.5 text-violet-600" />
                        <div className="flex-1">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-semibold text-gray-800">Shipping Label Printer</p>
                                    <p className="text-xs text-gray-500 mt-1">Select the preferred thermal printer once and reuse it from order print actions.</p>
                                    <p className="text-[11px] text-gray-400 mt-2">
                                        {preferredPrinter
                                            ? `Preferred: ${preferredPrinter.deviceName || preferredPrinter.productName || 'Saved printer'} (${preferredPrinter.transport === 'usb' ? 'USB' : 'Bluetooth'})`
                                            : printerSupport.supported
                                                ? (preferredPrinterTransport === 'bluetooth'
                                                    ? 'No preferred printer saved. Mobile will use Bluetooth only.'
                                                    : 'No preferred printer saved. Desktop can use Bluetooth or USB if supported.')
                                                : printerSupport.reason}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleConnectPrinter}
                                        disabled={!printerSupport.supported || isPrinterConnecting}
                                        className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Printer size={14} />
                                        {isPrinterConnecting ? 'Connecting...' : preferredPrinter ? 'Change Printer' : 'Connect Printer'}
                                    </button>
                                    {preferredPrinter && (
                                        <button
                                            type="button"
                                            onClick={handleForgetPrinter}
                                            className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                                        >
                                            Forget
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {isWhatsappModulesOpen && (
                    <div className="relative z-10 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">WhatsApp Modules</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {WHATSAPP_MODULES.map((module) => (
                                <label key={module.key} className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${form.whatsappChannelEnabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                                    <WhatsAppIcon size={16} className="mt-0.5 text-green-600" />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-800">{module.label}</p>
                                                <p className="text-[11px] text-gray-500 mt-1">Template: {module.note}</p>
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={Boolean(form.whatsappModuleSettings?.[module.key])}
                                                disabled={!form.whatsappChannelEnabled}
                                                onChange={(e) => handleWhatsappModuleToggle(module.key, e.target.checked)}
                                            />
                                        </div>
                                        <p className="text-[11px] text-gray-400 mt-2">{module.template}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="emboss-card relative bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <Building2 size={70} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 relative z-10">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Admins & Staff</h3>
                    {currentUser?.role === 'admin' && (
                        <button
                            onClick={() => setIsAddStaffOpen(true)}
                            className="w-36 bg-gray-800 hover:bg-gray-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                            <Plus size={14} strokeWidth={3} /> Add Staff
                        </button>
                    )}
                </div>
                <table className="hidden md:table w-full text-left relative z-10">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">User</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Contact</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Role</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {staffAndAdmins.map((user) => (
                            <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${user.role === 'admin' ? 'bg-accent text-primary' : 'bg-blue-100 text-blue-700'}`}>
                                            {user.role === 'admin' ? <ShieldCheck size={14} /> : <UserCog size={14} />}
                                        </div>
                                        <span className="font-medium text-gray-900">{user.name}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-sm text-gray-900">{user.email || '—'}</div>
                                    <div className="text-xs text-gray-500">{user.mobile}</div>
                                </td>
                                <td className="px-6 py-4">
                                    {user.role === 'admin' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary text-accent">ADMIN</span>}
                                    {user.role === 'staff' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">STAFF</span>}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        {canResetPassword(user) && (
                                            <button
                                                onClick={() => openResetModal(user)}
                                                className="text-gray-400 hover:text-accent-deep hover:bg-amber-50 p-2 rounded-lg transition-all"
                                                title="Reset Password"
                                            >
                                                <Key size={18} />
                                            </button>
                                        )}
                                        {canDeleteUser(user) && (
                                            <button
                                                onClick={() => openDeleteModal(user)}
                                                className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-all"
                                                title="Delete User"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <form onSubmit={handleSave} className="grid grid-cols-1 gap-5">
                <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden">
                    <Building2 size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                    <div className="relative z-10" onKeyDown={handleTaxSectionKeyDown}>
                        <h3 className="text-sm font-semibold text-gray-800">Company Info</h3>
                        <p className="text-xs text-gray-500 mt-1">Mandatory fields are highlighted in red if invalid.</p>
                    </div>
                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="Company Display Name"
                            value={form.displayName}
                            onChange={(value) => handleChange('displayName', value)}
                            placeholder="SSC Jewellery"
                            required
                            error={formErrors.displayName}
                        />
                        <Field
                            label="Contact Number"
                            value={form.contactNumber}
                            onChange={(value) => handleChange('contactNumber', value)}
                            placeholder="+91 95009 41350"
                            required
                            error={formErrors.contactNumber}
                        />
                        <Field
                            label="Support Email"
                            value={form.supportEmail}
                            onChange={(value) => handleChange('supportEmail', value)}
                            placeholder="support@example.com"
                            type="email"
                            required
                            error={formErrors.supportEmail}
                        />
                        <Field
                            label="WhatsApp Number"
                            value={form.whatsappNumber}
                            onChange={(value) => handleChange('whatsappNumber', String(value || '').replace(/\D/g, '').slice(0, 14))}
                            placeholder="919500941350"
                            required
                            error={formErrors.whatsappNumber}
                        />
                        <Field
                            label="GST Number"
                            value={form.gstNumber}
                            onChange={(value) => handleChange('gstNumber', String(value || '').toUpperCase().replace(/[^0-9A-Za-z]/g, '').slice(0, 15))}
                            placeholder="29ABCDE1234F2Z5"
                            error={formErrors.gstNumber}
                        />
                    </div>

                    <label className="relative z-10 block">
                        <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Address</span>
                        <textarea
                            value={form.address}
                            onChange={(e) => handleChange('address', e.target.value)}
                            placeholder="Registered office address"
                            rows={3}
                            className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:border-accent outline-none"
                        />
                    </label>

                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="City"
                            value={form.city}
                            onChange={(value) => handleChange('city', value)}
                            placeholder="City"
                        />
                        <Field
                            label="State"
                            value={form.state}
                            onChange={(value) => handleChange('state', value)}
                            placeholder="State"
                        />
                        <Field
                            label="Postal Code"
                            value={form.postalCode}
                            onChange={(value) => handleChange('postalCode', value)}
                            placeholder="Postal code"
                            error={formErrors.postalCode}
                        />
                        <Field
                            label="Country"
                            value={form.country}
                            onChange={(value) => handleChange('country', value)}
                            placeholder="Country"
                        />
                    </div>

                    <label className="relative z-10 block">
                        <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Opening Hours</span>
                        <textarea
                            value={form.openingHours}
                            onChange={(e) => handleChange('openingHours', e.target.value)}
                            placeholder="Mon-Sat 10:00-19:00"
                            rows={2}
                            className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:border-accent outline-none"
                        />
                    </label>

                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4">
                        <Field
                            label="Latitude"
                            value={form.latitude}
                            onChange={(value) => handleChange('latitude', value)}
                            placeholder="13.0826802"
                            error={formErrors.latitude}
                        />
                        <Field
                            label="Longitude"
                            value={form.longitude}
                            onChange={(value) => handleChange('longitude', value)}
                            placeholder="80.2707184"
                            error={formErrors.longitude}
                        />
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={handleCaptureLocation}
                                disabled={isCapturingLocation}
                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            >
                                <LocateFixed size={16} />
                                {isCapturingLocation ? 'Locating...' : 'Use GPS'}
                            </button>
                        </div>
                    </div>

                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="Instagram URL"
                            value={form.instagramUrl}
                            onChange={(value) => handleChange('instagramUrl', value)}
                            placeholder="https://instagram.com/..."
                            icon={Instagram}
                            iconClassName="text-pink-500"
                        />
                        <Field
                            label="YouTube URL"
                            value={form.youtubeUrl}
                            onChange={(value) => handleChange('youtubeUrl', value)}
                            placeholder="https://youtube.com/..."
                            icon={Youtube}
                            iconClassName="text-red-600"
                        />
                        <Field
                            label="Facebook URL"
                            value={form.facebookUrl}
                            onChange={(value) => handleChange('facebookUrl', value)}
                            placeholder="https://facebook.com/..."
                            icon={Facebook}
                            iconClassName="text-blue-600"
                        />
                        <Field
                            label="Contact Jumbotron Image URL"
                            value={form.contactJumbotronImageUrl}
                            onChange={(value) => handleChange('contactJumbotronImageUrl', value)}
                            placeholder="/assets/contact.jpg"
                            error={formErrors.contactJumbotronImageUrl}
                        />
                    </div>
                    <div className="relative z-10 space-y-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 p-4">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-800">Store Branding Assets</h4>
                            <p className="mt-1 text-xs text-gray-500">
                                Upload once here and the same branding will be used across storefront screens, favicon/apple icons, SEO, invoices, and the installed PWA.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                            {brandingPreviews.map((asset) => (
                                <div key={asset.key} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-800">
                                                {asset.label} {asset.required ? <span className="text-red-500">*</span> : null}
                                            </p>
                                            <p className="mt-1 text-[11px] text-gray-500">{asset.helper}</p>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex h-24 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                                        <img
                                            src={asset.previewUrl}
                                            alt={asset.label}
                                            className="max-h-full max-w-full object-contain"
                                            onError={(e) => {
                                                e.currentTarget.src = asset.routePath;
                                            }}
                                        />
                                    </div>
                                    <div className="mt-3 space-y-2">
                                        <Field
                                            label={`${asset.label} URL`}
                                            value={form[asset.key]}
                                            onChange={(value) => handleChange(asset.key, value)}
                                            placeholder={asset.routePath}
                                            error={asset.error}
                                        />
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                                            <Upload size={14} />
                                            {asset.uploadLabel}
                                            <input
                                                type="file"
                                                accept={asset.accept}
                                                className="hidden"
                                                disabled={asset.uploading}
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    asset.uploader(file);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                        <p className="text-[11px] text-gray-500 break-all !mb-0">
                                            Stable route: <span className="font-mono">{asset.routePath}</span>
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="relative z-10">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                            <Upload size={14} />
                            {isJumbotronUploading ? 'Uploading image...' : 'Browse & Upload Jumbotron'}
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={isJumbotronUploading}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    handleContactJumbotronUpload(file);
                                    e.target.value = '';
                                }}
                            />
                        </label>
                        {form.contactJumbotronImageUrl && (
                            <div className="mt-3 h-28 w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                                <img
                                    src={form.contactJumbotronImageUrl}
                                    alt="Contact jumbotron preview"
                                    className="h-full w-full object-cover"
                                    onError={(e) => { e.currentTarget.src = fallbackContactImage; }}
                                />
                            </div>
                        )}
                    </div>
                    {formErrors.socialUrl && <p className="relative z-10 text-xs text-red-600">{formErrors.socialUrl}</p>}
                </div>

                <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden">
                    <Building2 size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                    <div className="relative z-10">
                        <h3 className="text-sm font-semibold text-gray-800">Tax Management</h3>
                        <p className="text-xs text-gray-500 mt-1">Configure multiple tax rates and mark one as default for products.</p>
                    </div>
                    <div className="relative z-10 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800">Tax component in product price</h4>
                                <p className="mt-1 text-[11px] text-gray-500">
                                    {form.taxPriceMode === 'inclusive'
                                        ? 'Admin-entered product, variant, and shipping prices are treated as GST-inclusive. Checkout shows GST only as a breakup.'
                                        : 'Admin-entered product, variant, and shipping prices exclude GST. Checkout adds GST on top of the entered price.'}
                                </p>
                            </div>
                            <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
                                {[
                                    { value: 'exclusive', label: 'Exclusive' },
                                    { value: 'inclusive', label: 'Inclusive' }
                                ].map((option) => {
                                    const active = form.taxPriceMode === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => handleChange('taxPriceMode', option.value)}
                                            className={`min-w-[112px] rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                                active
                                                    ? 'bg-accent text-white shadow-sm'
                                                    : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="relative z-10">
                        <label className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 ${hasGstNumber ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                            <input
                                type="checkbox"
                                checked={Boolean(form.taxEnabled)}
                                onChange={(e) => handleChange('taxEnabled', e.target.checked)}
                                disabled={!hasGstNumber}
                            />
                            <span className="text-sm font-medium">Enable GST</span>
                        </label>
                        <p className="mt-1 text-[11px] text-gray-500">
                            GST is applied in checkout/orders only when enabled. Enter GST number first to enable this.
                        </p>
                    </div>
                    <div className={`relative z-10 transition-all ${form.taxEnabled ? '' : 'pointer-events-none select-none opacity-60 blur-[1.2px]'}`}>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        <div className="md:col-span-4">
                            <input
                                className="h-[46px] md:h-11 w-full rounded-xl border border-gray-200 px-4 text-sm text-gray-700 focus:border-accent outline-none disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder="Tax name (e.g. GST 3%)"
                                value={taxDraft.name}
                                onChange={(e) => setTaxDraft((prev) => ({ ...prev, name: e.target.value }))}
                                disabled={isTaxLoading}
                            />
                        </div>
                        <div className="md:col-span-3">
                            <input
                                className="h-[46px] md:h-11 w-full rounded-xl border border-gray-200 px-4 text-sm text-gray-700 focus:border-accent outline-none disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder="Code (GST3)"
                                value={taxDraft.code}
                                onChange={(e) => setTaxDraft((prev) => ({ ...prev, code: String(e.target.value || '').toUpperCase().replace(/[^0-9A-Z_]/g, '').slice(0, 40) }))}
                                disabled={isTaxLoading}
                            />
                        </div>
                        <div className="md:col-span-3">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className="h-[46px] md:h-11 w-full rounded-xl border border-gray-200 px-4 text-sm text-gray-700 focus:border-accent outline-none disabled:bg-gray-50 disabled:text-gray-400"
                                placeholder="Rate %"
                                value={taxDraft.ratePercent}
                                onChange={(e) => setTaxDraft((prev) => ({ ...prev, ratePercent: e.target.value }))}
                                disabled={isTaxLoading}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="button"
                                disabled={isTaxLoading}
                                onClick={handleCreateTax}
                                className="h-[46px] md:h-11 w-full inline-flex items-center justify-center gap-2 px-4 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            >
                                <Plus size={14} /> Add
                            </button>
                        </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                        {getGstRateSplit(Number(taxDraft.ratePercent || 0)).splitRateLabel}
                    </p>
                    <div className="mt-1 rounded-xl border border-gray-200 overflow-hidden">
                        <div className="md:hidden divide-y divide-gray-100">
                            {taxRates.map((tax) => {
                                const currentEdit = taxRateEdits[tax.id] || {};
                                const split = getGstRateSplit(Number(currentEdit.ratePercent ?? tax.ratePercent ?? 0));
                                return (
                                    <div key={`m-tax-${tax.id}`} className="p-3 grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Name</p>
                                            <input
                                                value={currentEdit.name ?? tax.name}
                                                onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), name: e.target.value } }))}
                                                className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Code</p>
                                            <input
                                                value={currentEdit.code ?? tax.code}
                                                onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), code: String(e.target.value || '').toUpperCase().replace(/[^0-9A-Z_]/g, '').slice(0, 40) } }))}
                                                className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">GST Rate %</p>
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.01"
                                                value={currentEdit.ratePercent ?? tax.ratePercent}
                                                onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), ratePercent: e.target.value } }))}
                                                className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                            <p className="h-4 mt-1 text-[10px] text-gray-500">{split.splitRateLabel}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-xs text-gray-600">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(tax.isActive)}
                                                    onChange={(e) => updateTaxRate(tax.id, { isActive: e.target.checked })}
                                                    disabled={isTaxLoading}
                                                />
                                                Active
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-gray-600">
                                                <input
                                                    type="radio"
                                                    name="defaultTaxRateMobile"
                                                    checked={Boolean(tax.isDefault)}
                                                    onChange={() => updateTaxRate(tax.id, { isDefault: true })}
                                                    disabled={isTaxLoading}
                                                />
                                                Default
                                            </label>
                                        </div>
                                        <div className="col-span-2 flex justify-end gap-2">
                                            <button
                                                type="button"
                                                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                                                onClick={() => saveTaxEdit(tax.id)}
                                                disabled={isTaxLoading}
                                            >
                                                <Save size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                onClick={() => deleteTaxRate(tax.id)}
                                                disabled={isTaxLoading}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {taxRates.length === 0 && (
                                <div className="px-3 py-5 text-center text-xs text-gray-500">No tax rates configured yet.</div>
                            )}
                        </div>
                        <table className="hidden md:table table-fixed w-full text-sm">
                            <colgroup>
                                <col className="w-[24%]" />
                                <col className="w-[24%]" />
                                <col className="w-[24%]" />
                                <col className="w-[7%]" />
                                <col className="w-[7%]" />
                                <col className="w-[14%]" />
                            </colgroup>
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Code</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Rate</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Active</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Default</th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {taxRates.map((tax) => (
                                    <tr key={tax.id} className="border-t border-gray-100">
                                        <td className="px-3 py-2 text-gray-700">
                                            <input
                                                value={taxRateEdits[tax.id]?.name ?? tax.name}
                                                onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), name: e.target.value } }))}
                                                className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            <input
                                                value={taxRateEdits[tax.id]?.code ?? tax.code}
                                                onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), code: String(e.target.value || '').toUpperCase().replace(/[^0-9A-Z_]/g, '').slice(0, 40) } }))}
                                                className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={taxRateEdits[tax.id]?.ratePercent ?? tax.ratePercent}
                                                    onChange={(e) => setTaxRateEdits((prev) => ({ ...prev, [tax.id]: { ...(prev[tax.id] || {}), ratePercent: e.target.value } }))}
                                                    className="h-9 w-full rounded-lg border border-gray-200 px-2 text-xs"
                                                />
                                                <span className="hidden xl:inline text-[10px] text-gray-500 whitespace-nowrap">
                                                    {getGstRateSplit(Number(taxRateEdits[tax.id]?.ratePercent ?? tax.ratePercent ?? 0)).splitRateLabel}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(tax.isActive)}
                                                onChange={(e) => updateTaxRate(tax.id, { isActive: e.target.checked })}
                                                disabled={isTaxLoading}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="radio"
                                                name="defaultTaxRate"
                                                checked={Boolean(tax.isDefault)}
                                                onChange={() => updateTaxRate(tax.id, { isDefault: true })}
                                                disabled={isTaxLoading}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                className="p-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                                                onClick={() => saveTaxEdit(tax.id)}
                                                disabled={isTaxLoading}
                                            >
                                                <Save size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                onClick={() => deleteTaxRate(tax.id)}
                                                disabled={isTaxLoading}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {taxRates.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-5 text-center text-xs text-gray-500">No tax rates configured yet.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    </div>
                </div>

                <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden">
                    <CreditCard size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                    <div className="relative z-10">
                        <h3 className="text-sm font-semibold text-gray-800">Razorpay Settings</h3>
                        <p className="text-xs text-gray-500 mt-1">Stored in database and used by checkout/webhooks.</p>
                    </div>
                    <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field
                            label="Razorpay Key ID"
                            value={form.razorpayKeyId}
                            onChange={(value) => handleChange('razorpayKeyId', value.trim())}
                            placeholder="rzp_live_xxxxx"
                            required
                            error={formErrors.razorpayKeyId}
                        />
                        <Field
                            label="Razorpay Key Secret"
                            value={form.razorpayKeySecret}
                            onChange={(value) => handleChange('razorpayKeySecret', value)}
                            placeholder={form.hasRazorpayKeySecret ? 'Enter key secret to replace' : 'Enter key secret'}
                            maskedValue={form.hasRazorpayKeySecret ? (form.razorpayKeySecretMask || '******') : ''}
                            type="password"
                        />
                        <Field
                            label="Webhook Secret"
                            value={form.razorpayWebhookSecret}
                            onChange={(value) => handleChange('razorpayWebhookSecret', value)}
                            placeholder={form.hasRazorpayWebhookSecret ? 'Enter webhook secret to replace' : 'Enter webhook secret'}
                            maskedValue={form.hasRazorpayWebhookSecret ? (form.razorpayWebhookSecretMask || '******') : ''}
                            type="password"
                        />
                        <Field
                            label="EMI Min Amount (INR)"
                            value={form.razorpayEmiMinAmount}
                            onChange={(value) => handleChange('razorpayEmiMinAmount', String(value || '').replace(/[^0-9]/g, ''))}
                            type="number"
                            required
                            error={formErrors.razorpayEmiMinAmount}
                        />
                        <Field
                            label="Starting Tenure (Months)"
                            value={form.razorpayStartingTenureMonths}
                            onChange={(value) => handleChange('razorpayStartingTenureMonths', String(value || '').replace(/[^0-9]/g, ''))}
                            type="number"
                            required
                            error={formErrors.razorpayStartingTenureMonths}
                        />
                    </div>
                </div>

                {isDevMode && (
                <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden">
                    <WhatsAppIcon size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                    <div className="relative z-10 flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-800">Communication Retry Log</h3>
                            <p className="text-xs text-gray-500 mt-1">Recent queued, sent, and failed communication retries for admin review.</p>
                        </div>
                        <button
                            type="button"
                            onClick={refreshCommunicationLogs}
                            disabled={isCommunicationLogsLoading}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                            {isCommunicationLogsLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                    <div className="relative z-10 overflow-hidden rounded-xl border border-gray-200">
                        <div className="hidden md:grid grid-cols-[90px_110px_minmax(0,1fr)_90px_90px_160px] bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            <span>Channel</span>
                            <span>Workflow</span>
                            <span>Recipient / Error</span>
                            <span>Status</span>
                            <span>Attempts</span>
                            <span>Updated</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {communicationLogs.map((log) => (
                                <div key={log.id} className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-[90px_110px_minmax(0,1fr)_90px_90px_160px] md:items-center">
                                    <span className="text-xs font-semibold uppercase text-gray-700">{log.channel}</span>
                                    <span className="text-xs text-gray-600">{log.workflow}</span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-gray-800">{log.recipient}</p>
                                        <p className="truncate text-xs text-gray-500">{log.lastError || 'No error recorded'}</p>
                                    </div>
                                    <span className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-[11px] font-semibold ${
                                        log.status === 'sent'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : log.status === 'failed'
                                                ? 'bg-red-50 text-red-700'
                                                : 'bg-amber-50 text-amber-700'
                                    }`}>
                                        {log.status}
                                    </span>
                                    <span className="text-xs text-gray-600">{log.attemptCount}/{log.maxAttempts}</span>
                                    <span className="text-xs text-gray-500">{formatLogDateTime(log.updatedAt)}</span>
                                </div>
                            ))}
                            {!communicationLogs.length && (
                                <div className="px-3 py-6 text-center text-xs text-gray-500">
                                    {isCommunicationLogsLoading ? 'Loading communication retry logs...' : 'No communication retry activity yet.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                )}

                {isDevMode && (
                    <div className="emboss-card relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 overflow-hidden">
                        <WhatsAppIcon size={72} className="bg-emboss-icon absolute right-3 bottom-2 text-gray-100" />
                        <div className="relative z-10">
                            <h3 className="text-sm font-semibold text-gray-800">WhatsApp Test</h3>
                            <p className="text-xs text-gray-500 mt-1">Send a test template and inspect provider response.</p>
                        </div>
                        <div className="relative z-10 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field
                                label="Recipient Mobile"
                                value={whatsappTestForm.mobile}
                                onChange={(value) => setWhatsappTestForm((prev) => ({ ...prev, mobile: String(value || '').replace(/\D/g, '').slice(0, 14) }))}
                                placeholder={form.whatsappNumber ? `Default: ${form.whatsappNumber}` : '91XXXXXXXXXX'}
                            />
                            <Field
                                label="Template"
                                value={whatsappTestForm.template}
                                onChange={(value) => setWhatsappTestForm((prev) => ({ ...prev, template: value }))}
                                placeholder="generic / login_otp / order ..."
                            />
                            <Field
                                label="Name"
                                value={whatsappTestForm.name}
                                onChange={(value) => setWhatsappTestForm((prev) => ({ ...prev, name: value }))}
                                placeholder="Customer name"
                            />
                            <Field
                                label="Params (Comma Separated)"
                                value={whatsappTestForm.params}
                                onChange={(value) => setWhatsappTestForm((prev) => ({ ...prev, params: value }))}
                                placeholder="Ravi,SSC Jewellery,Today"
                            />
                            <div className="md:col-span-2">
                                <Field
                                    label="Message (Optional Fallback)"
                                    value={whatsappTestForm.message}
                                    onChange={(value) => setWhatsappTestForm((prev) => ({ ...prev, message: value }))}
                                    placeholder="Optional plain text fallback"
                                />
                            </div>
                        </div>
                        <div className="relative z-10 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={handleSendWhatsappTest}
                                disabled={isWhatsappTestSending}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-60"
                            >
                                <WhatsAppIcon size={14} />
                                {isWhatsappTestSending ? 'Sending...' : 'Send Test WhatsApp'}
                            </button>
                        </div>
                        {whatsappTestResult && (
                            <div className="relative z-10">
                                <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-2">Response</p>
                                <pre className="max-h-64 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-700 whitespace-pre-wrap break-words">
                                    {JSON.stringify(whatsappTestResult, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                )}

                <div className="pt-2 flex justify-end">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-accent font-semibold shadow-lg shadow-primary/20 hover:bg-primary-light disabled:opacity-60"
                    >
                        <Save size={16} />
                        {isSaving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    type = 'text',
    icon: Icon = null,
    iconClassName = 'text-gray-400',
    required = false,
    error = '',
    maskedValue = ''
}) {
    const [isFocused, setIsFocused] = useState(false);
    const shouldShowMask = Boolean(maskedValue) && !String(value || '').length && !isFocused;
    const resolvedType = shouldShowMask ? 'text' : type;
    return (
        <label className="block">
            <span className="text-xs uppercase tracking-widest text-gray-400 font-semibold">
                {label}
                {required ? <span className="text-red-500"> *</span> : null}
            </span>
            <div className="relative mt-2">
                {Icon && <Icon size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${iconClassName}`} />}
                <input
                    type={resolvedType}
                    value={shouldShowMask ? maskedValue : (value || '')}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    autoComplete={type === 'password' ? 'new-password' : undefined}
                    className={`w-full rounded-xl border py-3 text-sm text-gray-700 focus:border-accent outline-none ${Icon ? 'pl-10 pr-4' : 'px-4'} ${error ? 'border-red-400 bg-red-50/30' : 'border-gray-200'}`}
                />
            </div>
            {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
        </label>
    );
}
