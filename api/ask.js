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
- Connect the topic to its broader curriculum context — mention which course level, exam (SAT/ACT/AP), or real-world field this applies to when relevant.
- For math: explain the full reasoning, then add why the method works at a conceptual level. Bold key numbers and underline the core method name.
- For concepts: break down causes, mechanisms, and significance with specific detail. Underline the single most important idea.
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
- Do NOT use bold (**) or underline (__) formatting.
- Be helpful but concise.`;
    }

    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nPro+ exclusive: If the topic genuinely warrants a video (complex concept, visual process, or deep subject), add a "Videos:" section at the very end with 1-2 relevant YouTube video titles. Format:\nTitle: [descriptive title]\nTitles only — no URLs. Skip entirely for simple or short questions. Quality over quantity.`
      : "";

    const resourcesInstruction = userPlan === "pro_plus"
      ? `\n\nPro+ exclusive study resources: Decide if the topic would genuinely benefit from extra study resources (Khan Academy, Quizlet, or Brainly). Use your judgment — only include resources if they would meaningfully help the student learn more. For conceptual topics, history, science, or math theory: include relevant ones. For simple one-step calculations or trivial questions: skip entirely.\n\nIf useful, add a "Resources:" section at the very end (after Videos if present). Only include the ones that actually make sense for the topic:\n- Khan Academy: [short search topic] — good for lessons and explanations\n- Quizlet: [short search topic] — good for memorization and flashcards\n- Brainly: [short search topic] — good for homework help and discussion\n\nInclude 1-3 of these only when genuinely useful. Skip any that wouldn't help. Skip the whole section if none would help.`
      : "";


    const systemPrompt = `You are HomeWorkAI — an expert academic tutor for ALL subjects from K-12 through college.
Subjects: Math (arithmetic → calculus, stats) | Science (biology, chemistry, physics) | History | English & writing | Economics | Law | Psychology | Computer science | Any academic topic

${planInstructions}

RESPONSE FORMAT — adapt naturally to the question. Do NOT force sections. Only include a section if it genuinely helps.

ALWAYS start with:
Final Answer: [One direct sentence. The answer only — no explanation here.]

THEN, choose only what the question actually needs:
- Simple/short question → Final Answer only, or Final Answer + 1-2 sentences. No extra sections.
- Math or multi-step problem → Final Answer + Step-by-step (only as many steps as genuinely needed). Add a brief Explanation only if the method needs clarifying.
- Conceptual question → Final Answer + Explanation (short paragraphs, one idea each, teach the WHY).
- Complex or multi-part question → Final Answer + whatever combination of steps, explanation, or key points best serves it.
- Summary or list request → Final Answer + bullet Key Points if that's the clearest format.

OPTIONAL SECTIONS — only add when they add real value:
Step-by-step: (math/calculations only — show real operations with actual numbers)
Explanation: (short paragraphs — one idea each, 2-3 sentences max)
Key Points: (3-5 bullets max — one specific fact per line)
Tip: (one sentence — a real shortcut or memory trick. Skip if nothing genuinely useful.)
Insight: (one short paragraph — a deeper nuance. Pro+ only, skip for simple questions.)

STRICT RULES:
1. NEVER force Explanation, Step-by-step, or Key Points into every response. Match the format to the question.
2. NEVER write one long paragraph. Every paragraph = one idea, 2-3 sentences max.
3. Steps must show REAL work — never vague.
4. NEVER start a step with: Identify, Notice, Consider, Think, Remember, Set up, Look at, Understand
5. Scale length to complexity — simple = shorter, complex = more thorough. Never pad.
6. FORMATTING: Free tier — plain text ONLY, no bold, no underline. Pro tier — bold (**word**) allowed for key terms. Pro+ tier — bold (**word**) AND underline (__phrase__) allowed for key terms. No LaTeX, no markdown symbols like ##, no $ for math.
7. Non-academic question: reply only "I'm here to help with homework and studying. Try asking me a subject question!"
8. Write like a confident, intelligent tutor — not a chatbot, not an essay.${youtubeInstruction}${resourcesInstruction}`;

    const inputContent = `Question: ${question}`;

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

    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray && contentArray.length > 0) {
        rawAnswer = contentArray.map(c => c.text || "").join("");
      }
    } catch (e) { console.log("Parse error:", data); }

    let answer = rawAnswer
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
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/__(.*?)__/g, "$1");
    } else {
      answer = answer.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
    }

    let videos = [];
    if (userPlan === "pro_plus") {
      const videoBlockMatch = answer.match(/Videos:([\s\S]*?)(?=\n\nResources:|Resources:|$)/);
      if (videoBlockMatch) {
        const block = videoBlockMatch[1];
        const titleMatches = [...block.matchAll(/Title:\s*(.+)/gi)];
        for (const m of titleMatches) {
          const title = m[1].trim();
          if (title.length > 3) {
            videos.push({ title, link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(title) });
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
        answer = answer.replace(/Videos:[\s\S]*?(?=\n\nResources:|Resources:|$)/, "").trim();
      }
    }

    // ── Parse Study Resources (Pro+ only) ────────────────────────────────
    let resources = [];
    if (userPlan === "pro_plus") {
      const resBlockMatch = answer.match(/Resources:([\s\S]*?)(?=\n\n|$)/);
      if (resBlockMatch) {
        const block = resBlockMatch[1];
        const kaMatch = block.match(/Khan Academy:\s*(.+)/i);
        const quizMatch = block.match(/Quizlet:\s*(.+)/i);
        const brainlyMatch = block.match(/Brainly:\s*(.+)/i);
        if (kaMatch) resources.push({ site: "Khan Academy", query: kaMatch[1].trim(), url: "https://www.khanacademy.org/search?page_search_query=" + encodeURIComponent(kaMatch[1].trim()), color: "#14bf96", icon: "🎓" });
        if (quizMatch) resources.push({ site: "Quizlet", query: quizMatch[1].trim(), url: "https://quizlet.com/search?query=" + encodeURIComponent(quizMatch[1].trim()) + "&type=sets", color: "#4257b2", icon: "📇" });
        if (brainlyMatch) resources.push({ site: "Brainly", query: brainlyMatch[1].trim(), url: "https://brainly.com/search?entry=" + encodeURIComponent(brainlyMatch[1].trim()), color: "#b45309", icon: "💬" });
        answer = answer.replace(/Resources:[\s\S]*?(?=\n\n|$)/, "").trim();
      }
    }

    return res.status(200).json({ answer, videos, resources });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}


