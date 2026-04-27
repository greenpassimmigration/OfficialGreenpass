const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const crypto = require("crypto");
const Stripe = require("stripe");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");

admin.initializeApp();

/**
 * =========================================================
 * 2) Notifications: Followers get notified on new published post
 * =========================================================
 */

function normalizeStatus(v) {
  return String(v || "").toLowerCase().trim();
}

function getAuthorId(post) {
  return post.authorId || post.user_id || post.author_id || null;
}

function getAuthorName(post) {
  return post.authorName || post.author_name || post.full_name || "Someone you follow";
}

function getAuthorRole(post) {
  return post.authorRole || post.author_role || post.role || null;
}

async function fanoutNewPostNotification({ postId, post }) {
  const authorId = getAuthorId(post);
  if (!authorId) return;

  const authorName = getAuthorName(post);
  const authorRole = getAuthorRole(post);

  const followersRef = admin.firestore().collection(`users/${authorId}/followers`);
  const followersSnap = await followersRef.get();
  if (followersSnap.empty) return;

  const now = admin.firestore.FieldValue.serverTimestamp();

  const followerIds = followersSnap.docs.map((d) => d.id);
  const chunkSize = 450;
  for (let i = 0; i < followerIds.length; i += chunkSize) {
    const chunk = followerIds.slice(i, i + chunkSize);
    const batch = admin.firestore().batch();

    chunk.forEach((followerId) => {
      const notifId = `new_post_${postId}`;
      const notifRef = admin
        .firestore()
        .collection(`users/${followerId}/notifications`)
        .doc(notifId);

      batch.set(
        notifRef,
        {
          type: "new_post",
          postId,
          authorId,
          authorName,
          authorRole,
          title: "New post",
          body: `${authorName} posted an update`,
          link: `/postdetail?id=${postId}`,
          seen: false,
          readAt: null,
          createdAt: now,
        },
        { merge: true }
      );
    });

    await batch.commit();
  }
}

exports.notifyFollowersOnNewPost = onDocumentCreated("posts/{postId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const post = snap.data() || {};
  const postId = event.params.postId;

  const status = normalizeStatus(post.status);
  if (status && status !== "published") return;

  await fanoutNewPostNotification({ postId, post });
});

exports.notifyFollowersOnPostPublished = onDocumentUpdated("posts/{postId}", async (event) => {
  const before = event.data?.before?.data?.() || {};
  const after = event.data?.after?.data?.() || {};
  const postId = event.params.postId;

  const beforeStatus = normalizeStatus(before.status);
  const afterStatus = normalizeStatus(after.status);

  if (afterStatus !== "published") return;
  if (beforeStatus === "published") return;

  await fanoutNewPostNotification({ postId, post: after });
});

/**
 * =========================================================
 * 2B) Notifications: User gets notified when someone follows them
 * =========================================================
 */
