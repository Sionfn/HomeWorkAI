export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, plan, imageBase64, imageType } = req.body;
    if (!question && !imageBase64) {
      return res.status(400).json({ error: "No question provided" });
    }

    const userPlan = plan || "free";

    // ── Plan-based quality tier ───────────────────────────────────────────
    // FREE  → gpt-4o-mini  | basic, short, minimal formatting
    // PRO   → gpt-4.1-mini | clear tutor, better explanations, bold formatting
    // PRO+  → gpt-4.1      | expert professor, deepest explanations, bold + underline, videos
    let planInstructions = "";

    if (userPlan === "pro") {
      planInstructions = `QUALITY LEVEL: Pro (strong tutor)
You are a clear, confident tutor helping a student genuinely understand the material.

FORMATTING — Pro plan supports bold text. Use it selectively:
- Wrap important terms or key values in **double asterisks** to bold them (e.g., **photosynthesis**, **x = 5**).
- Bold only what truly matters — 2-4 highlights per response. Never over-bold.

After the Final Answer, write an Explanation section. Rules:
- 2-3 short paragraphs. Each paragraph is one clear idea. 2-3 sentences each.
- Explain the WHY — not just what happened, but why it works or why it matters.
- Teach clearly, like you're explaining to a smart student who wants to understand.
- For math: after the steps, explain the logic behind the method and bold key results.
- For concepts: explain causes, mechanisms, real-world meaning.
- Add a Tip only if it is genuinely useful. Skip it if not.
- Keep paragraphs short. Never write a wall of text.`;

    } else if (userPlan === "pro_plus") {
      planInstructions = `QUALITY LEVEL: Pro+ (expert professor)
You are a top-tier professor delivering the clearest, deepest, most useful explanation possible.

FORMATTING — Pro+ plan supports bold AND underline. Use both purposefully:
- Wrap important terms in **double asterisks** to bold them (e.g., **Newton's Second Law**).
- Wrap key concepts that the student must remember in __double underscores__ to underline them (e.g., __the derivative measures rate of change__).
- Bold 3-5 highlights and underline 1-2 must-remember concepts per response. Never over-format.

After the Final Answer, write an Explanation section. Rules:
- 2-4 short paragraphs. Each paragraph is one focused idea. 2-3 sentences each.
- Go deeper than surface facts. Explain underlying principles, real-world implications, or important connections.
- For math: explain the full reasoning, then add why the method works at a conceptual level. Bold key numbers and underline the core method name.
- For concepts: break down causes, mechanisms, and significance with specific detail. Underline the single most important idea.
- After Explanation, add "Insight:" ONLY if there is something genuinely valuable — a key nuance, a common mistake, or a deeper connection students miss. One short paragraph. Skip for simple questions.
- Add a Tip only if it is a high-value shortcut or mental model. Skip if nothing valuable to add.
- Keep each paragraph short and sharp. Never write walls of text. Quality over quantity.`;

    } else {
      // FREE tier — basic, concise, no special formatting
      planInstructions = `QUALITY LEVEL: Free (basic helper)
After the Final Answer:
- Write 1-2 short sentences that explain the core idea simply.
- For math: show the key steps only.
- For concepts: one simple explanation sentence, then optionally one example.
- Do NOT add Tip, Insight, Key Points, or extra sections.
- Do NOT use bold (**) or underline (__) formatting.
- Be helpful but concise.`;
    }

    // ── YouTube titles (Pro+ ONLY) ────────────────────────────────────────
    // Videos are an exclusive Pro+ feature. Only suggest videos when the topic
    // genuinely benefits from visual/video learning (e.g. complex math, science
    // experiments, historical events). Skip for simple or one-line questions.
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nPro+ exclusive: If the topic genuinely warrants a video (complex concept, visual process, or deep subject), add a "Videos:" section at the very end with 1-2 relevant YouTube video titles. Format:\nTitle: [descriptive title]\nTitles only — no URLs. Skip entirely for simple or short questions. Quality over quantity.`
      : "";  // Free and Pro plans do NOT get videos

    // ── Core system prompt ────────────────────────────────────────────────
    const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic → calculus, stats) | Science (biology, chemistry, physics) | History | English & writing | Economics | Law | Psychology | Computer science | Any academic topic

${planInstructions}

RESPONSE FORMAT — adapt naturally to the question. Do NOT force sections. Only include a section if it genuinely helps.

ALWAYS start with:
Final Answer: [One direct sentence. The answer only — no explanation here.]

THEN, choose only what the question actually needs:
- Simple/short question → Final Answer only, or Final Answer + 1-2 sentences. No extra sections.
- Math or multi-step problem → Final Answer + Step-by-step (only as many steps as genuinely needed). Add a brief Explanation only if the method needs clarifying.
- Conceptual question → Final Answer + Explanation (short paragraphs, one idea each, teach the WHY).
- Complex or multi-part question → Final Answer + whatever combination of steps, explanation, or key points best serves it.
- Summary or list request → Final Answer + bullet Key Points if that's the clearest format.

OPTIONAL SECTIONS — only add when they add real value:
Step-by-step: (math/calculations only — show real operations with actual numbers)
Explanation: (short paragraphs — one idea each, 2-3 sentences max)
Key Points: (3-5 bullets max — one specific fact per line)
Tip: (one sentence — a real shortcut or memory trick. Skip if nothing genuinely useful.)
Insight: (one short paragraph — a deeper nuance. Pro+ only, skip for simple questions.)

STRICT RULES:
1. NEVER force Explanation, Step-by-step, or Key Points into every response. Match the format to the question.
2. NEVER write one long paragraph. Every paragraph = one idea, 2-3 sentences max.
3. Steps must show REAL work — never vague:
   BAD: "Set up the equation" | GOOD: "Subtract 5 from both sides: 2x + 5 - 5 = 15 - 5, so 2x = 10"
   BAD: "Think about the context" | GOOD: "Franz Ferdinand's assassination on June 28, 1914 triggered alliance obligations, pulling 8 countries into war within 6 weeks"
4. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand
5. Scale length to complexity — simple = shorter, complex = more thorough. Never pad.
6. Subject rules:
   - Math: every arithmetic operation shown with actual numbers
   - Science: explain the mechanism — what physically or chemically happens and why
   - History: specific dates, names, causes, and effects
   - English: name the technique and explain its effect with textual evidence
   - Economics: connect the concept to real human incentives and behavior
   - Law/Psychology: state the principle then give a concrete real-world example
7. FORMATTING: Free tier — plain text ONLY, no bold, no underline. Pro tier — bold (**word**) allowed for key terms. Pro+ tier — bold (**word**) AND underline (__phrase__) allowed for key terms. No LaTeX, no markdown symbols like ##, no $ for math.
8. Non-academic question: reply only "I'm here to help with homework and studying. Try asking me a subject question!"
9. Write like a confident, intelligent tutor — not a chatbot, not an essay.${youtubeInstruction}`;

    // ── Build input ───────────────────────────────────────────────────────
    // Images are OCR'd on the frontend before this point — input is always text
    const inputContent = `Question: ${question}`;

    // ── Model selection by plan ───────────────────────────────────────────
    // FREE    → gpt-4o-mini  (basic, fast)
    // PRO     → gpt-4.1-mini (better quality, clear tutor)
    // PRO+    → gpt-4.1      (best quality, expert professor)
    let model;
    if (userPlan === "pro_plus") {
      model = "gpt-4.1";
    } else if (userPlan === "pro") {
      model = "gpt-4.1-mini";
    } else {
      model = "gpt-4o-mini";
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        instructions: systemPrompt,
        input: inputContent
      })
    });

    const data = await response.json();
    console.log("OPENAI RESPONSE:", data);

    // ── Safe parse ────────────────────────────────────────────────────────
    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray && contentArray.length > 0) {
        rawAnswer = contentArray.map(c => c.text || "").join("");
      }
    } catch (e) { console.log("Parse error:", data); }

    // ── Strip LaTeX / markdown ────────────────────────────────────────────
    // Always strip LaTeX and heading markers.
    // For Pro/Pro+, preserve ** (bold) and __ (underline) — the frontend renders them.
    // For Free, strip all formatting markers.
    let answer = rawAnswer
      .replace(/\\\[[\s\S]*?\\\]/g, "")
      .replace(/\\\([\s\S]*?\\\)/g, "")
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/^#{1,6}\s/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // For Free users only: strip bold and italic markers too
    if (userPlan === "free") {
      answer = answer
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/__(.*?)__/g, "$1");
    } else {
      // For Pro/Pro+: only strip lone single asterisks (italic), keep ** and __
      answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    }

    // ── Extract videos (Pro+ only) — always YouTube search URLs ──────────
    let videos = [];
    if (userPlan === "pro_plus") {
      const videoBlockMatch = answer.match(/Videos:([\s\S]*?)(?=\n\n|$)/);
      if (videoBlockMatch) {
        const block = videoBlockMatch[1];
        const titleMatches = [...block.matchAll(/Title:\s*(.+)/gi)];
        for (const m of titleMatches) {
          const title = m[1].trim();
          if (title.length > 3) {
            videos.push({
              title,
              link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(title)
            });
          }
        }
        if (videos.length === 0) {
          const lines = block.split("\n")
            .map(l => l.replace(/^[-*]\s*/, "").replace(/^Title:\s*/i, "").trim())
            .filter(l => l.length > 3 && !l.startsWith("Link:") && !l.startsWith("http"));
          for (const l of lines) {
            videos.push({ title: l, link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(l) });
          }
        }
        answer = answer.replace(/Videos:[\s\S]*?(?=\n\n|$)/, "").trim();
      }
    }

    return res.status(200).json({ answer, videos });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// /api/create-checkout-session.js
