// /api/get-usage.js — Knox Knows
// Returns real-time usage + gamification data for the logged-in user.
// BUG FIXES vs original:
//   ✅ hwLimit / casualLimit / totalUsed were undefined → fixed
//   ✅ data.times used instead of nonexistent data.hwTimes (ask.js stores as "times")
//   ✅ Plan normalised so legacy values ("pro", "pro_plus", "wonder") work correctly
//   ✅ Consistent return shape: { hw, hwLimit, nextUnlock, plan, streak, totalKP, weeklyKP }

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth }       from "firebase-admin/auth";
import { getFirestore }                  from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const adminAuth   = getAdminAuth();
const db          = getFirestore();
const WINDOW_MS   = 24 * 60 * 60 * 1000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const VIP_EMAILS  = (process.env.VIP_PRO_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

function normalizePlan(raw) {
  if (!raw) return "free";
  if (raw === "max" || raw === "pro_plus")                  return "max";
  if (raw === "super" || raw === "pro" || raw === "wonder") return "super";
  return "free";
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer "))
    return res.status(401).json({ error: "Unauthorized" });

  let uid, userEmail;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid       = decoded.uid;
    userEmail = decoded.email;
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Resolve plan ──────────────────────────────────────────────────────────
  let rawPlan = "free";
  if (userEmail === ADMIN_EMAIL) {
    rawPlan = "max";
  } else if (VIP_EMAILS.includes(userEmail)) {
    rawPlan = "super";
  } else {
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) rawPlan = doc.data()?.plan || "free";
    } catch {}
  }
  const plan = normalizePlan(rawPlan);

  // ── Limits by plan ────────────────────────────────────────────────────────
  const hwLimit = plan === "max" ? null : plan === "super" ? 25 : 5;   // null = unlimited

  // ── Usage from Firestore ──────────────────────────────────────────────────
  const now = Date.now();
  let hwUsed = 0, nextUnlock = null;

  try {
    const snap = await db.collection("usage").doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      // ask.js stores usage timestamps in "times" (not "hwTimes")
      const hwTimes = (data.times || []).filter(t => now - t < WINDOW_MS);
      hwUsed = hwTimes.length;
      if (hwLimit !== null && hwUsed >= hwLimit && hwTimes.length > 0) {
        nextUnlock = Math.min(...hwTimes) + WINDOW_MS;
      }
    }
  } catch (e) {
    console.warn("Usage fetch error:", e.message);
  }

  // ── Gamification ──────────────────────────────────────────────────────────
  let streak = 0, totalKP = 0, weeklyKP = 0;
  try {
    const gamSnap = await db.collection("gamification").doc(uid).get();
    if (gamSnap.exists) {
      const gd = gamSnap.data();
      streak   = gd.streak   || 0;
      totalKP  = gd.totalKP  || 0;
      weeklyKP = gd.weeklyKP || 0;
    }
  } catch {}

  return res.status(200).json({
    hw:        hwUsed,
    hwLimit,                         // null means unlimited
    nextUnlock,
    plan,
    streak,
    totalKP,
    weeklyKP,
  });
}
