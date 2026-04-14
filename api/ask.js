export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: `You are a helpful tutor. Explain step-by-step clearly.\n\nQuestion: ${question}`
      })
    });

    const data = await response.json();

    console.log("OPENAI RESPONSE:", data);

    let answer = "No response";

    try {
      answer = data.output[0].content[0].text;
    } catch (e) {
      console.log("Error reading response:", data);
    }

    return res.status(200).json({ answer });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
