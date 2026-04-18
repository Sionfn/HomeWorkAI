// ============================================================
// /api/ask.js  —  HomeWorkAI  (secured server-side handler)
// ============================================================
//
// SECURITY MODEL
// ─────────────────────────────────────────────────────────────
// • Every request MUST include a Firebase ID token in the
//   Authorization header:  "Bearer <idToken>"
// • The plan is NEVER trusted from the client. It is resolved
//   here on the server from verified identity + Firestore.
// • Daily usage is tracked in Firestore (not localStorage),
//   so it cannot be bypassed from the browser.
// • Admin / VIP emails live in environment variables only —
//   never in the frontend source code.
//
// REQUIRED ENVIRONMENT VARIABLES
// ─────────────────────────────────────────────────────────────
//   OPENAI_API_KEY          — your OpenAI key
//   FIREBASE_PROJECT_ID     — from Firebase console
//   FIREBASE_CLIENT_EMAIL   — from Firebase service account JSON
//   FIREBASE_PRIVATE_KEY    — from Firebase service account JSON
//   ADMIN_EMAIL             — your admin email (gets Pro+ free)
//   VIP_PRO_EMAILS          — comma-separated VIP emails (get Pro free)
// ============================================================

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// ── Firebase Admin: initialise once ────────────────────────────────────────
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
const db        = getFirestore();

// ── Constants ───────────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT  = 5;
const ADMIN_EMAIL       = process.env.ADMIN_EMAIL || "";
const VIP_PRO_EMAILS    = (process.env.VIP_PRO_EMAILS || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

// ── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Verify Firebase ID token ─────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized — no token provided." });
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ error: "Unauthorized — invalid or expired token." });
  }

  const { uid, email: userEmail } = decodedToken;

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized — token has no email." });
  }

  // ── 2. Resolve the user's plan (server-side only) ───────────────────────
  // Priority: admin env var → VIP env var → Firestore paid record → free
  let userPlan = "free";

  if (userEmail === ADMIN_EMAIL) {
    userPlan = "pro_plus";
  } else if (VIP_PRO_EMAILS.includes(userEmail)) {
    userPlan = "pro";
  } else {
    // Look up plan from Firestore (written there by your Stripe webhook)
    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) {
        userPlan = userDoc.data()?.plan || "free";
      }
    } catch (err) {
      console.warn("Firestore plan lookup failed, defaulting to free:", err.message);
    }
  }

  // ── 3. Enforce daily usage limits (server-side) ─────────────────────────
  // Free users: max FREE_DAILY_LIMIT questions per UTC day.
  // Pro / Pro+ users: unlimited.
  if (userPlan === "free") {
    const today      = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
    const usageDocId = `${uid}_${today}`;
    const usageRef   = db.collection("usage").doc(usageDocId);

    try {
      const usageSnap = await usageRef.get();
      const count     = usageSnap.exists ? (usageSnap.data()?.count || 0) : 0;

      if (count >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          error: `Daily limit of ${FREE_DAILY_LIMIT} questions reached. Upgrade to Pro for unlimited access.`,
        });
      }

      // Atomically increment — safe even with concurrent requests
      await usageRef.set(
        { count: count + 1, uid, email: userEmail, date: today },
        { merge: true }
      );
    } catch (err) {
      // If Firestore is temporarily unavailable, allow the request rather
      // than blocking a legitimate user — log and continue.
      console.error("Usage tracking error:", err.message);
    }
  }

  // ── 4. Validate question ─────────────────────────────────────────────────
  const { question } = req.body;
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    return res.status(400).json({ error: "No question provided." });
  }

  // Sanity cap: don't process absurdly long inputs
  const trimmedQuestion = question.trim().slice(0, 4000);

  // ── 5. Build system prompt per plan ─────────────────────────────────────
  let planInstructions = "";

  if (userPlan === "free") {
    planInstructions = `PLAN: Free

GOAL: Provide quick, basic answers. Be useful but limited.

REQUIRED SECTIONS (always include both, nothing else):
1. Final Answer — one direct sentence, the answer only.
2. Explanation — 1–2 sentences max. Explain the core idea simply. No depth, no breakdown.

STRICTLY FORBIDDEN — never include any of the following, under any condition:
- Step-by-step
- Tip
- Insight
- Common Mistake
- Key Points
- Resources
- Any extra section, label, or heading

CRITICAL RULE: Step-by-step must NEVER appear on the Free plan — not for math, not for science, not for any subject.

QUESTION HANDLING RULE — applies even when the user explicitly asks for more:
If the user asks for step-by-step, a detailed breakdown, or any advanced format:
- Still answer the question correctly
- Still provide a short explanation (1–2 sentences)
- Do NOT provide steps, numbered lists, or detailed breakdowns
Give a simplified, correct answer. Never reject or skip the question — just keep it short and basic.

MODEL BEHAVIOR: Fast and simple. Minimal reasoning shown. No deep breakdowns. Focus on giving the result quickly.

FORMATTING: Plain text only. No bold (**), no underline (__).`;

  } else if (userPlan === "pro") {
    planInstructions = `PLAN: Pro

GOAL: Help users actually understand the answer. Feel like a helpful tutor.

REQUIRED SECTIONS (always include both):
1. Final Answer — one direct sentence, the answer only.
2. Explanation — medium depth. 2–3 short paragraphs, one idea each, 2–3 sentences max.

ALLOWED SECTIONS (only when they genuinely help):
3. Step-by-step — when the question involves a process or multi-step problem. Show real operations with actual numbers.
4. Tip — ONLY if there is a genuinely useful shortcut or memory trick.

STRICTLY FORBIDDEN:
- Insight
- Common Mistake
- Key Points
- Resources

MODEL BEHAVIOR: Clear and structured explanations. Step-by-step for problems when helpful.

FORMATTING: Bold (**word**) allowed for key terms — use selectively, 2–4 highlights max. No underline (__).`;

  } else if (userPlan === "pro_plus") {
    planInstructions = `PLAN: Pro+

GOAL: Deliver a premium learning experience. Act like a full tutor.

REQUIRED SECTIONS (always include both):
1. Final Answer — one direct sentence, the answer only.
2. Explanation — deep and clear. 2–4 short paragraphs. Explain underlying principles and the WHY.

ALLOWED SECTIONS (only when they genuinely improve the answer):
3. Step-by-step — when the question involves a process or calculation.
4. Tip — ONLY if there is a high-value shortcut or mental model.
5. Insight — ONLY for complex topics where there is a deeper nuance students often miss.
6. Common Mistake — ONLY when there is one specific, common error. One sentence.
7. Key Points — ONLY for summary/review situations. 3–6 bullet points.
8. Resources — ONLY for topics that genuinely benefit from further study.

IMPORTANT RULE: Do NOT force all sections into every response.

FORMATTING: Bold (**word**) for key terms. Underline (__phrase__) for the single most important concept.

RESOURCES FORMAT:
Resources:
- YouTube: [Specific descriptive video title matching the exact topic]
- Quizlet: [Relevant study set name matching the topic]

Rules:
- YouTube title must be specific (e.g. "Mitosis vs Meiosis step by step" not just "cell division")
- Include 1 YouTube and 1 Quizlet when both are relevant. Include just one if only one fits.
- Skip Resources entirely for math calculations, simple factual questions.`;
  }

  const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic through calculus, statistics) | Science (biology, chemistry, physics) | History | English & writing | Economics | Law | Psychology | Computer science | Any academic topic

