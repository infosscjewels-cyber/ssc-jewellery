import { Link } from 'react-router-dom';
import constructionIllustration from '../assets/under_construction.svg';
import { useSeo } from '../seo/useSeo';

export default function ComingSoon() {
  useSeo({
    title: 'Coming Soon | SSC Jewellery',
    description: 'SSC Jewellery storefront is being prepared. Please check back shortly.',
    robots: 'noindex, nofollow',
    image: constructionIllustration,
    canonical: typeof window !== 'undefined' ? `${window.location.origin}/coming-soon` : '/coming-soon'
  });

  return (
    <div className="min-h-screen bg-secondary px-4 py-10 md:px-6">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl items-center justify-center">
        <div className="grid w-full items-center gap-8 rounded-[2rem] border border-gray-200 bg-white/95 p-6 shadow-sm md:grid-cols-[1.1fr_0.9fr] md:p-10">
          <div className="order-2 md:order-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-deep">Storefront Update</p>
            <h1 className="mt-3 font-serif text-4xl font-bold text-primary md:text-5xl">Coming Soon</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-gray-600">
              The storefront is not fully configured yet. Once the required live environment values are in place, the public site will open automatically.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/admin/login"
                className="inline-flex items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light"
              >
                Admin Login
              </Link>
              <Link
                to="/"
                className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Refresh Storefront
              </Link>
            </div>
          </div>
          <div className="order-1 flex justify-center md:order-2">
            <img
              src={constructionIllustration}
              alt="Storefront coming soon"
              className="w-full max-w-md"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