exports.notifyUserOnFollow = onDocumentCreated(
  "users/{followeeId}/followers/{followerId}",
  async (event) => {
    try {
      const followeeId = event.params.followeeId;
      const followerId = event.params.followerId;

      if (!followeeId || !followerId) return;
      if (followeeId === followerId) return;

      const notifId = `follow_${followeeId}_${followerId}`;
      const notifRef = admin
        .firestore()
        .doc(`users/${followeeId}/notifications/${notifId}`);

      let followerName = "Someone";
      let followerRole = null;
      let followerPhoto = "";

      const followerDoc = await admin.firestore().doc(`users/${followerId}`).get();
      if (followerDoc.exists) {
        const u = followerDoc.data() || {};
        followerName = u.full_name || u.displayName || u.name || followerName;
        followerRole = u.role || u.selected_role || u.user_type || u.userType || followerRole;
        followerPhoto = u.profile_picture || u.photoURL || u.photo_url || followerPhoto;
      }

      await notifRef.set(
        {
          type: "follow",
          followerId,
          followerName,
          followerRole,
          followerPhoto,
          title: "New follower",
          body: `${followerName} started following you`,
          seen: false,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("notifyUserOnFollow error:", err);
    }
  }
);

// ---------------------------------------------------------
// 3) FOLLOW REQUESTS (Instagram-style)
// ---------------------------------------------------------

function pickUserName(u) {
  return (
    u?.full_name ||
    u?.displayName ||
    u?.name ||
    u?.firstName ||
    u?.first_name ||
    "Someone"
  );
}

function pickUserRole(u) {
  return u?.role || u?.selected_role || u?.user_type || u?.userType || null;
}

function pickUserPhoto(u) {
  return u?.profile_picture || u?.photoURL || u?.photo_url || "";
}

async function getUserProfile(uid) {
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    if (!snap.exists) return { uid, name: "Someone", role: null, photo: "" };
    const u = snap.data() || {};
    return { uid, name: pickUserName(u), role: pickUserRole(u), photo: pickUserPhoto(u) };
  } catch {
    return { uid, name: "Someone", role: null, photo: "" };
  }
}

exports.notifyUserOnFollowRequest = onDocumentCreated(
  "users/{followeeId}/follow_requests/{followerId}",
  async (event) => {
    try {
      const followeeId = event.params.followeeId;
      const followerId = event.params.followerId;
      if (!followeeId || !followerId) return;
      if (followeeId === followerId) return;

      const req = event.data?.data?.() || {};
      const status = String(req.status || "pending").toLowerCase();
      if (status !== "pending") return;

      const follower = await getUserProfile(followerId);

      const notifId = `follow_request_${followeeId}_${followerId}`;
      const notifRef = admin.firestore().doc(`users/${followeeId}/notifications/${notifId}`);
      await notifRef.set(
        {
          type: "follow_request",
          fromUserId: followerId,
          toUserId: followeeId,
          followerId,
          followerName: follower.name,
          followerRole: follower.role,
          followerPhoto: follower.photo,
          title: "Follow request",
          body: `${follower.name} sent you a follow request`,
          link: "/connections?tab=requests",
          seen: false,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const mirrorRef = admin
        .firestore()
        .doc(`users/${followerId}/follow_requests_sent/${followeeId}`);
      await mirrorRef.set(
        {
          follower_id: followerId,
          followee_id: followeeId,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("notifyUserOnFollowRequest error:", err);
    }
  }
);

exports.handleFollowRequestDecision = onDocumentUpdated(
  "users/{followeeId}/follow_requests/{followerId}",
  async (event) => {
    try {
      const followeeId = event.params.followeeId;
      const followerId = event.params.followerId;
      if (!followeeId || !followerId) return;
      if (followeeId === followerId) return;

      const before = event.data?.before?.data?.() || {};
      const after = event.data?.after?.data?.() || {};

      const beforeStatus = String(before.status || "pending").toLowerCase();
      const afterStatus = String(after.status || "pending").toLowerCase();
      if (beforeStatus === afterStatus) return;
      if (afterStatus !== "accepted" && afterStatus !== "declined") return;

      const followee = await getUserProfile(followeeId);

      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();

      const mirrorRef = db.doc(`users/${followerId}/follow_requests_sent/${followeeId}`);

      if (afterStatus === "accepted") {
        const followerRef = db.doc(`users/${followeeId}/followers/${followerId}`);
        const followingRef = db.doc(`users/${followerId}/following/${followeeId}`);

        await db.runTransaction(async (tx) => {
          tx.set(
            followerRef,
            {
              follower_id: followerId,
              followee_id: followeeId,
              createdAt: now,
            },
            { merge: true }
          );

          tx.set(
            followingRef,
            {
              follower_id: followerId,
              followee_id: followeeId,
              createdAt: now,
            },
            { merge: true }
          );

          tx.delete(event.data.after.ref);
          tx.delete(mirrorRef);
        });

        const notifId = `follow_request_accepted_${followeeId}_${followerId}`;
        const notifRef = db.doc(`users/${followerId}/notifications/${notifId}`);
        await notifRef.set(
          {
            type: "follow_request_accepted",
            fromUserId: followeeId,
            toUserId: followerId,
            title: "Follow request accepted",
            body: `${followee.name} accepted your follow request`,
            link: `/profile/${followeeId}`,
            seen: false,
            readAt: null,
            createdAt: now,
          },
          { merge: true }
        );
      } else {
        await db.runTransaction(async (tx) => {
          tx.delete(event.data.after.ref);
          tx.delete(mirrorRef);
        });

        const notifId = `follow_request_declined_${followeeId}_${followerId}`;
        const notifRef = db.doc(`users/${followerId}/notifications/${notifId}`);
        await notifRef.set(
          {
            type: "follow_request_declined",
            fromUserId: followeeId,
            toUserId: followerId,
            title: "Follow request declined",
            body: `${followee.name} declined your follow request`,
            link: "/connections",
            seen: false,
            readAt: null,
            createdAt: now,
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error("handleFollowRequestDecision error:", err);
    }
  }
);

exports.cleanupOnFollowRequestDeleted = onDocumentDeleted(
  "users/{followeeId}/follow_requests/{followerId}",
  async (event) => {
    try {
      const followeeId = event.params.followeeId;
      const followerId = event.params.followerId;
      if (!followeeId || !followerId) return;

      const db = admin.firestore();
      await Promise.allSettled([
        db.doc(`users/${followerId}/follow_requests_sent/${followeeId}`).delete(),
        db.doc(`users/${followeeId}/notifications/follow_request_${followeeId}_${followerId}`).delete(),
      ]);
    } catch (err) {
      console.error("cleanupOnFollowRequestDeleted error:", err);
    }
  }
);

// ============================
// Auth Bridge (SEO -> App)
// ============================

const AUTH_BRIDGE_TTL_MS = 5 * 60 * 1000;

// ============================
// Invite System (Admin/School/Agent)
// ============================

const INVITE_ROLE_LABELS = {
  student: "Student",
  agent: "Agent",
  school: "School",
  admin: "Admin",
  collaborator: "Collaborator",
};

async function getInviterDisplayName(uid, decodedToken) {
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    const u = snap.data() || {};
    const full =
      u.full_name ||
      u.display_name ||
      u.displayName ||
      u.name ||
      [u.first_name, u.last_name].filter(Boolean).join(" ") ||
      decodedToken?.name ||
      decodedToken?.displayName ||
      decodedToken?.email ||
      "";
    return String(full || "").trim() || "A GreenPass user";
  } catch (e) {
    return decodedToken?.name || decodedToken?.email || "A GreenPass user";
  }
}
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_PEPPER = process.env.INVITE_PEPPER || "CHANGE_ME_INVITE_PEPPER";

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function normalizeRole(v) {
  const s = String(v || "").toLowerCase().trim();
  if (s === "advisor") return "admin";
  if (s === "user") return "student";
  return s;
}

async function getUserRoleForInvite(uid, decodedToken) {
  if (decodedToken?.admin === true) return "admin";

  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const u = snap.data() || {};

  if (u.is_admin === true || u.admin === true) return "admin";
  return normalizeRole(u.role || u.user_type || u.selected_role || u.userType);
}

function assertRoleCanInvite(inviterRole, invitedRole) {
  const ir = normalizeRole(inviterRole);
  const rr = normalizeRole(invitedRole);

  if (ir === "admin") {
    if (rr !== "agent" && rr !== "school" && rr !== "student" && rr !== "collaborator") {
      throw new Error("Admin can only invite agent, school, student, or collaborator");
    }
    return;
  }

  if (ir === "school") {
    if (rr !== "agent") throw new Error("School can only invite agent");
    return;
  }

  if (ir === "agent") {
    if (rr !== "agent" && rr !== "school" && rr !== "student") {
      throw new Error("Agent can only invite agent, school, or student");
    }
    return;
  }

  throw new Error("Role not allowed to invite");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

const COLLABORATOR_BASE_URL =
  process.env.COLLABORATOR_REFERRAL_BASE_URL ||
  process.env.PUBLIC_APP_URL ||
  "https://greenpassgroup.com";

const COLLABORATOR_REWARD_PER_VERIFIED = Number(
  process.env.COLLABORATOR_REWARD_PER_VERIFIED || 0
);

function sanitizeReferralCodePart(v, fallback = "COLLAB") {
  const clean = String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return clean || fallback;
}

function buildCollaboratorReferralCode(userData = {}, uid = "") {
  const existing = String(userData?.collaborator_referral_code || "").trim();
  if (existing) return existing;

  const namePart = sanitizeReferralCodePart(
    userData?.full_name || userData?.displayName || userData?.name || userData?.email,
    "GREENP"
  );
  const uidPart = sanitizeReferralCodePart(uid, "USER").slice(-6);

  return `GP-${namePart}${uidPart}`;
}

function buildCollaboratorReferralLink(code) {
  const base = String(COLLABORATOR_BASE_URL || "https://greenpassgroup.com").replace(/\/+$/, "");
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

function getCollaboratorTierFromVerifiedCount(verifiedUsers = 0) {
  const count = Number(verifiedUsers || 0);
  if (count >= 100) return "gold";
  if (count >= 20) return "silver";
  return "bronze";
}

async function recalculateCollaboratorStats(collaboratorUid) {
  if (!collaboratorUid) return;

  const db = admin.firestore();
  const referralsSnap = await db
    .collection("collaborator_referrals")
    .where("collaborator_uid", "==", collaboratorUid)
    .get();

  let invited = 0;
  let completed = 0;
  let verified = 0;

  referralsSnap.forEach((docSnap) => {
    invited += 1;
    const data = docSnap.data() || {};

    if (
      data.completed_profile === true ||
      data.status === "completed_profile" ||
      data.status === "verified"
    ) {
      completed += 1;
    }

    if (data.verified === true || data.status === "verified") {
      verified += 1;
    }
  });

  const tier = getCollaboratorTierFromVerifiedCount(verified);
  const estimatedRewards = Math.max(0, verified * COLLABORATOR_REWARD_PER_VERIFIED);

  await db.collection("users").doc(collaboratorUid).set(
    {
      collaborator_invited_total: invited,
      collaborator_completed_profiles: completed,
      collaborator_verified_users: verified,
      collaborator_estimated_rewards: estimatedRewards,
      collaborator_tier: tier,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function syncCollaboratorReferralForUser(userId, beforeData = {}, afterData = {}) {
  const collaboratorUid = String(
    afterData?.referred_by_collaborator_uid || beforeData?.referred_by_collaborator_uid || ""
  ).trim();

  const collaboratorCode = String(
    afterData?.referred_by_collaborator_code || beforeData?.referred_by_collaborator_code || ""
  ).trim();

  if (!collaboratorUid || !collaboratorCode || !userId) return;

  const db = admin.firestore();
  const referralRef = db.collection("collaborator_referrals").doc(userId);

  const role = normalizeRole(
    afterData?.role || afterData?.user_type || afterData?.selected_role || afterData?.userType
  ) || "student";

  const onboardingCompleted = afterData?.onboarding_completed === true;
  const verified = afterData?.is_verified === true;
  const status = verified ? "verified" : onboardingCompleted ? "completed_profile" : "joined";

  const payload = {
    collaborator_uid: collaboratorUid,
    collaborator_code: collaboratorCode,
    referred_user_uid: userId,
    referred_user_email: afterData?.email || beforeData?.email || "",
    referred_user_role: role,
    status,
    completed_profile: onboardingCompleted,
    verified,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (afterData?.createdAt || beforeData?.createdAt) {
    payload.referred_user_created_at = afterData?.createdAt || beforeData?.createdAt;
  }

  if (afterData?.referred_by_collaborator_at || beforeData?.referred_by_collaborator_at) {
    payload.referred_at =
      afterData?.referred_by_collaborator_at || beforeData?.referred_by_collaborator_at;
  }

  if (onboardingCompleted) {
    payload.completed_at = afterData?.updatedAt || admin.firestore.FieldValue.serverTimestamp();
  }

  if (verified) {
    payload.verified_at = afterData?.updatedAt || admin.firestore.FieldValue.serverTimestamp();
  }

  await referralRef.set(payload, { merge: true });
  await recalculateCollaboratorStats(collaboratorUid);
}

async function requireBearerUid(req) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const idToken = match?.[1];
  if (!idToken) throw new Error("Missing Authorization Bearer token");
  const decoded = await admin.auth().verifyIdToken(idToken);
  return { uid: decoded.uid, decoded };
}

// ============================
// Agent / Student / Tutor Referral QR
// ============================

async function getUserDocByUid(uid) {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  return snap.exists ? { id: snap.id, ...(snap.data() || {}) } : null;
}

function pickDisplayName(u) {
  return (
    u?.full_name ||
    u?.display_name ||
    u?.displayName ||
    u?.name ||
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
    "User"
  );
}

function pickCompanyName(u) {
  return u?.company_name || u?.agency_name || u?.organization_name || u?.business_name || "";
}

function pickEmail(u) {
  return u?.email || u?.email_address || "";
}

function pickPhone(u) {
  return u?.phone || u?.phone_number || u?.mobile || u?.contact_number || "";
}

function isStudentRole(role) {
  const r = normalizeRole(role);
  return r === "student";
}

function isSchoolRole(role) {
  const r = normalizeRole(role);
  return r === "school";
}

function isTutorRole(role) {
  const r = normalizeRole(role);
  return r === "tutor";
}

function isAgentRole(role) {
  const r = normalizeRole(role);
  return r === "agent";
}

function getScannerEntityType(role) {
  if (isSchoolRole(role)) return "school";
  if (isAgentRole(role)) return "agent";
  if (isTutorRole(role)) return "tutor";
  return null;
}

function sanitizeStudentPublic(studentDoc) {
  if (!studentDoc) return null;

  const onboardingCompleted = studentDoc.onboarding_completed === true;

  return {
    studentId: studentDoc.id,
    full_name: pickDisplayName(studentDoc),
    email: pickEmail(studentDoc),
    phone: pickPhone(studentDoc),
    assigned_agent_id: studentDoc.assigned_agent_id || null,
    referred_by_agent_id: studentDoc.referred_by_agent_id || null,
    onboarding_completed: onboardingCompleted,
    profile_completed: onboardingCompleted,
    qr_ready: onboardingCompleted,
  };
}

async function getSchoolOwnedByUser(uid) {
  const db = admin.firestore();

  const directSchoolSnap = await db.collection("schools").doc(uid).get();
  if (directSchoolSnap.exists) {
    return { id: directSchoolSnap.id, ...(directSchoolSnap.data() || {}) };
  }

  const q = await db
    .collection("schools")
    .where("school_owner_user_id", "==", uid)
    .limit(1)
    .get();

  if (!q.empty) {
    const d = q.docs[0];
    return { id: d.id, ...(d.data() || {}) };
  }

  return null;
}

function buildSchoolLeadDocId(schoolId, studentId) {
  return `${schoolId}_${studentId}`;
}

function buildAgentClientDocId(agentId, studentId) {
  return `${agentId}_${studentId}`;
}

function buildTutorStudentDocId(tutorId, studentId) {
  return `${tutorId}_${studentId}`;
}

function buildStudentReferralNotificationId(prefix, ownerId, studentId) {
  return `${prefix}_${ownerId}_${studentId}`;
}

async function writeQrScanLog({
  token,
  tokenType,
  studentId,
  schoolId,
  scannedBy,
  result,
  duplicate = false,
  leadId = null,
  meta = {},
}) {
  try {
    await admin.firestore().collection("qr_scan_logs").add({
      token: token || null,
      tokenType: tokenType || "student",
      studentId: studentId || null,
      schoolId: schoolId || null,
      scannedBy: scannedBy || null,
      result: result || "unknown",
      duplicate: !!duplicate,
      leadId: leadId || null,
      meta: meta || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("writeQrScanLog error:", e);
  }
}

async function createNotificationIfNeeded(userId, notificationId, payload) {
  if (!userId || !notificationId) return;
  await admin
    .firestore()
    .collection("users")
    .doc(userId)
    .collection("notifications")
    .doc(notificationId)
    .set(
      {
        ...payload,
        seen: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

function getNormalizedScannerRole(scannerUser, decoded) {
  return normalizeRole(
    scannerUser?.role ||
      scannerUser?.user_type ||
      scannerUser?.selected_role ||
      scannerUser?.userType ||
      decoded?.role
  );
}

function getNormalizedStudentRole(student) {
  return normalizeRole(
    student?.role || student?.user_type || student?.selected_role || student?.userType
  );
}

exports.getMyAgentReferralToken = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ error: "GET only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const userRef = admin.firestore().collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = userSnap.data() || {};
      const role =
        normalizeRole(user.role || user.user_type || user.selected_role || user.userType) ||
        normalizeRole(decoded?.role);

      if (role !== "agent") {
        return res.status(403).json({ error: "Only agent accounts can use referral QR" });
      }

      let token = user.referralQrToken;
      if (!token) {
        token = `agt_${randomToken(16)}`;
        await userRef.set(
          {
            referralQrToken: token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return res.json({ ok: true, token });
    } catch (e) {
      console.error("getMyAgentReferralToken error:", e);
      return res.status(500).json({ error: e?.message || "Failed to get referral token" });
    }
  });
});

exports.getMyTutorReferralToken = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ error: "GET only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const userRef = admin.firestore().collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = userSnap.data() || {};
      const role =
        normalizeRole(user.role || user.user_type || user.selected_role || user.userType) ||
        normalizeRole(decoded?.role);

      if (!isTutorRole(role)) {
        return res.status(403).json({ error: "Only tutor accounts can use referral QR" });
      }

      let token = user.tutorReferralQrToken;
      if (!token) {
        token = `tut_${randomToken(16)}`;
        await userRef.set(
          {
            tutorReferralQrToken: token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return res.json({ ok: true, token });
    } catch (e) {
      console.error("getMyTutorReferralToken error:", e);
      return res.status(500).json({ error: e?.message || "Failed to get tutor referral token" });
    }
  });
});

exports.getAgentReferralPublic = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "GET only" });
      }

      const ref = String(req.query.ref || "").trim();
      if (!ref) {
        return res.status(400).json({ ok: false, error: "Missing ref token" });
      }

      const q = await admin
        .firestore()
        .collection("users")
        .where("referralQrToken", "==", ref)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(404).json({ ok: false, error: "Referral not found" });
      }

      const d = q.docs[0];
      const agent = d.data() || {};
      const role = normalizeRole(
        agent.role || agent.user_type || agent.selected_role || agent.userType
      );

      if (role !== "agent") {
        return res.status(403).json({ ok: false, error: "Referral owner is not an agent" });
      }

      return res.json({
        ok: true,
        agentId: d.id,
        agentName: pickDisplayName(agent),
        agentCompany: pickCompanyName(agent),
        role: "agent",
      });
    } catch (e) {
      console.error("getAgentReferralPublic error:", e);
      return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
  });
});

exports.getTutorReferralPublic = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "GET only" });
      }

      const tutorRef = String(req.query.tutor_ref || req.query.ref || "").trim();
      if (!tutorRef) {
        return res.status(400).json({ ok: false, error: "Missing tutor_ref token" });
      }

      const q = await admin
        .firestore()
        .collection("users")
        .where("tutorReferralQrToken", "==", tutorRef)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(404).json({ ok: false, error: "Tutor referral not found" });
      }

      const d = q.docs[0];
      const tutor = d.data() || {};
      const role = normalizeRole(
        tutor.role || tutor.user_type || tutor.selected_role || tutor.userType
      );

      if (!isTutorRole(role)) {
        return res.status(403).json({ ok: false, error: "Referral owner is not a tutor" });
      }

      return res.json({
        ok: true,
        tutorId: d.id,
        tutorName: pickDisplayName(tutor),
        tutorCompany: pickCompanyName(tutor),
        role: "tutor",
      });
    } catch (e) {
      console.error("getTutorReferralPublic error:", e);
      return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
  });
});

