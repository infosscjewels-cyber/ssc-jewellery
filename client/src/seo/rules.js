import { FAQ_ITEMS } from './faqContent.js';
import { DEFAULT_SOCIAL_IMAGE, NOINDEX_PATH_PREFIXES, NOINDEX_PATHS, SITE_DESCRIPTION, SITE_NAME } from './constants.js';
import {
    buildCanonical,
    buildDefaultDescription,
    buildKeywords,
    clampDescription,
    firstCategoryName,
    getCategoryImage,
    getProductImageCandidates,
    normalizeCategories,
    normalizeText,
    pickSocialImage,
    toTitle
} from './helpers.js';
import {
    buildBreadcrumbSchema,
    buildCreativePartnerSchema,
    buildFaqSchema,
    buildItemListSchema,
    buildLocalBusinessSchema,
    buildOrganizationSchema,
    buildProductSchema,
    buildSiteNavigationSchema,
    buildWebPageSchema,
    buildWebsiteSchema
} from './schema.js';

const robotsIndex = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
const robotsNoindex = 'noindex,nofollow';

export const isNoindexPath = (pathname = '') => {
    const path = String(pathname || '/').split('?')[0].toLowerCase();
    if (NOINDEX_PATHS.has(path)) return true;
    return NOINDEX_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
};

export const buildDefaultSeo = (pathname = '/') => {
    const noindex = isNoindexPath(pathname);
    return {
        title: toTitle(SITE_NAME),
        description: SITE_DESCRIPTION,
        keywords: buildKeywords(SITE_NAME, 'jewellery', 'fashion jewellery', 'imitation jewellery'),
        canonical: buildCanonical(pathname),
        robots: noindex ? robotsNoindex : robotsIndex,
        image: pickSocialImage({ fallbackImage: DEFAULT_SOCIAL_IMAGE }),
        structuredData: noindex ? [] : [buildOrganizationSchema(), buildLocalBusinessSchema(), buildWebsiteSchema({ includeSearchAction: true })]
    };
};

export const buildHomeSeo = ({
    company = {},
    categories = [],
    products = [],
    slides = [],
    banners = []
} = {}) => {
    const categoryNames = (Array.isArray(categories) ? categories : []).map((entry) => normalizeText(entry?.name)).filter(Boolean);
    const productTitles = (Array.isArray(products) ? products : []).map((entry) => normalizeText(entry?.title)).filter(Boolean);
    const preferredImages = [
        ...(Array.isArray(slides) ? slides : []).map((entry) => normalizeText(entry?.image_url || entry?.imageUrl)).filter(Boolean),
        ...(Array.isArray(banners) ? banners : []).map((entry) => normalizeText(entry?.image_url || entry?.imageUrl || entry?.image)).filter(Boolean)
    ];
    const categoryImages = (Array.isArray(categories) ? categories : []).map((entry) => getCategoryImage(entry)).filter(Boolean);
    const productImages = (Array.isArray(products) ? products : []).flatMap((product) => getProductImageCandidates(product));
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const featuredCategories = categoryNames.slice(0, 4);
    const description = clampDescription(
        featuredCategories.length
            ? `${brand} offers imitation and fashion jewellery across ${featuredCategories.join(', ')}. Shop best sellers, new arrivals, and current offers online.`
            : `${brand} offers imitation and fashion jewellery across popular collections. Shop best sellers, new arrivals, and current offers online.`
    );

    return {
        title: toTitle(brand),
        description,
        keywords: buildKeywords(brand, categoryNames, productTitles.slice(0, 8), ['imitation jewellery', 'fashion jewellery', 'online jewellery']),
        canonical: buildCanonical('/'),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages, categoryImages, productImages }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildWebsiteSchema({ includeSearchAction: true }),
            buildItemListSchema(products, { name: `${brand} featured products` })
        ]
    };
};

