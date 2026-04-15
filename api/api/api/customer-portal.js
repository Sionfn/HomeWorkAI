// /api/customer-portal.js
// Opens the Stripe Billing Portal for the logged-in user.
// They can cancel, update their card, or view invoices from there.
// No Firebase Admin SDK needed — only your Stripe secret key is required.

import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-11-20.acacia",
    });

    // Find Stripe customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });

    if (customers.data.length === 0) {
      return res.status(404).json({
        error: "No subscription found for this account. Please subscribe first.",
      });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   customers.data[0].id,
      return_url: `${baseUrl}?portal=returned`,
    });

    return res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error("Customer portal error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
