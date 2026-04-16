// /api/create-checkout-session.js
// Creates a Stripe Checkout session with a 3-day free trial.
// No Firebase Admin SDK needed — only your Stripe keys are required.

import Stripe from "stripe";

const PRICES = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_PRO_YEARLY,
  },
  pro_plus: {
    monthly: process.env.STRIPE_PRICE_PRO_PLUS_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_PRO_PLUS_YEARLY,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, billing = "monthly", email, uid } = req.body;

  // Basic validation
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }
  if (!plan || !["pro", "pro_plus"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Must be 'pro' or 'pro_plus'." });
  }

  const priceId = PRICES[plan]?.[billing];
  if (!priceId) {
    return res.status(500).json({
      error: `Price ID not configured for ${plan}/${billing}. ` +
             `Add STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()} to your Vercel environment variables.`,
    });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    // Find existing customer by email, or create a new one
    const existingList = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existingList.data.length > 0) {
      customer = existingList.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        metadata: { firebaseUid: uid || "" },
      });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,

      line_items: [{ price: priceId, quantity: 1 }],

      // 3-day free trial — card is required but NOT charged during trial
     subscription_data: {
  trial_period_days: (plan === 'pro' && billing === 'monthly') ? 3 : undefined,
  metadata: {
    firebaseUid: uid || "",
    plan,
    billing,
  },
},
      // Redirect after checkout
      success_url: `${baseUrl}?payment=success`,
      cancel_url:  `${baseUrl}?payment=cancelled`,

      // Allow promo codes if you create them in Stripe later
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
