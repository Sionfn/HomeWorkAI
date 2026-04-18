// ============================================================
// /api/get-user-plan.js  —  HomeWorkAI
// ============================================================
// Returns the authenticated user's current plan.
// REQUIRES: Authorization: Bearer <Firebase ID Token>
// The plan is read from Firestore (written by your Stripe
// webhook), never from client-supplied data.
// ============================================================

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || "";
const VIP_PRO_EMAILS = (process.env.VIP_PRO_EMAILS || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify token
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }

  const { uid, email } = decodedToken;

  // Admin / VIP overrides (from env vars — never from client)
  if (email === ADMIN_EMAIL) {
    return res.status(200).json({ plan: "pro_plus" });
  }
  if (VIP_PRO_EMAILS.includes(email)) {
    return res.status(200).json({ plan: "pro" });
  }

  // Look up Firestore for paid Stripe subscribers
  try {
    const userDoc = await db.collection("users").doc(uid).get();
    const plan    = userDoc.exists ? (userDoc.data()?.plan || "free") : "free";
    return res.status(200).json({ plan });
  } catch (err) {
    console.error("Firestore plan lookup error:", err.message);
    return res.status(200).json({ plan: "free" });
  }
}
