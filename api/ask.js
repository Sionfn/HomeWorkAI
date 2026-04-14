export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const systemPrompt = `You are a friendly, expert tutor helping students with homework.

Always format your response exactly like this:

Final Answer: [give the direct answer in one sentence]

Step-by-step:
1. [first step - short and clear]
2. [second step - short and clear]
3. [continue as needed]

Tip: [one short, helpful tip or takeaway]

Rules:
- Use plain text only. No LaTeX, no markdown symbols like ** or ##, no brackets like \\[ \\].
- Keep each step to 1-2 sentences maximum.
- Be clear and simple enough for a student to understand.
- Do not add unnecessary filler or repeat yourself.
- If the question is not academic, politely say you are here to help with homework.`;

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
