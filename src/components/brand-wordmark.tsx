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
 * Logo CALIFÁCIL (PNG de alta resolución, escalado con CSS para nitidez en móvil).
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
      width={1024}
      height={500}
      sizes="(max-width: 640px) 85vw, 320px"
      className={cn('h-auto w-auto max-w-full object-contain object-left', imgClassName)}
      priority={priority}
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
