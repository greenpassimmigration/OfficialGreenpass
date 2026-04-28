// src/api/messaging.js

import { db } from "@/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

/* ===============================
   CONSTANTS
================================ */

export const MESSAGE_CATEGORIES = {
  AGENT_TUTOR: "agent_tutor",
  VENDOR: "vendor",
  SUPPORT: "support",
};

export const MESSAGING_LIMITS = {
  FREE_AGENT_TUTOR_CONV_PER_MONTH: 5,
  FREE_VENDOR_CONV_PER_MONTH: 5,
  FREE_STUDENT_MAX_MESSAGES_PER_CONVO: 3,
  PRO_MAX_OUTBOUND_UNTIL_REPLY: 3,
};


/* ===============================
   FILE UPLOAD (ATTACHMENTS)
================================ */

function safeFileName(name) {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

export async function uploadMessageAttachments({ conversationId, senderId, files }) {
  if (!conversationId || !senderId) throw new Error("Missing conversationId/senderId");
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return [];

  const storage = getStorage();

  // Upload sequentially to keep it simple and predictable
  const out = [];
  for (const f of list) {
    const fname = safeFileName(f?.name);
    const path = `message_uploads/${conversationId}/${Date.now()}_${senderId}_${fname}`;
    const r = storageRef(storage, path);

    await uploadBytes(r, f, {
      contentType: f?.type || "application/octet-stream",
      customMetadata: {
        conversation_id: conversationId,
        sender_id: senderId,
        original_name: f?.name || "",
      },
    });

    const url = await getDownloadURL(r);

    out.push({
      name: f?.name || fname,
      size: Number(f?.size || 0),
      content_type: f?.type || "application/octet-stream",
      url,
      path,
      created_at: Date.now(),
    });
  }

  return out;
}

/* ===============================
   ROLE + SUBSCRIPTION HELPERS
================================ */

export function normalizeRole(r) {
  const v = String(r || "").toLowerCase().trim();
  // In GreenPass, many student accounts are stored as role "user"/"users".
  // Normalize all of these to "student" for app-level logic (rules may still map to "user").
  if (v === "student" || v === "students" || v === "user" || v === "users") return "student";
  if (v === "tutors") return "tutor";
  if (v === "agents") return "agent";
  if (v === "schools") return "school";
  return v || "user";
}

export function resolveUserRole(userDoc) {
  return normalizeRole(
    userDoc?.selected_role ||
      userDoc?.role ||
      userDoc?.signup_entry_role ||
      userDoc?.user_type ||
      userDoc?.userType ||
      "user"
  );
}

export function isSubscriptionActive(userDoc) {
  if (userDoc?.subscription_active === true) return true;
  const s = String(userDoc?.subscription_status || "").toLowerCase().trim();
  return ["active", "trialing", "paid", "subscribed"].includes(s);
}

export function isSubscriptionInactive(userDoc) {
  return !isSubscriptionActive(userDoc);
}

function isFreeStudent(userDoc) {
  const r = resolveUserRole(userDoc);
  if (!(r === "student" || r === "user")) return false;
  return !isSubscriptionActive(userDoc);
}

/* ===============================
   GLOBAL SUBSCRIPTION MODE
================================ */

async function getSubscriptionModeEnabled() {
  const snap = await getDoc(doc(db, "app_config", "subscription"));
  if (!snap.exists()) return true; // fail-safe ON
  return snap.data()?.enabled !== false;
}

/* ===============================
   USER DOC
================================ */

export async function getUserDoc(uid) {
  if (!uid) return null;
  if (uid === "support") return { id: "support", full_name: "Support", role: "support" };

  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { id: uid };
  return { id: snap.id, ...snap.data() };
}

/* ===============================
   REALTIME LISTENERS
================================ */

export function listenToMyConversations(myUid, callback, options = {}) {
  if (!myUid) return () => {};

  const inbox = String(options?.inbox || "my").toLowerCase().trim();
  const lim = Number(options?.limit || 50);

  // "my" -> conversations where I am a participant
  // "support" -> support inbox (participants contains the string "support")
  // "all" -> admin/debug (ordered list)
  const participantKey = inbox === "support" ? "support" : myUid;

  const base = [
    collection(db, "conversations"),
    where("participants", "array-contains", participantKey),
    orderBy("last_message_at", "desc"),
    limit(lim)
  ];

  const q = query(...base);

  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null),
    (err) => callback([], err)
  );
}

export function listenToMessages(conversationId, callback) {
  if (!conversationId) return () => {};

  const q = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("created_at", "asc"),
    limit(300)
  );

  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null),
    (err) => callback([], err)
  );
}

/* ===============================
   CONVERSATION CREATION
================================ */

