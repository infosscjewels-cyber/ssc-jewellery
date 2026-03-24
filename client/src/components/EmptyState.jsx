export default function EmptyState({
    image,
    alt,
    title,
    description = '',
    action = null,
    className = '',
    compact = false
}) {
    const imageClassName = compact
        ? 'h-16 w-16 md:h-20 md:w-20'
        : 'h-28 w-28 md:h-36 md:w-36';

    return (
        <div className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-6' : 'px-6 py-10'} ${className}`}>
            {image ? (
                <img
                    src={image}
                    alt={alt || title}
                    className={`${imageClassName} object-contain opacity-90`}
                    loading="lazy"
                    decoding="async"
                />
            ) : null}
            <h3 className={`mt-4 font-semibold text-gray-800 ${compact ? 'text-base' : 'text-xl'}`}>{title}</h3>
            {description ? (
                <p className={`mt-2 text-gray-500 ${compact ? 'max-w-xs text-sm' : 'max-w-lg text-sm md:text-base'}`}>{description}</p>
            ) : null}
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}
