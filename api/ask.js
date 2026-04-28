// ============================================================
// /api/ask.js  —  HomeWorkAI
// ============================================================
// CHANGES IN THIS VERSION:
//  ✅ Resources-in-Tip bug fixed (robust parsing, pre-normalisation)
//  ✅ Markdown link syntax [text](url) stripped from all output
//  ✅ YouTube links go to actual videos (via YOUTUBE_API_KEY)
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

const FREE_DAILY_LIMIT    = 5;    // Free plan
const WONDER_DAILY_LIMIT  = 25;   // Wonder Knox
const SUPER_DAILY_LIMIT   = 40;   // Pro Knox (super)
const MAX_DAILY_LIMIT     = Infinity; // Max Knox
const FREE_CASUAL_LIMIT   = 20;
const WONDER_CASUAL_LIMIT = 50;
const WINDOW_MS           = 24 * 60 * 60 * 1000;
const ADMIN_EMAIL        = process.env.ADMIN_EMAIL || "";
const VIP_PRO_EMAILS     = (process.env.VIP_PRO_EMAILS || "")
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
  ].join(" ").toLowerCase();

  if (/visual learner|learn visually|i'?m? a? ?visual|prefer videos?|visual (person|style|way)|show me visually|show me (a )?(diagram|chart|graph|picture|image|video)|can you (draw|diagram|visualize|show)|i (like|love|prefer|learn better with) (videos?|diagrams?|pictures?|images?|charts?|visuals?)|help me (see|visualize|picture)|watch videos?|diagram (this|it|that)|draw (this|it|that)|picture this|seeing it|see (how|it|this)|watching|graphically|in a visual/i.test(texts)) return "visual";
  if (/word person|verbal learner|descriptive words?|long (passage|explanation)|prefer (text|reading|words)|detailed prose|i (like|love|prefer|learn better with) (reading|text|words?|writing|essays?)|just (explain|tell|write|describe)|no (videos?|diagrams?|pictures?)|text only|in words|write it out/i.test(texts)) return "verbal";
  return null;
}

// ── Check if the question is asking for visual/diagram content ────────────
function asksForVisualContent(question) {
  return /diagram|chart|graph|visual(ly|ize|ise|ization|isation|ly| way| style| form| learner| learning)?|show me|draw|picture this|video|image|in a visual|visually|explain.*visual|visual.*explain|illustrat/i.test(question);
}