export const buildShopSeo = ({
    company = {},
    products = [],
    categories = [],
    selectedCategory = 'all'
} = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const categoryNames = (Array.isArray(categories) ? categories : []).map((entry) => normalizeText(entry?.name)).filter(Boolean);
    const selected = normalizeText(selectedCategory);
    const selectedCategoryName = normalizeText(selectedCategory);
    const title = selected && selected !== 'all'
        ? `Shop ${selectedCategoryName} Collection Online`
        : 'Shop Jewellery Collections Online';
    const description = selected && selected !== 'all'
        ? clampDescription(`Browse ${selectedCategoryName} at ${brand}. Discover current offers, live availability, and featured styles online.`)
        : clampDescription(`Browse jewellery collections at ${brand}. Explore ${categoryNames.slice(0, 4).join(', ') || 'popular categories'} with current offers and storefront-ready products online.`);
    const categoryImages = (Array.isArray(categories) ? categories : []).map((entry) => getCategoryImage(entry)).filter(Boolean);
    const productImages = (Array.isArray(products) ? products : []).flatMap((product) => getProductImageCandidates(product));

    return {
        title: toTitle(title),
        description,
        keywords: buildKeywords(brand, title, categoryNames, (products || []).map((product) => product?.title).slice(0, 8)),
        canonical: buildCanonical('/shop'),
        robots: robotsIndex,
        image: pickSocialImage({ categoryImages, productImages }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'Shop', url: '/shop' }
            ]),
            buildItemListSchema(products, { name: title }),
            buildWebsiteSchema({ includeSearchAction: true })
        ]
    };
};

export const buildCategorySeo = ({
    company = {},
    category = null,
    products = []
} = {}) => {
    const categoryName = normalizeText(category?.name || category?.title) || 'Category';
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const topProducts = (Array.isArray(products) ? products : []).map((product) => normalizeText(product?.title)).filter(Boolean);
    const topProductPreview = topProducts.slice(0, 4);
    const productCount = Array.isArray(products) ? products.length : 0;
    const description = clampDescription(
        topProductPreview.length
            ? `Shop ${categoryName} at ${brand}. Discover ${topProductPreview.join(', ')}${productCount > 4 ? ` and more` : ''} with current pricing and availability online.`
            : `Shop ${categoryName} at ${brand}. Explore storefront-ready jewellery with current pricing and availability online.`
    );
    const categoryImage = getCategoryImage(category);
    const productImages = (Array.isArray(products) ? products : []).flatMap((product) => getProductImageCandidates(product));

    return {
        title: toTitle(`${categoryName} Jewellery Collection`),
        description,
        keywords: buildKeywords(brand, categoryName, topProducts.slice(0, 8), ['shop by category', 'jewellery collection']),
        canonical: buildCanonical(`/shop/${encodeURIComponent(categoryName)}`),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [categoryImage], productImages }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'Shop', url: '/shop' },
                { name: categoryName, url: `/shop/${encodeURIComponent(categoryName)}` }
            ]),
            buildItemListSchema(products, { name: `${categoryName} collection` })
        ]
    };
};

export const buildProductSeo = ({
    company = {},
    product = null
} = {}) => {
    if (!product?.id) return buildDefaultSeo('/product');
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const categoryName = firstCategoryName(product.categories);
    const displayPrice = (() => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const variantPrices = variants
            .map((variant) => Number(variant.discount_price || variant.price || 0))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (variantPrices.length) return Math.min(...variantPrices);
        return Number(product.discount_price || product.mrp || 0);
    })();
    const productTitle = normalizeText(product.title) || 'Jewellery Product';
    const subtitle = normalizeText(product.subtitle);
    const productTitleWithQualifier = subtitle && !productTitle.toLowerCase().includes(subtitle.toLowerCase())
        ? `${productTitle} - ${subtitle}`
        : productTitle;
    const description = clampDescription(
        normalizeText(product.description)
        || buildDefaultDescription({
            title: productTitle,
            subtitle,
            category: categoryName,
            price: displayPrice,
            extra: 'View current offers, delivery support, and live availability.',
            brand
        })
    );
    const productImages = getProductImageCandidates(product);
    const breadcrumbItems = [
        { name: 'Home', url: '/' },
        { name: 'Shop', url: '/shop' }
    ];
    if (categoryName) breadcrumbItems.push({ name: categoryName, url: `/shop/${encodeURIComponent(categoryName)}` });
    breadcrumbItems.push({ name: normalizeText(product.title) || 'Product', url: `/product/${product.id}` });

    return {
        title: toTitle(productTitleWithQualifier),
        description,
        keywords: buildKeywords(
            brand,
            product.title,
            product.subtitle,
            normalizeCategories(product.categories),
            product.sku ? [`SKU ${product.sku}`] : []
        ),
        canonical: buildCanonical(`/product/${product.id}`),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: productImages }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema(breadcrumbItems),
            buildProductSchema(product)
        ].filter(Boolean)
    };
};

export const buildFaqSeo = ({ company = {} } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    return {
        title: toTitle('Frequently Asked Questions'),
        description: clampDescription(`Read frequently asked questions about orders, shipping, refunds, and product support at ${brand}.`),
        keywords: buildKeywords(brand, 'FAQ', 'shipping questions', 'refund questions', 'polishing support'),
        canonical: buildCanonical('/faq'),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [company.contactJumbotronImageUrl] }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'FAQ', url: '/faq' }
            ]),
            buildFaqSchema(FAQ_ITEMS)
        ]
    };
};