${planInstructions}

UNIVERSAL RULES (apply to all plans):
1. ALWAYS start with: Final Answer: [one direct sentence — the answer only, no explanation here]
2. Never write one long wall of text. Every paragraph = one idea, 2–3 sentences max.
3. Steps must show REAL work — never vague.
4. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand.
5. Scale length to complexity — simple questions get short answers.
6. No LaTeX, no markdown headers (##), no dollar signs for math.
7. If the question is not academic: reply only "I'm here to help with homework and studying. Try asking me a subject question!"`;

  // ── 6. Select model per plan ─────────────────────────────────────────────
  const model =
    userPlan === "pro_plus" ? "gpt-4.1"      :
    userPlan === "pro"      ? "gpt-4.1-mini" :
                              "gpt-4o-mini";

  // ── 7. Call OpenAI ────────────────────────────────────────────────────────
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: `Question: ${trimmedQuestion}`,
      }),
    });

    const data = await response.json();

    // ── 8. Extract raw answer ──────────────────────────────────────────────
    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray?.length > 0) {
        rawAnswer = contentArray.map((c) => c.text || "").join("");
      }
    } catch (parseErr) {
      console.error("OpenAI parse error:", data);
    }

    // ── 9. Strip LaTeX / markdown artifacts ───────────────────────────────
    let answer = rawAnswer
      .replace(/\\\[[\s\S]*?\\\]/g, "")
      .replace(/\\\([\s\S]*?\\\)/g, "")
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/^#{1,6}\s/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Hard-strip formatting + forbidden sections for Free plan
    if (userPlan === "free") {
      answer = answer
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g,   "$1")
        .replace(/__(.*?)__/g,   "$1")
        .replace(/^(Step-by-step:|Tip:|Insight:|Common Mistake:|Key Points:|Resources:).*$/gim, "")
        .replace(/^\d+\.\s.+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else {
      // Strip stray single asterisks (italic) but keep double (bold)
      answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    }

    // ── 10. Parse Resources block (Pro+ only) ─────────────────────────────
    let resources = [];

    if (userPlan === "pro_plus") {
      const resourcesMatch = answer.match(/Resources:\n([\s\S]*?)(?=\n\n|$)/);
      if (resourcesMatch) {
        const block = resourcesMatch[1];
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

        for (const line of lines) {
          const ytMatch = line.match(/^[-*]?\s*YouTube:\s*(.+)/i);
          const qlMatch = line.match(/^[-*]?\s*Quizlet:\s*(.+)/i);

          if (ytMatch) {
            const title = ytMatch[1].trim();
            resources.push({
              type:  "youtube",
              title,
              link:  "https://www.youtube.com/results?search_query=" + encodeURIComponent(title),
            });
          } else if (qlMatch) {
            const title = qlMatch[1].trim();
            resources.push({
              type:  "quizlet",
              title,
              link:  "https://quizlet.com/search?query=" + encodeURIComponent(title) + "&type=sets",
            });
          }
        }

        // Remove the Resources block from the main answer text
        answer = answer.replace(/Resources:\n[\s\S]*?(?=\n\n|$)/, "").trim();
      }
    }

    // Legacy: include empty videos array so older frontend code doesn't break
    return res.status(200).json({ answer, resources, videos: [] });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

