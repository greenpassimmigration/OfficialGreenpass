// src/pages/Layout.jsx
import React from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, Outlet, Navigate } from "react-router-dom";
import NotificationsBell from "@/components/NotificationsBell";

/* --- Safe import of createPageUrl (with fallback if not exported) --- */
import * as Utils from "@/utils";
const withLang = (path = "") => {
  const lang =
    new URLSearchParams(window.location.search).get("lang") ||
    localStorage.getItem("gp_lang") ||
    "en";
  const u = new URL(path, window.location.origin);
  u.searchParams.set("lang", lang);
  return u.pathname + u.search;
};

const createPageUrl =
  (Utils && Utils.createPageUrl) ||
  ((label = "") =>
    label
      .toString()
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^\w/]/g, "")
      .toLowerCase());

const REQUIRED_POLICY_KEYS = ["terms", "privacy", "community", "refund", "verification", "referral"];
const CURRENT_POLICY_VERSION = "2026-03-21";

function hasCompletedPolicies(user) {
  const acceptance = user?.policy_acceptance || {};
  const accepted = acceptance?.accepted && typeof acceptance.accepted === "object" ? acceptance.accepted : {};

  const allRequiredAccepted = REQUIRED_POLICY_KEYS.every(
    (key) => accepted?.[key]?.accepted === true
  );

  return allRequiredAccepted && acceptance?.version === CURRENT_POLICY_VERSION;
}

function buildStudentScanUrl(studentRef) {
  const token = String(studentRef || "").trim();
  if (!token) return createPageUrl("Dashboard");
  return `/scan/student?student_ref=${encodeURIComponent(token)}`;
}

function appendStudentRefToUrl(baseUrl, studentRef) {
  const token = String(studentRef || "").trim();
  if (!token) return baseUrl;

  const separator = String(baseUrl).includes("?") ? "&" : "?";
  return `${baseUrl}${separator}student_ref=${encodeURIComponent(token)}`;
}

import {
  Home,
  School,
  Users,
  UserCheck,
  UserPlus,
  Calendar,
  Store,
  Package,
  Building,
  LogOut,
  Globe,
  Search,
  MessageSquare,
  UsersIcon,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Landmark,
  Palette,
  Briefcase,
  GraduationCap,
  ShieldCheck,
  ClipboardList,
  CreditCard,
  Banknote,
  Receipt,
  Building2,
  FolderKanban,
  Headphones,
  UserCog,
  Mailbox,
  Handshake,
  BadgeCheck,
  FileCheck,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { getLang, setLang } from "@/lib/lang";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";

/* ---------- Firebase auth/profile ---------- */
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  query,
  where,
  limit,
  getDocs,
} from "firebase/firestore";

/* =========================
   Marketing Website URL (env-first)
========================= */
const MARKETING_URL =
  (typeof import.meta !== "undefined" && import.meta?.env?.VITE_MARKETING_URL) ||
  "https://www.greenpassgroup.com/";

const normalizeUrl = (u = "") => {
  const s = String(u || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s : `${s}/`;
};

const getMarketingUrl = () => {
  const base = normalizeUrl(MARKETING_URL);
  try {
    const lang =
      window?.localStorage?.getItem("gp_lang") ||
      window?.localStorage?.getItem("i18nextLng") ||
      "en";
    const u = new URL(base);
    u.searchParams.set("lang", lang);
    return u.toString();
  } catch {
    return base;
  }
};

const FALLBACK_TEXT = {
  schoolLeads: "School Leads",
  login: "Login",
  logOut: "Log Out",
  profileSettings: "Profile Settings",
  more: "More",
  organization: "Organization",
  schoolProfile: "School Profile",
  schoolDetails: "School Details",
  myStudents: "My Students",
  leads: "Leads",
  account: "Account",
  accountSettings: "Account Settings",
  dashboard: "Dashboard",
  directory: "Directory",
  connect: "Connect",
  connections: "Connections",
  events: "Events",
  messages: "Messages",
  contactSupport: "Contact Support",
  supportInbox: "Support Inbox",
  institutionManagement: "Institution Management",
  userManagement: "User Management",
  verifications: "Verifications",
  paymentVerification: "Payment Verification",
  paymentMonitoring: "Payment Monitoring",
  referrals: "Referrals",
  eventsAdmin: "Event Management",
  schoolManagement: "School Management",
  reports: "Reports",
  brandSettings: "Brand Settings",
  subscriptionMode: "Subscription Mode",
  bankSettings: "Bank Settings",
  chatSettings: "Chat Settings",
  profile: "Profile",
  signOut: "Sign Out",
  myServices: "My Services",
  seatReservations: "Seat Reservations",
  myAgent: "My Agent",
  search: "Search",
  searchPlaceholder: "Search...",
  apps: "Apps",
  admin: "Admin",
  tutors: "Tutors",
  planner: "Planner",
  policyCenter: "Policy Center",
  termsOfService: "Terms of Service",
  privacyPolicy: "Privacy Policy",
  communityGuidelines: "Community Guidelines",
  messagingPolicy: "Messaging and Investigation Policy",
  verificationPolicy: "Verification Policy",
  referralPolicy: "Referral and Invitation Policy",
  refundPolicy: "Refund and Payment Review Policy",
  immigrationDisclaimer: "Immigration and Outcome Disclaimer",
  adminClaimRequests: "Claim Requests",
};

const fb = (key) => FALLBACK_TEXT[key] || key;

/* ---------- translation safety ---------- */
const safeText = (value, fallback = "") => (typeof value === "string" ? value : fallback);

function useNavTr() {
  const { t } = useTranslation();
  return React.useCallback(
    (key, defaultValue) => {
      const fallback = defaultValue ?? fb(key);
      const value = t(`nav.${key}`, { defaultValue: fallback });
      return safeText(value, fallback);
    },
    [t]
  );
}

/* ---------- Social links ---------- */
const SOCIAL_LINKS = [
  { platform: "YouTube", url: "https://www.youtube.com/@GreenPassGroup" },
  { platform: "Facebook", url: "https://www.facebook.com/greenpassgroup" },
  { platform: "Instagram", url: "https://www.instagram.com/greenpassglobal/" },
  {
    platform: "TikTok",
    url: "https://www.tiktok.com/@greenpasstv?_t=ZS-8zH7Q114gVM&_r=1",
  },
];

const TikTokIcon = ({ className = "h-5 w-5" }) => (
  <svg
    viewBox="0 0 256 256"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M240 96a96 96 0 0 1-56-18.1V160a56 56 0 1 1-56-56 56.1 56.1 0 0 1 9 .74V80.22a96.19 96.19 0 0 1-16-.22v37.84A72 72 0 1 0 216 128V112a96.26 96.26 0 0 0 24 3.17Z"
      fill="currentColor"
    />
  </svg>
);

const Dots9Icon = ({ className = "h-6 w-6" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    {[
      [6, 6],
      [12, 6],
      [18, 6],
      [6, 12],
      [12, 12],
      [18, 12],
      [6, 18],
      [12, 18],
      [18, 18],
    ].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="1.6" />
    ))}
  </svg>
);

