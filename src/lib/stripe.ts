import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();

if (!stripeSecretKey) {
  throw new Error('Falta STRIPE_SECRET_KEY');
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-03-31.basil',
  typescript: true,
});
