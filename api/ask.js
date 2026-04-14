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

    // Plan-based depth modifier
    let planInstructions = "";
    if (userPlan === "pro") {
      planInstructions = `You are tutoring a student who paid for a better experience.
- Give clear, thorough explanations — not just the answer.
- Break every step down and explain WHY it works, not just what to do.
- After the numbered steps, add a short "Explanation:" paragraph that deepens understanding.
- The Tip should teach a transferable pattern or shortcut, not restate the answer.`;
    } else if (userPlan === "pro_plus") {
      planInstructions = `You are tutoring a student who paid for the best possible experience.
- Teach like a top university professor or expert private tutor.
- Give the deepest, clearest explanation possible.
- After the numbered steps, add an "Explanation:" paragraph with real conceptual depth.
- After Explanation, add a "Deeper Insight:" line covering a related concept, common mistake, or advanced connection.
- The Tip should be a high-value shortcut or mental model.
- Make the student actually understand the subject, not just memorize the answer.`;
    } else {
      planInstructions = `Keep your answer focused and direct. Give the correct answer with clear reasoning. Short steps only — do not add Explanation or Deeper Insight sections.`;
    }

    // YouTube instructions (Pro+ only)
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\n\nAfter the Tip (or Deeper Insight), add a "Videos:" section with exactly 1-2 highly relevant YouTube videos.\nUse REAL, SPECIFIC, well-known YouTube videos that actually exist and match the topic exactly.\nFormat each video as:\nTitle: [Exact video title as it appears on YouTube]\nLink: https://www.youtube.com/watch?v=[real video ID]\n\nOnly include videos you are highly confident exist. Do not make up video IDs.`
      : "";

    const systemPrompt = `You are HomeWorkAI — an expert tutor for ALL academic subjects from K-12 through college level. You have deep knowledge in:
- Mathematics: arithmetic, algebra, geometry, trigonometry, calculus, statistics, linear algebra
- Sciences: biology, chemistry, physics, earth science, environmental science
- History & social studies: world history, US history, geography, civics, economics
- English & writing: literature analysis, grammar, essay structure, rhetoric, poetry
- Business & economics: microeconomics, macroeconomics, accounting basics, finance concepts
- Law basics, psychology, sociology, philosophy, computer science, and any other academic subject

${planInstructions}

RESPONSE FORMAT — follow this structure exactly:

Final Answer: [The direct, correct answer in one concise line]

Step-by-step:
1. [First real step — show the actual operation, calculation, or reasoning]
2. [Next step — always show actual values, not vague instructions]
3. [Continue only as many steps as genuinely needed]

${userPlan !== "free" ? "Explanation:\n[A short paragraph that builds real understanding — explain the WHY behind the answer, not just the HOW]\n\n" : ""}Tip: [A transferable insight, shortcut, or pattern — omit if not genuinely useful]${youtubeInstruction}

STRICT RULES:
1. NEVER start a step with: Identify, Notice, Recognize, Understand, Read, Look at, Consider, Think about, Remember, Set up, Note that
2. Every step must show actual work — numbers, formulas, reasoning — not meta-instructions.
   BAD: "Set up the equation"  GOOD: "Subtract 5 from both sides: 2x + 5 - 5 = 15 - 5, so 2x = 10"
   BAD: "Identify key events"  GOOD: "Archduke Franz Ferdinand was assassinated on June 28, 1914, triggering the alliance chain"
3. Scale length to difficulty:
   - Simple (1-step): 2-3 steps max
   - Medium (multi-step): 3-5 steps
   - Complex (proofs, essays): up to 7 steps
4. Subject behavior:
   - Math: show every arithmetic operation with actual numbers
   - Science: explain the mechanism (what physically/chemically/biologically happens and why)
   - History: give specific dates, names, causes, effects
   - English: explain the technique, theme, or argument with textual evidence
   - Economics: connect concept to real-world behavior or incentives
5. Plain text ONLY — no LaTeX, no markdown (no **, no ##, no dollar signs for math)
6. If the question is not academic: respond only with "I'm here to help with homework and studying. Try asking me a subject question!"
7. Be confident and precise — write like a world-class tutor, not a chatbot`;

    // Build input — text or image+text
    let inputContent;
    if (imageBase64 && imageType) {
      inputContent = [
        {
          type: "input_image",
          image_url: `data:${imageType};base64,${imageBase64}`
        },
        {
          type: "input_text",
          text: question
            ? `The student uploaded an image of their homework. Their note: "${question}". Read the image carefully, extract the full question, and solve it completely.`
            : "The student uploaded an image of their homework question. Read the image carefully, extract the full question, and solve it completely."
        }
      ];
    } else {
      inputContent = `Question: ${question}`;
    }

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

    // Safe parse
    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray && contentArray.length > 0) {
        rawAnswer = contentArray.map(c => c.text || "").join("");
      }
    } catch (e) {
      console.log("Parse error:", data);
    }

    // Strip residual LaTeX / markdown
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

    // Extract videos (Pro+ only) — return as objects {title, link}
    let videos = [];
    if (userPlan === "pro_plus") {
      const videoBlockMatch = answer.match(/Videos:([\s\S]*?)(?=\n\n|$)/);
      if (videoBlockMatch) {
        const block = videoBlockMatch[1];
        const pairs = [...block.matchAll(/Title:\s*(.+?)\s*\nLink:\s*(https?:\/\/\S+)/gi)];
        for (const m of pairs) {
          videos.push({ title: m[1].trim(), link: m[2].trim() });
        }
        // Fallback: plain list — use YouTube search
        if (videos.length === 0) {
          const lines = block.split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
          for (const l of lines) {
            if (l.length > 3) videos.push({ title: l, link: "https://www.youtube.com/results?search_query=" + encodeURIComponent(l) });
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