exports.acceptAgentReferral = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { ref } = req.body || {};
      const referralToken = String(ref || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing ref token" });
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: "Student user not found" });
      }

      const student = userSnap.data() || {};
      const studentRole = normalizeRole(
        student.role || student.user_type || student.selected_role || student.userType || decoded?.role
      );

      if (!isStudentRole(studentRole)) {
        return res.status(403).json({ error: "Only student accounts can accept agent referrals" });
      }

      const q = await db
        .collection("users")
        .where("referralQrToken", "==", referralToken)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(404).json({ error: "Referral agent not found" });
      }

      const agentDoc = q.docs[0];
      const agentId = agentDoc.id;
      const agent = agentDoc.data() || {};

      const agentRole = normalizeRole(
        agent.role || agent.user_type || agent.selected_role || agent.userType
      );

      if (agentRole !== "agent") {
        return res.status(403).json({ error: "Referral owner is not an agent" });
      }

      if (agentId === uid) {
        return res.status(400).json({ error: "You cannot refer yourself" });
      }

      const relationId = `${agentId}_${uid}`;
      const relationRef = db.collection("agent_clients").doc(relationId);

      const notifId = `client_accept_${uid}`;
      const notifRef = db
        .collection("users")
        .doc(agentId)
        .collection("notifications")
        .doc(notifId);

      await db.runTransaction(async (tx) => {
        const relSnap = await tx.get(relationRef);

        tx.set(
          relationRef,
          {
            agentId,
            studentId: uid,
            status: "active",
            source: "qr",
            acceptedByStudent: true,
            createdAt: relSnap.exists
              ? relSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
              : admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          userRef,
          {
            referred_by_agent_id: student.referred_by_agent_id || agentId,
            assigned_agent_id: student.assigned_agent_id || agentId,
            referralType: "qr",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          notifRef,
          {
            type: "student_referral_accept",
            title: "New client accepted your referral",
            body: `${pickDisplayName(student)} joined your client list`,
            studentId: uid,
            studentName: pickDisplayName(student),
            link: `/viewprofile/${uid}`,
            seen: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      return res.json({
        ok: true,
        success: true,
        agentId,
        agentName: pickDisplayName(agent),
      });
    } catch (e) {
      console.error("acceptAgentReferral error:", e);
      const msg = e?.message || "Failed to accept referral";
      const low = String(msg).toLowerCase();
      const code =
        low.includes("missing authorization")
          ? 401
          : low.includes("not found")
          ? 404
          : low.includes("only student") || low.includes("not an agent")
          ? 403
          : 400;

      return res.status(code).json({ error: msg });
    }
  });
});

exports.acceptTutorReferral = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { tutor_ref, ref } = req.body || {};
      const referralToken = String(tutor_ref || ref || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing tutor_ref token" });
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: "Student user not found" });
      }

      const student = userSnap.data() || {};
      const studentRole = normalizeRole(
        student.role ||
          student.user_type ||
          student.selected_role ||
          student.userType ||
          decoded?.role
      );

      if (!isStudentRole(studentRole)) {
        return res.status(403).json({ error: "Only student accounts can accept tutor referrals" });
      }

      const q = await db
        .collection("users")
        .where("tutorReferralQrToken", "==", referralToken)
        .limit(1)
        .get();

      if (q.empty) {
        return res.status(404).json({ error: "Referral tutor not found" });
      }

      const tutorDoc = q.docs[0];
      const tutorId = tutorDoc.id;
      const tutor = tutorDoc.data() || {};

      const tutorRole = normalizeRole(
        tutor.role || tutor.user_type || tutor.selected_role || tutor.userType
      );

      if (!isTutorRole(tutorRole)) {
        return res.status(403).json({ error: "Referral owner is not a tutor" });
      }

      if (tutorId === uid) {
        return res.status(400).json({ error: "You cannot refer yourself" });
      }

      const relationId = `${tutorId}_${uid}`;
      const relationRef = db.collection("tutor_students").doc(relationId);

      const notifId = `student_accept_${uid}`;
      const notifRef = db
        .collection("users")
        .doc(tutorId)
        .collection("notifications")
        .doc(notifId);

      await db.runTransaction(async (tx) => {
        const relSnap = await tx.get(relationRef);

        tx.set(
          relationRef,
          {
            tutorId,
            studentId: uid,
            status: "active",
            source: "qr",
            acceptedByStudent: true,
            createdAt: relSnap.exists
              ? relSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
              : admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          userRef,
          {
            referred_by_tutor_id: student.referred_by_tutor_id || tutorId,
            tutor_student_status: "active",
            tutorReferralType: "qr",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        tx.set(
          notifRef,
          {
            type: "student_tutor_referral_accept",
            title: "New student accepted your referral",
            body: `${pickDisplayName(student)} joined your student list`,
            studentId: uid,
            studentName: pickDisplayName(student),
            link: `/viewprofile/${uid}`,
            seen: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      return res.json({
        ok: true,
        success: true,
        tutorId,
        tutorName: pickDisplayName(tutor),
      });
    } catch (e) {
      console.error("acceptTutorReferral error:", e);
      const msg = e?.message || "Failed to accept tutor referral";
      const low = String(msg).toLowerCase();
      const code =
        low.includes("missing authorization")
          ? 401
          : low.includes("not found")
          ? 404
          : low.includes("only student") || low.includes("not a tutor")
          ? 403
          : 400;

      return res.status(code).json({ error: msg });
    }
  });
});

/**
 * ============================
 * Student QR
 * ============================
 */

exports.getMyStudentReferralToken = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ error: "GET only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const userRef = admin.firestore().collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const user = userSnap.data() || {};
      const role =
        normalizeRole(user.role || user.user_type || user.selected_role || user.userType) ||
        normalizeRole(decoded?.role);

      if (!isStudentRole(role)) {
        return res.status(403).json({ error: "Only student accounts can generate student QR" });
      }

      let token = user.studentReferralQrToken;
      if (!token) {
        token = `std_${randomToken(16)}`;
        await userRef.set(
          {
            studentReferralQrToken: token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return res.json({ ok: true, token });
    } catch (e) {
      console.error("getMyStudentReferralToken error:", e);
      return res.status(500).json({ error: e?.message || "Failed to get student token" });
    }
  });
});

