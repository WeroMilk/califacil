import Link from 'next/link';
import { cn } from '@/lib/utils';

type BrandWordmarkProps = {
  /** Ruta; si se omite, enlaza a inicio público `/`. Pasa `false` para solo imagen (sin enlace). */
  href?: string | false;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
};

/** Logo vectorial inline (evita 404 y problemas de `<img>` con SVG en algunos móviles/CDN). */
function CalifacilWordmarkSvg({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 420 72"
      fill="none"
      className={cn('block h-auto w-auto max-w-full shrink-0', className)}
      aria-hidden
      focusable="false"
    >
      <text
        x="0"
        y="52"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        fontSize="44"
        fontWeight="800"
        fill="#ea580c"
        letterSpacing="-0.03em"
      >
        CALIFÁCIL
      </text>
      <path
        d="M338 10 L356 30 L388 6"
        stroke="#16a34a"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Logo horizontal CALIFÁCIL + marca (SVG inline, nitidez en cualquier DPI).
 */
export function BrandWordmark({
  href,
  className,
  imgClassName,
  priority: _priority,
}: BrandWordmarkProps) {
  const to = href === false ? null : href ?? '/';

  const mark = <CalifacilWordmarkSvg className={imgClassName} />;

  if (to !== null) {
    return (
      <Link
        href={to}
        className={cn('inline-flex max-w-full items-center', className)}
        aria-label="CaliFácil, inicio"
      >
        {mark}
      </Link>
    );
  }

  return (
    <span
      className={cn('inline-flex max-w-full items-center', className)}
      role="img"
      aria-label="CaliFácil"
    >
      {mark}
    </span>
  );
}
