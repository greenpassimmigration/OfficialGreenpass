// src/pages/Organization.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/firebase";
import { createPageUrl } from "@/utils";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import OrgInviteDialog from "@/components/invites/OrgInviteDialoag";

import {
  Building2,
  Users,
  Plus,
  Crown,
  CreditCard,
  ArrowRight,
  ShieldCheck,
  Loader2,
  Sparkles,
  Check,
  Mail,
  Send,
  RefreshCcw,
  Ban,
  MessageSquare,
} from "lucide-react";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function capWord(s) {
  const x = String(s || "").trim();
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function normalizeIncomingRoleParam(r) {
  const role = String(r || "").toLowerCase().trim();
  if (!role) return "member";
  if (role === "user") return "student";
  return role;
}

const SUBSCRIPTION_ROLES = new Set(["agent", "school", "tutor"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid", "subscribed"]);
const LOCKED_SUBSCRIPTION_STATUSES = new Set([
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

function resolveAccountRole(userDoc) {
  const role = String(
    userDoc?.role ||
      userDoc?.selected_role ||
      userDoc?.user_type ||
      userDoc?.userType ||
      userDoc?.account_type ||
      "student"
  )
    .toLowerCase()
    .trim();

  if (!role || role === "user" || role === "member") return "student";
  return role;
}

function hasActiveSubscription(userDoc) {
  if (!userDoc) return false;

  if (userDoc.subscription_active === true || userDoc.subscriptionActive === true) {
    return true;
  }

  const status = String(userDoc.subscription_status || userDoc.subscriptionStatus || "")
    .toLowerCase()
    .trim();

  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true;
  if (LOCKED_SUBSCRIPTION_STATUSES.has(status)) return false;

  return false;
}

function isSubscriptionLockedForUser(userDoc, subscriptionModeEnabled) {
  if (!subscriptionModeEnabled) return false;

  const role = resolveAccountRole(userDoc);
  if (!SUBSCRIPTION_ROLES.has(role)) return false;

  return !hasActiveSubscription(userDoc);
}

function getSubscriptionPaymentUrl(userDoc) {
  const rawRole = resolveAccountRole(userDoc);
  const role = SUBSCRIPTION_ROLES.has(rawRole) ? rawRole : "school";
  const existingPlan = String(
    userDoc?.subscription_plan ||
      userDoc?.subscriptionPlan ||
      ""
  ).trim();

  const plan = existingPlan || `${role}_monthly`;

  const query = new URLSearchParams({
    type: "subscription",
    role,
    plan,
    lock: "1",
    next: "/organization",
  });

  return `${createPageUrl("Checkout")}?${query.toString()}`;
}


function ProgressBar({ value = 0 }) {
  const pct = clamp(value, 0, 100);
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const s = (status || "pending").toLowerCase();
  if (s === "accepted") return <Badge className="rounded-full" variant="secondary">{t("accepted", "Accepted")}</Badge>;
  if (s === "revoked") return <Badge className="rounded-full" variant="destructive">{t("revoked", "Revoked")}</Badge>;
  if (s === "expired") return <Badge className="rounded-full" variant="outline">{t("expired", "Expired")}</Badge>;
  return <Badge className="rounded-full" variant="outline">{t("pending", "Pending")}</Badge>;
}

function getEnv(key) {
  try {
    return import.meta?.env?.[key];
  } catch {
    return undefined;
  }
}

function inferFunctionsBaseFromEnv() {
  const explicit =
    getEnv("VITE_FUNCTIONS_HTTP_BASE") ||
    getEnv("VITE_FUNCTIONS_BASE_URL") ||
    getEnv("VITE_CLOUD_FUNCTIONS_BASE_URL");

  if (explicit) return String(explicit).replace(/\/$/, "");

  const projectId = getEnv("VITE_FIREBASE_PROJECT_ID");
  if (projectId) return `https://us-central1-${projectId}.cloudfunctions.net`;

  return "";
}

async function postAuthed(path, body) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in.");
  let base = inferFunctionsBaseFromEnv();
  if (!base) {
    const pid = auth?.app?.options?.projectId;
    if (pid) base = `https://us-central1-${pid}.cloudfunctions.net`;
  }
  if (!base) throw new Error("Missing Functions base URL.");
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export default function Organization() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscriptionModeEnabled } = useSubscriptionMode();

  const [fbUser, setFbUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [meDoc, setMeDoc] = useState(null);

  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const pendingInvites = useMemo(() => {
    return (invites || []).filter((inv) => String(inv?.status || "pending").toLowerCase() === "pending");
  }, [invites]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteActionBusyId, setInviteActionBusyId] = useState(null);
  const [inviteActionMsg, setInviteActionMsg] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErr, setInviteErr] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const refreshOrg = async (uid) => {
    let orgIdFromProfile = "";
    try {
      const usnap = await getDoc(doc(db, "users", uid));
      if (usnap.exists()) {
        const ud = { id: usnap.id, ...(usnap.data() || {}) };
        setMeDoc(ud);
        orgIdFromProfile = ud.orgId || ud.organizationId || ud.org_id || ud.organization_id || "";
      } else {
        setMeDoc(null);
      }
    } catch {
      setMeDoc(null);
    }

    let orgDoc = null;

    if (orgIdFromProfile) {
      const osnap = await getDoc(doc(db, "organizations", orgIdFromProfile));
      if (osnap.exists()) orgDoc = { id: osnap.id, ...osnap.data() };
    }

    if (!orgDoc) {
      const snap = await getDocs(query(collection(db, "organizations"), where("ownerId", "==", uid), limit(1)));
      if (!snap.empty) {
        const d = snap.docs[0];
        orgDoc = { id: d.id, ...d.data() };
      }
    }

    if (!orgDoc) {
      setOrg(null);
      setMembers([]);
      setInvites([]);
      return null;
    }

    setOrg(orgDoc);

    const mSnap = await getDocs(query(collection(db, "organization_members"), where("orgId", "==", orgDoc.id)));
    setMembers(mSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    if (orgDoc?.ownerId === uid) {
      const iSnap = await getDocs(
        query(collection(db, "org_invites"), where("orgId", "==", orgDoc.id), orderBy("createdAt", "desc"), limit(50))
      );
      setInvites(iSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } else {
      setInvites([]);
    }
    return orgDoc;
  };

  useEffect(() => {
    const load = async () => {
      if (!authReady) return;

      if (!fbUser?.uid) {
        setMeDoc(null);
        setOrg(null);
        setMembers([]);
        setInvites([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        await refreshOrg(fbUser.uid);
      } catch (e) {
        console.error("Organization load error:", e);
        setOrg(null);
        setMembers([]);
        setInvites([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authReady, fbUser?.uid]);

  const totalSlots = useMemo(() => (org?.baseSlots ?? 5) + (org?.extraSlots ?? 0), [org]);
  const usedSlots = useMemo(() => (typeof org?.usedSlots === "number" ? org.usedSlots : members.length), [org, members.length]);
  const remainingSlots = useMemo(() => Math.max(0, totalSlots - usedSlots), [totalSlots, usedSlots]);
  const usedPct = useMemo(() => (!totalSlots ? 0 : Math.round((usedSlots / totalSlots) * 100)), [usedSlots, totalSlots]);

  const subscriptionLocked = useMemo(
    () => isSubscriptionLockedForUser(meDoc, subscriptionModeEnabled),
    [meDoc, subscriptionModeEnabled]
  );
  const subscriptionPaymentUrl = useMemo(() => getSubscriptionPaymentUrl(meDoc), [meDoc]);

  const canCreateOrg = useMemo(
    () => !!fbUser?.uid && !org && !loading && !creating && !subscriptionLocked,
    [fbUser?.uid, org, loading, creating, subscriptionLocked]
  );

  const goToSubscriptionPayment = () => {
    navigate(subscriptionPaymentUrl);
  };

  const handleCreateOrg = async () => {
    if (!fbUser?.uid) return;
    if (subscriptionLocked) {
      setError(t("organization_page.subscription_required", "Your subscription is inactive or pending. Activate your subscription to use organization features."));
      return;
    }
    const name = (orgName || "").trim();
    if (!name) {
      setError(t("organization_page.err_org_name_required", "Please enter an organization name."));
      return;
    }

    setCreating(true);
    setError("");
    try {
      const orgRef = await addDoc(collection(db, "organizations"), {
        name,
        ownerId: fbUser.uid,
        role: "",
        plan: "basic",
        baseSlots: 5,
        extraSlots: 0,
        totalSlots: 5,
        usedSlots: 1,
        subscriptionActive: true,
        createdAt: serverTimestamp(),
      });

      await addDoc(collection(db, "organization_members"), {
        orgId: orgRef.id,
        userId: fbUser.uid,
        email: fbUser.email || "",
        role: "owner",
        status: "active",
        createdAt: serverTimestamp(),
      });

      try {
        await setDoc(doc(db, "users", fbUser.uid), { orgId: orgRef.id }, { merge: true });
      } catch {}

      await refreshOrg(fbUser.uid);
    } catch (e) {
      console.error("Create org error:", e);
      setError(t("organization_page.err_create_failed", "Failed to create organization. Check Firestore rules."));
    } finally {
      setCreating(false);
    }
  };

  const openInvite = () => {
    if (subscriptionLocked) {
      setInviteActionMsg(t("organization_page.subscription_required", "Your subscription is inactive or pending. Activate your subscription to use organization features."));
      return;
    }
    setInviteEmail("");
    setInviteRole("member");
    setInviteErr("");
    setInviteOpen(true);
  };

  const sendInvite = async () => {
    if (!org?.id) return;
    if (subscriptionLocked) {
      setInviteErr(t("organization_page.subscription_required", "Your subscription is inactive or pending. Activate your subscription to use organization features."));
      return;
    }
    const email = (inviteEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setInviteErr("Please enter a valid email.");
      return;
    }
    if (remainingSlots <= 0) {
      setInviteErr(t("organization_page.err_slot_limit", "Slot limit reached. Buy more slots to invite more members."));
      return;
    }

    setInviteBusy(true);
    setInviteErr("");
    try {
      await postAuthed("createOrgInvite", { orgId: org.id, email, role: inviteRole });
      await refreshOrg(fbUser.uid);
      setInviteOpen(false);
    } catch (e) {
      console.error(e);
      setInviteErr(e.message || "Failed to send invite.");
    } finally {
      setInviteBusy(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    try {
      await postAuthed("revokeOrgInvite", { inviteId });
      await refreshOrg(fbUser.uid);
    } catch (e) {
      console.error(e);
    }
  };

  const resendInvite = async (inv) => {
    try {
      if (subscriptionLocked) {
        setInviteActionMsg(t("organization_page.subscription_required", "Your subscription is inactive or pending. Activate your subscription to use organization features."));
        return;
      }
      const status = String(inv?.status || "pending").toLowerCase();
      if (status !== "pending") {
        setInviteActionMsg("This invitation is already accepted (or no longer pending).");
        return;
      }

      setInviteActionBusyId(inv.id);
      setInviteActionMsg("");

      await postAuthed("revokeOrgInvite", { inviteId: inv.id });

      await postAuthed("createOrgInvite", {
        orgId: inv.orgId,
        email: inv.email,
        role: inv.role || "member",
      });

      await refreshOrg(fbUser.uid);
      setInviteActionMsg("Invitation resent.");
    } catch (e) {
      console.error(e);
      setInviteActionMsg(e?.message || "Failed to resend invitation.");
    } finally {
      setInviteActionBusyId(null);
    }
  };

  const handleMessageMember = (member) => {
    if (subscriptionLocked) {
      setInviteActionMsg(t("organization_page.subscription_required", "Your subscription is inactive or pending. Activate your subscription to use organization features."));
      return;
    }
    const targetId = String(member?.userId || "").trim();
    if (!targetId) return;
    if (targetId === String(fbUser?.uid || "")) return;

    const qs = new URLSearchParams();
    qs.set("to", targetId);
    qs.set("toRole", normalizeIncomingRoleParam(member?.role || "member"));

    navigate(`${createPageUrl("Messages")}?${qs.toString()}`, {
      state: {
        source: "organization_members",
        orgId: org?.id || "",
        memberId: member?.id || "",
        memberUserId: targetId,
      },
    });
  };

  if (loading) {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />{t("organization", "Organization")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading organization...
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
                <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
                <div className="h-28 rounded-2xl bg-gray-100 animate-pulse" />
              </div>
              <div className="h-64 rounded-2xl bg-gray-100 animate-pulse" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (authReady && !fbUser?.uid) {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mx-auto max-w-6xl">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />{t("organization", "Organization")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">{t("organization_page.sign_in_hint", "Please sign in to manage your organization.")}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-100 blur-3xl opacity-60" />
          <div className="absolute top-32 right-10 h-56 w-56 rounded-full bg-gray-100 blur-3xl opacity-70" />
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{t("organization", "Organization")}</h1>
              <p className="text-sm text-gray-600">{t("organization_page.subtitle", "Create your organization to manage members and unlock team slots.")}</p>
            </div>
            <Badge variant="secondary" className="rounded-full">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t("organization_page.free_seats_5", "5 free seats")}
            </Badge>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-6">
          {subscriptionLocked ? (
            <Card className="mb-4 rounded-3xl border-amber-200 bg-amber-50">
              <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-amber-900">{t("organization_page.subscription_locked_title", "Subscription required")}</div>
                  <div className="text-sm text-amber-800">
                    {t("organization_page.subscription_locked_desc", "Your subscription is inactive or pending. Activate your subscription to create and manage an organization.")}
                  </div>
                </div>
                <Button onClick={goToSubscriptionPayment} className="rounded-2xl shrink-0">
                  <CreditCard className="mr-2 h-4 w-4" />
                  {t("organization_page.go_to_payment", "Go to Payment")}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="rounded-3xl overflow-hidden lg:col-span-2">
              <div className="bg-gradient-to-r from-emerald-50 to-white p-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-emerald-100 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-emerald-700" />
                  </div>
                  <div>
                    <div className="font-semibold">{t("organization_page.setup_title", "Set up your team in minutes")}</div>
                    <div className="text-xs text-gray-600">{t("organization_page.setup_desc", "Add up to 5 members free. Buy more slots anytime.")}</div>
                  </div>
                </div>
              </div>

              <CardContent className="p-6 space-y-4">
                <div className="space-y-1">
                  <Label>{t("organization_page.org_name", "Organization name")}</Label>
                  <Input
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder={t("organization_page.org_placeholder", "e.g., ABC School Admissions Team")}
                    disabled={!canCreateOrg}
                    className="rounded-2xl"
                  />
                </div>

                {error ? <div className="text-sm text-red-600">{error}</div> : null}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleCreateOrg} disabled={!canCreateOrg} className="rounded-2xl">
                    {creating ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        {t("organization_page.create_org", "Create organization")}
                      </span>
                    )}
                  </Button>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-gray-600">{t("organization_page.included", "Included")}</div>
                    <div className="font-semibold">{t("organization_page.team_slots_5", "5 team slots")}</div>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-gray-600">{t("organization_page.access", "Access")}</div>
                    <div className="font-semibold">{t("organization_page.org_settings", "Org settings")}</div>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-gray-600">{t("organization_page.upgrade", "Upgrade")}</div>
                    <div className="font-semibold">{t("organization_page.pay_per_slot", "Pay per slot")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  {t("organization_page.seat_pricing", "Seat pricing")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-2xl border p-4">
                  <div className="text-xs text-gray-600">{t("organization_page.included", "Included")}</div>
                  <div className="mt-1 text-sm font-semibold">{t("organization_page.free_seats_5", "5 free seats")}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                    <Check className="h-4 w-4 text-emerald-600" /> Invite staff
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                    <Check className="h-4 w-4 text-emerald-600" /> Manage roles
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                    <Check className="h-4 w-4 text-emerald-600" /> Team settings
                  </div>
                </div>

                <div className="rounded-2xl border p-4">
                  <div className="text-xs text-gray-600">{t("organization_page.extra_seats", "Extra seats")}</div>
                  <div className="mt-1 text-sm font-semibold">{t("organization_page.seat_price", "$3 / seat / month")}</div>
                  <div className="mt-1 text-xs text-gray-500">{t("organization_page.seat_desc", "Buy only when you need more members.")}</div>
                  <Button className="mt-3 w-full rounded-2xl" variant="outline" disabled>
                    {t("organization_page.coming_soon", "Coming soon")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const planLabel = (org.plan || "basic").toString().toUpperCase();

  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {subscriptionLocked ? (
          <Card className="rounded-3xl border-amber-200 bg-amber-50">
            <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-amber-900">{t("organization_page.subscription_locked_title", "Subscription required")}</div>
                <div className="text-sm text-amber-800">
                  {t("organization_page.subscription_locked_desc_existing", "Your subscription is inactive or pending. Viewing is allowed, but organization actions are locked until payment is active.")}
                </div>
              </div>
              <Button onClick={goToSubscriptionPayment} className="rounded-2xl shrink-0">
                <CreditCard className="mr-2 h-4 w-4" />
                {t("organization_page.go_to_payment", "Go to Payment")}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t("organization", "Organization")}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span className="inline-flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {org.name || "Untitled organization"}
              </span>
              <span className="text-gray-300">•</span>
              <span className="inline-flex items-center gap-1">
                <Crown className="h-4 w-4" />
                {planLabel}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {remainingSlots === 0 ? (
              <Badge className="rounded-full" variant="destructive">
                Slot limit reached
              </Badge>
            ) : (
              <Badge className="rounded-full" variant="secondary">
                {remainingSlots} slots left
              </Badge>
            )}
            <Button
              className="rounded-2xl"
              variant="outline"
              onClick={subscriptionLocked ? goToSubscriptionPayment : undefined}
              disabled={!subscriptionLocked}
              title={
                subscriptionLocked
                  ? t("organization_page.go_to_payment", "Go to Payment")
                  : t("organization_page.extra_slots_coming_soon", "Extra seats are coming soon")
              }
            >
              <span className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                {subscriptionLocked
                  ? t("organization_page.go_to_payment", "Go to Payment")
                  : t("organization_page.buy_more_slots", "Buy more slots")}
              </span>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-3xl lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {t("organization_page.team_slots", "Team slots")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-600">{t("organization_page.used_of", "Used {{used}} of {{total}}", { used: usedSlots, total: totalSlots })}</div>
                <div className="text-gray-600">{usedPct}%</div>
              </div>
              <ProgressBar value={usedPct} />
              <div className="text-xs text-gray-500">{t("organization_page.free_slots_note", "You start with 5 free slots. Add more by purchasing extra slots.")}</div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRight className="h-5 w-5" />
                {t("organization_page.quick_actions", "Quick actions")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {inviteActionMsg ? (
                <div className="rounded-2xl border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {inviteActionMsg}
                </div>
              ) : null}
              <Button className="w-full rounded-2xl" onClick={openInvite} disabled={subscriptionLocked}>
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t("organization_page.invite_by_email", "Invite by email")}
                </span>
              </Button>
              <div className="text-xs text-gray-500">{t("organization_page.invites_cf_hint", "Invites are created + emailed by Cloud Functions.")}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />{t("members", "Members")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-6 text-center">
                  <div className="mx-auto mb-2 h-10 w-10 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <Users className="h-5 w-5 text-gray-600" />
                  </div>
                  <div className="font-medium">{t("organization_page.no_members_title", "No members yet")}</div>
                  <div className="text-sm text-gray-600">{t("organization_page.no_members_desc", "Invite your first teammate.")}</div>
                </div>
              ) : (
                <div className="divide-y">
                  {members.map((m) => {
                    const memberUserId = String(m.userId || "").trim();
                    const canMessage = !!memberUserId && memberUserId !== String(fbUser?.uid || "");

                    return (
                      <div key={m.id} className="flex items-center justify-between py-3 gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{m.email || m.userId || m.id}</div>
                          <div className="text-xs text-gray-500">
                            {capWord(m.role ? m.role : "member")} {m.status ? `• ${capWord(m.status)}` : ""}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {canMessage ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => handleMessageMember(m)}
                              disabled={subscriptionLocked}
                              title={t("organization_page.message_member", "Message member")}
                            >
                              <MessageSquare className="h-4 w-4 mr-1" />
                              {t("message", "Message")}
                            </Button>
                          ) : null}

                          {m.role === "owner" ? (
                            <Badge className="rounded-full" variant="secondary">{t("owner", "Owner")}</Badge>
                          ) : (
                            <Badge className="rounded-full" variant="outline">{t("member", "Member")}</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Invitations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingInvites.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-6 text-center">
                  <div className="mx-auto mb-2 h-10 w-10 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <Mail className="h-5 w-5 text-gray-600" />
                  </div>
                  <div className="font-medium">{t("organization_page.no_invites_title", "No invitations yet")}</div>
                  <div className="text-sm text-gray-600">{t("organization_page.no_invites_desc", "Send an invite to add teammates.")}</div>
                </div>
              ) : (
                <div className="divide-y">
                  {pendingInvites.map((inv) => (
                    <div key={inv.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{inv.email}</div>
                        <div className="text-xs text-gray-500">
                          {capWord(inv.role || "member")} • {capWord(inv.status || "pending")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={capWord(inv.status)} />
                        {String(inv.status || "pending").toLowerCase() === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              disabled={inviteActionBusyId === inv.id || subscriptionLocked}
                              onClick={() => resendInvite(inv)}
                              title={t("organization_page.resend_new_invite", "Resend (new invite)")}
                            >
                              <RefreshCcw className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              disabled={inviteActionBusyId === inv.id}
                              onClick={() => revokeInvite(inv.id)}
                              title={t("organization_page.revoke", "Revoke")}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <OrgInviteDialog
        open={inviteOpen && !subscriptionLocked}
        onOpenChange={setInviteOpen}
        orgId={org?.id}
        orgName={org?.name}
        onSent={async () => {
          try {
            await refreshOrg(fbUser.uid);
          } catch {}
        }}
      />
    </div>
  );
}