exports.resolveStudentReferralToken = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ error: "GET only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const scannerUser = await getUserDocByUid(uid);

      if (!scannerUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const scannerRole = getNormalizedScannerRole(scannerUser, decoded);
      const scannerEntityType = getScannerEntityType(scannerRole);

      if (!scannerEntityType) {
        return res
          .status(403)
          .json({ error: "Only school, agent, or tutor accounts can resolve student QR" });
      }

      const token = String(req.query.student_ref || req.query.ref || "").trim();
      if (!token) {
        return res.status(400).json({ error: "Missing student_ref token" });
      }

      const q = await admin
        .firestore()
        .collection("users")
        .where("studentReferralQrToken", "==", token)
        .limit(1)
        .get();

      if (q.empty) {
        await writeQrScanLog({
          token,
          tokenType: "student",
          studentId: null,
          schoolId: scannerEntityType === "school" ? uid : null,
          scannedBy: uid,
          result: "not_found",
          duplicate: false,
          meta: {
            scannerRole,
            scannerEntityType,
          },
        });
        return res.status(404).json({ error: "Student referral not found" });
      }

      const d = q.docs[0];
      const student = d.data() || {};
      const studentRole = getNormalizedStudentRole(student);

      if (!isStudentRole(studentRole)) {
        await writeQrScanLog({
          token,
          tokenType: "student",
          studentId: d.id,
          schoolId: scannerEntityType === "school" ? uid : null,
          scannedBy: uid,
          result: "invalid_owner_role",
          duplicate: false,
          meta: {
            scannerRole,
            scannerEntityType,
          },
        });
        return res.status(403).json({ error: "Referral owner is not a student" });
      }

      return res.json({
        ok: true,
        success: true,
        token,
        scannerRole,
        scannerEntityType,
        student: sanitizeStudentPublic({ id: d.id, ...student }),
      });
    } catch (e) {
      console.error("resolveStudentReferralToken error:", e);
      return res.status(500).json({ error: e?.message || "Failed to resolve student token" });
    }
  });
});

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function toFirestoreTimestampFromUnix(seconds) {
  const n = Number(seconds || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return admin.firestore.Timestamp.fromMillis(n * 1000);
}

function normalizeStripePlanId(planId = "") {
  return String(planId || "").trim().toLowerCase();
}

function getRoleFromPlanId(planId = "") {
  const p = normalizeStripePlanId(planId);
  if (p.startsWith("agent_")) return "agent";
  if (p.startsWith("school_")) return "school";
  if (p.startsWith("tutor_")) return "tutor";
  return "";
}

function getIntervalFromPlanId(planId = "") {
  const p = normalizeStripePlanId(planId);
  if (p.endsWith("_monthly")) return "month";
  if (p.endsWith("_yearly")) return "year";
  return "";
}

function isStripeSubscriptionActive(status = "", currentPeriodEnd = null) {
  const s = String(status || "").toLowerCase().trim();
  const ok = new Set(["active", "trialing", "paid"]);

  if (!ok.has(s)) return false;

  if (currentPeriodEnd) {
    const endMs =
      typeof currentPeriodEnd.toMillis === "function"
        ? currentPeriodEnd.toMillis()
        : currentPeriodEnd instanceof Date
        ? currentPeriodEnd.getTime()
        : Number(currentPeriodEnd || 0);

    if (Number.isFinite(endMs) && endMs > 0 && endMs < Date.now()) {
      return false;
    }
  }

  return true;
}

async function getStripeConfig() {
  let docData = {};

  try {
    const snap = await admin.firestore().doc("payment_settings/stripe").get();
    if (snap.exists) docData = snap.data() || {};
  } catch (e) {
    console.warn("Unable to read payment_settings/stripe:", e);
  }

  const secretKey =
    process.env.STRIPE_SECRET_KEY ||
    docData.secret_key ||
    docData.stripe_secret_key ||
    docData.secretKey ||
    "";

  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    docData.publishable_key ||
    docData.stripe_publishable_key ||
    docData.publishableKey ||
    "";

  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET ||
    docData.webhook_secret ||
    docData.stripe_webhook_secret ||
    docData.webhookSecret ||
    "";

  const currency = String(
    docData.currency ||
      docData.stripe_currency ||
      process.env.STRIPE_CURRENCY ||
      "USD"
  ).toUpperCase();

  const active = docData.active !== false;

  const priceIds = {
    school_monthly:
      docData.school_monthly_price_id ||
      docData.price_ids?.school_monthly ||
      "",
    school_yearly:
      docData.school_yearly_price_id ||
      docData.price_ids?.school_yearly ||
      "",
    agent_monthly:
      docData.agent_monthly_price_id ||
      docData.price_ids?.agent_monthly ||
      "",
    agent_yearly:
      docData.agent_yearly_price_id ||
      docData.price_ids?.agent_yearly ||
      "",
    tutor_monthly:
      docData.tutor_monthly_price_id ||
      docData.price_ids?.tutor_monthly ||
      "",
    tutor_yearly:
      docData.tutor_yearly_price_id ||
      docData.price_ids?.tutor_yearly ||
      "",
  };

  return {
    secretKey: String(secretKey || "").trim(),
    publishableKey: String(publishableKey || "").trim(),
    webhookSecret: String(webhookSecret || "").trim(),
    currency,
    active,
    priceIds,
  };
}

function appendQueryParams(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function buildSubscriptionUserUpdate({
  uid = "",
  subscription = null,
  session = null,
  invoice = null,
  planId = "",
  fallbackEmail = "",
  forceInactive = false,
  forcedStatus = "",
}) {
  const metadata = {
    ...(session?.metadata || {}),
    ...(subscription?.metadata || {}),
    ...(invoice?.metadata || {}),
  };

  const finalPlanId =
    normalizeStripePlanId(
      planId ||
        metadata.gp_plan_id ||
        metadata.planId ||
        session?.metadata?.gp_plan_id ||
        subscription?.metadata?.gp_plan_id ||
        ""
    ) || "";

  const subscriptionId =
    typeof session?.subscription === "string"
      ? session.subscription
      : session?.subscription?.id ||
        subscription?.id ||
        invoice?.subscription ||
        "";

  const customerId =
    typeof session?.customer === "string"
      ? session.customer
      : session?.customer?.id ||
        (typeof subscription?.customer === "string"
          ? subscription.customer
          : subscription?.customer?.id) ||
        (typeof invoice?.customer === "string"
          ? invoice.customer
          : invoice?.customer?.id) ||
        "";

  const priceId =
    subscription?.items?.data?.[0]?.price?.id ||
    session?.line_items?.data?.[0]?.price?.id ||
    "";

  const currentPeriodStart = toFirestoreTimestampFromUnix(
    subscription?.current_period_start
  );

  const currentPeriodEnd = toFirestoreTimestampFromUnix(
    subscription?.current_period_end
  );

  const stripeStatus =
    forcedStatus ||
    subscription?.status ||
    session?.subscription?.status ||
    session?.subscription_status ||
    "";

  const normalizedStatus = String(stripeStatus || "").toLowerCase().trim();

  const active = forceInactive
    ? false
    : isStripeSubscriptionActive(normalizedStatus, currentPeriodEnd);

  const interval = getIntervalFromPlanId(finalPlanId);

  const amount =
    subscription?.items?.data?.[0]?.price?.unit_amount
      ? Number(subscription.items.data[0].price.unit_amount) / 100
      : session?.amount_total
      ? Number(session.amount_total) / 100
      : 0;

  const currency =
    subscription?.items?.data?.[0]?.price?.currency ||
    session?.currency ||
    invoice?.currency ||
    "usd";

  return {
    subscription_active: active,
    subscription_status: normalizedStatus || (active ? "active" : "none"),
    subscription_provider: "stripe",
    subscription_plan: finalPlanId,
    subscription_interval: interval,
    subscription_amount: amount,
    subscription_currency: String(currency || "usd").toUpperCase(),

    stripe_customer_id: customerId || "",
    stripe_subscription_id: subscriptionId || "",
    stripe_price_id: priceId || "",
    stripe_current_period_start: currentPeriodStart,
    stripe_current_period_end: currentPeriodEnd,
    stripe_cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    stripe_canceled_at: toFirestoreTimestampFromUnix(subscription?.canceled_at),
    stripe_ended_at: toFirestoreTimestampFromUnix(subscription?.ended_at),
    stripe_latest_invoice_id:
      typeof subscription?.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription?.latest_invoice?.id ||
          invoice?.id ||
          "",

    payment_provider: "stripe",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscription_updated_at: admin.firestore.FieldValue.serverTimestamp(),

    ...(fallbackEmail ? { subscription_customer_email: fallbackEmail } : {}),
  };
}

async function findUserIdForStripeObject({ session = null, subscription = null, invoice = null }) {
  const metadata = {
    ...(session?.metadata || {}),
    ...(subscription?.metadata || {}),
    ...(invoice?.metadata || {}),
  };

  const uid = String(
    metadata.uid ||
      metadata.userId ||
      metadata.firebase_uid ||
      metadata.firebaseUid ||
      session?.client_reference_id ||
      ""
  ).trim();

  if (uid) return uid;

  const customerId =
    typeof session?.customer === "string"
      ? session.customer
      : session?.customer?.id ||
        (typeof subscription?.customer === "string"
          ? subscription.customer
          : subscription?.customer?.id) ||
        (typeof invoice?.customer === "string"
          ? invoice.customer
          : invoice?.customer?.id) ||
        "";

  if (customerId) {
    const snap = await admin
      .firestore()
      .collection("users")
      .where("stripe_customer_id", "==", customerId)
      .limit(1)
      .get();

    if (!snap.empty) return snap.docs[0].id;
  }

  const email = String(
    session?.customer_email ||
      session?.customer_details?.email ||
      invoice?.customer_email ||
      metadata.payer_email ||
      ""
  )
    .trim()
    .toLowerCase();

  if (email) {
    const snap = await admin
      .firestore()
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!snap.empty) return snap.docs[0].id;
  }

  return "";
}

async function saveStripeSubscriptionToUser({
  uid,
  subscription,
  session = null,
  invoice = null,
  planId = "",
  forceInactive = false,
  forcedStatus = "",
}) {
  if (!uid) {
    console.warn("saveStripeSubscriptionToUser skipped: missing uid");
    return;
  }

  const update = buildSubscriptionUserUpdate({
    uid,
    subscription,
    session,
    invoice,
    planId,
    fallbackEmail:
      session?.customer_email ||
      session?.customer_details?.email ||
      invoice?.customer_email ||
      "",
    forceInactive,
    forcedStatus,
  });

  await admin.firestore().collection("users").doc(uid).set(update, { merge: true });

  const subId = update.stripe_subscription_id;
  if (subId) {
    await admin
      .firestore()
      .collection("stripe_subscriptions")
      .doc(subId)
      .set(
        {
          uid,
          ...update,
          raw_status: subscription?.status || forcedStatus || "",
          last_event_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }
}

exports.createStripeCheckoutSession = onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed." });
      return;
    }

    try {
      const body = readJsonBody(req);

      const paymentMode =
        String(body.paymentMode || "payment").toLowerCase() === "subscription"
          ? "subscription"
          : "payment";

      const uid = String(body.uid || body.userId || body.firebaseUid || "").trim();
      const planId = normalizeStripePlanId(body.planId || "");
      const amountUSD = Number(body.amountUSD || 0);
      const description = String(body.description || body.itemDescription || "Payment").trim();
      const payerEmail = String(body.payerEmail || "").trim();
      const payerName = String(body.payerName || "").trim();
      const returnUrl = String(body.returnUrl || "").trim();

      if (!returnUrl) {
        res.status(400).json({ ok: false, error: "Missing returnUrl." });
        return;
      }

      if (paymentMode === "subscription" && !uid) {
        res.status(400).json({
          ok: false,
          error: "Missing uid/userId for Stripe subscription.",
        });
        return;
      }

      const stripeConfig = await getStripeConfig();

      if (!stripeConfig.active || !stripeConfig.secretKey) {
        res.status(400).json({
          ok: false,
          error: "Stripe is not configured on the server.",
        });
        return;
      }

      const stripe = new Stripe(stripeConfig.secretKey);

      const successBase = appendQueryParams(returnUrl, {
        gp_payment_provider: "stripe",
        gp_payment_status: "success",
      });

      const successUrl = `${successBase}${
        successBase.includes("?") ? "&" : "?"
      }stripe_session_id={CHECKOUT_SESSION_ID}`;

      const cancelUrl = appendQueryParams(returnUrl, {
        gp_payment_provider: "stripe",
        gp_payment_status: "cancel",
      });

      let session;

      if (paymentMode === "subscription") {
        if (!planId) {
          res.status(400).json({ ok: false, error: "Missing planId for Stripe subscription." });
          return;
        }

        const stripePriceId = stripeConfig.priceIds?.[planId];

        if (!stripePriceId) {
          res.status(400).json({
            ok: false,
            error: `Missing Stripe price ID for plan "${planId}".`,
          });
          return;
        }

        session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          customer_email: payerEmail || undefined,
          client_reference_id: uid,
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [
            {
              price: stripePriceId,
              quantity: 1,
            },
          ],
          metadata: {
            uid,
            userId: uid,
            gp_checkout_mode: "subscription",
            gp_plan_id: planId,
            payer_name: payerName || "",
            payer_email: payerEmail || "",
            description: description || "Subscription",
          },
          subscription_data: {
            metadata: {
              uid,
              userId: uid,
              gp_checkout_mode: "subscription",
              gp_plan_id: planId,
              payer_name: payerName || "",
              payer_email: payerEmail || "",
              description: description || "Subscription",
            },
          },
        });
      } else {
        if (!(amountUSD > 0)) {
          res.status(400).json({ ok: false, error: "Invalid amount." });
          return;
        }

        session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: payerEmail || undefined,
          client_reference_id: uid || undefined,
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: String(stripeConfig.currency || "USD").toLowerCase(),
                unit_amount: Math.round(amountUSD * 100),
                product_data: {
                  name: description || "Payment",
                },
              },
            },
          ],
          metadata: {
            uid,
            userId: uid,
            gp_checkout_mode: "payment",
            gp_plan_id: planId || "",
            payer_name: payerName || "",
            payer_email: payerEmail || "",
            description: description || "Payment",
          },
        });
      }

      res.status(200).json({
        ok: true,
        sessionId: session.id,
        url: session.url || null,
        publishableKey: stripeConfig.publishableKey || null,
      });
    } catch (error) {
      console.error("createStripeCheckoutSession error:", error);

      res.status(500).json({
        ok: false,
        error: error?.message || "Failed to create Stripe checkout session.",
      });
    }
  });
});

exports.getStripeCheckoutSession = onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed." });
      return;
    }

    try {
      const body = readJsonBody(req);
      const sessionId = String(body.sessionId || req.query.sessionId || "").trim();

      if (!sessionId) {
        res.status(400).json({ ok: false, error: "Missing sessionId." });
        return;
      }

      const stripeConfig = await getStripeConfig();

      if (!stripeConfig.secretKey) {
        res.status(400).json({
          ok: false,
          error: "Stripe is not configured on the server.",
        });
        return;
      }

      const stripe = new Stripe(stripeConfig.secretKey);

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent", "subscription"],
      });

      const paid = session?.payment_status === "paid" || session?.status === "complete";

      const subscriptionObject =
        typeof session.subscription === "string" ? null : session.subscription || null;

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;

      if (session.mode === "subscription" && subscriptionObject) {
        const uid = await findUserIdForStripeObject({
          session,
          subscription: subscriptionObject,
        });

        if (uid) {
          await saveStripeSubscriptionToUser({
            uid,
            subscription: subscriptionObject,
            session,
            planId: session?.metadata?.gp_plan_id || "",
          });
        }
      }

      res.status(200).json({
        ok: true,
        paid,
        session: {
          id: session.id,
          mode: session.mode || "payment",
          status: session.status,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          customer_email: session.customer_email,
          customer_id:
            typeof session.customer === "string"
              ? session.customer
              : session.customer?.id || null,
          payment_intent:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null,
          subscription_id: subscriptionId,
          subscription_status: subscriptionObject?.status || null,
          current_period_start: subscriptionObject?.current_period_start || null,
          current_period_end: subscriptionObject?.current_period_end || null,
          cancel_at_period_end: subscriptionObject?.cancel_at_period_end || false,
          metadata: session.metadata || {},
        },
      });
    } catch (error) {
      console.error("getStripeCheckoutSession error:", error);

      res.status(500).json({
        ok: false,
        error: error?.message || "Failed to retrieve Stripe checkout session.",
      });
    }
  });
});

