import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Button } from '@/components/ui/button';
import { QrCode, Sparkles, BarChart3, ArrowRight, Copyright } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-x-hidden bg-transparent sm:overflow-y-auto app-scroll">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 px-2 py-1 max-sm:min-h-[3.35rem] sm:min-h-[4rem] sm:gap-3 sm:px-6 sm:py-2 lg:min-h-[5rem] lg:px-10">
          <BrandWordmark
            priority
            className="min-w-0 shrink lg:origin-left lg:scale-[1.12]"
            imgClassName="h-9 w-auto max-w-[min(100%,18rem)] object-contain object-left sm:h-[3.35rem] sm:max-w-[26rem] lg:h-16 lg:max-w-[32rem]"
          />
          <nav className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 px-1.5 text-[10px] text-gray-700 max-[360px]:px-1 max-[360px]:text-[9.5px] sm:h-9 sm:px-3 sm:text-sm"
            >
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-[10px] max-[360px]:px-1.5 max-[360px]:text-[9.5px] sm:h-9 sm:px-4 sm:text-sm"
              asChild
            >
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden max-sm:overflow-y-auto">
        <section className="mx-auto flex min-h-full w-full max-w-7xl flex-1 flex-col justify-evenly gap-5 px-3 py-5 pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] sm:gap-7 sm:px-6 sm:py-7 md:gap-8 md:py-8 lg:justify-between lg:px-10 lg:py-10">
          <div className="flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8">
            {/* 1–3: hero de texto */}
            <div className="mx-auto w-full max-w-[min(100%,35rem)] shrink-0 text-center sm:max-w-3xl lg:max-w-4xl">
              <p className="text-[10px] font-medium uppercase tracking-wide text-orange-600 sm:text-sm lg:text-base">
                Plataforma para Docentes
              </p>
              <h1 className="mt-1.5 text-balance text-[clamp(1.5rem,6.4vw,2.9rem)] font-bold leading-[1.08] tracking-tight text-gray-900 sm:mt-2 sm:leading-[1.1]">
                Crea tus exámenes, imprime y califica TODO el mismo día.
              </h1>
              <p className="mx-auto mt-2 max-w-2xl text-pretty text-[clamp(0.92rem,2.1vw,1.3rem)] leading-snug text-gray-600 sm:mt-4 sm:leading-relaxed">
                Crea evaluaciones personalizadas, compártelas con tus grupos y revisa resultados en un solo
                lugar. Sin complicaciones.
              </p>
            </div>

            {/* 4–5: botones CTA */}
            <div className="mx-auto w-full max-w-[min(100%,35rem)] shrink-0 sm:max-w-3xl">
              <div className="flex flex-col items-stretch justify-center gap-2.5 sm:flex-row sm:items-center sm:justify-center sm:gap-3 lg:gap-4">
                <Button
                  size="sm"
                  className="h-11 w-full min-w-0 text-base font-semibold sm:h-11 sm:min-w-[200px] sm:w-auto sm:text-sm md:min-w-[220px] lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/register">
                    Regístrate gratis
                    <ArrowRight className="ml-1.5 h-4 w-4 sm:ml-2 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 w-full min-w-0 border-orange-200 bg-white/80 text-base font-semibold sm:h-11 sm:min-w-[200px] sm:w-auto sm:text-sm md:min-w-[220px] lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/login">Ya tengo cuenta</Link>
                </Button>
              </div>
            </div>
          </div>

          {/* 6–8: cajas de información */}
          <div className="mx-auto grid w-full max-w-[min(100%,36rem)] shrink-0 grid-cols-1 gap-2.5 pb-1 sm:max-w-4xl sm:grid-cols-3 sm:gap-3 lg:max-w-none lg:gap-4">
            <div className="flex flex-row items-start gap-2 rounded-md border border-orange-100/80 bg-white/85 p-2.5 shadow-sm backdrop-blur-md sm:min-h-[9.5rem] sm:flex-col sm:gap-2.5 sm:rounded-xl sm:p-3.5 md:min-h-[10.25rem] lg:min-h-[10.75rem] lg:p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-100 text-orange-700 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-xs font-semibold text-gray-900 sm:text-sm lg:text-base">Preguntas con IA</h2>
                <p className="mt-0.5 text-[10px] leading-tight text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Genera reactivos a partir de temas y tipos de pregunta que elijas.
                </p>
              </div>
            </div>
            <div className="flex flex-row items-start gap-2 rounded-md border border-orange-100/80 bg-white/85 p-2.5 shadow-sm backdrop-blur-md sm:min-h-[9.5rem] sm:flex-col sm:gap-2.5 sm:rounded-xl sm:p-3.5 md:min-h-[10.25rem] lg:min-h-[10.75rem] lg:p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <QrCode className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-xs font-semibold text-gray-900 sm:text-sm lg:text-base">Acceso por QR</h2>
                <p className="mt-0.5 text-[10px] leading-tight text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Publica el examen y que los alumnos entren desde el móvil. O imprímelo y aplícalo en el
                  aula.
                </p>
              </div>
            </div>
            <div className="flex flex-row items-start gap-2 rounded-md border border-orange-100/80 bg-white/85 p-2.5 shadow-sm backdrop-blur-md sm:min-h-[9.5rem] sm:flex-col sm:gap-2.5 sm:rounded-xl sm:p-3.5 md:min-h-[10.25rem] lg:min-h-[10.75rem] lg:p-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-200/70 text-orange-800 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-xs font-semibold text-gray-900 sm:text-sm lg:text-base">Resultados claros</h2>
                <p className="mt-0.5 text-[10px] leading-tight text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Visualiza el desempeño por examen y por grupo, el mismo día y cuando sea necesario.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-orange-100/80 bg-white/70 px-2 pt-1 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] text-center text-gray-600 backdrop-blur-md sm:px-3 sm:pt-2.5 sm:pb-8 lg:px-10">
        <div className="flex justify-center">
          <BrandWordmark
            href={false}
            className="justify-center"
            imgClassName="mx-auto h-6 w-auto max-w-[min(100%,14rem)] object-contain sm:h-11 sm:max-w-[22rem] lg:h-12 lg:max-w-[24rem]"
          />
        </div>
        <p className="mt-0.5 text-[8px] leading-tight text-gray-600 sm:mt-1 sm:text-xs sm:leading-relaxed">
          Herramienta creada por{' '}
          <Link
            href="https://silvasdev.vercel.app/"
            className="font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            Silvas Dev
          </Link>{' '}
          para la Secretaría de Educación y Cultura en Sonora
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[8px] text-gray-500 sm:mt-1 sm:text-xs">
          <span>Todos los derechos reservados 2026.</span>
          <Copyright className="h-2.5 w-2.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
        </p>
      </footer>
    </div>
  );
}
