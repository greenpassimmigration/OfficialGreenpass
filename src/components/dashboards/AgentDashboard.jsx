import React, { useState, useEffect, useMemo, useRef } from "react";
import InviteUsersDialog from "@/components/invites/InviteUserDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Agent } from "@/api/entities";
import { User } from "@/api/entities";
import {
  listenFollowState,
  sendFollowRequest,
  cancelFollowRequest,
  unfollowUser,
} from "@/api/follow";
import {
  Users,
  ArrowRight,
  UserPlus,
  CreditCard,
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Flag,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Ticket,
  Building2,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import SharedPaymentGateway from "@/components/payments/SharedPaymentGateway";
import CreateEventDialog from "@/components/events/CreateEventDialog";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

// ✅ Firebase
import { db, storage } from "@/firebase";
import {
  collection,
  addDoc,
  doc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  deleteDoc,
  runTransaction,
  Timestamp,
  increment,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// ✅ UI Dropdown (3-dots menu)
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import ActionBlocker from "../profile/ActionBlocker";
import { getProfileCompletionData } from "../profile/ProfileCompletionBanner";
import { useTr } from "@/i18n/useTr";

/* -------------------- SAFE HELPERS (date & arrays) -------------------- */
const toValidDate = (v) => {
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return isNaN(d?.getTime()) ? null : d;
    }

    if (typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return isNaN(d?.getTime()) ? null : d;
    }
  }

  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return isNaN(d?.getTime()) ? null : d;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      const d = new Date(n > 1e12 ? n : n * 1000);
      return isNaN(d?.getTime()) ? null : d;
    }

    const d = new Date(s);
    return isNaN(d?.getTime()) ? null : d;
  }

  return null;
};

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const POST_PREVIEW_TEXT_LIMIT = 320;
const MAX_DASHBOARD_MEDIA = 4;

const buildPostDetailUrl = (postId) =>
  `${createPageUrl("PostDetail")}?id=${encodeURIComponent(postId || "")}`;
/* --------------------------------------------------------------------- */

/* ✅ Uses your REAL user doc fields */
function isSubscribedUser(u) {
  if (!u) return false;

  if (u.subscription_active === true) return true;

  const status = String(u.subscription_status || "").toLowerCase().trim();
  const ok = new Set(["active", "paid", "trialing"]);

  return ok.has(status);
}

const SubscribeBanner = ({ to, user }) => {
  const { tr } = useTr("agent_dashboard");

  const status = String(user?.subscription_status || "").toLowerCase().trim();

  const message =
    status === "skipped"
      ? tr(
          "sub_msg_skipped",
          "You skipped subscription. Subscribe to unlock full features, commissions, and payouts."
        )
      : status === "expired"
      ? tr(
          "sub_msg_expired",
          "Your subscription expired. Renew to regain access to commissions and payouts."
        )
      : tr(
          "sub_msg_default",
          "You’re not subscribed yet. Subscribe to unlock full agent features, commissions, and payouts."
        );

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <CreditCard className="w-5 h-5 text-red-600" />
        </div>

        <div>
          <p className="font-semibold text-red-800">
            {tr("sub_required", "Subscription required")}
          </p>
          <p className="text-sm text-red-700">{message}</p>
        </div>
      </div>

      <Link to={to}>
        <Button className="bg-red-600 hover:bg-red-700 w-full sm:w-auto">
          Subscribe Now
        </Button>
      </Link>
    </div>
  );
};