exports.stripeWebhook = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const stripeConfig = await getStripeConfig();

    if (!stripeConfig.secretKey) {
      res.status(500).send("Stripe secret key missing");
      return;
    }

    if (!stripeConfig.webhookSecret) {
      res.status(500).send("Stripe webhook secret missing");
      return;
    }

    const stripe = new Stripe(stripeConfig.secretKey);

    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        stripeConfig.webhookSecret
      );
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err?.message);
      res.status(400).send(`Webhook Error: ${err?.message}`);
      return;
    }

    const type = event.type;
    const object = event.data.object;

    console.log("stripeWebhook received:", type, object?.id || "");

    if (type === "checkout.session.completed") {
      const session = object;

      if (session.mode === "subscription") {
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);

          const uid = await findUserIdForStripeObject({
            session,
            subscription,
          });

          await saveStripeSubscriptionToUser({
            uid,
            subscription,
            session,
            planId: session?.metadata?.gp_plan_id || subscription?.metadata?.gp_plan_id || "",
          });
        }
      }
    }

    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated"
    ) {
      const subscription = object;

      const uid = await findUserIdForStripeObject({
        subscription,
      });

      await saveStripeSubscriptionToUser({
        uid,
        subscription,
        planId: subscription?.metadata?.gp_plan_id || "",
      });
    }

    if (type === "customer.subscription.deleted") {
      const subscription = object;

      const uid = await findUserIdForStripeObject({
        subscription,
      });

      await saveStripeSubscriptionToUser({
        uid,
        subscription,
        planId: subscription?.metadata?.gp_plan_id || "",
        forceInactive: true,
        forcedStatus: "canceled",
      });
    }

    if (type === "invoice.paid") {
      const invoice = object;

      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        const uid = await findUserIdForStripeObject({
          subscription,
          invoice,
        });

        await saveStripeSubscriptionToUser({
          uid,
          subscription,
          invoice,
          planId: subscription?.metadata?.gp_plan_id || invoice?.metadata?.gp_plan_id || "",
        });
      }
    }

    if (type === "invoice.payment_failed") {
      const invoice = object;

      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        const uid = await findUserIdForStripeObject({
          subscription,
          invoice,
        });

        await saveStripeSubscriptionToUser({
          uid,
          subscription,
          invoice,
          planId: subscription?.metadata?.gp_plan_id || invoice?.metadata?.gp_plan_id || "",
          forceInactive: true,
          forcedStatus: "past_due",
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error("stripeWebhook error:", error);
    res.status(500).send(error?.message || "Stripe webhook failed");
  }
});

async function acceptStudentReferralInternal({
  uid,
  decoded,
  referralToken,
  forcedTargetRole = null,
}) {
  const db = admin.firestore();
  const scannerUser = await getUserDocByUid(uid);

  if (!scannerUser) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const scannerRole = getNormalizedScannerRole(scannerUser, decoded);
  const detectedScannerEntityType = getScannerEntityType(scannerRole);

  if (!detectedScannerEntityType) {
    const err = new Error("Only school, agent, or tutor accounts can accept student QR");
    err.statusCode = 403;
    throw err;
  }

  const forcedEntityType = forcedTargetRole ? getScannerEntityType(forcedTargetRole) : null;

  if (forcedTargetRole && !forcedEntityType) {
    const err = new Error("Invalid forced scanner role");
    err.statusCode = 400;
    throw err;
  }

  if (forcedEntityType && forcedEntityType !== detectedScannerEntityType) {
    const err = new Error(
      `This endpoint requires a ${forcedEntityType} account, but your account is ${detectedScannerEntityType}`
    );
    err.statusCode = 403;
    throw err;
  }

  const scannerEntityType = forcedEntityType || detectedScannerEntityType;

  const q = await db
    .collection("users")
    .where("studentReferralQrToken", "==", referralToken)
    .limit(1)
    .get();

  if (q.empty) {
    await writeQrScanLog({
      token: referralToken,
      tokenType: "student",
      studentId: null,
      schoolId: scannerEntityType === "school" ? uid : null,
      scannedBy: uid,
      result: "not_found",
      duplicate: false,
      meta: {
        scannerRole,
        scannerEntityType,
        forcedTargetRole: forcedTargetRole || null,
      },
    });

    const err = new Error("Student referral not found");
    err.statusCode = 404;
    throw err;
  }

  const studentDoc = q.docs[0];
  const studentId = studentDoc.id;
  const student = studentDoc.data() || {};
  const studentRole = getNormalizedStudentRole(student);

  if (!isStudentRole(studentRole)) {
    await writeQrScanLog({
      token: referralToken,
      tokenType: "student",
      studentId,
      schoolId: scannerEntityType === "school" ? uid : null,
      scannedBy: uid,
      result: "invalid_owner_role",
      duplicate: false,
      meta: {
        scannerRole,
        scannerEntityType,
        forcedTargetRole: forcedTargetRole || null,
      },
    });

    const err = new Error("Referral owner is not a student");
    err.statusCode = 403;
    throw err;
  }

  if (studentId === uid) {
    const err = new Error("You cannot scan your own student QR");
    err.statusCode = 400;
    throw err;
  }

  if (scannerEntityType === "school") {
    const school = await getSchoolOwnedByUser(uid);
    const schoolId = school?.id || uid;
    const schoolName =
      school?.name ||
      school?.school_name ||
      school?.institution_name ||
      pickDisplayName(scannerUser);

    const leadId = buildSchoolLeadDocId(schoolId, studentId);
    const leadRef = db.collection("school_leads").doc(leadId);
    const studentRef = db.collection("users").doc(studentId);

    const linkedAgentId =
      student.assigned_agent_id ||
      student.referred_by_agent_id ||
      null;

    const leadPayloadBase = {
      student_id: studentId,
      student_name: pickDisplayName(student),
      student_email: pickEmail(student),
      student_phone: pickPhone(student),

      school_id: schoolId,
      school_owner_user_id: uid,
      school_name: schoolName,

      status: "interested",
      source: "qr",
      lead_type: "qr",
      schoolLeadType: "qr",

      linked_agent_id: linkedAgentId || null,
      assigned_agent_id: student.assigned_agent_id || null,
      referred_by_agent_id: student.referred_by_agent_id || null,
    };

    let alreadyExists = false;

    await db.runTransaction(async (tx) => {
      const leadSnap = await tx.get(leadRef);

      if (leadSnap.exists) {
        alreadyExists = true;
        return;
      }

      tx.set(
        leadRef,
        {
          ...leadPayloadBase,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        studentRef,
        {
          assigned_school_id: schoolId,
          referredToSchoolId: schoolId,
          schoolLeadType: "qr",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (linkedAgentId) {
        const notifRef = db
          .collection("users")
          .doc(linkedAgentId)
          .collection("notifications")
          .doc(`school_qr_${schoolId}_${studentId}`);

        tx.set(
          notifRef,
          {
            type: "school_student_qr_interest",
            title: "A school scanned your student QR",
            body: `${schoolName} connected with ${pickDisplayName(student)}`,
            schoolId,
            schoolName,
            studentId,
            studentName: pickDisplayName(student),
            seen: false,
            readAt: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            link: `/schoolleads`,
          },
          { merge: true }
        );
      }
    });

    await writeQrScanLog({
      token: referralToken,
      tokenType: "student",
      studentId,
      schoolId,
      scannedBy: uid,
      result: alreadyExists ? "duplicate" : "accepted",
      duplicate: alreadyExists,
      leadId,
      meta: {
        scannerRole,
        scannerEntityType,
        forcedTargetRole: forcedTargetRole || null,
        targetCollection: "school_leads",
        linkedAgentId: linkedAgentId || null,
      },
    });

    return {
      ok: true,
      success: true,
      targetRole: "school",
      targetCollection: "school_leads",
      relationId: leadId,
      alreadyExists,
      student: sanitizeStudentPublic({ id: studentId, ...student }),
      school: {
        schoolId,
        schoolName,
      },
    };
  }

  if (scannerEntityType === "agent") {
    const relationId = buildAgentClientDocId(uid, studentId);
    const relationRef = db.collection("agent_clients").doc(relationId);
    const studentRef = db.collection("users").doc(studentId);

    const existingAssignedAgentId = student.assigned_agent_id || null;
    const existingReferredByAgentId = student.referred_by_agent_id || null;

    const ownershipLocked =
      !!existingAssignedAgentId && String(existingAssignedAgentId) !== String(uid);

    if (ownershipLocked) {
      await writeQrScanLog({
        token: referralToken,
        tokenType: "student",
        studentId,
        schoolId: null,
        scannedBy: uid,
        result: "blocked_locked_agent",
        duplicate: false,
        leadId: relationId,
        meta: {
          scannerRole,
          scannerEntityType,
          forcedTargetRole: forcedTargetRole || null,
          targetCollection: "agent_clients",
          existingAssignedAgentId,
          attemptedAgentId: uid,
        },
      });

      const err = new Error("This student is already assigned to another agent");
      err.statusCode = 409;
      throw err;
    }

    let alreadyExists = false;

    await db.runTransaction(async (tx) => {
      const relationSnap = await tx.get(relationRef);
      alreadyExists = relationSnap.exists;

      tx.set(
        relationRef,
        {
          agentId: uid,
          agent_id: uid,
          studentId,
          student_id: studentId,
          client_id: studentId,
          status: "active",
          source: "student_qr",
          acceptedByAgent: true,
          assignmentLocked: false,
          createdAt: relationSnap.exists
            ? relationSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const studentUpdate = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!existingReferredByAgentId) {
        studentUpdate.referred_by_agent_id = uid;
      }

      if (!existingAssignedAgentId) {
        studentUpdate.assigned_agent_id = uid;
      }

      tx.set(studentRef, studentUpdate, { merge: true });
    });

    const agentName = pickDisplayName(scannerUser);

    await createNotificationIfNeeded(
      uid,
      buildStudentReferralNotificationId("agent_student_qr", uid, studentId),
      {
        type: "agent_student_qr",
        title: alreadyExists ? "Student already in your list" : "Student added to your list",
        body: alreadyExists
          ? `${pickDisplayName(student)} is already in your student list`
          : `${pickDisplayName(student)} was added to your student list`,
        studentId,
        studentName: pickDisplayName(student),
        link: `/students`,
      }
    );

    await createNotificationIfNeeded(
      studentId,
      buildStudentReferralNotificationId("student_agent_qr", uid, studentId),
      {
        type: "student_agent_qr",
        title: "An agent scanned your QR",
        body: `${agentName} added you to their student list`,
        agentId: uid,
        agentName,
        link: `/connections`,
      }
    );

    await writeQrScanLog({
      token: referralToken,
      tokenType: "student",
      studentId,
      schoolId: null,
      scannedBy: uid,
      result: alreadyExists ? "duplicate" : "accepted",
      duplicate: alreadyExists,
      leadId: relationId,
      meta: {
        scannerRole,
        scannerEntityType,
        forcedTargetRole: forcedTargetRole || null,
        targetCollection: "agent_clients",
        ownershipLocked: false,
      },
    });

    return {
      ok: true,
      success: true,
      targetRole: "agent",
      targetCollection: "agent_clients",
      relationId,
      alreadyExists,
      ownershipLocked: false,
      student: sanitizeStudentPublic({ id: studentId, ...student }),
      agent: {
        agentId: uid,
        agentName,
      },
    };
  }

  if (scannerEntityType === "tutor") {
    const relationId = buildTutorStudentDocId(uid, studentId);
    const relationRef = db.collection("tutor_students").doc(relationId);
    const studentRef = db.collection("users").doc(studentId);

    let alreadyExists = false;

    await db.runTransaction(async (tx) => {
      const relationSnap = await tx.get(relationRef);
      alreadyExists = relationSnap.exists;

      tx.set(
        relationRef,
        {
          tutorId: uid,
          studentId,
          status: "active",
          source: "student_qr",
          acceptedByTutor: true,
          createdAt: relationSnap.exists
            ? relationSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        studentRef,
        {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    const tutorName = pickDisplayName(scannerUser);

    await createNotificationIfNeeded(
      uid,
      buildStudentReferralNotificationId("tutor_student_qr", uid, studentId),
      {
        type: "tutor_student_qr",
        title: alreadyExists ? "Student already in your list" : "Student added to your list",
        body: alreadyExists
          ? `${pickDisplayName(student)} is already in your student list`
          : `${pickDisplayName(student)} was added to your student list`,
        studentId,
        studentName: pickDisplayName(student),
        link: `/students`,
      }
    );

    await createNotificationIfNeeded(
      studentId,
      buildStudentReferralNotificationId("student_tutor_qr", uid, studentId),
      {
        type: "student_tutor_qr",
        title: "A tutor scanned your QR",
        body: `${tutorName} added you to their student list`,
        tutorId: uid,
        tutorName,
        link: `/connections`,
      }
    );

    await writeQrScanLog({
      token: referralToken,
      tokenType: "student",
      studentId,
      schoolId: null,
      scannedBy: uid,
      result: alreadyExists ? "duplicate" : "accepted",
      duplicate: alreadyExists,
      leadId: relationId,
      meta: {
        scannerRole,
        scannerEntityType,
        forcedTargetRole: forcedTargetRole || null,
        targetCollection: "tutor_students",
      },
    });

    return {
      ok: true,
      success: true,
      targetRole: "tutor",
      targetCollection: "tutor_students",
      relationId,
      alreadyExists,
      student: sanitizeStudentPublic({ id: studentId, ...student }),
      tutor: {
        tutorId: uid,
        tutorName,
      },
    };
  }

  const err = new Error("Invalid role");
  err.statusCode = 403;
  throw err;
}

exports.acceptStudentReferral = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { student_ref, token } = req.body || {};
      const referralToken = String(student_ref || token || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing student_ref token" });
      }

      const result = await acceptStudentReferralInternal({
        uid,
        decoded,
        referralToken,
      });

      return res.json(result);
    } catch (e) {
      console.error("acceptStudentReferral error:", e);
      return res.status(e?.statusCode || 500).json({
        error: e?.message || "Failed to accept student referral",
      });
    }
  });
});

exports.acceptStudentReferralToSchool = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { student_ref, token } = req.body || {};
      const referralToken = String(student_ref || token || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing student_ref token" });
      }

      const result = await acceptStudentReferralInternal({
        uid,
        decoded,
        referralToken,
        forcedTargetRole: "school",
      });

      return res.json(result);
    } catch (e) {
      console.error("acceptStudentReferralToSchool error:", e);
      return res.status(e?.statusCode || 500).json({
        error: e?.message || "Failed to accept student referral for school",
      });
    }
  });
});