export const buildAboutSeo = ({ company = {}, products = [], categories = [] } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const categoryNames = (categories || []).map((entry) => normalizeText(entry?.name)).filter(Boolean);
    return {
        title: toTitle(`About ${brand}`),
        description: clampDescription(
            `${brand} offers imitation and fashion jewellery${categoryNames.length ? ` across ${categoryNames.slice(0, 3).join(', ')}` : ''}. Learn more about our store promise, product support, and customer-first service.`
        ),
        keywords: buildKeywords(brand, 'about', (categories || []).map((entry) => entry?.name), (products || []).map((entry) => entry?.title).slice(0, 5)),
        canonical: buildCanonical('/about'),
        robots: robotsIndex,
        image: pickSocialImage({
            preferredImages: [company.contactJumbotronImageUrl],
            categoryImages: (categories || []).map((entry) => getCategoryImage(entry)),
            productImages: (products || []).flatMap((product) => getProductImageCandidates(product))
        }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'About', url: '/about' }
            ])
        ]
    };
};

export const buildContactSeo = ({ company = {} } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const cityOrAddress = normalizeText(company.address);
    return {
        title: toTitle(`Contact ${brand}`),
        description: clampDescription(
            `Contact ${brand}${cityOrAddress ? ` in ${cityOrAddress}` : ''} for order help, product questions, and customer support via email, phone, or WhatsApp.`
        ),
        keywords: buildKeywords(brand, 'contact', 'customer support', company.supportEmail, company.contactNumber, company.whatsappNumber),
        canonical: buildCanonical('/contact'),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [company.contactJumbotronImageUrl] }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'Contact', url: '/contact' }
            ])
        ]
    };
};

export const buildPolicySeo = ({ company = {}, policyKey = 'terms', policyTitle = 'Terms & Conditions' } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    return {
        title: toTitle(policyTitle),
        description: clampDescription(`${policyTitle} for ${brand}. Review store policies, legal terms, shipping, refunds, privacy, and customer obligations.`),
        keywords: buildKeywords(brand, policyTitle, 'store policy', policyKey),
        canonical: buildCanonical(`/${policyKey === 'terms' ? 'terms' : policyKey}`),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [company.contactJumbotronImageUrl] }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: policyTitle, url: `/${policyKey === 'terms' ? 'terms' : policyKey}` }
            ])
        ]
    };
};

export const buildCreditsSeo = ({ company = {} } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const title = 'Site Credits';
    const description = clampDescription(
        `Website design, frontend implementation, and technical development credits for ${brand}, created by Creativecodz.`
    );
    const developer = buildCreativePartnerSchema();
    return {
        title: toTitle(title),
        description,
        keywords: buildKeywords(brand, title, 'website credits', 'development partner', 'Creativecodz'),
        canonical: buildCanonical('/site-credits'),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [company.contactJumbotronImageUrl] }),
        structuredData: [
            buildOrganizationSchema(company),
            developer,
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'Site Credits', url: '/site-credits' }
            ]),
            buildWebPageSchema({
                name: `${brand} site credits`,
                description,
                path: '/site-credits',
                about: {
                    '@type': 'Organization',
                    name: developer.name,
                    url: developer.url
                }
            })
        ]
    };
};

export const buildSitemapPageSeo = ({ company = {}, links = [] } = {}) => {
    const brand = normalizeText(company.displayName) || SITE_NAME;
    const title = 'Sitemap';
    const description = clampDescription(
        `Browse the HTML sitemap for ${brand} to access collections, policies, support pages, and important storefront links.`
    );
    const navLinks = (Array.isArray(links) ? links : []).slice(0, 40);
    return {
        title: toTitle(title),
        description,
        keywords: buildKeywords(brand, title, 'html sitemap', 'site links', 'collections'),
        canonical: buildCanonical('/sitemap'),
        robots: robotsIndex,
        image: pickSocialImage({ preferredImages: [company.contactJumbotronImageUrl] }),
        structuredData: [
            buildOrganizationSchema(company),
            buildLocalBusinessSchema(company),
            buildBreadcrumbSchema([
                { name: 'Home', url: '/' },
                { name: 'Sitemap', url: '/sitemap' }
            ]),
            buildWebPageSchema({
                name: `${brand} sitemap`,
                description,
                path: '/sitemap'
            }),
            buildSiteNavigationSchema(navLinks)
        ]
    };
};