const InlineProfileCompletionBanner = ({ user, relatedEntity }) => {
  const { tr } = useTr("agent_dashboard");

  useMemo(() => getProfileCompletionData(user, relatedEntity), [user, relatedEntity]);

  const isEmpty = (v) => {
    if (v === null || v === undefined) return true;
    if (typeof v === "string") return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    return false;
  };

  const agent = user?.agent_profile || {};

  const companyName = agent.company_name ?? user?.company_name ?? "";

  const businessLicense =
    agent.business_license_mst ??
    agent.business_license ??
    user?.business_license_mst ??
    user?.business_license ??
    "";

  const paypalEmail = agent.paypal_email ?? user?.paypal_email ?? "";

  const missing = [];

  if (isEmpty(user?.full_name)) {
    missing.push({ key: "full_name", label: tr("field_full_name", "Full Name") });
  }

  if (isEmpty(user?.phone)) {
    missing.push({ key: "phone", label: tr("field_phone", "Phone") });
  }

  if (isEmpty(user?.country)) {
    missing.push({ key: "country", label: tr("field_country", "Country") });
  }

  if (isEmpty(companyName)) {
    missing.push({ key: "company_name", label: tr("field_company_name", "Company Name") });
  }

  if (isEmpty(businessLicense)) {
    missing.push({
      key: "business_license_mst",
      label: tr("field_business_license", "Business License (MST)"),
    });
  }

  if (isEmpty(paypalEmail)) {
    missing.push({ key: "paypal_email", label: tr("field_paypal_email", "PayPal Email") });
  }

  if (missing.length === 0) return null;

  const totalRequired = 6;

  const percent = Math.max(
    0,
    Math.min(100, Math.round(((totalRequired - missing.length) / totalRequired) * 100))
  );

  const fieldLabel = (f) => {
    const raw =
      typeof f === "string"
        ? f
        : (f && typeof f === "object" && (f.label || f.name || f.title || f.key || f.field)) || "";

    const key = String(raw || "").trim();

    const map = {
      "Full Name": "field_full_name",
      Phone: "field_phone",
      Country: "field_country",
      "Company Name": "field_company_name",
      "Business License": "field_business_license",
      "Business License (MST)": "field_business_license",
      "PayPal Email": "field_paypal_email",
      full_name: "field_full_name",
      phone: "field_phone",
      country: "field_country",
      company_name: "field_company_name",
      business_license: "field_business_license",
      business_license_mst: "field_business_license",
      paypal_email: "field_paypal_email",
    };

    const k = map[key] || null;

    return k ? tr(k, key) : key || tr("missing_field", "Missing field");
  };

  const missingText = `${tr("missing_prefix", "Missing")}: ${missing
    .map(fieldLabel)
    .join(", ")}`;

  const onboardingUrl = createPageUrl("Onboarding");

  return (
    <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-orange-500" />
            <div className="text-sm font-semibold text-orange-900">
              {tr("complete_profile_title", "Complete Your Profile")}
            </div>
          </div>

          <div className="mt-1 text-sm text-orange-800">
            {tr("complete_profile_desc", "Complete your profile to access all platform features.")}{" "}
            {missingText}
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-orange-200 overflow-hidden">
            <div className="h-full bg-orange-600" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="flex items-center gap-3 justify-between sm:justify-end">
          <div className="text-sm font-semibold text-orange-900 whitespace-nowrap">
            {percent}% {tr("complete", "Complete")}
          </div>

          <Link to={onboardingUrl}>
            <Button className="bg-orange-600 hover:bg-orange-700">
              {tr("complete_profile_cta", "Complete Profile")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

const Shortcut = ({ icon, label, to }) => (
  <Link to={to} className="block">
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2 hover:bg-gray-50 transition">
      <div className="h-9 w-9 rounded-xl bg-gray-100 flex items-center justify-center">
        {icon}
      </div>
      <div className="text-sm font-medium text-gray-900">{label}</div>
    </div>
  </Link>
);

const Avatar = ({ name = "User", size = "md" }) => {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");

  const s =
    size === "lg"
      ? "h-12 w-12 text-base"
      : size === "sm"
      ? "h-8 w-8 text-xs"
      : "h-10 w-10 text-sm";

  return (
    <div
      className={`${s} rounded-full bg-gradient-to-br from-emerald-500 to-blue-600 text-white flex items-center justify-center font-semibold`}
    >
      {initials || "U"}
    </div>
  );
};

const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

function FollowButton({ currentUserId, creatorId, creatorRole, size = "sm", className = "" }) {
  const { tr } = useTr("agent_dashboard");

  const [state, setState] = useState({
    following: false,
    requested: false,
  });

  const disabled = !currentUserId || !creatorId || currentUserId === creatorId;

  useEffect(() => {
    if (disabled) {
      setState({ following: false, requested: false });
      return;
    }

    return listenFollowState({ meId: currentUserId, targetId: creatorId }, setState);
  }, [currentUserId, creatorId, disabled]);

  const onClick = async () => {
    if (disabled) return;

    if (state.following) {
      await unfollowUser({ followerId: currentUserId, followeeId: creatorId });
      return;
    }

    if (state.requested) {
      await cancelFollowRequest({ followerId: currentUserId, followeeId: creatorId });
      return;
    }

    await sendFollowRequest({ followerId: currentUserId, followeeId: creatorId });
  };

  const label = state.following
    ? tr("following", "Following")
    : state.requested
    ? tr("requested", "Requested")
    : tr("follow", "Follow");

  return (
    <Button
      type="button"
      size={size}
      variant={state.following || state.requested ? "outline" : "default"}
      disabled={disabled}
      className={className}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/* -------------------- Media grid (images + videos) -------------------- */
const MediaGallery = ({ media = [], postId }) => {
  const { tr } = useTr("agent_dashboard");

  const items = Array.isArray(media) ? media.filter((m) => m?.url) : [];

  if (!items.length || !postId) return null;

  const visibleItems = items.slice(0, MAX_DASHBOARD_MEDIA);
  const remaining = Math.max(0, items.length - MAX_DASHBOARD_MEDIA);
  const postDetailUrl = buildPostDetailUrl(postId);
  const isSingle = visibleItems.length === 1;
  const singleItem = visibleItems[0];
  const singleType = String(singleItem?.type || "").toLowerCase();

  if (isSingle) {
    return (
      <div className="px-4 pb-4">
        <Link
          to={postDetailUrl}
          state={{ postId }}
          className="block overflow-hidden rounded-2xl border bg-gray-100"
          title={tr("view_post_details", "View post details")}
        >
          <div className="flex w-full items-center justify-center bg-gray-100">
            {singleType === "video" ? (
              <video
                src={singleItem?.url}
                preload="metadata"
                muted
                playsInline
                controls={false}
                className="block h-auto max-h-[42rem] w-auto max-w-full object-contain bg-black"
              />
            ) : singleType === "image" ? (
              <img
                src={singleItem?.url}
                alt={singleItem?.name || "image-0"}
                className="block h-auto max-h-[42rem] w-auto max-w-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="flex min-h-[18rem] w-full items-center justify-center text-sm text-gray-600">
                {tr("open_media", "Open media")}
              </div>
            )}
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="grid grid-cols-2 gap-2">
        {visibleItems.map((m, idx) => {
          const type = String(m?.type || "").toLowerCase();
          const url = m?.url;
          const showMoreOverlay = idx === MAX_DASHBOARD_MEDIA - 1 && remaining > 0;

          return (
            <Link
              key={`${url}-${idx}`}
              to={postDetailUrl}
              state={{ postId }}
              className="relative block overflow-hidden rounded-2xl border bg-gray-100"
              title={tr("view_post_details", "View post details")}
            >
              <div className="relative flex h-56 w-full items-center justify-center bg-gray-100">
                {type === "video" ? (
                  <video
                    src={url}
                    preload="metadata"
                    muted
                    playsInline
                    className="h-full w-full object-contain bg-black"
                  />
                ) : type === "image" ? (
                  <img
                    src={url}
                    alt={m?.name || `image-${idx}`}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-600">
                    {tr("open_media", "Open media")}
                  </div>
                )}

                {showMoreOverlay ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <div className="text-center text-white">
                      <div className="text-2xl font-semibold">+{remaining}</div>
                      <div className="text-xs opacity-90">{tr("view_all", "View all")}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>

      {items.length > MAX_DASHBOARD_MEDIA ? (
        <div className="mt-2 flex justify-end">
          <Link to={postDetailUrl} state={{ postId }}>
            <Button type="button" variant="link" className="h-auto px-0 text-sm">
              {tr("view_all_photos", "View all photos")}
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
};

/* -------------------- Real Post Card (FOLLOW + MESSAGE only) -------------------- */
const RealPostCard = ({ post, currentUserId, me, subscriptionModeEnabled, authorCountryByUid }) => {
  const { tr } = useTr("agent_dashboard");

  const created = post?.createdAt?.seconds
    ? new Date(post.createdAt.seconds * 1000)
    : post?.createdAt?.toDate
    ? post.createdAt.toDate()
    : null;

  const authorId = post?.authorId || post?.user_id || post?.author_id;
  const authorRole = post?.authorRole || post?.creator_role || "agent";
  const authorName = post?.authorName || post?.author_name || "Agent";
  const authorCountry = authorId ? authorCountryByUid?.[authorId] : null;

  const postCC =
    post?.country_code ||
    post?.countryCode ||
    post?.author_country_code ||
    post?.authorCountryCode ||
    post?.authorCC ||
    "";

  const postCountryName =
    post?.country || post?.country_name || post?.author_country || post?.authorCountry || "";

  const authorCC = (authorCountry?.country_code || postCC || "").toString();
  const authorCountryName = (authorCountry?.country || postCountryName || "").toString();

  const isMine = currentUserId && authorId && currentUserId === authorId;
  const isAdminPost = String(authorRole || "").toLowerCase() === "admin";

  const [boostOpen, setBoostOpen] = useState(false);

  const messageUrl = `${createPageUrl("Messages")}?with=${encodeURIComponent(authorId || "")}`;
  const postDetailUrl = buildPostDetailUrl(post?.id);
  const viewProfileUrl = authorId ? `/view-profile/${encodeURIComponent(authorId)}` : "";

  const fullText = String(post?.text || "");

  const hasLongText = fullText.length > POST_PREVIEW_TEXT_LIMIT;

  const previewText = hasLongText
    ? `${fullText.slice(0, POST_PREVIEW_TEXT_LIMIT).trimEnd()}…`
    : fullText;

  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editText, setEditText] = useState(String(post?.text || ""));
  const [reportReason, setReportReason] = useState("");
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState("");

  useEffect(() => {
    setEditText(String(post?.text || ""));
  }, [post?.text]);

  const getShareUrl = () => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("post", String(post?.id || ""));
      return u.toString();
    } catch {
      return "";
    }
  };

  const handleShare = async () => {
    const url = getShareUrl();
    const title = "GreenPass";
    const text = String(post?.text || "").slice(0, 200);

    try {
      if (navigator.share && url) {
        await navigator.share({ title, text, url });
        return;
      }

      if (navigator.clipboard && url) {
        await navigator.clipboard.writeText(url);
        alert(tr("link_copied", "Link copied"));
        return;
      }

      if (url) window.prompt(tr("copy_link", "Copy this link:"), url);
    } catch (e) {
      console.error("share failed:", e);
    }
  };

  const handleDelete = async () => {
    if (!post?.id || !isMine) return;

    const ok = window.confirm(tr("confirm_delete_post", "Delete this post?"));

    if (!ok) return;

    setMenuBusy(true);
    setMenuError("");

    try {
      await deleteDoc(doc(db, "posts", String(post.id)));
    } catch (e) {
      console.error("delete post failed:", e);
      setMenuError(tr("delete_failed", "Delete failed. Please try again."));
    } finally {
      setMenuBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!post?.id || !isMine) return;

    const next = String(editText || "").trim();

    if (!next) {
      setMenuError(tr("post_cannot_be_empty", "Post cannot be empty."));
      return;
    }

    setMenuBusy(true);
    setMenuError("");

    try {
      await updateDoc(doc(db, "posts", String(post.id)), {
        text: next,
        editedAt: serverTimestamp(),
      });

      setEditOpen(false);
    } catch (e) {
      console.error("edit post failed:", e);
      setMenuError(tr("edit_failed", "Edit failed. Please try again."));
    } finally {
      setMenuBusy(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!post?.id || !currentUserId) return;

    const reason = String(reportReason || "").trim();

    if (!reason) {
      setMenuError(tr("report_reason_required", "Please enter a reason."));
      return;
    }

    setMenuBusy(true);
    setMenuError("");

    try {
      await addDoc(collection(db, "post_reports"), {
        postId: String(post.id),
        reporterId: String(currentUserId),
        authorId: String(authorId || ""),
        authorRole: String(authorRole || ""),
        reason,
        status: "open",
        createdAt: serverTimestamp(),
      });

      setReportReason("");
      setReportOpen(false);
      alert(tr("report_submitted", "Report submitted"));
    } catch (e) {
      console.error("report failed:", e);
      setMenuError(tr("report_failed", "Report failed. Please try again."));
    } finally {
      setMenuBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardContent className="p-0">
        <div className="p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Avatar name={authorName} />

            <div className="leading-tight">
              <div className="flex items-center gap-2 flex-wrap">
                {authorId ? (
                  <Link
                    to={viewProfileUrl}
                    className="font-semibold text-gray-900 hover:underline cursor-pointer"
                    title={tr("view_profile", "View profile")}
                  >
                    {authorName}
                  </Link>
                ) : (
                  <div className="font-semibold text-gray-900">{authorName}</div>
                )}

                <Badge
                  variant="secondary"
                  className="bg-emerald-50 text-emerald-700 border border-emerald-100"
                >
                  {String(authorRole || "agent").toUpperCase()}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                <span>{created ? format(created, "MMM dd, h:mm a") : "—"}</span>
                <span>•</span>

                {authorCC ? (
                  <>
                    <img
                      src={flagUrlFromCode(authorCC)}
                      alt={authorCC}
                      className="h-3.5 w-5 rounded-sm object-cover"
                      loading="lazy"
                    />
                    <span>{authorCountryName || authorCC.toUpperCase()}</span>
                  </>
                ) : (
                  <>
                    <Globe className="h-3.5 w-3.5" />
                    <span>{tr("public", "Public")}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-500"
                type="button"
                disabled={menuBusy}
              >
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-44">
              {isMine ? (
                <>
                  <DropdownMenuItem onClick={() => setEditOpen(true)} disabled={menuBusy}>
                    <span className="flex items-center gap-2">
                      <Pencil className="h-4 w-4" />
                      {tr("edit", "Edit")}
                    </span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={handleDelete}
                    disabled={menuBusy}
                    className="text-red-600"
                  >
                    <span className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4" />
                      {tr("delete", "Delete")}
                    </span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem onClick={handleShare} disabled={menuBusy}>
                <span className="flex items-center gap-2">
                  <Share2 className="h-4 w-4" />
                  {tr("share", "Share")}
                </span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setReportOpen(true)} disabled={menuBusy}>
                <span className="flex items-center gap-2">
                  <Flag className="h-4 w-4" />
                  {tr("report", "Report")}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Dialog open={editOpen} onOpenChange={(v) => (menuBusy ? null : setEditOpen(v))}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{tr("edit_post", "Edit post")}</DialogTitle>
            </DialogHeader>

            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 min-h-[120px]"
              placeholder={tr("edit_placeholder", "Update your post...")}
            />

            {menuError ? <div className="mt-2 text-sm text-red-600">{menuError}</div> : null}

            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditOpen(false)}
                disabled={menuBusy}
              >
                {tr("cancel", "Cancel")}
              </Button>

              <Button type="button" onClick={handleSaveEdit} disabled={menuBusy}>
                {menuBusy ? tr("saving", "Saving...") : tr("save", "Save")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={reportOpen} onOpenChange={(v) => (menuBusy ? null : setReportOpen(v))}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>{tr("report_post", "Report post")}</DialogTitle>
            </DialogHeader>

            <div className="text-sm text-gray-600">
              {tr("report_help", "Tell us what’s wrong with this post. Our team will review it.")}
            </div>

            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 min-h-[120px]"
              placeholder={tr("report_placeholder", "Reason (spam, harassment, scam, etc.)")}
            />

            {menuError ? <div className="mt-2 text-sm text-red-600">{menuError}</div> : null}

            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReportOpen(false)}
                disabled={menuBusy}
              >
                {tr("cancel", "Cancel")}
              </Button>

              <Button
                type="button"
                onClick={handleSubmitReport}
                disabled={menuBusy || !currentUserId}
              >
                {menuBusy ? tr("submitting", "Submitting") : tr("submit", "Submit")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {fullText ? (
          <div className="px-4 pb-3">
            <div className="text-sm text-gray-800 whitespace-pre-line">{previewText}</div>

            {hasLongText ? (
              <div className="mt-2">
                <Link to={postDetailUrl} state={{ postId: post?.id }}>
                  <Button type="button" variant="link" className="h-auto px-0 text-sm font-medium">
                    {tr("view_more", "View more")}
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <MediaGallery media={post?.media || []} postId={post?.id} />

        <div className="px-4 pb-4">
          <div className="mt-3 border-t pt-2 grid grid-cols-2 gap-2">
            {isAdminPost ? (
              <div className="col-span-2">
                <Button
                  variant="outline"
                  className="w-full justify-center text-gray-700"
                  type="button"
                  disabled
                >
                  Official admin post
                </Button>
              </div>
            ) : (
              <>
                <div className="flex">
                  {isMine ? (
                    subscriptionModeEnabled ? (
                      <Button
                        variant="outline"
                        className="w-full justify-center text-gray-700"
                        type="button"
                        onClick={() => setBoostOpen(true)}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {tr("boost_your_post", "Boost your post")}
                      </Button>
                    ) : null
                  ) : (
                    <FollowButton
                      currentUserId={currentUserId}
                      creatorId={authorId}
                      creatorRole={authorRole}
                      className="w-full justify-center"
                    />
                  )}
                </div>

                <Link to={messageUrl} className="w-full">
                  <Button
                    variant="ghost"
                    className="w-full justify-center text-gray-700"
                    type="button"
                    disabled={!authorId || !currentUserId || isMine}
                    title={
                      !authorId
                        ? tr("missing_author_id", "Missing author id")
                        : isMine
                        ? tr("cant_message_self", "You can't message yourself")
                        : tr("message", "Message")
                    }
                  >
                    <MessageCircle className="h-4 w-4 mr-2" />
                    {tr("message", "Message")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {isMine && subscriptionModeEnabled ? (
          <BoostPostDialog open={boostOpen} onOpenChange={setBoostOpen} postId={post?.id} me={me} />
        ) : null}
      </CardContent>
    </Card>
  );
};

export default function AgentDashboard({ user }) {
  const { tr } = useTr("agent_dashboard");

  // ✅ IMPORTANT FIX:
  // Prioritize Firebase Auth UID first, because Firestore users/{uid} should use the auth UID as document ID.
  const initialUserId = user?.uid || user?.user_id || user?.id;

  const [liveUser, setLiveUser] = useState(user);

  const userId = liveUser?.uid || liveUser?.user_id || liveUser?.id || initialUserId;

  useEffect(() => {
    const uid = initialUserId;

    if (!uid) {
      setLiveUser(user);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        if (!snap.exists()) {
          setLiveUser(user);
          return;
        }

        const data = snap.data() || {};

        setLiveUser({
          id: snap.id,
          uid: snap.id,
          user_id: snap.id,
          ...data,
        });
      },
      (err) => {
        console.error("AgentDashboard user subscription listener error:", err);
        setLiveUser(user);
      }
    );

    return () => unsub();
  }, [initialUserId, user]);

  const effectiveUser = liveUser || user;

  const [stats, setStats] = useState({
    totalStudents: 0,
    totalEarnings: 0,
    pendingPayout: 0,
    thisMonthReferrals: 0,
    commissionRate: 10,
    referralCode: "",
  });

  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileCompletion, setProfileCompletion] = useState({ isComplete: true });

  const [composerText, setComposerText] = useState("");
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState([]);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [, setQuotaUsed] = useState(0);
  const [, setQuotaMonth] = useState("");
  const [communityPosts, setCommunityPosts] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [authorCountryByUid, setAuthorCountryByUid] = useState({});

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const effectiveId =
          effectiveUser?.uid || effectiveUser?.user_id || effectiveUser?.id || userId;

        if (!effectiveId) {
          setLoading(false);
          return;
        }

        const [agentData, students] = await Promise.all([
          Agent.filter({ user_id: effectiveId }),
          User.filter({ referred_by_agent_id: effectiveId }),
        ]);

        const agentRecord = agentData.length > 0 ? agentData[0] : null;

        setAgent(agentRecord);

        const completion = getProfileCompletionData(effectiveUser, agentRecord);

        setProfileCompletion(completion);

        const now = new Date();

        const thisMonth = arr(students).filter((s) => {
          const d = toValidDate(s.created_date);
          return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const totalEarnings = 0;

        setStats({
          totalStudents: arr(students).length,
          totalEarnings,
          pendingPayout: agentRecord?.pending_payout || 0,
          thisMonthReferrals: thisMonth.length,
          commissionRate: (agentRecord?.commission_rate || 0.1) * 100,
          referralCode: agentRecord?.referral_code || "",
        });
      } catch (error) {
        console.error("Error loading dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [effectiveUser, userId]);

  useEffect(() => {
    if (!userId) return;

    setCommunityLoading(true);

    const q = query(
      collection(db, "posts"),
      where("status", "==", "published"),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const now = new Date();

        list.sort((a, b) => {
          const aUntil = a?.boosted_until?.toDate
            ? a.boosted_until.toDate()
            : a?.boosted_until?.seconds
            ? new Date(a.boosted_until.seconds * 1000)
            : null;

          const bUntil = b?.boosted_until?.toDate
            ? b.boosted_until.toDate()
            : b?.boosted_until?.seconds
            ? new Date(b.boosted_until.seconds * 1000)
            : null;

          const aBoost = aUntil && aUntil > now;
          const bBoost = bUntil && bUntil > now;

          if (aBoost !== bBoost) return bBoost ? 1 : -1;

          const aCreated = a?.createdAt?.toDate
            ? a.createdAt.toDate()
            : a?.createdAt?.seconds
            ? new Date(a.createdAt.seconds * 1000)
            : null;

          const bCreated = b?.createdAt?.toDate
            ? b.createdAt.toDate()
            : b?.createdAt?.seconds
            ? new Date(b.createdAt.seconds * 1000)
            : null;

          const at = aCreated ? aCreated.getTime() : 0;
          const bt = bCreated ? bCreated.getTime() : 0;

          return bt - at;
        });

        setCommunityPosts(list);
        setCommunityLoading(false);
      },
      (err) => {
        console.error("community posts snapshot error:", err);
        setCommunityPosts([]);
        setCommunityLoading(false);
      }
    );

    return () => unsub();
  }, [userId]);

  useEffect(() => {
    const ids = Array.from(
      new Set(
        (communityPosts || [])
          .map((p) => p?.authorId || p?.user_id || p?.author_id)
          .filter(Boolean)
      )
    );

    const missing = ids.filter((uid) => !authorCountryByUid?.[uid]);

    if (missing.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const entries = await Promise.all(
          missing.map(async (uid) => {
            try {
              let d = {};

              try {
                const snap = await getDoc(doc(db, "users", uid));
                if (snap.exists()) d = snap.data() || {};
              } catch {}

              if (!d || Object.keys(d).length === 0) {
                try {
                  const q1 = query(collection(db, "users"), where("uid", "==", uid), limit(1));
                  const s1 = await getDocs(q1);
                  if (!s1.empty) d = s1.docs[0].data() || {};
                } catch {}
              }

              if (!d || Object.keys(d).length === 0) {
                try {
                  const q2 = query(collection(db, "users"), where("user_id", "==", uid), limit(1));
                  const s2 = await getDocs(q2);
                  if (!s2.empty) d = s2.docs[0].data() || {};
                } catch {}
              }

              const country = d.country || d.country_name || "";
              const country_code =
                d.country_code || d.countryCode || d.countryCode2 || d.countryCodeISO || "";

              return [uid, { country, country_code }];
            } catch {
              return [uid, { country: "", country_code: "" }];
            }
          })
        );

        if (cancelled) return;

        setAuthorCountryByUid((prev) => {
          const next = { ...(prev || {}) };

          entries.forEach(([uid, val]) => {
            next[uid] = val;
          });

          return next;
        });
      } catch (e) {
        console.warn("author country lookup failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [communityPosts, authorCountryByUid]);

  useEffect(() => {
    attachmentPreviews.forEach((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
    });

    const next = attachments.map((f, idx) => ({
      id: `${f.name}-${f.size}-${f.lastModified}-${idx}`,
      name: f.name,
      type: f.type,
      url: URL.createObjectURL(f),
    }));

    setAttachmentPreviews(next);

    return () => {
      next.forEach((p) => {
        if (p?.url) URL.revokeObjectURL(p.url);
      });
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  const openFilePicker = () => fileInputRef.current?.click();

  const onFilesSelected = (e) => {
    const files = Array.from(e.target.files || []);

    if (!files.length) return;

    const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    const map = new Map();

    [...attachments, ...files].forEach((f) => map.set(key(f), f));

    setAttachments(Array.from(map.values()));

    e.target.value = "";
  };

  const removeAttachment = (id) => {
    const toRemove = attachmentPreviews.find((p) => p.id === id);

    if (!toRemove) return;

    setAttachments((prev) =>
      prev.filter((f) => !(f.name === toRemove.name && f.type === toRemove.type))
    );
  };

  const clearComposer = () => {
    setComposerText("");
    setAttachments([]);
    setPostError("");
  };

  const uploadOne = async (file, postId, idx) => {
    const ext = (file.name || "").split(".").pop() || "";
    const safeExt = ext ? `.${ext}` : "";
    const path = `posts/${postId}/${idx}-${Date.now()}${safeExt}`;

    const sref = storageRef(storage, path);

    await uploadBytes(sref, file, { contentType: file.type || undefined });

    const url = await getDownloadURL(sref);

    const type = String(file.type || "").startsWith("video/") ? "video" : "image";

    return {
      type,
      url,
      name: file.name || `file-${idx}`,
      contentType: file.type || null,
      size: file.size || null,
      storagePath: path,
    };
  };

  const isSubscribed = useMemo(() => isSubscribedUser(effectiveUser), [effectiveUser]);

  const { subscriptionModeEnabled } = useSubscriptionMode();

  const subscribeUrl = useMemo(() => createPageUrl("Pricing"), []);

  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const canCreateEvent = !subscriptionModeEnabled || isSubscribed;

  const [limitOpen, setLimitOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const meRef = doc(db, "users", userId);

    const unsub = onSnapshot(meRef, (snap) => {
      if (!snap.exists()) return;

      const d = snap.data() || {};

      setQuotaUsed(Number(d.post_quota_used || 0));
      setQuotaMonth(String(d.post_quota_month || ""));
    });

    return () => unsub();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  const firstName = effectiveUser?.full_name?.split(" ")[0] || "Agent";

  const handlePost = async () => {
    const text = composerText.trim();

    if (!text && attachments.length === 0) return;
    if (!userId) return;

    setPosting(true);
    setPostError("");

    try {
      const authorName = effectiveUser?.full_name || "Agent";
      const canEnforceLimit = subscriptionModeEnabled === true;
      const isUnlimited = isSubscribed === true;

      let postDocId = null;

      await runTransaction(db, async (tx) => {
        const meRef = doc(db, "users", userId);

        if (canEnforceLimit && !isUnlimited) {
          const q = await ensureMonthlyPostQuota(tx, meRef);

          if (q.used >= 10) throw new Error("POST_LIMIT_REACHED");

          tx.set(
            meRef,
            {
              post_quota_used: increment(1),
              post_quota_updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }

        const postRef = doc(collection(db, "posts"));
        postDocId = postRef.id;

        tx.set(postRef, {
          authorId: userId,
          authorRole: "agent",
          authorName,
          text,
          media: [],
          status: "published",
          paid: false,
          boosted: false,
          boost_sort: 0,
          createdAt: serverTimestamp(),
        });
      });

      if (postDocId && attachments.length > 0) {
        const uploaded = [];

        for (let i = 0; i < attachments.length; i++) {
          uploaded.push(await uploadOne(attachments[i], postDocId, i));
        }

        await updateDoc(doc(db, "posts", postDocId), {
          media: uploaded,
        });
      }

      clearComposer();
    } catch (e) {
      console.error("handlePost error:", e);

      if (String(e?.message || "").includes("POST_LIMIT_REACHED")) {
        setLimitOpen(true);
        setPostError(tr("limit_desc", "You’ve reached the posting limit. Subscribe to post more."));
      } else {
        setPostError("Failed to post. Please try again.");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("limit_title", "Posting limit reached")}</DialogTitle>
          </DialogHeader>

          <div className="text-sm text-gray-700">
            {tr("limit_desc", "You’ve reached the posting limit. Subscribe to post more.")}
          </div>

          <div className="mt-4 flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setLimitOpen(false)}>
              Close
            </Button>

            <Link to={subscribeUrl}>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700">
                Subscribe
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <CreateEventDialog
        open={createEventOpen}
        onOpenChange={setCreateEventOpen}
        user={effectiveUser}
        role="agent"
        allowedPlatforms={["nasio", "eventbrite"]}
        disabledReason={
          !canCreateEvent
            ? tr("subscription_required", "Subscription required to create events")
            : null
        }
      />

      <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="mx-auto max-w-[1800px]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                {tr("welcome", "Welcome")}, {firstName}
              </h1>
            </div>
          </div>

          {subscriptionModeEnabled && !isSubscribed && (
            <div className="mb-4">
              <SubscribeBanner to={subscribeUrl} user={effectiveUser} />
            </div>
          )}

          <div className="mb-4">
            <InlineProfileCompletionBanner user={effectiveUser} relatedEntity={agent} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10">
            <div className="hidden lg:block lg:col-span-3">
              <div className="sticky top-4 space-y-4">
                <div className="rounded-2xl border bg-white p-2">
                  <div className="px-2 py-2 text-xs font-semibold text-gray-500">
                    {tr("shortcuts", "Shortcuts")}
                  </div>

                  <div className="space-y-1">
                    <Shortcut
                      to={createPageUrl("MyStudents")}
                      label={tr("my_students", "My Students")}
                      icon={<Users className="h-5 w-5 text-blue-600" />}
                    />

                    <Shortcut
                      to={createPageUrl("AgentLeads")}
                      label={tr("find_leads", "Find Leads")}
                      icon={<UserPlus className="h-5 w-5 text-orange-600" />}
                    />

                    <Shortcut
                      to={createPageUrl("Events")}
                      label={tr("events", "Events")}
                      icon={<Ticket className="h-5 w-5 text-emerald-600" />}
                    />

                    <Shortcut
                      to={createPageUrl("Directory")}
                      label={tr("directory", "Directory")}
                      icon={<Building2 className="h-5 w-5 text-blue-600" />}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {tr("invite", "Invite")}
                  </div>

                  <Button size="sm" onClick={() => setInviteOpen(true)}>
                    {tr("invite", "Invite")}
                  </Button>
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  {tr("invite_hint", "Invite agents, schools, or students via link or email.")}
                </div>
              </div>

              <InviteUsersDialog
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                allowedRoles={["agent", "school", "student"]}
                defaultRole="agent"
                title={tr("invite", "Invite")}
              />

              <div className="mt-4 rounded-2xl border bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {tr("create_event", "Create Event")}
                  </div>

                  {!canCreateEvent ? (
                    <Badge className="bg-yellow-100 text-yellow-800">
                      {tr("pending", "Pending")}
                    </Badge>
                  ) : null}
                </div>

                <Button
                  type="button"
                  className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md ring-1 ring-emerald-200"
                  onClick={() => setCreateEventOpen(true)}
                  disabled={!canCreateEvent}
                  title={
                    !canCreateEvent
                      ? tr("subscription_required", "Subscription required to create events")
                      : undefined
                  }
                >
                  <Ticket className="h-4 w-4 mr-2" />
                  {tr("create_event", "Create Event")}
                </Button>
              </div>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <ActionBlocker
                isBlocked={!profileCompletion.isComplete}
                title={tr("block_post_title", "Complete Profile to Post")}
                message={tr(
                  "block_post_msg",
                  "Finish your agent profile to publish updates and announcements."
                )}
              >
                <div className="rounded-2xl border bg-white">
                  <div className="p-3 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 w-full">
                      <Avatar name={effectiveUser?.full_name || "Agent"} />

                      <div className="w-full">
                        <div className="text-sm font-semibold text-gray-900">
                          {tr("whats_on_your_mind", "What’s on your mind,")} {firstName}?
                        </div>

                        <textarea
                          value={composerText}
                          onChange={(e) => setComposerText(e.target.value)}
                          placeholder={tr(
                            "composer_placeholder",
                            "Share an update about schools, events, or your agency..."
                          )}
                          className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 min-h-[90px]"
                        />

                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*,video/*"
                          className="hidden"
                          onChange={onFilesSelected}
                        />

                        {attachmentPreviews.length > 0 ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {attachmentPreviews.map((p) => {
                              const isVideo = String(p.type || "").startsWith("video/");

                              return (
                                <div
                                  key={p.id}
                                  className="relative overflow-hidden rounded-2xl border bg-gray-100"
                                >
                                  <button
                                    type="button"
                                    onClick={() => removeAttachment(p.id)}
                                    className="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 hover:bg-white shadow"
                                    title="Remove"
                                  >
                                    <X className="h-4 w-4 text-gray-700" />
                                  </button>

                                  <div className="flex h-36 w-full items-center justify-center bg-gray-100">
                                    {isVideo ? (
                                      <video
                                        src={p.url}
                                        className="h-full w-full object-contain bg-black"
                                        preload="metadata"
                                        muted
                                      />
                                    ) : (
                                      <img
                                        src={p.url}
                                        alt={p.name}
                                        className="h-full w-full object-contain"
                                        loading="lazy"
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {postError ? (
                          <div className="mt-2 text-sm text-red-600">{postError}</div>
                        ) : null}

                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            className="justify-center text-gray-700 w-full sm:w-auto"
                            onClick={openFilePicker}
                          >
                            <ImageIcon className="h-4 w-4 mr-2 text-green-600" />
                            {tr("photo_video", "Photo/video")}
                          </Button>

                          <Button
                            className="rounded-xl w-full sm:w-auto"
                            onClick={handlePost}
                            disabled={posting || (!composerText.trim() && attachments.length === 0)}
                          >
                            {posting ? (
                              <span className="inline-flex items-center">
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Posting
                              </span>
                            ) : (
                              "Post"
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t px-3 py-2 flex items-center gap-2 text-xs text-gray-500">
                    <Globe className="h-3.5 w-3.5" />
                    Public
                  </div>
                </div>
              </ActionBlocker>

              <div className="space-y-4">
                {communityLoading ? (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
                    Loading posts…
                  </div>
                ) : communityPosts.length === 0 ? (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
                    No posts yet. Be the first to post an update.
                  </div>
                ) : (
                  communityPosts.map((p) => (
                    <RealPostCard
                      key={p.id}
                      post={p}
                      currentUserId={userId}
                      me={effectiveUser}
                      subscriptionModeEnabled={subscriptionModeEnabled}
                      authorCountryByUid={authorCountryByUid}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="hidden lg:block lg:col-span-3">
              <div className="sticky top-4 space-y-4">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-sm font-semibold text-gray-900 mb-3">
                    {tr("highlights", "Highlights")}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">
                        {tr("students", "Students")}
                      </div>
                      <div className="text-lg font-bold text-blue-600">
                        {stats.totalStudents}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-gray-900">
                      {tr("contacts", "Contacts")}
                    </div>

                    <Button variant="ghost" size="icon" className="text-gray-500">
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {["GreenPass Support", "GAIN Fair Team", "School Rep", "Admissions Desk"].map(
                      (n) => (
                        <div
                          key={n}
                          className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-gray-50 transition"
                        >
                          <Avatar name={n} size="sm" />
                          <div className="text-sm text-gray-800">{n}</div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- Boost Modal -------------------- */
const BOOST_PLANS = [
  { days: 7, price: 1.99 },
  { days: 15, price: 2.99 },
  { days: 30, price: 3.99 },
];

function monthKeyUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function ensureMonthlyPostQuota(tx, userRef) {
  const snap = await tx.get(userRef);
  const nowKey = monthKeyUTC();
  const data = snap.exists() ? snap.data() : {};
  const storedKey = String(data?.post_quota_month || "");

  if (storedKey !== nowKey) {
    tx.set(
      userRef,
      {
        post_quota_month: nowKey,
        post_quota_used: 0,
        post_quota_updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return {
      used: 0,
      key: nowKey,
    };
  }

  return {
    used: Number(data?.post_quota_used || 0),
    key: storedKey || nowKey,
  };
}

const BoostPostDialog = ({ open, onOpenChange, postId, me }) => {
  const { tr } = useTr("agent_dashboard");

  const [plan, setPlan] = useState(BOOST_PLANS[0]);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const payerName = me?.full_name || me?.name || "GreenPass User";
  const payerEmail = me?.email || "";

  const handleSuccess = async (provider, transactionId, payload) => {
    if (!postId) return;

    setProcessing(true);
    setErr("");

    try {
      const until = Timestamp.fromDate(
        new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000)
      );

      await updateDoc(doc(db, "posts", postId), {
        boosted: true,
        boost_days: plan.days,
        boost_price_usd: plan.price,
        boost_currency: "USD",
        boost_transaction_id: String(transactionId || ""),
        boost_provider: String(provider || "paypal"),
        boost_details: payload || null,
        boosted_at: serverTimestamp(),
        boosted_until: until,
      });

      setDone(true);
    } catch (e) {
      console.error("boost update post failed:", e);

      setErr(
        tr(
          "payment_succeeded_but_failed",
          "Payment succeeded, but we couldn't activate the boost. Please contact support."
        )
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (processing ? null : onOpenChange(v))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("boost_title", "Boost your post")}</DialogTitle>
        </DialogHeader>

        {!done ? (
          <>
            <div className="mt-1 text-sm text-gray-600">
              {tr("boost_subtitle", "Choose a boost duration, then pay.")}
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {BOOST_PLANS.map((p) => {
                const selected = plan?.days === p.days;

                return (
                  <Button
                    key={p.days}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    className="w-full"
                    onClick={() => setPlan(p)}
                    disabled={processing}
                  >
                    ${p.price.toFixed(2)} • {p.days} days
                  </Button>
                );
              })}
            </div>

            <div className="mt-4">
              <SharedPaymentGateway
                amountUSD={plan.price}
                itemDescription={`Boost Post (${plan.days} days)`}
                payerName={payerName}
                payerEmail={payerEmail}
                onProcessing={() => setProcessing(true)}
                onDoneProcessing={() => setProcessing(false)}
                onError={(e) => {
                  console.error(e);
                  setErr(tr("payment_failed", "Payment failed. Please try again."));
                }}
                onCardPaymentSuccess={handleSuccess}
              />
            </div>

            {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}
          </>
        ) : (
          <div className="mt-4">
            <div className="text-sm text-emerald-700 font-medium">
              {tr("boost_activated", "Boost activated ✅")}
            </div>

            <Button type="button" className="w-full mt-3" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};