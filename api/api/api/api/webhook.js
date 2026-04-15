// /api/webhook.js
// Receives Stripe webhook events. Since we read plan state directly from Stripe
// via /api/get-user-plan, this webhook is mainly for logging and catching
// edge cases like payment failures.
//
// IMPORTANT: Body parsing MUST be disabled for Stripe signature verification to work.
//
// Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import Stripe from "stripe";

// Tell Next.js not to parse the body — Stripe needs the raw bytes to verify the signature
export const config = {
  api: { bodyParser: false },
};

// Read the raw request body as a buffer
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const rawBody = await getRawBody(req);
  const sig     = req.headers["stripe-signature"];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
  });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Log every event so you can see them in Vercel logs
  console.log(`Stripe event: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed":
      console.log("Checkout completed:", event.data.object.id,
        "| plan:", event.data.object.metadata?.plan,
        "| email:", event.data.object.customer_details?.email);
      break;

    case "customer.subscription.updated":
      console.log("Subscription updated:", event.data.object.id,
        "| status:", event.data.object.status);
      break;

    case "customer.subscription.deleted":
      console.log("Subscription cancelled:", event.data.object.id);
      break;

    case "invoice.payment_failed":
      console.log("Payment failed for customer:", event.data.object.customer);
      break;

    default:
      break;
  }

  return res.status(200).json({ received: true });
}