const iconByPlatform = (platform = "") => {
  const p = platform.toLowerCase().trim();
  if (p === "tiktok" || p === "tik tok") return <TikTokIcon className="h-5 w-5" />;
  return <Globe className="h-5 w-5" />;
};

/* =========================
   Small: click-outside hook
========================= */
function useClickOutside(ref, handler, when = true) {
  React.useEffect(() => {
    if (!when) return;
    const onDown = (e) => {
      const el = ref?.current;
      if (!el) return;
      if (el === e.target || el.contains(e.target)) return;
      handler?.(e);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [ref, handler, when]);
}

/* =========================
   Avatar + Account Button
========================= */
const UserAvatar = ({
  user,
  sizeClass = "w-10 h-10",
  textClass = "text-lg",
  className = "",
}) => {
  const { t } = useTranslation();
  const name =
    user?.full_name ||
    safeText(t("nav.account", { defaultValue: "Account" }), "Account");
  const initial = name.charAt(0).toUpperCase();
  const photo = user?.photo_url || user?.profile_picture || user?.photoURL;

  if (photo) {
    return (
      <div
        className={`rounded-full overflow-hidden border border-white shadow-sm bg-white flex items-center justify-center ${sizeClass} ${className}`}
      >
        <img
          src={photo}
          alt={name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br from-green-500 to-blue-500 flex items-center justify-center text-white font-bold ${sizeClass} ${textClass} ${className}`}
    >
      {initial}
    </div>
  );
};

const AccountTrigger = ({ currentUser, open, onClick }) => {
  const { t } = useTranslation();
  const accountLabel = safeText(t("nav.account", { defaultValue: "Account" }), "Account");

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-10 sm:h-11 inline-flex items-center gap-2 rounded-full px-2 pr-2.5 transition",
        open
          ? "bg-green-100 text-green-700 ring-1 ring-green-200"
          : "bg-gray-100 hover:bg-gray-200 text-gray-700"
      )}
      aria-label={accountLabel}
      title={accountLabel}
      aria-expanded={open}
      aria-haspopup="menu"
    >
      <UserAvatar
        user={currentUser}
        sizeClass="w-8 h-8 sm:w-9 sm:h-9"
        textClass="text-base"
      />
      <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 opacity-80" />
    </button>
  );
};

const AccountDropdown = ({
  currentUser,
  open,
  setOpen,
  onLogout,
  items = [],
  title,
}) => {
  const { t } = useTranslation();
  const wrapRef = React.useRef(null);
  useClickOutside(wrapRef, () => setOpen(false), open);

  const resolvedTitle =
    title || safeText(t("nav.account", { defaultValue: "Account" }), "Account");

  const MenuItem = ({ to, onClick, Icon, label, danger = false, chevron = false }) => {
    const base =
      "w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm sm:text-[15px] transition-colors";
    const cls = danger
      ? `${base} text-red-600 hover:bg-red-50`
      : `${base} text-gray-800 hover:bg-gray-50`;

    const Right = () =>
      chevron ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-gray-400" /> : null;

    const iconCls = cn(
      "h-5 w-5 shrink-0",
      danger ? "text-red-600" : "text-gray-600"
    );

    if (to) {
      return (
        <Link to={to} className={cls} onClick={() => setOpen(false)}>
          <Icon className={iconCls} />
          <span className="min-w-0 flex-1 break-words leading-5">{label}</span>
          <Right />
        </Link>
      );
    }

    return (
      <button
        type="button"
        className={cls}
        onClick={() => {
          setOpen(false);
          onClick?.();
        }}
      >
        <Icon className={iconCls} />
        <span className="min-w-0 flex-1 break-words leading-5">{label}</span>
        <Right />
      </button>
    );
  };

  return (
    <div className="relative" ref={wrapRef}>
      <AccountTrigger
        currentUser={currentUser}
        open={open}
        onClick={() => setOpen((v) => !v)}
      />

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.12 }}
            role="menu"
            className="
              absolute right-0 top-full mt-2 z-[210]
              w-[320px] max-w-[92vw]
              max-h-[calc(100vh-88px)]
              overflow-hidden rounded-2xl bg-white
              shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)]
              ring-1 ring-black/5
              max-sm:w-[92vw]
              max-sm:max-h-[calc(100vh-72px)]
            "
          >
            <div className="bg-white px-2 pt-2 pb-3">
              <div className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-gray-50 transition">
                <UserAvatar
                  user={currentUser}
                  sizeClass="w-11 h-11 sm:w-12 sm:h-12"
                  textClass="text-base sm:text-lg"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">
                    {currentUser?.full_name || safeText(t("nav.account", { defaultValue: "Account" }), "Account")}
                  </div>
                  <div className="text-xs text-gray-500 capitalize truncate">
                    {currentUser?.user_type || safeText(t("nav.account", { defaultValue: "Account" }), "Account")}
                  </div>
                </div>
              </div>
              <div className="mt-2 h-px bg-gray-100" />
            </div>

            <div
              className="
                overflow-y-auto px-1 pb-2
                max-h-[calc(100vh-180px)]
                max-sm:max-h-[calc(100vh-150px)]
              "
            >
              <div className="px-3 pb-2 text-xs text-gray-500">{resolvedTitle}</div>

              {items.map((it) => (
                <MenuItem
                  key={`${it.url || it.label}-${it.label}`}
                  to={it.url}
                  onClick={it.onClick}
                  Icon={it.icon}
                  label={it.label}
                  danger={it.danger}
                  chevron={it.chevron}
                />
              ))}

              <div className="my-2 h-px bg-gray-100" />

              <MenuItem
                onClick={onLogout}
                Icon={LogOut}
                label={safeText(t("nav.logOut", { defaultValue: "Logout" }), "Logout")}
                danger
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function dedupeMenuItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.url || item?.label || item?.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAccountMenuItems(currentUser, tr) {
  const role = String(currentUser?.user_type || currentUser?.role || "student").toLowerCase();
  const items = [];

  if (role === "agent") {
    items.push(
      { label: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
      { label: tr("myStudents", "My Students"), url: createPageUrl("MyStudents"), icon: GraduationCap }
    );
  }

  if (role === "tutor") {
    items.push(
      { label: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
      { label: tr("myStudents", "My Students"), url: createPageUrl("TutorStudents"), icon: GraduationCap },
      { label: tr("planner", "Planner"), url: createPageUrl("Planner"), icon: Calendar }
    );
  }

  if (role === "school") {
    items.push(
      { label: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
      { label: tr("schoolProfile", "School Profile"), url: createPageUrl("SchoolProfile"), icon: Building2 },
      { label: tr("schoolDetails", "School Details"), url: createPageUrl("SchoolDetails"), icon: ClipboardList },
      { label: tr("schoolLeads", "School Leads"), url: createPageUrl("SchoolLeads"), icon: Users }
    );
  }

  if (role === "collaborator") {
    items.push({
      label: tr("referrals", "Referrals"),
      url: createPageUrl("Referrals"),
      icon: Handshake,
    });
  }

  if ((role === "user" || role === "student") && currentUser?.assigned_agent_id) {
    items.push({
      label: tr("myAgent", "My Agent"),
      url: createPageUrl("MyAgent"),
      icon: Handshake,
    });
  }

  items.push(
    { label: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
    role === "admin"
      ? {
          label: tr("supportInbox", "Support Inbox"),
          url: withLang("/messages?inbox=support"),
          icon: Mailbox,
        }
      : {
          label: tr("contactSupport", "Contact Support"),
          url: withLang("/messages?to=support&role=support"),
          icon: Headphones,
        },
    { label: tr("policyCenter", "Policy Center"), url: createPageUrl("PolicyCenter"), icon: ShieldCheck },
    { label: tr("profileSettings", "Profile Settings"), url: createPageUrl("Profile"), icon: UserCog }
  );

  return dedupeMenuItems(items);
}

function getTopCenterNavItems(tt) {
  return [
    { url: createPageUrl("Dashboard"), icon: Home, label: tt("nav.dashboard", "Dashboard") },
    { url: createPageUrl("Directory"), icon: School, label: tt("nav.directory", "Directory") },
    { url: createPageUrl("Connect"), icon: UserPlus, label: tt("nav.connect", "Connect") },
    { url: createPageUrl("Events"), icon: Calendar, label: tt("nav.events", "Events") },
  ];
}

/* =========================
   Mobile Bottom Nav
========================= */
const MobileBottomNav = ({ nav, isActive }) => {
  const tr = useNavTr();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const sheetRef = React.useRef(null);
  useClickOutside(sheetRef, () => setMoreOpen(false), moreOpen);

  const main = nav?.main || [];
  const more = nav?.more || [];

  const ItemButton = ({ to, Icon, label, active, onClick }) => (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-2 flex-1",
        active ? "text-green-700" : "text-gray-600"
      )}
      aria-label={label}
      title={label}
    >
      <Icon className={cn("h-6 w-6", active ? "text-green-700" : "text-gray-600")} />
      <span className="text-[11px] font-medium leading-none">{label}</span>
    </Link>
  );

  const SheetItem = ({ to, Icon, label }) => (
    <Link
      to={to}
      onClick={() => setMoreOpen(false)}
      className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-gray-50 text-gray-800"
    >
      <Icon className="h-5 w-5 text-gray-600" />
      <span className="text-sm font-medium">{label}</span>
      <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
    </Link>
  );

  return (
    <>
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200">
        <div className="h-[72px] px-2 flex items-stretch">
          {main.slice(0, 3).map((it) => (
            <ItemButton
              key={it.url}
              to={it.url}
              Icon={it.icon}
              label={it.title}
              active={isActive(it.url)}
              onClick={() => setMoreOpen(false)}
            />
          ))}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 py-2 flex-1",
              moreOpen ? "text-green-700" : "text-gray-600"
            )}
            aria-label={tr("more", "More")}
            title={tr("more", "More")}
          >
            <MoreHorizontal
              className={cn("h-6 w-6", moreOpen ? "text-green-700" : "text-gray-600")}
            />
            <span className="text-[11px] font-medium leading-none">{tr("more", "More")}</span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-50 bg-black/35"
          >
            <motion.div
              ref={sheetRef}
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute left-0 right-0 bottom-0 rounded-t-3xl bg-white shadow-[0_-16px_48px_-12px_rgba(0,0,0,0.25)]"
            >
              <div className="px-4 pt-3 pb-2">
                <div className="mx-auto h-1.5 w-12 rounded-full bg-gray-200" />
                <div className="mt-3 text-sm font-semibold text-gray-900">
                  {tr("more", "More")}
                </div>
                <div className="mt-2 h-px bg-gray-100" />
              </div>

              <div className="px-3 pb-6 max-h-[65vh] overflow-y-auto">
                <div className="space-y-1">
                  {more.map((it) => (
                    <SheetItem key={it.url} to={it.url} Icon={it.icon} label={it.title} />
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

/* ---------- Public layout ---------- */
const PublicLayout = ({ getLogoUrl, getCompanyName }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tt = React.useCallback((key, fallback) => safeText(t(key, { defaultValue: fallback }), fallback), [t]);

  const headerRef = React.useRef(null);
  const [headerH, setHeaderH] = React.useState(72);
  const [measured, setMeasured] = React.useState(false);
  const [q, setQ] = React.useState("");

  React.useLayoutEffect(() => {
    const update = () => {
      const h = headerRef.current?.offsetHeight ?? 0;
      if (h) {
        setHeaderH(h);
        setMeasured(true);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  const onSubmitSearch = React.useCallback(
    (e) => {
      e.preventDefault();
      const term = (q || "").trim();
      const base = createPageUrl("Directory");
      navigate(term ? `${base}?q=${encodeURIComponent(term)}` : base);
    },
    [q, navigate]
  );

  const isActive = React.useCallback(
    (to) => {
      if (!to) return false;

      const normalize = (value = "") =>
        String(value).toLowerCase().replace(/\/+$/, "") || "/";

      const path = normalize(location.pathname || "/");
      const target = normalize(to || "/");

      if (target === "/") return path === "/";

      return path === target || path.startsWith(`${target}/`);
    },
    [location.pathname]
  );

  const IconLink = ({ to, Icon, label, iconClass = "h-6 w-6 sm:h-7 sm:w-7" }) => {
    const active = isActive(to);
    return (
      <Link
        to={to}
        className={cn(
          "inline-flex items-center justify-center rounded-2xl p-3 sm:p-3.5 transition",
          active
            ? "bg-green-100 text-green-700"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        )}
        aria-label={label}
        title={label}
      >
        <Icon className={iconClass} />
      </Link>
    );
  };

  return (
    <div className="min-h-[100svh] bg-white font-sans text-gray-800">
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm"
      >
        <nav data-public-nav="1" className="w-full px-4 sm:px-5 lg:px-7 py-2">
          <div className="relative flex items-center h-12 sm:h-14">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Link
                to={createPageUrl("")}
                className="flex items-center shrink-0"
                aria-label="GreenPass"
                title="GreenPass"
              >
                <img
                  src={getLogoUrl()}
                  alt={`${getCompanyName()} Super App`}
                  className="h-8 sm:h-9 w-auto"
                />
              </Link>

              <form onSubmit={onSubmitSearch} className="hidden lg:flex items-center min-w-0">
                <div className="relative min-w-0 w-[170px] md:w-[210px] lg:w-[240px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={tt("nav.searchPlaceholder", "Search...")}
                    className="w-full h-10 rounded-full border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-green-200 focus:border-green-300"
                    aria-label={tt("nav.search", "Search")}
                  />
                </div>
              </form>
            </div>

            <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center justify-center pointer-events-none">
              <div className="pointer-events-auto w-[620px] md:w-[700px] lg:w-[760px]">
                <div className="flex w-full">
                  {getTopCenterNavItems(tt).map((item) => (
                    <div key={item.url} className="flex-1 flex justify-center">
                      <IconLink to={item.url} Icon={item.icon} label={item.label} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center justify-end gap-2">
              <Link
                to={createPageUrl("Directory")}
                className="w-10 h-10 sm:w-11 sm:h-11 inline-flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                aria-label={tt("nav.apps", "Apps")}
                title={tt("nav.apps", "Apps")}
              >
                <Dots9Icon className="h-6 w-6" />
              </Link>

              <Link
                to={createPageUrl("Welcome")}
                className="w-10 h-10 sm:w-11 sm:h-11 inline-flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                aria-label={tt("nav.login", "Login")}
                title={tt("nav.login", "Login")}
              >
                <UserCheck className="h-6 w-6" />
              </Link>
            </div>
          </div>
        </nav>
      </header>

      <main
        className="min-h-[100svh] transition-[padding] ease-out overflow-y-auto overflow-x-hidden touch-pan-y"
        style={{
          paddingTop: headerH,
          visibility: measured ? "visible" : "hidden",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Outlet />
      </main>

      <Footer getCompanyName={getCompanyName} />
    </div>
  );
};

/* ---------- Shared helpers ---------- */
const useHeaderMeasure = () => {
  const headerRef = React.useRef(null);
  const [headerH, setHeaderH] = React.useState(72);
  const [measured, setMeasured] = React.useState(false);

  React.useLayoutEffect(() => {
    const update = () => {
      const h = headerRef.current?.offsetHeight ?? 0;
      if (h) {
        setHeaderH(h);
        setMeasured(true);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (headerRef.current) ro.observe(headerRef.current);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, []);

  return { headerRef, headerH, measured };
};

const useIsActive = () => {
  const location = useLocation();

  return React.useCallback(
    (to) => {
      if (!to) return false;

      const normalize = (value = "") =>
        String(value).toLowerCase().replace(/\/+$/, "") || "/";

      const path = normalize(location.pathname || "/");
      const target = normalize(to || "/");

      if (target === "/") return path === "/";

      return path === target || path.startsWith(`${target}/`);
    },
    [location.pathname]
  );
};

const TopNavIconLink = ({ to, Icon, label, isActive, iconClass = "h-6 w-6 sm:h-7 sm:w-7" }) => {
  const active = isActive(to);

  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl p-3 sm:p-3.5 transition",
        active ? "bg-green-100 text-green-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      )}
      aria-label={label}
      title={label}
    >
      <Icon className={iconClass} />
    </Link>
  );
};

/* ---------- Shared authenticated top nav layout ---------- */
const AuthenticatedTopNavLayout = ({
  currentUser,
  getLogoUrl,
  getCompanyName,
  onLogout,
  mobileNav,
}) => {
  const { t } = useTranslation();
  const tt = React.useCallback((key, fallback) => safeText(t(key, { defaultValue: fallback }), fallback), [t]);
  const tr = useNavTr();
  const navigate = useNavigate();
  const isActive = useIsActive();
  const { headerRef, headerH, measured } = useHeaderMeasure();
  const [q, setQ] = React.useState("");
  const [acctOpen, setAcctOpen] = React.useState(false);

  const onSubmitSearch = React.useCallback(
    (e) => {
      e.preventDefault();
      const term = (q || "").trim();
      const base = createPageUrl("Directory");
      navigate(term ? `${base}?q=${encodeURIComponent(term)}` : base);
    },
    [q, navigate]
  );

  return (
    <div className="min-h-[100svh] bg-white font-sans text-gray-800">
      <header ref={headerRef} className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <nav className="w-full px-4 sm:px-5 lg:px-7 py-2">
          <div className="relative flex items-center h-12 sm:h-14">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Link to={createPageUrl("Dashboard")} className="flex items-center shrink-0" aria-label="GreenPass" title="GreenPass">
                <img src={getLogoUrl()} alt={`${getCompanyName()} Super App`} className="h-8 sm:h-9 w-auto" />
              </Link>

              <form onSubmit={onSubmitSearch} className="hidden lg:flex items-center min-w-0">
                <div className="relative min-w-0 w-[170px] md:w-[210px] lg:w-[240px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={tt("nav.searchPlaceholder", "Search...")}
                    className="w-full h-10 rounded-full border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-green-200 focus:border-green-300"
                    aria-label={tt("nav.search", "Search")}
                  />
                </div>
              </form>
            </div>

            <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center justify-center pointer-events-none">
              <div className="pointer-events-auto w-[620px] md:w-[700px] lg:w-[760px]">
                <div className="flex w-full">
                  {getTopCenterNavItems(tt).map((item) => (
                    <div key={item.url} className="flex-1 flex justify-center">
                      <TopNavIconLink
                        to={item.url}
                        Icon={item.icon}
                        label={item.label}
                        isActive={isActive}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => navigate(createPageUrl("Messages"))}
                className="w-10 h-10 sm:w-11 sm:h-11 inline-flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                aria-label={tt("nav.messages", "Messages")}
                title={tt("nav.messages", "Messages")}
              >
                <MessageSquare className="h-6 w-6" />
              </button>

              <NotificationsBell currentUser={currentUser} createPageUrl={createPageUrl} />

              <AccountDropdown
                currentUser={currentUser}
                open={acctOpen}
                setOpen={setAcctOpen}
                onLogout={onLogout}
                title={tt("nav.account", "Account")}
                items={buildAccountMenuItems(currentUser, tr)}
              />
            </div>
          </div>
        </nav>
      </header>

      <main
        className="min-h-[100svh] transition-[padding] ease-out overflow-y-auto overflow-x-hidden touch-pan-y pb-[84px] lg:pb-0"
        style={{
          paddingTop: headerH,
          visibility: measured ? "visible" : "hidden",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Outlet />
      </main>

      {!currentUser && <Footer getCompanyName={getCompanyName} />}
      <MobileBottomNav nav={mobileNav} isActive={isActive} />
    </div>
  );
};

/* =========================
   ADMIN: Top Nav + Left Panel
========================= */
const AdminAuthedTopNavWithLeftPanelLayout = ({
  currentUser,
  getLogoUrl,
  getCompanyName,
  onLogout,
}) => {
  const { t } = useTranslation();
  const tt = React.useCallback((key, fallback) => safeText(t(key, { defaultValue: fallback }), fallback), [t]);
  const tr = useNavTr();
  const navigate = useNavigate();
  const isActive = useIsActive();
  const { headerRef, headerH, measured } = useHeaderMeasure();
  const [acctOpen, setAcctOpen] = React.useState(false);

  const accountSettingsItems = React.useMemo(
    () =>
      dedupeMenuItems([
        { label: tr("brandSettings", "Brand Settings"), url: createPageUrl("AdminBrandSettings"), icon: Palette, chevron: true },
        { label: tr("subscriptionMode", "Subscription Mode"), url: createPageUrl("Subscriptions"), icon: Banknote, chevron: true },
        { label: tr("bankSettings", "Bank Settings"), url: createPageUrl("AdminBankSettings"), icon: Building, chevron: true },
        { label: tr("chatSettings", "Chat Settings"), url: createPageUrl("AdminChatSettings"), icon: MessageSquare, chevron: true },
        { label: tr("adminClaimRequests", "Claim Requests"), url: createPageUrl("AdminClaimRequests"), icon: FileCheck, chevron: true },
        { label: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon, chevron: true },
        { label: tr("supportInbox", "Support Inbox"), url: withLang("/messages?inbox=support"), icon: Mailbox, chevron: true },
        { label: tr("profileSettings", "Profile Settings"), url: createPageUrl("Profile"), icon: UserCog, chevron: true },
      ]),
    [tr]
  );

  const leftPanelItems = React.useMemo(
    () =>
      dedupeMenuItems([
        { title: tr("userManagement", "User Management"), url: createPageUrl("UserManagement"), icon: Users },
        { title: tr("messages", "Messages"), url: createPageUrl("Messages"), icon: MessageSquare },
        { title: tr("institutionManagement", "Institution Management"), url: createPageUrl("AdminInstitutions"), icon: Landmark },
        { title: tr("adminClaimRequests", "Claim Requests"), url: createPageUrl("AdminClaimRequests"), icon: FileCheck },
        { title: tr("verifications", "Verifications"), url: createPageUrl("Verification"), icon: BadgeCheck },
        { title: tr("paymentVerification", "Payment Verification"), url: createPageUrl("AdminPaymentVerification"), icon: CreditCard },
        { title: tr("paymentMonitoring", "Payment Monitoring"), url: createPageUrl("AdminPayments"), icon: Receipt },
        { title: tr("eventsAdmin", "Event Management"), url: createPageUrl("AdminEvents"), icon: Calendar },
        { title: tr("schoolManagement", "School Management"), url: createPageUrl("AdminSchools"), icon: Building2 },
        { title: tr("reports", "Reports"), url: createPageUrl("AdminReports"), icon: FolderKanban },
        { title: tr("subscriptionMode", "Subscription Mode"), url: createPageUrl("Subscriptions"), icon: Banknote },
        { title: tr("brandSettings", "Brand Settings"), url: createPageUrl("AdminBrandSettings"), icon: Palette },
        { title: tr("chatSettings", "Chat Settings"), url: createPageUrl("AdminChatSettings"), icon: MessageSquare },
        { title: tr("bankSettings", "Bank Settings"), url: createPageUrl("AdminBankSettings"), icon: Building },
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
      ]),
    [tr]
  );

  const LeftPanelLink = ({ item }) => {
    const active = isActive(item.url);
    return (
      <Link
        to={item.url}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
          active ? "bg-green-100 text-green-700" : "text-gray-700 hover:bg-gray-100"
        )}
      >
        <item.icon className={cn("h-5 w-5", active ? "text-green-700" : "text-gray-600")} />
        <span className="text-sm font-medium">{item.title}</span>
      </Link>
    );
  };

  const mobileNav = buildMobileNav(currentUser, false, null, tr);

  return (
    <div className="min-h-[100svh] bg-gray-50 font-sans text-gray-800">
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm"
      >
        <nav className="w-full px-4 sm:px-5 lg:px-7 py-2">
          <div className="relative flex items-center h-12 sm:h-14">
            <div className="flex items-center min-w-0">
              <Link
                to={createPageUrl("Dashboard")}
                className="flex items-center shrink-0"
                aria-label="GreenPass"
                title="GreenPass"
              >
                <img
                  src={getLogoUrl()}
                  alt={`${getCompanyName()} Super App`}
                  className="h-8 sm:h-9 w-auto"
                />
              </Link>
            </div>

            <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 items-center justify-center pointer-events-none">
              <div className="pointer-events-auto w-[620px] md:w-[700px] lg:w-[760px]">
                <div className="flex w-full">
                  {getTopCenterNavItems(tt).map((item) => (
                    <div key={item.url} className="flex-1 flex justify-center">
                      <TopNavIconLink
                        to={item.url}
                        Icon={item.icon}
                        label={item.label}
                        isActive={isActive}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => navigate(createPageUrl("Messages"))}
                className="w-10 h-10 sm:w-11 sm:h-11 inline-flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                aria-label={tt("nav.messages", "Messages")}
                title={tt("nav.messages", "Messages")}
              >
                <MessageSquare className="h-6 w-6" />
              </button>

              <NotificationsBell currentUser={currentUser} createPageUrl={createPageUrl} />

              <AccountDropdown
                currentUser={currentUser}
                open={acctOpen}
                setOpen={setAcctOpen}
                onLogout={onLogout}
                title={tt("nav.accountSettings", "Account Settings")}
                items={accountSettingsItems}
              />
            </div>
          </div>
        </nav>
      </header>

      <div
        className="flex w-full"
        style={{
          paddingTop: headerH,
          visibility: measured ? "visible" : "hidden",
        }}
      >
        <aside className="hidden md:block w-[280px] shrink-0">
          <div className="sticky" style={{ top: headerH }}>
            <div className="h-[calc(100svh-theme(spacing.0))] max-h-[calc(100svh)] overflow-y-auto px-3 py-4">
              <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-2">
                  {tt("nav.admin", "Admin")}
                </div>
                <div className="space-y-1">
                  {leftPanelItems.map((it) => (
                    <LeftPanelLink key={it.url} item={it} />
                  ))}
                </div>

                <div className="mt-3 h-px bg-gray-100" />
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden touch-pan-y pb-[84px] lg:pb-0">
          <div className="px-4 sm:px-6 lg:px-8 py-5">
            <Outlet />
          </div>
        </main>
      </div>

      {!currentUser && <Footer getCompanyName={getCompanyName} />}
      <MobileBottomNav nav={mobileNav} isActive={isActive} />
    </div>
  );
};

/* ---------- Footer ---------- */
const Footer = ({ getCompanyName }) => {
  const { t } = useTranslation();
  const tt = React.useCallback((key, fallback) => safeText(t(key, { defaultValue: fallback }), fallback), [t]);

  const footerLinks = [
    {
      column_title: tt("footer.explore", "Explore"),
      links: [
        { text: tt("nav.directory", "Directory"), url: createPageUrl("Directory") },
        { text: tt("nav.connect", "Connect"), url: createPageUrl("Connect") },
        { text: tt("nav.connections", "Connections"), url: createPageUrl("Connections") },
        { text: tt("nav.events", "Events"), url: createPageUrl("Events") },
      ],
    },
    {
      column_title: tt("footer.account", "Account"),
      links: [
        { text: tt("nav.login", "Login"), url: createPageUrl("Welcome") },
        { text: tt("nav.profile", "Profile"), url: createPageUrl("Profile") },
      ],
    },
    {
      column_title: tt("footer.legal", "Legal"),
      links: [
        { text: tt("footer.policyCenter", "Policy Center"), url: createPageUrl("PolicyCenter") },
        { text: tt("footer.termsOfService", "Terms of Service"), url: createPageUrl("TermsOfService") },
        { text: tt("footer.privacyPolicy", "Privacy Policy"), url: createPageUrl("PrivacyPolicy") },
        { text: tt("footer.communityGuidelines", "Community Guidelines"), url: createPageUrl("CommunityGuidelines") },
        { text: tt("footer.messagingPolicy", "Messaging and Investigation Policy"), url: createPageUrl("MessagingPolicy") },
        { text: tt("footer.verificationPolicy", "Verification Policy"), url: createPageUrl("VerificationPolicy") },
        { text: tt("footer.referralPolicy", "Referral and Invitation Policy"), url: createPageUrl("ReferralPolicy") },
        { text: tt("footer.refundPolicy", "Refund and Payment Review Policy"), url: createPageUrl("RefundPolicy") },
        { text: tt("footer.immigrationDisclaimer", "Immigration and Outcome Disclaimer"), url: createPageUrl("ImmigrationDisclaimer") },
        { text: tt("footer.agentAgreement", "Agent Agreement"), url: createPageUrl("AgentAgreement") },
      ],
    },
  ];

  return (
    <footer className="bg-gray-800 text-white mt-auto">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {footerLinks.map((column, index) => (
            <div key={index}>
              <h3 className="text-sm font-semibold tracking-wider uppercase">{column.column_title}</h3>
              <ul className="mt-4 space-y-4">
                {column.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <Link to={link.url} className="text-base text-gray-300 hover:text-white">
                      {link.text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-gray-700 pt-8 md:flex md:items-center md:justify-between">
          <div className="flex space-x-6 md:order-2">
            {SOCIAL_LINKS.map((social, index) => (
              <a
                key={index}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white"
              >
                <span className="sr-only">{social.platform}</span>
                {iconByPlatform(social.platform)}
              </a>
            ))}
          </div>
          <p className="mt-8 text-base text-gray-400 md:mt-0 md:order-1">
            {tt("footer.copyright", `© ${getCompanyName()}. All rights reserved.`)}
          </p>
        </div>
      </div>
    </footer>
  );
};

/* ---------- Nav builders ---------- */
function buildDesktopNav(currentUser, tr) {
  const role = (currentUser?.user_type || currentUser?.role || "student").toLowerCase();

  if (role === "admin") {
    return dedupeMenuItems([
      { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
      { title: tr("userManagement", "User Management"), url: createPageUrl("UserManagement"), icon: Users },
      { title: tr("messages", "Messages"), url: createPageUrl("Messages"), icon: MessageSquare },
      { title: tr("schoolManagement", "School Management"), url: createPageUrl("AdminSchools"), icon: Building2 },
      { title: tr("institutionManagement", "Institution Management"), url: createPageUrl("AdminInstitutions"), icon: Landmark },
      { title: tr("adminClaimRequests", "Claim Requests"), url: createPageUrl("AdminClaimRequests"), icon: FileCheck },
      { title: tr("verifications", "Verifications"), url: createPageUrl("Verification"), icon: BadgeCheck },
      { title: tr("paymentVerification", "Payment Verification"), url: createPageUrl("AdminPaymentVerification"), icon: CreditCard },
      { title: tr("paymentMonitoring", "Payment Monitoring"), url: createPageUrl("AdminPayments"), icon: Receipt },
      { title: tr("eventsAdmin", "Event Management"), url: createPageUrl("AdminEvents"), icon: Calendar },
      { title: tr("reports", "Reports"), url: createPageUrl("AdminReports"), icon: FolderKanban },
      { title: tr("subscriptionMode", "Subscription Mode"), url: createPageUrl("Subscriptions"), icon: Banknote },
      { title: tr("brandSettings", "Brand Settings"), url: createPageUrl("AdminBrandSettings"), icon: Palette },
      { title: tr("chatSettings", "Chat Settings"), url: createPageUrl("AdminChatSettings"), icon: MessageSquare },
      { title: tr("bankSettings", "Bank Settings"), url: createPageUrl("AdminBankSettings"), icon: Building },
      { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
    ]);
  }

  if (role === "vendor") {
    return dedupeMenuItems([
      { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
      { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
      { title: tr("myServices", "My Services"), url: createPageUrl("MyServices"), icon: Store },
      { title: tr("messages", "Messages"), url: createPageUrl("Messages"), icon: MessageSquare },
      { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
    ]);
  }

  return dedupeMenuItems([
    { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
    { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
    { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
    { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
    { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
  ]);
}

function buildMobileNav(currentUser, hasReservation, latestReservationId, trFn) {
  const tr = typeof trFn === "function" ? trFn : (key, def) => def;
  const role = (currentUser?.user_type || "student").toLowerCase();

  if (role === "agent") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
        { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
        { title: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
        { title: tr("myStudents", "My Students"), url: createPageUrl("MyStudents"), icon: GraduationCap },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  if (role === "tutor") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
        { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
        { title: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
        { title: tr("myStudents", "My Students"), url: createPageUrl("TutorStudents"), icon: GraduationCap },
        { title: tr("planner", "Planner"), url: createPageUrl("Planner"), icon: Calendar },
        { title: tr("policyCenter", "Policy Center"), url: createPageUrl("PolicyCenter"), icon: ShieldCheck },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  if (role === "school") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
        { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
        { title: tr("organization", "Organization"), url: createPageUrl("Organization"), icon: Briefcase },
        { title: tr("schoolProfile", "School Profile"), url: createPageUrl("SchoolProfile"), icon: Building2 },
        { title: tr("schoolDetails", "School Details"), url: createPageUrl("SchoolDetails"), icon: ClipboardList },
        { title: tr("schoolLeads", "School Leads"), url: createPageUrl("SchoolLeads"), icon: Users },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  if (role === "collaborator") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
        { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
        { title: tr("referrals", "Referrals"), url: createPageUrl("Referrals"), icon: Handshake },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  if (role === "admin") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("userManagement", "User Management"), url: createPageUrl("UserManagement"), icon: Users },
        { title: tr("messages", "Messages"), url: createPageUrl("Messages"), icon: MessageSquare },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("eventsAdmin", "Event Management"), url: createPageUrl("AdminEvents"), icon: Calendar },
        { title: tr("schoolManagement", "School Management"), url: createPageUrl("AdminSchools"), icon: Building2 },
        { title: tr("institutionManagement", "Institution Management"), url: createPageUrl("AdminInstitutions"), icon: Landmark },
        { title: tr("adminClaimRequests", "Claim Requests"), url: createPageUrl("AdminClaimRequests"), icon: FileCheck },
        { title: tr("verifications", "Verifications"), url: createPageUrl("Verification"), icon: BadgeCheck },
        { title: tr("paymentVerification", "Payment Verification"), url: createPageUrl("AdminPaymentVerification"), icon: CreditCard },
        { title: tr("paymentMonitoring", "Payment Monitoring"), url: createPageUrl("AdminPayments"), icon: Receipt },
        { title: tr("reports", "Reports"), url: createPageUrl("AdminReports"), icon: FolderKanban },
        { title: tr("subscriptionMode", "Subscription Mode"), url: createPageUrl("Subscriptions"), icon: Banknote },
        { title: tr("brandSettings", "Brand Settings"), url: createPageUrl("AdminBrandSettings"), icon: Palette },
        { title: tr("chatSettings", "Chat Settings"), url: createPageUrl("AdminChatSettings"), icon: MessageSquare },
        { title: tr("bankSettings", "Bank Settings"), url: createPageUrl("AdminBankSettings"), icon: Building },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  if (role === "vendor") {
    return {
      main: [
        { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
        { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
        { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
      ],
      more: dedupeMenuItems([
        { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
        { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
        { title: tr("myServices", "My Services"), url: createPageUrl("MyServices"), icon: Store },
        { title: tr("messages", "Messages"), url: createPageUrl("Messages"), icon: MessageSquare },
        { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
      ]),
    };
  }

  const main = [
    { title: tr("dashboard", "Dashboard"), url: createPageUrl("Dashboard"), icon: Home },
    { title: tr("directory", "Directory"), url: createPageUrl("Directory"), icon: School },
    { title: tr("connect", "Connect"), url: createPageUrl("Connect"), icon: UserPlus },
  ];

  const more = dedupeMenuItems([
    { title: tr("connections", "Connections"), url: createPageUrl("Connections"), icon: UsersIcon },
    { title: tr("events", "Events"), url: createPageUrl("Events"), icon: Calendar },
    { title: tr("tutors", "Tutors"), url: createPageUrl("Tutors"), icon: GraduationCap },
    currentUser?.assigned_agent_id
      ? {
          title: tr("myAgent", "My Agent"),
          url: createPageUrl("MyAgent"),
          icon: Handshake,
        }
      : null,
    { title: tr("profile", "Profile"), url: createPageUrl("Profile"), icon: UserCog },
  ].filter(Boolean));

  if (hasReservation && latestReservationId) {
    more.splice(4, 0, {
      title: tr("seatReservations", "Seat Reservations"),
      url: `${createPageUrl("ReservationStatus")}?reservationId=${encodeURIComponent(latestReservationId)}`,
      icon: Package,
    });
  }

  return { main, more };
}

/* =========================
   MAIN LAYOUT
========================= */
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const tr = useNavTr();
  const isActive = useIsActive();

  const [lang, setLangState] = React.useState(getLang());

  React.useEffect(() => {
    const nextLang =
      new URLSearchParams(location.search).get("lang") ||
      localStorage.getItem("gp_lang") ||
      "en";

    localStorage.setItem("gp_lang", nextLang);
    setLangState(nextLang);

    if (i18n.language !== nextLang) {
      i18n.changeLanguage(nextLang);
    }

    document.documentElement.lang = nextLang;
    document.documentElement.dir =
      ["ar", "he", "fa", "ur"].includes(nextLang) ? "rtl" : "ltr";
  }, [location.search, i18n]);

  const onLangChange = async (e) => {
    const code = e.target.value;
    setLangState(code);
    await setLang(code);
    try {
      await i18n.changeLanguage(code);
    } catch {}

    try {
      const next = new URL(window.location.href);
      next.searchParams.set("lang", code);
      window.history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
    } catch {}
  };

  const [currentUser, setCurrentUser] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const profileUnsubRef = React.useRef(null);
  const [hasReservation, setHasReservation] = React.useState(false);
  const [latestReservationId, setLatestReservationId] = React.useState(null);

  const studentRef =
    new URLSearchParams(location.search).get("student_ref") ||
    (typeof window !== "undefined" ? localStorage.getItem("gp_student_ref") || "" : "");

  React.useEffect(() => {
    if (!studentRef || typeof window === "undefined") return;
    try {
      localStorage.setItem("gp_student_ref", studentRef);
    } catch {}
  }, [studentRef]);

  const normalizeUser = React.useCallback((uid, data = {}, fbUser = {}) => {
    const full_name = data.full_name || data.displayName || fbUser.displayName || data.name || "";
    const user_type = (data.user_type || data.role || "student").toLowerCase();
    const onboarding_completed = data.onboarding_completed ?? data.onboardingComplete ?? false;

    return {
      id: uid,
      ...data,
      full_name,
      user_type,
      onboarding_completed,
      purchased_packages: Array.isArray(data.purchased_packages) ? data.purchased_packages : [],
      settings: data.settings || {},
    };
  }, []);

  React.useEffect(() => {
    setLoading(true);
    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }

      if (!fbUser) {
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      try {
        const ref = doc(db, "users", fbUser.uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          const seed = {
            uid: fbUser.uid,
            full_name: fbUser.displayName || "",
            email: fbUser.email || "",
            user_type: "student",
            onboarding_completed: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await setDoc(ref, seed, { merge: true });
        }

        profileUnsubRef.current = onSnapshot(ref, (docSnap) => {
          const data = docSnap.data() || {};
          const profile = normalizeUser(fbUser.uid, data, fbUser);
          setCurrentUser(profile);
        });
      } catch {
        setCurrentUser({
          id: fbUser.uid,
          user_type: "student",
          full_name: fbUser.displayName || "",
        });
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (profileUnsubRef.current) {
        profileUnsubRef.current();
        profileUnsubRef.current = null;
      }
    };
  }, [normalizeUser]);

  React.useEffect(() => {
    if (!currentUser?.id) {
      setHasReservation(false);
      setLatestReservationId(null);
      return;
    }

    const checkReservations = async () => {
      try {
        const qx = query(
          collection(db, "reservations"),
          where("student_id", "==", currentUser.id),
          limit(1)
        );
        const snap = await getDocs(qx);
        if (!snap.empty) {
          setHasReservation(true);
          setLatestReservationId(snap.docs[0].id);
        } else {
          setHasReservation(false);
          setLatestReservationId(null);
        }
      } catch (err) {
        console.error("[Layout] failed to check reservations:", err);
        setHasReservation(false);
        setLatestReservationId(null);
      }
    };

    checkReservations();
  }, [currentUser?.id]);

  const handleLogout = React.useCallback(async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);

      try {
        const base = getMarketingUrl();
        const u = new URL(base);
        u.searchParams.set("logout", "1");
        window.location.replace(u.toString());
      } catch {
        const base = getMarketingUrl();
        window.location.replace(base + (base.includes("?") ? "&" : "?") + "logout=1");
      }
    } catch {}
  }, []);

  const getLogoUrl = React.useCallback(
    () =>
      "https://firebasestorage.googleapis.com/v0/b/greenpass-dc92d.firebasestorage.app/o/rawdatas%2FGreenPass%20Official.png?alt=media&token=809da08b-22f6-4049-bbbf-9b82342630e8",
    []
  );

  const getCompanyName = React.useCallback(() => "GreenPass", []);

  const supportMessagesUrl =
    currentUser?.user_type === "admin"
      ? withLang("/messages?inbox=support")
      : withLang("/messages?to=support&role=support");

  React.useEffect(() => {
    if (currentUser?.onboarding_completed && location.pathname.toLowerCase().startsWith("/onboarding")) {
      navigate(buildStudentScanUrl(studentRef), { replace: true });
    }
  }, [currentUser?.onboarding_completed, location.pathname, navigate, studentRef]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!currentUser) {
    return <PublicLayout getLogoUrl={getLogoUrl} getCompanyName={getCompanyName} />;
  }

  const pathname = location.pathname.toLowerCase();
  const isOnboardingRoute = pathname.startsWith("/onboarding");
  const isPolicyRoute = [
    createPageUrl("PolicyCenter"),
    createPageUrl("TermsOfService"),
    createPageUrl("PrivacyPolicy"),
    createPageUrl("CommunityGuidelines"),
    createPageUrl("RefundPolicy"),
    createPageUrl("VerificationPolicy"),
    createPageUrl("ReferralPolicy"),
    createPageUrl("MessagingPolicy"),
    createPageUrl("ImmigrationDisclaimer"),
  ].some((route) => pathname === route.toLowerCase());

  const onboardingCompleted =
    currentUser?.onboarding_completed ?? currentUser?.onboardingComplete ?? false;
  const policyCompleted = hasCompletedPolicies(currentUser);

  if (!onboardingCompleted && !isOnboardingRoute) {
    return <Navigate to={appendStudentRefToUrl(createPageUrl("Onboarding"), studentRef)} replace />;
  }

  if (isOnboardingRoute) {
    return (
      <div className="min-h-[100svh] w-full bg-gray-50">
        <main className="max-w-7xl mx-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    );
  }

  if (!policyCompleted && !isPolicyRoute) {
    return <Navigate to={appendStudentRefToUrl(createPageUrl("PolicyCenter"), studentRef)} replace />;
  }

  if (policyCompleted && pathname === createPageUrl("PolicyCenter").toLowerCase()) {
    return <Navigate to={buildStudentScanUrl(studentRef)} replace />;
  }

  if (isPolicyRoute) {
    return (
      <div className="min-h-[100svh] w-full bg-gray-50">
        <main className="max-w-7xl mx-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    );
  }

  const role = (currentUser?.user_type || "student").toLowerCase();

  if (role === "admin") {
    return (
      <AdminAuthedTopNavWithLeftPanelLayout
        currentUser={currentUser}
        getLogoUrl={getLogoUrl}
        getCompanyName={getCompanyName}
        onLogout={handleLogout}
      />
    );
  }

  if (["school", "agent", "tutor", "user", "student", "vendor", "collaborator"].includes(role)) {
    return (
      <AuthenticatedTopNavLayout
        currentUser={currentUser}
        getLogoUrl={getLogoUrl}
        getCompanyName={getCompanyName}
        onLogout={handleLogout}
        mobileNav={buildMobileNav(currentUser, hasReservation, latestReservationId, tr)}
      />
    );
  }

  const navigationItems = buildDesktopNav(currentUser, tr);
  const mobileNav = buildMobileNav(currentUser, hasReservation, latestReservationId, tr);

  return (
    <SidebarProvider>
      <div className="min-h-[100svh] flex w-full bg-gray-50">
        <Sidebar className="border-r border-gray-200 bg-white hidden lg:flex">
          <SidebarHeader className="border-b border-gray-200 p-4">
            <Link
              to={createPageUrl("Dashboard")}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity duration-200"
            >
              <img
                src={getLogoUrl()}
                alt={`${getCompanyName()} Super App`}
                className="h-10 w-auto object-contain"
              />
            </Link>
          </SidebarHeader>

          <SidebarContent className="p-4">
            <SidebarMenu>
              {navigationItems.map((item, index) => {
                const active = location.pathname === item.url || location.pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={index} className="rounded-lg">
                    <Link
                      to={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                        active ? "bg-green-100 text-green-700" : "hover:bg-gray-100 text-gray-700"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="flex-1">{item.title}</span>
                    </Link>
                  </SidebarMenuItem>
                );
              })}

              <SidebarMenuItem className="rounded-lg">
                <Link
                  to={supportMessagesUrl}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700"
                >
                  <Headphones className="w-5 h-5 text-gray-600" />
                  <span className="text-gray-700">{tr("contactSupport", "Contact Support")}</span>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="border-t border-gray-200 p-4">
            <div className="flex items-center gap-3 mb-4 p-2 rounded-lg bg-gray-50">
              <UserAvatar user={currentUser} sizeClass="w-10 h-10" textClass="text-lg" />
              <div className="flex-1 overflow-hidden">
                <p className="font-semibold text-gray-800 truncate text-sm">{currentUser?.full_name}</p>
                <p className="text-xs text-gray-500 capitalize">{currentUser?.user_type}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout} className="text-red-600">
                <LogOut className="w-4 h-4 mr-1" /> {safeText(t("nav.logOut", { defaultValue: "Logout" }), "Logout")}
              </Button>
            </div>

            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {safeText(t("common.language", { defaultValue: "Language" }), "Language")}
              </div>
              <select
                data-testid="lang-select"
                value={lang}
                onChange={onLangChange}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="en">English</option>
                <option value="vi">Tiếng Việt</option>
                <option value="fil">Filipino</option>
                <option value="ceb">Bisaya</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="ar">العربية</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>

            <SidebarMenu>
              <SidebarMenuItem className="rounded-lg">
                <Link
                  to={createPageUrl("Profile")}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700"
                >
                  <UserCog className="w-5 h-5 text-gray-600" />
                  <span className="text-gray-700">{tr("profileSettings", "Profile Settings")}</span>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-h-[100svh]">
          <header className="bg-white/90 backdrop-blur-sm border-b border-gray-200 px-4 py-3 lg:hidden sticky top-0 z-40">
            <div className="flex items-center justify-between">
              <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
                <img src={getLogoUrl()} alt={`${getCompanyName()} Super App`} className="h-8 w-auto object-contain" />
              </Link>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto lg:pb-0 pb-[84px]" style={{ WebkitOverflowScrolling: "touch" }}>
            <Outlet />
          </div>

          <MobileBottomNav nav={mobileNav} isActive={isActive} />
        </main>
      </div>
    </SidebarProvider>
  );
}