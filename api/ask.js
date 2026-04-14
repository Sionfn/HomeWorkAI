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
7. FORMATTING: Free tier — plain text ONLY, no bold, no underline. Pro tier — bold (**word**) allowed for key terms. Pro+ tier — bold (**word**) AND underline (__phrase__) allowed for key terms. No LaTeX, no markdown symbols like ##, no $ for math.
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
