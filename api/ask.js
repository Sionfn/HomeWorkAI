export default async function handler(req, res) {
  const { question } = req.body;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful school tutor. Explain answers step-by-step clearly."
        },
        { role: "user", content: question }
      ]
    })
  });

  const data = await response.json();

  res.status(200).json({
    answer: data.choices[0].message.content
  });
}
