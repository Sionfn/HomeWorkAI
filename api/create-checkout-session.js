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

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const priceId = PRICES[plan]?.[billing];
  if (!priceId) {
    return res.status(500).json({ error: "Price ID not configured." });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const existingList = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existingList.data.length > 0) {
      customer = existingList.data[0];
    } else {
      customer = await stripe.customers.create({ email });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;

    const subscriptionData = {
      metadata: { plan, billing, firebaseUid: uid || "" },
    };

    if (plan === "pro" && billing === "monthly") {
      subscriptionData.trial_period_days = 3;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      success_url: `${baseUrl}?payment=success`,
      cancel_url: `${baseUrl}?payment=cancelled`,
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
