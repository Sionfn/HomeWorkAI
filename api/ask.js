// ============================================================
// /api/ask.js  —  Knox Knows  (FULLY FIXED VERSION)
// ============================================================
// BUGS FIXED:
//  ✅ isMaxPlan no longer includes "super" — plans are now truly different
//  ✅ isPaid now correctly covers super + max (old "wonder/pro" refs removed)
//  ✅ isPaid/isMaxPlan declared BEFORE first use (no more ReferenceError risk)
//  ✅ isSessionEnd declared at handler scope (no more undefined reference)
//  ✅ awardKP called exactly ONCE (was called twice = double KP bug)
//  ✅ parseResources gated to Max Knox only (Super was getting Resources)
//  ✅ Visual embed/imageSearch gated to Max Knox only
//  ✅ Correct models: free=gpt-4o-mini, super=gpt-4.1-mini, max=gpt-4.1
//  ✅ Correct tokens: free=350, super=1500, max=2800
// ============================================================
// PLAN STRUCTURE:
//   Basic Knox (free)   — gpt-4o-mini, 350 tok,  Final Answer + Explanation only
//   Super Knox ($9.99)  — gpt-4.1-mini, 1500 tok, + Step-by-step + Tip
//   Max Knox ($19.99)   — gpt-4.1,     2800 tok,  ALL sections + Resources + Visual
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

const FREE_DAILY_LIMIT   = 5;
const SUPER_DAILY_LIMIT  = 25;
const WINDOW_MS          = 24 * 60 * 60 * 1000;
const SESSION_STEP_LIMIT = 12;
const ADMIN_EMAIL        = process.env.ADMIN_EMAIL || "";
const VIP_EMAILS         = (process.env.VIP_PRO_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

// ── Helpers ───────────────────────────────────────────────────────────────

function extractSearchTopic(rawAnswer) {
  const match = rawAnswer.match(/Final Answer:\s*(.+?)(?:\n|$)/i);
  if (!match) return null;
  const stop = new Set(['the','and','for','are','this','that','with','from','they','have','been','which','when','where','what','into','also','some','more','than','then','there','their','these','those','would','could','should','about','after','before','during','between','through','because','however','therefore','although','whereas','both','each','only','just','even','very','most','much','many','such','like','will','can','may','might','must','shall','does','did','has','had','was','were','not','but','how','why','its','all','by','of','to','in','is','a','an']);
  const words = match[1].trim().replace(/[^a-zA-Z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=3&&!stop.has(w.toLowerCase())).slice(0,5);
  return words.length > 0 ? words.join(' ') : null;
}

async function searchYouTubeVideo(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  try {
    const url  = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query+" explained")}&type=video&maxResults=1&key=${apiKey}&relevanceLanguage=en&safeSearch=strict`;
    const r    = await fetch(url);
    const data = await r.json();
    const item = data.items?.[0];
    if (item?.id?.videoId) return {
      videoId: item.id.videoId, title: item.snippet.title, channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}?rel=0&modestbranding=1`,
    };
  } catch(e) { console.error("YouTube API error:", e.message); }
  return null;
}

