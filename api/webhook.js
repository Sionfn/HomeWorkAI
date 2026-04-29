// ============================================================
// /api/stripe-webhook.js  —  HomeWorkAI
// ============================================================
// Listens for Stripe events and keeps Firestore in sync.
//
// REQUIRED ENV VARS (set in Vercel / your hosting dashboard):
//   STRIPE_SECRET_KEY        — sk_live_...  (your Stripe secret key)
//   STRIPE_WEBHOOK_SECRET    — whsec_...    (from Stripe Dashboard → Webhooks)
//   FIREBASE_PROJECT_ID      — from Firebase console
//   FIREBASE_CLIENT_EMAIL    — from Firebase service account JSON
//   FIREBASE_PRIVATE_KEY     — from Firebase service account JSON
//
// HOW TO SET UP IN STRIPE DASHBOARD:
//   1. Go to https://dashboard.stripe.com/webhooks
//   2. Click "Add endpoint"
//   3. URL: https://yourdomain.com/api/stripe-webhook
//   4. Select these events:
//        checkout.session.completed
//        customer.subscription.updated
//        customer.subscription.deleted
//   5. Copy the "Signing secret" → paste as STRIPE_WEBHOOK_SECRET
// ============================================================

import Stripe from "stripe";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ── Init Firebase Admin (safe to call multiple times) ─────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db     = getFirestore();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

// ── Map Stripe Price IDs to plan names ────────────────────────────────────
// Replace these with your actual Stripe Price IDs from the dashboard.
// Go to: Stripe Dashboard → Products → click your product → copy Price ID
// ── Plan mapping — add your Stripe Price IDs as env vars in Vercel ──────────
// Super Knox ($9.99/mo, $79.99/yr) | Max Knox ($19.99/mo, $149.99/yr)
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_SUPER_MONTHLY]: "super",
  [process.env.STRIPE_PRICE_SUPER_YEARLY]:  "super",
  [process.env.STRIPE_PRICE_MAX_MONTHLY]:   "max",
  [process.env.STRIPE_PRICE_MAX_YEARLY]:    "max",
};

// ── Disable Vercel's default body parser (Stripe needs raw body) ──────────
export const config = { api: { bodyParser: false } };

// ── Read raw body for signature verification ──────────────────────────────
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  // 1. Verify the request is genuinely from Stripe
  const sig     = req.headers["stripe-signature"];
  const rawBody = await getRawBody(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. Handle each event type
  try {
    switch (event.type) {

      // ── Checkout completed → subscription just started or upgraded ───────
      case "checkout.session.completed": {
        const session = event.data.object;

        // Only handle subscription checkouts (not one-off payments)
        if (session.mode !== "subscription") break;

        const customerId     = session.customer;           // Stripe customer ID
        const subscriptionId = session.subscription;       // Stripe subscription ID
        const uid            = session.metadata?.uid;      // Firebase UID (passed from create-checkout-session)
        const email          = session.customer_email || session.customer_details?.email;

        if (!uid) {
          console.error("checkout.session.completed: no uid in metadata. Make sure you pass uid in your create-checkout-session call.");
          break;
        }

        // Fetch full subscription to get price ID and period end
        const subscription   = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId        = subscription.items.data[0]?.price?.id;
        const plan           = PRICE_TO_PLAN[priceId] || "super";
        const renewalDate    = subscription.current_period_end; // Unix timestamp (seconds)

        await db.collection("users").doc(uid).set({
          plan,
          renewalDate,        // ← this is what shows in Account & Plan settings
          stripeCustomerId:  customerId,
          stripeSubId:       subscriptionId,
          email,
          updatedAt:         new Date().toISOString(),
        }, { merge: true });

        console.log(`✅ checkout.session.completed: uid=${uid} plan=${plan} renewalDate=${renewalDate}`);
        break;
      }

      // ── Subscription updated → renewal, upgrade, or plan change ─────────
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId   = subscription.customer;
        const priceId      = subscription.items.data[0]?.price?.id;
        const plan         = PRICE_TO_PLAN[priceId] || "super";
        const renewalDate  = subscription.current_period_end;
        const status       = subscription.status; // active, trialing, past_due, canceled

        // Find the user by their Stripe customer ID
        const snapshot = await db
          .collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          console.warn(`customer.subscription.updated: no user found for customerId=${customerId}`);
          break;
        }

        const userDoc = snapshot.docs[0];
        const updateData = {
          renewalDate,
          stripeSubId:  subscription.id,
          updatedAt:    new Date().toISOString(),
        };

        // Only update plan if subscription is active or trialing
        if (status === "active" || status === "trialing") {
          updateData.plan = plan;
        }

        await userDoc.ref.set(updateData, { merge: true });
        console.log(`✅ customer.subscription.updated: uid=${userDoc.id} plan=${plan} status=${status} renewalDate=${renewalDate}`);
        break;
      }

      // ── Subscription deleted → downgrade to free ─────────────────────────
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId   = subscription.customer;

        const snapshot = await db
          .collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          console.warn(`customer.subscription.deleted: no user found for customerId=${customerId}`);
          break;
        }

        const userDoc = snapshot.docs[0];
        await userDoc.ref.set({
          plan:         "free",
          renewalDate:  null,
          stripeSubId:  null,
          updatedAt:    new Date().toISOString(),
        }, { merge: true });

        console.log(`✅ customer.subscription.deleted: uid=${userDoc.id} → downgraded to free`);
        break;
      }

      default:
        // Ignore all other event types
        break;
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler failed." });
  }
}
