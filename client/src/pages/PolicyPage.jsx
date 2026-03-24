import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Copyright, FileText, RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { buildPolicySeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { getWebsiteUrl } from '../utils/publicContact';

const DEFAULT_COMPANY = {
    displayName: 'SSC Impon Jewellery',
    supportEmail: '',
    contactNumber: '',
    address: ''
};

const resolveCompanyAddress = (company = {}) => {
    const direct = String(company.address || '').trim();
    if (direct) return direct;
    const composed = [
        company.addressLine1,
        company.addressLine2,
        company.city,
        company.state,
        company.zip || company.pincode
    ]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(', ');
    return composed;
};

const getJurisdiction = (address = '') => {
    const parts = String(address || '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
    if (parts.length === 1) return parts[0];
    return 'as per registered office address configured by the merchant';
};

const getPolicyContent = ({ merchantName, registeredOffice, jurisdiction, effectiveDate, supportEmail, websiteUrl }) => ({
    terms: {
        title: 'Terms & Conditions',
        sections: [
            { heading: 'Effective Date', paragraphs: [effectiveDate, `Merchant Name: ${merchantName}`, `Registered Office & Exclusive Jurisdiction: ${registeredOffice}`] },
            { heading: '1. Acceptance of Terms', paragraphs: ['By accessing or purchasing from this Website, the Customer agrees to be legally bound by these Terms, Shipping Policy, Refund Policy, and Privacy Policy.'] },
            { heading: '2. Nature of Products', bullets: [
                'All jewellery sold is Artificial / Imitation / Fashion Jewellery.',
                'Products are not made of real gold, silver, diamond, or precious gemstones unless explicitly stated.',
                'Natural fading, plating wear, or discoloration due to usage conditions shall not be considered a defect.',
                'Slight design, shade, or finishing variations are inherent in artificial jewellery.'
            ] },
            { heading: '3. No Warranty', bullets: [
                'All products are sold strictly without any warranty, express or implied.',
                'There is no lifetime, structural, color, or stone warranty.',
                'Durability depends entirely on usage and care by the Customer.'
            ] },
            { heading: '4. 6-Month Polishing Service Guarantee', bullets: [
                'Polishing service validity is product-specific (6, 7, 8, 9, or 12 months) from the date of delivery.',
                'This covers only re-polishing of plating.',
                'Does not cover breakage, stone fall, misuse, bending, or chemical damage.',
                'Customer must bear shipping charges both ways.',
                'Management reserves the right to reject polishing requests if product is damaged.'
            ] },
            { heading: '5. Customer Maintenance Responsibility', paragraphs: ['Customers must avoid water, sweat, perfume, and chemicals; store products in dry airtight containers; clean gently with soft cloth only; and avoid wearing during physical strain or sleep. Failure voids polishing support.'] },
            { heading: '6. Payment Policy', bullets: ['Only prepaid payments accepted.', 'No Cash on Delivery (COD).', 'Orders are confirmed only after successful payment authorization.', 'Company reserves the right to cancel suspicious transactions.'] },
            { heading: '7. Failed Transactions Clause', bullets: [
                'If payment is debited but order shows unsuccessful, customer must contact their issuing bank or payment provider.',
                'Refund timelines depend on banking systems (typically 5 to 10 working days or as per bank policy).',
                'The company does not manually hold such funds.',
                'Banking reconciliation delays are beyond merchant control.'
            ] },
            { heading: '8. Razorpay EMI Clause', bullets: [
                'EMI options are facilitated via Razorpay and issuing banks.',
                'Approval, interest rates, foreclosure, and penalties are governed by the issuing bank.',
                'The merchant has no control over EMI terms.',
                'Any EMI dispute, pre-closure, charge, or cancellation must be resolved directly with the card issuing bank.'
            ] },
            { heading: '9. Fraud Prevention & Chargeback Protection', bullets: [
                'False non-delivery claims, intentional chargebacks post-delivery, manipulated open-box videos, and payment disputes without contacting merchant support may be treated as fraud.',
                'The company may contest chargebacks legally, report fraud, initiate legal recovery, and blacklist accounts.'
            ] },
            { heading: '10. Arbitration Clause (Strong & Binding)', bullets: [
                'Disputes will first be attempted to be resolved amicably within 15 days of written notice.',
                'If unresolved, disputes shall be referred to sole arbitration under the Arbitration and Conciliation Act, 1996 (India).',
                'Arbitration shall be conducted by a sole arbitrator appointed exclusively by the merchant.',
                `Seat and venue of arbitration: ${jurisdiction} only.`,
                'Proceedings shall be conducted in English.',
                'Award of arbitrator shall be final and binding.',
                'Parties waive right to class-action or consolidated proceedings.',
                `Courts at ${jurisdiction} alone shall have supervisory jurisdiction.`
            ] },
            { heading: '11. Limitation of Liability', paragraphs: ['Maximum liability is limited to product purchase value. No indirect, incidental, or punitive damages.'] },
            { heading: '12. Risk Transfer', paragraphs: ['Risk passes to customer upon confirmed delivery by courier.'] },
            { heading: '13. Management Decision Finality', paragraphs: ['All decisions by management regarding refund eligibility, fraud assessment, and policy interpretation shall be final and binding.'] },
            { heading: '14. Force Majeure', paragraphs: ['Company is not liable for delays due to natural calamities, lockdowns, strikes, government actions, or courier disruptions.'] },
            { heading: '15. Governing Law', paragraphs: [`Governed strictly by laws of India. Exclusive jurisdiction: Courts at ${jurisdiction} only.`] }
        ]
    },
    shipping: {
        title: 'Shipping Policy',
        sections: [
            { heading: '1. Order Processing', paragraphs: ['Orders are processed within 2 to 3 working days. Sundays and public holidays are excluded.'] },
            { heading: '2. Delivery Timelines', paragraphs: ['Delivery time depends on location and courier partner. Estimated timelines are not guaranteed.'] },
            { heading: '3. Courier Delays', paragraphs: ['Company is not responsible for weather delays, logistic strikes, route disruptions, or remote area delays.'] },
            { heading: '4. Address Accuracy', paragraphs: ['Customer must provide correct full address, PIN code, and contact number. Wrong address may result in return-to-origin and re-shipping charges.'] },
            { heading: '5. Delivery Attempts', paragraphs: ['Courier will attempt delivery as per their policy. Repeated non-availability may lead to cancellation without refund of shipping charges.'] },
            { heading: '6. Open Box Requirement', paragraphs: ['Customers must record uninterrupted video while opening package for defect claims.'] },
            { heading: '7. Tampered Packages', paragraphs: ['If outer packaging appears tampered, record video immediately and inform support within 24 hours.'] },
            { heading: '8. International Shipping (If Applicable)', paragraphs: ['Custom duties and taxes are borne by the customer.'] },
            { heading: '9. Refused Deliveries', paragraphs: ['If customer refuses delivery without valid reason, shipping charges are non-refundable.'] },
            { heading: '10. Risk Transfer', paragraphs: ['Risk transfers upon successful courier confirmation.'] },
            { heading: '11. Lost in Transit', paragraphs: ['Investigation period depends on courier policy before replacement or refund.'] },
            { heading: '12. Partial Shipments', paragraphs: ['Orders may be shipped separately if required.'] }
        ]
    },
    refund: {
        title: 'Cancellation & Refund Policy',
        sections: [
            { heading: '1. Order Cancellation', paragraphs: ['Cancellation is allowed only before dispatch. Cancellation is not allowed after shipping confirmation.'] },
            { heading: '2. No Return Policy', paragraphs: ['Strictly no return unless manufacturing defect is verified.'] },
            { heading: '3. Manufacturing Defect Claim', bullets: ['Open box video is mandatory.', 'Video must show sealed package.', 'Claim must be made within 24 hours of delivery.', 'No claim is entertained without video evidence.'] },
            { heading: '4. Non-Eligible Refund Reasons', bullets: ['Change of mind', 'Color difference', 'Minor finishing variation', 'Urgency-related complaints', 'Courier delays'] },
            { heading: '5. Duplicate / Excess Payment', paragraphs: ['Refund is processed after internal verification within 7 to 10 working days.'] },
            { heading: '6. Failed Transaction Refunds', paragraphs: ['Customer must contact issuing bank first.'] },
            { heading: '7. EMI Cancellation', paragraphs: ['For EMI-related cancellations, bank policies apply.'] },
            { heading: '8. Refund Mode', paragraphs: ['Refund is processed only to the original payment method.'] },
            { heading: '9. Return Condition', paragraphs: ['If approved, product must be unused and in original packaging.'] },
            { heading: '10. Shipping Charges', paragraphs: ['Shipping charges are non-refundable unless defect is confirmed.'] },
            { heading: '11. Fraudulent Claims', paragraphs: ['False claims will result in blacklisting and legal action.'] },
            { heading: '12. Management Discretion', paragraphs: ['Refund decisions are solely at management discretion.'] }
        ]
    },
    privacy: {
        title: 'Privacy Policy',
        sections: [
            { heading: '1. Information Collected', paragraphs: ['Name, phone, email, address, IP address, and transaction references may be collected.'] },
            { heading: '2. Payment Data', paragraphs: ['Card details are not stored by the merchant.'] },
            { heading: '3. Purpose of Data', paragraphs: ['Order processing, shipping, fraud prevention, and legal compliance.'] },
            { heading: '4. Data Sharing', bullets: ['Courier partners', 'Payment gateways', 'Government authorities (if legally required)'] },
            { heading: '5. Razorpay & EMI Data', paragraphs: ['EMI-related data is governed by issuing bank and Razorpay policies.'] },
            { heading: '6. Data Security', paragraphs: ['Reasonable safeguards are implemented.'] },
            { heading: '7. Cookies', paragraphs: ['Website may use cookies for functionality and analytics.'] },
            { heading: '8. Marketing Consent', paragraphs: ['Promotional messages are sent only with consent.'] },
            { heading: '9. Data Retention', paragraphs: ['Data is retained as required by law.'] },
            { heading: '10. User Rights', paragraphs: ['Users may request correction or deletion subject to compliance obligations.'] },
            { heading: '11. Fraud Monitoring', paragraphs: ['Transactions may be monitored for fraud detection.'] },
            { heading: '12. Policy Updates', paragraphs: ['Company may update this privacy policy at any time.'] },
            { heading: 'Contact', paragraphs: [supportEmail ? `For privacy queries: ${supportEmail}` : 'For privacy queries, contact the support email configured in company settings.'] }
        ]
    },
    copyright: {
        title: 'Copyright & Legal Disclaimer',
        sections: [
            { heading: 'Website Ownership', paragraphs: [`This website (${websiteUrl}) and all associated brand assets are operated by ${merchantName}.`] },
            { heading: 'Copyright Notice', paragraphs: ['All content on this website including logos, product photos, graphics, text, and layout is protected by applicable copyright and intellectual property laws. Unauthorized copying, reproduction, or republication is prohibited without prior written permission.'] },
            { heading: 'Trademark Disclaimer', paragraphs: ['Brand names, product names, and logos used on this website are either property of the merchant or used with lawful permission where applicable.'] },
            { heading: 'Product Representation Disclaimer', paragraphs: ['Product images are for representation purposes only. Slight differences in shade, texture, and finish may occur due to photography, screen settings, and handcrafted/artificial jewellery characteristics.'] },
            { heading: 'No Professional Advice', paragraphs: ['Content on this website is for general informational and commercial purposes only and does not constitute legal, financial, or professional advice.'] },
            { heading: 'Limitation of Liability', paragraphs: ['The merchant shall not be liable for direct, indirect, incidental, or consequential damages arising from use of this site, to the extent permissible under law.'] },
            { heading: 'Third-Party Services', paragraphs: ['Payment processing, logistics, and financing/EMI options may be provided by third parties. Their terms and policies apply independently.'] },
            { heading: 'Legal Jurisdiction', paragraphs: [`Any legal dispute related to this website is subject to the exclusive jurisdiction of courts at ${jurisdiction}.`] },
            { heading: 'Contact', paragraphs: [supportEmail ? `For legal notices: ${supportEmail}` : 'For legal notices, contact the support email configured in company settings.', `Registered office: ${registeredOffice}`] }
        ]
    }
});

const POLICY_THEME = {
    terms: { Icon: FileText, iconTint: 'text-amber-100', chipBg: 'bg-amber-50', chipText: 'text-amber-700' },
    shipping: { Icon: Truck, iconTint: 'text-sky-100', chipBg: 'bg-sky-50', chipText: 'text-sky-700' },
    refund: { Icon: RefreshCw, iconTint: 'text-rose-100', chipBg: 'bg-rose-50', chipText: 'text-rose-700' },
    privacy: { Icon: ShieldCheck, iconTint: 'text-emerald-100', chipBg: 'bg-emerald-50', chipText: 'text-emerald-700' },
    copyright: { Icon: Copyright, iconTint: 'text-violet-100', chipBg: 'bg-violet-50', chipText: 'text-violet-700' }
};

export default function PolicyPage() {
    const location = useLocation();
    const { companyInfo, applyCompanyInfo } = usePublicCompanyInfo();
    const WEBSITE_URL = useMemo(() => getWebsiteUrl(), []);
    const company = useMemo(() => ({
        ...DEFAULT_COMPANY,
        ...(companyInfo || {}),
        address: resolveCompanyAddress(companyInfo || {}) || DEFAULT_COMPANY.address
    }), [companyInfo]);

    const policyKey = useMemo(() => {
        const pathname = String(location.pathname || '').toLowerCase();
        if (pathname === '/shipping') return 'shipping';
        if (pathname === '/refund') return 'refund';
        if (pathname === '/privacy') return 'privacy';
        if (pathname === '/copyright') return 'copyright';
        return 'terms';
    }, [location.pathname]);

    const merchantName = String(company.displayName || DEFAULT_COMPANY.displayName).trim() || DEFAULT_COMPANY.displayName;
    const registeredOffice = resolveCompanyAddress(company) || 'Address not set';
    const jurisdiction = getJurisdiction(registeredOffice);
    const effectiveDate = `Effective Date: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`;
    const policies = getPolicyContent({
        merchantName,
        registeredOffice,
        jurisdiction,
        effectiveDate,
        supportEmail: String(company.supportEmail || '').trim(),
        websiteUrl: WEBSITE_URL
    });
    const current = policies[policyKey];
    const seoConfig = useMemo(() => buildPolicySeo({
        company,
        policyKey,
        policyTitle: current?.title || 'Policy'
    }), [company, current?.title, policyKey]);
    useSeo(seoConfig);

    useAdminCrudSync({
        'company:info_update': ({ company: nextCompany } = {}) => {
            if (!nextCompany || typeof nextCompany !== 'object') return;
            applyCompanyInfo(nextCompany);
        }
    });

    const theme = POLICY_THEME[policyKey] || POLICY_THEME.terms;
    const HeaderIcon = theme.Icon;

    return (
        <div className="min-h-screen bg-secondary py-10">
            <div className="max-w-5xl mx-auto px-4 md:px-8">
                <div className="mb-4 text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary">Home</Link>
                    <span className="mx-2 text-gray-300">{'>'}</span>
                    <span className="text-gray-700">{current.title}</span>
                </div>
                <div className="emboss-card relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
                    <HeaderIcon size={156} className={`bg-emboss-icon absolute top-3 right-3 ${theme.iconTint}`} strokeWidth={1.4} />
                    <h1 className="text-3xl md:text-4xl font-serif text-primary">{current.title}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${theme.chipBg} ${theme.chipText}`}>
                            {current.title}
                        </span>
                        <span className="text-sm text-gray-500">Website: {WEBSITE_URL}</span>
                    </div>
                    <div className="mt-6 space-y-6">
                        {current.sections.map((section) => (
                            <section key={section.heading} className="space-y-2">
                                <h2 className="text-base md:text-lg font-semibold text-gray-900">{section.heading}</h2>
                                {Array.isArray(section.paragraphs) && section.paragraphs.map((line) => (
                                    <p key={line} className="text-sm text-gray-700 leading-relaxed">{line}</p>
                                ))}
                                {Array.isArray(section.bullets) && (
                                    <ul className="list-disc pl-5 space-y-1">
                                        {section.bullets.map((line) => (
                                            <li key={line} className="text-sm text-gray-700 leading-relaxed">{line}</li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
