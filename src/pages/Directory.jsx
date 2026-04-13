// src/pages/Directory.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  MapPin,
  Star,
  Globe,
  Loader2,
  Award,
  Users,
  Mail,
  LogIn,
  UserPlus,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Chrome,
  Apple,
  ShieldCheck,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import CountrySelector from "@/components/CountrySelector";
import { getProvinceLabel } from "../components/utils/CanadianProvinces";
import { createPageUrl } from "@/utils";
import _ from "lodash";

// Firebase
import { db, auth } from "@/firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  addDoc,
  query,
  where,
  limit,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  signOut,
  deleteUser,
} from "firebase/auth";

// shadcn dialog
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const PAGE_SIZE = 16;
const CLAIM_REQUESTS_COLL = "institution_claim_requests";

/* -----------------------------
   Subscription helper
----------------------------- */
function hasActiveSubscription(userDoc) {
  const d = userDoc || {};
  if (typeof d.subscription_active === "boolean") {
    return d.subscription_active === true;
  }
  const status = String(d.subscription_status || "").toLowerCase().trim();
  return status === "active";
}

/* -----------------------------
   Country flag helpers
----------------------------- */
const isIso2 = (code) => /^[A-Z]{2}$/.test((code || "").trim().toUpperCase());

const codeToFlagEmoji = (code) => {
  const cc = (code || "").trim().toUpperCase();
  if (!isIso2(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
};

const flagPngUrl = (code) => {
  const cc = (code || "").trim().toUpperCase();
  if (!isIso2(cc)) return "";
  return `https://flagcdn.com/w40/${cc.toLowerCase()}.png`;
};

const flagCoverPngUrl = (code) => {
  const cc = String(code || "").trim().toUpperCase();
  if (!isIso2(cc)) return "";
  return `https://flagcdn.com/w640/${cc.toLowerCase()}.png`;
};

function CountryFlag({ code, className = "" }) {
  const cc = (code || "").trim().toUpperCase();
  const [imgOk, setImgOk] = useState(true);

  const url = useMemo(() => flagPngUrl(cc), [cc]);
  const emoji = useMemo(() => codeToFlagEmoji(cc), [cc]);

  if (!isIso2(cc)) return null;

  if (!url || !imgOk) {
    return emoji ? (
      <span className={["text-base leading-none", className].join(" ")} title={cc}>
        {emoji}
      </span>
    ) : null;
  }

  return (
    <img
      src={url}
      alt={`${cc} flag`}
      className={["h-4 w-6 rounded-sm border object-cover", className].join(" ")}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImgOk(false)}
    />
  );
}

/* -----------------------------
   Helpers
----------------------------- */
const normText = (v = "") => String(v || "").trim().toLowerCase();
const eqText = (a, b) => normText(a) === normText(b);

const canonCountry = (v = "") => {
  const x = String(v || "").trim();
  const lx = x.toLowerCase();
  if (["united states", "united states of america", "usa", "us"].includes(lx)) return "US";
  if (["united kingdom", "great britain", "britain", "england", "uk"].includes(lx)) return "UK";
  if (lx === "canada") return "Canada";
  if (lx === "australia") return "Australia";
  if (lx === "ireland") return "Ireland";
  if (lx === "germany") return "Germany";
  if (lx === "new zealand" || lx === "nz") return "New Zealand";
  return x;
};

function normalizeRole(r) {
  const v = String(r || "").toLowerCase().trim();
  if (v === "student") return "user";
  if (v === "users") return "user";
  if (v === "tutors") return "tutor";
  if (v === "agents") return "agent";
  if (["user", "agent", "tutor", "school", "admin", "vendor", "support", "collaborator"].includes(v)) {
    return v;
  }
  return "";
}

function isInstitutionPublicReady(inst) {
  const status = String(inst?.status || "").toLowerCase().trim();
  const visibility = String(inst?.visibility || "").toLowerCase().trim();
  const isHidden = inst?.hidden === true || inst?.is_hidden === true || visibility === "hidden";

  if (isHidden) return false;
  if (!status) return true;
  return ["active", "published", "public", "verified", "claimed", "unclaimed"].includes(status);
}

function isInstitutionClaimed(inst) {
  return !!String(inst?.user_id || "").trim();
}

/* -----------------------------
   Skeletons
----------------------------- */
const SkeletonGridCard = () => (
  <div className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm animate-pulse">
    <div className="h-20 bg-gray-200" />
    <div className="px-4 pb-4">
      <div className="-mt-10 flex justify-center">
        <div className="h-20 w-20 rounded-full bg-gray-200 border-4 border-white" />
      </div>
      <div className="mt-3 flex justify-center">
        <div className="h-4 w-2/3 bg-gray-200 rounded" />
      </div>
      <div className="mt-2 flex justify-center">
        <div className="h-3 w-4/5 bg-gray-200 rounded" />
      </div>
      <div className="mt-4 flex justify-center">
        <div className="h-3 w-1/2 bg-gray-200 rounded" />
      </div>
      <div className="mt-4 flex justify-center">
        <div className="h-9 w-2/3 bg-gray-200 rounded-full" />
      </div>
    </div>
  </div>
);

const SkeletonDetailsPanel = () => (
  <Card className="h-[70vh] flex flex-col overflow-hidden animate-pulse">
    <div className="h-56 bg-gray-200" />
    <CardContent className="p-6 flex-1 overflow-auto">
      <div className="h-5 w-24 bg-gray-200 rounded" />
      <div className="mt-3 h-7 w-3/4 bg-gray-200 rounded" />
      <div className="mt-3 h-4 w-1/2 bg-gray-200 rounded" />
      <div className="mt-6 h-11 w-full bg-gray-200 rounded" />
      <div className="mt-6 h-4 w-32 bg-gray-200 rounded" />
      <div className="mt-3 space-y-2">
        <div className="h-3 w-full bg-gray-200 rounded" />
        <div className="h-3 w-11/12 bg-gray-200 rounded" />
        <div className="h-3 w-10/12 bg-gray-200 rounded" />
      </div>
      <div className="mt-6 h-11 w-full bg-gray-200 rounded" />
    </CardContent>
  </Card>
);

/* -----------------------------
   Carousel helpers
----------------------------- */
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const uniqStrings = (arr) => {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const s = typeof x === "string" ? x.trim() : "";
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const getSchoolImageList = (item) => {
  const fallback =
    "https://images.unsplash.com/photo-1562774053-701939374585?w=1200&h=600&fit=crop&q=80";
  if (!item) return [fallback];

  const candidates = [
    item.bannerUrl,
    item.banner,
    item.cover_photo,
    item.coverPhoto,
    item.school_image_url,
    item.institution_logo_url,
    item.logoUrl,
    ...asArray(item.images),
    ...asArray(item.imageUrls),
    ...asArray(item.photos),
    ...asArray(item.gallery),
    ...asArray(item.gallery_images),
    ...asArray(item.school_images),
    ...asArray(item.campus_images),
  ];

  const list = uniqStrings(candidates);
  return list.length ? list : [fallback];
};

/* -----------------------------
   School details panel
----------------------------- */
const SchoolDetailsPanel = ({
  item,
  onContactClick,
  onClaimClick,
  claimSubmitting = false,
  claimMessage = "",
  programs = [],
  onProgramClick,
  tr,
  currentUserRole = "",
}) => {
  const [showPrograms, setShowPrograms] = useState(false);
  const [imgIndex, setImgIndex] = useState(0);

  const images = useMemo(() => getSchoolImageList(item), [item]);
  const hasMany = images.length > 1;

  useEffect(() => {
    setShowPrograms(false);
    setImgIndex(0);
  }, [item?.id, item?.school_key, item?.school_id, item?.institution_id]);

  const goPrev = useCallback(() => {
    setImgIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  const goNext = useCallback(() => {
    setImgIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  if (!item) {
    return (
      <Card className="h-full">
        <CardContent className="p-6 text-gray-600">
          {tr?.("directory.school.select_school", "Select a school from the list to see details.")}
        </CardContent>
      </Card>
    );
  }

  const name =
    item.name ||
    item.school_name ||
    item.institution_name ||
    tr?.("directory.common.unknown", "Unknown");

  const city = item.city || item.school_city || "—";
  const province = getProvinceLabel(item.province || item.school_province) || "—";
  const country = item.country || item.school_country || "—";

  const list = Array.isArray(programs) ? programs : [];
  const hasPrograms = list.length > 0;
  const canClaimFromDirectory = currentUserRole === "school" && !isInstitutionClaimed(item);

  const getProgramTitle = (p) =>
    p?.program_title || p?.programTitle || p?.title || p?.name || "Untitled program";

  const getProgramMeta = (p) => {
    const level = p?.program_level || p?.level || p?.programLevel;
    const duration = p?.duration || p?.program_duration;
    const intake = p?.next_intake || p?.intake || p?.nextIntake;
    const parts = [level, duration, intake].filter(Boolean);
    return parts.join(" • ");
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardContent className="p-0">
        <div className="relative h-56 bg-gradient-to-br from-blue-100 to-green-100">
          <img
            src={images[imgIndex]}
            alt={name}
            className="w-full h-full object-cover"
            loading="lazy"
          />

          <div className="absolute top-4 left-4 flex gap-2">
            {item.isDLI && (
              <Badge className="bg-green-600 text-white">
                <Award className="w-3 h-3 mr-1" />
                DLI
              </Badge>
            )}
            {item.isFeatured && (
              <Badge className="bg-yellow-500 text-white">
                <Star className="w-3 h-3 mr-1" />
                Featured
              </Badge>
            )}
            {!isInstitutionClaimed(item) ? (
              <Badge className="bg-blue-600 text-white">Unclaimed</Badge>
            ) : null}
          </div>

          {hasMany ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={goNext}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white"
                aria-label="Next image"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                {images.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setImgIndex(idx)}
                    className={[
                      "h-2 w-2 rounded-full transition",
                      idx === imgIndex ? "bg-white" : "bg-white/50 hover:bg-white/80",
                    ].join(" ")}
                    aria-label={`Go to image ${idx + 1}`}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-2">
                {item.institution_type || tr?.("directory.tabs.school", "School")}
              </Badge>

              <h2 className="text-2xl font-bold text-gray-900">{name}</h2>

              <div className="mt-2 flex items-center text-gray-600">
                <MapPin className="w-4 h-4 mr-1" />
                <span className="text-sm">
                  {city}, {province}, {country}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <Button className="w-full h-11 text-base" onClick={() => onContactClick?.(item)}>
                  <Mail className="w-4 h-4 mr-2" />
                  {tr?.("directory.school.contact", "Contact Us")}
                </Button>

                {canClaimFromDirectory ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-11 text-base"
                    onClick={() => onClaimClick?.(item)}
                    disabled={claimSubmitting}
                  >
                    {claimSubmitting ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 mr-2" />
                    )}
                    {tr?.("directory.school.claim_profile", "Claim this profile")}
                  </Button>
                ) : null}

                {claimMessage ? (
                  <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    {claimMessage}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="text-sm text-blue-600 underline hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setShowPrograms((v) => !v)}
                  disabled={!hasPrograms}
                  title={
                    !hasPrograms
                      ? tr?.("directory.school.no_programs", "No programs available for this school yet.")
                      : undefined
                  }
                >
                  {showPrograms
                    ? tr?.("directory.school.hide_programs", "Hide programs -")
                    : tr?.("directory.school.view_programs", "View programs +")}
                </button>
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="text-sm text-gray-500">{tr?.("directory.school.programs", "Programs")}</p>
              <p className="text-2xl font-bold text-blue-600">{item.programCount || 0}+</p>
            </div>
          </div>

          {showPrograms && (
            <div className="mt-5 border rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 font-semibold text-gray-900 flex items-center justify-between">
                <span>{tr?.("directory.school.programs", "Programs")}</span>
                <Badge variant="secondary">{list.length}</Badge>
              </div>

              <div className="max-h-72 overflow-auto divide-y">
                {list.map((p, idx) => {
                  const title = getProgramTitle(p);
                  const meta = getProgramMeta(p);
                  return (
                    <button
                      key={p?.id || p?.program_id || `${title}-${idx}`}
                      type="button"
                      onClick={() => onProgramClick?.(p, item)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-400"
                    >
                      <div className="text-sm font-medium text-gray-900">{title}</div>
                      {meta ? <div className="text-xs text-gray-500 mt-1">{meta}</div> : null}
                      <div className="text-xs text-blue-600 underline mt-2">
                        {tr?.("directory.common.open", "Open")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {item.about && (
            <div className="mt-6">
              <h3 className="font-semibold text-gray-900 mb-2">
                {tr?.("directory.school.overview", "Overview")}
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.about}</p>
            </div>
          )}

          {item.website && (
            <div className="mt-6">
              <a href={item.website} target="_blank" rel="noopener noreferrer" className="block">
                <Button variant="outline" className="w-full h-11 text-base">
                  <Globe className="w-4 h-4 mr-2" />
                  {tr?.("directory.school.visit_website", "Visit Website")}
                </Button>
              </a>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/* -----------------------------
   School grid card
----------------------------- */
const DirectoryGridCard = ({ item, onOpenDetails, tr }) => {
  const name =
    item.name ||
    item.school_name ||
    item.institution_name ||
    tr?.("directory.common.unknown", "Unknown");

  const country = item.country || item.school_country || "—";
  const countryCodeRaw = item.country_code || item.countryCode || item.iso2 || "";
  const countryCode = String(countryCodeRaw || "").trim().toUpperCase();

  const coverUrl = flagCoverPngUrl(countryCode);

  const avatar =
    item.logoUrl ||
    item.school_image_url ||
    item.institution_logo_url ||
    "https://images.unsplash.com/photo-1562774053-701939374585?w=256&h=256&fit=crop&q=80";

  const basicInfo = `${item.city || tr?.("directory.common.city", "City")}, ${
    getProvinceLabel(item.province || item.school_province) ||
    tr?.("directory.common.province", "Province")
  }`;

  const isVerified = !!(
    item?.is_verified === true ||
    item?.verified === true ||
    String(item?.verification_status || "").toLowerCase() === "verified" ||
    String(item?.kyc_status || "").toLowerCase() === "verified"
  );

  const showUnclaimed = !isInstitutionClaimed(item);

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className="group w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
    >
      <div className="relative h-20 w-full bg-gray-100">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <div className="absolute inset-0 bg-black/10" />
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-10 flex justify-center">
          <div className="h-20 w-20 overflow-hidden rounded-full border-4 border-white bg-gray-100 shadow-sm">
            <img
              src={avatar}
              alt={name}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>

        <div className="mt-2 text-center">
          <div className="flex items-center justify-center gap-1 flex-wrap">
            <div className="max-w-[240px] truncate text-base font-semibold text-gray-900">
              {name}
            </div>
            {isVerified ? <Award className="h-4 w-4 text-emerald-600" /> : null}
            {showUnclaimed ? (
              <Badge className="bg-blue-100 text-blue-800 border-blue-200">Unclaimed</Badge>
            ) : null}
          </div>

          <div className="mt-1 line-clamp-2 text-sm text-gray-600">{basicInfo}</div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-600">
          <MapPin className="h-3.5 w-3.5" />
          <CountryFlag code={countryCode} />
          <span className="truncate">{country}</span>
        </div>

        <div className="mt-4 flex items-center justify-center">
          <span className="rounded-full border border-blue-500 px-6 py-2 text-sm font-semibold text-blue-600 group-hover:bg-blue-50">
            {tr?.("directory.school.contact_us", "Contact Us")}
          </span>
        </div>
      </div>
    </button>
  );
};

export default function Directory() {
  const { t } = useTranslation();
  const tr = React.useCallback(
    (key, def, vars = undefined) => t(key, { defaultValue: def, ...(vars || {}) }),
    [t]
  );

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const schoolsLoadedRef = useRef(false);

  const [allSchools, setAllSchools] = useState([]);
  const [allInstitutions, setAllInstitutions] = useState([]);
  const [filteredSchools, setFilteredSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [loadingPrograms, setLoadingPrograms] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [selectedCity, setSelectedCity] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserDoc, setCurrentUserDoc] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState("");

  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [forceStudentSignup, setForceStudentSignup] = useState(false);
  const [authStep, setAuthStep] = useState("choice");
  const [pendingAction, setPendingAction] = useState(null);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginShowPw, setLoginShowPw] = useState(false);

  const [signupRole, setSignupRole] = useState("user");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPassword2, setSignupPassword2] = useState("");
  const [signupShowPw, setSignupShowPw] = useState(false);

  const [oauthUser, setOauthUser] = useState(null);
  const [oauthName, setOauthName] = useState("");

  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

  const detectRoleFromUserDoc = useCallback(
    (data) =>
      normalizeRole(
        data?.role || data?.selected_role || data?.user_type || data?.userType || ""
      ),
    []
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setCurrentUser(u || null);

      if (!u?.uid) {
        setCurrentUserDoc(null);
        setCurrentUserRole("");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? snap.data() : {};
        const full = { id: u.uid, uid: u.uid, ...(data || {}) };
        setCurrentUserDoc(full);
        setCurrentUserRole(detectRoleFromUserDoc(full) || "");
      } catch (e) {
        console.error("Failed to load user doc:", e);
        setCurrentUserDoc(null);
        setCurrentUserRole("");
      }
    });

    return () => unsub();
  }, [detectRoleFromUserDoc]);

  useEffect(() => {
    const p = parseInt(searchParams.get("page") || "1", 10);
    setPage(Number.isFinite(p) && p > 0 ? p : 1);
  }, [searchParams]);

  useEffect(() => {
    if (!authDialogOpen) return;
    if (forceStudentSignup && authStep === "role") {
      setSignupRole("user");
      setAuthStep("signup_method");
    }
  }, [authDialogOpen, forceStudentSignup, authStep]);

  const updatePage = useCallback(
    (nextPage) => {
      setPage(nextPage);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextPage > 1) next.set("page", String(nextPage));
          else next.delete("page");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const loadSchoolData = useCallback(async () => {
    setLoadingSchools(true);
    setLoadingPrograms(true);

    const instRef = collection(db, "institutions");
    const progRef = collection(db, "schools");

    try {
      const instSnap = await getDocs(instRef);
      const institutionsData = instSnap.docs
        .map((d) => ({
          id: d.id,
          ...((d.data && d.data()) || {}),
        }))
        .filter((inst) => isInstitutionPublicReady(inst));

      setAllInstitutions(institutionsData || []);
    } catch (error) {
      console.error("Error loading institutions:", error);
      setAllInstitutions([]);
    } finally {
      setLoadingSchools(false);
    }

    try {
      const progSnap = await getDocs(progRef);
      const programsData = progSnap.docs.map((d) => ({
        id: d.id,
        ...((d.data && d.data()) || {}),
      }));
      setAllSchools(programsData || []);
    } catch (error) {
      console.error("Error loading programs:", error);
      setAllSchools([]);
    } finally {
      setLoadingPrograms(false);
    }
  }, []);

  useEffect(() => {
    if (schoolsLoadedRef.current) return;
    schoolsLoadedRef.current = true;
    loadSchoolData();
  }, [loadSchoolData]);

  const programsBySchoolKey = useMemo(() => {
    return _.groupBy(
      allSchools || [],
      (p) =>
        String(p.school_id || p.institution_id || p.schoolId || "").trim() || "__unlinked__"
    );
  }, [allSchools]);

  const mergedSchools = useMemo(() => {
    return (allInstitutions || []).map((inst) => {
      const key =
        String(inst.id || inst.docId || inst.uid || "").trim() ||
        String(inst.name || "").trim();
      const programs = (programsBySchoolKey && programsBySchoolKey[key]) || [];

      return {
        ...inst,
        school_key: key,
        isInstitution: true,
        programCount: programs.length,
        logoUrl:
          inst.logoUrl ||
          inst.logo ||
          inst.institution_logo_url ||
          inst.image_url ||
          inst.photo_url ||
          null,
        website: inst.website || inst.site || inst.url || null,
        about: inst.about || inst.description || inst.overview || null,
        institution_type: inst.type || inst.institution_type || null,
        city: inst.city || inst.school_city || inst.location_city || null,
        province: inst.province || inst.state || inst.region || null,
        country: inst.country || inst.country_code || inst.school_country || null,
      };
    });
  }, [allInstitutions, programsBySchoolKey]);

  const schoolCountryOptions = useMemo(() => {
    const raw = (mergedSchools || [])
      .map((s) => s.country || s.school_country || s.country_code)
      .filter(Boolean);
    const priority = [
      "Canada",
      "US",
      "UK",
      "Australia",
      "Ireland",
      "Germany",
      "New Zealand",
    ];
    return Array.from(new Set([...raw.map(canonCountry), ...priority]));
  }, [mergedSchools]);

  const handleSearchChange = useCallback(
    (e) => {
      e.preventDefault();
      setSearchTerm(e.target.value);
      updatePage(1);
    },
    [updatePage]
  );

  const handleCountryChange = useCallback(
    (value) => {
      setSelectedCountry(value);
      setSelectedCity("all");
      updatePage(1);
    },
    [updatePage]
  );

  const schoolCityGroups = useMemo(() => {
    const map = new Map();

    (mergedSchools || []).forEach((s) => {
      const city = String(s.city || "").trim();
      if (!city) return;

      const country = canonCountry(s.country || s.country_code || s.school_country || "");

      if (selectedCountry && selectedCountry !== "all") {
        if (canonCountry(selectedCountry) !== country) return;
      }

      if (!map.has(country)) map.set(country, new Set());
      map.get(country).add(city);
    });

    return Array.from(map.entries())
      .map(([country, set]) => ({
        country,
        cities: Array.from(set).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [mergedSchools, selectedCountry]);

  useEffect(() => {
    let filtered = mergedSchools;

    if (searchTerm) {
      const q = searchTerm.toLowerCase().trim();
      filtered = filtered.filter((school) => {
        const name = (
          school.name ||
          school.school_name ||
          school.institution_name ||
          ""
        ).toLowerCase();
        const city = (school.city || school.school_city || "").toLowerCase();
        const about = (school.about || "").toLowerCase();

        const programHit = (programsBySchoolKey?.[school.school_key] || []).some((p) => {
          const title = (p.program_title || p.title || p.name || "").toLowerCase();
          return title.includes(q);
        });

        return name.includes(q) || city.includes(q) || about.includes(q) || programHit;
      });
    }

    if (selectedCountry !== "all") {
      filtered = filtered.filter(
        (s) =>
          canonCountry(s.country || s.country_code || s.school_country) ===
          canonCountry(selectedCountry)
      );
    }

    if (selectedCity !== "all") {
      const cityOnly = String(selectedCity).includes("::")
        ? String(selectedCity).split("::")[1]
        : selectedCity;
      filtered = filtered.filter((s) => eqText(s.city || s.school_city, cityOnly));
    }

    setFilteredSchools(filtered);
  }, [mergedSchools, programsBySchoolKey, searchTerm, selectedCountry, selectedCity]);

  const totalCount = filteredSchools.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) updatePage(totalPages);
    if (page < 1) updatePage(1);
  }, [page, totalPages, updatePage]);

  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);

  const pagedItems = useMemo(() => {
    return filteredSchools.slice(startIndex, endIndex);
  }, [filteredSchools, startIndex, endIndex]);

  useEffect(() => {
    if (!pagedItems.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey) {
      setSelectedKey(pagedItems[0].school_key || pagedItems[0].id);
      return;
    }
    const stillOnPage = pagedItems.some((s) => (s.school_key || s.id) === selectedKey);
    if (!stillOnPage) setSelectedKey(pagedItems[0].school_key || pagedItems[0].id);
  }, [pagedItems, selectedKey]);

  const selectedItem = useMemo(() => {
    if (!selectedKey) return null;
    return filteredSchools.find((s) => (s.school_key || s.id) === selectedKey) || null;
  }, [filteredSchools, selectedKey]);

  const selectedPrograms = useMemo(() => {
    if (!selectedItem) return [];
    const k =
      selectedItem.school_key ||
      selectedItem.name ||
      selectedItem.school_name ||
      selectedItem.institution_name;
    return programsBySchoolKey[k] || [];
  }, [selectedItem, programsBySchoolKey]);

  const getPageNumbers = (current, total) => {
    const pages = [];
    const add = (x) => pages.push(x);
    const windowSize = 1;

    if (total <= 7) {
      for (let i = 1; i <= total; i++) add(i);
      return pages;
    }

    add(1);
    if (current - windowSize > 2) add("…");
    for (
      let i = Math.max(2, current - windowSize);
      i <= Math.min(total - 1, current + windowSize);
      i++
    ) {
      add(i);
    }
    if (current + windowSize < total - 1) add("…");
    add(total);
    return pages;
  };

  const pageNumbers = getPageNumbers(page, totalPages);

  const clearAllFilters = useCallback(
    (e) => {
      e.preventDefault();
      setSearchTerm("");
      setSelectedCountry("all");
      setSelectedCity("all");
      updatePage(1);
    },
    [updatePage]
  );

  const myRole = useMemo(() => {
    return normalizeRole(
      currentUserDoc?.role ||
        currentUserDoc?.selected_role ||
        currentUserDoc?.user_type ||
        currentUserDoc?.userType ||
        ""
    );
  }, [currentUserDoc]);

  const navToMessages = useCallback(
    ({ studentId, targetId, targetRole }) => {
      const qs = new URLSearchParams();
      if (targetId) qs.set("to", String(targetId));
      if (targetRole) {
        const r = String(targetRole);
        qs.set("role", r === "user" ? "student" : r);
      }
      const url = `/messages?${qs.toString()}`;

      navigate(url, {
        state: {
          studentId,
          targetId,
          targetRole,
          source: "directory",
        },
      });
    },
    [navigate]
  );

  const onContactSchool = useCallback(
    (schoolItem) => {
      const uid = currentUser?.uid;
      if (!uid) return;

      const norm = myRole;
      const supportTarget = { targetId: "support", targetRole: "support" };

      if (norm === "user") {
        const assignedAgent = String(
          currentUserDoc?.assigned_agent_id ||
            currentUserDoc?.assignedAgentId ||
            currentUserDoc?.assigned_agent ||
            ""
        ).trim();

        if (assignedAgent) {
          navToMessages({
            studentId: uid,
            targetId: assignedAgent,
            targetRole: "agent",
          });
          return;
        }

        navToMessages({ studentId: uid, ...supportTarget });
        return;
      }

      navToMessages({ studentId: uid, ...supportTarget });
    },
    [currentUser?.uid, currentUserDoc, myRole, navToMessages]
  );

  const resetAuthForm = useCallback(() => {
    setAuthError("");
    setAuthLoading(false);

    setLoginEmail("");
    setLoginPassword("");
    setLoginShowPw(false);

    setSignupRole("user");
    setSignupName("");
    setSignupEmail("");
    setSignupPassword("");
    setSignupPassword2("");
    setSignupShowPw(false);

    setOauthUser(null);
    setOauthName("");
  }, []);

  const openAuthDialog = useCallback(
    (action, options = {}) => {
      const forceStudent = !!options.forceStudent;

      setPendingAction(action || null);
      setAuthStep("choice");
      resetAuthForm();

      setForceStudentSignup(forceStudent);
      if (forceStudent) setSignupRole("user");

      setAuthDialogOpen(true);
    },
    [resetAuthForm]
  );

  const afterAuthSuccess = useCallback(
    async (opts = {}) => {
      const onboardingRole = opts?.onboardingRole;

      setAuthDialogOpen(false);
      setAuthStep("choice");
      setAuthError("");
      setAuthLoading(false);

      if (onboardingRole) {
        navigate(`/onboarding?role=${encodeURIComponent(String(onboardingRole))}`, {
          replace: true,
        });
        setPendingAction(null);
        return;
      }

      if (pendingAction?.type === "navigate" && pendingAction?.url) {
        navigate(pendingAction.url, { state: pendingAction?.state || {} });
      } else if (pendingAction?.type === "contact" && pendingAction?.schoolItem) {
        onContactSchool(pendingAction.schoolItem);
      } else if (pendingAction?.type === "claim" && pendingAction?.item) {
        setSelectedKey(pendingAction.item.school_key || pendingAction.item.id);
        setDetailsOpen(true);
      }

      setPendingAction(null);
    },
    [navigate, onContactSchool, pendingAction]
  );

  const handleLogin = useCallback(async () => {
    setAuthError("");
    setAuthLoading(true);
    try {
      const email = (loginEmail || "").trim();
      if (!email || !loginPassword) {
        throw new Error("Please enter your email and password.");
      }
      await signInWithEmailAndPassword(auth, email, loginPassword);
      await afterAuthSuccess();
    } catch (e) {
      setAuthError(e?.message || "Login failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }, [afterAuthSuccess, loginEmail, loginPassword]);

  const handleSignupEmail = useCallback(async () => {
    setAuthError("");
    setAuthLoading(true);
    try {
      const email = (signupEmail || "").trim();
      const name = (signupName || "").trim();

      if (!signupRole) throw new Error("Please select a role.");
      if (!email) throw new Error("Please enter your email.");
      if (!signupPassword) throw new Error("Please enter a password.");
      if (signupPassword.length < 6) throw new Error("Password must be at least 6 characters.");
      if (signupPassword !== signupPassword2) throw new Error("Passwords do not match.");

      const cred = await createUserWithEmailAndPassword(auth, email, signupPassword);

      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }

      await setDoc(
        doc(db, "users", cred.user.uid),
        {
          uid: cred.user.uid,
          email,
          full_name: name || "",
          user_type: signupRole,
          userType: signupRole,
          role: signupRole,
          selected_role: signupRole,
          created_at: serverTimestamp(),
          createdAt: Date.now(),
        },
        { merge: true }
      );

      await afterAuthSuccess({ onboardingRole: signupRole });
    } catch (e) {
      setAuthError(e?.message || "Sign up failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }, [
    afterAuthSuccess,
    signupEmail,
    signupName,
    signupPassword,
    signupPassword2,
    signupRole,
  ]);

  const ensureBasicUserDoc = useCallback(async (fbUser) => {
    if (!fbUser?.uid) return;
    const ref = doc(db, "users", fbUser.uid);
    await setDoc(
      ref,
      {
        uid: fbUser.uid,
        email: fbUser.email || "",
        full_name: fbUser.displayName || "",
        updated_at: serverTimestamp(),
        createdAt: Date.now(),
      },
      { merge: true }
    );
  }, []);

  const isValidRole = (r) =>
    ["user", "agent", "tutor", "school"].includes(String(r || "").toLowerCase().trim());

  const handleOAuthSignIn = useCallback(
    async (providerKey, intent = "login") => {
      setAuthError("");
      setAuthLoading(true);

      try {
        let provider = null;

        if (providerKey === "google") {
          provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
        } else if (providerKey === "apple") {
          provider = new OAuthProvider("apple.com");
          provider.addScope("email");
          provider.addScope("name");
        } else {
          throw new Error("Unsupported provider.");
        }

        if (intent === "signup") {
          const role = String(signupRole || "").toLowerCase().trim();
          if (!isValidRole(role)) {
            setAuthError("Please select a valid role.");
            setAuthStep("role");
            return;
          }
        }

        const res = await signInWithPopup(auth, provider);
        const fbUser = res?.user;
        if (!fbUser?.uid) throw new Error("Authentication failed. Please try again.");

        const info = getAdditionalUserInfo(res);
        const isNewUser = !!info?.isNewUser;

        const userRef = doc(db, "users", fbUser.uid);
        const snap = await getDoc(userRef);
        const existsInDb = snap.exists();
        const existing = existsInDb ? snap.data() || {} : null;
        const roleInDoc = detectRoleFromUserDoc(existing || {});

        if (intent === "login") {
          if (!existsInDb || isNewUser) {
            try {
              if (isNewUser) await deleteUser(fbUser);
            } catch {}
            try {
              await signOut(auth);
            } catch {}

            setAuthError("No account exists for this Google/Apple email. Please sign up first.");
            if (forceStudentSignup) {
              setSignupRole("user");
              setAuthStep("signup_method");
            } else {
              setAuthStep("role");
            }
            return;
          }

          await afterAuthSuccess();
          return;
        }

        const role = String(signupRole || "").toLowerCase().trim();

        if (existsInDb && roleInDoc) {
          try {
            await signOut(auth);
          } catch {}
          setAuthError("This Google/Apple account already has an account. Please log in instead.");
          setAuthStep("login");
          return;
        }

        await ensureBasicUserDoc(fbUser);

        const fullName = (fbUser.displayName || existing?.full_name || "").trim();
        const email = (fbUser.email || existing?.email || "").trim();

        if (fullName) {
          await setDoc(
            doc(db, "users", fbUser.uid),
            {
              uid: fbUser.uid,
              email,
              full_name: fullName,
              user_type: role,
              userType: role,
              role,
              selected_role: role,
              updated_at: serverTimestamp(),
              created_at: serverTimestamp(),
              createdAt: Date.now(),
            },
            { merge: true }
          );

          await afterAuthSuccess({ onboardingRole: role });
          return;
        }

        setOauthUser({
          uid: fbUser.uid,
          email,
          full_name: fullName,
        });
        setOauthName(fullName);
        setAuthStep("oauth_finish");
      } catch (e) {
        console.error(e);
        setAuthError(e?.message || "OAuth sign in failed. Please try again.");
      } finally {
        setAuthLoading(false);
      }
    },
    [
      afterAuthSuccess,
      detectRoleFromUserDoc,
      ensureBasicUserDoc,
      forceStudentSignup,
      signupRole,
    ]
  );

  const handleOAuthComplete = useCallback(async () => {
    setAuthError("");
    setAuthLoading(true);

    try {
      if (!oauthUser?.uid) throw new Error("Missing user session. Please try again.");

      const role = String(signupRole).toLowerCase().trim();
      if (!["user", "agent", "tutor", "school"].includes(role)) {
        throw new Error("Invalid role.");
      }

      const name = (oauthName || "").trim();
      if (!name) throw new Error("Please enter your full name to continue.");

      if (auth.currentUser?.uid === oauthUser.uid && name && !auth.currentUser.displayName) {
        try {
          await updateProfile(auth.currentUser, { displayName: name });
        } catch {}
      }

      await setDoc(
        doc(db, "users", oauthUser.uid),
        {
          uid: oauthUser.uid,
          email: oauthUser.email || auth.currentUser?.email || "",
          full_name: name || oauthUser.full_name || auth.currentUser?.displayName || "",
          user_type: role,
          userType: role,
          role,
          selected_role: role,
          updated_at: serverTimestamp(),
          created_at: serverTimestamp(),
          createdAt: Date.now(),
        },
        { merge: true }
      );

      await afterAuthSuccess({ onboardingRole: role });
    } catch (e) {
      setAuthError(e?.message || "Could not finish setup. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }, [afterAuthSuccess, oauthName, oauthUser, signupRole]);

  const onProgramClick = useCallback(
    (program, schoolItem) => {
      const programId = String(
        program?.id || program?.program_id || program?.programId || ""
      ).trim();

      const schoolId = String(
        schoolItem?.id ||
          schoolItem?.school_key ||
          schoolItem?.school_id ||
          schoolItem?.institution_id ||
          program?.school_id ||
          program?.schoolId ||
          program?.institution_id ||
          ""
      ).trim();

      if (!programId) return;

      const params = new URLSearchParams();
      params.set("programId", programId);
      if (schoolId) params.set("schoolId", schoolId);

      const base = createPageUrl("ProgramDetails");
      const url = `${base}${base.includes("?") ? "&" : "?"}${params.toString()}`;

      const navState = {
        from: `${window.location.pathname}${window.location.search}`,
        fromLabel: "Directory",
        schoolId,
      };

      if (currentUser) {
        setDetailsOpen(false);
        navigate(url, { state: navState });
        return;
      }

      openAuthDialog({ type: "navigate", url, state: navState });
    },
    [currentUser, navigate, openAuthDialog]
  );

  const onContactClick = useCallback(
    (schoolItem) => {
      if (currentUser && currentUserDoc) {
        onContactSchool(schoolItem);
        return;
      }
      openAuthDialog({ type: "contact", schoolItem }, { forceStudent: true });
    },
    [currentUser, currentUserDoc, onContactSchool, openAuthDialog]
  );

  const submitClaimRequest = useCallback(
    async (schoolItem) => {
      if (!currentUser?.uid) {
        openAuthDialog({ type: "claim", item: schoolItem }, { forceStudent: false });
        return;
      }

      if (myRole !== "school") {
        setClaimMessage("Only school accounts can claim school profiles.");
        return;
      }

      if (!schoolItem?.id) {
        setClaimMessage("This school profile is missing an institution id.");
        return;
      }

      if (isInstitutionClaimed(schoolItem)) {
        setClaimMessage("This school profile is already claimed.");
        return;
      }

      setClaimSubmitting(true);
      setClaimMessage("");

      try {
        const myPendingSnap = await getDocs(
          query(
            collection(db, CLAIM_REQUESTS_COLL),
            where("requested_by_uid", "==", currentUser.uid),
            where("status", "==", "pending"),
            limit(1)
          )
        );

        if (!myPendingSnap.empty) {
          setClaimMessage("You already have a pending claim request under review.");
          return;
        }

        const duplicateSnap = await getDocs(
          query(
            collection(db, CLAIM_REQUESTS_COLL),
            where("institution_id", "==", schoolItem.id),
            where("requested_by_uid", "==", currentUser.uid),
            limit(10)
          )
        );

        const duplicate = duplicateSnap.docs.some((d) => {
          const status = String(d.data()?.status || "").toLowerCase().trim();
          return status === "pending" || status === "approved";
        });

        if (duplicate) {
          setClaimMessage("You already submitted a claim request for this school.");
          return;
        }

        await addDoc(collection(db, CLAIM_REQUESTS_COLL), {
          institution_id: schoolItem.id,
          institution_name:
            schoolItem.name ||
            schoolItem.school_name ||
            schoolItem.institution_name ||
            "",
          institution_country: schoolItem.country || schoolItem.school_country || "",
          institution_country_code: schoolItem.country_code || schoolItem.countryCode || "",
          requested_by_uid: currentUser.uid,
          requested_by_email: currentUserDoc?.email || currentUser.email || "",
          requested_by_name:
            currentUserDoc?.full_name || currentUser.displayName || "",
          requested_role: "school",
          status: "pending",
          claim_reason: "Requested from directory school listing.",
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          reviewed_by: null,
          reviewed_at: null,
          approval_note: "",
          rejection_reason: "",
        });

        setClaimMessage("Claim request submitted. An admin will review it.");
      } catch (e) {
        console.error("Claim request submission failed:", e);
        setClaimMessage("Failed to submit claim request. Please try again.");
      } finally {
        setClaimSubmitting(false);
      }
    },
    [currentUser, currentUserDoc, myRole, openAuthDialog]
  );

  const loading = loadingSchools;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      <Dialog
        open={authDialogOpen}
        onOpenChange={(v) => {
          setAuthDialogOpen(v);
          if (!v) {
            setAuthStep("choice");
            setPendingAction(null);
            setForceStudentSignup(false);
            resetAuthForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{tr("auth.title", "Sign in required")}</DialogTitle>
            <DialogDescription>
              {tr(
                "auth.subtitle",
                "You need to log in to continue. You can use email/password, or sign in with Google / Apple."
              )}
            </DialogDescription>
          </DialogHeader>

          {authError ? (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {authError}
            </div>
          ) : null}

          {authStep === "choice" ? (
            <div className="mt-4 space-y-3">
              <Button
                className="w-full h-11"
                onClick={() => handleOAuthSignIn("google", "login")}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Chrome className="w-4 h-4 mr-2" />
                )}
                {tr("auth.continueGoogle", "Continue with Google")}
              </Button>

              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => handleOAuthSignIn("apple", "login")}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Apple className="w-4 h-4 mr-2" />
                )}
                {tr("auth.continueApple", "Continue with Apple")}
              </Button>

              <div className="flex items-center gap-3 my-2">
                <div className="h-px bg-gray-200 flex-1" />
                <div className="text-xs text-gray-500">{tr("auth.orContinueEmail", "or")}</div>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              <Button
                className="w-full h-11"
                onClick={() => setAuthStep("login")}
                disabled={authLoading}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {tr("auth.signIn", "Sign in")}
              </Button>

              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => {
                  if (forceStudentSignup) {
                    setSignupRole("user");
                    setAuthStep("signup_method");
                  } else {
                    setAuthStep("role");
                  }
                }}
                disabled={authLoading}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create an account
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setAuthDialogOpen(false)}
                disabled={authLoading}
              >
                Cancel
              </Button>
            </div>
          ) : null}

          {authStep === "login" ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  className="h-11"
                  onClick={() => handleOAuthSignIn("google", "login")}
                  disabled={authLoading}
                >
                  {authLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Chrome className="w-4 h-4 mr-2" />
                  )}
                  Google
                </Button>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => handleOAuthSignIn("apple", "login")}
                  disabled={authLoading}
                >
                  {authLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Apple className="w-4 h-4 mr-2" />
                  )}
                  Apple
                </Button>
              </div>

              <div className="flex items-center gap-3 my-1">
                <div className="h-px bg-gray-200 flex-1" />
                <div className="text-xs text-gray-500">or email</div>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Email</label>
                <Input
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={tr("auth.email_placeholder", "you@example.com")}
                  type="email"
                  className="h-11"
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Password</label>
                <div className="relative">
                  <Input
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={tr("auth.password_placeholder", "Enter your password")}
                    type={loginShowPw ? "text" : "password"}
                    className="h-11 pr-10"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-gray-700"
                    onClick={() => setLoginShowPw((v) => !v)}
                    aria-label={loginShowPw ? "Hide password" : "Show password"}
                  >
                    {loginShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button className="w-full h-11" onClick={handleLogin} disabled={authLoading}>
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4 mr-2" />
                )}
                {tr("auth.login", "Log in")}
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAuthStep("choice")}
                  disabled={authLoading}
                >
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(false)}
                  disabled={authLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {authStep === "role" ? (
            <div className="mt-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">Select your role</div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <Button
                  variant={signupRole === "user" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setSignupRole("user")}
                  disabled={authLoading}
                >
                  Student
                </Button>
                <Button
                  variant={signupRole === "agent" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setSignupRole("agent")}
                  disabled={authLoading}
                >
                  Agent
                </Button>
                <Button
                  variant={signupRole === "tutor" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setSignupRole("tutor")}
                  disabled={authLoading}
                >
                  Tutor
                </Button>
                <Button
                  variant={signupRole === "school" ? "default" : "outline"}
                  className="h-11"
                  onClick={() => setSignupRole("school")}
                  disabled={authLoading}
                >
                  School
                </Button>
              </div>

              <Button
                className="w-full h-11"
                onClick={() => setAuthStep("signup_method")}
                disabled={authLoading}
              >
                Continue
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAuthStep("choice")}
                  disabled={authLoading}
                >
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(false)}
                  disabled={authLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {authStep === "signup_method" ? (
            <div className="mt-4 space-y-3">
              <div className="text-sm text-gray-600">
                Creating account as:{" "}
                <span className="font-semibold capitalize">
                  {signupRole === "user" ? "Student" : signupRole}
                </span>
              </div>

              <Button
                className="w-full h-11"
                onClick={() => handleOAuthSignIn("google", "signup")}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Chrome className="w-4 h-4 mr-2" />
                )}
                Sign up with Google
              </Button>

              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => handleOAuthSignIn("apple", "signup")}
                disabled={authLoading}
              >
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Apple className="w-4 h-4 mr-2" />
                )}
                Sign up with Apple
              </Button>

              <div className="flex items-center gap-3 my-2">
                <div className="h-px bg-gray-200 flex-1" />
                <div className="text-xs text-gray-500">{tr("auth.orContinueEmail", "or")}</div>
                <div className="h-px bg-gray-200 flex-1" />
              </div>

              <Button
                className="w-full h-11"
                onClick={() => setAuthStep("signup_email")}
                disabled={authLoading}
              >
                <Mail className="w-4 h-4 mr-2" />
                Sign up with Email
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAuthStep("role")}
                  disabled={authLoading}
                >
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(false)}
                  disabled={authLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {authStep === "signup_email" ? (
            <div className="mt-4 space-y-3">
              <div className="text-sm text-gray-600">
                Creating account as:{" "}
                <span className="font-semibold capitalize">
                  {signupRole === "user" ? "Student" : signupRole}
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Full name</label>
                <Input
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder={tr("auth.name_placeholder", "Your name")}
                  className="h-11"
                  autoComplete="name"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Email</label>
                <Input
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder={tr("auth.email_placeholder", "you@example.com")}
                  type="email"
                  className="h-11"
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Password</label>
                <div className="relative">
                  <Input
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder={tr("auth.create_password_placeholder", "Create a password")}
                    type={signupShowPw ? "text" : "password"}
                    className="h-11 pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-gray-700"
                    onClick={() => setSignupShowPw((v) => !v)}
                    aria-label={signupShowPw ? "Hide password" : "Show password"}
                  >
                    {signupShowPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Confirm password</label>
                <Input
                  value={signupPassword2}
                  onChange={(e) => setSignupPassword2(e.target.value)}
                  placeholder={tr("auth.confirm_password_placeholder", "Confirm your password")}
                  type={signupShowPw ? "text" : "password"}
                  className="h-11"
                  autoComplete="new-password"
                />
              </div>

              <Button className="w-full h-11" onClick={handleSignupEmail} disabled={authLoading}>
                {authLoading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                {tr("auth.create_account", "Create account")}
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAuthStep("signup_method")}
                  disabled={authLoading}
                >
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(false)}
                  disabled={authLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {authStep === "oauth_finish" ? (
            <div className="mt-4 space-y-3">
              <div className="text-sm text-gray-600">
                Creating account as:{" "}
                <span className="font-semibold capitalize">
                  {signupRole === "user" ? "Student" : signupRole}
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Full name</label>
                <Input
                  value={oauthName}
                  onChange={(e) => setOauthName(e.target.value)}
                  placeholder={tr("auth.name_placeholder", "Your name")}
                  className="h-11"
                  autoComplete="name"
                  disabled={authLoading}
                />
                <p className="text-xs text-gray-500">
                  Apple may not provide your name every time — you can type it here.
                </p>
              </div>

              <Button className="w-full h-11" onClick={handleOAuthComplete} disabled={authLoading}>
                {authLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Continue to onboarding
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAuthStep("signup_method")}
                  disabled={authLoading}
                >
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setAuthDialogOpen(false)}
                  disabled={authLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden max-h-[90vh]">
          <DialogHeader className="px-6 pt-6 shrink-0">
            <DialogTitle>{tr("directory.school.details", "School Details")}</DialogTitle>
            <DialogDescription>
              {tr("directory.school.details_sub", "View overview, programs, and contact options.")}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 overflow-hidden">
            {loading ? (
              <SkeletonDetailsPanel />
            ) : (
              <div className="max-h-[calc(90vh-110px)] overflow-y-auto pr-2">
                <SchoolDetailsPanel
                  item={selectedItem}
                  programs={selectedPrograms}
                  onContactClick={onContactClick}
                  onClaimClick={submitClaimRequest}
                  claimSubmitting={claimSubmitting}
                  claimMessage={claimMessage}
                  onProgramClick={onProgramClick}
                  tr={tr}
                  currentUserRole={currentUserRole}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent mb-4">
            {tr("directory.header.school_title", "Browse Schools & Institutions")}
          </h1>

          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            {tr(
              "directory.header.school_subtitle",
              "Explore schools and institutions, then expand to view programs and contact options."
            )}
          </p>
        </div>

        {currentUserRole === "school" ? (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <p className="font-semibold">School claiming is optional.</p>
            <p className="text-sm text-blue-800 mt-1">
              If you find your school here and it is unclaimed, open it and click “Claim this profile” to send a request for admin review.
            </p>
          </div>
        ) : null}

        <div className="relative mb-8">
          <Card>
            <CardContent className="p-6">
              <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm text-gray-600 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>
                      {tr("directory.filters.browse_label", "Browse:")}{" "}
                      <span className="font-semibold capitalize">
                        {tr("directory.tabs.school", "School")}
                      </span>
                    </span>
                  </div>
                  <div />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="sm:col-span-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                      <Input
                        type="text"
                        placeholder={tr(
                          "directory.search_placeholder.schools",
                          "Search schools, institutions, programs..."
                        )}
                        value={searchTerm}
                        onChange={handleSearchChange}
                        className="pl-10 h-11 text-base"
                      />
                    </div>
                  </div>

                  <CountrySelector
                    value={selectedCountry}
                    onChange={handleCountryChange}
                    options={schoolCountryOptions}
                    includeAll
                    allLabel="All Countries"
                    placeholder={tr("directory.filters.all_countries", "All Countries")}
                    className="h-11"
                  />

                  <Select
                    value={selectedCity}
                    onValueChange={(value) => {
                      setSelectedCity(value);
                      updatePage(1);
                    }}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder={tr("directory.filters.all_cities", "All Cities")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Cities</SelectItem>
                      {(schoolCityGroups || []).map((g) => (
                        <React.Fragment key={g.country}>
                          <div className="px-2 py-1 text-xs font-semibold text-gray-500">
                            {g.country}
                          </div>
                          {(g.cities || []).map((city) => (
                            <SelectItem key={`${g.country}-${city}`} value={`${g.country}::${city}`}>
                              {city}
                            </SelectItem>
                          ))}
                          <div className="my-1 h-px bg-gray-100" />
                        </React.Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {totalCount > 0 ? (
                      <>
                        Showing <span className="font-medium">{startIndex + 1}</span>–
                        <span className="font-medium">{endIndex}</span> of{" "}
                        <span className="font-medium">{totalCount}</span> schools{" "}
                        {loadingPrograms
                          ? tr("directory.school.loading_programs", "Loading programs…")
                          : `${allSchools.length} programs, ${allInstitutions.length} institutions`}
                      </>
                    ) : (
                      <>Showing 0 schools</>
                    )}
                  </div>

                  <Button type="button" variant="outline" onClick={clearAllFilters} className="text-sm">
                    Clear All Filters
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="mt-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonGridCard key={`sk-${i}`} />)
            ) : pagedItems.length ? (
              pagedItems.map((item) => {
                const key = item.school_key || item.id;
                return (
                  <DirectoryGridCard
                    key={key}
                    item={item}
                    tr={tr}
                    onOpenDetails={() => {
                      setSelectedKey(key);
                      setClaimMessage("");
                      setDetailsOpen(true);
                    }}
                  />
                );
              })
            ) : (
              <div className="col-span-full">
                <Card>
                  <CardContent className="p-10 text-center text-gray-600">
                    {tr("directory.common.no_results", "No results found. Try adjusting your filters.")}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {totalCount > 0 && totalPages > 1 && (
            <div className="pt-6 flex items-center justify-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updatePage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Prev
              </Button>

              {pageNumbers.map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-gray-500 select-none">
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={p === page ? "default" : "outline"}
                    onClick={() => updatePage(p)}
                    aria-current={p === page ? "page" : undefined}
                  >
                    {p}
                  </Button>
                )
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updatePage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>

        {totalCount === 0 && (
          <div className="text-center py-12">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No schools found</h3>
            <p className="text-gray-600 mb-4">
              Try adjusting your search criteria or clear filters to see all available options.
            </p>
            <Button type="button" onClick={clearAllFilters} variant="outline">
              Clear All Filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}