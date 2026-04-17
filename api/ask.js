export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, plan } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const userPlan = plan || "free";

    // ─────────────────────────────────────────────
    // PLAN INSTRUCTIONS
    // Hard rules per plan. No probability logic.
    // ─────────────────────────────────────────────

    let planInstructions = "";

    if (userPlan === "free") {
      planInstructions = `PLAN: Free

ALLOWED SECTIONS — only these two, nothing else:
1. Final Answer (always)
2. One short explanation: 1–2 sentences max. Explain the core idea simply.

STRICTLY FORBIDDEN — never include any of these on the Free plan:
- Step-by-step
- Tip
- Insight
- Common Mistake
- Key Points
- Resources
- Any extra section or label

FORMATTING: Plain text only. No bold (**), no underline (__).

Keep it short and correct. That is all.`;

    } else if (userPlan === "pro") {
      planInstructions = `PLAN: Pro

ALLOWED SECTIONS — include only when they genuinely help:
1. Final Answer (always)
2. Explanation — explain the WHY in 2–3 short paragraphs. One idea per paragraph, 2–3 sentences max.
3. Step-by-step — ONLY for math, calculations, or multi-step processes. Show real operations with actual numbers. Never vague.
4. Tip — ONLY if there is a genuinely useful shortcut or memory trick. Skip if nothing valuable to add.

STRICTLY FORBIDDEN — never include any of these on the Pro plan:
- Insight
- Common Mistake
- Resources

FORMATTING: Bold (**word**) allowed for key terms — use selectively, 2–4 highlights max. No underline (__).

Write like a clear, confident tutor. Match depth to the question.`;

    } else if (userPlan === "pro_plus") {
      planInstructions = `PLAN: Pro+

ALLOWED SECTIONS — include only when they genuinely help the student:
1. Final Answer (always)
2. Explanation — 2–4 short paragraphs. Explain underlying principles and real-world meaning. One idea per paragraph, 2–3 sentences max.
3. Step-by-step — ONLY for math, calculations, or multi-step processes. Show real operations with actual numbers.
4. Tip — ONLY if there is a high-value shortcut or mental model. Skip if nothing genuinely useful.
5. Insight — ONLY for complex topics where there is a deeper nuance or connection students often miss. One short paragraph. Skip for simple questions.
6. Common Mistake — ONLY when there is one specific, common error students make on this exact topic. One sentence. Skip if not clearly applicable.
7. Resources — ONLY for topics that genuinely benefit from further study. Skip for simple questions or pure calculations. See format below.

Do NOT force all sections into every response. Only include sections that add real value.

FORMATTING: Bold (**word**) for key terms. Underline (__phrase__) for the single most important concept. Use both selectively.

RESOURCES FORMAT (only add at the very end when genuinely useful):
Resources:
- YouTube: [Specific descriptive video title matching the exact topic]
- Quizlet: [Relevant study set name matching the topic]

Rules:
- YouTube title must be specific enough to find the right video (e.g. "Mitosis vs Meiosis step by step" not just "cell division")
- Quizlet name should match a real study topic (e.g. "AP Biology Chapter 12 Cell Division Flashcards")
- Include 1 YouTube and 1 Quizlet when both are relevant. Include just one if only one fits.
- Skip Resources entirely for math calculations, simple factual questions, or anything that doesn't benefit from video or flashcard study.

Write like a top-tier professor. Teach deeply but concisely.`;
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

    // Model per plan
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
        model,
        instructions: systemPrompt,
        input: `Question: ${question}`
      })
    });

    const data = await response.json();

    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray && contentArray.length > 0) {
        rawAnswer = contentArray.map(c => c.text || "").join("");
      }
    } catch (e) { console.log("Parse error:", data); }

    // Strip LaTeX and markdown artifacts
    let answer = rawAnswer
      .replace(/\\\[[\s\S]*?\\\]/g, "")
      .replace(/\\\([\s\S]*?\\\)/g, "")
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/^#{1,6}\s/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Strip formatting for Free plan (hard enforcement)
    if (userPlan === "free") {
      answer = answer
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        // Strip any section headers the AI might try to sneak in
        .replace(/^(Step-by-step:|Tip:|Insight:|Common Mistake:|Key Points:|Resources:).*$/gim, "")
        .replace(/^\d+\.\s.+$/gm, "") // strip numbered steps
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else {
      // Strip single asterisks (italic) but keep double (bold)
      answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    }

    // ─────────────────────────────────────────────
    // PARSE RESOURCES SECTION (Pro+ only)
    // Returns structured { type, title, link } objects.
    // ─────────────────────────────────────────────
    let resources = [];

    if (userPlan === "pro_plus") {
      const resourcesMatch = answer.match(/Resources:\n([\s\S]*?)(?=\n\n|$)/);
      if (resourcesMatch) {
        const block = resourcesMatch[1];
        const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

        for (const line of lines) {
          const ytMatch = line.match(/^[-*]?\s*YouTube:\s*(.+)/i);
          const qlMatch = line.match(/^[-*]?\s*Quizlet:\s*(.+)/i);

          if (ytMatch) {
            const title = ytMatch[1].trim();
            resources.push({
              type: "youtube",
              title,
              link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(title)
            });
          } else if (qlMatch) {
            const title = qlMatch[1].trim();
            resources.push({
              type: "quizlet",
              title,
              link: "https://quizlet.com/search?query=" + encodeURIComponent(title) + "&type=sets"
            });
          }
        }

        // Remove the Resources block from the main answer
        answer = answer.replace(/Resources:\n[\s\S]*?(?=\n\n|$)/, "").trim();
      }
    }

    // Legacy: send empty videos array so old frontend code doesn't break
    return res.status(200).json({ answer, resources, videos: [] });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}


