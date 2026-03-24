import { useEffect, useMemo, useState } from 'react';
import { Mail, Phone, MapPin, MessageCircle, Instagram, Send } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { useToast } from '../context/ToastContext';
import fallbackContactImage from '../assets/contact.jpg';
import { buildContactSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';

const CMS_API_URL = import.meta.env.PROD ? '/api/cms' : 'http://localhost:5000/api/cms';
const DEFAULT_JUMBOTRON = fallbackContactImage;

const DEFAULT_COMPANY = {
    displayName: 'SSC Jewellery',
    contactNumber: '',
    supportEmail: 'support@sscimpon.com',
    address: '',
    instagramUrl: '',
    whatsappNumber: '',
    contactJumbotronImageUrl: DEFAULT_JUMBOTRON
};

const cleanPhone = (value = '') => String(value || '').replace(/\D/g, '');

const InfoCard = ({ title, value, href = '', icon, iconTint = 'text-primary' }) => {
    if (!value) return null;
    const IconComponent = icon;
    return (
        <div className="emboss-card group relative overflow-hidden bg-white rounded-2xl border border-gray-200 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-accent/40">
            <IconComponent size={72} className="bg-emboss-icon absolute -bottom-2 -right-2 text-gray-100" />
            <div className="relative z-10 flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl bg-primary/10 ${iconTint} flex items-center justify-center`}>
                    <IconComponent size={18} />
                </div>
                <div>
                    <p className="text-xs uppercase tracking-widest text-gray-400 font-semibold">{title}</p>
                    {href ? (
                        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noreferrer' : undefined} className="text-sm text-gray-700 hover:text-primary break-all">
                            {value}
                        </a>
                    ) : (
                        <p className="text-sm text-gray-700 whitespace-pre-line">{value}</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function Contact() {
    const toast = useToast();
    const { companyInfo, refreshCompanyInfo, applyCompanyInfo: patchPublicCompanyInfo } = usePublicCompanyInfo();
    const company = useMemo(() => ({
        ...DEFAULT_COMPANY,
        ...(companyInfo || {}),
        contactJumbotronImageUrl: String(companyInfo?.contactJumbotronImageUrl || DEFAULT_JUMBOTRON)
    }), [companyInfo]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        orderId: '',
        message: ''
    });

    useEffect(() => {
        if (companyInfo) return;
        refreshCompanyInfo().catch(() => {});
    }, [companyInfo, refreshCompanyInfo]);

    useAdminCrudSync({
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            patchPublicCompanyInfo(nextCompany);
        }
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const res = await fetch(`${CMS_API_URL}/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: formData.name,
                    email: formData.email,
                    phone: formData.phone,
                    orderId: formData.orderId,
                    message: formData.message
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.message || 'Failed to submit contact request');
            }
            toast.success('Message sent successfully');
            setFormData({
                name: '',
                email: '',
                phone: '',
                orderId: '',
                message: ''
            });
        } catch (error) {
            toast.error(error?.message || 'Failed to send message');
        } finally {
            setIsSubmitting(false);
        }
    };

    const whatsappHref = useMemo(() => {
        const number = cleanPhone(company.whatsappNumber);
        return number ? `https://wa.me/${number}` : '';
    }, [company.whatsappNumber]);
    const seoConfig = useMemo(() => buildContactSeo({ company }), [company]);
    useSeo(seoConfig);

    const jumbotronImage = String(company.contactJumbotronImageUrl || DEFAULT_JUMBOTRON);

    return (
        <div className="min-h-screen bg-secondary pb-20">
            <div className="relative h-64 md:h-80 bg-gray-900 w-full overflow-hidden">
                <div className="absolute inset-0 bg-black/35 z-10" />
                <img
                    src={jumbotronImage}
                    alt="Contact"
                    className="absolute inset-0 w-full h-full object-cover"
                    decoding="async"
                    fetchPriority="high"
                    onError={(e) => { e.currentTarget.src = fallbackContactImage; }}
                />
                <div className="relative z-20 container mx-auto px-4 h-full flex flex-col justify-center items-center text-center">
                    <span className="text-accent uppercase tracking-[0.2em] text-xs md:text-sm font-bold mb-3">
                        Get In Touch
                    </span>
                    <h1 className="text-4xl md:text-6xl font-serif text-white mb-4 drop-shadow-lg">
                        Contact Us
                    </h1>
                </div>
            </div>

            <div className="container mx-auto px-4 py-10">
                <div className="text-center mb-10">
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-gray-400">Contact</p>
                    <h1 className="text-4xl md:text-5xl font-serif text-primary mt-3">We’re Here to Help</h1>
                    <p className="text-gray-500 mt-3 max-w-2xl mx-auto">
                        Reach out for product inquiries, order support, or custom requests. Our team will respond as soon as possible.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-10">
                    <InfoCard title="Email" value={company.supportEmail} href={company.supportEmail ? `mailto:${company.supportEmail}` : ''} icon={Mail} />
                    <InfoCard title="WhatsApp" value={company.whatsappNumber} href={whatsappHref} icon={MessageCircle} iconTint="text-green-600" />
                    <InfoCard title="Instagram" value={company.instagramUrl ? '@Visit Profile' : ''} href={company.instagramUrl} icon={Instagram} iconTint="text-pink-600" />
                    <InfoCard title="Call" value={company.contactNumber} href={company.contactNumber ? `tel:${company.contactNumber}` : ''} icon={Phone} iconTint="text-blue-600" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                        <h2 className="text-xl font-serif text-primary mb-4">Send a Message</h2>
                        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input name="name" value={formData.name} onChange={handleChange} placeholder="Full Name" className="input-field" required />
                            <input name="email" type="email" value={formData.email} onChange={handleChange} placeholder="Email Address" className="input-field" required />
                            <input name="phone" value={formData.phone} onChange={handleChange} placeholder="Phone Number" className="input-field" />
                            <input name="orderId" value={formData.orderId} onChange={handleChange} placeholder="Order ID (optional)" className="input-field" />
                            <textarea
                                name="message"
                                value={formData.message}
                                onChange={handleChange}
                                placeholder="How can we help you?"
                                className="input-field md:col-span-2 h-32 resize-none"
                                required
                            />
                            <button type="submit" disabled={isSubmitting} className="btn-primary md:col-span-2 flex items-center justify-center gap-2 disabled:opacity-60">
                                <Send size={16} /> {isSubmitting ? 'Submitting...' : 'Submit'}
                            </button>
                        </form>
                    </div>

                    <div className="space-y-6">
                        <InfoCard title="Registered Address" value={company.address || 'Address not set'} icon={MapPin} />
                        <InfoCard title="Company" value={company.displayName || 'SSC Jewellery'} icon={MapPin} />
                    </div>
                </div>
            </div>
        </div>
    );
}
