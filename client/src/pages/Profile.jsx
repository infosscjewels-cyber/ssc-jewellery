import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Camera,
    CheckCircle,
    CreditCard,
    Home,
    Mail,
    MapPin,
    Phone,
    ShieldCheck,
    Sparkles,
    User,
    Package,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authService } from '../services/authService';
import { useMyOrders } from '../context/OrderContext';
import { formatTierLabel, getMembershipLabel, getNextTierFromCurrent, getTierSpendKey } from '../utils/tierFormat';
import { formatMissingProfileFields } from '../utils/membershipUnlock';
import ordersIllustration from '../assets/orders.svg';

const emptyAddress = { line1: '', city: '', state: '', zip: '' };
const TIER_THEME = {
    regular: {
        card: 'from-slate-700 via-slate-600 to-slate-700',
        chip: 'bg-slate-100 text-slate-700 border-slate-200',
        profileBorder: 'border-slate-200',
        profileImageBorder: 'border-slate-300',
        profileRibbon: 'bg-slate-700 text-white',
        title: 'text-white',
        body: 'text-slate-100',
        caption: 'text-slate-200',
        button: 'bg-white/20 text-white hover:bg-white hover:text-slate-800'
    },
    bronze: {
        card: 'from-amber-800 via-orange-700 to-amber-800',
        chip: 'bg-amber-100 text-amber-800 border-amber-200',
        profileBorder: 'border-amber-300',
        profileImageBorder: 'border-amber-400',
        profileRibbon: 'bg-amber-700 text-white',
        title: 'text-white',
        body: 'text-amber-50',
        caption: 'text-amber-100',
        button: 'bg-white/20 text-white hover:bg-white hover:text-amber-900'
    },
    silver: {
        card: 'from-slate-600 via-zinc-500 to-slate-600',
        chip: 'bg-slate-100 text-slate-700 border-slate-200',
        profileBorder: 'border-slate-300',
        profileImageBorder: 'border-slate-400',
        profileRibbon: 'bg-slate-600 text-white',
        title: 'text-white',
        body: 'text-slate-100',
        caption: 'text-slate-200',
        button: 'bg-white/20 text-white hover:bg-white hover:text-slate-800'
    },
    gold: {
        card: 'from-amber-900 via-amber-800 to-amber-900',
        chip: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        profileBorder: 'border-yellow-300',
        profileImageBorder: 'border-yellow-400',
        profileRibbon: 'bg-yellow-600 text-amber-950',
        title: 'text-amber-50',
        body: 'text-amber-100',
        caption: 'text-amber-200',
        button: 'bg-amber-200/20 text-amber-50 hover:bg-white hover:text-amber-950'
    },
    platinum: {
        card: 'from-sky-700 via-blue-500 to-sky-700',
        chip: 'bg-sky-100 text-sky-800 border-sky-200',
        profileBorder: 'border-sky-300',
        profileImageBorder: 'border-sky-400',
        profileRibbon: 'bg-sky-700 text-white',
        title: 'text-white',
        body: 'text-sky-50',
        caption: 'text-sky-100',
        button: 'bg-white/20 text-white hover:bg-white hover:text-sky-900'
    }
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const getOrderSavings = (order = {}) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const productSavings = items.reduce((sum, item) => {
        const qty = toNumber(item?.quantity, 0);
        const price = toNumber(item?.price, 0);
        const original = toNumber(item?.original_price ?? item?.compare_at ?? item?.mrp, 0);
        if (original <= price || qty <= 0) return sum;
        return sum + ((original - price) * qty);
    }, 0);
    const promoSavings = toNumber(order?.discount_total, 0);
    return productSavings + promoSavings;
};

