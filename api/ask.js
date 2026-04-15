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

// ============================================================
// api/create-checkout-session.js
// Creates a Stripe Checkout session (subscription + 3-day trial)
// ============================================================
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Price IDs ──────────────────────────────────────────────────────────────
// Set these in your .env after creating products in the Stripe dashboard.
// See SETUP INSTRUCTIONS for how to create them.
const PRICE_IDS = {
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

  try {
    const { plan, userId, email, billing = "monthly" } = req.body;

    if (!plan || !userId || !email) {
      return res.status(400).json({ error: "Missing required fields: plan, userId, email" });
    }

    // Normalize plan key  ("Pro" → "pro",  "Pro+" → "pro_plus")
    const planKey    = plan === "Pro+" ? "pro_plus" : "pro";
    const billingKey = billing === "yearly" ? "yearly" : "monthly";
    const priceId    = PRICE_IDS[planKey][billingKey];

    if (!priceId) {
      return res.status(400).json({
        error: `Missing price ID env var for ${planKey}/${billingKey}. Check your .env file.`,
      });
    }

    // ── Build site URL for redirect ────────────────────────────────────────
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,

      // client_reference_id = Firebase UID — the webhook uses this to update Firestore
      client_reference_id: userId,

      line_items: [{ price: priceId, quantity: 1 }],

      subscription_data: {
        trial_period_days: 3,
        metadata: {
          userId,       // stored on the subscription for webhook fallback
          plan: planKey,
        },
      },

      // Also stored on the session for the checkout.session.completed event
      metadata: { userId, plan: planKey },

      success_url: `${siteUrl}/?session=success&plan=${planKey}`,
      cancel_url:  `${siteUrl}/?session=canceled`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Stripe checkout error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}

// ============================================================
// api/webhook.js
// Stripe webhook — listens for subscription events and
// updates the user's plan in Firebase Firestore.
// ============================================================
import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore }                  from "firebase-admin/firestore";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Firebase Admin (initialised once) ────────────────────────────────────
if (!getApps().length) {
  initializeApp({
    credential: cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    ),
  });
}
const db = getFirestore();

// ── CRITICAL: disable body parser so Stripe can verify the raw signature ──
export const config = { api: { bodyParser: false } };

// ── Helpers ───────────────────────────────────────────────────────────────

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Write or update a user's plan fields in Firestore.
 * Uses merge:true so no existing fields are wiped.
 */
async function setUserPlan(userId, plan, customerId, subscriptionId, renewalTimestamp) {
  await db.collection("users").doc(userId).set(
    {
      plan,
      stripeCustomerId: customerId  || null,
      subscriptionId:   subscriptionId || null,
      renewalDate:      renewalTimestamp ? new Date(renewalTimestamp * 1000) : null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
  console.log(`[webhook] Updated user ${userId} → plan: ${plan}`);
}

/**
 * Downgrade a user back to the free plan.
 */
async function downgradeToFree(userId) {
  await db.collection("users").doc(userId).set(
    { plan: "free", subscriptionId: null, renewalDate: null, updatedAt: new Date() },
    { merge: true }
  );
  console.log(`[webhook] Downgraded user ${userId} → free`);
}

/**
 * Find a user document by Stripe customer ID (fallback when metadata is missing).
 */
async function findUserByCustomerId(customerId) {
  const snap = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Find a user document by email (last-resort fallback).
 */
async function findUserByEmail(email) {
  const snap = await db
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

// ── Main handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

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

  console.log(`[webhook] Received event: ${event.type}`);

  try {
    // ── checkout.session.completed ───────────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session    = event.data.object;
      const userId     = session.client_reference_id;  // Firebase UID
      const email      = session.customer_email;
      const planKey    = session.metadata?.plan || "pro";
      const customerId = session.customer;

      // Fetch subscription so we can get the renewal date
      let renewalDate = null;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        renewalDate = sub.current_period_end;
      }

      if (userId) {
        // Persist email for fallback lookups
        await db.collection("users").doc(userId).set({ email }, { merge: true });
        await setUserPlan(userId, planKey, customerId, session.subscription, renewalDate);
      } else if (email) {
        // Fallback: look up by email
        const uid = await findUserByEmail(email);
        if (uid) await setUserPlan(uid, planKey, customerId, session.subscription, renewalDate);
        else console.warn(`[webhook] No user found for email: ${email}`);
      }
    }

    // ── customer.subscription.created / updated ──────────────────────────
    else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      const sub        = event.data.object;
      const userId     = sub.metadata?.userId;
      const planKey    = sub.metadata?.plan;
      const status     = sub.status;
      const renewalDate = sub.current_period_end;

      const badStatuses = ["canceled", "unpaid", "incomplete_expired"];

      if (badStatuses.includes(status)) {
        // Subscription went bad — downgrade
        const uid = userId || await findUserByCustomerId(sub.customer);
        if (uid) await downgradeToFree(uid);
      } else if (userId && planKey) {
        await setUserPlan(userId, planKey, sub.customer, sub.id, renewalDate);
      }
      // Note: if metadata is missing (e.g. old subscription), checkout.session.completed
      // already handled the initial upgrade so this is a no-op.
    }

    // ── customer.subscription.deleted ────────────────────────────────────
    else if (event.type === "customer.subscription.deleted") {
      const sub    = event.data.object;
      const userId = sub.metadata?.userId
                  || await findUserByCustomerId(sub.customer);
      if (userId) await downgradeToFree(userId);
      else console.warn(`[webhook] Could not find user for deleted subscription: ${sub.id}`);
    }

    // ── invoice.payment_failed ────────────────────────────────────────────
    // Stripe will retry automatically. The subscription moves to "past_due"
    // and eventually fires subscription.deleted if all retries fail.
    // Log the failure here — you could also send a notification email.
    else if (event.type === "invoice.payment_failed") {
      const invoice    = event.data.object;
      const customerId = invoice.customer;
      const uid        = await findUserByCustomerId(customerId);
      if (uid) {
        console.warn(`[webhook] Payment failed for user ${uid}. Stripe will retry.`);
        // Optional: write a flag to Firestore so the frontend can show a warning banner
        await db.collection("users").doc(uid).set(
          { paymentFailed: true, updatedAt: new Date() },
          { merge: true }
        );
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("[webhook] Handler error:", err);
    return res.status(500).json({ error: "Internal handler error" });
  }
}

// ============================================================
// api/customer-portal.js
// Opens the Stripe Billing Portal so users can cancel,
// update their card, or view invoices.
// ============================================================
import Stripe from "stripe";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore }                  from "firebase-admin/firestore";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    ),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Look up the user's Stripe customer ID from Firestore
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found in Firestore" });
    }

    const { stripeCustomerId } = userDoc.data();
    if (!stripeCustomerId) {
      return res.status(400).json({
        error: "No Stripe customer linked to this account. Have you subscribed yet?",
      });
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: siteUrl,
    });

    return res.status(200).json({ url: portalSession.url });

  } catch (err) {
    console.error("Customer portal error:", err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
}
