import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required." });
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      return res.status(404).json({ error: "No subscription found for this account." });
    }
    const baseUrl = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: `${baseUrl}?portal=returned`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Portal error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
