import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useSeo } from '../seo/useSeo';
import { buildDefaultSeo } from '../seo/rules';

export default function AppSeoDefaults() {
    const location = useLocation();
    const seo = useMemo(
        () => buildDefaultSeo(location.pathname || '/'),
        [location.pathname]
    );
    useSeo(seo);
    return null;
}
