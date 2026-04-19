// ============================================================
// /api/ask.js  —  HomeWorkAI
// ============================================================
// CHANGES IN THIS VERSION:
//  ✅ Resources-in-Tip bug fixed (robust parsing, pre-normalisation)
//  ✅ Markdown link syntax [text](url) stripped from all output
//  ✅ YouTube links go to actual videos (via YOUTUBE_API_KEY)
//  ✅ Quizlet uses real URLs when AI provides them
//  ✅ Visual learner detection — embeds YouTube video + image search
//  ✅ Verbal learner detection — rich prose response style
//  ✅ Preference-only statements get warm acknowledgement, not full answer
//  ✅ No streaming — loading screen until full answer ready
//  ✅ All previous security retained
// ============================================================
//
// NEW ENV VAR (optional but recommended):
//   YOUTUBE_API_KEY  — YouTube Data API v3 key for real video links
//   Get it free at: console.cloud.google.com → Enable YouTube Data API v3
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

// ── Extract clean search topic from AI's Final Answer ──────────────────────
function extractSearchTopic(rawAnswer) {
  const match = rawAnswer.match(/Final Answer:\s*(.+?)(?:\n|$)/i);
  if (!match) return null;
  const stop = new Set(['the','and','for','are','this','that','with','from','they','have','been','which','when','where','what','into','also','some','more','than','then','there','their','these','those','would','could','should','about','after','before','during','between','through','because','however','therefore','although','whereas','both','each','only','just','even','very','most','much','many','such','like','will','can','may','might','must','shall','does','did','has','had','was','were','not','but','how','why','its','all','by','of','to','in','is','a','an']);
  const words = match[1].trim()
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stop.has(w.toLowerCase()))
    .slice(0, 5);
  return words.length > 0 ? words.join(' ') : null;
}

// ── YouTube search — returns actual video data if YOUTUBE_API_KEY is set ──
async function searchYouTubeVideo(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query + " explained")}&type=video&maxResults=1&key=${apiKey}&relevanceLanguage=en&safeSearch=strict`;
    const r    = await fetch(url);
    const data = await r.json();
    const item = data.items?.[0];
    if (item?.id?.videoId) {
      return {
        videoId:  item.id.videoId,
        title:    item.snippet.title,
        channel:  item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url,
        url:      `https://www.youtube.com/watch?v=${item.id.videoId}`,
        embedUrl: `https://www.youtube.com/embed/${item.id.videoId}?rel=0&modestbranding=1`,
      };
    }
  } catch (e) {
    console.error("YouTube API error:", e.message);
  }
  return null;
}

// ── Detect learning style from conversation context ──────────────────────
function detectLearningStyle(history, question) {
  const texts = [
    ...history.slice(-6).map(m => typeof m.content === "string" ? m.content : ""),
    question,
  ].join(" ");
  if (/visual learner|learn visually|i'?m? a? ?visual|prefer videos?|visual (person|style)|show me visually/i.test(texts)) return "visual";
  if (/word person|verbal learner|descriptive words?|long (passage|explanation)|prefer (text|reading|words)|detailed prose/i.test(texts)) return "verbal";
  return null;
}

// ── True if message only states a preference, asks no academic question ──
function isPreferenceOnly(question) {
  const q = question.trim();
  const hasIntent = /\?|what|how|why|when|where|who|explain|solve|help me|tell me|calculate|find|define|describe|summarize|analyze/i.test(q);
  const isPref    = /\b(i'?m? (a )?(visual|word|verbal) (learner|person)|i (learn|prefer) (visually|through words|via videos?)|my (learning style|preference) is)/i.test(q);
  return isPref && !hasIntent && q.length < 200;
}

// ── Parse and extract Resources section (handles markdown links too) ──────
function parseResources(text) {
  let resources = [];
  let answer    = text;

  // Ensure Resources: always starts on its own paragraph
  answer = answer.replace(/([^\n])(Resources:)/g, "$1\n\nResources:");

  const match = answer.match(/\n?Resources:\s*\n([\s\S]*?)(?=\n\n[^\-\*\n]|$)/);
  if (match) {
    const lines = match[1].split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Match markdown format: YouTube: [Title](url)
      const ytMd    = line.match(/^[-*]?\s*YouTube:\s*\[([^\]]+)\]\((https?:[^)]+)\)/i);
      const ytPlain = line.match(/^[-*]?\s*YouTube:\s*(.+)/i);
      const qlMd    = line.match(/^[-*]?\s*Quizlet:\s*\[([^\]]+)\]\((https?:[^)]+)\)/i);
      const qlPlain = line.match(/^[-*]?\s*Quizlet:\s*(.+)/i);

      if (ytMd) {
        resources.push({ type: "youtube", title: ytMd[1].trim(), link: ytMd[2].trim() });
      } else if (ytPlain) {
        const raw   = ytPlain[1].trim();
        const title = raw.replace(/\[([^\]]+)\]\([^)]+\)/, "$1").replace(/^\[|\]$/g, "").trim();
        const urlM  = raw.match(/\((https?:[^)]+)\)/);
        const link  = urlM ? urlM[1] : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`;
        resources.push({ type: "youtube", title, link });
      }

      if (qlMd) {
        resources.push({ type: "quizlet", title: qlMd[1].trim(), link: qlMd[2].trim() });
      } else if (qlPlain && !ytPlain) {
        const raw   = qlPlain[1].trim();
        const title = raw.replace(/\[([^\]]+)\]\([^)]+\)/, "$1").replace(/^\[|\]$/g, "").trim();
        const urlM  = raw.match(/\((https?:[^)]+)\)/);
        const link  = urlM ? urlM[1] : `https://quizlet.com/search?query=${encodeURIComponent(title)}&type=sets`;
        resources.push({ type: "quizlet", title, link });
      }
    }
    // Remove resources block from answer text
    answer = answer.replace(/\n?Resources:\s*\n[\s\S]*?(?=\n\n[^\-\*\n]|$)/, "").trim();
  }

  // Strip any remaining markdown link syntax [text](url) from displayed answer
  answer = answer.replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, "$1");

  return { answer, resources };
}

