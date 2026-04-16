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
  if (!plan || !["pro", "pro_plus"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan." });
  }

  const priceId = PRICES[plan]?.[billing];
  if (!priceId) {
    return res.status(500).json({ error: `Price ID not configured for ${plan}/${billing}.` });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

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

    // Only Pro Monthly gets the 3-day free trial
    const isTrialEligible = (plan === "pro" && billing === "monthly");

    const sessionData = {
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          firebaseUid: uid || "",
          plan,
          billing,
        },
      },
      success_url: `${baseUrl}?payment=success`,
      cancel_url:  `${baseUrl}?payment=cancelled`,
      allow_promotion_codes: true,
    };

    // Add trial only for Pro Monthly
    if (isTrialEligible) {
      sessionData.subscription_data.trial_period_days = 3;
    }

    const session = await stripe.checkout.sessions.create(sessionData);

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