function pairKey(a, b) {
  return [a, b].sort().join("__");
}

export async function ensureConversation({
  meId,
  meDoc,
  targetId,
  targetRole,
  source = "app",
}) {
  const meRole = resolveUserRole(meDoc);
  let toId = targetId;
  let toRole = normalizeRole(targetRole || "support");

  if (meRole === "student" && toRole === "school") {
    const assignedAgent = String(meDoc?.assigned_agent_id || "").trim();
    if (assignedAgent) {
      toId = assignedAgent;
      toRole = "agent";
    } else {
      toId = "support";
      toRole = "support";
    }
  }

  const pkey = pairKey(meId, toId);

  const qFind = query(collection(db, "conversations"), where("pair_key", "==", pkey), limit(1));
  const snap = await getDocs(qFind);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  const ref = await addDoc(collection(db, "conversations"), {
    pair_key: pkey,
    participants: [meId, toId],
    participants_map: { [meId]: true, [toId]: true },
    roles: { [meId]: meRole, [toId]: toRole },
    created_by: meId,
    source,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    last_message_at: null,
    last_message_text: "",
  });

  return { id: ref.id };
}

/* ===============================
   SEND MESSAGE (FIXED)
================================ */

export async function sendMessage({
  conversationId,
  conversation_id,
  conversationDoc,
  senderId,
  senderDoc,
  text,
  attachments = [],
}) {
  const cid = conversationId || conversation_id;
  const t = String(text || "").trim();
  const atts = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

  if (!cid || !senderId || (!t && atts.length === 0)) return;

  const senderRole = resolveUserRole(senderDoc);
  const subscriptionModeEnabled = await getSubscriptionModeEnabled();

  // Free student cap (counts messages, including attachments)
  if (isFreeStudent(senderDoc) && senderRole === "student") {
    const qMine = query(
      collection(db, "conversations", cid, "messages"),
      where("sender_id", "==", senderId),
      limit(MESSAGING_LIMITS.FREE_STUDENT_MAX_MESSAGES_PER_CONVO)
    );
    const snap = await getDocs(qMine);
    if (snap.size >= MESSAGING_LIMITS.FREE_STUDENT_MAX_MESSAGES_PER_CONVO) {
      const err = new Error("Free message limit reached");
      err.code = "FREE_STUDENT_MESSAGE_LIMIT";
      throw err;
    }
  }

  // Subscription enforcement ONLY when mode is ON
  if (
    subscriptionModeEnabled &&
    (senderRole === "agent" || senderRole === "tutor" || senderRole === "school") &&
    isSubscriptionInactive(senderDoc)
  ) {
    const err = new Error("Subscription required");
    err.code = "SUBSCRIPTION_REQUIRED";
    throw err;
  }

  const parts = conversationDoc?.participants || [];
  const toUserId = parts.find((x) => x !== senderId) || "support";

  const messageType =
    atts.length > 0
      ? (atts.length === 1 && String(atts[0]?.content_type || "").startsWith("image/") ? "image" : "file")
      : "text";

  await addDoc(collection(db, "conversations", cid, "messages"), {
    conversation_id: cid,
    sender_id: senderId,
    to_user_id: toUserId,
    text: t,
    attachments: atts,
    message_type: messageType,
    created_at: serverTimestamp(),
  });

  const lastText =
    t ||
    (atts.length === 1
      ? `📎 ${atts[0]?.name || "Attachment"}`
      : atts.length > 1
      ? `📎 ${atts.length} attachments`
      : "");

  await updateDoc(doc(db, "conversations", cid), {
    last_message_at: serverTimestamp(),
    last_message_text: lastText,
    updated_at: serverTimestamp(),
  });
}


/* ===============================
   REPORTING
================================ */

export async function createReport({
  reporterId,
  reporter_id,
  reporterDoc,
  conversationId,
  conversation_id,
  reportedUserId,
  reported_user_id,
  reportedRole,
  reason = "",
}) {
  const rid = reporterId || reporter_id;
  const cid = conversationId || conversation_id;
  const ruid = reportedUserId || reported_user_id;

  if (!rid || !cid || !ruid) throw new Error("Missing report fields");

  await addDoc(collection(db, "reports"), {
    reporter_id: rid,
    reporter_role: resolveUserRole(reporterDoc),
    conversation_id: cid,
    reported_user_id: ruid,
    reported_role: normalizeRole(reportedRole),
    reason,
    status: "open",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
}


/* ===============================
   AGREEMENT (FIX — RESTORED)
================================ */

export async function acceptMessagingAgreement(uid) {
  if (!uid) throw new Error("Missing uid");
  await updateDoc(doc(db, "users", uid), {
    messaging_agreement_accepted_at: serverTimestamp(),
  });
}