export default async function handler(req, res) {
  const { question } = req.body;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: `You are a helpful school tutor. Explain step-by-step.\n\n${question}`
      })
    });

    const data = await response.json();

    res.status(200).json({
      answer: data.output_text || "No response"
    });

  } catch (error) {
    res.status(500).json({ error: "Something went wrong" });
  }
}
