import { Link } from 'react-router-dom';
import closedIllustration from '../assets/shop_closed.svg';
import { useSeo } from '../seo/useSeo';

export default function StorefrontClosed() {
  useSeo({
    title: 'Shop Temporarily Closed | SSC Jewellery',
    description: 'SSC Jewellery is temporarily closed for new orders. Existing orders will still be fulfilled.',
    robots: 'noindex, nofollow',
    image: closedIllustration,
    canonical: typeof window !== 'undefined' ? `${window.location.origin}/checkout` : '/checkout'
  });

  return (
    <div className="min-h-[70vh] px-4 py-8 md:px-6">
      <div className="mx-auto grid max-w-5xl items-center gap-8 rounded-[2rem] border border-gray-200 bg-white/95 p-6 shadow-sm md:grid-cols-[0.95fr_1.05fr] md:p-10">
        <div className="flex justify-center">
          <img
            src={closedIllustration}
            alt="Shop temporarily closed"
            className="w-full max-w-sm"
            loading="eager"
            decoding="async"
          />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-deep">Storefront Closed</p>
          <h1 className="mt-3 font-serif text-4xl font-bold text-primary md:text-5xl">Orders Are Temporarily Paused</h1>
          <p className="mt-4 text-base leading-7 text-gray-600">
            New checkout and order placement are temporarily unavailable. Existing orders already placed with us will continue to be fulfilled as promised.
          </p>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            You can still browse the website, manage your profile, track your orders, add items to cart, and save products to wishlist.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/track-order" className="inline-flex items-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
              Track Order
            </Link>
            {/* <Link to="/profile" className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              My Profile
            </Link>
            <Link to="/cart" className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              View Cart
            </Link>
            <Link to="/wishlist" className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              Wishlist
            </Link> */}
            <Link to="/shop" className="inline-flex items-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
              Continue Browsing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
