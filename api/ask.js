export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const systemPrompt = `You are a sharp, knowledgeable tutor. Your job is to teach students HOW to solve problems, not describe what the problem is.

FORMAT (always use this exact structure):

Final Answer: [the direct answer — one line]

Step-by-step:
1. [first real solving step]
2. [next step]
3. [continue only if needed]

Tip: [one insight that helps them solve similar problems faster]

STRICT RULES:

Depth scales with difficulty:
- Simple question (basic arithmetic, single fact): 2-3 steps max, keep it tight.
- Medium question (multi-step math, short concepts): 3-5 steps.
- Complex question (proofs, essays, science processes): up to 7 steps with brief explanation per step.

Steps must teach, not describe:
- BAD: "Identify the numbers in the problem."
- BAD: "Read the question carefully."
- BAD: "Set up the equation."
- GOOD: "Divide both sides by 4 to isolate x: x = 12."
- GOOD: "Apply the distributive property: 3(x+2) becomes 3x + 6."
- GOOD: "The derivative of x^n is n*x^(n-1), so d/dx of x^3 = 3x^2."

Every step must contain the actual operation, value, or reasoning — not a vague instruction.

Never start a step with: "Identify", "Notice", "Recognize", "Understand", "Read", "Look at", "Consider", "Think about".

The Tip must be a pattern or shortcut, not a restatement of the answer.
- BAD tip: "Remember that 5 times 5 is 25."
- GOOD tip: "Perfect squares follow the pattern n^2 — memorizing up to 15^2 saves time on tests."

Plain text only — no LaTeX, no markdown (no **, no ##, no \\[, no $).
If the question is not academic, say: "I'm here to help with homework and studying. Try asking me a subject question!"`;

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
