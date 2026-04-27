import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "@/firebase";
import { createPageUrl } from "@/utils";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { CreditCard, Lock, Paperclip } from "lucide-react";

import { useTr } from "@/i18n/useTr";
import {
  ensureConversation,
  getUserDoc,
  sendMessage,
  uploadMessageAttachments,
} from "@/api/messaging";
import {
  cancelFollowRequest,
  respondToFollowRequest,
  unfollowUser,
} from "@/api/follow";

function useQueryParams() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function normalizeRole(r) {
  const v = String(r || "").toLowerCase().trim();
  if (v === "student" || v === "students" || v === "user" || v === "users") return "student";
  if (v === "tutors") return "tutor";
  if (v === "agents") return "agent";
  if (v === "schools") return "school";
  return v || "user";
}

function resolveRole(userDoc) {
  return normalizeRole(
    userDoc?.selected_role ||
      userDoc?.role ||
      userDoc?.signup_entry_role ||
      userDoc?.user_type ||
      userDoc?.userType ||
      "user"
  );
}

const SUBSCRIPTION_REQUIRED_ROLES = new Set(["agent", "school", "tutor"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "paid",
  "subscribed",
]);
const INACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "",
  "none",
  "skipped",
  "inactive",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
  "canceled",
  "cancelled",
  "expired",
]);

function hasActiveSubscription(userDoc) {
  if (!userDoc) return false;

  const status = String(
    userDoc?.subscription_status || userDoc?.subscriptionStatus || ""
  )
    .toLowerCase()
    .trim();

  if (userDoc?.subscription_active === true || userDoc?.subscriptionActive === true) {
    return !INACTIVE_SUBSCRIPTION_STATUSES.has(status);
  }

  return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

function isSubscriptionLocked(userDoc, subscriptionModeEnabled) {
  if (!subscriptionModeEnabled) return false;

  const role = resolveRole(userDoc);
  if (!SUBSCRIPTION_REQUIRED_ROLES.has(role)) return false;

  return !hasActiveSubscription(userDoc);
}

function buildSubscriptionCheckoutUrl(userDoc, fallbackPath = "/connections") {
  const rawRole = resolveRole(userDoc);
  const role = SUBSCRIPTION_REQUIRED_ROLES.has(rawRole) ? rawRole : "agent";
  const existingPlan = String(
    userDoc?.subscription_plan || userDoc?.subscriptionPlan || ""
  ).trim();
  const plan = existingPlan || `${role}_monthly`;

  const query = new URLSearchParams({
    type: "subscription",
    role,
    plan,
    lock: "1",
    returnTo: fallbackPath || "/connections",
  });

  return `${createPageUrl("Checkout")}?${query.toString()}`;
}

async function fetchUsersByIds(ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  if (!unique.length) return {};

  const map = {};
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const qUsers = query(collection(db, "users"), where("__name__", "in", chunk));
    const snap = await getDocs(qUsers);
    snap.forEach((d) => {
      map[d.id] = { id: d.id, ...d.data() };
    });
    chunk.forEach((uid) => {
      if (!map[uid]) map[uid] = { id: uid };
    });
  }
  return map;
}

