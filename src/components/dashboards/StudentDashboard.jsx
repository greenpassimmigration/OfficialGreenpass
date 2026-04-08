import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Share2,
  Flag,
  Globe,
  UserPlus,
  UserMinus,
  Send,
  ShieldCheck,
  Building2,
  GraduationCap,
  Users,
  Loader2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

// 🤝 Follow helpers
import {
  listenFollowState,
  sendFollowRequest,
  cancelFollowRequest,
  unfollowUser,
} from "@/api/follow";

// 🌍 i18n
import { useTr } from "@/i18n/useTr";

// 🔥 Firebase
import { db, auth } from "@/firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";

// 💳 Subscription mode toggle
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

/* -------------------- Small helpers -------------------- */
const toValidDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const timeAgo = (dt) => {
  const d = toValidDate(dt);
  if (!d) return "—";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo`;
  const y = Math.floor(days / 365);
  return `${y}y`;
};

const POST_PREVIEW_TEXT_LIMIT = 320;
const MAX_DASHBOARD_MEDIA = 4;

const buildPostDetailUrl = (postId) =>
  `${createPageUrl("PostDetails")}?id=${encodeURIComponent(postId || "")}`;

const buildCreatorProfileRoute = (post) => {
  const authorId = String(post?.authorId || "").trim();
  const authorRole = String(post?.authorRole || "").toLowerCase().trim();

  if (!authorId) return null;

  if (authorRole === "school") {
    return {
      pathname: "/schooldetails",
      search: `?id=${encodeURIComponent(authorId)}`,
    };
  }

  return {
    pathname: `/view-profile/${encodeURIComponent(authorId)}`,
    search: "",
  };
};

const Avatar = ({ name = "User", role = "user" }) => {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");

  const roleIcon =
    role === "school" ? (
      <Building2 className="h-3.5 w-3.5" />
    ) : role === "tutor" ? (
      <GraduationCap className="h-3.5 w-3.5" />
    ) : role === "agent" ? (
      <Users className="h-3.5 w-3.5" />
    ) : (
      <ShieldCheck className="h-3.5 w-3.5" />
    );

  const roleColor =
    role === "school"
      ? "bg-blue-600"
      : role === "tutor"
      ? "bg-purple-600"
      : role === "agent"
      ? "bg-emerald-600"
      : "bg-gray-600";

  return (
    <div className="relative">
      <div className="h-11 w-11 rounded-full bg-gradient-to-br from-emerald-500 to-blue-600 text-white flex items-center justify-center font-semibold">
        {initials || "U"}
      </div>
      <div
        className={`absolute -bottom-1 -right-1 h-6 w-6 rounded-full ${roleColor} text-white flex items-center justify-center border-2 border-white`}
        title={role}
      >
        {roleIcon}
      </div>
    </div>
  );
};

const RoleBadge = ({ role, tr }) => {
  const cfg =
    role === "school"
      ? { label: tr("role_school", "School"), cls: "bg-blue-50 text-blue-700 border-blue-100" }
      : role === "tutor"
      ? { label: tr("role_tutor", "Tutor"), cls: "bg-purple-50 text-purple-700 border-purple-100" }
      : role === "agent"
      ? { label: tr("role_agent", "Agent"), cls: "bg-emerald-50 text-emerald-700 border-emerald-100" }
      : { label: tr("role_verified", "Verified"), cls: "bg-gray-50 text-gray-700 border-gray-100" };

  return (
    <Badge variant="secondary" className={`border ${cfg.cls}`}>
      {cfg.label}
    </Badge>
  );
};

const StatPill = ({ children }) => (
  <span className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] text-gray-600">
    {children}
  </span>
);

// 🌍 Country helpers
const flagUrlFromCode = (code) => {
  const cc = String(code || "").trim().toLowerCase();
  if (!cc) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

/* ✅ Real media viewer: multiple images/videos */
const MediaGallery = ({ media = [], postId, tr }) => {
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
          if (!url) return null;

          const showMoreOverlay = idx === MAX_DASHBOARD_MEDIA - 1 && remaining > 0;

          return (
            <Link
              key={`${url}-${idx}`}
              to={postDetailUrl}
              state={{ postId }}
              className="relative block overflow-hidden rounded-2xl border bg-gray-100"
              title={tr("view_post_details", "View post details")}
            >
              <div className="relative flex h-60 w-full items-center justify-center bg-gray-100">
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

/* -------------------- Follow Button -------------------- */
function FollowButton({ currentUserId, creatorId, creatorRole, size = "sm", className = "" }) {
  const { tr } = useTr("student_dashboard");
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
      {state.following ? (
        <>
          <UserMinus className="h-4 w-4 mr-2" /> {label}
        </>
      ) : state.requested ? (
        <>
          <UserPlus className="h-4 w-4 mr-2" /> {label}
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-2" /> {label}
        </>
      )}
    </Button>
  );
}

/* -------------------- Post Card UI -------------------- */
function FeedPostCard({ post, myUid, onMessage, authorCountryByUid, tr }) {
  const navigate = useNavigate();
  const authorRole = String(post?.authorRole || "").toLowerCase().trim();
  const isAdminPost = authorRole === "admin";
  const isSchool = authorRole === "school";
  const canMessage = authorRole !== "school" && authorRole !== "admin";
  const canFollow = authorRole !== "admin";
  const postDetailUrl = buildPostDetailUrl(post.id);
  const creatorProfileRoute = buildCreatorProfileRoute(post);

  const fullText = String(post.text || "");
  const hasLongText = fullText.length > POST_PREVIEW_TEXT_LIMIT;
  const previewText = hasLongText
    ? `${fullText.slice(0, POST_PREVIEW_TEXT_LIMIT).trimEnd()}…`
    : fullText;

  const sharePost = async () => {
    try {
      const url = `${window.location.origin}${buildPostDetailUrl(post.id)}`;
      if (navigator.share) {
        await navigator.share({
          title: tr("share_post", "Share post"),
          text: tr("share_post_text", "Check out this post on GreenPass"),
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      alert(tr("link_copied", "Link copied"));
    } catch (e) {
      console.error("sharePost error", e);
      try {
        const url = `${window.location.origin}${buildPostDetailUrl(post.id)}`;
        window.prompt(tr("copy_link", "Copy link:"), url);
      } catch {
        alert(tr("share_failed", "Share failed"));
      }
    }
  };

  const reportPost = async () => {
    try {
      const reason = window.prompt(tr("report_reason_prompt", "Why are you reporting this post?"), "") || "";
      const cleanReason = reason.trim();
      if (!cleanReason) return;

      if (!myUid) {
        alert(tr("login_required", "Please log in first."));
        return;
      }

      await addDoc(collection(db, "post_reports"), {
        postId: post.id,
        reporterId: myUid,
        authorId: post.authorId || "",
        reason: cleanReason,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      alert(tr("report_submitted", "Report submitted"));
    } catch (e) {
      console.error("reportPost error", e);
      alert(tr("report_failed", "Report failed"));
    }
  };

  return (
    <Card className="overflow-hidden rounded-2xl">
      <CardContent className="p-0">
        {/* Header */}
        <div className="p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar name={post.authorName} role={post.authorRole} />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-2 flex-wrap">
                {post?.authorId && creatorProfileRoute ? (
                  <button
                    type="button"
                    onClick={() => {
                      console.log("Navigating to creator route:", creatorProfileRoute);
                      navigate(creatorProfileRoute);
                    }}
                    className="font-semibold text-gray-900 truncate hover:underline cursor-pointer text-left bg-transparent border-0 p-0"
                    title={isSchool ? tr("view_school_details", "View school details") : tr("view_profile", "View profile")}
                  >
                    {post.authorName}
                  </button>
                ) : (
                  <div className="font-semibold text-gray-900 truncate">{post.authorName}</div>
                )}

                <RoleBadge role={String(post.authorRole || "").toLowerCase()} tr={tr} />
              </div>

              {(() => {
                const authorId =
                  post?.authorId ||
                  post?.author_id ||
                  post?.user_id ||
                  post?.userId ||
                  "";
                const authorCountry = authorId ? authorCountryByUid?.[authorId] : null;

                const postCC =
                  post?.country_code ||
                  post?.countryCode ||
                  post?.author_country_code ||
                  post?.authorCountryCode ||
                  post?.authorCC ||
                  "";
                const postCountryName =
                  post?.country ||
                  post?.country_name ||
                  post?.author_country ||
                  post?.authorCountry ||
                  "";

                const authorCC = (authorCountry?.country_code || postCC || "").toString();
                const authorCountryName = (authorCountry?.country || postCountryName || "").toString();

                return (
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                    <span>{post.timeAgo}</span>
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
                );
              })()}

              {post.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {post.tags.slice(0, 4).map((t) => (
                    <StatPill key={t}>{t}</StatPill>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-gray-500" type="button" aria-label="Post actions">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={sharePost}>
                <Share2 className="h-4 w-4 mr-2" />
                {tr("share", "Share")}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={reportPost}>
                <Flag className="h-4 w-4 mr-2" />
                {tr("report", "Report")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Body */}
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

        {/* Media */}
        <MediaGallery media={post.media || []} postId={post.id} tr={tr} />

        {/* Follow + Message row */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {canFollow ? (
              <FollowButton
                currentUserId={myUid}
                creatorId={post.authorId}
                creatorRole={post.authorRole}
                size="sm"
                className="rounded-xl w-full"
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl w-full"
                disabled
              >
                Official admin post
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              className="rounded-xl w-full"
              disabled={!canMessage || !post.authorId || !myUid}
              onClick={() => {
                if (canMessage && post.authorId && myUid) onMessage?.(post.authorId);
              }}
              title={
                isAdminPost
                  ? "Users cannot message admins"
                  : isSchool
                  ? "School messaging is handled by Admin/Advisor"
                  : "Message"
              }
            >
              <Send className="h-4 w-4 mr-2" />
              {isAdminPost ? "Official admin post" : tr("message", "Message")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------- REAL Student Dashboard -------------------- */
export default function StudentDashboard({ user }) {
  const { tr } = useTr("student_dashboard");
  const { subscriptionModeEnabled, loading: subscriptionLoading } = useSubscriptionMode();
  const navigate = useNavigate();
  const myUid = user?.id || user?.uid || user?.user_id || auth?.currentUser?.uid || null;

  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState([]);
  const [following, setFollowing] = useState(() => new Set());
  const [requested, setRequested] = useState(() => new Set());
  const [authorCountryByUid, setAuthorCountryByUid] = useState(() => ({}));

  // ✅ Live following set
  useEffect(() => {
    if (!myUid) return;

    const ref = collection(db, "users", myUid, "following");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next = new Set();
        snap.forEach((d) => next.add(d.id));
        setFollowing(next);
      },
      () => {}
    );

    return () => unsub();
  }, [myUid]);

  // ✅ Live sent-request set
  useEffect(() => {
    if (!myUid) return;

    const ref = collection(db, "users", myUid, "follow_requests_sent");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next = new Set();
        snap.forEach((d) => next.add(d.id));
        setRequested(next);
      },
      () => {}
    );

    return () => unsub();
  }, [myUid]);

  // ✅ Live posts feed
  useEffect(() => {
    const qPosts = query(
      collection(db, "posts"),
      where("status", "==", "published"),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      qPosts,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          const created =
            data.createdAt || data.created_at || data.publishedAt || data.published_at || null;

          return {
            id: d.id,
            authorId: data.authorId || data.author_id || data.user_id || data.userId || "",
            authorRole: String(data.authorRole || data.author_role || "").toLowerCase(),
            authorName: data.authorName || data.author_name || "Creator",
            country: data.country || data.authorCountry || data.author_country || "",
            countryCode:
              data.country_code || data.countryCode || data.authorCountryCode || data.author_country_code || "",
            text: data.text || "",
            tags: Array.isArray(data.tags) ? data.tags : [],
            isFeatured: !!data.isFeatured,
            timeAgo: timeAgo(created),
            media: Array.isArray(data.media) ? data.media : [],
          };
        });

        setPosts(list);
        setLoading(false);
      },
      (err) => {
        console.error("community posts snapshot error", err);
        setPosts([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // ✅ Resolve author country for posts that don't store it
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        if (!posts?.length) return;

        const ids = Array.from(new Set(posts.map((p) => p?.authorId).filter(Boolean)));
        const missing = ids.filter((uid) => !(uid in authorCountryByUid));
        if (missing.length === 0) return;

        const next = { ...authorCountryByUid };

        for (let i = 0; i < missing.length; i += 10) {
          const chunk = missing.slice(i, i + 10);
          const qUsers = query(collection(db, "users"), where("__name__", "in", chunk));
          const snap = await getDocs(qUsers);
          snap.forEach((d) => {
            const data = d.data() || {};
            const country = data.country || data.authorCountry || data.author_country || "";
            const country_code =
              data.country_code || data.countryCode || data.countryCode2 || data.countryCodeISO || "";
            next[d.id] = { country, country_code };
          });

          chunk.forEach((uid) => {
            if (!(uid in next)) next[uid] = { country: "", country_code: "" };
          });
        }

        if (!cancelled) setAuthorCountryByUid(next);
      } catch (e) {
        console.error("author country resolve failed:", e);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [posts, authorCountryByUid]);

  const messageCreator = (post) => {
    if (!post?.authorId) return;
    navigate(`${createPageUrl("Messages")}?with=${encodeURIComponent(post.authorId)}`);
  };

  const showSubscriptionNotice = !subscriptionLoading && subscriptionModeEnabled;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="w-full px-3 sm:px-6 lg:px-8 py-5">
        {showSubscriptionNotice ? (
          <div className="mx-auto max-w-[1800px] mb-5">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-red-800">
                  {tr("subscription_required_title", "Subscription required")}
                </div>
                <div className="text-xs text-red-700 mt-1">
                  {tr("subscription_required_body", "Subscription mode is enabled. Subscribe to unlock full features.")}
                </div>
              </div>

              <Button
                type="button"
                className="rounded-xl bg-red-600 hover:bg-red-700"
                onClick={() => navigate(createPageUrl("Subscribe"))}
              >
                {tr("subscribe_now", "Subscribe")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mx-auto max-w-[1800px] grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10">
          {/* LEFT */}
          <div className="hidden lg:block lg:col-span-3">
            <div className="sticky top-4 space-y-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">
                  {tr("discover_title", "Discover")}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {tr("discover_subtitle", "Browse posts from Agents, Tutors, and Schools.")}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2">
                  <Button
                    variant="outline"
                    className="justify-start rounded-xl"
                    onClick={() => navigate(createPageUrl("Directory"))}
                    type="button"
                  >
                    <Users className="h-4 w-4 mr-2 text-emerald-600" />
                    {tr("directory", "Directory")}
                  </Button>
                </div>

                <div className="mt-4 rounded-xl bg-gray-50 border p-3">
                  <div className="text-xs font-semibold text-gray-700">
                    {tr("following_card_title", "Following")}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {tr("following_count", "You’re following {{count}} creators", { count: following.size })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">
                  {tr("how_messaging_works_title", "How messaging works")}
                </div>
                <div className="text-xs text-gray-600 mt-2 leading-relaxed">
                  {tr(
                    "how_messaging_works_body",
                    "You can message Agents and Tutors. For Schools, messaging is handled by Admin/Advisor — follow schools to receive updates."
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* CENTER */}
          <div className="lg:col-span-6 space-y-4">
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900">
                      {tr("explore_updates_title", "Explore Updates")}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {tr("explore_updates_subtitle", "Follow creators to get notified when they post next.")}
                    </div>
                  </div>
                  <Badge className="bg-zinc-900 text-white">{tr("all_posts", "All Posts")}</Badge>
                </div>
              </CardContent>
            </Card>

            {loading ? (
              <Card className="rounded-2xl">
                <CardContent className="p-10 flex items-center justify-center text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> {tr("loading_posts", "Loading posts…")}
                </CardContent>
              </Card>
            ) : posts.length === 0 ? (
              <Card className="rounded-2xl">
                <CardContent className="p-6 text-sm text-gray-600">{tr("no_posts", "No community posts yet.")}</CardContent>
              </Card>
            ) : (
              posts.map((p) => (
                <FeedPostCard
                  key={p.id}
                  post={p}
                  myUid={myUid}
                  onMessage={messageCreator}
                  authorCountryByUid={authorCountryByUid}
                  tr={tr}
                />
              ))
            )}
          </div>

          {/* RIGHT */}
          <div className="hidden lg:block lg:col-span-3">
            <div className="sticky top-4 space-y-4">
              <div className="rounded-2xl border bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900">
                    {tr("suggested_to_follow", "Suggested to follow")}
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-600">
                  {tr("suggested_note", "(Optional) You can later load “Suggested” from Firestore.")}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="text-sm font-semibold text-gray-900">{tr("tip_title", "Tip")}</div>
                <div className="text-xs text-gray-600 mt-2 leading-relaxed">
                  {tr("tip_body", "Follow creators you trust. You’ll automatically get a notification when they post next.")}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile-only suggestions block */}
        <div className="lg:hidden mt-6">
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="text-sm font-semibold text-gray-900">{tr("tip_title", "Tip")}</div>
              <div className="text-xs text-gray-600 mt-1">
                {tr("explore_updates_subtitle", "Follow creators to get notified when they post next.")}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}