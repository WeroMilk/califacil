import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing';

function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error('Falta STRIPE_WEBHOOK_SECRET');
  }
  return secret;
}

async function upsertBillingFromSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;

  const isActive = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status);
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const periodEnd = itemPeriodEnd ? new Date(itemPeriodEnd * 1000).toISOString() : null;

  await supabaseAdmin.from('teacher_billing').upsert(
    {
      user_id: userId,
      stripe_customer_id: String(subscription.customer),
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      plan_key: subscription.metadata?.plan_key || null,
      current_period_end: periodEnd,
      is_active: isActive,
    },
    { onConflict: 'user_id' }
  );
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Firma faltante' }, { status: 400 });
    }

    const rawBody = await request.text();
    const event = stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.subscription;
      if (typeof subscriptionId === 'string') {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertBillingFromSubscription(subscription);
      }
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      await upsertBillingFromSubscription(subscription);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('stripe webhook error', error);
    return NextResponse.json({ error: 'Webhook invalido' }, { status: 400 });
  }
}