export default function Connections() {
  const { tr } = useTr("connections_page");
  const navigate = useNavigate();
  const qp = useQueryParams();
  const { subscriptionModeEnabled } = useSubscriptionMode();

  const me = auth?.currentUser;
  const myUid = me?.uid;

  const initialTab = String(qp.get("tab") || "").toLowerCase();
  const [tab, setTab] = useState(
    initialTab === "requests" || initialTab === "followers" || initialTab === "following"
      ? initialTab
      : "requests"
  );

  const [roleFilter, setRoleFilter] = useState("all");
  const [myRole, setMyRole] = useState("user");
  const [meDoc, setMeDoc] = useState(null);

  const [requests, setRequests] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);

  const [usersById, setUsersById] = useState({});

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [massText, setMassText] = useState("");
  const [massFiles, setMassFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const followersFileInputRef = useRef(null);
  const followingFileInputRef = useRef(null);

  useEffect(() => {
    if (!myUid) return;

    const ref = collection(db, "users", myUid, "follow_requests");
    const qRef = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(qRef, (snap) => {
      const list = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        if (String(data.status || "pending").toLowerCase() === "pending") {
          list.push({ id: d.id, ...data });
        }
      });
      setRequests(list);
    });

    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    if (!myUid) return;
    const ref = collection(db, "users", myUid, "followers");
    const qRef = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qRef, (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() || {}) }));
      setFollowers(list);
    });
    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    if (!myUid) return;
    const ref = collection(db, "users", myUid, "following");
    const qRef = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qRef, (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() || {}) }));
      setFollowing(list);
    });
    return () => unsub();
  }, [myUid]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const ids = [
          ...requests.map((r) => r.id),
          ...followers.map((r) => r.id),
          ...following.map((r) => r.id),
        ];
        const map = await fetchUsersByIds(ids);
        if (!cancelled) setUsersById(map);
      } catch (e) {
        console.error("connections fetch users failed", e);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [requests, followers, following]);

  useEffect(() => {
    setSelectedIds(new Set());
    setMassText("");
    setMassFiles([]);
  }, [tab, roleFilter]);

  useEffect(() => {
    if (!myUid) return;

    let cancelled = false;
    (async () => {
      try {
        const docu = await getUserDoc(myUid);
        const r = resolveRole(docu);
        if (!cancelled) {
          setMeDoc(docu || null);
          setMyRole(r);
        }
      } catch (e) {
        console.error("failed to load my role", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myUid]);

  useEffect(() => {
    if (myRole === "student" && roleFilter === "student") {
      setRoleFilter("all");
    }
  }, [myRole, roleFilter]);

  const subscriptionLocked = useMemo(
    () => isSubscriptionLocked(meDoc, subscriptionModeEnabled),
    [meDoc, subscriptionModeEnabled]
  );

  const subscriptionCheckoutUrl = useMemo(() => {
    const currentPath = `${window.location.pathname}${window.location.search || ""}`;
    return buildSubscriptionCheckoutUrl(meDoc, currentPath);
  }, [meDoc]);

  const goToSubscription = () => {
    navigate(subscriptionCheckoutUrl);
  };

  const filteredList = useMemo(() => {
    const base = tab === "followers" ? followers : tab === "following" ? following : requests;

    const roleSafeBase =
      myRole === "student"
        ? base.filter((item) => {
            const u = usersById[item.id] || {};
            return resolveRole(u) !== "student";
          })
        : base;

    if (roleFilter === "all") return roleSafeBase;
    return roleSafeBase.filter((item) => {
      const u = usersById[item.id] || {};
      return resolveRole(u) === roleFilter;
    });
  }, [tab, followers, following, requests, roleFilter, usersById, myRole]);

  const toggleSelect = (uid) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const acceptRequest = async (followerId) => {
    if (!myUid || !followerId) return;
    await respondToFollowRequest({ followeeId: myUid, followerId, decision: "accepted" });
  };

  const declineRequest = async (followerId) => {
    if (!myUid || !followerId) return;
    await respondToFollowRequest({ followeeId: myUid, followerId, decision: "declined" });
  };

  const removeFollower = async (followerId) => {
    if (!myUid || !followerId) return;
    await deleteDoc(doc(db, "users", myUid, "followers", followerId)).catch(() => {});
  };

  const unfollow = async (followeeId) => {
    if (!myUid || !followeeId) return;
    await unfollowUser({ followerId: myUid, followeeId });
  };

  const cancelRequest = async (followeeId) => {
    if (!myUid || !followeeId) return;
    await cancelFollowRequest({ followerId: myUid, followeeId });
  };

  const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

  const canMassMessage = tab === "followers" || tab === "following";

  const onPickMassFiles = (e) => {
    if (subscriptionLocked) {
      try {
        e.target.value = "";
      } catch {}
      return;
    }

    const list = Array.from(e?.target?.files || []);
    if (!list.length) return;

    const tooBig = list.filter((f) => (f?.size || 0) > MAX_ATTACHMENT_BYTES);
    const ok = list.filter((f) => (f?.size || 0) <= MAX_ATTACHMENT_BYTES);

    if (tooBig.length) {
      const names = tooBig.slice(0, 3).map((f) => f.name).join(", ");
      const more = tooBig.length > 3 ? ` (+${tooBig.length - 3} more)` : "";
      alert(
        `${tr("file_too_large_4mb", "Một số tệp lớn hơn 4MB nên không được thêm.")} ${names}${more}`
      );
    }

    if (!ok.length) {
      try {
        e.target.value = "";
      } catch {}
      return;
    }

    setMassFiles((prev) => {
      const next = [...(prev || []), ...ok];
      const seen = new Set();
      return next.filter((f) => {
        const k = `${f.name}__${f.size}__${f.lastModified}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });

    try {
      e.target.value = "";
    } catch {}
  };

  const removeMassFile = (idx) => {
    setMassFiles((prev) => (prev || []).filter((_, i) => i !== idx));
  };

  const sendMass = async () => {
    if (!myUid) return;
    if (subscriptionLocked) {
      alert(
        tr(
          "subscription_required_mass_message",
          "Mass messaging is locked. Activate your subscription to continue."
        )
      );
      return;
    }
    const text = String(massText || "").trim();
    const files = Array.isArray(massFiles) ? massFiles : [];
    if (!text && files.length === 0) return;

    const targets = Array.from(selectedIds);
    if (!targets.length) return;

    setSending(true);
    try {
      const meDoc = await getUserDoc(myUid);

      for (const targetId of targets) {
        const targetDoc = usersById[targetId] || (await getUserDoc(targetId));
        const convo = await ensureConversation({
          meId: myUid,
          meDoc,
          targetId,
          targetRole: resolveRole(targetDoc),
          source: "connections_mass_message",
        });

        const atts = files.length
          ? await uploadMessageAttachments({ conversationId: convo.id, senderId: myUid, files })
          : [];

        await sendMessage({
          conversationId: convo.id,
          conversationDoc: convo,
          senderId: myUid,
          senderDoc: meDoc,
          text,
          attachments: atts,
        });
      }

      setMassText("");
      setMassFiles([]);
      setSelectedIds(new Set());
    } catch (e) {
      console.error("mass message failed", e);
      alert(tr("mass_message_failed", "Mass message failed. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const renderUserRow = (uid, extraRight) => {
    const u = usersById[uid] || {};
    const name = u.full_name || u.name || u.displayName || u.email || uid;
    const role = resolveRole(u);

    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <div
          className="min-w-0 flex items-center gap-3 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/view-profile/${uid}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") navigate(`/view-profile/${uid}`);
          }}
        >
          <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center font-semibold text-gray-700">
            {String(name).trim().slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{name}</div>
            <div className="text-xs text-gray-600 flex items-center gap-2">
              <span className="capitalize">
                {role === "agent"
                  ? tr("agent", "Agent")
                  : role === "tutor"
                  ? tr("tutor", "Tutor")
                  : role === "school"
                  ? tr("school", "School")
                  : role === "student"
                  ? tr("student", "Student")
                  : role}
              </span>
              {role === "agent" ? <Badge>{tr("agent", "Agent")}</Badge> : null}
              {role === "tutor" ? <Badge>{tr("tutor", "Tutor")}</Badge> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">{extraRight}</div>
      </div>
    );
  };

  if (!myUid) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="w-full px-3 sm:px-6 lg:px-8 py-6">
          <div className="mx-auto max-w-4xl">
            <Card className="rounded-2xl">
              <CardContent className="p-8 text-center">
                <div className="text-xl font-semibold text-gray-900">
                  {tr("connections", "Connections")}
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  {tr("sign_in_required", "Please sign in to view your connections.")}
                </div>
                <div className="mt-4">
                  <Button onClick={() => navigate("/welcome")}>
                    {tr("go_to_sign_in", "Go to Sign In")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-3 sm:px-6 lg:px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xl font-semibold text-gray-900">
                {tr("connections", "Connections")}
              </div>
              <div className="text-sm text-gray-600">
                {tr("connections_sub", "Manage follow requests and your network")}
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate("/dashboard")}>
              {tr("back_to_dashboard", "Back to Dashboard")}
            </Button>
          </div>

          {subscriptionLocked ? (
            <Card className="mb-4 rounded-2xl border-amber-200 bg-amber-50">
              <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 text-amber-900">
                  <Lock className="h-5 w-5 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">
                      {tr("subscription_required", "Subscription required")}
                    </div>
                    <div className="text-sm text-amber-800 mt-1">
                      {tr(
                        "subscription_required_desc",
                        "You can view your connections, but mass messaging is locked until your subscription is active."
                      )}
                    </div>
                  </div>
                </div>
                <Button onClick={goToSubscription} className="shrink-0">
                  <CreditCard className="h-4 w-4 mr-2" />
                  {tr("go_to_payment", "Go to Payment")}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="requests">{tr("requests", "Requests")}</TabsTrigger>
                  <TabsTrigger value="followers">{tr("followers", "Followers")}</TabsTrigger>
                  <TabsTrigger value="following">{tr("following", "Following")}</TabsTrigger>
                </TabsList>

                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-600">{tr("filter", "Filter")}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant={roleFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRoleFilter("all")}
                      >
                        {tr("all", "All")}
                      </Button>
                      <Button
                        type="button"
                        variant={roleFilter === "agent" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRoleFilter("agent")}
                      >
                        {tr("agents", "Agents")}
                      </Button>
                      <Button
                        type="button"
                        variant={roleFilter === "tutor" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRoleFilter("tutor")}
                      >
                        {tr("tutors", "Tutors")}
                      </Button>
                      <Button
                        type="button"
                        variant={roleFilter === "school" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setRoleFilter("school")}
                      >
                        {tr("schools", "Schools")}
                      </Button>
                      {myRole !== "student" && (
                        <Button
                          type="button"
                          variant={roleFilter === "student" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRoleFilter("student")}
                        >
                          {tr("students", "Students")}
                        </Button>
                      )}
                    </div>
                  </div>

                  {canMassMessage ? (
                    <div className="sm:ml-auto flex items-center gap-2">
                      <div className="text-xs text-gray-600">
                        {tr("selected", "Selected")}: {selectedIds.size}
                      </div>
                    </div>
                  ) : null}
                </div>

                <TabsContent value="requests" className="mt-4">
                  {filteredList.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-600">
                      {tr("no_requests", "No follow requests")}
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredList.map((r) => (
                        <div key={r.id}>
                          {renderUserRow(
                            r.id,
                            <>
                              <Button size="sm" onClick={() => acceptRequest(r.id)}>
                                {tr("accept", "Accept")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => declineRequest(r.id)}>
                                {tr("decline", "Decline")}
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="followers" className="mt-4">
                  {filteredList.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-600">
                      {tr("no_followers", "No followers yet")}
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredList.map((r) => (
                        <div key={r.id}>
                          {renderUserRow(
                            r.id,
                            <>
                              <label className="flex items-center gap-2 text-xs text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleSelect(r.id)}
                                />
                                {tr("select", "Select")}
                              </label>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canMassMessage ? (
                    <div className="mt-4 rounded-2xl border bg-white p-4">
                      <div className="text-sm font-semibold text-gray-900 mb-2">
                        {tr("mass_message", "Mass Message")}
                      </div>
                      <Textarea
                        value={massText}
                        onChange={(e) => setMassText(e.target.value)}
                        placeholder={
                          subscriptionLocked
                            ? tr("subscription_required", "Subscription required")
                            : tr("type_message", "Type your message...")
                        }
                        className="rounded-xl"
                        disabled={subscriptionLocked}
                      />
                      <input
                        ref={followersFileInputRef}
                        type="file"
                        multiple
                        className="sr-only"
                        onChange={onPickMassFiles}
                      />

                      {massFiles?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {massFiles.map((f, idx) => (
                            <div
                              key={`${f.name}-${f.size}-${f.lastModified}-${idx}`}
                              className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                            >
                              <span className="max-w-[220px] truncate">{f.name}</span>
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-900"
                                onClick={() => removeMassFile(idx)}
                                disabled={subscriptionLocked}
                                aria-label={tr("remove", "Remove")}
                                title={tr("remove", "Remove")}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mr-2"
                          onClick={() => followersFileInputRef.current?.click()}
                          title={tr("attach_file", "Attach file")}
                          disabled={subscriptionLocked}
                        >
                          <Paperclip className="h-5 w-5" />
                        </Button>
                        <Button
                          disabled={
                            subscriptionLocked ||
                            sending ||
                            selectedIds.size === 0 ||
                            (!String(massText).trim() && (massFiles?.length || 0) === 0)
                          }
                          onClick={sendMass}
                        >
                          {sending ? tr("sending", "Sending...") : tr("send", "Send")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="following" className="mt-4">
                  {filteredList.length === 0 ? (
                    <div className="py-10 text-center text-sm text-gray-600">
                      {tr("no_following", "You’re not following anyone yet")}
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredList.map((r) => (
                        <div key={r.id}>
                          {renderUserRow(
                            r.id,
                            <>
                              <label className="flex items-center gap-2 text-xs text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleSelect(r.id)}
                                />
                                {tr("select", "Select")}
                              </label>
                              <Button size="sm" variant="outline" onClick={() => unfollow(r.id)}>
                                {tr("unfollow", "Unfollow")}
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canMassMessage ? (
                    <div className="mt-4 rounded-2xl border bg-white p-4">
                      <div className="text-sm font-semibold text-gray-900 mb-2">
                        {tr("mass_message", "Mass Message")}
                      </div>
                      <Textarea
                        value={massText}
                        onChange={(e) => setMassText(e.target.value)}
                        placeholder={
                          subscriptionLocked
                            ? tr("subscription_required", "Subscription required")
                            : tr("type_message", "Type your message...")
                        }
                        className="rounded-xl"
                        disabled={subscriptionLocked}
                      />
                      <input
                        ref={followingFileInputRef}
                        type="file"
                        multiple
                        className="sr-only"
                        onChange={onPickMassFiles}
                      />

                      {massFiles?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {massFiles.map((f, idx) => (
                            <div
                              key={`${f.name}-${f.size}-${f.lastModified}-${idx}`}
                              className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                            >
                              <span className="max-w-[220px] truncate">{f.name}</span>
                              <button
                                type="button"
                                className="text-gray-500 hover:text-gray-900"
                                onClick={() => removeMassFile(idx)}
                                disabled={subscriptionLocked}
                                aria-label={tr("remove", "Remove")}
                                title={tr("remove", "Remove")}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mr-2"
                          onClick={() => followingFileInputRef.current?.click()}
                          title={tr("attach_file", "Attach file")}
                          disabled={subscriptionLocked}
                        >
                          <Paperclip className="h-5 w-5" />
                        </Button>
                        <Button
                          disabled={
                            subscriptionLocked ||
                            sending ||
                            selectedIds.size === 0 ||
                            (!String(massText).trim() && (massFiles?.length || 0) === 0)
                          }
                          onClick={sendMass}
                        >
                          {sending ? tr("sending", "Sending...") : tr("send", "Send")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}