exports.acceptStudentReferralToAgent = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { student_ref, token } = req.body || {};
      const referralToken = String(student_ref || token || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing student_ref token" });
      }

      const result = await acceptStudentReferralInternal({
        uid,
        decoded,
        referralToken,
        forcedTargetRole: "agent",
      });

      return res.json(result);
    } catch (e) {
      console.error("acceptStudentReferralToAgent error:", e);
      return res.status(e?.statusCode || 500).json({
        error: e?.message || "Failed to accept student referral for agent",
      });
    }
  });
});

exports.acceptStudentReferralToTutor = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "POST only" });
      }

      const { uid, decoded } = await requireBearerUid(req);
      const { student_ref, token } = req.body || {};
      const referralToken = String(student_ref || token || "").trim();

      if (!referralToken) {
        return res.status(400).json({ error: "Missing student_ref token" });
      }

      const result = await acceptStudentReferralInternal({
        uid,
        decoded,
        referralToken,
        forcedTargetRole: "tutor",
      });

      return res.json(result);
    } catch (e) {
      console.error("acceptStudentReferralToTutor error:", e);
      return res.status(e?.statusCode || 500).json({
        error: e?.message || "Failed to accept student referral for tutor",
      });
    }
  });
});

function randomCode(len = 48) {
  return crypto.randomBytes(len).toString("hex");
}

// POST /createAuthBridgeCode
exports.createAuthBridgeCode = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const idToken = match?.[1];

      if (!idToken) return res.status(401).json({ error: "Missing Authorization Bearer token" });

      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const code = randomCode(24);
      const now = Date.now();

      await admin.firestore().collection("auth_bridge_codes").doc(code).set({
        uid,
        createdAt: now,
        expiresAt: now + AUTH_BRIDGE_TTL_MS,
        used: false,
      });

      return res.json({ code, expiresInMs: AUTH_BRIDGE_TTL_MS });
    } catch (e) {
      console.error("createAuthBridgeCode error:", e);
      return res.status(500).json({ error: "Failed to create bridge code" });
    }
  });
});

// POST /exchangeAuthBridgeCode
exports.exchangeAuthBridgeCode = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { code } = req.body || {};
      if (!code || typeof code !== "string") return res.status(400).json({ error: "Missing code" });

      const ref = admin.firestore().collection("auth_bridge_codes").doc(code);
      const snap = await ref.get();

      if (!snap.exists) return res.status(400).json({ error: "Invalid code" });

      const data = snap.data() || {};
      const now = Date.now();

      if (data.used) return res.status(400).json({ error: "Code already used" });
      if (!data.expiresAt || now > data.expiresAt) {
        return res.status(400).json({ error: "Code expired" });
      }

      await ref.set({ used: true, usedAt: now }, { merge: true });

      const customToken = await admin.auth().createCustomToken(data.uid);
      return res.json({ customToken });
    } catch (e) {
      console.error("exchangeAuthBridgeCode error:", e);
      return res.status(500).json({ error: "Failed to exchange bridge code" });
    }
  });
});

// ============================
// Invites (Create / Accept / Revoke)
// ============================

exports.createInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid, decoded } = await requireBearerUid(req);
      const { invitedRole, invitedEmail, mode } = req.body || {};

      const r = normalizeRole(invitedRole);
      const m = String(mode || "").toLowerCase().trim();
      const email = (invitedEmail || "").toString().trim().toLowerCase();

      if (r !== "agent" && r !== "school" && r !== "student" && r !== "collaborator") {
        return res.status(400).json({ error: "Invalid invitedRole" });
      }

      if (m !== "email" && m !== "link") {
        return res.status(400).json({ error: "Invalid mode" });
      }

      if (m === "email" && !email) {
        return res.status(400).json({ error: "invitedEmail required for email mode" });
      }

      const inviterRole = await getUserRoleForInvite(uid, decoded);
      assertRoleCanInvite(inviterRole, r);

      const inviterName = await getInviterDisplayName(uid, decoded);
      const invitedRoleLabel = INVITE_ROLE_LABELS[r] || r;

      const rawToken = randomToken(32);
      const tokenHash = sha256(rawToken + INVITE_PEPPER);

      const now = Date.now();
      const expiresAtMs = now + INVITE_TTL_MS;

      const inviteRef = admin.firestore().collection("invites").doc();
      await inviteRef.set({
        tokenHash,
        invitedEmail: email,
        invitedRole: r,
        inviterId: uid,
        inviterRole,
        inviterName,
        mode: m,
        status: "active",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
        usedAt: null,
        usedByUid: null,
      });

      const base = "https://greenpassgroup.com";
      const inviteLink = `${base}/join?invite=${encodeURIComponent(
        inviteRef.id
      )}&token=${encodeURIComponent(rawToken)}`;

      if (m === "email") {
        await admin.firestore().collection("mail").add({
          to: email,
          from: `${inviterName} <info@greenpassgroup.com>`,
          message: {
            subject: `${inviterName} invited you to GreenPass (${invitedRoleLabel})`,
            html: `
              <div style="font-family: Arial, Helvetica, sans-serif; background:#f5f7fa; padding:24px;">
                <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                  <div style="background:#0f766e; color:#ffffff; padding:20px 24px;">
                    <h1 style="margin:0; font-size:22px;">You’re invited to GreenPass</h1>
                    <p style="margin:6px 0 0; font-size:13px; opacity:0.9;">
                      Your gateway to students, agents, tutors, and schools
                    </p>
                  </div>
                  <div style="padding:24px; color:#1f2937;">
                    <p style="font-size:15px; line-height:1.6;">Hi there 👋,</p>

                    <p style="font-size:15px; line-height:1.6;">
                      <strong>${inviterName}</strong> invited you to join GreenPass as a
                      <strong> ${invitedRoleLabel}</strong>.
                    </p>

                    <p style="font-size:15px; line-height:1.6;">
                      GreenPass is a professional platform for the international education sector,
                      connecting students, schools, agents, and tutors in a trusted and transparent environment.
                    </p>

                    <div style="text-align:center; margin:28px 0;">
                      <a href="${inviteLink}"
                        style="display:inline-block; background:#16a34a; color:#ffffff; text-decoration:none; padding:14px 26px; border-radius:8px; font-weight:600;">
                        Accept Invitation
                      </a>
                    </div>

                    <p style="font-size:13px; color:#6b7280; margin-bottom:6px;">
                      If the button doesn’t work, copy and paste this link into your browser:
                    </p>

                    <p style="font-size:12px; background:#f3f4f6; padding:10px 12px; border-radius:6px; word-break:break-all;">
                      ${inviteLink}
                    </p>

                    <p style="font-size:13px; color:#6b7280; margin-top:20px;">
                      If you didn’t expect this invitation, you can safely ignore this email.
                    </p>
                  </div>

                  <div style="background:#f9fafb; padding:14px 24px; text-align:center; font-size:12px; color:#9ca3af;">
                    © ${new Date().getFullYear()} GreenPass Group · All rights reserved
                  </div>
                </div>
              </div>
            `,
            text: `${inviterName} invited you to join GreenPass as a ${invitedRoleLabel}.

Open this link to accept your invitation:
${inviteLink}

If you didn’t expect this invitation, you can safely ignore this email.`,
          },
        });
      }

      return res.json({ inviteId: inviteRef.id, inviteLink, expiresInMs: INVITE_TTL_MS });
    } catch (e) {
      console.error("createInvite error:", e);
      const msg = e?.message || "Failed to create invite";
      const code = msg.toLowerCase().includes("missing authorization") ? 401 : 500;
      return res.status(code).json({ error: msg });
    }
  });
});

