import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

type BrandWordmarkProps = {
  /** Ruta; si se omite, enlaza a inicio público `/`. Pasa `false` para solo imagen (sin enlace). */
  href?: string | false;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
};

/**
 * Logo horizontal CALIFÁCIL + ícono (PNG con transparencia).
 */
export function BrandWordmark({
  href,
  className,
  imgClassName,
  priority = false,
}: BrandWordmarkProps) {
  const to = href === false ? null : href ?? '/';

  const img = (
    <Image
      src="/califacil-wordmark.png"
      alt=""
      width={320}
      height={80}
      className={cn('w-auto object-contain', imgClassName)}
      priority={priority}
    />
  );

  if (to !== null) {
    return (
      <Link
        href={to}
        className={cn('inline-flex items-center', className)}
        aria-label="CaliFácil, inicio"
      >
        {img}
      </Link>
    );
  }

  return (
    <span
      className={cn('inline-flex items-center', className)}
      role="img"
      aria-label="CaliFácil"
    >
      {img}
    </span>
  );
}
