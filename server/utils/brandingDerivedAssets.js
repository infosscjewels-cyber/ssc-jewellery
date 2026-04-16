const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const CompanyProfile = require('../models/CompanyProfile');
const { resolvePublicAssetPath } = require('./publicAssetResolver');

const pngToIco = pngToIcoModule?.default || pngToIcoModule;

const removeFileIfPresent = async (targetPath = '') => {
    const resolved = String(targetPath || '').trim();
    if (!resolved) return;
    try {
        await fs.promises.unlink(resolved);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
};

const buildDerivedFilename = (sourceFilename = '', suffix = '') => {
    const ext = path.extname(String(sourceFilename || ''));
    const base = path.basename(String(sourceFilename || ''), ext);
    return `${base}${suffix}.png`;
};

const generatePngVariant = async ({
    sourcePath,
    outputPath,
    size
} = {}) => {
    await sharp(sourcePath)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
};

const generateBrandingDerivedAssets = async (logoFile = null) => {
    const sourcePath = String(logoFile?.path || '').trim();
    const sourceFilename = String(logoFile?.filename || '').trim();
    const destinationDir = String(logoFile?.destination || '').trim();
    return generateBrandingDerivedAssetsFromSource({
        sourcePath,
        sourceFilename,
        destinationDir
    });
};

const isRemoteUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());

const resolveExistingAssetPath = (assetUrl = '') => {
    const raw = String(assetUrl || '').trim();
    if (!raw) return null;
    if (isRemoteUrl(raw)) return raw;
    return resolvePublicAssetPath(raw);
};

const isValidFaviconAsset = (assetUrl = '', resolvedPath = '') => {
    const raw = String(assetUrl || '').trim().toLowerCase();
    const resolved = String(resolvedPath || '').trim().toLowerCase();
    if (isRemoteUrl(raw)) {
        return raw.endsWith('.ico') || raw.endsWith('.png');
    }
    if (!resolved) return false;
    return resolved.endsWith('.ico') || resolved.endsWith('.png');
};

const isValidAppleTouchAsset = (assetUrl = '', resolvedPath = '') => {
    const raw = String(assetUrl || '').trim().toLowerCase();
    const resolved = String(resolvedPath || '').trim().toLowerCase();
    if (isRemoteUrl(raw)) {
        return ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => raw.endsWith(ext));
    }
    if (!resolved) return false;
    return ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => resolved.endsWith(ext));
};

const buildDerivedAssetPaths = ({
    sourcePath = '',
    sourceFilename = '',
    destinationDir = ''
} = {}) => {
    if (!sourcePath || !sourceFilename || !destinationDir) return null;
    const faviconFilename = buildDerivedFilename(sourceFilename, '-favicon-48x48');
    const faviconIcoFilename = `${path.basename(String(sourceFilename || ''), path.extname(String(sourceFilename || '')))}-favicon.ico`;
    const appleTouchFilename = buildDerivedFilename(sourceFilename, '-apple-touch-icon-180x180');
    return {
        faviconFilename,
        faviconIcoFilename,
        appleTouchFilename,
        faviconPath: path.join(destinationDir, faviconFilename),
        faviconIcoPath: path.join(destinationDir, faviconIcoFilename),
        appleTouchPath: path.join(destinationDir, appleTouchFilename)
    };
};

const cleanupBrandingDerivedAssetsForLogo = async (logoUrl = '') => {
    const sourcePath = resolveExistingAssetPath(logoUrl);
    if (!sourcePath || isRemoteUrl(sourcePath) || !fs.existsSync(sourcePath)) return;
    const sourceFilename = path.basename(sourcePath);
    const destinationDir = path.dirname(sourcePath);
    const derived = buildDerivedAssetPaths({ sourcePath, sourceFilename, destinationDir });
    if (!derived) return;
    await Promise.all([
        removeFileIfPresent(derived.faviconPath),
        removeFileIfPresent(derived.faviconIcoPath),
        removeFileIfPresent(derived.appleTouchPath)
    ]);
};

const generateBrandingDerivedAssetsFromSource = async ({
    sourcePath = '',
    sourceFilename = '',
    destinationDir = ''
} = {}) => {
    if (!sourcePath || !sourceFilename || !destinationDir || !fs.existsSync(sourcePath)) {
        return null;
    }

    const derived = buildDerivedAssetPaths({ sourcePath, sourceFilename, destinationDir });
    if (!derived) return null;

    await generatePngVariant({
        sourcePath,
        outputPath: derived.faviconPath,
        size: 48
    });
    const icoBuffer = await pngToIco(derived.faviconPath);
    await fs.promises.writeFile(derived.faviconIcoPath, icoBuffer);
    await generatePngVariant({
        sourcePath,
        outputPath: derived.appleTouchPath,
        size: 180
    });

    return {
        faviconUrl: `/uploads/branding/${derived.faviconIcoFilename}`,
        appleTouchIconUrl: `/uploads/branding/${derived.appleTouchFilename}`
    };
};

const ensureCompanyBrandingDerivedAssets = async () => {
    const company = await CompanyProfile.get().catch(() => null);
    const logoUrl = String(company?.logoUrl || '').trim();
    if (!logoUrl || isRemoteUrl(logoUrl)) return null;

    const faviconResolved = resolveExistingAssetPath(company?.faviconUrl || '');
    const appleResolved = resolveExistingAssetPath(company?.appleTouchIconUrl || '');
    const keepExistingFavicon = isValidFaviconAsset(company?.faviconUrl || '', faviconResolved);
    const keepExistingAppleTouch = isValidAppleTouchAsset(company?.appleTouchIconUrl || '', appleResolved);
    if (keepExistingFavicon && keepExistingAppleTouch) {
        return {
            updated: false,
            company
        };
    }

    const sourcePath = resolveExistingAssetPath(logoUrl);
    if (!sourcePath || isRemoteUrl(sourcePath) || !fs.existsSync(sourcePath)) return null;

    const sourceFilename = path.basename(sourcePath);
    const destinationDir = path.dirname(sourcePath);
    const derivedAssets = await generateBrandingDerivedAssetsFromSource({
        sourcePath,
        sourceFilename,
        destinationDir
    });
    if (!derivedAssets) return null;

    const nextPayload = {
        ...company,
        faviconUrl: keepExistingFavicon ? company.faviconUrl : derivedAssets.faviconUrl,
        appleTouchIconUrl: keepExistingAppleTouch ? company.appleTouchIconUrl : derivedAssets.appleTouchIconUrl
    };
    const updatedCompany = await CompanyProfile.update(nextPayload);
    if (!keepExistingFavicon && company?.faviconUrl && company.faviconUrl !== updatedCompany?.faviconUrl && company.faviconUrl !== company.logoUrl) {
        await removeFileIfPresent(faviconResolved);
    }
    if (!keepExistingAppleTouch && company?.appleTouchIconUrl && company.appleTouchIconUrl !== updatedCompany?.appleTouchIconUrl && company.appleTouchIconUrl !== company.logoUrl) {
        await removeFileIfPresent(appleResolved);
    }
    return {
        updated: true,
        company: updatedCompany
    };
};

module.exports = {
    generateBrandingDerivedAssets,
    ensureCompanyBrandingDerivedAssets,
    cleanupBrandingDerivedAssetsForLogo
};