export default function Profile() {
    const { user, updateUser } = useAuth();
    const toast = useToast();
    const [activeTab, setActiveTab] = useState('profile');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [sameAsBilling, setSameAsBilling] = useState(false);
    const [profileImage, setProfileImage] = useState('');
    const [loyaltyStatus, setLoyaltyStatus] = useState(null);
    const [form, setForm] = useState({
        name: '',
        email: '',
        mobile: '',
        dob: '',
        address: { ...emptyAddress },
        billingAddress: { ...emptyAddress },
    });
    const { orders: profileOrders, isLoading: ordersLoading } = useMyOrders({
        page: 1,
        limit: 10,
        duration: 'all'
    });

    useEffect(() => {
        if (!user) return;
        setProfileImage(user.profileImage || '');
        setForm({
            name: user.name || '',
            email: user.email || '',
            mobile: user.mobile || '',
            dob: user.dob || '',
            address: { ...emptyAddress, ...(user.address || {}) },
            billingAddress: { ...emptyAddress, ...(user.billingAddress || user.address || {}) },
        });
        const addr = { ...emptyAddress, ...(user.address || {}) };
        const billing = { ...emptyAddress, ...(user.billingAddress || user.address || {}) };
        const isSame = JSON.stringify(addr) === JSON.stringify(billing);
        setSameAsBilling(isSame);
    }, [user]);

    useEffect(() => {
        if (!user) return;
        authService.getLoyaltyStatus().then((data) => {
            if (data?.status) setLoyaltyStatus(data.status);
        }).catch(() => {});
    }, [user]);

    const handleFieldChange = (e) => {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleAddressChange = (section, field, value) => {
        setForm((prev) => ({
            ...prev,
            [section]: { ...prev[section], [field]: value },
        }));
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const res = await authService.uploadProfileImage(file);
            if (!res?.url) {
                toast.error(res?.message || 'Failed to upload image');
                return;
            }
            setProfileImage(res.url);
            const updated = await authService.updateProfile({ profileImage: res.url });
            if (updated?.user) {
                updateUser(updated.user);
                toast.success('Profile photo updated');
            } else {
                toast.error(updated?.message || 'Failed to save profile photo');
            }
        } catch (error) {
            toast.error(error?.message || 'Failed to upload image');
        } finally {
            setIsUploading(false);
        }
    };

    useEffect(() => {
        if (!sameAsBilling) return;
        setForm((prev) => ({
            ...prev,
            address: { ...prev.billingAddress }
        }));
    }, [sameAsBilling, form.billingAddress]);

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        try {
            const res = await authService.updateProfile({
                name: form.name,
                email: form.email,
                mobile: form.mobile,
                dob: form.dob,
                address: form.address,
                billingAddress: form.billingAddress,
                profileImage: profileImage || ''
            });
            if (res?.user) {
                updateUser(res.user);
                toast.success('Profile updated successfully');
                setIsEditing(false);
            } else {
                toast.error(res?.message || 'Failed to update profile');
            }
        } catch (error) {
            toast.error(error?.message || 'Failed to update profile');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        if (!user) return;
        setIsEditing(false);
        setProfileImage(user.profileImage || '');
        setForm({
            name: user.name || '',
            email: user.email || '',
            mobile: user.mobile || '',
            dob: user.dob || '',
            address: { ...emptyAddress, ...(user.address || {}) },
            billingAddress: { ...emptyAddress, ...(user.billingAddress || user.address || {}) },
        });
    };

    const addressSummary = useMemo(() => {
        const a = form.address;
        return [a.line1, a.city, a.state, a.zip].filter(Boolean).join(', ') || 'No address on file';
    }, [form.address]);

    const formatDate = (value) => {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    if (!user) return null;
    const dobLocked = !!user.dobLocked;
    const tier = String(loyaltyStatus?.tier || user?.loyaltyTier || 'regular').toLowerCase();
    const tierTheme = TIER_THEME[tier] || TIER_THEME.regular;
    const tierLabel = formatTierLabel(loyaltyStatus?.profile?.label || tier);
    const progressPct = Number(loyaltyStatus?.progress?.progressPct || 0);
    const spendKey = getTierSpendKey(tier);
    const currentSpend = Number(loyaltyStatus?.spends?.[spendKey] || 0);
    const neededToNext = Number(loyaltyStatus?.progress?.needed || 0);
    const nextTierKey = loyaltyStatus?.progress?.nextTier || getNextTierFromCurrent(tier);
    const nextTierLabel = nextTierKey ? formatTierLabel(loyaltyStatus?.nextTierProfile?.label || nextTierKey) : '';
    const progressMessage = String(loyaltyStatus?.progress?.message || '').trim();
    const isProgressMessageDuplicated = Boolean(
        nextTierLabel
        && neededToNext > 0
        && /spend/i.test(progressMessage)
        && /unlock/i.test(progressMessage)
    );
    const membershipMessage = (!isProgressMessageDuplicated && progressMessage)
        ? progressMessage
        : 'Keep your profile updated to receive curated offers.';
    const membershipEligibility = loyaltyStatus?.eligibility || null;
    const isMembershipEligible = Boolean(membershipEligibility?.isEligible ?? true);
    const profileCompletionPct = Number(membershipEligibility?.completionPct || 0);
    const missingProfileFields = Array.isArray(membershipEligibility?.missingFields)
        ? membershipEligibility.missingFields
        : [];
    const membershipUnlockState = formatMissingProfileFields(missingProfileFields);

    return (
        <div className="bg-secondary min-h-screen">
            <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-14">
                <div className="flex flex-col lg:flex-row gap-8">
                    <div className="lg:w-1/3 space-y-6">
                        <div className={`relative bg-white rounded-2xl shadow-xl border-2 ${tierTheme.profileBorder} p-6 overflow-hidden`}>
                            {tier !== 'regular' && (
                                <span className={`absolute top-0 right-0 px-3 py-1 text-[10px] md:text-xs font-bold tracking-[0.12em] rounded-bl-xl ${tierTheme.profileRibbon}`}>
                                    {tierLabel}
                                </span>
                            )}
                            <div className="flex items-start gap-4">
                                <div className="relative">
                                    <div className={`w-20 h-20 rounded-2xl bg-gray-100 border-2 ${tierTheme.profileImageBorder} overflow-hidden flex items-center justify-center`}>
                                        {profileImage ? (
                                            <img src={profileImage} alt={user.name || 'Profile'} className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="text-gray-400" size={32} />
                                        )}
                                    </div>
                            <label className={`absolute -bottom-2 -right-2 bg-primary text-white rounded-full p-2 shadow-lg ${isUploading ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}>
                                <Camera size={14} />
                                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploading} />
                            </label>
                        </div>
                                <div className="flex-1">
                                    <p className="text-xs uppercase tracking-[0.3em] text-gray-400 font-semibold">Customer</p>
                                    <h1 className="text-2xl font-serif font-bold text-primary mt-1">{form.name || 'Your Profile'}</h1>
                                    <p className="text-sm text-gray-500 mt-1">{form.email || 'Add your email for updates'}</p>
                                    <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
                                        <CheckCircle size={14} /> Verified shopper
                                    </div>
                                </div>
                            </div>
                            <div className="mt-6 space-y-3 text-sm text-gray-600">
                                <div className="flex items-center gap-2">
                                    <Phone size={16} className="text-gray-400" />
                                    <span>{form.mobile || 'Add your contact number'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <MapPin size={16} className="text-gray-400" />
                                    <span>{addressSummary}</span>
                                </div>
                            </div>
                        </div>

                        <div className={`relative overflow-hidden bg-gradient-to-br ${tierTheme.card} rounded-2xl p-6 shadow-xl`}>
                            <div className="flex items-center gap-3">
                                <Sparkles size={18} className="text-accent" />
                                <p className={`!mb-0 text-xs uppercase tracking-[0.3em] font-semibold ${tierTheme.caption}`}>Member Perks</p>
                            </div>
                            <p className={`!mb-0 text-lg font-semibold mt-3 ${tierTheme.title}`}>
                                {getMembershipLabel(tierLabel)} active.
                            </p>
                            <p className={`!mb-0 text-sm mt-2 ${tierTheme.body}`}>
                                {membershipMessage}
                            </p>
                            {!isMembershipEligible && (
                                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
                                    <p className="text-xs font-semibold !mb-0">
                                        Membership eligibility locked: profile {profileCompletionPct}% complete.
                                    </p>
                                    <p className="text-[11px] mt-1 !mb-0">
                                        Complete all profile details to unlock tier discounts and shipping benefits.
                                    </p>
                                    {membershipUnlockState.items.length > 0 && (
                                        <div className="mt-2">
                                            <p className="text-[11px] font-semibold !mb-0">{membershipUnlockState.title}</p>
                                            <ul className="mt-1 space-y-1 text-[11px]">
                                                {membershipUnlockState.items.map((field) => (
                                                    <li key={field}>- {field}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className={`mt-3 text-xs ${tierTheme.caption}`}>
                                Spent: ₹{currentSpend.toLocaleString('en-IN')}
                            </div>
                            <div className={`mt-1 text-xs ${tierTheme.caption}`}>
                                {nextTierLabel ? `Need ₹${neededToNext.toLocaleString('en-IN')} more for ${getMembershipLabel(nextTierLabel)}` : 'You are at the highest tier.'}
                            </div>
                            <div className="mt-4 h-2 rounded-full bg-white/30 overflow-hidden">
                                <div className="h-full bg-white rounded-full" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
                            </div>
                            <div className={`mt-2 text-xs ${tierTheme.caption}`}>
                                {progressPct}% to {nextTierLabel ? getMembershipLabel(nextTierLabel) : 'next tier'}
                            </div>
                            <Link to="/shop" className={`inline-flex items-center justify-center mt-5 px-4 py-2 rounded-lg transition-colors text-sm font-semibold ${tierTheme.button}`}>
                                Explore Collections
                            </Link>
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-100 shadow-lg p-6">
                            <p className="text-xs uppercase tracking-[0.3em] text-gray-400 font-semibold">Quick Actions</p>
                            <div className="mt-4 space-y-3">
                                <Link to="/forgot-password" state={{ from: 'customer' }} className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm font-semibold text-gray-700">
                                    Reset Password
                                    <ShieldCheck size={16} className="text-primary" />
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('orders')}
                                    className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm font-semibold text-gray-700"
                                >
                                    View Orders
                                    <CreditCard size={16} className="text-primary" />
                                </button>
                                <Link to="/wishlist" className="flex items-center justify-between w-full px-4 py-3 rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm font-semibold text-gray-700">
                                    My Wishlist
                                    <Package size={16} className="text-primary" />
                                </Link>
                            </div>
                        </div>
                    </div>

                    <div className="lg:flex-1 space-y-6">
                        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.3em] text-gray-400 font-semibold">Account Center</p>
                                    <h2 className="text-2xl font-serif text-primary font-bold mt-2">Profile & Orders</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setActiveTab('profile')}
                                        className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === 'profile' ? 'bg-primary text-white shadow' : 'text-gray-500 hover:text-primary'}`}
                                    >
                                        Profile Details
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('orders')}
                                        className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === 'orders' ? 'bg-primary text-white shadow' : 'text-gray-500 hover:text-primary'}`}
                                    >
                                        Orders
                                    </button>
                                </div>
                            </div>

                            {activeTab === 'profile' && (
                                <div className="mt-8 space-y-6">
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-sm font-semibold text-gray-800">Current Benefits</p>
                                                {tier !== 'regular' && (
                                                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${tierTheme.chip}`}>
                                                        {tierLabel}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                {(loyaltyStatus?.profile?.benefits || ['Standard pricing', 'Progress tracking']).map((benefit) => (
                                                    <p key={benefit} className="text-sm text-gray-600">- {benefit}</p>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-white p-5">
                                            <p className="text-sm font-semibold text-gray-800">Next Tier Benefits</p>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {loyaltyStatus?.nextTierProfile?.label
                                                    ? `${loyaltyStatus.nextTierProfile.label} unlocks these perks`
                                                    : 'You are already at the highest tier'}
                                            </p>
                                            <div className="mt-3 space-y-2">
                                                {(loyaltyStatus?.nextTierProfile?.benefits || ['Highest tier reached']).map((benefit) => (
                                                    <p key={benefit} className="text-sm text-gray-600">- {benefit}</p>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-gray-800">Personal Information</h3>
                                        {!isEditing ? (
                                            <button onClick={() => setIsEditing(true)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all">
                                                Edit Profile
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <button onClick={handleCancel} disabled={isSaving} className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-60">
                                                    Cancel
                                                </button>
                                                <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark transition-all disabled:opacity-60">
                                                    {isSaving ? 'Saving...' : 'Save Changes'}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Full Name</label>
                                            <div className="relative">
                                                <input
                                                    name="name"
                                                    value={form.name}
                                                    onChange={handleFieldChange}
                                                    disabled={!isEditing}
                                                    className="input-field pl-10 disabled:bg-gray-50"
                                                />
                                                <User size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Email Address</label>
                                            <div className="relative">
                                                <input
                                                    name="email"
                                                    type="email"
                                                    value={form.email}
                                                    onChange={handleFieldChange}
                                                    disabled={!isEditing}
                                                    className="input-field pl-10 disabled:bg-gray-50"
                                                />
                                                <Mail size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Mobile Number</label>
                                            <div className="relative">
                                                <input
                                                    name="mobile"
                                                    value={form.mobile}
                                                    onChange={handleFieldChange}
                                                    disabled={!isEditing}
                                                    className="input-field pl-10 disabled:bg-gray-50"
                                                />
                                                <Phone size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-[0.2em] text-gray-400 font-semibold">Date of Birth</label>
                                            <div className="relative">
                                                <input
                                                    name="dob"
                                                    type="date"
                                                    value={form.dob}
                                                    onChange={handleFieldChange}
                                                    disabled={!isEditing || dobLocked}
                                                    className="input-field pl-10 disabled:bg-gray-50"
                                                />
                                                <Sparkles size={16} className="absolute left-3 top-3.5 text-gray-400" />
                                            </div>
                                            {dobLocked && (
                                                <p className="text-[11px] text-gray-400">DOB can only be changed once after registration.</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                                        <CreditCard size={16} className="text-primary" />
                                                        Billing Address
                                                    </h4>
                                                </div>
                                                <div className="space-y-3">
                                                    <input
                                                        value={form.billingAddress.line1}
                                                        onChange={(e) => handleAddressChange('billingAddress', 'line1', e.target.value)}
                                                        disabled={!isEditing}
                                                        placeholder="Street Address"
                                                        className="input-field disabled:bg-gray-50"
                                                    />
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <input
                                                            value={form.billingAddress.city}
                                                            onChange={(e) => handleAddressChange('billingAddress', 'city', e.target.value)}
                                                            disabled={!isEditing}
                                                            placeholder="City"
                                                            className="input-field disabled:bg-gray-50"
                                                        />
                                                        <input
                                                            value={form.billingAddress.state}
                                                            onChange={(e) => handleAddressChange('billingAddress', 'state', e.target.value)}
                                                            disabled={!isEditing}
                                                            placeholder="State"
                                                            className="input-field disabled:bg-gray-50"
                                                        />
                                                    </div>
                                                    <input
                                                        value={form.billingAddress.zip}
                                                        onChange={(e) => handleAddressChange('billingAddress', 'zip', e.target.value)}
                                                        disabled={!isEditing}
                                                        placeholder="Zip"
                                                        className="input-field disabled:bg-gray-50"
                                                    />
                                                </div>
                                            </div>

                                            <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                                        <Home size={16} className="text-primary" />
                                                        Shipping Address
                                                    </h4>
                                                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                                                        <input
                                                            type="checkbox"
                                                            checked={sameAsBilling}
                                                            onChange={(e) => setSameAsBilling(e.target.checked)}
                                                            className="accent-primary"
                                                            disabled={!isEditing}
                                                        />
                                                        Same as Billing
                                                    </label>
                                                </div>
                                                <div className="space-y-3">
                                                    <input
                                                        value={form.address.line1}
                                                        onChange={(e) => handleAddressChange('address', 'line1', e.target.value)}
                                                        disabled={!isEditing || sameAsBilling}
                                                        placeholder="Street Address"
                                                        className="input-field disabled:bg-gray-50"
                                                    />
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <input
                                                            value={form.address.city}
                                                            onChange={(e) => handleAddressChange('address', 'city', e.target.value)}
                                                            disabled={!isEditing || sameAsBilling}
                                                            placeholder="City"
                                                            className="input-field disabled:bg-gray-50"
                                                        />
                                                        <input
                                                            value={form.address.state}
                                                            onChange={(e) => handleAddressChange('address', 'state', e.target.value)}
                                                            disabled={!isEditing || sameAsBilling}
                                                            placeholder="State"
                                                            className="input-field disabled:bg-gray-50"
                                                        />
                                                    </div>
                                                    <input
                                                        value={form.address.zip}
                                                        onChange={(e) => handleAddressChange('address', 'zip', e.target.value)}
                                                        disabled={!isEditing || sameAsBilling}
                                                        placeholder="Zip"
                                                        className="input-field disabled:bg-gray-50"
                                                    />
                                                </div>
                                            </div>
                                    </div>

                                    <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 text-sm text-primary-dark">
                                        Member pricing and eligibility are recalculated monthly, with live progress shown here after each purchase.
                                    </div>
                                </div>
                            )}

                            {activeTab === 'orders' && (
                                <div className="mt-10">
                                    {ordersLoading ? (
                                        <div className="py-10 text-sm text-gray-400 text-center">Loading your orders...</div>
                                    ) : profileOrders.length === 0 ? (
                                        <div className="flex flex-col items-center text-center gap-6">
                                            <img src={ordersIllustration} alt="No orders" className="w-52 md:w-64" />
                                            <div>
                                                <h3 className="text-xl font-semibold text-gray-800">No orders found</h3>
                                                <p className="text-sm text-gray-500 mt-2 max-w-md">
                                                    Check our latest collections to get started with something special crafted just for you.
                                                </p>
                                            </div>
                                            <Link to="/shop" className="btn-primary px-6 py-3 rounded-xl">
                                                Shop Now
                                            </Link>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {profileOrders.map((order) => (
                                                <div key={order.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 overflow-hidden shrink-0">
                                                            {order.items?.[0]?.image_url ? (
                                                                <img src={order.items[0].image_url} alt={order.items?.[0]?.title || 'Order item'} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                                    <Package size={16} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-semibold text-gray-800 truncate">{order.order_ref}</p>
                                                            <p className="text-xs text-gray-500">Placed on {formatDate(order.created_at)}</p>
                                                            {getOrderSavings(order) > 0 && (
                                                                <p className="text-xs text-emerald-700 mt-1">Savings ₹{getOrderSavings(order).toLocaleString('en-IN')}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <p className="text-sm font-semibold text-gray-800 shrink-0">₹{Number(order.total || 0).toLocaleString()}</p>
                                                </div>
                                            ))}
                                            <div className="pt-2">
                                                <Link to="/orders" className="text-sm font-semibold text-primary hover:underline">
                                                    View all orders
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
