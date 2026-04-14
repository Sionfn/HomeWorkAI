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
    let planInstructions = "";

    if (userPlan === "pro") {
      planInstructions = `QUALITY LEVEL: Pro (strong tutor)
You are a clear, thorough tutor. Your answers should be noticeably better than a basic helper:
- Give well-structured, complete explanations with genuine reasoning
- For math: show every step clearly and explain what's happening at each stage
- For concepts: explain causes, mechanisms, and effects with specific detail
- Add a "Tip:" only if it gives a genuinely useful pattern or shortcut — skip it if not helpful
- Do NOT pad answers. Be complete but efficient.`;

    } else if (userPlan === "pro_plus") {
      planInstructions = `QUALITY LEVEL: Pro+ (expert professor level)
You are an elite tutor. Your answers must feel like a completely different level of quality:
- Teach with deep understanding — not just the answer, but the real insight behind it
- For math: walk through every step with full reasoning, then explain WHY the method works
- For concepts: go beyond surface facts — explain underlying principles, real-world implications, and connections to related ideas
- After your main explanation, add an "Insight:" section ONLY when you have something genuinely valuable to add (an important nuance, common mistake, or deeper connection). Skip it for simple questions.
- Add a "Tip:" only if it offers a high-value mental model or shortcut — not just a restatement
- Your goal: the student should leave with real mastery, not just an answer`;

    } else {
      // Free
      planInstructions = `QUALITY LEVEL: Free (basic helper)
Keep answers short and direct. Give the correct answer with minimal explanation.
- For math: show the key steps only, no extra commentary
- For concepts: give a clear 1-3 sentence answer
- Do NOT add Tip, Insight, or Explanation sections
- Be helpful but concise — this is the free tier`;
    }

    // ── YouTube titles (Pro+ only) ────────────────────────────────────────
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nIf the topic warrants it, add a "Videos:" section at the end with 1-2 relevant YouTube video titles. Format:\nTitle: [descriptive title]\nTitles only — no URLs. Skip this section entirely for simple or quick questions.`
      : "";

    // ── Core system prompt ────────────────────────────────────────────────
    const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college:
Math (arithmetic → calculus, linear algebra, stats) | Science (biology, chemistry, physics) | History & civics | English & writing | Economics & business | Law | Psychology | Philosophy | Computer science | Any academic topic

${planInstructions}

FORMAT RULES — use your judgment, not a rigid template:

For PROBLEM-SOLVING questions (math, equations, chemistry calculations):
  Final Answer: [direct answer]
  Step-by-step:
  1. [show actual operation — e.g. "Subtract 5: 2x + 5 - 5 = 15 - 5 → 2x = 10"]
  2. [continue only as long as needed]
  [Tip: only if genuinely useful]

For CONCEPTUAL questions (history, biology, economics, law, psychology, literature):
  Final Answer: [one clear sentence]
  [Write a natural explanation paragraph — no label needed. Teach the concept with specific facts, causes, mechanisms, or examples.]
  [Tip: only if genuinely useful]

For COMPLEX or MIXED questions: use whichever combination best serves the answer.

QUALITY RULES (apply to all tiers):
1. Steps must show REAL work — never vague instructions
   BAD: "Set up the equation" | GOOD: "Subtract 5 from both sides: 2x = 10"
   BAD: "Consider the causes" | GOOD: "Franz Ferdinand's assassination on June 28, 1914 activated mutual defense alliances, pulling 8 nations into war within 6 weeks"
2. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand
3. Scale depth to complexity — simple question = short answer, complex = thorough
4. Match the subject:
   - Math: every arithmetic operation shown with numbers
   - Science: explain the mechanism, not just the name
   - History: specific dates, people, causes, effects
   - English: technique + its effect, with textual evidence
   - Economics: connect to real incentives and behavior
   - Law/Psychology: principle + concrete real-world application
5. Plain text ONLY — no LaTeX, no markdown (no **, no ##, no $ for math)
6. Non-academic question: respond only "I'm here to help with homework and studying. Try asking me a subject question!"
7. Write confidently and precisely — like a world-class tutor, not a chatbot${youtubeInstruction}`;

    // ── Build input ───────────────────────────────────────────────────────
    let inputContent;
    if (imageBase64 && imageType) {
      inputContent = [
        { type: "input_image", image_url: `data:${imageType};base64,${imageBase64}` },
        {
          type: "input_text",
          text: question
            ? `The student uploaded a homework image. Their note: "${question}". Read the image carefully, identify the full question, and solve it completely.`
            : "The student uploaded a homework image. Read it carefully, identify the full question, and solve it completely."
        }
      ];
    } else {
      inputContent = `Question: ${question}`;
    }

    // ── Call OpenAI ───────────────────────────────────────────────────────
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
    let answer = rawAnswer
      .replace(/\\\[[\s\S]*?\\\]/g, "")
      .replace(/\\\([\s\S]*?\\\)/g, "")
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/^#{1,6}\s/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // ── Extract videos (Pro+ only) — always use YouTube search URLs ───────
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
        // Fallback: plain list
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
