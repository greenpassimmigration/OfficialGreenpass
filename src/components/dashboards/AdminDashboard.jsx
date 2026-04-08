import React, { useState, useEffect, useRef } from "react";
import InviteUsersDialog from "@/components/invites/InviteUserDialog";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users,
  Calendar,
  DollarSign,
  UserCheck,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Share2,
  Flag,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";

// Existing entities
import { User } from "@/api/entities";
import { Payment } from "@/api/entities";
import { Event } from "@/api/entities";
import { School } from "@/api/entities";

// Follow helpers
import {
  listenFollowState,
  sendFollowRequest,
  cancelFollowRequest,
  unfollowUser,
} from "@/api/follow";

// Firebase
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
  getDoc,
  getDocs,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// Dropdown
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* -------------------------------- helpers -------------------------------- */

const POST_PREVIEW_TEXT_LIMIT = 320;
const MAX_DASHBOARD_MEDIA = 4;

const buildPostDetailUrl = (postId) =>
  `${createPageUrl("PostDetail")}?id=${encodeURIComponent(postId || "")}`;

const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

const StatCard = ({ title, value, icon, linkTo }) => (
  <Card className="hover:shadow-lg transition-shadow rounded-2xl">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <Link to={createPageUrl(linkTo)}>
        <p className="text-xs text-muted-foreground underline hover:text-primary">View details</p>
      </Link>
    </CardContent>
  </Card>
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
      className={`${s} rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center font-semibold`}
    >
      {initials || "U"}
    </div>
  );
};

function FollowButton({ currentUserId, creatorId, size = "sm", className = "" }) {
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

  const label = state.following ? "Following" : state.requested ? "Requested" : "Follow";

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

const MediaGallery = ({ media = [], postId }) => {
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
          title="View post details"
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
                Open media
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
              title="View post details"
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
                    Open media
                  </div>
                )}

                {showMoreOverlay ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                    <div className="text-center text-white">
                      <div className="text-2xl font-semibold">+{remaining}</div>
                      <div className="text-xs opacity-90">View all</div>
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
              View all photos
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
};

const RealPostCard = ({ post, currentUserId, authorCountryByUid }) => {
  const created = post?.createdAt?.seconds
    ? new Date(post.createdAt.seconds * 1000)
    : post?.createdAt?.toDate
    ? post.createdAt.toDate()
    : null;

  const authorId = post?.authorId || post?.user_id || post?.author_id;
  const authorRole = post?.authorRole || post?.creator_role || "admin";
  const authorName = post?.authorName || post?.author_name || "Admin";
  const authorCountry = authorId ? authorCountryByUid?.[authorId] : null;

  const postCC =
    post?.country_code ||
    post?.countryCode ||
    post?.author_country_code ||
    post?.authorCountryCode ||
    "";

  const postCountryName =
    post?.country || post?.country_name || post?.author_country || post?.authorCountry || "";

  const authorCC = (authorCountry?.country_code || postCC || "").toString();
  const authorCountryName = (authorCountry?.country || postCountryName || "").toString();

  const isMine = currentUserId && authorId && currentUserId === authorId;
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
        alert("Link copied");
        return;
      }
      if (url) window.prompt("Copy this link:", url);
    } catch (e) {
      console.error("share failed:", e);
    }
  };

  const handleDelete = async () => {
    if (!post?.id || !isMine) return;
    const ok = window.confirm("Delete this post?");
    if (!ok) return;

    setMenuBusy(true);
    setMenuError("");
    try {
      await deleteDoc(doc(db, "posts", String(post.id)));
    } catch (e) {
      console.error("delete post failed:", e);
      setMenuError("Delete failed. Please try again.");
    } finally {
      setMenuBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!post?.id || !isMine) return;
    const next = String(editText || "").trim();
    if (!next) {
      setMenuError("Post cannot be empty.");
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
      setMenuError("Edit failed. Please try again.");
    } finally {
      setMenuBusy(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!post?.id || !currentUserId) return;
    const reason = String(reportReason || "").trim();
    if (!reason) {
      setMenuError("Please enter a reason.");
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
      alert("Report submitted");
    } catch (e) {
      console.error("report failed:", e);
      setMenuError("Report failed. Please try again.");
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
                    title="View profile"
                  >
                    {authorName}
                  </Link>
                ) : (
                  <div className="font-semibold text-gray-900">{authorName}</div>
                )}

                <Badge
                  variant="secondary"
                  className={`border ${
                    String(authorRole).toLowerCase() === "admin"
                      ? "bg-purple-50 text-purple-700 border-purple-100"
                      : "bg-emerald-50 text-emerald-700 border-emerald-100"
                  }`}
                >
                  {String(authorRole || "admin").toUpperCase()}
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
                    <span>Public</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-500" type="button" disabled={menuBusy}>
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-44">
              {isMine ? (
                <>
                  <DropdownMenuItem onClick={() => setEditOpen(true)} disabled={menuBusy}>
                    <span className="flex items-center gap-2">
                      <Pencil className="h-4 w-4" />
                      Edit
                    </span>
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={handleDelete} disabled={menuBusy} className="text-red-600">
                    <span className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem onClick={handleShare} disabled={menuBusy}>
                <span className="flex items-center gap-2">
                  <Share2 className="h-4 w-4" />
                  Share
                </span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setReportOpen(true)} disabled={menuBusy}>
                <span className="flex items-center gap-2">
                  <Flag className="h-4 w-4" />
                  Report
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Dialog open={editOpen} onOpenChange={(v) => (menuBusy ? null : setEditOpen(v))}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit post</DialogTitle>
            </DialogHeader>

            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-200 min-h-[120px]"
              placeholder="Update your post..."
            />

            {menuError ? <div className="mt-2 text-sm text-red-600">{menuError}</div> : null}

            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)} disabled={menuBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveEdit} disabled={menuBusy}>
                {menuBusy ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={reportOpen} onOpenChange={(v) => (menuBusy ? null : setReportOpen(v))}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Report post</DialogTitle>
            </DialogHeader>

            <div className="text-sm text-gray-600">
              Tell us what’s wrong with this post. Our team will review it.
            </div>

            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-200 min-h-[120px]"
              placeholder="Reason (spam, harassment, scam, etc.)"
            />

            {menuError ? <div className="mt-2 text-sm text-red-600">{menuError}</div> : null}

            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setReportOpen(false)} disabled={menuBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmitReport} disabled={menuBusy || !currentUserId}>
                {menuBusy ? "Submitting..." : "Submit"}
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
                    View more
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <MediaGallery media={post?.media || []} postId={post?.id} />

        <div className="px-4 pb-4">
          <div className="mt-3 border-t pt-2 grid grid-cols-2 gap-2">
            <div className="flex">
              <FollowButton
                currentUserId={currentUserId}
                creatorId={authorId}
                className="w-full justify-center"
              />
            </div>

            <Link to={messageUrl} className="w-full">
              <Button
                variant="ghost"
                className="w-full justify-center text-gray-700"
                type="button"
                disabled={!authorId || !currentUserId || isMine}
                title={!authorId ? "Missing author id" : isMine ? "You can't message yourself" : "Message"}
              >
                <MessageCircle className="h-4 w-4 mr-2" /> Message
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/* ------------------------------ main component ------------------------------ */

