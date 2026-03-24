import { Link, useLocation } from 'react-router-dom';
import missingIllustration from '../assets/404.svg';
import { useSeo } from '../seo/useSeo';

export default function NotFound() {
  const location = useLocation();

  useSeo({
    title: 'Page Not Found | SSC Jewellery',
    description: 'The page you requested could not be found.',
    robots: 'noindex, nofollow',
    image: missingIllustration,
    canonical: typeof window !== 'undefined' ? `${window.location.origin}${location.pathname}` : '/404'
  });

  return (
    <div className="min-h-screen bg-secondary px-4 py-10 md:px-6">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="grid w-full items-center gap-8 rounded-[2rem] border border-gray-200 bg-white/95 p-6 shadow-sm md:grid-cols-[0.95fr_1.05fr] md:p-10">
          <div className="flex justify-center">
            <img
              src={missingIllustration}
              alt="Page not found"
              className="w-full max-w-md"
              loading="eager"
              decoding="async"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-deep">404 Error</p>
            <h1 className="mt-3 font-serif text-4xl font-bold text-primary md:text-5xl">Page Not Found</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-gray-600">
              The page you were trying to open does not exist or has moved. Use one of the routes below to continue.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/"
                className="inline-flex items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light"
              >
                Go Home
              </Link>
              <Link
                to="/shop"
                className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Browse Shop
              </Link>
            </div>
            <p className="mt-5 text-sm text-gray-500">Requested path: {location.pathname}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
