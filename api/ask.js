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

// =============================================================
// FILE: /api/create-checkout-session.js
// PURPOSE: Creates a Stripe Checkout session with 3-day trial.
// Called by the frontend when user clicks "Start Free Trial" or
// "Unlock Pro+".
// =============================================================

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ------------------------------------------------------------------
// PRICE IDs — after creating products in Stripe Dashboard, copy each
// price ID into your .env file.
//
//   Pro     $9.99/mo   → STRIPE_PRO_MONTHLY_PRICE_ID=price_xxx
//   Pro     $79.99/yr  → STRIPE_PRO_YEARLY_PRICE_ID=price_xxx
//   Pro+    $14.99/mo  → STRIPE_PRO_PLUS_MONTHLY_PRICE_ID=price_xxx
//   Pro+    $119.99/yr → STRIPE_PRO_PLUS_YEARLY_PRICE_ID=price_xxx
// ------------------------------------------------------------------
const PRICES = {
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    yearly:  process.env.STRIPE_PRO_YEARLY_PRICE_ID,
  },
  pro_plus: {
    monthly: process.env.STRIPE_PRO_PLUS_MONTHLY_PRICE_ID,
    yearly:  process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { plan, userId, email, billing = "monthly" } = req.body;

  if (!plan || !userId || !email) {
    return res.status(400).json({ error: "Missing: plan, userId, or email" });
  }

  // Normalise:  "Pro" → "pro"  |  "Pro+" → "pro_plus"
  const planKey    = plan === "Pro+" ? "pro_plus" : "pro";
  const billingKey = billing === "yearly" ? "yearly" : "monthly";
  const priceId    = PRICES[planKey][billingKey];

  if (!priceId) {
    return res.status(500).json({
      error: `Price ID not configured for ${planKey}/${billingKey}. Check .env.`,
    });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                  "subscription",
      payment_method_types:  ["card"],
      customer_email:        email,
      client_reference_id:   userId,   // Firebase UID — webhook uses this

      line_items: [{ price: priceId, quantity: 1 }],

      subscription_data: {
        trial_period_days: 3,
        metadata: { userId, plan: planKey },
      },

      metadata: { userId, plan: planKey },

      success_url: `${origin}/?session=success`,
      cancel_url:  `${origin}/?session=canceled`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("[checkout] Stripe error:", err.message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}

// =============================================================
// FILE: /api/webhook.js
// PURPOSE: Receives Stripe events and updates the user's plan
// in Firebase Firestore. This is the single source of truth
// for what plan a user is on.
//
// REQUIRED ENV VARS:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET         ← from Stripe Dashboard → Webhooks
//   FIREBASE_SERVICE_ACCOUNT_JSON ← one-line JSON of your service account
//
// STRIPE EVENTS TO ENABLE (Stripe Dashboard → Developers → Webhooks):
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_failed
// =============================================================

import Stripe                         from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore }                 from "firebase-admin/firestore";

// ── Init Stripe ────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Init Firebase Admin (runs once per cold start) ─────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
}
const db = getFirestore();

// ── CRITICAL: disable Next.js body parser so Stripe can verify the raw body ─
export const config = { api: { bodyParser: false } };

