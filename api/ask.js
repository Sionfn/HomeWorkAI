export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, plan, imageBase64, imageType } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const userPlan = plan || "free";

    // Plan-based instruction modifier
    let planInstructions = "";
    if (userPlan === "pro") {
      planInstructions = "Give slightly more detailed explanations. Break down each step a bit further so the student really understands the reasoning.";
    } else if (userPlan === "pro_plus") {
      planInstructions = "Give deeper explanations with extra learning tips. After the Tip, add a 'Deeper Insight:' line with one related concept or common mistake to watch out for. Help the student build real understanding, not just get the answer.";
    } else {
      planInstructions = "Keep answers clear and concise. Focus on getting to the correct answer efficiently.";
    }

    // YouTube instruction — only for pro_plus
    const youtubeInstruction = userPlan === "pro_plus"
      ? `\nVideos: [Find 1-2 highly relevant YouTube videos for this EXACT topic. Format each as:\nTitle: [exact video title]\nLink: https://www.youtube.com/results?search_query=[url-encoded search terms]\nPlace these after the Tip/Deeper Insight on their own lines.]`
      : "";

    const systemPrompt = `You are an expert tutor for ALL school subjects — math, science (biology, chemistry, physics), history, English, economics, and more. You help students from K-12 through college level.

${planInstructions}

FORMAT — always follow this exact structure:

Final Answer: [direct answer in one line]

Step-by-step:
1. [first real solving step with actual values/reasoning]
2. [next step]
3. [continue only if needed]

Tip: [one short pattern or shortcut for solving similar problems — omit if not useful]${youtubeInstruction}

RULES:

Adapt to the subject:
- Math: show calculations and operations explicitly
- Science: explain the concept or process with the mechanism
- History: give key facts, causes, and effects directly
- English: explain the argument, technique, or meaning clearly

Scale depth to difficulty:
- Simple (single fact, basic arithmetic): 2-3 steps max
- Medium (multi-step math, short concepts): 3-5 steps
- Complex (proofs, science processes, essays): up to 7 steps

Every step must show the actual operation or reasoning — never vague instructions.
BAD: "Set up the equation." / "Identify the variables." / "Consider the context."
GOOD: "Subtract 5 from both sides: 2x = 10."
GOOD: "Mitochondria produce ATP via oxidative phosphorylation in the inner membrane."

Never start a step with: Identify, Notice, Recognize, Understand, Read, Look at, Consider, Think about, Remember.

The Tip must be a transferable pattern or shortcut — not a restatement of the answer.

Plain text only — no LaTeX, no markdown (no **, no ##, no \\[, no $).

If the question is not academic, respond only: "I'm here to help with homework and studying. Try asking me a subject question!"`;

    // Build input — support text + optional image
    let inputContent;
    if (imageBase64 && imageType) {
      inputContent = [
        {
          type: "input_image",
          image_url: `data:${imageType};base64,${imageBase64}`
        },
        {
          type: "input_text",
          text: question ? `Question: ${question}` : "Please read this image and answer the homework question shown."
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

    // Safe parsing — handles long answers with multiple content blocks
    let rawAnswer = "No response";
    try {
      const contentArray = data.output?.[0]?.content;
      if (contentArray && contentArray.length > 0) {
        rawAnswer = contentArray.map(c => c.text || "").join("");
      }
    } catch (e) {
      console.log("Parse error:", data);
    }

    // Strip any LaTeX / markdown the model may still produce
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

    // Extract video suggestions (Pro+ only)
    let videos = [];
    if (userPlan === "pro_plus") {
      // Match "Title: X\nLink: Y" pairs
      const videoBlockMatch = answer.match(/Videos:([\s\S]*?)(?:\n\n|$)/);
      if (videoBlockMatch) {
        const block = videoBlockMatch[1];
        const pairs = block.matchAll(/Title:\s*(.+?)\s*\nLink:\s*(https?:\/\/\S+)/gi);
        for (const m of pairs) {
          videos.push(`Title: ${m[1].trim()} Link: ${m[2].trim()}`);
        }
        // Fallback: simple dash list
        if (videos.length === 0) {
          videos = block.split("\n").map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);
        }
        answer = answer.replace(/Videos:[\s\S]*?(?:\n\n|$)/, "").trim();
      }
    }

    return res.status(200).json({ answer, videos });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

