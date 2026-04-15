import Link from 'next/link';
import { cn } from '@/lib/utils';

type BrandWordmarkProps = {
  /** Ruta; si se omite, enlaza a inicio público `/`. Pasa `false` para solo imagen (sin enlace). */
  href?: string | false;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
};

/**
 * Logo horizontal CALIFÁCIL + marca (SVG vectorial para nitidez en retina / móvil).
 */
export function BrandWordmark({
  href,
  className,
  imgClassName,
  priority = false,
}: BrandWordmarkProps) {
  const to = href === false ? null : href ?? '/';

  const img = (
    <img
      src="/califacil-wordmark.svg"
      alt=""
      width={400}
      height={72}
      aria-hidden
      decoding="async"
      fetchPriority={priority ? 'high' : 'low'}
      className={cn('block h-auto w-auto max-w-full object-contain object-left', imgClassName)}
    />
  );

  if (to !== null) {
    return (
      <Link
        href={to}
        className={cn('inline-flex max-w-full items-center', className)}
        aria-label="CaliFácil, inicio"
      >
        {img}
      </Link>
    );
  }

  return (
    <span
      className={cn('inline-flex max-w-full items-center', className)}
      role="img"
      aria-label="CaliFácil"
    >
      {img}
    </span>
  );
}