function detectLearningStyle(history, question) {
  const texts = [...history.slice(-6).map(m=>typeof m.content==="string"?m.content:""), question].join(" ").toLowerCase();
  if (/visual learner|learn visually|i'?m? a? ?visual|prefer videos?|visual (person|style|way)|show me visually|show me (a )?(diagram|chart|graph|picture|image|video)|can you (draw|diagram|visualize|show)|i (like|love|prefer|learn better with) (videos?|diagrams?|pictures?|images?|charts?|visuals?)|help me (see|visualize|picture)|watch videos?|diagram (this|it|that)|draw (this|it|that)|picture this|seeing it|see (how|it|this)|watching|graphically|in a visual/i.test(texts)) return "visual";
  if (/word person|verbal learner|descriptive words?|long (passage|explanation)|prefer (text|reading|words)|detailed prose|i (like|love|prefer|learn better with) (reading|text|words?|writing|essays?)|just (explain|tell|write|describe)|no (videos?|diagrams?|pictures?)|text only|in words|write it out/i.test(texts)) return "verbal";
  return null;
}

function asksForVisualContent(q) {
  return /diagram|chart|graph|visual(ly|ize|ise|ization|isation|ly| way| style| form| learner| learning)?|show me|draw|picture this|video|image|in a visual|visually|explain.*visual|visual.*explain|illustrat/i.test(q);
}

function isPreferenceOnly(question) {
  const q = question.trim();
  return /\b(i'?m? (a )?(visual|word|verbal) (learner|person)|i (learn|prefer) (visually|through words|via videos?)|my (learning style|preference) is)\b/i.test(q)
    && !/\?|what|how|why|when|where|who|explain|solve|help me|tell me|calculate|find|define|describe|summarize|analyze/i.test(q)
    && q.length < 200;
}

function isCasualChat(question) {
  const q = question.trim().toLowerCase();
  if (/^(hey|hi|hello|sup|yo+|heyy+|what'?s? up|how are you|how'?s? it going|good morning|good afternoon|good night|thanks|thank you|thx|cool|nice|ok|okay|lol|lmao|haha|who are you|what are you|what'?s? your name|are you (ai|real|a fox|a bot)|you'?re? (cool|awesome|great|smart|amazing|the best)|i (love|like) (you|this|knox)|that'?s? (cool|awesome|crazy|wild|insane)|no way|for real|seriously|bro|dude|omg|wait what|🦊)[.!?]?$/.test(q)) return true;
  const hw = /\b(solve|calculate|what is \d|simplify|factor|derive|integrate|differentiate|prove that|find the (value|area|volume|angle|slope|distance|derivative|integral|solution|answer|equation)|write (an? )?(essay|paragraph|thesis|summary|analysis)|explain (how|why|what|the (process|concept|theory|formula|law|rule|difference))|what (causes?|is the (formula|definition|law|rule|theorem|equation|process|difference|meaning))|how (does|do|did|can|should|would)|why (does|do|did|is|are|was|were)|when (did|was|were|is|are)|who (was|is|were|are|invented|discovered|wrote|created)|define |describe (the|how|why)|what are (the|some)|step[- ]by[- ]step|solve for|in the equation|in (chemistry|physics|biology|math|history|english|science|economics|calculus|algebra|geometry|literature)|ap (exam|class|test|course)|sat |act |gre |gmat |lsat |teach me|show me how|help me (understand|learn|study|write|solve|figure)|break (it|this|that) down|walk me through|explain (it|this|that)|can you explain|how do (i|you)|what('?s| is) (a|an|the) \w+\??$)\b/i.test(q);
  if (hw) return false;
  if (/\b(hate|love|like|dislike|have|got|so much|too much|lots of|a lot of|my|this|the) homework\b/i.test(q)&&!hw) return true;
  return !/\b(explain|solve|calculate|define|describe|summarize|analyze|write|find|prove|teach|show|evaluate|compare|contrast|what is the (formula|law|theorem|rule|definition|meaning|difference|equation)|how (does|do|did|can) (the|a|an|it|this|that)|why (is|are|was|were|does|do|did)|what (is|are|was|were) (a|an|the)|tell me about|what happens|how (it|this) works)\b/i.test(q) && q.length < 120;
}

function getWeekStart() {
  const d=new Date(), day=d.getUTCDay(), diff=d.getUTCDate()-day+(day===0?-6:1);
  d.setUTCDate(diff); return d.toISOString().split('T')[0];
}

async function awardKP(db, uid, kpAmount, casual) {
  if (!uid||kpAmount<=0) return {kp:0,streak:1,totalKP:0,weeklyKP:0,streakBonus:0};
  const today=new Date().toISOString().split('T')[0];
  const yesterday=new Date(Date.now()-86400000).toISOString().split('T')[0];
  const weekStart=getWeekStart();
  const gamRef=db.collection('gamification').doc(uid);
  try {
    const snap=await gamRef.get(), gd=snap.exists?snap.data():{};
    const lastDate=gd.lastActiveDate||'';
    let newStreak=1,streakBonus=0;
    if (lastDate===today) { newStreak=gd.streak||1; }
    else if (lastDate===yesterday) { newStreak=(gd.streak||0)+1; streakBonus=newStreak>=30?30:newStreak>=7?15:newStreak>=3?5:0; }
    const earned=(kpAmount+streakBonus);
    const totalKP=(gd.totalKP||0)+earned;
    const weeklyKP=(gd.weekStart===weekStart)?(gd.weeklyKP||0)+earned:earned;
    await gamRef.set({streak:newStreak,lastActiveDate:today,totalKP,weeklyKP,weekStart,uid,updatedAt:Date.now()},{merge:true});
    return {kp:earned,streak:newStreak,totalKP,weeklyKP,streakBonus};
  } catch(e) { console.warn('awardKP error:',e.message); return {kp:0,streak:1,totalKP:0,weeklyKP:0,streakBonus:0}; }
}

// Max Knox only — parses and removes Resources block from answer text
function parseResources(text) {
  let resources=[], answer=text;
  answer=answer.replace(/([^\n])(Resources:)/g,"$1\n\nResources:");
  const match=answer.match(/\n?Resources:\s*\n([\s\S]*?)(?=\n\n[^\-\*\n]|$)/);
  if (match) {
    for (const line of match[1].split("\n").map(l=>l.trim()).filter(Boolean)) {
      const ytMd=line.match(/^[-*]?\s*YouTube:\s*\[([^\]]+)\]\((https?:[^)]+)\)/i);
      const ytPl=line.match(/^[-*]?\s*YouTube:\s*(.+)/i);
      if (ytMd) resources.push({type:"youtube",title:ytMd[1].trim(),link:ytMd[2].trim()});
      else if (ytPl) {
        const raw=ytPl[1].trim(), title=raw.replace(/\[([^\]]+)\]\([^)]+\)/,"$1").replace(/^\[|\]$/g,"").trim();
        const urlM=raw.match(/\((https?:[^)]+)\)/);
        resources.push({type:"youtube",title,link:urlM?urlM[1]:`https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`});
      }
    }
    answer=answer.replace(/\n?Resources:\s*\n[\s\S]*?(?=\n\n[^\-\*\n]|$)/,"").trim();
  }
  answer=answer.replace(/\[([^\]]+)\]\(https?:[^)]+\)/g,"$1");
  return {answer,resources};
}