exports.getInviteRolePublic = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      const inviteId = String(req.query.inviteId || "");
      const token = String(req.query.token || "");

      if (!inviteId || !token) {
        return res.status(400).json({ ok: false, error: "Missing inviteId or token" });
      }

      const snap = await admin.firestore().collection("invites").doc(inviteId).get();
      if (!snap.exists) {
        return res.status(404).json({ ok: false, error: "Invite not found" });
      }

      const invite = snap.data() || {};
      const expectedHash = sha256(token + INVITE_PEPPER);
      if (invite.tokenHash !== expectedHash) {
        return res.status(403).json({ ok: false, error: "Invalid token" });
      }

      if (invite.status !== "active") {
        return res.status(403).json({ ok: false, error: "Invite not active" });
      }

      if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) {
        return res.status(403).json({ ok: false, error: "Invite expired" });
      }

      if (invite.usedAt || invite.usedByUid) {
        return res.status(403).json({ ok: false, error: "Invite already used" });
      }

      const role = invite.invitedRole;
      if (!role) {
        return res.status(500).json({ ok: false, error: "Invite role missing" });
      }

      return res.json({
        ok: true,
        role,
        invitedEmail: invite.invitedEmail || null,
      });
    } catch (e) {
      console.error("getInviteRolePublic error:", e);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });
});

exports.acceptInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid, decoded } = await requireBearerUid(req);
      const authedEmail = (decoded?.email || "").toString().toLowerCase();

      const { inviteId, token } = req.body || {};
      if (!inviteId || !token) {
        return res.status(400).json({ error: "Missing inviteId/token" });
      }

      const inviteRef = admin.firestore().doc(`invites/${inviteId}`);
      const userRef = admin.firestore().doc(`users/${uid}`);

      await admin.firestore().runTransaction(async (tx) => {
        const invSnap = await tx.get(inviteRef);
        if (!invSnap.exists) throw new Error("Invite not found");

        const inv = invSnap.data() || {};
        if (inv.status !== "active") throw new Error("Invite not active");

        const exp = inv.expiresAt;
        if (exp?.toMillis && exp.toMillis() < Date.now()) throw new Error("Invite expired");

        const computed = sha256(String(token) + INVITE_PEPPER);
        if (computed !== inv.tokenHash) throw new Error("Invalid token");

        const invitedEmail = String(inv.invitedEmail || "").toLowerCase();
        if (invitedEmail && invitedEmail !== authedEmail) {
          throw new Error("This invite is tied to a different email");
        }

        const invitedRole = normalizeRole(inv.invitedRole);
        if (
          invitedRole !== "agent" &&
          invitedRole !== "school" &&
          invitedRole !== "student" &&
          invitedRole !== "collaborator"
        ) {
          throw new Error("Invalid invited role");
        }

        const userSnap = await tx.get(userRef);
        const existingUser = userSnap.exists ? userSnap.data() || {} : {};

        if (invitedRole === "collaborator") {
          const existingBaseRole = normalizeRole(
            existingUser.role ||
              existingUser.user_type ||
              existingUser.selected_role ||
              existingUser.userType
          );

          const safeBaseRole =
            existingBaseRole && existingBaseRole !== "collaborator"
              ? existingBaseRole
              : "student";

          const collaboratorReferralCode = buildCollaboratorReferralCode(existingUser, uid);
          const collaboratorReferralLink = buildCollaboratorReferralLink(collaboratorReferralCode);

          tx.set(
            userRef,
            {
              role: safeBaseRole,

              is_collaborator: true,
              collaborator_status: "approved",
              collaborator_tier: existingUser.collaborator_tier || "bronze",
              collaborator_referral_code: collaboratorReferralCode,
              collaborator_referral_link: collaboratorReferralLink,
              collaborator_invited_total: Number(existingUser.collaborator_invited_total || 0),
              collaborator_completed_profiles: Number(existingUser.collaborator_completed_profiles || 0),
              collaborator_verified_users: Number(existingUser.collaborator_verified_users || 0),
              collaborator_estimated_rewards: Number(existingUser.collaborator_estimated_rewards || 0),
              invited_as_collaborator_by_admin: true,

              onboarding_completed:
                typeof existingUser.onboarding_completed === "boolean"
                  ? existingUser.onboarding_completed
                  : false,
              onboarding_step: existingUser.onboarding_step || "basic_info",

              invited_by: {
                uid: inv.inviterId || "",
                role: inv.inviterRole || "",
                inviteId,
              },

              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              email: authedEmail || admin.firestore.FieldValue.delete(),
            },
            { merge: true }
          );
        } else {
          const inviterId = String(inv.inviterId || "").trim();
          const inviterRole = normalizeRole(inv.inviterRole);
          const isAgentInvitingStudent =
            inviterRole === "agent" && invitedRole === "student" && !!inviterId;

          const userPayload = {
            role: invitedRole,
            onboarding_completed: false,
            onboarding_step: "basic_info",
            invited_by: {
              uid: inviterId,
              role: inv.inviterRole || "",
              inviteId,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            email: authedEmail || admin.firestore.FieldValue.delete(),
          };

          if (isAgentInvitingStudent) {
            userPayload.assigned_agent_id = inviterId;
            userPayload.referred_by_agent_id = inviterId;
            userPayload.referralType = "invite";
          }

          tx.set(userRef, userPayload, { merge: true });
        }

        tx.update(inviteRef, {
          status: "used",
          usedAt: admin.firestore.FieldValue.serverTimestamp(),
          usedByUid: uid,
        });
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error("acceptInvite error:", e);
      const msg = e?.message || "Failed to accept invite";
      const low = String(msg).toLowerCase();
      const code = low.includes("missing authorization")
        ? 401
        : low.includes("not found")
        ? 404
        : 400;

      return res.status(code).json({ error: msg });
    }
  });
});

exports.revokeInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid, decoded } = await requireBearerUid(req);
      const { inviteId } = req.body || {};
      if (!inviteId) return res.status(400).json({ error: "Missing inviteId" });

      const inviterRole = await getUserRoleForInvite(uid, decoded);
      const isAdmin = normalizeRole(inviterRole) === "admin";

      const ref = admin.firestore().doc(`invites/${inviteId}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Invite not found" });
      const inv = snap.data() || {};

      if (!isAdmin && inv.inviterId !== uid) return res.status(403).json({ error: "Not allowed" });
      if (inv.status !== "active") return res.status(400).json({ error: "Invite is not active" });

      await ref.update({
        status: "revoked",
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error("revokeInvite error:", e);
      return res.status(500).json({ error: e?.message || "Failed to revoke invite" });
    }
  });
});

/**
 * =========================================================
 * ORG INVITES (Secure, Zoho-style)
 * =========================================================
 */

const ORG_INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ORG_INVITE_PEPPER = "org_invite_pepper_v1";

function normalizeOrgMemberRole(r) {
  const x = String(r || "member").toLowerCase().trim();
  if (x === "owner" || x === "admin" || x === "staff" || x === "member") return x;
  return "member";
}

async function requireOrgOwnerOrAdmin(uid, orgId) {
  const orgSnap = await admin.firestore().collection("organizations").doc(orgId).get();
  if (!orgSnap.exists) throw new Error("Organization not found");
  const org = orgSnap.data() || {};
  if (org.ownerId !== uid) {
    const uSnap = await admin.firestore().collection("users").doc(uid).get();
    const ud = uSnap.exists ? uSnap.data() || {} : {};
    const role = String(ud.role || ud.user_role || "").toLowerCase();
    if (role !== "admin" && role !== "advisor" && role !== "superadmin") {
      throw new Error("Not authorized");
    }
  }
  return orgSnap;
}

function sha256hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function safeOrigin() {
  return "https://app.greenpassgroup.com";
}

exports.createOrgInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid } = await requireBearerUid(req);
      const { orgId, email, role } = req.body || {};

      const orgIdStr = String(orgId || "").trim();
      const invitedEmail = String(email || "").trim().toLowerCase();
      const invitedRole = normalizeOrgMemberRole(role);

      if (!orgIdStr) return res.status(400).json({ error: "orgId required" });
      if (!invitedEmail || !invitedEmail.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const orgSnap = await requireOrgOwnerOrAdmin(uid, orgIdStr);
      const org = orgSnap.data() || {};

      try {
        const usersCol = admin.firestore().collection("users");

        const q1 = await usersCol.where("emailLower", "==", invitedEmail).limit(1).get();
        const q2 = q1.empty ? await usersCol.where("email", "==", invitedEmail).limit(1).get() : q1;

        if (!q2.empty) {
          const existingUser = q2.docs[0].data() || {};
          if (existingUser.orgId) {
            return res.status(400).json({ error: "This email already belongs to an organization." });
          }
        }
      } catch (e) {
        console.warn("[createOrgInvite] org check skipped:", e?.message || e);
      }

      const baseSlots = Number(org.baseSlots ?? 5);
      const extraSlots = Number(org.extraSlots ?? 0);
      const totalSlots = Number(org.totalSlots ?? baseSlots + extraSlots);
      const usedSlots = Number(org.usedSlots ?? 0);
      if (usedSlots >= totalSlots) {
        return res.status(400).json({ error: "Slot limit reached" });
      }

      const rawToken = randomToken(32);
      const tokenHash = sha256hex(rawToken + ORG_INVITE_PEPPER);

      const now = Date.now();
      const expiresAtMs = now + ORG_INVITE_TTL_MS;

      const invRef = admin.firestore().collection("org_invites").doc();
      await invRef.set({
        orgId: orgIdStr,
        orgName: String(org.name || ""),
        email: invitedEmail,
        role: invitedRole,
        tokenHash,
        status: "pending",
        invitedBy: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
        acceptedAt: null,
        acceptedBy: null,
        revokedAt: null,
        revokedBy: null,
      });

      const base = safeOrigin();
      const inviteLink = `${base}/accept-org-invite?invite=${encodeURIComponent(
        invRef.id
      )}&token=${encodeURIComponent(rawToken)}`;

      await admin.firestore().collection("mail").add({
        to: invitedEmail,
        message: {
          subject: `Invitation to join ${org.name || "an organization"} on GreenPass`,
          html: `
            <div style="font-family: Arial, Helvetica, sans-serif; background:#f5f7fa; padding:24px;">
              <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,0.08);">
                <div style="background:#0f766e; color:#fff; padding:20px 24px;">
                  <h2 style="margin:0; font-size:22px;">You’re Invited to Join ${org.name}</h2>
                  <p style="margin:6px 0 0; font-size:13px; opacity:.9;">GreenPass Organization Access</p>
                </div>

                <div style="padding:24px; color:#111827;">
                  <p style="font-size:15px; margin:0 0 12px;">Hello 👋</p>

                  <p style="font-size:15px; line-height:1.6;">
                    You’ve been invited to join <strong>${org.name}</strong> on GreenPass as a
                    <strong>${invitedRole}</strong>.
                  </p>

                  <div style="background:#f3f4f6; padding:16px; border-radius:10px; margin:18px 0;">
                    <p style="margin:0 0 6px; font-size:14px;"><strong>Organization:</strong> ${org.name}</p>
                    <p style="margin:0 0 6px; font-size:14px;"><strong>Your Role:</strong> ${invitedRole}</p>
                    <p style="margin:0; font-size:14px;"><strong>Email:</strong> ${invitedEmail}</p>
                  </div>

                  <p style="font-size:14px; line-height:1.6;">
                    Once accepted, you will gain access to your organization dashboard where you can collaborate with your team, manage records, and operate securely within the GreenPass platform.
                  </p>

                  <div style="text-align:center; margin:28px 0;">
                    <a href="${inviteLink}"
                      style="display:inline-block; background:#10b981; color:#fff; text-decoration:none; padding:14px 26px; border-radius:10px; font-weight:700; font-size:15px;">
                      Accept Invitation
                    </a>
                  </div>

                  <p style="font-size:12px; color:#6b7280; margin-bottom:6px;">
                    If the button doesn’t work, copy and paste this link into your browser:
                  </p>

                  <div style="font-size:12px; background:#f9fafb; padding:10px 12px; border-radius:10px; word-break:break-all;">
                    ${inviteLink}
                  </div>

                  <p style="font-size:12px; color:#6b7280; margin-top:18px;">
                    🔒 This invitation is valid for 7 days and can only be used by the email address it was sent to.
                  </p>

                  <p style="font-size:12px; color:#6b7280;">
                    If you were not expecting this invitation, you may safely ignore this email.
                  </p>
                </div>

                <div style="background:#f9fafb; padding:14px 18px; text-align:center; font-size:12px; color:#9ca3af;">
                  © ${new Date().getFullYear()} GreenPass Group · All rights reserved
                </div>
              </div>
            </div>
            `,
          text: `You’ve been invited to join ${org.name || "an organization"}.

