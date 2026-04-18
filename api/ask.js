// ============================================================
// /api/ask.js  —  HomeWorkAI
// ============================================================
// FIXES IN THIS VERSION:
//  ✅ Returns plan in response so frontend renders correctly
//  ✅ Numbered-list stripping removed (was too aggressive)
//  ✅ Conversation history support (last 3 exchanges)
//  ✅ Image/Vision via OpenAI gpt-4o (replaces Tesseract OCR)
//  ✅ Test prep subjects added (SAT, ACT, AP, GRE, GMAT)
//  ✅ SSE streaming — text appears word by word in real time
//  ✅ All security from previous version retained
// ============================================================

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth }       from "firebase-admin/auth";
import { getFirestore }                  from "firebase-admin/firestore";

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

const FREE_DAILY_LIMIT = 5;
const ADMIN_EMAIL      = process.env.ADMIN_EMAIL || "";
const VIP_PRO_EMAILS   = (process.env.VIP_PRO_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function processAnswer(rawText, userPlan) {
  let answer = rawText
    .replace(/\\\[[\s\S]*?\\\]/g, "")
    .replace(/\\\([\s\S]*?\\\)/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/^#{1,6}\s/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (userPlan === "free") {
    answer = answer
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g,     "$1")
      .replace(/__(.*?)__/g,     "$1")
      .replace(/^(Step-by-step:|Tip:|Insight:|Common Mistake:|Key Points:|Resources:)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  }
  return answer;
}

function parseResources(text) {
  let resources = [];
  let answer    = text;
  const match   = text.match(/Resources:\n([\s\S]*?)(?=\n\n|$)/);
  if (match) {
    const lines = match[1].split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const yt = line.match(/^[-*]?\s*YouTube:\s*(.+)/i);
      const ql = line.match(/^[-*]?\s*Quizlet:\s*(.+)/i);
      if (yt) resources.push({ type: "youtube", title: yt[1].trim(),
        link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(yt[1].trim()) });
      else if (ql) resources.push({ type: "quizlet", title: ql[1].trim(),
        link: "https://quizlet.com/search?query=" + encodeURIComponent(ql[1].trim()) + "&type=sets" });
    }
    answer = text.replace(/Resources:\n[\s\S]*?(?=\n\n|$)/, "").trim();
  }
  return { answer, resources };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify Firebase token
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized — no token provided." });
  }
  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized — invalid or expired token." });
  }
  const { uid, email: userEmail } = decodedToken;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized — token has no email." });

  // 2. Resolve plan server-side
  let userPlan = "free";
  if (userEmail === ADMIN_EMAIL) {
    userPlan = "pro_plus";
  } else if (VIP_PRO_EMAILS.includes(userEmail)) {
    userPlan = "pro";
  } else {
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) userPlan = doc.data()?.plan || "free";
    } catch (err) {
      console.warn("Firestore plan lookup failed:", err.message);
    }
  }

  // 3. Daily usage limits (free plan only)
  if (userPlan === "free") {
    const today    = new Date().toISOString().split("T")[0];
    const usageRef = db.collection("usage").doc(`${uid}_${today}`);
    try {
      const snap  = await usageRef.get();
      const count = snap.exists ? (snap.data()?.count || 0) : 0;
      if (count >= FREE_DAILY_LIMIT) {
        return res.status(429).json({ error: `Daily limit reached. Upgrade to Pro for unlimited access.` });
      }
      await usageRef.set({ count: count + 1, uid, email: userEmail, date: today }, { merge: true });
    } catch (err) {
      console.error("Usage tracking error:", err.message);
    }
  }

  // 4. Parse request body
  const { question, imageBase64, imageType, history } = req.body;
  const hasImage = !!(imageBase64 && imageType);
  if (!question && !hasImage) return res.status(400).json({ error: "No question provided." });

  const trimmedQuestion = (question || "").trim().slice(0, 4000);

  // 5. System prompt
  let planInstructions = "";

  if (userPlan === "free") {
    planInstructions = `PLAN: Free
GOAL: Quick, basic answers. Useful but limited.
REQUIRED SECTIONS:
1. Final Answer — one direct sentence only.
2. Explanation — 1–2 sentences max.
STRICTLY FORBIDDEN: Step-by-step, Tip, Insight, Common Mistake, Key Points, Resources.
FORMATTING: Plain text only. No bold, no underline.`;

  } else if (userPlan === "pro") {
    planInstructions = `PLAN: Pro
GOAL: Help users understand the answer. Feel like a helpful tutor.
REQUIRED SECTIONS:
1. Final Answer — one direct sentence only.
2. Explanation — medium depth. 2–3 short paragraphs, one idea each, 2–3 sentences max.
ALLOWED SECTIONS (only when they genuinely help):
3. Step-by-step — for processes or calculations. Show real numbers.
4. Tip — ONLY for a genuinely useful shortcut or memory trick.
STRICTLY FORBIDDEN: Insight, Common Mistake, Key Points, Resources.
FORMATTING: Bold (**word**) for key terms, 2–4 max. No underline.`;

  } else if (userPlan === "pro_plus") {
    planInstructions = `PLAN: Pro+
GOAL: Premium learning experience. Full tutor mode.
REQUIRED SECTIONS:
1. Final Answer — one direct sentence only.
2. Explanation — deep and clear. 2–4 short paragraphs. Explain underlying principles and the WHY.
ALLOWED SECTIONS (only when they genuinely add value):
3. Step-by-step — for processes, calculations, multi-step problems.
4. Tip — high-value shortcuts or mental models only.
5. Insight — complex topics with deeper nuance students often miss.
6. Common Mistake — one specific common error. One sentence only.
7. Key Points — summary/review situations only. 3–6 bullet points.
8. Resources — only for topics benefiting from further study.
Do NOT force all sections into every response.
FORMATTING: Bold (**word**) for key terms. Underline (__phrase__) for the single most important concept.
RESOURCES FORMAT (skip for calculations and simple facts):
Resources:
- YouTube: [Specific descriptive title, e.g. "Mitosis vs Meiosis step by step explained"]
- Quizlet: [Study set name, e.g. "AP Biology Chapter 12 Cell Division Flashcards"]`;
  }

  const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.

