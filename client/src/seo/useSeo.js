import { useEffect } from 'react';
import { absoluteUrl } from './helpers.js';
import { buildDefaultSeo } from './rules.js';

const MANAGED_ATTR = 'data-ssc-seo';

const upsertMeta = ({ selector, attributes, content }) => {
    let node = document.head.querySelector(selector);
    if (!node) {
        node = document.createElement('meta');
        document.head.appendChild(node);
    }
    Object.entries(attributes || {}).forEach(([key, value]) => {
        if (value != null) node.setAttribute(key, value);
    });
    node.setAttribute(MANAGED_ATTR, 'true');
    node.setAttribute('content', content || '');
};

const upsertLink = ({ selector, rel, href }) => {
    let node = document.head.querySelector(selector);
    if (!node) {
        node = document.createElement('link');
        document.head.appendChild(node);
    }
    node.setAttribute(MANAGED_ATTR, 'true');
    node.setAttribute('rel', rel);
    node.setAttribute('href', href || '');
};

const applyStructuredData = (items = []) => {
    Array.from(document.head.querySelectorAll(`script[type="application/ld+json"][${MANAGED_ATTR}="true"]`))
        .forEach((node) => node.remove());
    (Array.isArray(items) ? items : [])
        .filter(Boolean)
        .forEach((item) => {
            const script = document.createElement('script');
            script.type = 'application/ld+json';
            script.setAttribute(MANAGED_ATTR, 'true');
            script.textContent = JSON.stringify(item);
            document.head.appendChild(script);
        });
};

export const applySeoToDocument = (config = {}) => {
    if (typeof document === 'undefined') return;
    const seo = { ...buildDefaultSeo(window.location?.pathname || '/'), ...(config || {}) };
    document.title = seo.title || buildDefaultSeo('/').title;

    upsertMeta({ selector: 'meta[name="description"]', attributes: { name: 'description' }, content: seo.description });
    upsertMeta({ selector: 'meta[name="keywords"]', attributes: { name: 'keywords' }, content: seo.keywords || '' });
    upsertMeta({ selector: 'meta[name="robots"]', attributes: { name: 'robots' }, content: seo.robots });
    upsertMeta({ selector: 'meta[property="og:type"]', attributes: { property: 'og:type' }, content: seo.ogType || 'website' });
    upsertMeta({ selector: 'meta[property="og:site_name"]', attributes: { property: 'og:site_name' }, content: seo.siteName || 'SSC Jewellery' });
    upsertMeta({ selector: 'meta[property="og:title"]', attributes: { property: 'og:title' }, content: seo.ogTitle || seo.title });
    upsertMeta({ selector: 'meta[property="og:description"]', attributes: { property: 'og:description' }, content: seo.ogDescription || seo.description });
    upsertMeta({ selector: 'meta[property="og:url"]', attributes: { property: 'og:url' }, content: seo.canonical });
    upsertMeta({ selector: 'meta[property="og:image"]', attributes: { property: 'og:image' }, content: absoluteUrl(seo.image) });
    upsertMeta({ selector: 'meta[name="twitter:card"]', attributes: { name: 'twitter:card' }, content: seo.twitterCard || 'summary_large_image' });
    upsertMeta({ selector: 'meta[name="twitter:title"]', attributes: { name: 'twitter:title' }, content: seo.twitterTitle || seo.title });
    upsertMeta({ selector: 'meta[name="twitter:description"]', attributes: { name: 'twitter:description' }, content: seo.twitterDescription || seo.description });
    upsertMeta({ selector: 'meta[name="twitter:image"]', attributes: { name: 'twitter:image' }, content: absoluteUrl(seo.image) });
    upsertLink({ selector: 'link[rel="canonical"]', rel: 'canonical', href: seo.canonical });
    applyStructuredData(seo.structuredData || []);
};

export const useSeo = (config = {}) => {
    useEffect(() => {
        applySeoToDocument(config);
    }, [config]);
};
