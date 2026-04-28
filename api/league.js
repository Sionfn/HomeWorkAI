// /api/league.js — Weekly League system for Knox Knows
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth }       from "firebase-admin/auth";
import { getFirestore, FieldValue }      from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })});
}
const adminAuth = getAdminAuth();
const db        = getFirestore();
const LEAGUE_SIZE = 30;

function getWeekStart() {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().split('T')[0];
}

const TIERS = ['Bronze', 'Silver', 'Gold', 'Diamond'];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  let uid, displayName;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    uid         = decoded.uid;
    displayName = decoded.name || decoded.email?.split('@')[0] || 'Student';
  } catch { return res.status(401).json({ error: "Unauthorized" }); }

  const weekStart = getWeekStart();
  const gamRef    = db.collection('gamification').doc(uid);

  try {
    const snap = await gamRef.get();
    const gd   = snap.exists ? snap.data() : {};
    const weeklyKP  = (gd.weekStart === weekStart) ? (gd.weeklyKP || 0) : 0;
    const tier      = gd.leagueTier  || 'Bronze';
    const leagueId  = gd.leagueId    || null;

    // Assign to league if needed
    let assignedLeagueId = leagueId;
    if (!leagueId || gd.weekStart !== weekStart) {
      // Find an open league for this tier+week
      const leaguesCol = db.collection('leagues');
      const q = await leaguesCol
        .where('weekStart', '==', weekStart)
        .where('tier', '==', tier)
        .where('memberCount', '<', LEAGUE_SIZE)
        .limit(1).get();

      if (q.empty) {
        // Create new league
        const newLeague = await leaguesCol.add({
          weekStart, tier,
          memberCount: 1,
          createdAt: Date.now(),
        });
        assignedLeagueId = newLeague.id;
      } else {
        assignedLeagueId = q.docs[0].id;
        await leaguesCol.doc(assignedLeagueId).update({ memberCount: FieldValue.increment(1) });
      }

      // Save leagueId to user's gamification doc
      await gamRef.set({
        leagueId:   assignedLeagueId,
        leagueTier: tier,
        weekStart,
        weeklyKP,
        displayName: displayName.substring(0, 20),
      }, { merge: true });
    }

    // Get leaderboard for this league
    const membersSnap = await db.collection('gamification')
      .where('leagueId', '==', assignedLeagueId)
      .where('weekStart', '==', weekStart)
      .orderBy('weeklyKP', 'desc')
      .limit(30)
      .get();

    const leaderboard = membersSnap.docs.map((doc, i) => {
      const d = doc.data();
      const isMe = doc.id === uid;
      return {
        rank:        i + 1,
        name:        isMe ? 'You' : anonymize(d.displayName || 'Student'),
        kp:          d.weeklyKP || 0,
        streak:      d.streak   || 0,
        isMe,
        avatar:      d.equippedAvatar || 'default',
      };
    });

    const myRank = leaderboard.find(u => u.isMe)?.rank || leaderboard.length + 1;

    return res.status(200).json({
      tier,
      weekStart,
      leagueId:    assignedLeagueId,
      weeklyKP,
      myRank,
      totalMembers: leaderboard.length,
      leaderboard,
      nextTier:    TIERS[TIERS.indexOf(tier) + 1] || null,
      promotionZone: myRank <= 5,
      demotionZone:  myRank > leaderboard.length - 5 && leaderboard.length >= 10,
    });

  } catch(e) {
    console.error('League error:', e);
    return res.status(500).json({ error: 'League unavailable' });
  }
}

// Show only first name + last initial for privacy
function anonymize(name) {
  if (!name) return 'Student';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 8);
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