// ── True if message only states a preference, asks no academic question ──
function isPreferenceOnly(question) {
  const q = question.trim();
  const hasIntent = /\?|what|how|why|when|where|who|explain|solve|help me|tell me|calculate|find|define|describe|summarize|analyze/i.test(q);
  const isPref    = /\b(i'?m? (a )?(visual|word|verbal) (learner|person)|i (learn|prefer) (visually|through words|via videos?)|my (learning style|preference) is)/i.test(q);
  return isPref && !hasIntent && q.length < 200;
}

// ── True if message is casual chat, not a real school problem ────────────
function isCasualChat(question) {
  const q = question.trim().toLowerCase();

  // Always casual: pure greetings / reactions / identity questions
  if (/^(hey|hi|hello|sup|yo+|heyy+|what'?s? up|how are you|how'?s? it going|good morning|good afternoon|good night|thanks|thank you|thx|cool|nice|ok|okay|lol|lmao|haha|who are you|what are you|what'?s? your name|are you (ai|real|a fox|a bot)|you'?re? (cool|awesome|great|smart|amazing|the best)|i (love|like) (you|this|knox)|that'?s? (cool|awesome|crazy|wild|insane)|no way|for real|seriously|bro|dude|omg|wait what|🦊)[.!?]?$/.test(q)) return true;

  // ALWAYS homework — never casual, even if phrased casually or visually
  const definitelyHomework = /\b(solve|calculate|what is \d|simplify|factor|derive|integrate|differentiate|prove that|find the (value|area|volume|angle|slope|distance|derivative|integral|solution|answer|equation)|write (an? )?(essay|paragraph|thesis|summary|analysis)|explain (how|why|what|the (process|concept|theory|formula|law|rule|difference))|what (causes?|is the (formula|definition|law|rule|theorem|equation|process|difference|meaning))|how (does|do|did|can|should|would)|why (does|do|did|is|are|was|were)|when (did|was|were|is|are)|who (was|is|were|are|invented|discovered|wrote|created)|define |describe (the|how|why)|what are (the|some)|step[- ]by[- ]step|solve for|in the equation|in (chemistry|physics|biology|math|history|english|science|economics|calculus|algebra|geometry|literature)|ap (exam|class|test|course)|sat |act |gre |gmat |lsat |teach me|show me how|help me (understand|learn|study|write|solve|figure)|in a visual way|visually|in a (simple|easy|fun|creative|different) way|like i('?m| am) (5|a kid|a beginner|new|dumb)|break (it|this|that) down|walk me through|explain (it|this|that)|can you explain|how do (i|you)|what('?s| is) (a|an|the) \w+\??$)\b/i.test(q);
  if (definitelyHomework) return false;

  // Homework mentioned casually = still casual
  const homeworkCasual = /\b(hate|love|like|dislike|have|got|so much|too much|lots of|a lot of|my|this|the) homework\b/i.test(q) && !definitelyHomework;
  if (homeworkCasual) return true;

  // Has any real question structure = homework
  const hasRealQuestion = /\b(explain|solve|calculate|define|describe|summarize|analyze|write|find|prove|teach|show|evaluate|compare|contrast|what is the (formula|law|theorem|rule|definition|meaning|difference|equation)|how (does|do|did|can) (the|a|an|it|this|that)|why (is|are|was|were|does|do|did)|what (is|are|was|were) (a|an|the)|tell me about|what happens|how (it|this) works)\b/i.test(q);

  return !hasRealQuestion && q.length < 120;
}

// ── Week start helper (Monday-based) ─────────────────────────────────────
function getWeekStart() {
  const d = new Date();
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().split('T')[0]; // e.g. "2026-04-27"
}

// ── Award KP + update streak ──────────────────────────────────────────────
async function awardKP(db, uid, kpAmount, casual) {
  if (!uid || kpAmount <= 0) return { kp: 0, streak: 1, totalKP: 0 };
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const weekStart = getWeekStart();
  const gamRef    = db.collection('gamification').doc(uid);

  try {
    const snap = await gamRef.get();
    const gd   = snap.exists ? snap.data() : {};

    // Streak logic
    const lastDate  = gd.lastActiveDate || '';
    let newStreak   = 1;
    let streakBonus = 0;
    if (lastDate === today) {
      newStreak = gd.streak || 1;
    } else if (lastDate === yesterday) {
      newStreak   = (gd.streak || 0) + 1;
      streakBonus = newStreak >= 30 ? 30 : newStreak >= 7 ? 15 : newStreak >= 3 ? 5 : 0;
    } else {
      newStreak = 1;
    }

    const earned    = kpAmount + streakBonus;
    const totalKP   = (gd.totalKP   || 0) + earned;
    const weeklyKP  = (gd.weekStart === weekStart) ? (gd.weeklyKP || 0) + earned : earned;

    await gamRef.set({
      streak:         newStreak,
      lastActiveDate: today,
      totalKP,
      weeklyKP,
      weekStart,
      uid,
      updatedAt:      Date.now(),
    }, { merge: true });

    return { kp: earned, streak: newStreak, totalKP, weeklyKP, streakBonus };
  } catch(e) {
    console.warn('awardKP error:', e.message);
    return { kp: 0, streak: 1, totalKP: 0 };
  }
}


function parseResources(text) {
  let resources = [];
  let answer    = text;

  // Ensure Resources: always starts on its own paragraph
  answer = answer.replace(/([^\n])(Resources:)/g, "$1\n\nResources:");

  const match = answer.match(/\n?Resources:\s*\n([\s\S]*?)(?=\n\n[^\-\*\n]|$)/);
  if (match) {
    const lines = match[1].split("\n").map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      // YouTube only — Quizlet removed
      const ytMd    = line.match(/^[-*]?\s*YouTube:\s*\[([^\]]+)\]\((https?:[^)]+)\)/i);
      const ytPlain = line.match(/^[-*]?\s*YouTube:\s*(.+)/i);

      if (ytMd) {
        resources.push({ type: "youtube", title: ytMd[1].trim(), link: ytMd[2].trim() });
      } else if (ytPlain) {
        const raw   = ytPlain[1].trim();
        const title = raw.replace(/\[([^\]]+)\]\([^)]+\)/, "$1").replace(/^\[|\]$/g, "").trim();
        const urlM  = raw.match(/\((https?:[^)]+)\)/);
        const link  = urlM ? urlM[1] : `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`;
        resources.push({ type: "youtube", title, link });
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
      .replace(/\*+/g,           "")   // strip any orphaned asterisks
      .replace(/_{2,}/g,         "")   // strip any orphaned underlines
      .replace(/^(Step-by-step:|Step-by-Step:|Step-by-Step Process:|Tip:|Insight:|Deeper Insight:|Common Mistake:|Key Points:|Key Point:|Resources:)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else {
    // For pro/pro+ — strip orphaned markers that didn't form valid pairs
    answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    // Clean up any double-asterisks that are empty or orphaned
    answer = answer.replace(/\*\*\s*\*\*/g, "");
    answer = answer.replace(/(?<!\w)\*\*(?!\w)/g, "");
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
    userPlan = "max";
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

  // 3. Rolling 24hr usage limits
  const now = Date.now();
  const usageRef = db.collection("usage").doc(uid);

  // Limits per plan — wonder/super/max + legacy pro/pro_plus
  const hwLimit     = (userPlan === "max")                           ? Infinity
                    : (userPlan === "super"  || userPlan === "pro_plus") ? SUPER_DAILY_LIMIT
                    : (userPlan === "wonder" || userPlan === "pro")      ? WONDER_DAILY_LIMIT
                    : FREE_DAILY_LIMIT;
  const casualLimit = (userPlan === "max" || userPlan === "super" || userPlan === "pro_plus") ? Infinity
                    : (userPlan === "wonder" || userPlan === "pro")      ? WONDER_CASUAL_LIMIT
                    : FREE_CASUAL_LIMIT;

  // Skip limits for admin
  const isAdmin = (userEmail === ADMIN_EMAIL);

  // Detect casual before limit check so we can apply the right bucket
  const { question: rawQ, imageBase64, imageType, history, learnMode, isStuck, showMe, gradeLevel, isCorrectAnswer } = req.body;
  const preCheckQuestion = (rawQ || "").trim();
  const preCheckCasual   = isCasualChat(preCheckQuestion) && !imageBase64;

  if (!isAdmin) {
    try {
      const snap    = await usageRef.get();
      const data    = snap.exists ? snap.data() : {};
      const hwTimes = (data.hwTimes     || []).filter(t => now - t < WINDOW_MS);
      const csTimes = (data.casualTimes || []).filter(t => now - t < WINDOW_MS);

      if (preCheckCasual) {
        // Casual message limit check
        if (casualLimit !== Infinity && csTimes.length >= casualLimit) {
          const oldest    = Math.min(...csTimes);
          const unlockMs  = WINDOW_MS - (now - oldest);
          const unlockMin = Math.ceil(unlockMs / 60000);
          const hrs = Math.floor(unlockMin / 60);
          const min = unlockMin % 60;
          const countdown = hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
          return res.status(429).json({
            error:     "casual_limit",
            countdown,
            limit:     casualLimit,
            used:      csTimes.length,
            nextUnlock: oldest + WINDOW_MS,
          });
        }
        // Record casual message
        await usageRef.set({
          casualTimes: [...csTimes, now],
          hwTimes,
          uid, email: userEmail,
          updatedAt: now,
        }, { merge: true });
      } else {
        // Homework question limit check
        if (hwTimes.length >= hwLimit) {
          const oldest    = Math.min(...hwTimes);
          const unlockMs  = WINDOW_MS - (now - oldest);
          const unlockMin = Math.ceil(unlockMs / 60000);
          const hrs = Math.floor(unlockMin / 60);
          const min = unlockMin % 60;
          const countdown = hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
          return res.status(429).json({
            error:     "limit_reached",
            countdown,
            limit:     hwLimit,
            used:      hwTimes.length,
            nextUnlock: oldest + WINDOW_MS,
          });
        }
        // Record homework question
        await usageRef.set({
          hwTimes: [...hwTimes, now],
          casualTimes: csTimes,
          uid, email: userEmail,
          updatedAt: now,
        }, { merge: true });
      }
    } catch (err) {
      console.error("Usage tracking error:", err.message);
    }
  }

  // 4. Use already-parsed body variables
  const question   = rawQ;
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

  let trimmedQuestion = (question || "").trim().slice(0, 4000);
  const safeHistory   = Array.isArray(history) ? history.slice(-6) : [];
  const hasHistory    = safeHistory.length > 0;

  // If Pro or Pro+ user states a learning preference AND there's prior history,
  // auto re-ask the last question so the AI re-explains it with the new style.
  // Free plan does NOT get this — visual learning is a paid feature.
  const isJustPreference = isPreferenceOnly(trimmedQuestion);
  if (isJustPreference && hasHistory && !hasImage && (isPaidMid || isPaidTop)) {
    const lastUserMsg  = [...safeHistory].reverse().find(m => m.role === "user");
    const lastQuestion = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content.replace(/^Question:\s*/i, "").trim()
      : null;
    if (lastQuestion) {
      trimmedQuestion = `${trimmedQuestion}. Please re-explain your last answer about: ${lastQuestion}`;
    }
  }

  // 5. Detect learning style — Pro+ uses full detection, Pro only checks current question
  const wantsVisual  = asksForVisualContent(trimmedQuestion);
  const learningStyle = isPaidTop
    ? detectLearningStyle(safeHistory, trimmedQuestion)
    : (isPaidMid && wantsVisual ? "visual" : null);

  // prefOnly only applies to Pro+ with no history
  const prefOnly = isPaidTop && !hasImage && !hasHistory && isJustPreference;

  // 6. Build learning style instructions
  let learningStyleInstructions = "";

  if (prefOnly) {
    // Pro+ no-history acknowledgment
    learningStyleInstructions = `
PREFERENCE STATEMENT DETECTED: The user is expressing a learning preference with no prior conversation.
- Respond with ONLY a warm, friendly 1-2 sentence acknowledgment. Do NOT use Final Answer: format.
- Example: "Perfect! I'll include visual explanations, diagrams, and clear visual analogies in all my explanations to help you learn best."`;
  } else if (learningStyle === "visual" || wantsVisual) {
    // Visual — applies to Pro AND Pro+
    learningStyleInstructions = `
LEARNING STYLE — VISUAL LEARNER:
- Use vivid visual analogies throughout ("imagine this as...", "picture this like...", "think of it as...").
- Describe spatial relationships and what a diagram of this would look like.
- Keep each paragraph short and visual — one clear image per paragraph.
- If re-explaining a previous topic, re-explain it fully using this visual style.
- The system will show relevant diagrams and videos alongside your response.`;
  } else if (learningStyle === "verbal") {
    // Verbal — Pro+ only
    learningStyleInstructions = `
LEARNING STYLE — VERBAL / WORD LEARNER:
- Write in rich, flowing, highly descriptive prose. Use vivid literary analogies and narrative language.
- Expand explanations with nuanced detail and context. Make it feel like a well-written essay.
- Use full, eloquent sentences. Avoid bullet points where prose works better.`;
  }

  let planInstructions = "";
  if (userPlan === "free") {
    planInstructions = `=== PLAN: FREE ===
This is a real school question. Answer it directly and concisely.

USE EXACTLY THESE TWO HEADERS — NO OTHERS:
Final Answer: [One clear, direct sentence answering the question]
Explanation: [2-3 sentences explaining how or why. Plain prose only — no lists, no bullets.]

STRICT RULES:
- Start your response with "Final Answer:" — always, no exceptions
- ONLY use "Final Answer:" and "Explanation:" headers — zero others
- No bold, no asterisks, no underlines, no numbered lists, no bullet points, no markdown
- Your ENTIRE response must be 100 words or fewer — be concise and direct`;

  } else if (userPlan === "wonder" || userPlan === "pro") {
    planInstructions = `=== PLAN: WONDER KNOX ===
Give thorough, clear explanations. Use step-by-step breakdowns when the question needs them.

USE THESE HEADERS IN THIS ORDER (only include what applies):
Final Answer: [One clear sentence — the direct answer]
Explanation: [2-3 solid paragraphs. Explain the concept thoroughly. Show real understanding of why it works.]
Step-by-step: [ONLY for math calculations, science processes, or questions needing sequential steps]
  1. [Specific step — show real numbers, real values, actual work]
  2. [Next step]
  3. [Continue until complete]
Tip: [ONE genuinely useful shortcut, trick, or insight — only if it truly helps]

STRICT RULES:
- ALWAYS include "Final Answer:" and "Explanation:"
- ONLY include "Step-by-step:" when the question genuinely needs sequential steps
- NEVER include: Insight, Common Mistake, Key Points, Resources
- Bold 2-4 key terms using **term** format
- NEVER repeat a section — write each section ONCE only
- NEVER use alternative header names like "Step-by-Step Process:", "Steps:", "Solution:", "Work:", "Method:"
- If not academic: "Hey, I'm Knox — I live for homework and school stuff! Ask me anything academic and I've got you 🦊"`;

  } else if (userPlan === "super" || userPlan === "pro_plus" || userPlan === "max") {
    planInstructions = `=== PLAN: PRO KNOX / MAX KNOX ===
Give the deepest, most complete academic explanations possible. You are a world-class tutor.

USE THESE HEADERS IN THIS ORDER (include sections that genuinely add value):
Final Answer: [One clear sentence — the direct answer]
Explanation: [3-4 rich paragraphs. Go deep. Explain the WHY, the nuance, the real understanding. Connect concepts.]
Step-by-step: [For math, science, or any sequential process — show ALL work with real numbers and values]
  1. [Specific step with actual values/numbers]
  2. [Next step — show the work]
  3. [Continue until completely solved]
Tip: [ONE high-value shortcut, pattern, or memory trick that genuinely helps]
Insight: [A deeper connection, surprising fact, or bigger-picture context — only for complex topics]
Common Mistake: [The single most common error students make on this exact topic — one sentence]
Key Points:
  - [Key point 1 — one sentence]
  - [Key point 2 — one sentence]
  - [Key point 3 — one sentence]
  (3-6 bullets maximum)
Resources:
  - YouTube: [Specific descriptive video title for this exact topic]

STRICT RULES:
- ALWAYS include "Final Answer:" and "Explanation:"
- Only include optional sections when they genuinely add value — do NOT force all sections
- Skip Resources for simple calculations or basic definitions
- Bold key terms using **term**, underline the single most important concept using __phrase__
- NEVER repeat a section — write each section ONCE only
- NEVER use alternative header names — use EXACTLY the headers shown above
- If not academic: "Hey, I'm Knox — I live for homework and school stuff! Ask me anything academic and I've got you 🦊"`;
  }

  // ── Grade level detection ─────────────────────────────────────────────────
  function detectGradeLevel(hist, q) {
    const text = [...(hist||[]).map(m=>m.content||''), q].join(' ');
    if (/calculus|derivative|integral|linear algebra|differential|multivariable|ap calc|ap physics c|quantum|thermodynamics|organic chem/i.test(text)) return 'college';
    if (/pre.?calc|trigonometry|ap |sat |act |honors|physics|chemistry|algebra 2|statistics|macroeconomics/i.test(text)) return 'high';
    if (/algebra|geometry|biology|earth science|civics|world history|us history|middle school/i.test(text)) return 'middle';
    if (/multiplication|division|fractions|decimals|addition|subtraction|spelling|elementary/i.test(text)) return 'elementary';
    return 'high';
  }
  const inferredGrade = gradeLevel || detectGradeLevel(safeHistory, trimmedQuestion);
  const isPaidUser = userPlan !== 'free';

  // ── Socratic prompt (Learn with Knox) ────────────────────────────────────
  let socraticPrompt = null;
  if (learnMode) {
    const gradeMap = {
      elementary: 'Talk like a kind teacher to a 3rd-5th grader. Super simple words, lots of encouragement.',
      middle:     'Clear friendly language, relate to everyday life. Think 6th-8th grade student.',
      high:       'Use subject terms but explain them. High school level — capable but still learning.',
      college:    'Treat as a peer. Precise academic language. Expect rigorous thinking.',
    };
    const gradeHint = gradeMap[inferredGrade] || gradeMap.high;

    if (isStuck) {
      socraticPrompt = `You are Knox — a Socratic tutor. The student is stuck. Convert your last guiding question into 4 multiple choice options.

FORMAT — use EXACTLY this structure, nothing else:
MULTIPLE_CHOICE
Question: [The guiding question restated clearly]
A) [Plausible option]
B) [Plausible option]
C) [Plausible option]
D) [Plausible option]
ANSWER: [correct letter only, e.g. B]
HINT: [One warm sentence hinting toward the answer without giving it away]

RULES: Shuffle the correct answer position randomly. Make wrong options plausible. Keep options concise.
Grade level: ${gradeHint}`;

    } else if (showMe && isPaidUser) {
      socraticPrompt = `You are Knox — a Socratic tutor. The student asked to see a similar problem solved.

FORMAT — use EXACTLY this structure:
SHOW_ME
Similar Problem: [A comparable problem with different numbers/context but same concept]
Step-by-step solution:
1. [Step with clear work shown]
2. [Next step]
3. [Continue to completion]
Now try yours: [One sentence encouraging them back to their original problem]

RULES: DIFFERENT problem, same skill. Show ALL work. No shortcuts. End with encouragement.
Grade level: ${gradeHint}`;

    } else {
      const phase = safeHistory.length === 0 ? 'DIAGNOSE — first message, identify what they need help with'
        : safeHistory.length <= 2 ? 'OPEN QUESTION — ask one question to test their baseline understanding'
        : safeHistory.length <= 6 ? 'SCAFFOLD — guide step by step, one hint at a time, never give the answer'
        : 'CONFIRM or QUICK CHECK — if correct celebrate and ask a reinforcement question, if wrong gently redirect';

      socraticPrompt = `You are Knox — a warm clever Socratic tutor. You NEVER give the answer directly.

CURRENT PHASE: ${phase}

THE LOOP: Diagnose → Ask one opening question → Scaffold step by step → Let them arrive → Confirm → Quick Check

CRITICAL RULES:
- NEVER write the answer. Not even partially. Not as an example.
- Ask ONE question at a time. Never stack questions.
- Keep responses SHORT — 2-4 sentences max. This is a conversation not a lecture.
- Be warm. When they get it right, celebrate genuinely.
- When wrong, never say "wrong" — say "almost!" or "not quite — think about..."
- Sound like Knox: smart friend texting them, not a textbook.
- NO section headers (Final Answer:, Explanation: etc.) — pure conversation only.
Grade level: ${gradeHint}`;
    }
  }

  // Detect if this is casual chat vs homework question
  const casual = learnMode ? false : isCasualChat(trimmedQuestion) && !hasImage;

  const systemPrompt = learnMode ? socraticPrompt : `You are Knox — a clever, warm, enthusiastic orange fox and the heart of Knox Knows. You are a real character with personality. Students talk to you like a friend, and you talk back like one too.

YOUR PERSONALITY:
- You're that one friend who's somehow great at every subject — but you're not cocky about it, you just love helping
- Warm, real, a little witty. You keep it short and punchy when you're just chatting
- You get genuinely excited about cool topics — let that show naturally
- You care if students actually get it, not just if they copied the answer
- Fox energy: quick, sharp, always a step ahead — but humble about it
- You remember you're talking to a real student who might be stressed, confused, or just vibing

YOUR VOICE:
- Casual, natural sentences. Like texting. Real words.
- Short when the moment is short. Deep when the question needs depth.
- Light humor when it fits — nothing forced
- Never robotic. Never stiff. Never "I'd be happy to help you with that!"
- Banned forever: "Certainly!", "Of course!", "Great question!", "Absolutely!", "I'd be happy to"

YOUR NAME & IDENTITY:
- You are Knox. A fox. Full stop.
- Part of Knox Knows — the app where students come to actually understand stuff
- If someone asks if you're AI: "I'm Knox — fox by day, tutor by always. Does it matter? I've got your homework covered 🦊"

TWO MODES — READ THIS CAREFULLY:

MODE 1 — CASUAL CHAT (when someone is just talking, greeting, or not asking a real school problem):
${casual ? `THIS MESSAGE IS CASUAL CHAT. Rules:
- Do NOT use any section headers. Do NOT start with "Final Answer:". 
- Talk like you're texting a friend — natural, warm, short.
- 1-4 sentences max. Be Knox the fox, not a homework bot.
- Use 🦊 occasionally but not every message.
- If they mention homework casually (like "ugh i have so much homework"), just vibe with them — maybe ask what subject or offer to help.
- This is the same experience for everyone — Free, Pro, Pro+ — all get Knox at his best for casual chat.` : `THIS IS A REAL SCHOOL QUESTION. Use the structured format below.`}

MODE 2 — HOMEWORK QUESTIONS (any actual academic question):
Use the structured sections defined in your plan below. But keep your Knox voice throughout — even technical explanations should feel like they're coming from a sharp friend, not a textbook.

SUBJECTS: Math | Science | History | English | CS | Economics | Psychology | Languages | Law | Test prep | Philosophy | Any academic subject

${planInstructions}
${learningStyleInstructions}

UNIVERSAL RULES:
1. ${casual ? 'THIS IS CASUAL — do NOT use Final Answer: or any headers. Just talk.' : 'ALWAYS start with "Final Answer:" — even if you need more info, write Final Answer: I need a bit more to help you — [your question], then Explanation: with the detail'}
2. Keep your Knox voice in everything you write
3. Steps need real numbers and actual work — never be vague
4. Number steps: 1. thing  2. thing  (never "Step 1:" format)
5. No LaTeX, no markdown headers (##), no dollar signs around math
6. Scale length to what the question needs
7. For images: read every detail carefully and solve exactly what's shown
8. ${casual ? 'Keep it short and conversational — this is a text not an essay' : 'Use ONLY the section headers from your plan — no variations'}
9. Sound like Knox. Always.`;

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

  // 8. Pick model and token limit
  // Casual chat: everyone gets gpt-4o with 800 tokens — same quality for all plans
  // Homework: plan-based model and token limits apply
  const isPaidTop = userPlan === "max"   || userPlan === "super"  || userPlan === "pro_plus";
  const isPaidMid = userPlan === "wonder" || userPlan === "pro";
  const model = hasImage   ? "gpt-4o" :
    learnMode              ? "gpt-4o" :
    casual                 ? "gpt-4o" :
    isPaidTop              ? "gpt-4.1" :
    isPaidMid              ? "gpt-4.1-mini" :
                             "gpt-4o-mini";

  const maxTokens = learnMode ? 400 :
    casual    ? 800 :
    isPaidTop ? 2800 :
    isPaidMid ? 2000 :
                350;

  // 9. Call OpenAI Chat Completions API
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ model, messages, max_tokens: maxTokens }),
    });

    const data = await openaiRes.json();

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

    // 10. Extract search topic from Final Answer for accurate video/image searches
    const searchTopic = extractSearchTopic(rawAnswer) ||
      trimmedQuestion.replace(/\b(visual learner|im a visual|show me|can you|please|help me|diagram|draw|visualize|in a visual way|visually)\b/gi, '').trim();

    let embeddedVideo    = null;
    let imageSearchQuery = null;

    // Visual content — Pro+ only (Pro gets visual style in text but not embedded video/images)
    if (isPaidTop && !prefOnly) {
      // Upgrade any YouTube resource search URLs to real video links
      for (let i = 0; i < resources.length; i++) {
        if (resources[i].type === "youtube" && resources[i].link.includes("youtube.com/results")) {
          const vid = await searchYouTubeVideo(resources[i].title);
          if (vid) resources[i].link = vid.url;
        }
      }
      // Show embedded video + image search when visual style is active
      if (learningStyle === "visual" || wantsVisual) {
        imageSearchQuery = searchTopic;
        embeddedVideo    = await searchYouTubeVideo(searchTopic);
      }
    }

    // Get current usage counts + nextUnlock for frontend progress bar
    let hwUsed = 0, csUsed = 0, hwNextUnlock = null, csNextUnlock = null;
    try {
      const snap  = await usageRef.get();
      const udata = snap.exists ? snap.data() : {};
      const hwTimes2 = (udata.hwTimes     || []).filter(t => now - t < WINDOW_MS);
      const csTimes2 = (udata.casualTimes || []).filter(t => now - t < WINDOW_MS);
      hwUsed = hwTimes2.length;
      csUsed = csTimes2.length;
      // nextUnlock = when the oldest entry in the window expires
      if (hwTimes2.length > 0) hwNextUnlock = Math.min(...hwTimes2) + WINDOW_MS;
      if (csTimes2.length > 0) csNextUnlock = Math.min(...csTimes2) + WINDOW_MS;
    } catch(e) {}

    // ── Award KP + update streak ──────────────────────────────────────────────
    let gamResult = { kp: 0, streak: 1, totalKP: 0, weeklyKP: 0, streakBonus: 0 };
    if (uid && !prefOnly) {
      // KP amounts: casual=1, Learn correct=20, Learn attempt=5, Get the Answer=3
      let kpBase = casual ? 1 : (learnMode && isCorrectAnswer) ? 20 : learnMode ? 5 : 3;
      gamResult = await awardKP(db, uid, kpBase, casual);
    }

    return res.status(200).json({
      answer,
      resources,
      plan:              userPlan,
      learningStyle,
      isAcknowledgement: prefOnly || casual,
      isCasual:          casual,
      isLearnMode:       !!learnMode,
      isStuck:           !!isStuck,
      isShowMe:          !!showMe,
      inferredGrade:     inferredGrade || 'high',
      canShowMe:         isPaidUser,
      embeddedVideo,
      imageSearchQuery,
      videos: [],
      usage: {
        hw:          hwUsed,
        hwLimit,
        casual:      csUsed,
        casualLimit: casualLimit === Infinity ? null : casualLimit,
        nextUnlock:  hwNextUnlock,
        csNextUnlock: csNextUnlock,
      },
      gamification: {
        kpEarned:    gamResult.kp,
        streak:      gamResult.streak,
        totalKP:     gamResult.totalKP,
        weeklyKP:    gamResult.weeklyKP,
        streakBonus: gamResult.streakBonus,
      },
    });

  } catch (err) {
    console.error("SERVER ERROR:", err);
    // Return a friendly error message rather than a raw 500 so the frontend can display it nicely
    return res.status(500).json({ error: "Knox hit a snag — please try again in a moment. If this keeps happening, try refreshing the page." });
  }
}
