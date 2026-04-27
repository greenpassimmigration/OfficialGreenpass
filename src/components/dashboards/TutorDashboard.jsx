// src/pages/TutorDashboard.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TutoringSession, Wallet, Tutor } from "@/api/entities";
import { listenFollowState, sendFollowRequest, cancelFollowRequest, unfollowUser } from "@/api/follow";
import {
  Calendar,
  Users,
  ArrowRight,
  CreditCard,
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Flag,
  Globe,
  Image as ImageIcon,
  X,
  Loader2,
  Video,
  MessageSquare,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import SharedPaymentGateway from "@/components/payments/SharedPaymentGateway";
import CreateEventDialog from "@/components/events/CreateEventDialog";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";
import { useTr } from "@/i18n/useTr";

// ✅ Firebase
import { db, storage } from "@/firebase";
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  runTransaction,
  Timestamp,
  increment,
  getDoc
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ✅ SUBSCRIPTION LOGIC */
function isSubscribedUser(u) {
  if (!u) return false;
  if (u.subscription_active === true) return true;
  const status = String(u.subscription_status || "").toLowerCase().trim();
  const ok = new Set(["active", "paid", "trialing"]);
  return ok.has(status);
}

const POST_PREVIEW_TEXT_LIMIT = 320;
const MAX_DASHBOARD_MEDIA = 4;
const buildPostDetailUrl = (postId) =>
  `${createPageUrl("PostDetail")}?id=${encodeURIComponent(postId || "")}`;

// 🌍 Country flag helper
const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

const SubscribeBanner = ({ to, user, tr }) => {
  const status = String(user?.subscription_status || "").toLowerCase().trim();

  const message =
    status === "skipped"
      ? tr(
          "subscribe_skipped",
          "You skipped subscription. Subscribe to unlock full tutor features, visibility, and payouts."
        )
      : status === "expired"
      ? tr(
          "subscribe_expired",
          "Your subscription expired. Renew to regain full tutor features, visibility, and payouts."
        )
      : tr(
          "subscribe_default",
          "You’re not subscribed yet. Subscribe to unlock full tutor features, visibility, and payouts."
        );

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <CreditCard className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-red-800">
            {tr("subscription_required", "Subscription required")}
          </p>
          <p className="text-sm text-red-700">{message}</p>
        </div>
      </div>

      <Link to={to}>
        <Button className="bg-red-600 hover:bg-red-700 w-full sm:w-auto" type="button">
          {tr("subscribe_now", "Subscribe Now")}
        </Button>
      </Link>
    </div>
  );
};

const QuickLink = ({ title, description, to, icon }) => (
  <Link to={to} className="block">
    <Card className="hover:shadow-md transition-shadow cursor-pointer rounded-2xl">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <h4 className="font-semibold">{title}</h4>
            <p className="text-sm text-gray-600">{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </Link>
);

const Avatar = ({ name = "Tutor", size = "md" }) => {
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
      {initials || "T"}
    </div>
  );
};

