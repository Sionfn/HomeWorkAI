// /api/customer-portal.js — HomeWorkAI
// Opens the Stripe billing portal for the authenticated user.
// Requires a valid Firebase ID token — no unauthenticated access.

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify Firebase token — never trust client-provided email alone
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
  const { email: verifiedEmail } = decodedToken;
  if (!verifiedEmail) {
    return res.status(401).json({ error: "Unauthorized — token has no email." });
  }

  // 2. Use the verified email from the token — ignore any email from the request body
  try {
    const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customers = await stripe.customers.list({ email: verifiedEmail, limit: 1 });

    if (customers.data.length === 0) {
      return res.status(404).json({ error: "No subscription found for this account." });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer:   customers.data[0].id,
      return_url: `${baseUrl}?portal=returned`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Portal error:", err.message);
    // Don't leak raw Stripe error messages to the client
    return res.status(500).json({ error: "Could not open billing portal. Please try again." });
  }
}