// ── Utility: read raw request body as a Buffer ─────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data",  (chunk) => chunks.push(chunk));
    req.on("end",   ()      => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Utility: write or update a user document in Firestore ──────────────────
async function setUserPlan(userId, fields) {
  await db.collection("users").doc(userId).set(
    { ...fields, updatedAt: new Date() },
    { merge: true }
  );
  console.log(`[webhook] User ${userId} updated:`, fields);
}

// ── Utility: find a user by their Stripe customer ID ───────────────────────
async function findUserByCustomerId(customerId) {
  const snap = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // 1. Verify Stripe signature to confirm the request is genuine
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
    console.error("[webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Event received: ${event.type}`);

  try {
    // ------------------------------------------------------------------
    // checkout.session.completed
    // Fires when the user completes checkout (even during trial — card
    // is saved but not charged yet). This is where we upgrade the plan.
    // ------------------------------------------------------------------
    if (event.type === "checkout.session.completed") {
      const session    = event.data.object;
      const userId     = session.client_reference_id; // Firebase UID we set in checkout
      const email      = session.customer_email;
      const planKey    = session.metadata?.plan || "pro";
      const customerId = session.customer;

      // Fetch subscription to get the renewal/billing date
      let renewalDate = null;
      if (session.subscription) {
        const sub   = await stripe.subscriptions.retrieve(session.subscription);
        renewalDate = new Date(sub.current_period_end * 1000);
      }

      if (userId) {
        await setUserPlan(userId, {
          plan:             planKey,
          stripeCustomerId: customerId,
          subscriptionId:   session.subscription || null,
          renewalDate,
          email,
        });
      } else {
        // Fallback: if we somehow lost the UID, look up by email
        console.warn("[webhook] No client_reference_id, trying email lookup");
        const snap = await db.collection("users").where("email", "==", email).limit(1).get();
        if (!snap.empty) {
          await setUserPlan(snap.docs[0].id, {
            plan:             planKey,
            stripeCustomerId: customerId,
            subscriptionId:   session.subscription || null,
            renewalDate,
            email,
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // customer.subscription.updated
    // Fires when a subscription changes (plan swap, trial → active, etc.)
    // Also fires when subscription becomes past_due or canceled.
    // ------------------------------------------------------------------
    else if (event.type === "customer.subscription.updated") {
      const sub        = event.data.object;
      const userId     = sub.metadata?.userId;
      const planKey    = sub.metadata?.plan;
      const status     = sub.status;
      const renewalDate = new Date(sub.current_period_end * 1000);

      const badStatuses = ["canceled", "unpaid", "incomplete_expired"];

      if (badStatuses.includes(status)) {
        // Subscription went bad — downgrade to free
        const uid = userId || await findUserByCustomerId(sub.customer);
        if (uid) {
          await setUserPlan(uid, { plan: "free", subscriptionId: null, renewalDate: null });
        }
      } else if (userId && planKey) {
        await setUserPlan(userId, {
          plan:             planKey,
          stripeCustomerId: sub.customer,
          subscriptionId:   sub.id,
          renewalDate,
        });
      }
    }

    // ------------------------------------------------------------------
    // customer.subscription.deleted
    // Fires when a subscription is fully cancelled (not just paused).
    // We downgrade the user to the free plan.
    // ------------------------------------------------------------------
    else if (event.type === "customer.subscription.deleted") {
      const sub    = event.data.object;
      const userId = sub.metadata?.userId || await findUserByCustomerId(sub.customer);
      if (userId) {
        await setUserPlan(userId, { plan: "free", subscriptionId: null, renewalDate: null });
      }
    }

    // ------------------------------------------------------------------
    // invoice.payment_failed
    // Stripe will retry automatically. If all retries fail, the
    // subscription.deleted event above fires and downgrades the user.
    // We just log it here; you can extend this to email the user.
    // ------------------------------------------------------------------
    else if (event.type === "invoice.payment_failed") {
      const customerId = event.data.object.customer;
      const userId     = await findUserByCustomerId(customerId);
      if (userId) {
        console.warn(`[webhook] Payment failed for user ${userId}. Stripe will retry.`);
        // Optional: flag the user so the frontend can show a payment warning
        await db.collection("users").doc(userId).set(
          { paymentFailed: true, updatedAt: new Date() },
          { merge: true }
        );
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("[webhook] Handler error:", err);
    return res.status(500).json({ error: "Handler failed" });
  }
}

// =============================================================
// FILE: /api/customer-portal.js
// PURPOSE: Opens the Stripe Customer Portal so users can
// cancel, change their payment method, or view invoices.
// Called when user clicks "Cancel Subscription" in the
// Account & Plan settings modal.
// =============================================================

import Stripe                         from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore }                 from "firebase-admin/firestore";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  try {
    // Look up the user's Stripe customer ID from Firestore
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const { stripeCustomerId } = userDoc.data();

    if (!stripeCustomerId) {
      return res.status(400).json({
        error: "No Stripe customer found for this user. Have you subscribed yet?",
      });
    }

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: origin,    // user lands back here after managing billing
    });

    return res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error("[portal] Error:", err.message);
    return res.status(500).json({ error: "Failed to open billing portal" });
  }
}