// ── Process raw AI output ──────────────────────────────────────────────────
function processAnswer(rawText, userPlan) {
  let answer = rawText
    .replace(/\\\[[\s\S]*?\\\]/g, "")
    .replace(/\\\([\s\S]*?\\\)/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/^#{1,6}\s/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Ensure section headers always start on their own lines
  const headers = ['Final Answer:','Explanation:','Step-by-step:','Step-by-Step:','Tip:','Insight:','Deeper Insight:','Common Mistake:','Key Points:','Key Point:','Resources:'];
  headers.forEach(h => {
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    answer = answer.replace(new RegExp('([^\\n])\\s*(' + esc + ')', 'g'), '$1\n\n$2');
  });
  // Numbered steps on their own lines
  answer = answer.replace(/([.!?])\s+(\d+\.\s)/g, '$1\n$2');
  answer = answer.replace(/([.!?])\s+(Step\s+\d+[:.]\s)/gi, '$1\n$2');

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

// ── Main handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify Firebase token
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
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

  // Validate image if provided — prevents cost abuse and type spoofing
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
  const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit (base64 is ~4/3 of original)

  if (imageBase64 && imageType) {
    if (!ALLOWED_IMAGE_TYPES.includes(imageType.toLowerCase())) {
      return res.status(400).json({ error: "Invalid image type. Please upload a JPEG, PNG, GIF, or WebP image." });
    }
    // base64 string length * 0.75 gives approximate byte size
    const approxBytes = imageBase64.length * 0.75;
    if (approxBytes > MAX_IMAGE_SIZE_BYTES) {
      return res.status(400).json({ error: "Image is too large. Please upload an image under 5MB." });
    }
  }

  const hasImage = !!(imageBase64 && imageType);
  if (!question && !hasImage) return res.status(400).json({ error: "No question provided." });

  const trimmedQuestion = (question || "").trim().slice(0, 4000);
  const safeHistory     = Array.isArray(history) ? history.slice(-6) : [];

  // 5. Detect learning style and preference-only (Pro+ only)
  const learningStyle = userPlan === "pro_plus" ? detectLearningStyle(safeHistory, trimmedQuestion) : null;
  const prefOnly      = userPlan === "pro_plus" && !hasImage && isPreferenceOnly(trimmedQuestion);

  // 6. Build system prompt
  let learningStyleInstructions = "";
  if (userPlan === "pro_plus") {
    if (prefOnly) {
      learningStyleInstructions = `
PREFERENCE STATEMENT DETECTED: The user is expressing a learning preference, not asking a subject question.
- Respond with ONLY a warm, friendly 1-2 sentence acknowledgment. Do NOT use Final Answer: format.
- Example: "Perfect! I'll include visual content and clear visual analogies in all my explanations for you."`;
    } else if (learningStyle === "visual") {
      learningStyleInstructions = `
LEARNING STYLE — VISUAL LEARNER:
- Keep text concise and structured. Use vivid visual analogies ("imagine this as...", "picture this like...").
- Think in terms of diagrams, timelines, and spatial relationships.
- The system will automatically embed a relevant educational video alongside your response.`;
    } else if (learningStyle === "verbal") {
      learningStyleInstructions = `
LEARNING STYLE — VERBAL / WORD LEARNER:
- Write in rich, flowing, highly descriptive prose. Use vivid literary analogies and narrative language.
- Expand explanations with nuanced detail and context. Make it feel like a well-written essay.
- Use full, eloquent sentences. Avoid bullet points where prose works better.`;
    }
  }

  let planInstructions = "";
  if (userPlan === "free") {
    planInstructions = `PLAN: Free
REQUIRED: Final Answer (one sentence) + Explanation (1-2 sentences only).
FORBIDDEN: Step-by-step, Tip, Insight, Common Mistake, Key Points, Resources.
FORMATTING: Plain text. No bold, no underline.`;
  } else if (userPlan === "pro") {
    planInstructions = `PLAN: Pro
REQUIRED: Final Answer + Explanation (2-3 short paragraphs).
ALLOWED: Step-by-step (for processes/calculations), Tip (genuine shortcuts only).
FORBIDDEN: Insight, Common Mistake, Key Points, Resources.
FORMATTING: Bold (**word**) for 2-4 key terms. No underline.`;
  } else if (userPlan === "pro_plus") {
    planInstructions = `PLAN: Pro+
REQUIRED: Final Answer + Explanation (2-4 paragraphs, explain the WHY).
ALLOWED (only when genuinely adding value):
- Step-by-step (processes/calculations with real numbers)
- Tip (high-value shortcuts only)
- Insight (deeper nuance for complex topics)
- Common Mistake (one specific error — one sentence)
- Key Points (summary/review — 3-6 bullets)
- Resources (topics benefiting from further study — see format)
Do NOT force all sections. Only include what adds real value.
FORMATTING: Bold (**word**) for key terms. Underline (__phrase__) for the single most important concept.
RESOURCES FORMAT (skip for calculations/simple facts):
Resources:
- YouTube: [Specific descriptive video title]
- Quizlet: [Specific study set name]`;
  }

  const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic through calculus, linear algebra, statistics) | Science (biology, chemistry, physics) | History & social studies | English, literature & writing | Economics & business | Law & political science | Psychology & sociology | Computer science & programming | Foreign languages | Test prep (SAT, ACT, AP exams, GRE, GMAT, LSAT) | Any academic topic

${planInstructions}
${learningStyleInstructions}

UNIVERSAL RULES:
1. Always start with: Final Answer: [one direct sentence] (unless handling a preference statement)
2. Never write one long wall of text. Every paragraph = one idea, 2-3 sentences max.
3. Steps must show REAL work with actual numbers — never vague. Format EVERY step as: "1. Description" (use digits and periods like 1. 2. 3. — never write "Step 1:" format).
4. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand.
5. Scale length to complexity.
6. No LaTeX, no markdown headers (##), no dollar signs for math.
7. If asked about an image, carefully read and solve the homework problem shown.
8. If not academic: "I'm here to help with homework and studying. Try asking me a subject question!"`;

  // 7. Build messages array (Chat Completions format — properly supports multi-turn history)
  const messages = [{ role: "system", content: systemPrompt }];

  // Add conversation history (previous turns)
  safeHistory.forEach(m => {
    if (m.role && m.content) messages.push({ role: m.role, content: m.content });
  });

  // Add current user message
  if (hasImage) {
    messages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${imageType};base64,${imageBase64}`, detail: "high" } },
        { type: "text", text: trimmedQuestion || "Please read this image and solve the homework problem shown." }
      ]
    });
  } else {
    messages.push({ role: "user", content: `Question: ${trimmedQuestion}` });
  }

  // 8. Pick model (gpt-4o for images; plan-based otherwise)
  const model = hasImage ? "gpt-4o" :
    userPlan === "pro_plus" ? "gpt-4.1"      :
    userPlan === "pro"      ? "gpt-4.1-mini" :
                              "gpt-4o-mini";

  // Use plan-based token limits — free users only need short answers
  const maxTokens = userPlan === "pro_plus" ? 2000 :
                    userPlan === "pro"       ? 1000 :
                                               400;

  // 9. Call OpenAI Chat Completions API
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ model, messages, max_tokens: maxTokens }),
    });

    const data = await openaiRes.json();

    // Surface the real OpenAI error if the call failed
    if (!openaiRes.ok) {
      console.error("OpenAI API error:", JSON.stringify(data));
      throw new Error(data.error?.message || "OpenAI API returned an error");
    }

    let rawAnswer = "No response";
    if (data.choices?.[0]?.message?.content) {
      rawAnswer = data.choices[0].message.content;
    }

    const processed = processAnswer(rawAnswer, userPlan);
    let { answer, resources } = userPlan === "pro_plus"
      ? parseResources(processed)
      : { answer: processed, resources: [] };

    // 10. Use clean topic from Final Answer for accurate searches
    const searchTopic = extractSearchTopic(rawAnswer) || trimmedQuestion.replace(/\b(visual learner|i'?m? a visual|show me|can you|please|help me)\b/gi, '').trim();

    let embeddedVideo    = null;
    let imageSearchQuery = null;

    if (userPlan === "pro_plus") {
      // Upgrade any YouTube resource links that are still search URLs to real video links
      for (let i = 0; i < resources.length; i++) {
        if (resources[i].type === "youtube" && resources[i].link.includes("youtube.com/results")) {
          const vid = await searchYouTubeVideo(resources[i].title);
          if (vid) resources[i].link = vid.url;
        }
      }
      // Visual learner embed
      if (learningStyle === "visual" && !prefOnly) {
        embeddedVideo    = await searchYouTubeVideo(searchTopic + " explained");
        imageSearchQuery = searchTopic;
      }
    }

    return res.status(200).json({
      answer,
      resources,
      plan:             userPlan,
      learningStyle,
      isAcknowledgement: prefOnly,
      embeddedVideo,
      imageSearchQuery,
      videos: [],
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

