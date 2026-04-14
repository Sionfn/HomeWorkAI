export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question, plan } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    // Plan-based prompt differentiation
    const userPlan = plan || "free";

    let planInstructions = "";
    if (userPlan === "pro") {
      planInstructions = "Give slightly more detailed explanations. Break down each step a bit further so the student really understands the reasoning behind it.";
    } else if (userPlan === "pro_plus") {
      planInstructions = "Give deeper explanations with extra learning tips. After the main solution, add a 'Deeper Insight' section with a related concept or common mistake to watch out for. Help the student build real understanding, not just get the answer.";
    } else {
      planInstructions = "Keep answers clear and concise. Focus on getting to the correct answer efficiently.";
    }

    const systemPrompt = `You are an expert tutor that can teach ANY school subject — math, science, history, English, chemistry, physics, economics, and more.

${planInstructions}

FORMAT — always use this exact structure:

Final Answer: [the direct answer — one line]

Step-by-step:
1. [first real solving step]
2. [next step]
3. [continue only if needed]

Tip: [one short pattern or shortcut to help solve similar problems faster — skip if not useful]

RULES:

Scale depth to difficulty:
- Simple (basic arithmetic, single fact): 2-3 steps max.
- Medium (multi-step math, short concepts): 3-5 steps.
- Complex (proofs, essays, science processes): up to 7 steps.

Every step must show the actual operation or reasoning — not vague instructions.
- BAD: "Set up the equation." / "Identify the variables."
- GOOD: "Subtract 5 from both sides: 2x = 10."
- GOOD: "Apply the distributive property: 3(x+2) = 3x + 6."

Never start a step with: Identify, Notice, Recognize, Understand, Read, Look at, Consider, Think about.

The Tip must be a pattern or shortcut — not a restatement of the answer.

Plain text only — no LaTeX, no markdown (no **, no ##, no \\[, no $).

If the question is not academic, respond: "I'm here to help with homework and studying. Try asking me a subject question!"`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        instructions: systemPrompt,
        input: `Question: ${question}`
      })
    });

    const data = await response.json();
    console.log("OPENAI RESPONSE:", data);

    let answer = "No response";
    try {
      answer = data.output[0].content[0].text;

      // Strip any LaTeX delimiters the model may still produce
      answer = answer
        .replace(/\\\[[\s\S]*?\\\]/g, "")   // remove \[ ... \]
        .replace(/\\\([\s\S]*?\\\)/g, "")   // remove \( ... \)
        .replace(/\$\$[\s\S]*?\$\$/g, "")   // remove $$ ... $$
        .replace(/\$([^$]+)\$/g, "$1")      // strip inline $ delimiters, keep content
        .replace(/\*\*(.*?)\*\*/g, "$1")    // strip bold **
        .replace(/\*(.*?)\*/g, "$1")        // strip italic *
        .replace(/^#{1,6}\s/gm, "")         // strip markdown headings
        .replace(/\n{3,}/g, "\n\n")         // collapse excess blank lines
        .trim();

    } catch (e) {
      console.log("Error reading response:", data);
    }

    return res.status(200).json({ answer });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

