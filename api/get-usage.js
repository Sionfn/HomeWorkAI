// /api/get-usage.js — returns real-time usage for the logged-in user
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

const adminAuth = getAdminAuth();
const db        = getFirestore();
const WINDOW_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  let uid, userEmail;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid       = decoded.uid;
    userEmail = decoded.email;
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Resolve plan
  let userPlan = "free";
  try {
    const doc = await db.collection("users").doc(uid).get();
    if (doc.exists) userPlan = doc.data()?.plan || "free";
  } catch {}

  const hwLimit = (userPlan === "max") ? null  // null = unlimited (frontend shows ∞)
    : (userPlan === "super"  || userPlan === "pro_plus") ? 40
    : (userPlan === "wonder" || userPlan === "pro")      ? 25
    : 5;
  const casualLimit = (userPlan === "max" || userPlan === "super" || userPlan === "pro_plus") ? null
    : (userPlan === "wonder" || userPlan === "pro") ? 50
    : 20;

  const now = Date.now();
  let hwUsed = 0, csUsed = 0, nextUnlock = null, csNextUnlock = null;

  try {
    const snap = await db.collection("usage").doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      const hwTimes = (data.hwTimes     || []).filter(t => now - t < WINDOW_MS);
      const csTimes = (data.casualTimes || []).filter(t => now - t < WINDOW_MS);
      hwUsed = hwTimes.length;
      csUsed = csTimes.length;
      if (hwLimit !== null && hwUsed >= hwLimit && hwTimes.length > 0) {
        nextUnlock = Math.min(...hwTimes) + WINDOW_MS;
      }
      if (casualLimit !== null && csUsed >= casualLimit && csTimes.length > 0) {
        csNextUnlock = Math.min(...csTimes) + WINDOW_MS;
      }
    }
  } catch(e) {
    console.warn("Usage fetch error:", e.message);
  }

  return res.status(200).json({
    hw:          hwUsed,
    hwLimit:     hwLimit ?? Infinity,
    casual:      csUsed,
    casualLimit: casualLimit ?? Infinity,
    nextUnlock,
    csNextUnlock,
    plan:        userPlan,
  });
}
