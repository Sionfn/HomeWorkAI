export default async function handler(req, res) {
  try {
    const { question } = req.body;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: question
      })
    });

    const data = await response.json();

    // safer extraction
    let answer = "No response";

    if (data.output && data.output.length > 0) {
      const content = data.output[0].content;
      if (content && content.length > 0) {
        answer = content[0].text;
      }
    }

    res.status(200).json({ answer });

  } catch (error) {
    res.status(500).json({ answer: "Error connecting to AI" });
  }
}
