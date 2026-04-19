// ============================================================
// /api/get-user-plan.js  —  HomeWorkAI
// ============================================================
// Returns the user's current plan AND their renewal date.
// The frontend stores renewalDate in window.userRenewalDate
// and displays it in the Account & Plan settings modal.
// ============================================================

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

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "";
const VIP_PRO_EMAILS = (process.env.VIP_PRO_EMAILS || "")
  .split(",").map(e => e.trim()).filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 1. Verify Firebase token
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized — invalid or expired token." });
  }

  const { uid, email: userEmail } = decodedToken;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized — token has no email." });

  // 2. Resolve plan + renewal date from Firestore
  let plan        = "free";
  let renewalDate = null; // Unix timestamp (seconds) — set by stripe-webhook.js

  if (userEmail === ADMIN_EMAIL) {
    plan = "pro_plus";
  } else if (VIP_PRO_EMAILS.includes(userEmail)) {
    plan = "pro";
  } else {
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) {
        const data = doc.data();
        plan        = data?.plan        || "free";
        renewalDate = data?.renewalDate ?? null; // ← comes from stripe-webhook.js
      }
    } catch (err) {
      console.warn("Firestore plan lookup failed:", err.message);
    }
  }

  // 3. Return both plan and renewalDate to the frontend
  return res.status(200).json({ plan, renewalDate });
}