Open this link to accept:
${inviteLink}

This invite expires in 7 days.`,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, inviteId: invRef.id, inviteLink });
    } catch (err) {
      console.error("createOrgInvite error:", err);
      return res.status(500).json({ error: err.message || "createOrgInvite failed" });
    }
  });
});

exports.revokeOrgInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid } = await requireBearerUid(req);
      const { inviteId } = req.body || {};
      const invId = String(inviteId || "").trim();
      if (!invId) return res.status(400).json({ error: "inviteId required" });

      const invRef = admin.firestore().collection("org_invites").doc(invId);
      const invSnap = await invRef.get();
      if (!invSnap.exists) return res.status(404).json({ error: "Invite not found" });

      const inv = invSnap.data() || {};
      await requireOrgOwnerOrAdmin(uid, inv.orgId);

      if (String(inv.status || "").toLowerCase() !== "pending") {
        return res.status(400).json({ error: "Only pending invites can be revoked" });
      }

      await invRef.update({
        status: "revoked",
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedBy: uid,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("revokeOrgInvite error:", err);
      return res.status(500).json({ error: err.message || "revokeOrgInvite failed" });
    }
  });
});

exports.getOrgInvitePublic = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const inviteId = String(req.query?.invite || req.body?.invite || "").trim();
      const token = String(req.query?.token || req.body?.token || "").trim();
      if (!inviteId || !token) return res.status(400).json({ error: "invite and token required" });

      const invRef = admin.firestore().collection("org_invites").doc(inviteId);
      const invSnap = await invRef.get();
      if (!invSnap.exists) return res.status(404).json({ error: "Invite not found" });

      const inv = invSnap.data() || {};
      const now = Date.now();

      const expiresAtMs = inv.expiresAt?.toMillis ? inv.expiresAt.toMillis() : null;
      if (expiresAtMs && now > expiresAtMs) {
        return res.json({
          ok: true,
          status: "expired",
          orgName: inv.orgName || "",
          email: inv.email || "",
          role: inv.role || "member",
        });
      }

      const expected = inv.tokenHash;
      const actual = sha256hex(token + ORG_INVITE_PEPPER);
      if (!expected || expected !== actual) return res.status(403).json({ error: "Invalid token" });

      return res.json({
        ok: true,
        status: inv.status || "pending",
        orgId: inv.orgId,
        orgName: inv.orgName || "",
        email: inv.email || "",
        role: inv.role || "member",
        expiresAt: expiresAtMs,
      });
    } catch (err) {
      console.error("getOrgInvitePublic error:", err);
      return res.status(500).json({ error: err.message || "getOrgInvitePublic failed" });
    }
  });
});

exports.acceptOrgInvite = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

      const { uid, decoded } = await requireBearerUid(req);
      const inviteId = String(req.body?.invite || "").trim();
      const token = String(req.body?.token || "").trim();
      if (!inviteId || !token) return res.status(400).json({ error: "invite and token required" });

      const userEmail = String(decoded?.email || "").toLowerCase();
      if (!userEmail) return res.status(400).json({ error: "User email missing" });

      const invRef = admin.firestore().collection("org_invites").doc(inviteId);
      const orgs = admin.firestore().collection("organizations");
      const members = admin.firestore().collection("organization_members");
      const users = admin.firestore().collection("users");

      await admin.firestore().runTransaction(async (tx) => {
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists) throw new Error("Invite not found");

        const inv = invSnap.data() || {};

        const expiresAtMs = inv.expiresAt?.toMillis ? inv.expiresAt.toMillis() : null;
        if (expiresAtMs && Date.now() > expiresAtMs) throw new Error("Invite expired");

        if (String(inv.status || "").toLowerCase() !== "pending") throw new Error("Invite not pending");

        const expected = inv.tokenHash;
        const actual = sha256hex(token + ORG_INVITE_PEPPER);
        if (!expected || expected !== actual) throw new Error("Invalid token");

        const invEmail = String(inv.email || "").toLowerCase();
        if (!invEmail || invEmail !== userEmail) throw new Error("Email mismatch");

        const orgRef = orgs.doc(String(inv.orgId || ""));
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists) throw new Error("Organization not found");

        const org = orgSnap.data() || {};
        const baseSlots = Number(org.baseSlots ?? 5);
        const extraSlots = Number(org.extraSlots ?? 0);
        const totalSlots = Number(org.totalSlots ?? baseSlots + extraSlots);
        const usedSlots = Number(org.usedSlots ?? 0);

        if (usedSlots >= totalSlots) throw new Error("Slot limit reached");

        const memberDocId = `${orgRef.id}_${uid}`;
        const memRef = members.doc(memberDocId);
        const memSnap = await tx.get(memRef);
        if (memSnap.exists) {
          tx.update(invRef, {
            status: "accepted",
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            acceptedBy: uid,
          });
          return;
        }

        tx.set(memRef, {
          orgId: orgRef.id,
          userId: uid,
          email: userEmail,
          role: normalizeOrgMemberRole(inv.role),
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(orgRef, { usedSlots: usedSlots + 1 });

        tx.update(invRef, {
          status: "accepted",
          acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
          acceptedBy: uid,
        });

        tx.set(users.doc(uid), { orgId: orgRef.id }, { merge: true });
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("acceptOrgInvite error:", err);
      return res.status(500).json({ error: err.message || "acceptOrgInvite failed" });
    }
  });
});

/**
 * =========================================================
 * Tutor Planner: 1-hour reminder notifications
 * =========================================================
 */

function getSessionTutorUid(session) {
  return (
    session?.tutor_auth_uid ||
    session?.tutor_uid ||
    session?.tutor_id ||
    session?.tutorId ||
    null
  );
}

function getSessionTutorEmail(session) {
  const email = session?.tutor_email || session?.tutorEmail || "";
  return String(email || "").trim().toLowerCase();
}

function getSessionStudentName(session) {
  return (
    session?.studentName ||
    session?.student_name ||
    session?.studentFullName ||
    session?.student_full_name ||
    session?.student ||
    "Student"
  );
}

function getSessionTitle(session) {
  return (
    session?.title ||
    session?.subject ||
    session?.sessionTitle ||
    session?.session_title ||
    "Tutoring Session"
  );
}

async function resolveTutorUidFromSession(session) {
  const directUid = getSessionTutorUid(session);
  if (directUid) return directUid;

  const tutorEmail = getSessionTutorEmail(session);
  if (!tutorEmail) return null;

  const db = admin.firestore();

  let snap = await db
    .collection("users")
    .where("email", "==", tutorEmail)
    .limit(1)
    .get();

  if (!snap.empty) return snap.docs[0].id;

  snap = await db
    .collection("users")
    .where("emailLower", "==", tutorEmail)
    .limit(1)
    .get();

  if (!snap.empty) return snap.docs[0].id;

  return null;
}

exports.sendTutorSessionReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Toronto",
    retryCount: 0,
    memory: "256MiB",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();

    const windowStart = admin.firestore.Timestamp.fromDate(
      new Date(now.getTime() + 55 * 60 * 1000)
    );
    const windowEnd = admin.firestore.Timestamp.fromDate(
      new Date(now.getTime() + 65 * 60 * 1000)
    );

    const snap = await db
      .collection("tutoring_sessions")
      .where("start", ">=", windowStart)
      .where("start", "<=", windowEnd)
      .orderBy("start", "asc")
      .get();

    if (snap.empty) return;

    for (const docSnap of snap.docs) {
      const sessionId = docSnap.id;
      const session = docSnap.data() || {};

      const status = String(session?.status || "booked").toLowerCase().trim();
      if (["cancelled", "completed"].includes(status)) continue;

      const tutorUid = await resolveTutorUidFromSession(session);
      if (!tutorUid) {
        console.warn("[sendTutorSessionReminders] tutor UID not resolved for session", sessionId);
        continue;
      }

      const startTs = session?.start;
      const endTs = session?.end;
      const startDate = startTs?.toDate ? startTs.toDate() : null;
      const endDate = endTs?.toDate ? endTs.toDate() : null;

      if (!startDate) continue;

      const title = getSessionTitle(session);
      const studentName = getSessionStudentName(session);

      const notifId = `session_1h_${sessionId}`;
      const notifRef = db.doc(`users/${tutorUid}/notifications/${notifId}`);
      const notifSnap = await notifRef.get();
      if (notifSnap.exists) continue;

      const body = `${title} with ${studentName} starts at ${startDate.toLocaleTimeString("en-CA", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/Toronto",
      })} in about 1 hour.`;

      await notifRef.set(
        {
          type: "tutoring_session_reminder",
          sessionId,
          tutorId: tutorUid,
          studentName,
          subject: session?.subject || "",
          sessionStatus: status,
          title: "Upcoming tutoring session",
          body,
          link: "/tutorplanner",
          seen: false,
          readAt: null,
          start: startTs || null,
          end: endTs || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reminderType: "1_hour_before",
        },
        { merge: true }
      );

      await db.collection("tutoring_sessions").doc(sessionId).set(
        {
          reminderOneHourSentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      console.log("[sendTutorSessionReminders] reminder sent", {
        sessionId,
        tutorUid,
        start: startDate.toISOString(),
        end: endDate?.toISOString?.() || null,
      });
    }
  }
);

exports.syncCollaboratorReferralOnUserCreate = onDocumentCreated(
  "users/{userId}",
  async (event) => {
    try {
      const after = event.data?.data?.() || {};
      await syncCollaboratorReferralForUser(event.params.userId, {}, after);
    } catch (err) {
      console.error("syncCollaboratorReferralOnUserCreate error:", err);
    }
  }
);

exports.syncCollaboratorReferralOnUserUpdate = onDocumentUpdated(
  "users/{userId}",
  async (event) => {
    try {
      const before = event.data?.before?.data?.() || {};
      const after = event.data?.after?.data?.() || {};
      await syncCollaboratorReferralForUser(event.params.userId, before, after);
    } catch (err) {
      console.error("syncCollaboratorReferralOnUserUpdate error:", err);
    }
  }
);