// Creates a Stripe Checkout Session with 3-day free trial.
// Called from the frontend when a user clicks "Start Free Trial" or "Unlock Pro+".
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PRO_MONTHLY  STRIPE_PRICE_PRO_YEARLY
//   STRIPE_PRICE_PRO_PLUS_MONTHLY  STRIPE_PRICE_PRO_PLUS_YEARLY
//   FIREBASE_PROJECT_ID  FIREBASE_CLIENT_EMAIL  FIREBASE_PRIVATE_KEY

import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ── Firebase Admin (singleton) ───────────────────────────────────────────────
function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel / Railway store the key as a single-line string with literal \n
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// ── Price map ────────────────────────────────────────────────────────────────
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

  // ── 1. Parse body ──────────────────────────────────────────────────────────
  const { plan, billing = "monthly" } = req.body;
  if (!plan || !["pro", "pro_plus"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Must be 'pro' or 'pro_plus'." });
  }
  if (!["monthly", "yearly"].includes(billing)) {
    return res.status(400).json({ error: "Invalid billing. Must be 'monthly' or 'yearly'." });
  }

  // ── 2. Verify Firebase ID token ─────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: "Missing Firebase ID token." });
  }

  let decodedToken;
  try {
    const adminApp = getAdminApp();
    decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const { uid, email, name } = decodedToken;

  // ── 3. Look up or create Stripe customer ────────────────────────────────
  const adminApp = getAdminApp();
  const db = getFirestore(adminApp);
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

  let stripeCustomerId = userData.stripeCustomerId;
  if (!stripeCustomerId) {
    // Create a new customer in Stripe
    const customer = await stripe.customers.create({
      email,
      name:     name || undefined,
      metadata: { firebaseUid: uid },
    });
    stripeCustomerId = customer.id;
    // Persist it immediately so we can reference it in the webhook
    await userRef.set({ stripeCustomerId }, { merge: true });
  }

  // ── 4. Resolve price ID ──────────────────────────────────────────────────
  const priceId = PRICES[plan][billing];
  if (!priceId) {
    return res.status(500).json({
      error: `No price ID configured for ${plan} / ${billing}. ` +
             `Check STRIPE_PRICE_${plan.toUpperCase()}_${billing.toUpperCase()} in your .env file.`,
    });
  }

  // ── 5. Create Checkout Session ───────────────────────────────────────────
  const baseUrl = req.headers.origin || `https://${req.headers.host}`;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],

    // 3-day free trial — card is required but not charged during trial
    subscription_data: {
      trial_period_days: 3,
      metadata: {
        firebaseUid: uid,
        plan,
        billing,
      },
    },

    // Pre-fill email
    customer_email: stripeCustomerId ? undefined : email,

    // Redirect URLs — success passes the session ID back so you can verify
    success_url: `${baseUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${baseUrl}?payment=cancelled`,

    // Metadata on the session itself (for webhook)
    metadata: {
      firebaseUid: uid,
      plan,
      billing,
    },

    // Allow promotion codes if you ever create them in Stripe
    allow_promotion_codes: true,
  });

  return res.status(200).json({ url: session.url });
}