function processAnswer(rawText, plan) {
  let answer=rawText
    .replace(/\\\[[\s\S]*?\\\]/g,"").replace(/\\\([\s\S]*?\\\)/g,"")
    .replace(/\$\$[\s\S]*?\$\$/g,"").replace(/\$([^$]+)\$/g,"$1")
    .replace(/^#{1,6}\s/gm,"").replace(/\n{3,}/g,"\n\n").trim();
  ['Final Answer:','Explanation:','Step-by-step:','Step-by-Step:','Tip:','Insight:','Common Mistake:','Key Points:','Resources:'].forEach(h=>{
    const esc=h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    answer=answer.replace(new RegExp('([^\\n])\\s*('+esc+')','g'),'$1\n\n$2');
  });
  answer=answer.replace(/([.!?])\s+(\d+\.\s)/g,'$1\n$2').replace(/([.!?])\s+(Step\s+\d+[:.])/gi,'$1\n$2');
  if (plan==="free") {
    answer=answer.replace(/\*\*(.*?)\*\*/g,"$1").replace(/\*(.*?)\*/g,"$1").replace(/__(.*?)__/g,"$1")
      .replace(/\*+/g,"").replace(/_{2,}/g,"")
      .replace(/^(Step-by-step:|Step-by-Step:|Tip:|Insight:|Common Mistake:|Key Points:|Resources:)\s*$/gim,"")
      .replace(/\n{3,}/g,"\n\n").trim();
  }
  return answer;
}

function detectGradeLevel(hist,q) {
  const text=[...(hist||[]).map(m=>m.content||''),q].join(' ');
  if (/calculus|derivative|integral|linear algebra|differential|multivariable|ap calc|ap physics c|quantum|thermodynamics|organic chem/i.test(text)) return 'college';
  if (/pre.?calc|trigonometry|ap |sat |act |honors|physics|chemistry|algebra 2|statistics|macroeconomics/i.test(text)) return 'high';
  if (/algebra|geometry|biology|earth science|civics|world history|us history|middle school/i.test(text)) return 'middle';
  if (/multiplication|division|fractions|decimals|addition|subtraction|spelling|elementary/i.test(text)) return 'elementary';
  return 'high';
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method!=="POST") return res.status(405).json({error:"Method not allowed"});

  // Auth
  const authHeader=req.headers.authorization||"";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
  let decodedToken;
  try { decodedToken=await adminAuth.verifyIdToken(authHeader.slice(7)); }
  catch(err) { return res.status(401).json({error:"Unauthorized — invalid or expired token."}); }
  const {uid,email:userEmail}=decodedToken;
  if (!userEmail) return res.status(401).json({error:"Unauthorized — token has no email."});

  // Plan resolution
  let userPlan="free";
  const isAdmin=(userEmail===ADMIN_EMAIL);
  if (isAdmin) userPlan="max";
  else if (VIP_EMAILS.includes(userEmail)) userPlan="super";
  else {
    try { const doc=await db.collection("users").doc(uid).get(); if(doc.exists) userPlan=doc.data()?.plan||"free"; }
    catch(err) { console.warn("Firestore plan lookup failed:",err.message); }
  }

  // ── Plan flags — declared immediately, before ANY use ────────────────────
  // FIXED: "super" is no longer in isMaxPlan. Each plan is genuinely different.
  const isMaxPlan = userPlan === "max";
  const isSuper   = userPlan === "super";
  const isPaid    = isSuper || isMaxPlan;

  // Request body
  const {question:rawQ,imageBase64,imageType,history,learnMode,isStuck,showMe,
         gradeLevel,isCorrectAnswer,sessionId,isNewSession,isSessionComplete}=req.body;

  if (imageBase64&&imageType) {
    if (!["image/jpeg","image/jpg","image/png","image/gif","image/webp"].includes(imageType.toLowerCase()))
      return res.status(400).json({error:"Invalid image type. Please upload a JPEG, PNG, GIF, or WebP image."});
    if (imageBase64.length*0.75>5*1024*1024)
      return res.status(400).json({error:"Image is too large. Please upload an image under 5MB."});
  }

  const hasImage       = !!(imageBase64&&imageType);
  const preCheckQ      = (rawQ||"").trim();
  if (!preCheckQ&&!hasImage) return res.status(400).json({error:"No question provided."});

  const preCheckCasual = isCasualChat(preCheckQ)&&!hasImage;
  const casual         = learnMode ? false : preCheckCasual;
  const safeHistory    = Array.isArray(history)?history.slice(-6):[];
  const hasHistory     = safeHistory.length>0;
  let trimmedQuestion  = preCheckQ.slice(0,4000);

  // Usage limits
  const now=Date.now(), usageRef=db.collection("usage").doc(uid);
  const dailyLimit=isMaxPlan?Infinity:isSuper?SUPER_DAILY_LIMIT:FREE_DAILY_LIMIT;

  // isSessionEnd at handler scope so it's available everywhere below
  const stepCount    = safeHistory.length;
  const isSessionEnd = learnMode && (stepCount>=SESSION_STEP_LIMIT);

  const isLearnComplete  =learnMode&&(isSessionComplete||false);
  const isGetAnswer      =!learnMode&&!casual;
  const shouldCheckLimit =!casual&&!isAdmin;
  const shouldRecordUsage=!casual&&!isAdmin&&(isGetAnswer||isLearnComplete);

  let currentTimes=[];
  if (shouldCheckLimit) {
    try {
      const snap=await usageRef.get(), data=snap.exists?snap.data():{};
      currentTimes=(data.times||[]).filter(t=>now-t<WINDOW_MS);
      const atLimit=dailyLimit!==Infinity&&currentTimes.length>=dailyLimit;
      if ((shouldRecordUsage&&atLimit)||(learnMode&&isNewSession&&atLimit)) {
        const oldest=Math.min(...currentTimes), unlockMs=WINDOW_MS-(now-oldest);
        const hrs=Math.floor(unlockMs/3600000),min=Math.floor((unlockMs%3600000)/60000),sec=Math.floor((unlockMs%60000)/1000);
        return res.status(429).json({error:"limit_reached",countdown:hrs>0?`${hrs}h ${min}m ${sec}s`:min>0?`${min}m ${sec}s`:`${sec}s`,limit:dailyLimit,used:currentTimes.length,nextUnlock:oldest+WINDOW_MS});
      }
    } catch(err) { console.error("Usage check error:",err.message); }
  }

  // Learning style
  const isJustPreference=isPreferenceOnly(trimmedQuestion);
  if (isJustPreference&&hasHistory&&!hasImage&&isPaid) {
    const lastUserMsg=[...safeHistory].reverse().find(m=>m.role==="user");
    const lastQ=typeof lastUserMsg?.content==="string"?lastUserMsg.content.replace(/^Question:\s*/i,"").trim():null;
    if (lastQ) trimmedQuestion=`${trimmedQuestion}. Please re-explain your last answer about: ${lastQ}`;
  }

  const wantsVisual   =asksForVisualContent(trimmedQuestion);
  const learningStyle =isMaxPlan?detectLearningStyle(safeHistory,trimmedQuestion):(isPaid&&wantsVisual?"visual":null);
  const prefOnly      =isMaxPlan&&!hasImage&&!hasHistory&&isJustPreference;

  let learningStyleInstructions="";
  if (prefOnly) {
    learningStyleInstructions=`\nPREFERENCE DETECTED: Respond with ONLY a warm 1-2 sentence acknowledgment. Do NOT use Final Answer: format.`;
  } else if (learningStyle==="visual"||wantsVisual) {
    learningStyleInstructions=`\nLEARNING STYLE — VISUAL:\n- Use vivid visual analogies throughout ("imagine this as...", "picture this like...")\n- Describe spatial relationships and what a diagram would look like\n- Keep each paragraph short and visual — one clear image per paragraph\n- The system will show relevant diagrams and videos alongside your response.`;
  } else if (learningStyle==="verbal") {
    learningStyleInstructions=`\nLEARNING STYLE — VERBAL:\n- Write in rich, flowing, descriptive prose. Literary analogies and narrative language.\n- Expand with nuanced detail and context. Full, eloquent sentences.`;
  }

  // Plan instructions
  let planInstructions="";
  if (userPlan==="free") {
    planInstructions=`=== BASIC KNOX (FREE) ===\nAnswer directly and concisely.\n\nUSE EXACTLY THESE TWO HEADERS — NO OTHERS:\nFinal Answer: [One clear, direct sentence]\nExplanation: [2-3 sentences explaining how or why. Plain prose — no lists, no bullets.]\n\nRULES: Always start with "Final Answer:". No bold, no asterisks, no markdown. 100 words max.`;
  } else if (isSuper) {
    planInstructions=`=== SUPER KNOX ($9.99) ===\nGive thorough, clear explanations with step-by-step breakdowns when needed.\n\nUSE THESE HEADERS IN ORDER (only include what applies):\nFinal Answer: [One clear sentence]\nExplanation: [2-3 solid paragraphs. Explain the concept thoroughly.]\nStep-by-step: [ONLY for math, science, or sequential problems]\n  1. [Step with real numbers and actual work]\n  2. [Next step]\nTip: [ONE genuinely useful shortcut or trick — only if it truly helps]\n\nRULES: Always include "Final Answer:" and "Explanation:". NEVER include: Insight, Common Mistake, Key Points, Resources. Bold 2-4 key terms with **term**.`;
  } else {
    planInstructions=`=== MAX KNOX ($19.99) ===\nGive the deepest, most complete academic explanations possible. World-class tutor.\n\nUSE THESE HEADERS IN ORDER (include sections that genuinely add value):\nFinal Answer: [One clear sentence]\nExplanation: [3-4 rich paragraphs. Go deep. Explain WHY, nuance, real understanding.]\nStep-by-step: [For math, science, or any sequential process — show ALL work]\n  1. [Specific step with actual values]\n  2. [Show the work]\nTip: [ONE high-value shortcut or memory trick]\nInsight: [Deeper connection or bigger-picture context — only for complex topics]\nCommon Mistake: [The most common error students make on this topic — one sentence]\nKey Points:\n  - [Key point 1]\n  - [Key point 2]\n  - [Key point 3]\n  (3-6 bullets max)\nResources:\n  - YouTube: [Specific video title for this exact topic]\n\nRULES: Always include "Final Answer:" and "Explanation:". Only include optional sections when they genuinely add value. Skip Resources for simple calculations. Bold key terms **term**, underline most important concept __phrase__.`;
  }

  // Socratic prompt
  const inferredGrade=gradeLevel||detectGradeLevel(safeHistory,trimmedQuestion);
  let socraticPrompt=null;
  if (learnMode) {
    const gradeMap={elementary:'Simple words, lots of encouragement. 3rd-5th grade.',middle:'Clear friendly language. 6th-8th grade.',high:'Use subject terms but explain them. High school.',college:'Treat as a peer. Precise academic language.'};
    const gradeHint=gradeMap[inferredGrade]||gradeMap.high;
    if (isStuck) {
      socraticPrompt=`You are Knox — a Socratic tutor. Student is stuck. Convert your last guiding question into 4 multiple choice options.\n\nFORMAT:\nMULTIPLE_CHOICE\nQuestion: [Guiding question restated]\nA) [Option]\nB) [Option]\nC) [Option]\nD) [Option]\nANSWER: [correct letter]\nHINT: [One warm hint sentence]\n\nGrade level: ${gradeHint}`;
    } else if (showMe&&isPaid) {
      socraticPrompt=`You are Knox — a Socratic tutor. Student wants to see a similar problem solved.\n\nFORMAT:\nSHOW_ME\nSimilar Problem: [Different numbers, same concept]\nStep-by-step solution:\n1. [Step with work shown]\n2. [Next step]\nNow try yours: [Encouragement back to their problem]\n\nGrade level: ${gradeHint}`;
    } else {
      const phase=stepCount===0?'DIAGNOSE':stepCount<=2?'OPEN QUESTION':stepCount<=8?'SCAFFOLD':stepCount<=11?'FINAL PUSH':'SESSION END';
      socraticPrompt=`You are Knox — a warm clever Socratic tutor. NEVER give the answer directly.\n\nPHASE: ${phase}${isSessionEnd?'\n⚠️ SESSION END: Wrap up warmly. Summarize concept. Do NOT give answer.':''}\n\nRULES:\n- NEVER write the answer\n- ONE question at a time\n- 2-4 sentences max\n- When they get it right: celebrate, confirm, then write SESSION_COMPLETE on its own line\n- When wrong: "almost!" or "not quite — think about..."\n- Sound like Knox — smart friend texting, not a textbook\n- NO section headers\n\nGrade: ${gradeHint}`;
    }
  }

  // System prompt
  const systemPrompt=learnMode?socraticPrompt:`You are Knox — a clever, warm, enthusiastic orange fox and the heart of Knox Knows.\n\nPERSONALITY:\n- That friend who's great at every subject — not cocky, just loves helping\n- Warm, real, a little witty. Short and punchy when chatting. Deep when needed.\n- Genuinely excited about cool topics\n- NEVER: "Certainly!", "Of course!", "Great question!", "Absolutely!", "I'd be happy to"\n- You are Knox. A fox. Full stop.\n\n${casual?`CASUAL CHAT MODE:\n- NO section headers. NO "Final Answer:".\n- 1-4 sentences. Text like a friend. Same for all plans.`:`HOMEWORK MODE:\nUSE THE STRUCTURED FORMAT FOR YOUR PLAN BELOW.`}\n\n${planInstructions}\n${learningStyleInstructions}\n\nUNIVERSAL RULES:\n1. ${casual?'CASUAL — no headers, just talk':'ALWAYS start with "Final Answer:"'}\n2. Keep Knox voice throughout\n3. Steps = real numbers and actual work\n4. Number steps: 1. 2. 3. (never "Step 1:" format)\n5. No LaTeX, no ## headers, no $ around math\n6. For images: read carefully and solve exactly what's shown\n7. Sound like Knox. Always.`;

  // Messages
  const messages=[{role:"system",content:systemPrompt}];
  safeHistory.forEach(m=>{if(m.role&&m.content)messages.push({role:m.role,content:m.content});});
  if (hasImage) {
    messages.push({role:"user",content:[{type:"image_url",image_url:{url:`data:${imageType};base64,${imageBase64}`,detail:"high"}},{type:"text",text:trimmedQuestion||"Please read this image and solve the homework problem shown."}]});
  } else {
    messages.push({role:"user",content:`Question: ${trimmedQuestion}`});
  }

  // Model and tokens — FIXED: super genuinely different from max
  const model=hasImage?"gpt-4o":casual?"gpt-4o-mini":learnMode?"gpt-4o":isMaxPlan?"gpt-4.1":isSuper?"gpt-4.1-mini":"gpt-4o-mini";
  const maxTokens=learnMode?500:casual?600:isMaxPlan?2800:isSuper?1500:350;

  try {
    const openaiRes=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model,messages,max_tokens:maxTokens}),
    });
    const data=await openaiRes.json();
    if (!openaiRes.ok) { console.error("OpenAI error:",JSON.stringify(data)); throw new Error(data.error?.message||"OpenAI error"); }

    let rawAnswer=data.choices?.[0]?.message?.content||"No response";

    // SESSION_COMPLETE detection
    const sessionCompleted=learnMode&&rawAnswer.includes('SESSION_COMPLETE');
    if (sessionCompleted) rawAnswer=rawAnswer.replace(/\nSESSION_COMPLETE\n?/g,'').trim();

    // Record session-completion credit
    if (!shouldRecordUsage&&learnMode&&(sessionCompleted||isSessionEnd)) {
      try {
        const snap3=await usageRef.get(),data3=snap3.exists?snap3.data():{};
        const times3=(data3.times||[]).filter(t=>now-t<WINDOW_MS);
        if (dailyLimit===Infinity||times3.length<dailyLimit) {
          await usageRef.set({times:[...times3,now],uid,email:userEmail,updatedAt:now},{merge:true});
          currentTimes=[...times3,now];
        }
      } catch(e){}
    }

    // Process and parse
    const processed=processAnswer(rawAnswer,userPlan);
    // parseResources — Max Knox ONLY
    let answer=processed, resources=[];
    if (isMaxPlan) ({answer,resources}=parseResources(processed));

    // Visual content — Max Knox ONLY
    const searchTopic=extractSearchTopic(rawAnswer)||trimmedQuestion.slice(0,100);
    let embeddedVideo=null, imageSearchQuery=null;
    if (isMaxPlan&&!prefOnly) {
      for (let i=0;i<resources.length;i++) {
        if (resources[i].type==="youtube"&&resources[i].link.includes("youtube.com/results")) {
          const vid=await searchYouTubeVideo(resources[i].title);
          if (vid) resources[i].link=vid.url;
        }
      }
      if (learningStyle==="visual"||wantsVisual) {
        imageSearchQuery=searchTopic;
        embeddedVideo=await searchYouTubeVideo(searchTopic);
      }
    }

    // Record Get the Answer usage
    if (shouldRecordUsage) {
      try {
        const snap2=await usageRef.get(),data2=snap2.exists?snap2.data():{};
        const times2=(data2.times||[]).filter(t=>now-t<WINDOW_MS);
        await usageRef.set({times:[...times2,now],uid,email:userEmail,updatedAt:now},{merge:true});
        currentTimes=[...times2,now];
      } catch(e){console.error("Usage record error:",e.message);}
    }

    // Final usage count
    let totalUsed=currentTimes.length, nextUnlockTs=null;
    try {
      if (currentTimes.length===0) {
        const snap=await usageRef.get(),udata=snap.exists?snap.data():{};
        currentTimes=(udata.times||[]).filter(t=>now-t<WINDOW_MS);
        totalUsed=currentTimes.length;
      }
      if (currentTimes.length>0) nextUnlockTs=Math.min(...currentTimes)+WINDOW_MS;
    } catch(e){}

    // Award KP — ONCE only (previously called twice — bug fixed)
    let gamResult={kp:0,streak:1,totalKP:0,weeklyKP:0,streakBonus:0};
    if (uid&&!prefOnly) {
      const kpBase=casual?1:(learnMode&&sessionCompleted)?20:learnMode?2:3;
      gamResult=await awardKP(db,uid,kpBase,casual);
    }

    return res.status(200).json({
      answer, resources, plan:userPlan, learningStyle,
      isAcknowledgement:prefOnly||casual, isCasual:casual,
      isLearnMode:!!learnMode, isStuck:!!isStuck, isShowMe:!!showMe,
      sessionCompleted:!!sessionCompleted, isSessionEnd:!!isSessionEnd,
      inferredGrade:inferredGrade||'high', canShowMe:isPaid,
      embeddedVideo, imageSearchQuery, videos:[],
      usage:{used:totalUsed,limit:dailyLimit===Infinity?null:dailyLimit,nextUnlock:nextUnlockTs,isLearnSession:!!learnMode,sessionSteps:stepCount,sessionLimit:SESSION_STEP_LIMIT},
      gamification:{kpEarned:gamResult.kp,streak:gamResult.streak,totalKP:gamResult.totalKP,weeklyKP:gamResult.weeklyKP,streakBonus:gamResult.streakBonus},
    });

  } catch(err) {
    console.error("SERVER ERROR:",err);
    return res.status(500).json({error:"Knox hit a snag — please try again in a moment. If this keeps happening, try refreshing the page."});
  }
}
