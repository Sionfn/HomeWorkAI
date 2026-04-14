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
      planInstructions = `QUALITY LEVEL: Pro (clear tutor)
After the Final Answer, write an Explanation section. Rules:
- 2-3 short paragraphs. Each paragraph is one clear idea. 2-3 sentences each.
- Explain the WHY — not just what happened, but why it works or why it matters.
- Teach clearly, like you're explaining to a smart student who wants to understand.
- For math: after the steps, explain the logic behind the method.
- For concepts: explain causes, mechanisms, real-world meaning.
- Add a Tip only if it is genuinely useful. Skip it if not.
- Keep paragraphs short. Never write a wall of text.`;

    } else if (userPlan === "pro_plus") {
      planInstructions = `QUALITY LEVEL: Pro+ (expert professor level)
After the Final Answer, write an Explanation section. Rules:
- 2-4 short paragraphs. Each paragraph is one focused idea. 2-3 sentences each.
- Go deeper than surface facts. Explain underlying principles, real-world implications, or important connections.
- For math: explain the full reasoning, then add why the method works at a conceptual level.
- For concepts: break down causes, mechanisms, and significance with specific detail.
- After Explanation, add "Insight:" ONLY if there is something genuinely valuable — a key nuance, a common mistake, or a deeper connection students miss. One short paragraph. Skip for simple questions.
- Add a Tip only if it is a high-value shortcut or mental model. Skip if nothing valuable to add.
- Keep each paragraph short and sharp. Never write walls of text. Quality over quantity.`;

    } else {
      planInstructions = `QUALITY LEVEL: Free (basic helper)
After the Final Answer:
- Write 1-2 short sentences that explain the core idea simply.
- For math: show the key steps only.
- For concepts: one simple explanation sentence, then optionally one example.
- Do NOT add Tip, Insight, Key Points, or extra sections.
- Be helpful but concise.`;
    }

    // ── YouTube titles (Pro+ only) ────────────────────────────────────────
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nIf the topic genuinely warrants it, add a "Videos:" section at the very end with 1-2 relevant YouTube video titles. Format:\nTitle: [descriptive title]\nTitles only — no URLs. Skip entirely for simple questions.`
      : "";

    // ── Core system prompt ────────────────────────────────────────────────
    const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic → calculus, stats) | Science (biology, chemistry, physics) | History | English & writing | Economics | Law | Psychology | Computer science | Any academic topic

${planInstructions}

RESPONSE FORMAT — always use this structure:

Final Answer: [One direct sentence. The answer only — no explanation here.]

[For PROBLEM-SOLVING — math, equations, calculations:]
Step-by-step:
1. [Show actual operation with real numbers — e.g. "Subtract 5 from both sides: 2x + 5 - 5 = 15 - 5, so 2x = 10"]
2. [Continue only as long as genuinely needed]

Explanation:
[Short paragraphs — one idea each. Teach the WHY behind the steps or concept.]

[For CONCEPTUAL questions — history, science, economics, law, literature:]
Explanation:
[Short paragraphs — one idea each. Teach the concept with causes, mechanisms, examples, or significance.]

Optional — include only when genuinely useful:
Key Points:
- [bullet — one specific fact or idea per line]
- [keep to 3-5 bullets maximum]
Tip: [One sentence. A real shortcut, pattern, or memory trick. Skip if nothing valuable.]
Insight: [One short paragraph. A deeper nuance or connection. Pro+ only, skip for simple questions.]

STRICT RULES:
1. ALWAYS write an Explanation section (except for the very simplest one-line answers on Free tier).
2. NEVER write one long paragraph. Every paragraph = one idea, 2-3 sentences max.
3. Steps must show REAL work — never vague:
   BAD: "Set up the equation" | GOOD: "Subtract 5 from both sides: 2x = 10"
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
7. Plain text ONLY — no LaTeX, no markdown symbols (no **, no ##, no $ for math)
8. Non-academic question: reply only "I'm here to help with homework and studying. Try asking me a subject question!"
9. Write like a confident, intelligent tutor — not a chatbot, not an essay.${youtubeInstruction}`;

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