/* -------------------- Follow Button -------------------- */
function FollowButton({ currentUserId, creatorId, creatorRole, size = "sm", className = "" }) {
  const { tr } = useTr("tutor_dashboard");

  const [state, setState] = useState({ following: false, requested: false });
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

/* -------------------- Media grid -------------------- */
const MediaGallery = ({ media = [], tr, postId }) => {
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
          title={tr?.("view_post_details", "View post details")}
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
                {tr?.("open_media", "Open media")}
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
          if (!url) return null;
          const showMoreOverlay = idx === MAX_DASHBOARD_MEDIA - 1 && remaining > 0;

          return (
            <Link
              key={`${url}-${idx}`}
              to={postDetailUrl}
              state={{ postId }}
              className="relative block overflow-hidden rounded-2xl border bg-gray-100"
              title={tr?.("view_post_details", "View post details")}
            >
              <div className="relative flex h-56 w-full items-center justify-center bg-gray-100">
                {type === "image" ? (
                  <img
                    src={url}
                    alt={m?.name || `image-${idx}`}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : type === "video" ? (
                  <video
                    src={url}
                    preload="metadata"
                    muted
                    playsInline
                    className="h-full w-full object-contain bg-black"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-gray-600">
                    {tr?.("open_media", "Open media")}
                  </div>
                )}

                {showMoreOverlay ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <div className="text-center text-white">
                      <div className="text-2xl font-semibold">+{remaining}</div>
                      <div className="text-xs opacity-90">{tr?.("view_all", "View all")}</div>
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
              {tr?.("view_all_photos", "View all photos")}
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
};

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
      { post_quota_month: nowKey, post_quota_used: 0, post_quota_updatedAt: serverTimestamp() },
      { merge: true }
    );
    return { used: 0, key: nowKey };
  }
  return { used: Number(data?.post_quota_used || 0), key: storedKey || nowKey };
}

const BoostPostDialog = ({ open, onOpenChange, postId, me, tr }) => {
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
      const until = Timestamp.fromDate(new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000));
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
      setErr(tr?.("boost_activate_failed","Payment succeeded, but we couldn't activate the boost. Please contact support."));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (processing ? null : onOpenChange(v))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr?.("boost_title","Boost your post")}</DialogTitle>
        </DialogHeader>

        {!done ? (
          <>
            <div className="mt-1 text-sm text-gray-600">{tr?.("boost_choose","Choose a boost duration, then pay.")}</div>

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
                  setErr(tr?.("payment_failed","Payment failed. Please try again."));
                }}
                onCardPaymentSuccess={handleSuccess}
              />
            </div>

            {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}
          </>
        ) : (
          <div className="mt-4">
            <div className="text-sm text-emerald-700 font-medium">{tr?.("boost_activated","Boost activated ✅")}</div>
            <Button type="button" className="w-full mt-3" onClick={() => onOpenChange(false)}>
              {tr?.("close","Close")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* -------------------- Post Card -------------------- */
const RealPostCard = ({ post, currentUserId, me, subscriptionModeEnabled, tr, authorCountryByUid }) => {
  const created = post?.createdAt?.seconds
    ? new Date(post.createdAt.seconds * 1000)
    : post?.createdAt?.toDate
    ? post.createdAt.toDate()
    : null;

  const authorId = post?.authorId || post?.user_id || post?.author_id;
  const authorRole = post?.authorRole || post?.creator_role || "tutor";
  const authorName = post?.authorName || post?.author_name || "Tutor";
  const isMine = !!(currentUserId && authorId && currentUserId === authorId);
  const isAdminPost = String(authorRole || "").toLowerCase() === "admin";
  const [boostOpen, setBoostOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(String(post?.text || ""));
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");

  const postDetailsUrl = useMemo(() => buildPostDetailUrl(post?.id), [post?.id]);
  const fullText = String(post?.text || "");
  const hasLongText = fullText.length > POST_PREVIEW_TEXT_LIMIT;
  const previewText = hasLongText
    ? `${fullText.slice(0, POST_PREVIEW_TEXT_LIMIT).trimEnd()}…`
    : fullText;

  useEffect(() => {
    setEditText(String(post?.text || ""));
  }, [post?.id, post?.text]);

  const handleShare = async () => {
    if (!postDetailsUrl) return;
    setActionErr("");
    try {
      const fullUrl = `${window.location.origin}${postDetailsUrl}`;
      if (navigator?.share) {
        await navigator.share({
          title: tr?.("post","Post") || "Post",
          text: tr?.("share_post","Check out this post") || "Check out this post",
          url: fullUrl,
        });
        return;
      }

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = fullUrl;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      alert(tr?.("link_copied","Link copied") || "Link copied");
    } catch (e) {
      console.error("share error:", e);
      setActionErr(tr?.("share_failed","Failed to share") || "Failed to share");
    }
  };

  const viewProfileUrl = authorId
  ? `/view-profile/${encodeURIComponent(authorId)}`
  : "";

  const handleSaveEdit = async () => {
    if (!isMine || !post?.id) return;
    const next = String(editText || "").trim();
    if (next.length === 0) {
      setActionErr(tr?.("post_empty","Post cannot be empty") || "Post cannot be empty");
      return;
    }

    setActionBusy(true);
    setActionErr("");
    try {
      await updateDoc(doc(db, "posts", post.id), {
        text: next,
        editedAt: serverTimestamp(),
      });
      setEditOpen(false);
    } catch (e) {
      console.error("edit post error:", e);
      setActionErr(tr?.("edit_failed","Failed to edit post") || "Failed to edit post");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!isMine || !post?.id) return;
    const ok = window.confirm(tr?.("confirm_delete","Delete this post?") || "Delete this post?");
    if (!ok) return;

    setActionBusy(true);
    setActionErr("");
    try {
      await deleteDoc(doc(db, "posts", post.id));
    } catch (e) {
      console.error("delete post error:", e);
      setActionErr(tr?.("delete_failed","Failed to delete post") || "Failed to delete post");
    } finally {
      setActionBusy(false);
    }
  };

  const handleReport = async () => {
    if (!post?.id) return;
    const reason = String(reportReason || "").trim();
    if (reason.length < 3) {
      setActionErr(tr?.("report_reason_short","Please enter a short reason") || "Please enter a short reason");
      return;
    }

    setActionBusy(true);
    setActionErr("");
    try {
      await addDoc(collection(db, "post_reports"), {
        postId: post.id,
        reporterId: currentUserId || null,
        authorId: authorId || null,
        reason,
        status: "open",
        createdAt: serverTimestamp(),
      });
      setReportReason("");
      setReportOpen(false);
      alert(tr?.("report_submitted","Report submitted") || "Report submitted");
    } catch (e) {
      console.error("report post error:", e);
      setActionErr(tr?.("report_failed","Failed to submit report") || "Failed to submit report");
    } finally {
      setActionBusy(false);
    }
  };

  const messageUrl = `${createPageUrl("Messages")}?with=${encodeURIComponent(authorId || "")}`;

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
                    title={tr?.("view_profile", "View profile")}
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
                  {String(authorRole || "tutor").toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                <span>{created ? format(created, "MMM dd, h:mm a") : "—"}</span>
                <span>•</span>
                {(() => {
                  const c = authorCountryByUid?.[authorId] || {};
                  const cc = (c.country_code || "").toString().trim();
                  const name = (c.country || "").toString().trim();
                  const flagUrl = flagUrlFromCode(cc);

                  if (flagUrl || name) {
                    return (
                      <span className="inline-flex items-center gap-2">
                        {flagUrl ? (
                          <img
                            src={flagUrl}
                            alt={name ? `${name} flag` : "Country flag"}
                            className="h-3.5 w-5 rounded-sm object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <span>{name || cc.toUpperCase() || tr?.("public","Public")}</span>
                      </span>
                    );
                  }

                  return (
                    <>
                      <Globe className="h-3.5 w-3.5" />
                      <span>{tr?.("public","Public")}</span>
                    </>
                  );
                })()}
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
                aria-label={tr?.("post_actions","Post actions") || "Post actions"}
              >
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-44">
              {isMine ? (
                <>
                  <DropdownMenuItem onClick={() => { setActionErr(""); setEditOpen(true); }}>
                    <Pencil className="h-4 w-4 mr-2" /> {tr?.("edit","Edit") || "Edit"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} disabled={actionBusy}>
                    <Trash2 className="h-4 w-4 mr-2" /> {tr?.("delete","Delete") || "Delete"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-2" /> {tr?.("share","Share") || "Share"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setActionErr(""); setReportOpen(true); }}>
                <Flag className="h-4 w-4 mr-2" /> {tr?.("report","Report") || "Report"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {fullText ? (
          <div className="px-4 pb-3">
            <div className="text-sm text-gray-800 whitespace-pre-line">{previewText}</div>
            {hasLongText ? (
              <div className="mt-2">
                <Link to={postDetailsUrl} state={{ postId: post?.id }}>
                  <Button type="button" variant="link" className="h-auto px-0 text-sm font-medium">
                    {tr?.("view_more", "View more")}
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <MediaGallery media={post?.media || []} tr={tr} postId={post?.id} />

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
                        <Sparkles className="h-4 w-4 mr-2" /> {tr?.("boost_your_post", "Boost your post")}
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
                        ? tr?.("missing_author_id", "Missing author id")
                        : isMine
                        ? tr?.("cant_message_self", "You can't message yourself")
                        : tr?.("message", "Message")
                    }
                  >
                    <MessageSquare className="h-4 w-4 mr-2" /> {tr?.("message", "Message")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {actionErr ? (
          <div className="px-4 pb-3 text-sm text-red-600">{actionErr}</div>
        ) : null}

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tr?.("edit_post","Edit post") || "Edit post"}</DialogTitle>
            </DialogHeader>
            <textarea
              className="min-h-[140px] w-full rounded-xl border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder={tr?.("write_something","Write something...") || "Write something..."}
            />

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={actionBusy}>
                {tr?.("cancel","Cancel") || "Cancel"}
              </Button>
              <Button type="button" onClick={handleSaveEdit} disabled={actionBusy}>
                {actionBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr?.("saving","Saving...") || "Saving..."}
                  </>
                ) : (
                  tr?.("save","Save") || "Save"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={reportOpen} onOpenChange={setReportOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tr?.("report_post","Report post") || "Report post"}</DialogTitle>
            </DialogHeader>

            <div className="text-sm text-gray-600">
              {tr?.("report_help","Tell us what's wrong (spam, scam, harassment, etc.).") ||
                "Tell us what's wrong (spam, scam, harassment, etc.)."}
            </div>

            <textarea
              className="min-h-[120px] w-full rounded-xl border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder={tr?.("report_reason","Reason") || "Reason"}
            />

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReportOpen(false)} disabled={actionBusy}>
                {tr?.("cancel","Cancel") || "Cancel"}
              </Button>
              <Button type="button" onClick={handleReport} disabled={actionBusy}>
                {actionBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr?.("submitting","Submitting...") || "Submitting..."}
                  </>
                ) : (
                  tr?.("submit","Submit") || "Submit"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {isMine && subscriptionModeEnabled ? (
          <BoostPostDialog
            open={boostOpen}
            onOpenChange={setBoostOpen}
            postId={post?.id}
            me={me}
            tr={tr}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};

export default function TutorDashboard({ user }) {
  // ✅ IMPORTANT FIX:
  // Prioritize Firebase Auth UID first because Firestore users/{uid}
  // should use the Firebase Auth UID as the document ID.
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
        console.error("TutorDashboard user subscription listener error:", err);
        setLiveUser(user);
      }
    );

    return () => unsub();
  }, [initialUserId, user]);

  const effectiveUser = liveUser || user;

  const [stats, setStats] = useState({
    totalSessions: 0,
    upcomingSessions: 0,
    completedSessions: 0,
    totalEarnings: 0,
    totalStudents: 0,
    averageRating: 0,
    availableBalance: 0,
  });
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [tutorProfile, setTutorProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [composerText, setComposerText] = useState("");
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState([]);

  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [quotaMonth, setQuotaMonth] = useState("");

  const [communityPosts, setCommunityPosts] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [authorCountryByUid, setAuthorCountryByUid] = useState({});

  useEffect(() => {
    let alive = true;

    const ids = Array.from(
      new Set(
        (communityPosts || [])
          .map((p) => p?.author_id || p?.authorId || p?.user_id || p?.uid || p?.created_by)
          .filter(Boolean)
      )
    );

    const missing = ids.filter((uid) => !authorCountryByUid?.[uid]);
    if (!missing.length) return () => { alive = false; };

    (async () => {
      const updates = {};
      await Promise.all(
        missing.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            if (!snap.exists()) return;

            const d = snap.data() || {};
            const cc =
              d.country_code ||
              d.countryCode ||
              d.country?.code ||
              d.country?.country_code ||
              d.country?.countryCode ||
              "";
            const name =
              d.country ||
              d.country_name ||
              d.countryName ||
              d.country?.name ||
              "";

            updates[uid] = { country_code: cc, country: name };
          } catch {
            // ignore
          }
        })
      );

      if (alive && Object.keys(updates).length) {
        setAuthorCountryByUid((prev) => ({ ...(prev || {}), ...updates }));
      }
    })();

    return () => { alive = false; };
  }, [communityPosts, authorCountryByUid]);

  const isSubscribed = useMemo(() => isSubscribedUser(effectiveUser), [effectiveUser]);
  const { subscriptionModeEnabled } = useSubscriptionMode();
  const subscribeUrl = useMemo(() => createPageUrl("/checkout?type=subscription&role=tutor&plan=tutor_monthly"), []);

  const [createEventOpen, setCreateEventOpen] = useState(false);
  const canCreateEvent = !subscriptionModeEnabled || isSubscribed;

  const { tr } = useTr("tutor_dashboard");
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

  useEffect(() => {
    if (!userId) return;

    const loadDashboardData = async () => {
      try {
        const [sessions, wallet, tutorData] = await Promise.all([
          TutoringSession.filter({ tutor_id: userId }, "-scheduled_date"),
          Wallet.filter({ user_id: userId }),
          Tutor.filter({ user_id: userId }),
        ]);

        const now = new Date();
        const upcoming = sessions
          .filter((s) => s.status === "scheduled" && new Date(s.scheduled_date) > now)
          .slice(0, 5);

        const uniqueStudents = [...new Set(sessions.map((s) => s.student_id).filter(Boolean))];
        const completedWithRating = sessions.filter(
          (s) => s.status === "completed" && s.student_rating
        );
        const avgRating =
          completedWithRating.length > 0
            ? completedWithRating.reduce((sum, s) => sum + s.student_rating, 0) /
              completedWithRating.length
            : 0;

        setStats({
          totalSessions: sessions.length,
          upcomingSessions: sessions.filter(
            (s) => s.status === "scheduled" && new Date(s.scheduled_date) > now
          ).length,
          completedSessions: sessions.filter((s) => s.status === "completed").length,
          totalEarnings: wallet.length > 0 ? wallet[0].total_earned || 0 : 0,
          totalStudents: uniqueStudents.length,
          averageRating: avgRating,
          availableBalance: wallet.length > 0 ? wallet[0].balance_usd || 0 : 0,
        });

        setUpcomingSessions(upcoming);
        setTutorProfile(tutorData.length > 0 ? tutorData[0] : null);
      } catch (error) {
        console.error("Error loading dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [userId]);

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
          const aUntil = a?.boosted_until?.toDate ? a.boosted_until.toDate() : a?.boosted_until?.seconds ? new Date(a.boosted_until.seconds * 1000) : null;
          const bUntil = b?.boosted_until?.toDate ? b.boosted_until.toDate() : b?.boosted_until?.seconds ? new Date(b.boosted_until.seconds * 1000) : null;
          const aBoost = aUntil && aUntil > now;
          const bBoost = bUntil && bUntil > now;
          if (aBoost !== bBoost) return bBoost ? 1 : -1;
          const aCreated = a?.createdAt?.toDate ? a.createdAt.toDate() : a?.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000) : null;
          const bCreated = b?.createdAt?.toDate ? b.createdAt.toDate() : b?.createdAt?.seconds ? new Date(b.createdAt.seconds * 1000) : null;
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

  const handlePost = async () => {
    const text = composerText.trim();
    if (!text && attachments.length === 0) return;
    if (!userId) return;

    if (subscriptionModeEnabled === true && isSubscribed === false) {
      const nowKey = monthKeyUTC();
      const used = quotaMonth === nowKey ? quotaUsed : 0;
      if (used >= 10) {
        setPostError("You’ve reached the posting limit. Subscribe to post more.");
        setLimitOpen(true);
        return;
      }
    }

    setPosting(true);
    setPostError("");

    try {
      const authorName = effectiveUser?.full_name || "Tutor";
      const canEnforceLimit = subscriptionModeEnabled === true;
      const isUnlimited = isSubscribed === true;

      let postDocId = null;

      await runTransaction(db, async (tx) => {
        const meRef = doc(db, "users", userId);

        if (canEnforceLimit && !isUnlimited) {
          const q = await ensureMonthlyPostQuota(tx, meRef);
          if (q.used >= 10) {
            throw new Error("POST_LIMIT_REACHED");
          }
          tx.set(
            meRef,
            { post_quota_used: increment(1), post_quota_updatedAt: serverTimestamp() },
            { merge: true }
          );
        }

        const postRef = doc(collection(db, "posts"));
        postDocId = postRef.id;

        tx.set(postRef, {
          authorId: userId,
          authorRole: "tutor",
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
        await updateDoc(doc(db, "posts", postDocId), { media: uploaded });
      }

      clearComposer();
    } catch (e) {
      console.error("handlePost error:", e);

      if (String(e?.message || "").includes("POST_LIMIT_REACHED")) {
        setLimitOpen(true);
        setPostError("You’ve reached the posting limit. Subscribe to post more.");
      } else {
        setPostError(tr("post_failed","Failed to post. Please try again."));
      }
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-gray-400">{tr("loading","Loading...")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("posting_limit_title","Posting limit reached")}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-700">
            {"You’ve reached the posting limit. Subscribe to post more."}
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setLimitOpen(false)}>
              {tr?.("close","Close")}
            </Button>
            <Link to={subscribeUrl}>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700">
                {tr("subscribe","Subscribe")}
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <CreateEventDialog
        open={createEventOpen}
        onOpenChange={setCreateEventOpen}
        user={effectiveUser}
        role="tutor"
        allowedPlatforms={["nasio"]}
        disabledReason={!canCreateEvent ? tr("subscription_required","Subscription required to create events") : null}
      />

      <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="mx-auto max-w-[1800px] space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                {tr("welcome_name","Welcome, {{name}}",{ name: (effectiveUser?.full_name || "Tutor") })}
              </h1>
              <p className="text-sm text-gray-600">{tr("subtitle","Tutor dashboard")}</p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center">
              <Badge
                variant={tutorProfile?.verification_status === "verified" ? "default" : "secondary"}
                className={
                  tutorProfile?.verification_status === "verified"
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
                }
              >
                {tutorProfile?.verification_status || tr("pending","pending")}
              </Badge>
            </div>
          </div>

          {subscriptionModeEnabled === true && !isSubscribed && (
            <SubscribeBanner to={subscribeUrl} user={effectiveUser} tr={tr} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10">
            <div className="lg:col-span-3 space-y-4">
              <Card className="mt-4 rounded-2xl">
                <CardContent className="p-3 space-y-4">
                  <QuickLink
                    title={tr("my_students","My Students")}
                    description={tr("my_students_desc","See your student list")}
                    to={createPageUrl("TutorStudents")}
                    icon={<Users className="w-5 h-5 text-blue-500" />}
                  />
                  <QuickLink
                    title={tr("update_profile","Update Profile")}
                    description={tr("update_profile_desc","Edit your tutor profile")}
                    to={createPageUrl("Profile")}
                    icon={<BookOpen className="w-5 h-5 text-orange-500" />}
                  />

                  <Button
                    type="button"
                    className="mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md ring-1 ring-emerald-200"
                    onClick={() => setCreateEventOpen(true)}
                    disabled={!canCreateEvent}
                    data-testid="create_event_quick_action_btn"
                    title={!canCreateEvent ? tr("subscription_required","Subscription required") : tr("create_event","Create Event")}
                  >
                    <Calendar className="h-4 w-4 mr-2" /> {tr("create_event","Create Event")}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border bg-white">
                <div className="p-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 w-full">
                    <Avatar name={effectiveUser?.full_name || "Tutor"} />
                    <div className="w-full">
                      <div className="text-sm font-semibold text-gray-900">
                        {tr("composer_title","Share an update, {{name}}?",{ name: (effectiveUser?.full_name || "Tutor") })}
                      </div>

                      <textarea
                        value={composerText}
                        onChange={(e) => setComposerText(e.target.value)}
                        placeholder={tr("composer_placeholder","Post availability, new packages, reminders...")}
                        className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 min-h-[90px]"
                      />

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={onFilesSelected}
                      />

                      {attachmentPreviews.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-semibold text-gray-500">
                            {tr("attachments","Attachments")} ({attachmentPreviews.length})
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {attachmentPreviews.map((p) => {
                              const isVideo = String(p.type || "").startsWith("video/");
                              return (
                                <div
                                  key={p.id}
                                  className="rounded-2xl border bg-gray-50 p-2 flex items-center gap-3"
                                >
                                  <div className="h-12 w-12 rounded-xl border bg-white overflow-hidden flex items-center justify-center">
                                    {isVideo ? (
                                      <div className="h-full w-full relative flex items-center justify-center bg-black">
                                        <video
                                          src={p.url}
                                          className="h-full w-full object-contain bg-black"
                                          muted
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                                            <Video className="h-4 w-4" />
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <img
                                        src={p.url}
                                        alt={p.name}
                                        className="h-full w-full object-contain"
                                      />
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                      {p.name}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {isVideo ? tr("video","Video") : tr("photo","Photo")}
                                    </div>
                                  </div>

                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-gray-500"
                                    onClick={() => removeAttachment(p.id)}
                                    title={tr("remove","Remove")}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {postError ? <div className="mt-3 text-sm text-red-600">{postError}</div> : null}

                      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <Button
                          variant="ghost"
                          className="justify-center text-gray-700 w-full sm:w-auto"
                          type="button"
                          onClick={openFilePicker}
                          disabled={posting}
                        >
                          <ImageIcon className="h-4 w-4 mr-2 text-green-600" />
                          {tr("photo_video","Photo/Video")}
                        </Button>

                        <Button
                          className="rounded-xl w-full sm:w-auto"
                          onClick={handlePost}
                          disabled={posting || (!composerText.trim() && attachments.length === 0)}
                          type="button"
                        >
                          {posting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Posting...
                            </>
                          ) : (
                            tr("post","Post")
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t px-3 py-2 flex items-center gap-2 text-xs text-gray-500">
                  <Globe className="h-3.5 w-3.5" />
                  {tr("public","Public")}
                </div>
              </div>

              <Card className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">{tr("posts","Posts")}</div>
                    <Badge variant="secondary" className="border bg-white">
                      {tr("live","Live")}
                    </Badge>
                  </div>

                  {communityLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> {tr("loading_posts","Loading posts...")}
                    </div>
                  ) : communityPosts.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-600">{tr("no_posts","No community posts yet.")}</div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {communityPosts.map((p) => (
                        <RealPostCard
                          key={p.id}
                          post={p}
                          currentUserId={userId}
                          me={effectiveUser}
                          subscriptionModeEnabled={subscriptionModeEnabled}
                          tr={tr}
                          authorCountryByUid={authorCountryByUid}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="hidden lg:block lg:col-span-3">
              <div className="sticky top-4 space-y-4">
                <Card className="rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-gray-900">{tr("upcoming_sessions","Upcoming Sessions")}</div>
                      <Link to={createPageUrl("TutorSessions")}>
                        <Button variant="ghost" size="sm" type="button">
                          {tr("view","View")} <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </Link>
                    </div>

                    {upcomingSessions.length > 0 ? (
                      <div className="space-y-2">
                        {upcomingSessions.slice(0, 4).map((session) => (
                          <div key={session.id} className="rounded-2xl border bg-gray-50 p-3">
                            <div className="text-sm font-semibold text-gray-900 truncate">
                              {session.subject || tr("session","Session")}
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              {format(new Date(session.scheduled_date), "MMM dd, h:mm a")}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {session.duration} min • ${session.price}
                            </div>
                            <Badge className="mt-2" variant="secondary">
                              Scheduled
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-600">{tr("no_upcoming","No upcoming sessions.")}</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
