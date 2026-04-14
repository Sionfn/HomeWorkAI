I have a working AI homework website. DO NOT break anything.

IMPORTANT:

* My OpenAI API works
* My limits system works
* My Firebase login works
* My UI already works
* DO NOT redesign the entire site
* DO NOT remove working logic
* ONLY improve and extend functionality carefully

---

1. MAKE AI EXTREMELY SMART (ALL SUBJECTS + COLLEGE LEVEL)

---

Upgrade the OpenAI prompt in /api/ask.js so the AI becomes a top-level tutor.

It must:

* Understand ALL subjects:

  * K-12 (math, science, history, English)
  * College-level topics
  * Specific majors:

    * Business
    * Law (basic legal concepts)
    * Psychology / therapy concepts
    * Economics
    * STEM fields
* Answer accurately and confidently

Behavior:

* Act like an expert teacher or professor
* Focus on teaching, not just answering
* Be clear, structured, and intelligent

---

2. SMART RESPONSE STYLE (IMPORTANT)

---

The AI should NOT always use step-by-step.

Instead:

* If the question is problem-solving (math, equations):
  → Use step-by-step

* If the question is conceptual (science, history, etc):
  → Use a clear explanation instead

* If needed:
  → Use BOTH (step-by-step + explanation)

Make the response feel natural and intelligent.

Structure:

Final Answer:
(short direct answer)

Then EITHER:

* Step-by-step
  OR
* Explanation

Optional:
Tip (if helpful)

---

3. PLAN-BASED QUALITY (PREMIUM FEEL)

---

FREE:

* shorter answers
* simpler explanations

PRO:

* clearer explanations
* more helpful teaching

PRO+:

* best explanations
* deeper understanding
* extra insights

Make higher plans feel noticeably better.

---

4. CLEAN, PROFESSIONAL PLAN DISPLAY (VERY IMPORTANT)

---

Improve plan UI:

* Show clearly at the top:
  "Current Plan: Free"
  "Current Plan: Pro"
  "Current Plan: Pro+"

Make it:

* clean
* modern
* visually noticeable
* styled like a badge or label

---

5. PREMIUM RESPONSE UI (VERY IMPORTANT)

---

Improve AI response UI ONLY:

* Use a clean card or chat bubble style
* Add spacing and padding
* Make text easy to read

Sections:

* Final Answer → bold + slightly larger
* Step-by-step → clean numbered list
* Explanation → clearly separated
* Tip → styled box

Make it feel like a premium paid product.

---

6. FIX YOUTUBE VIDEOS (CRITICAL)

---

Right now videos are broken.

Fix this:

* DO NOT return expired or invalid links
* DO NOT return YouTube search links

Instead:

* Return REAL working video links
* Choose high-quality, relevant videos

Format:

Videos:

* Title: [Video Title]
  Link: https://youtube.com/valid-video

Frontend:

* Make links clickable
* Open in new tab

---

7. RESPONSE SPEED FEEL

---

Make responses feel fast:

* Show "Thinking..." briefly
* Then display answer cleanly

Do NOT slow down functionality.

---

8. KEEP EVERYTHING SAFE

---

* Keep fetch("/api/ask")
* Keep API working
* Keep Firebase login
* Do NOT rewrite entire files
* Only extend carefully

---

Here is my code:
(paste your index.html and api/ask.js)
