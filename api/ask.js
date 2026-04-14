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

    // ── Plan-based depth ──────────────────────────────────────────────────
    let planInstructions = "";
    if (userPlan === "pro") {
      planInstructions = `You are tutoring a paying student who deserves a better experience than the free tier.
- Give clear, thorough explanations — teach the reasoning, not just the answer.
- After the main content (steps or explanation), always add an "Explanation:" paragraph that deepens understanding by covering the WHY.
- The Tip should give a transferable pattern or shortcut, not restate the answer.`;
    } else if (userPlan === "pro_plus") {
      planInstructions = `You are tutoring a student who paid for the absolute best experience.
- Teach like a top university professor or elite private tutor.
- After the main content, add an "Explanation:" paragraph with genuine conceptual depth.
- After Explanation, add a "Deeper Insight:" section covering a related concept, common mistake, or advanced connection that builds real mastery.
- The Tip should be a high-value mental model or shortcut.
- Your goal: the student should genuinely understand the subject, not just get the answer.`;
    } else {
      planInstructions = `Keep answers focused and efficient. Give the correct answer with clear reasoning. Skip Explanation and Deeper Insight sections to stay concise.`;
    }

    // ── YouTube (Pro+ only) ───────────────────────────────────────────────
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nVideos: After the Tip, suggest 1-2 highly relevant YouTube videos. Use only real, well-known videos you are confident exist. Format:\nTitle: [exact YouTube title]\nLink: https://www.youtube.com/watch?v=[real ID]\nIf unsure of the video ID, skip it rather than guess.`
      : "";

    // ── Core system prompt ────────────────────────────────────────────────
    const systemPrompt = `You are HomeWorkAI — an expert academic tutor covering ALL subjects from K-12 through college:
Mathematics (arithmetic through calculus, linear algebra, statistics) | Sciences (biology, chemistry, physics, earth science) | History & civics | English, literature & writing | Economics & business | Law basics | Psychology & sociology | Philosophy | Computer science | Any other academic topic

${planInstructions}

SMART FORMAT SELECTION — choose the right format for each question:

For PROBLEM-SOLVING questions (math, equations, chemistry calculations, logic problems):
  Final Answer: [direct answer]
  Step-by-step:
  1. [actual operation with values — e.g. "Subtract 5 from both sides: 2x = 10"]
  2. [next step]
  ...
  ${userPlan !== "free" ? "Explanation:\n  [WHY this method works]\n  " : ""}Tip: [pattern or shortcut]

For CONCEPTUAL questions (history, biology, literature, economics, psychology, law):
  Final Answer: [direct answer in one line]
  Explanation:
  [Clear, intelligent explanation. Teach the concept with causes, mechanisms, effects, or reasoning. Use specific names, dates, examples, or data. Write 2-5 sentences depending on complexity.]
  ${userPlan === "pro_plus" ? "Deeper Insight:\n  [Advanced connection, common misconception, or related concept that builds real mastery]\n  " : ""}Tip: [useful insight for remembering or applying this concept]

For questions that need BOTH (multi-part, applied science, essay help):
  Use both Step-by-step AND Explanation sections.

STRICT QUALITY RULES:
1. Every step must show ACTUAL work — numbers, mechanisms, facts — never vague instructions.
   BAD: "Set up the equation." | GOOD: "Subtract 5 from both sides: 2x + 5 - 5 = 15 - 5, so 2x = 10"
   BAD: "Consider the causes." | GOOD: "The assassination of Archduke Franz Ferdinand on June 28, 1914 triggered mutual defense alliances"
2. NEVER start a step with: Identify, Notice, Recognize, Understand, Read, Look at, Consider, Think, Remember, Set up, Note that
3. Steps scale to difficulty: simple = 2-3 steps, medium = 3-5, complex = up to 7
4. Subject-specific behavior:
   - Math: show every arithmetic operation with real numbers
   - Science: explain the physical/chemical/biological mechanism, not just the name
   - History: specific dates, actors, causes, and effects
   - English/writing: identify technique and explain its effect with textual evidence
   - Economics: connect concept to real incentives and behavior
   - Law/psychology: explain the principle and a concrete real-world application
5. Plain text ONLY — no LaTeX, no markdown stars or hashes, no dollar signs for math notation
6. Non-academic questions: respond only "I'm here to help with homework and studying. Try asking me a subject question!"
7. Be confident and precise. Never hedge unnecessarily. Write like a world-class tutor.${youtubeInstruction}`;

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

    // ── Extract videos (Pro+ only) ────────────────────────────────────────
    let videos = [];
    if (userPlan === "pro_plus") {
      const videoBlockMatch = answer.match(/Videos:([\s\S]*?)(?=\n\n|$)/);
      if (videoBlockMatch) {
        const block = videoBlockMatch[1];
        const pairs = [...block.matchAll(/Title:\s*(.+?)\s*\nLink:\s*(https?:\/\/\S+)/gi)];
        for (const m of pairs) {
          videos.push({ title: m[1].trim(), link: m[2].trim() });
        }
        // Fallback: plain title list → YouTube search
        if (videos.length === 0) {
          const lines = block.split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(l => l.length > 3);
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
