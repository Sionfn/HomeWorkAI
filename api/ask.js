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
- Give clear, well-structured explanations with real reasoning
- For math: show every step and briefly explain what is happening
- For concepts: break the explanation into short focused paragraphs — one idea per paragraph
- Add a Tip only if it genuinely helps — skip it otherwise
- Never write long dense paragraphs. Keep each paragraph to 2-3 sentences max.`;

    } else if (userPlan === "pro_plus") {
      planInstructions = `QUALITY LEVEL: Pro+ (expert professor level)
- Teach with deep understanding — give the real insight, not just the surface answer
- For math: full step-by-step with reasoning after, then Insight if it adds genuine value
- For concepts: short focused paragraphs (2-3 sentences each), one idea per paragraph
- Add "Insight:" ONLY when there is something genuinely important to add — a key nuance, common mistake, or deeper connection. Skip it for simple questions.
- Add a Tip only if it is a high-value mental model or shortcut — not a restatement
- Never write walls of text. Keep it sharp, structured, and brilliant.`;

    } else {
      planInstructions = `QUALITY LEVEL: Free (basic helper)
- Give the correct answer with minimal explanation
- For math: key steps only, no commentary
- For concepts: 1-3 short sentences maximum
- Do NOT add Tip, Insight, or extra sections
- Be concise — this is the free tier`;
    }

    // ── YouTube titles (Pro+ only) ────────────────────────────────────────
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nIf the topic genuinely warrants it, add a "Videos:" section at the very end with 1-2 relevant YouTube video titles. Format:\nTitle: [descriptive title]\nTitles only — no URLs. Skip entirely for simple questions.`
      : "";

    // ── Core system prompt ────────────────────────────────────────────────
    const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic → calculus, stats) | Science (biology, chemistry, physics) | History | English & writing | Economics | Law | Psychology | Computer science | Any academic topic

${planInstructions}

RESPONSE FORMAT — follow this structure, using only what is needed:

Final Answer: [One direct sentence. The answer, nothing else.]

[Then choose the right format for the question type:]

For PROBLEM-SOLVING (math, equations, calculations):
Step-by-step:
1. [Show the actual operation with real numbers — e.g. "Subtract 5: 2x + 5 - 5 = 15 - 5, so 2x = 10"]
2. [Next step — only continue if genuinely needed]
3. [Keep going only as long as the problem requires]

For CONCEPTUAL questions (history, science concepts, economics, law, literature):
[Write short focused paragraphs. Each paragraph = one idea. 2-3 sentences per paragraph. Leave a blank line between paragraphs. DO NOT write one long essay block.]

For COMPLEX or MIXED questions:
[Use Step-by-step first, then a short explanation paragraph if helpful.]

Optional sections — only include if they add real value:
Key Points: (bullet list — use only for complex answers with multiple distinct facts)
- [point]
- [point]
Tip: [One sentence. A useful shortcut or pattern. Skip if you have nothing genuinely helpful to say.]
Insight: [One short paragraph. A deeper nuance, common mistake, or connection. Pro+ only, and only when truly valuable.]

STRICT RULES:
1. NEVER write one long paragraph. Break ideas into small, scannable chunks.
2. Steps must show REAL work:
   BAD: "Set up the equation" | GOOD: "Subtract 5 from both sides: 2x = 10"
   BAD: "Think about the causes" | GOOD: "The assassination of Franz Ferdinand on June 28, 1914 triggered alliance obligations, pulling 8 countries into war"
3. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand
4. Scale length to complexity: simple question = short answer. Do not over-explain.
5. Subject rules:
   - Math: every arithmetic step shown with actual numbers
   - Science: explain the mechanism, not just the name
   - History: specific dates, people, causes, effects
   - English: technique + effect, supported by text
   - Economics: connect to real incentives and behavior
   - Law/Psychology: principle + real-world example
6. Plain text ONLY — no LaTeX, no markdown (no **, no ##, no $ signs)
7. Non-academic question: reply only "I'm here to help with homework and studying. Try asking me a subject question!"
8. Write like a confident, brilliant tutor — not a chatbot, not an essay writer.${youtubeInstruction}`;

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

