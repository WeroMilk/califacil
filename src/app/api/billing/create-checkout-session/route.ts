import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { BILLING_PLANS } from '@/lib/billing';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const body = (await request.json()) as { planKey?: string };
    const plan = BILLING_PLANS.find((item) => item.key === body.planKey);

    if (!plan) {
      return NextResponse.json({ error: 'Plan invalido' }, { status: 400 });
    }

    const priceId = process.env[plan.stripePriceEnv]?.trim();
    if (!priceId) {
      return NextResponse.json(
        { error: `Falta configurar ${plan.stripePriceEnv}` },
        { status: 500 }
      );
    }

    const { data: currentBilling } = await supabaseAdmin
      .from('teacher_billing')
      .select('stripe_customer_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const customerEmail = request.headers.get('x-user-email') || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: currentBilling?.stripe_customer_id ?? undefined,
      customer_email: currentBilling?.stripe_customer_id ? undefined : customerEmail,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${request.nextUrl.origin}/billing?status=success`,
      cancel_url: `${request.nextUrl.origin}/billing?status=cancel`,
      metadata: {
        user_id: auth.user.id,
        plan_key: plan.key,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('billing/create-checkout-session error', error);
    return NextResponse.json({ error: 'No se pudo crear la sesion de pago' }, { status: 500 });
  }
}
