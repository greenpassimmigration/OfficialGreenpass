// src/pages/SchoolDashboard.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import InviteUsersDialog from "@/components/invites/InviteUserDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { School, User } from "@/api/entities";
import { listenFollowState, sendFollowRequest, cancelFollowRequest, unfollowUser } from "@/api/follow";
import {
  Building2,
  Users,
  BookOpen,
  ArrowRight,
  CreditCard,
  MoreHorizontal,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Ticket,
  X,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import SharedPaymentGateway from "@/components/payments/SharedPaymentGateway";
import CreateEventDialog from "@/components/events/CreateEventDialog";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

// ✅ Firebase
import { auth, db, storage } from "@/firebase";
import {
  collection,
  getDoc,
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
  getCountFromServer,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
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

const fmt = (v, fmtStr = "MMM dd, h:mm a") => {
  const d = toValidDate(v);
  if (!d) return "—";
  try {
    return format(d, fmtStr);
  } catch {
    return d.toLocaleString();
  }
};

const POST_PREVIEW_TEXT_LIMIT = 320;
const MAX_DASHBOARD_MEDIA = 4;
const buildPostDetailUrl = (postId) =>
  `${createPageUrl("PostDetail")}?id=${encodeURIComponent(postId || "")}`;
/* --------------------------------------------------------------------- */

// 🌍 Flag helper (same as Onboarding.jsx)
const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

/* ✅ Uses your REAL user doc fields:
   - subscription_active (boolean)
   - subscription_status (string e.g. "skipped", "active")
*/
function isSubscribedUser(u) {
  if (!u) return false;
  if (u.subscription_active === true) return true;

  const status = String(u.subscription_status || "").toLowerCase().trim();
  const ok = new Set(["active", "paid", "trialing"]);
  return ok.has(status);
}

/* ✅ School display name helper */
function schoolDisplayName(school, user) {
  const candidates = [
    user?.school_profile?.school_name,
    user?.school_profile?.name,
    user?.school_profile?.institution_name,
    school?.school_name,
    school?.institution_name,
    school?.institutionName,
    school?.name,
    user?.full_name,
    user?.displayName,
  ];
  const v = candidates.find((x) => typeof x === "string" && x.trim().length);
  return (v || "School").trim();
}

const SubscribeBanner = ({ to, user }) => {
  const { tr } = useTr("school_dashboard");

  const status = String(user?.subscription_status || "").toLowerCase().trim();
  const message =
    status === "skipped"
      ? tr("sub_msg_skipped")
      : status === "expired"
      ? tr("sub_msg_expired")
      : tr("sub_msg_default");

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <CreditCard className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-red-800">{tr("sub_required")}</p>
          <p className="text-sm text-red-700">{message}</p>
        </div>
      </div>

      <Link to={to}>
        <Button className="bg-red-600 hover:bg-red-700 w-full sm:w-auto">
          {tr("subscribe_now")}
        </Button>
      </Link>
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

const Avatar = ({ name = "School", size = "md" }) => {
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
      {initials || "S"}
    </div>
  );
};

/* -------------------- Follow Button -------------------- */
function FollowButton({ currentUserId, creatorId, creatorRole, size = "sm", className = "" }) {
  const { tr } = useTr("school_dashboard");

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

/* -------------------- Media grid (images + videos) -------------------- */
const MediaGallery = ({ media = [], postId }) => {
  const { tr } = useTr("school_dashboard");

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

/* -------------------- Real Post Card -------------------- */
const RealPostCard = ({ post, currentUserId, me, subscriptionModeEnabled, authorCountryByUid }) => {
  const { tr } = useTr("school_dashboard");

  const created = post?.createdAt?.seconds
    ? new Date(post.createdAt.seconds * 1000)
    : post?.createdAt?.toDate
    ? post.createdAt.toDate()
    : null;

  const authorId = post?.authorId || post?.user_id || post?.author_id;
  const authorRole = post?.authorRole || post?.creator_role || "school";
  const authorName = post?.authorName || post?.author_name || "School";

  const isMine = currentUserId && authorId && currentUserId === authorId;
  const isAdminPost = String(authorRole || "").toLowerCase() === "admin";
  const [boostOpen, setBoostOpen] = useState(false);

  // ✅ 3-dots actions
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(String(post?.text || ""));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const postDetailUrl = buildPostDetailUrl(post?.id);
  const fullText = String(post?.text || "");
  const hasLongText = fullText.length > POST_PREVIEW_TEXT_LIMIT;
  const previewText = hasLongText
    ? `${fullText.slice(0, POST_PREVIEW_TEXT_LIMIT).trimEnd()}…`
    : fullText;

  const viewProfileUrl = authorId
  ? `/view-profile/${encodeURIComponent(authorId)}`
  : "";

  useEffect(() => {
    setEditText(String(post?.text || ""));
  }, [post?.id, post?.text]);

  const postLink = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}${buildPostDetailUrl(post?.id)}`;
  }, [post?.id]);

  const copyShareLink = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(postLink);
      } else {
        const el = document.createElement("textarea");
        el.value = postLink;
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
    } catch {
      // ignore
    }
  };

  const reportPost = async () => {
    if (!currentUserId || !post?.id) return;
    try {
      await addDoc(collection(db, "reports"), {
        type: "post",
        postId: post.id,
        postAuthorId: authorId || null,
        reporterId: currentUserId,
        createdAt: serverTimestamp(),
        status: "pending",
      });
    } catch {
      // ignore
    }
  };

  const saveEdit = async () => {
    if (!isMine || !post?.id) return;
    try {
      await updateDoc(doc(db, "posts", post.id), {
        text: String(editText || "").trim(),
        updatedAt: serverTimestamp(),
      });
      setEditOpen(false);
    } catch {
      // ignore
    }
  };

  const confirmDelete = async () => {
    if (!isMine || !post?.id) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "posts", post.id));
      setDeleteOpen(false);
    } catch {
      // ignore
    } finally {
      setDeleting(false);
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
                    title={tr("view_profile", "View profile")}
                  >
                    {authorName}
                  </Link>
                ) : (
                  <div className="font-semibold text-gray-900">{authorName}</div>
                )}

                <Badge
                  variant="secondary"
                  className="bg-blue-50 text-blue-700 border border-blue-100"
                >
                  {String(authorRole || "school").toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                <span>{created ? format(created, "MMM dd, h:mm a") : "—"}</span>
                <span>•</span>
                {(() => {
                  const c = authorId ? authorCountryByUid?.[authorId] : null;
                  const cc = c?.country_code || "";
                  const name = c?.country || "";
                  const flagUrl = flagUrlFromCode(cc);
                  if (flagUrl && name) {
                    return (
                      <>
                        <img
                          src={flagUrl}
                          alt={`${name} flag`}
                          className="h-3.5 w-5 rounded-sm object-cover"
                          loading="lazy"
                        />
                        <span>{name}</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <Globe className="h-3.5 w-3.5" />
                      <span>{tr("public", "Public")}</span>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-500" type="button">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isMine ? (
                <>
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    {tr("edit", "Edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={copyShareLink}>
                    {tr("share_link", "Share link")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-700"
                    onClick={() => setDeleteOpen(true)}
                  >
                    {tr("delete", "Delete")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={copyShareLink}>
                    {tr("share_link", "Share link")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={reportPost}>
                    {tr("report", "Report")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

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
                    <Button variant="outline" className="w-full justify-center text-gray-700" type="button" disabled>
                      {tr("this_is_you", "This is you")}
                    </Button>
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
                    <MessageCircle className="h-4 w-4 mr-2" /> {tr("message", "Message")}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {isMine && subscriptionModeEnabled ? (
          <BoostPostDialog
            open={boostOpen}
            onOpenChange={setBoostOpen}
            postId={post?.id}
            me={me}
          />
        ) : null}

        {/* ✅ Edit post dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tr("edit_post", "Edit post")}</DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <textarea
                className="min-h-[140px] w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder={tr("write_something", "Write something...")}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  {tr("cancel", "Cancel")}
                </Button>
                <Button type="button" onClick={saveEdit} disabled={!String(editText || "").trim()}>
                  {tr("save", "Save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ✅ Delete confirmation dialog */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr("delete_post", "Delete post?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr("delete_post_desc", "This will permanently delete this post. This can’t be undone.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                {tr("cancel", "Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleting ? tr("deleting", "Deleting...") : tr("delete", "Delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};

export default function SchoolDashboard({ user }) {
  const { tr } = useTr("school_dashboard");
  const userId = user?.id || user?.uid || user?.user_id || null;

  const [stats, setStats] = useState({
    totalPrograms: 0,
  });

  const [school, setSchool] = useState(null);

  const schoolName = useMemo(() => schoolDisplayName(school, user), [school, user]);
  const [loading, setLoading] = useState(true);
  const [permError, setPermError] = useState(false);

  // ✅ School can post
  const [composerText, setComposerText] = useState("");

  // ✅ Multiple attachments (photos/videos)
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState([]);

  // ✅ Posting / feed
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [quotaMonth, setQuotaMonth] = useState("");
  const [communityPosts, setCommunityPosts] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);

  // ✅ Cache: author uid -> { country, country_code }
  const [authorCountryByUid, setAuthorCountryByUid] = useState({});

  // ✅ subscription based on your user doc fields
  const isSubscribed = useMemo(() => isSubscribedUser(user), [user]);
  const { subscriptionModeEnabled } = useSubscriptionMode();

  const subscribeUrl = useMemo(() => createPageUrl("Pricing"), []);

  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const canCreateEvent = !subscriptionModeEnabled || isSubscribed;
  const [limitOpen, setLimitOpen] = useState(false);

  // ✅ Listen to quota fields on the user doc
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

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);

        const schoolRows = await School.filter({ user_id: userId });
        if (!schoolRows?.length) {
          if (!cancelled) setLoading(false);
          return;
        }
        const s = schoolRows[0];
        if (cancelled) return;
        setSchool(s);

        let programCount = 0;
        try {
          const uid = auth.currentUser?.uid || userId;
          if (uid) {
            const agg = await getCountFromServer(
              query(collection(db, "schools"), where("user_id", "==", uid))
            );
            programCount = agg?.data()?.count ?? 0;
          }
        } catch (e) {
          console.warn("Programs count query (schools.user_id) failed:", e);
        }

        if (cancelled) return;

        setStats({
          totalPrograms: programCount,
        });
      } catch (e) {
        console.error("Error loading dashboard data:", e);
        if (e?.code === "permission-denied") setPermError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ✅ Live load: community posts
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

  // ✅ Load post-author countries from users/{uid}
  useEffect(() => {
    if (!communityPosts || communityPosts.length === 0) return;

    const uids = Array.from(
      new Set(
        communityPosts
          .map((p) => p?.authorId || p?.user_id || p?.author_id)
          .filter(Boolean)
      )
    );

    const missing = uids.filter((uid) => !authorCountryByUid?.[uid]);
    if (missing.length === 0) return;

    let cancelled = false;

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
              d?.country?.code ||
              d?.country?.cca2 ||
              "";
            const name =
              d.country ||
              d.country_name ||
              d.countryName ||
              d?.country?.name ||
              "";

            updates[uid] = {
              country_code: cc ? String(cc).trim() : "",
              country: name ? String(name).trim() : "",
            };
          } catch {
            // ignore
          }
        })
      );

      if (cancelled) return;
      if (Object.keys(updates).length) {
        setAuthorCountryByUid((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [communityPosts, authorCountryByUid]);

  // Build & cleanup preview URLs
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

  const firstName = useMemo(() => {
    const n = String(schoolName || "").trim();
    return n || "School";
  }, [schoolName]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

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
    setAttachments((prev) => {
      const next = [];
      for (let i = 0; i < prev.length; i++) {
        const f = prev[i];
        const fid = `${f.name}-${f.size}-${f.lastModified}-${i}`;
        if (fid !== id) next.push(f);
      }
      return next;
    });
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

    setPosting(true);
    setPostError("");

    try {
      const authorName = schoolDisplayName(school, user);

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
            { post_quota_used: increment(1), post_quota_updatedAt: serverTimestamp() },
            { merge: true }
          );
        }

        const postRef = doc(collection(db, "posts"));
        postDocId = postRef.id;

        tx.set(postRef, {
          authorId: userId,
          authorRole: "school",
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
        setPostError(tr("limit_desc", "You’ve reached the posting limit. Subscribe to post more."));
      } else {
        setPostError("Failed to post. Please try again.");
      }
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ✅ Posting limit prompt */}
      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("limit_title")}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-700">
            {tr("limit_desc")}
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setLimitOpen(false)}>
              {tr("close")}
            </Button>
            <Link to={subscribeUrl}>
              <Button type="button" className="bg-emerald-600 hover:bg-emerald-700">
                {tr("subscribe")}
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ Create Event */}
      <CreateEventDialog
        open={createEventOpen}
        onOpenChange={setCreateEventOpen}
        user={user}
        role="school"
        allowedPlatforms={["eventbrite"]}
        disabledReason={!canCreateEvent ? tr("subscription_required", "Subscription required to create events") : null}
      />

      <div className="w-full px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="mx-auto max-w-[1800px]">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                {tr("welcome_name", { name: firstName })}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={school?.verification_status === "verified" ? "default" : "secondary"}
                className={
                  school?.verification_status === "verified"
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
                }
              >
                {school?.verification_status || "pending"}
              </Badge>
            </div>
          </div>

          {subscriptionModeEnabled && !isSubscribed && (
            <div className="mb-4">
              <SubscribeBanner to={subscribeUrl} user={user} />
            </div>
          )}

          {permError && (
            <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
              {tr("perm_warning")}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10">
            {/* LEFT: Shortcuts */}
            <div className="hidden lg:block lg:col-span-3">
              <div className="sticky top-4 space-y-4">
                <div className="rounded-2xl border bg-white p-2">
                  <div className="px-2 py-2 text-xs font-semibold text-gray-500">
                    {tr("shortcuts")}
                  </div>
                  <div className="space-y-1">
                    <Shortcut
                      to={createPageUrl("SchoolDetails")}
                      label={tr("nav_programs")}
                      icon={<BookOpen className="h-5 w-5 text-blue-600" />}
                    />
                    <Shortcut
                      to={createPageUrl("SchoolProfile")}
                      label={tr("nav_school_profile")}
                      icon={<Building2 className="h-5 w-5 text-purple-600" />}
                    />
                    <Shortcut
                      to={createPageUrl("Events")}
                      label={tr("nav_events")}
                      icon={<Ticket className="h-5 w-5 text-emerald-600" />}
                    />
                    <Shortcut
                      to={createPageUrl("Directory")}
                      label={tr("nav_directory")}
                      icon={<Building2 className="h-5 w-5 text-blue-600" />}
                    />
                  </div>
                </div>
              </div>

              {/* ✅ Invite CTA */}
              <div className="mt-4 rounded-2xl border bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900">
                    {tr("invite_agents", "Invite Agents")}
                  </div>
                  <Button size="sm" onClick={() => setInviteOpen(true)}>
                    {tr("invite", "Invite")}
                  </Button>
                </div>
              </div>

              <InviteUsersDialog
                open={inviteOpen}
                onOpenChange={setInviteOpen}
                allowedRoles={["agent"]}
                defaultRole="agent"
                title={tr("invite_agents", "Invite Agents")}
              />

              {/* ✅ Create Event CTA */}
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
                  title={!canCreateEvent ? tr("subscription_required", "Subscription required to create events") : undefined}
                >
                  <Ticket className="h-4 w-4 mr-2" />
                  {tr("create_event", "Create Event")}
                </Button>
              </div>
            </div>

            {/* CENTER: Composer + Feed */}
            <div className="lg:col-span-6 space-y-4">
              {/* Composer */}
              <div className="rounded-2xl border bg-white">
                <div className="p-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 w-full">
                    <Avatar name={schoolName} />
                    <div className="w-full">
                      <div className="text-sm font-semibold text-gray-900">
                        {tr("composer_title", { name: firstName })}
                      </div>

                      <textarea
                        value={composerText}
                        onChange={(e) => setComposerText(e.target.value)}
                        placeholder={tr("composer_placeholder")}
                        className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200 min-h-[90px]"
                      />

                      {/* ✅ Hidden file input */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={onFilesSelected}
                      />

                      {/* ✅ Attachment previews */}
                      {attachmentPreviews.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="text-xs font-semibold text-gray-500">
                            {tr("attachments", { count: attachmentPreviews.length })}
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
                                      <video
                                        src={p.url}
                                        className="h-full w-full object-contain bg-black"
                                        muted
                                      />
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
                                      {isVideo ? tr("video") : tr("photo")}
                                    </div>
                                  </div>

                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="text-gray-500"
                                    onClick={() => removeAttachment(p.id)}
                                    title={tr("remove")}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {postError ? (
                        <div className="mt-2 text-sm text-red-600">{postError}</div>
                      ) : null}

                      {/* ✅ Only Photo/Video button + Post */}
                      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <Button
                          variant="ghost"
                          className="justify-center text-gray-700 w-full sm:w-auto"
                          type="button"
                          onClick={openFilePicker}
                        >
                          <ImageIcon className="h-4 w-4 mr-2 text-green-600" />
                          {tr("photo_video")}
                        </Button>

                        <Button
                          className="rounded-xl w-full sm:w-auto"
                          onClick={handlePost}
                          disabled={
                            posting ||
                            (!composerText.trim() && attachments.length === 0) ||
                            (subscriptionModeEnabled && !isSubscribed && quotaMonth === monthKeyUTC() && quotaUsed >= 10)
                          }
                          type="button"
                        >
                          {posting ? (
                            <span className="inline-flex items-center">
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("posting")}
                            </span>
                          ) : (
                            tr("post")
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Button variant="ghost" size="icon" className="text-gray-500" type="button">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </div>

                <div className="border-t px-3 py-2 flex items-center gap-2 text-xs text-gray-500">
                  <Globe className="h-3.5 w-3.5" />
                  Public
                </div>
              </div>

              {/* Feed */}
              <div className="space-y-4">
                {communityLoading ? (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
                    {tr("loading_posts")}
                  </div>
                ) : communityPosts.length === 0 ? (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">
                    {tr("no_posts_yet")}
                  </div>
                ) : (
                  communityPosts.map((p) => (
                    <RealPostCard
                      key={p.id}
                      post={p}
                      currentUserId={userId}
                      me={user}
                      subscriptionModeEnabled={subscriptionModeEnabled}
                      authorCountryByUid={authorCountryByUid}
                    />
                  ))
                )}
              </div>
            </div>

            {/* RIGHT: Highlights */}
            <div className="hidden lg:block lg:col-span-3">
              <div className="sticky top-4 space-y-4">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-sm font-semibold text-gray-900 mb-3">{tr("highlights", "Highlights")}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border bg-gray-50 p-3">
                      <div className="text-xs text-gray-500">{tr("nav_programs", "Programs")}</div>
                      <div className="text-lg font-bold text-blue-600">{stats.totalPrograms}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile shortcuts could be added later if you want */}
        </div>
      </div>
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

const BoostPostDialog = ({ open, onOpenChange, postId, me }) => {
  const { tr } = useTr("school_dashboard");

  const [plan, setPlan] = useState(BOOST_PLANS[0]);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const payerName = me?.full_name || me?.name || "GreenPass User";
  const payerEmail = me?.email || "";

  const handleSuccess = async (_method, transactionId, payload) => {
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
        boost_provider: "paypal",
        boost_details: payload || null,
        boosted_at: serverTimestamp(),
        boosted_until: until,
      });
      setDone(true);
    } catch (e) {
      console.error("boost update post failed:", e);
      setErr(tr("payment_succeeded_but_failed", "Payment succeeded, but we couldn\'t activate the boost. Please contact support."));
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
            <div className="mt-1 text-sm text-gray-600">{tr("boost_subtitle", "Choose a boost duration, then pay.")}</div>

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
            <div className="text-sm text-emerald-700 font-medium">{tr("boost_activated", "Boost activated ✅")}</div>
            <Button type="button" className="w-full mt-3" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