// /api/webhook.js
// Receives Stripe webhook events and keeps Firestore user plans in sync.
//
// IMPORTANT: In Next.js you must disable body parsing for this route
// so Stripe can verify the raw request body signature.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET  (get this from Stripe Dashboard → Webhooks → your endpoint → Signing secret)
//   FIREBASE_PROJECT_ID  FIREBASE_CLIENT_EMAIL  FIREBASE_PRIVATE_KEY
//
// Stripe events you must enable in the dashboard for this endpoint:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed

import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore }                  from "firebase-admin/firestore";

// ── Disable Next.js body parser — Stripe needs the raw body ─────────────────
export const config = { api: { bodyParser: false } };

// ── Firebase Admin (singleton) ───────────────────────────────────────────────
function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// ── Helper: read raw body as buffer ─────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Plan mapper: Stripe price ID → internal plan key ────────────────────────
// We store the plan name in subscription metadata so we don't need to reverse-
// look up price IDs — which is cleaner and avoids env-var coupling in the webhook.
function planFromMetadata(metadata = {}) {
  const raw = (metadata.plan || "").toLowerCase();
  if (raw === "pro_plus" || raw === "pro+") return "pro_plus";
  if (raw === "pro")                         return "pro";
  return null;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  // 1. Read raw body and verify Stripe signature
  const rawBody = await getRawBody(req);
  const sig     = req.headers["stripe-signature"];

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const db = getFirestore(getAdminApp());
  console.log(`Stripe event received: ${event.type}`);

  // ── 2. Handle events ─────────────────────────────────────────────────────
  try {
    switch (event.type) {

      // ── Checkout completed (trial or paid) ────────────────────────────────
      case "checkout.session.completed": {
        const session    = event.data.object;
        const firebaseUid = session.metadata?.firebaseUid;
        const plan        = planFromMetadata(session.metadata);
        const customerId  = session.customer;

        if (!firebaseUid || !plan) {
          console.warn("checkout.session.completed: missing firebaseUid or plan in metadata", session.id);
          break;
        }

        await db.collection("users").doc(firebaseUid).set({
          plan,
          stripeCustomerId:  customerId,
          subscriptionId:    session.subscription,
          subscriptionStatus: "active",   // in trial or active after checkout
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        console.log(`✅ Plan set to '${plan}' for uid ${firebaseUid}`);
        break;
      }

      // ── Subscription updated (renewal, cancel-at-period-end, trial end) ───
      case "customer.subscription.updated": {
        const sub        = event.data.object;
        const customerId = sub.customer;

        // Resolve firebaseUid from Firestore via stripeCustomerId
        const userSnap = await db.collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (userSnap.empty) {
          console.warn("subscription.updated: no user found for customer", customerId);
          break;
        }

        const userDoc  = userSnap.docs[0];
        const uid      = userDoc.id;
        const metadata = sub.metadata || {};
        const plan     = planFromMetadata(metadata);
        const status   = sub.status; // active, trialing, past_due, canceled, unpaid

        const isActive = ["active", "trialing"].includes(status);
        const newPlan  = isActive && plan ? plan : "free";

        await db.collection("users").doc(uid).set({
          plan:               newPlan,
          subscriptionId:     sub.id,
          subscriptionStatus: status,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        console.log(`🔄 uid ${uid} → plan '${newPlan}' (status: ${status})`);
        break;
      }

      // ── Subscription deleted (cancelled immediately or at period end) ─────
      case "customer.subscription.deleted": {
        const sub        = event.data.object;
        const customerId = sub.customer;

        const userSnap = await db.collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (userSnap.empty) {
          console.warn("subscription.deleted: no user found for customer", customerId);
          break;
        }

        const uid = userSnap.docs[0].id;
        await db.collection("users").doc(uid).set({
          plan:               "free",
          subscriptionId:     null,
          subscriptionStatus: "canceled",
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        console.log(`❌ Subscription cancelled for uid ${uid} — downgraded to free`);
        break;
      }

      // ── Payment failed (trial ended, card declined) ───────────────────────
      case "invoice.payment_failed": {
        const invoice    = event.data.object;
        const customerId = invoice.customer;

        const userSnap = await db.collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (!userSnap.empty) {
          const uid = userSnap.docs[0].id;
          await db.collection("users").doc(uid).set({
            subscriptionStatus: "past_due",
            updatedAt: new Date().toISOString(),
          }, { merge: true });
          console.log(`⚠️  Payment failed for uid ${uid}`);
        }
        break;
      }

      default:
        // Silently ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error("Error processing webhook event:", err);
    // Still return 200 so Stripe doesn't keep retrying for server-side bugs
    return res.status(200).json({ received: true, error: err.message });
  }

  return res.status(200).json({ received: true });
}

// /api/customer-portal.js
// Creates a Stripe Billing Portal session so users can manage/cancel their subscription.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   FIREBASE_PROJECT_ID  FIREBASE_CLIENT_EMAIL  FIREBASE_PRIVATE_KEY
//
// One-time Stripe setup:
//   → Dashboard → Billing → Customer portal → Activate
//     (Enable "Cancel subscriptions" and "Update payment method" at minimum)

import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth }      from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ── Firebase Admin (singleton) ───────────────────────────────────────────────
function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Verify Firebase ID token ──────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const idToken    = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: "Missing Firebase ID token." });
  }

  let decodedToken;
  try {
    const adminApp = getAdminApp();
    decodedToken   = await getAuth(adminApp).verifyIdToken(idToken);
  } catch (e) {
    console.error("Token verification failed:", e.message);
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  const { uid } = decodedToken;

  // ── 2. Look up stripeCustomerId from Firestore ───────────────────────────
  const adminApp = getAdminApp();
  const db       = getFirestore(adminApp);
  const userSnap = await db.collection("users").doc(uid).get();

  if (!userSnap.exists) {
    return res.status(404).json({ error: "User not found in database." });
  }

  const { stripeCustomerId } = userSnap.data();
  if (!stripeCustomerId) {
    return res.status(400).json({
      error: "No Stripe customer ID on file. " +
             "You may not have completed a checkout session yet.",
    });
  }

  // ── 3. Create Stripe Billing Portal session ──────────────────────────────
  const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
  const baseUrl  = req.headers.origin || `https://${req.headers.host}`;

  const portalSession = await stripe.billingPortal.sessions.create({
    customer:   stripeCustomerId,
    return_url: `${baseUrl}?portal=returned`,
  });

  return res.status(200).json({ url: portalSession.url });
}
