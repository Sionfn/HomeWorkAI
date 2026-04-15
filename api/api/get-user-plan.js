// /api/get-user-plan.js
// Reads the user's active Stripe subscription by their email address.
// Returns their plan: "free", "pro", or "pro_plus"
// No Firebase Admin SDK needed — only your Stripe secret key is required.

import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(200).json({ plan: "free" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    // Look up customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });

    if (customers.data.length === 0) {
      // No Stripe customer yet — they're on the free plan
      return res.status(200).json({ plan: "free" });
    }

    const customerId = customers.data[0].id;

    // Find their active or trialing subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });

    // Pick the first active or trialing subscription
    const active = subscriptions.data.find((s) =>
      ["active", "trialing"].includes(s.status)
    );

    if (!active) {
      // Customer exists in Stripe but no active subscription
      return res.status(200).json({ plan: "free" });
    }

    // Read plan from subscription metadata (set when checkout session was created)
    const plan = active.metadata?.plan;
    if (plan === "pro_plus") return res.status(200).json({ plan: "pro_plus", status: active.status });
    if (plan === "pro")      return res.status(200).json({ plan: "pro",      status: active.status });

    // Fallback: if metadata is missing, default to pro
    return res.status(200).json({ plan: "pro", status: active.status });

  } catch (err) {
    console.error("get-user-plan error:", err.message);
    // On any error, default to free so the site still works
    return res.status(200).json({ plan: "free" });
  }
}
