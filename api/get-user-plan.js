// /api/get-user-plan.js — Knox Knows
// Returns the user's current plan + renewal date.
// All plan names normalised to "free" | "super" | "max" — frontend never sees legacy values.

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
const ADMIN_EMAIL = process.env.ADMIN_EMAIL    || "";
const VIP_EMAILS  = (process.env.VIP_PRO_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

function normalizePlan(raw) {
  if (!raw) return "free";
  if (raw === "max" || raw === "pro_plus")             return "max";
  if (raw === "super" || raw === "pro" || raw === "wonder") return "super";
  return "free";
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer "))
    return res.status(401).json({ error: "Unauthorized" });

  let decodedToken;
  try { decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7)); }
  catch { return res.status(401).json({ error: "Unauthorized — invalid or expired token." }); }

  const { uid, email: userEmail } = decodedToken;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized — token has no email." });

  let plan = "free", renewalDate = null;

  if (userEmail === ADMIN_EMAIL) {
    plan = "max";
  } else if (VIP_EMAILS.includes(userEmail)) {
    plan = "super";
  } else {
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) {
        const d  = doc.data();
        plan        = normalizePlan(d?.plan);
        renewalDate = d?.renewalDate ?? null;
      }
    } catch (err) { console.warn("Firestore plan lookup failed:", err.message); }
  }

  return res.status(200).json({ plan, renewalDate });
}
