// /api/create-checkout-session.js — HomeWorkAI
// Creates a Stripe checkout session for the authenticated user.
// Requires a valid Firebase ID token — uid comes from the verified token,
// never from the request body, so it cannot be spoofed.

import Stripe from "stripe";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth }       from "firebase-admin/auth";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const adminAuth = getAdminAuth();

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify Firebase token — uid and email come from here, not the request body
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized — invalid or expired token." });
  }
  const { uid: verifiedUid, email: verifiedEmail } = decodedToken;
  if (!verifiedEmail || !verifiedUid) {
    return res.status(401).json({ error: "Unauthorized — token missing uid or email." });
  }

  // 2. Validate plan and billing from request body
  const { plan, billing = "monthly" } = req.body;
  const priceId = PRICES[plan]?.[billing];
  if (!priceId) {
    return res.status(400).json({ error: "Invalid plan or billing period." });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Find or create Stripe customer
    const existingList = await stripe.customers.list({ email: verifiedEmail, limit: 1 });
    let customer;
    if (existingList.data.length > 0) {
      customer = existingList.data[0];
    } else {
      customer = await stripe.customers.create({ email: verifiedEmail });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;

    // 3-day trial only on Pro monthly
    let subscriptionData = { metadata: { plan, billing } };
    if (plan === "pro" && billing === "monthly") {
      subscriptionData.trial_period_days = 3;
    }

    const session = await stripe.checkout.sessions.create({
      mode:              "subscription",
      customer:          customer.id,
      line_items:        [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      success_url:       `${baseUrl}?payment=success`,
      cancel_url:        `${baseUrl}?payment=cancelled`,
      allow_promotion_codes: true,
      // uid and email come from the verified token — cannot be spoofed
      metadata: { uid: verifiedUid, email: verifiedEmail },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    // Don't leak raw Stripe error messages to the client
    return res.status(500).json({ error: "Could not open checkout. Please try again." });
  }
}