export default function AdminDashboard({ user }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalRevenue: "$0",
    activeEvents: 0,
    pendingVerifications: 0,
    pendingPayments: 0,
    recentRegistrations: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const userId = user?.id || user?.uid || user?.user_id;

  const [composerText, setComposerText] = useState("");
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState([]);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");

  const [communityPosts, setCommunityPosts] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [authorCountryByUid, setAuthorCountryByUid] = useState({});

  useEffect(() => {
    const fetchStats = async () => {
      try {
        if (user?.user_type !== "admin" && user?.role !== "admin") {
          setError("Access denied. Admin privileges required.");
          setLoading(false);
          return;
        }

        let users = [];
        try {
          const usersResponse = await User.list();
          users = Array.isArray(usersResponse) ? usersResponse : [];
        } catch (err) {
          console.warn("Failed to fetch users:", err);
        }

        let payments = [];
        try {
          const paymentsResponse = await Payment.list("-created_date", 50);
          payments = Array.isArray(paymentsResponse) ? paymentsResponse : [];
        } catch (err) {
          console.warn("Failed to fetch payments:", err);
        }

        let events = [];
        try {
          const eventsResponse = await Event.list();
          events = Array.isArray(eventsResponse) ? eventsResponse : [];
        } catch (err) {
          console.warn("Failed to fetch events:", err);
        }

        let verifications = [];
        try {
          const verificationsResponse = await School.filter({ verification_status: "pending" });
          verifications = Array.isArray(verificationsResponse) ? verificationsResponse : [];
        } catch (err) {
          console.warn("Failed to fetch verifications:", err);
        }

        const totalRevenue = payments
          .filter((p) => p.status === "successful")
          .reduce((sum, p) => sum + (p.amount_usd || 0), 0);

        const pendingPayments = payments.filter((p) => p.status === "pending_verification").length;

        setStats({
          totalUsers: users.length,
          totalRevenue: totalRevenue.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          }),
          activeEvents: events.length,
          pendingVerifications: verifications.length,
          pendingPayments,
          recentRegistrations: 0,
        });
      } catch (err) {
        console.error("Failed to fetch admin stats:", err);
        setError("Failed to load dashboard data. Please refresh the page.");
        setStats({
          totalUsers: 0,
          totalRevenue: "$0",
          activeEvents: 0,
          pendingVerifications: 0,
          pendingPayments: 0,
          recentRegistrations: 0,
        });
      } finally {
        setLoading(false);
      }
    };

    if (user) fetchStats();
  }, [user]);

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

  const handlePost = async () => {
    const text = composerText.trim();
    if (!text && attachments.length === 0) return;
    if (!userId) return;

    setPosting(true);
    setPostError("");

    try {
      const authorName = user?.full_name || user?.name || "Admin";

      const postRef = await addDoc(collection(db, "posts"), {
        authorId: userId,
        authorRole: "admin",
        authorName,
        text,
        media: [],
        status: "published",
        paid: false,
        boosted: false,
        boost_sort: 0,
        createdAt: serverTimestamp(),
      });

      if (postRef?.id && attachments.length > 0) {
        const uploaded = [];
        for (let i = 0; i < attachments.length; i++) {
          uploaded.push(await uploadOne(attachments[i], postRef.id, i));
        }

        await updateDoc(doc(db, "posts", postRef.id), {
          media: uploaded,
        });
      }

      clearComposer();
    } catch (e) {
      console.error("handlePost error:", e);
      setPostError("Failed to post. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  const statCards = [
    {
      title: "Total Revenue",
      value: stats.totalRevenue,
      icon: <DollarSign className="h-4 w-4 text-muted-foreground" />,
      linkTo: "AdminPayments",
    },
    {
      title: "Total Users",
      value: stats.totalUsers,
      icon: <Users className="h-4 w-4 text-muted-foreground" />,
      linkTo: "UserManagement",
    },
    {
      title: "Published Events",
      value: stats.activeEvents,
      icon: <Calendar className="h-4 w-4 text-muted-foreground" />,
      linkTo: "AdminEvents",
    },
    {
      title: "Pending Verifications",
      value: stats.pendingVerifications + stats.pendingPayments,
      icon: <UserCheck className="h-4 w-4 text-muted-foreground" />,
      linkTo: "Verification",
    },
  ];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="text-red-600 mb-4">
          <UserCheck className="w-12 h-12 mx-auto mb-2" />
          <h2 className="text-xl font-semibold">{error}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="mx-auto max-w-[1800px] space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Admin Dashboard</h1>
              <p className="text-muted-foreground text-sm sm:text-base">
                Welcome back, {user?.full_name || "Admin"}. Here’s an overview of your platform activity and community feed.
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => setInviteOpen(true)}>Invite</Button>
            </div>
          </div>

          <InviteUsersDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            allowedRoles={["agent", "school", "student", "tutor", "collaborator"]}
            defaultRole="agent"
            title="Invite User"
          />

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((card, index) => (
              <StatCard key={index} {...card} />
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10">
            <div className="lg:col-span-3 space-y-4">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Quick Links</CardTitle>
                  <CardDescription>Jump to key admin sections.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3">
                  <Button asChild variant="outline"><Link to={createPageUrl("UserManagement")}>User Management</Link></Button>
                  <Button asChild variant="outline"><Link to={createPageUrl("AdminSchools")}>School Directory</Link></Button>
                  <Button asChild variant="outline"><Link to={createPageUrl("AdminPackages")}>Subscription Packages</Link></Button>
                  <Button asChild variant="outline"><Link to={createPageUrl("AdminEvents")}>Manage Events</Link></Button>
                  <Button asChild variant="outline"><Link to={createPageUrl("Verification")}>Verifications</Link></Button>
                  <Button asChild variant="outline"><Link to={createPageUrl("AdminPayments")}>Payments & Transactions</Link></Button>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Admin Posting Power</CardTitle>
                  <CardDescription>
                    Post scholarships, announcements, promos, and updates directly from admin.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Your admin account can now post into the same public feed like an agent, but with role shown as <strong>ADMIN</strong>.
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <div className="rounded-2xl border bg-white">
                <div className="p-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 w-full">
                    <Avatar name={user?.full_name || "Admin"} />
                    <div className="w-full">
                      <div className="text-sm font-semibold text-gray-900">
                        What’s on your mind, admin?
                      </div>

                      <textarea
                        value={composerText}
                        onChange={(e) => setComposerText(e.target.value)}
                        placeholder="Share scholarships, announcements, school promos, or official platform updates..."
                        className="mt-2 w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-200 min-h-[90px]"
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
                              <div key={p.id} className="relative overflow-hidden rounded-2xl border bg-gray-100">
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

                      {postError ? <div className="mt-2 text-sm text-red-600">{postError}</div> : null}

                      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="justify-center text-gray-700 w-full sm:w-auto"
                          onClick={openFilePicker}
                        >
                          <ImageIcon className="h-4 w-4 mr-2 text-purple-600" />
                          Photo/video
                        </Button>

                        <Button
                          className="rounded-xl w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
                          onClick={handlePost}
                          disabled={posting || (!composerText.trim() && attachments.length === 0)}
                        >
                          {posting ? (
                            <span className="inline-flex items-center">
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Posting
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

              <div className="space-y-4">
                {communityLoading ? (
                  <div className="rounded-2xl border bg-white p-6 text-sm text-gray-500">Loading posts…</div>
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
                      authorCountryByUid={authorCountryByUid}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Overview of recent platform activity.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Recent platform activity will appear here once available.
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Suggested Use</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>• Scholarship announcements</p>
                  <p>• Featured school promos</p>
                  <p>• System updates</p>
                  <p>• Verification reminders</p>
                  <p>• Public trust-building posts</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}