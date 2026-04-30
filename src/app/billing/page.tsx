'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { BILLING_PLANS, isSubscriptionActive, type PlanKey } from '@/lib/billing';
import { Button } from '@/components/ui/button';
import { toSpanishAuthMessage } from '@/lib/authErrors';

type BillingRow = {
  user_id: string;
  is_active: boolean;
  subscription_status: string | null;
};

export default function BillingPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [checking, setChecking] = useState(true);
  const [processingPlan, setProcessingPlan] = useState<PlanKey | null>(null);

  const isPaid = useMemo(() => isSubscriptionActive(billing), [billing]);

  const loadBilling = useCallback(async () => {
    if (!user) return;
    setChecking(true);
    const { data, error } = await supabase
      .from('teacher_billing')
      .select('user_id,is_active,subscription_status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      toast.error('No se pudo validar tu suscripcion', {
        description: toSpanishAuthMessage(error.message),
      });
    } else {
      setBilling(data as BillingRow | null);
    }
    setChecking(false);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
      return;
    }
    if (user) {
      void loadBilling();
    }
  }, [loading, user, router, loadBilling]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status');
    if (status === 'success') {
      toast.success('Pago confirmado. Validando acceso...');
      void loadBilling();
    }
    if (status === 'cancel') {
      toast.message('El pago se cancelo. Puedes intentarlo de nuevo.');
    }
  }, [loadBilling]);

  useEffect(() => {
    if (isPaid) {
      router.replace('/dashboard');
    }
  }, [isPaid, router]);

  const handleCheckout = async (planKey: PlanKey) => {
    if (!user) return;
    setProcessingPlan(planKey);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const response = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          ...(user.email ? { 'x-user-email': user.email } : {}),
        },
        body: JSON.stringify({ planKey }),
      });

      const payload = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'No se pudo iniciar checkout');
      }

      window.location.href = payload.url;
    } catch (error) {
      toast.error('No se pudo iniciar el pago', {
        description:
          error instanceof Error ? toSpanishAuthMessage(error.message) : 'Intentalo de nuevo',
      });
    } finally {
      setProcessingPlan(null);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await signOut();
      if (error) {
        throw error;
      }
      router.replace('/login');
    } catch {
      toast.error('No se pudo cerrar sesion');
    }
  };

  if (loading || checking) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="app-scroll h-full overflow-y-auto px-4 py-6 sm:py-8 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Precios por Servicio
          </h1>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-orange-200 text-gray-700 hover:bg-orange-50"
            onClick={() => void handleSignOut()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Salir
          </Button>
        </div>
        <p className="mb-6 text-sm text-gray-600 sm:mb-8">
          Elige tu plan para activar tu cuenta y acceder al dashboard.
        </p>
        <h2 className="sr-only">
          Precios por Servicio
        </h2>
        <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-4">
          {BILLING_PLANS.map((plan) => (
            <article
              key={plan.key}
              className={
                plan.key === 'pro'
                  ? 'rounded-3xl bg-orange-500 p-6 text-white shadow-xl'
                  : 'rounded-3xl bg-white p-6 text-gray-900 shadow-lg'
              }
            >
              <p className="text-2xl font-semibold">{plan.label}</p>
              <p className="mt-2 text-5xl font-black">{plan.priceLabel}</p>
              <p className={plan.key === 'pro' ? 'text-orange-100' : 'text-gray-600'}>{plan.subtitle}</p>
              <div className={plan.key === 'pro' ? 'my-5 border-b border-orange-200' : 'my-5 border-b'} />
              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2
                      className={
                        plan.key === 'pro'
                          ? 'mt-0.5 h-5 w-5 shrink-0 text-orange-100'
                          : 'mt-0.5 h-5 w-5 shrink-0 text-orange-500'
                      }
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                className={
                  plan.key === 'pro'
                    ? 'mt-6 h-11 w-full bg-white text-orange-600 hover:bg-orange-50'
                    : 'mt-6 h-11 w-full bg-orange-600 text-white hover:bg-orange-700'
                }
                disabled={processingPlan !== null}
                onClick={() => void handleCheckout(plan.key)}
              >
                {processingPlan === plan.key ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirigiendo...
                  </>
                ) : (
                  'Elegir plan'
                )}
              </Button>
            </article>
          ))}

          <article className="rounded-3xl bg-white p-6 text-gray-900 shadow-lg">
            <p className="text-2xl font-semibold">Escuelas</p>
            <p className="mt-2 text-4xl font-black">CONTACTANOS</p>
            <p className="text-gray-600">Secundaria, Preparatoria y Universidad.</p>
            <div className="my-5 border-b" />
            <ul className="space-y-3">
              {[
                'Maestros ilimitados',
                'Grupos ilimitados',
                'Alumnos ilimitados',
                'Examenes ilimitados',
                'Nube ilimitada',
                'Soporte 24/7',
                'Plataforma 100% personalizada',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-6 h-11 w-full" asChild>
              <a
                href="https://wa.me/526623501632?text=Hola%2C%20quiero%20solicitar%20una%20demo%20de%20CaliFacil."
                target="_blank"
                rel="noreferrer"
              >
                Solicitar demo
              </a>
            </Button>
          </article>
        </div>
      </div>
    </div>
  );
}