Subjects: Math (arithmetic through calculus, linear algebra, statistics) | Science (biology, chemistry, physics) | History & social studies | English, literature & writing | Economics & business | Law & political science | Psychology & sociology | Computer science & programming | Foreign languages | Test prep (SAT, ACT, AP exams, GRE, GMAT, LSAT) | Any academic topic

${planInstructions}

UNIVERSAL RULES:
1. ALWAYS start with: Final Answer: [one direct sentence — the answer only]
2. Never write one long wall of text. Every paragraph = one idea, 2–3 sentences max.
3. Steps must show REAL work with actual numbers — never vague.
4. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand.
5. Scale length to complexity — simple questions get short answers.
6. No LaTeX, no markdown headers (##), no dollar signs for math.
7. If asked about an image, carefully read and solve the homework problem shown in it.
8. If the question is not academic: reply only "I'm here to help with homework and studying. Try asking me a subject question!"`;

  // 6. Build conversation input with history
  const safeHistory = Array.isArray(history) ? history.slice(-6) : [];

  let currentUserMessage;
  if (hasImage) {
    currentUserMessage = {
      role: "user",
      content: [
        {
          type:      "input_image",
          image_url: `data:${imageType};base64,${imageBase64}`,
          detail:    "high"
        },
        {
          type: "input_text",
          text: trimmedQuestion || "Please read this image and solve the homework problem shown."
        }
      ]
    };
  } else {
    currentUserMessage = {
      role:    "user",
      content: `Question: ${trimmedQuestion}`
    };
  }

  const conversationInput = [...safeHistory, currentUserMessage];

  // 7. Pick model — always use gpt-4o for images (best vision model)
  const model = hasImage        ? "gpt-4o"      :
    userPlan === "pro_plus"     ? "gpt-4.1"     :
    userPlan === "pro"          ? "gpt-4.1-mini":
                                  "gpt-4o-mini";

  // 8. Set SSE headers
  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input:        conversationInput,
        stream:       true,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      console.error("OpenAI error:", err);
      sendSSE(res, { type: "error", message: "AI service error. Please try again." });
      return res.end();
    }

    // 9. Stream text deltas to client
    const reader  = openaiRes.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = "";
    let sseBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer   = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw);
          if (event.type === "response.output_text.delta") {
            const delta = event.delta || "";
            fullText += delta;
            sendSSE(res, { type: "delta", delta });
          }
        } catch (_) {}
      }
    }

    // 10. Process full text, send structured done event
    const processed = processAnswer(fullText, userPlan);
    const { answer, resources } = userPlan === "pro_plus"
      ? parseResources(processed)
      : { answer: processed, resources: [] };

    sendSSE(res, {
      type:      "done",
      answer,
      resources,
      plan:      userPlan,  // ✅ frontend uses this for rendering
      videos:    [],
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    sendSSE(res, { type: "error", message: "Something went wrong. Please try again." });
  }

  res.end();
}
