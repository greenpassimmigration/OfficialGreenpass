import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  Globe,
  Calendar,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  Building,
  Lock,
  Mail,
  User as UserIcon,
  Eye,
  EyeOff,
  Heart,
  Loader2,
} from "lucide-react";
import { createPageUrl } from "@/utils";

/* ---------- UI Dialog ---------- */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import SchoolForm from "@/components/admin/SchoolForm";

/* ---------- Firebase Auth ---------- */
import { auth, db } from "@/firebase";
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  updateProfile,
  onAuthStateChanged,
} from "firebase/auth";

/* ---------- Firestore ---------- */
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  setDoc,
  serverTimestamp,
  addDoc,
  deleteDoc,
} from "firebase/firestore";

/* ---------- helpers ---------- */
const pickFirst = (...vals) =>
  vals.find(
    (v) =>
      v !== undefined &&
      v !== null &&
      (`${v}`.trim?.() ?? `${v}`) !== ""
  ) ?? undefined;

const ensureArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const truncate = (txt, n = 220) => {
  const s = (txt || "").toString().trim();
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).trim()}...` : s;
};

const money = (amount) => {
  if (amount === undefined || amount === null || amount === "") return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `$${Number(amount || 0).toLocaleString()}`;
  }
};

const normalizeUrl = (url) => {
  const s = (url || "").toString().trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
};

const buildNextHref = (nextPage) => {
  const s = (nextPage || "").toString().trim();
  if (!s) return createPageUrl("Dashboard");
  if (s.startsWith("/")) return s;
  if (s.includes("?") || s.includes("/")) return s;
  return createPageUrl(s);
};

/* ---------- safe Firestore get (swallow permission-denied) ---------- */
async function safeGetDoc(path, id) {
  try {
    return await getDoc(doc(db, path, id));
  } catch (e) {
    const msg = (e?.code || e?.message || "").toString().toLowerCase();
    if (msg.includes("permission") || msg.includes("insufficient")) {
      return { exists: () => false };
    }
    return { exists: () => false };
  }
}

/* ---------- role helpers ---------- */
const VALID_ROLES = ["agent", "tutor", "school", "vendor"];
const DEFAULT_ROLE = "user"; // student/parent

function normalizeRole(r) {
  const v = (r || "").toString().trim().toLowerCase();
  return VALID_ROLES.includes(v) ? v : DEFAULT_ROLE;
}

function buildUserDoc({
  email,
  full_name = "",
  userType = DEFAULT_ROLE,
  signupEntryRole = DEFAULT_ROLE,
}) {
  return {
    role: userType,
    userType,
    user_type: userType,
    signup_entry_role: signupEntryRole,
    email,
    full_name,
    phone: "",
    country: "",
    address: {
      street: "",
      ward: "",
      district: "",
      province: "",
      postal_code: "",
    },
    profile_picture: "",
    is_verified: false,
    onboarding_completed: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
}

async function routeAfterAuth(navigate, fbUser, entryRole, nextPage) {
  const roleToUse = normalizeRole(entryRole);
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(
      ref,
      buildUserDoc({
        email: fbUser.email || "",
        full_name: fbUser.displayName || "",
        userType: roleToUse,
        signupEntryRole: roleToUse,
      }),
      { merge: true }
    );

    const qp = new URLSearchParams();
    qp.set("role", roleToUse);
    qp.set("lock", "1");
    if (nextPage) qp.set("next", nextPage);
    return navigate(`${createPageUrl("Onboarding")}?${qp.toString()}`);
  }

  const profile = snap.data();
  if (!profile?.onboarding_completed) {
    const qp = new URLSearchParams();
    qp.set("role", normalizeRole(profile?.user_type || roleToUse));
    qp.set("lock", "1");
    if (nextPage) qp.set("next", nextPage);
    return navigate(`${createPageUrl("Onboarding")}?${qp.toString()}`);
  }

  return navigate(buildNextHref(nextPage || "Dashboard"));
}

/* ---------- Inline Login Dialog ---------- */
function LoginDialog({ open, onOpenChange, entryRole, nextPage }) {
  const navigate = useNavigate();

  const [mode, setMode] = useState("signin");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showSigninPw, setShowSigninPw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) {
      setMode("signin");
      setBusy(false);
      setEmail("");
      setPassword("");
      setFullName("");
      setConfirm("");
      setShowSigninPw(false);
      setShowPw(false);
      setShowConfirm(false);
      setErrorMsg("");
    }
  }, [open]);

  const safeClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleLoginGoogle = async () => {
    try {
      setBusy(true);
      setErrorMsg("");
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      safeClose();
      await routeAfterAuth(navigate, cred.user, entryRole, nextPage);
    } catch (err) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setErrorMsg(
          err?.code ? `Firebase: ${err.code}` : err?.message || "Google sign-in failed"
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLoginApple = async () => {
    try {
      setBusy(true);
      setErrorMsg("");
      const appleProvider = new OAuthProvider("apple.com");
      const cred = await signInWithPopup(auth, appleProvider);
      safeClose();
      await routeAfterAuth(navigate, cred.user, entryRole, nextPage);
    } catch (err) {
      if (err?.code !== "auth/popup-closed-by-user") {
        setErrorMsg(
          err?.code ? `Firebase: ${err.code}` : err?.message || "Apple sign-in failed"
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignInEmail = async () => {
    const em = email.trim().toLowerCase();
    if (!em) return setErrorMsg("Please enter your email.");
    if (!password) return setErrorMsg("Please enter your password.");

    try {
      setBusy(true);
      setErrorMsg("");
      const cred = await signInWithEmailAndPassword(auth, em, password);
      safeClose();
      await routeAfterAuth(navigate, cred.user, entryRole, nextPage);
    } catch (err) {
      setErrorMsg(err?.code ? `Firebase: ${err.code}` : err?.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpEmail = async () => {
    const em = email.trim().toLowerCase();
    if (!fullName.trim()) return setErrorMsg("Please enter your full name.");
    if (!em) return setErrorMsg("Please enter your email.");
    if (!password) return setErrorMsg("Please create a password.");
    if (password !== confirm) return setErrorMsg("Passwords do not match.");

    try {
      setBusy(true);
      setErrorMsg("");

      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (methods.length > 0) {
        setMode("signin");
        return setErrorMsg("This email is already registered. Please sign in instead.");
      }

      const cred = await createUserWithEmailAndPassword(auth, em, password);
      await updateProfile(cred.user, { displayName: fullName.trim() });

      safeClose();
      await routeAfterAuth(navigate, cred.user, entryRole, nextPage);
    } catch (err) {
      setErrorMsg(err?.code ? `Firebase: ${err.code}` : err?.message || "Sign-up failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "signin" ? "Sign in to continue" : "Create your account"}
          </DialogTitle>
          <DialogDescription>
            Selected role:{" "}
            <span className="font-medium">
              {entryRole === "user" ? "Student / Parent" : entryRole}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm">
          <button
            type="button"
            className={`rounded-lg py-2 transition ${
              mode === "signin" ? "bg-white font-semibold shadow" : "text-gray-600"
            }`}
            onClick={() => setMode("signin")}
            disabled={busy}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`rounded-lg py-2 transition ${
              mode === "signup" ? "bg-white font-semibold shadow" : "text-gray-600"
            }`}
            onClick={() => setMode("signup")}
            disabled={busy}
          >
            Sign up
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <Button
            variant="outline"
            className="h-12 w-full text-base"
            onClick={handleLoginGoogle}
            disabled={busy}
          >
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full bg-black text-base text-white hover:bg-gray-800 hover:text-white"
            onClick={handleLoginApple}
            disabled={busy}
          >
            Apple Continue with Apple
          </Button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">or continue with email</span>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {errorMsg}
          </div>
        )}

        {mode === "signin" ? (
          <div className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type="email"
                placeholder="Email address"
                className="h-12 pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type={showSigninPw ? "text" : "password"}
                placeholder="Password"
                className="h-12 pl-10 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showSigninPw ? "Hide password" : "Show password"}
                aria-pressed={showSigninPw}
                onClick={() => setShowSigninPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
              >
                {showSigninPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <Button className="h-12 w-full text-base" onClick={handleSignInEmail} disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Full name"
                className="h-12 pl-10"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type="email"
                placeholder="Email address"
                className="h-12 pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type={showPw ? "text" : "password"}
                placeholder="Create a password"
                className="h-12 pl-10 pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
              >
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm password"
                className="h-12 pl-10 pr-10"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <button
                type="button"
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                aria-pressed={showConfirm}
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
              >
                {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <Button className="h-12 w-full text-base" onClick={handleSignUpEmail} disabled={busy}>
              {busy ? "Creating..." : "Create account"}
            </Button>
          </div>
        )}

        <div className="pt-2">
          <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SchoolDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const schoolIdParam = searchParams.get("id");

  const [school, setSchool] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [programsPage, setProgramsPage] = useState(1);
  const programsPerPage = 10;

  const [fbUser, setFbUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [fbProfile, setFbProfile] = useState(null);

  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [chosenRole, setChosenRole] = useState("school");
  const [loginNextPage, setLoginNextPage] = useState("SchoolDetails");

  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [programSaving, setProgramSaving] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);

  const [interestedLoading, setInterestedLoading] = useState(false);
  const [alreadyInterested, setAlreadyInterested] = useState(false);
  const [pendingInterest, setPendingInterest] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!fbUser) {
        setFbProfile(null);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", fbUser.uid));
        if (!cancelled) setFbProfile(snap.exists() ? snap.data() : null);
      } catch {
        if (!cancelled) setFbProfile(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fbUser]);

  const resolveInstitutionId = useCallback(async () => {
    if (!authReady && !schoolIdParam) return null;

    if (schoolIdParam) {
      try {
        const directInst = await safeGetDoc("institutions", schoolIdParam);
        if (directInst.exists()) return schoolIdParam;
      } catch {}

      try {
        const instQ = query(
          collection(db, "institutions"),
          where("user_id", "==", schoolIdParam),
          limit(1)
        );
        const instSnap = await getDocs(instQ);
        if (!instSnap.empty) return instSnap.docs[0].id;
      } catch {}

      try {
        const spQ = query(
          collection(db, "school_profiles"),
          where("user_id", "==", schoolIdParam),
          limit(1)
        );
        const spSnap = await getDocs(spQ);

        if (!spSnap.empty) {
          const sp = spSnap.docs[0].data() || {};
          const linkedInstitutionId =
            sp.institution_id || sp.institutionId || sp.school_id || sp.schoolId || null;

          if (linkedInstitutionId) return linkedInstitutionId;
        }
      } catch {}

      return null;
    }

    if (!fbUser) return null;

    const uid = fbUser.uid;

    try {
      const instQ = query(collection(db, "institutions"), where("user_id", "==", uid), limit(1));
      const instSnap = await getDocs(instQ);
      if (!instSnap.empty) return instSnap.docs[0].id;
    } catch {}

    return null;
  }, [schoolIdParam, authReady, fbUser]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      try {
        if (!schoolIdParam && !authReady) return;

        if (!schoolIdParam && authReady && !fbUser) {
          if (!cancelled) {
            setSchool(null);
            setPrograms([]);
            setLoading(false);
          }
          return;
        }

        const institutionId = await resolveInstitutionId();

        if (!institutionId) {
          if (!cancelled) {
            setSchool(null);
            setPrograms([]);
            setLoading(false);
          }
          return;
        }

        const instSnap = await safeGetDoc("institutions", institutionId);
        const instData = instSnap.exists() ? { id: instSnap.id, ...instSnap.data() } : null;

        let spData = null;

        try {
          const schoolOwnerId =
            pickFirst(
              instData?.user_id,
              schoolIdParam && schoolIdParam !== institutionId ? schoolIdParam : null
            ) || null;

          if (schoolOwnerId) {
            const spQ = query(
              collection(db, "school_profiles"),
              where("user_id", "==", schoolOwnerId),
              limit(1)
            );
            const spSnap = await getDocs(spQ);
            if (!spSnap.empty) {
              spData = { id: spSnap.docs[0].id, ...spSnap.docs[0].data() };
            }
          }
        } catch {
          spData = null;
        }

        if (!instData && !spData) {
          if (!cancelled) {
            setSchool(null);
            setPrograms([]);
            setLoading(false);
          }
          return;
        }

        const merged = {
          id: institutionId,
          name: pickFirst(instData?.name, spData?.school_name, spData?.institution_name, "Institution"),
          logo_url: pickFirst(instData?.logoUrl, instData?.logo_url),
          banner_url: pickFirst(instData?.bannerUrl, instData?.banner_url),
          image_url: pickFirst(instData?.imageUrl, instData?.image_url),
          image_urls: ensureArray(instData?.imageUrls),
          website: pickFirst(instData?.website, spData?.website),
          location: pickFirst(instData?.city, spData?.location),
          province: pickFirst(instData?.province),
          country: pickFirst(instData?.country),
          about: pickFirst(instData?.about, instData?.description, spData?.about, spData?.bio),
          description: pickFirst(instData?.description),
          address: pickFirst(instData?.address),
          phone: pickFirst(instData?.phone),
          email: pickFirst(instData?.email),
          dliNumber: pickFirst(instData?.dliNumber),
          year_established: pickFirst(instData?.year_established),
          application_fee: pickFirst(instData?.application_fee),
          avgTuition_field: pickFirst(instData?.avgTuition),
          cost_of_living: pickFirst(instData?.cost_of_living),
          public_private: pickFirst(instData?.public_private),
          verification_status: pickFirst(spData?.verification_status, instData?.verification_status),
          account_type: pickFirst(instData?.account_type, "real"),
          status: instData?.status,
          type: pickFirst(instData?.type, spData?.type),
          user_id: pickFirst(instData?.user_id, spData?.user_id),
          raw: {
            institution: instData,
            school_profile: spData,
          },
        };

        if (!cancelled) setSchool(merged);

        const programsFound = [];
        const programOwnerId = pickFirst(instData?.user_id, spData?.user_id, schoolIdParam);

        try {
          if (programOwnerId) {
            const q1 = query(collection(db, "schools"), where("user_id", "==", programOwnerId), limit(500));
            const snap1 = await getDocs(q1);
            snap1.forEach((d) => programsFound.push({ id: d.id, ...d.data() }));
          }
        } catch (e) {
          console.warn("Programs query (schools by user_id) failed:", e);
        }

        try {
          const q2 = query(collection(db, "schools"), where("institution_id", "==", institutionId), limit(500));
          const snap2 = await getDocs(q2);
          snap2.forEach((d) => {
            if (!programsFound.find((p) => p.id === d.id)) {
              programsFound.push({ id: d.id, ...d.data() });
            }
          });
        } catch {}

        try {
          const q3 = query(collection(db, "schools"), where("institutionId", "==", institutionId), limit(500));
          const snap3 = await getDocs(q3);
          snap3.forEach((d) => {
            if (!programsFound.find((p) => p.id === d.id)) {
              programsFound.push({ id: d.id, ...d.data() });
            }
          });
        } catch {}

        if (!cancelled) {
          setPrograms(programsFound);
          setProgramsPage(1);
        }
      } catch (err) {
        console.error("Error fetching SchoolDetails:", err);
        if (!cancelled) {
          setSchool(null);
          setPrograms([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolIdParam, fbUser, authReady, resolveInstitutionId]);

  const role = normalizeRole(fbProfile?.user_type || fbProfile?.role || "user");
  const isSignedIn = !!fbUser;

  const ownerIds = useMemo(() => {
    return [
      school?.user_id,
      school?.raw?.institution?.user_id,
      school?.raw?.school_profile?.user_id,
    ]
      .filter(Boolean)
      .map((v) => String(v));
  }, [school]);

  const canManageSchool = useMemo(() => {
    return !!fbUser && role === "school" && ownerIds.includes(String(fbUser.uid));
  }, [fbUser, role, ownerIds]);

  const currentPageHref = useMemo(
    () => `${window.location.pathname}${window.location.search}`,
    []
  );

  const avgTuition = useMemo(() => {
    const vals = programs
      .map((p) =>
        Number(p.tuition_per_year_cad ?? p.tuition_per_year ?? p.tuition_fee_cad ?? p.tuition ?? 0)
      )
      .filter((v) => Number.isFinite(v) && v > 0);

    if (!vals.length) return null;

    const sum = vals.reduce((a, b) => a + b, 0);
    return Math.round(sum / vals.length);
  }, [programs]);

  const avgTuitionDisplay = avgTuition ?? school?.avgTuition_field ?? null;

  const totalPrograms = programs.length;
  const startIndex = (programsPage - 1) * programsPerPage;
  const endIndex = startIndex + programsPerPage;
  const currentPrograms = programs.slice(startIndex, endIndex);
  const totalPages = Math.max(1, Math.ceil(totalPrograms / programsPerPage));

  const defaultNextPage = useMemo(() => "SchoolDetails", []);

  const openAddProgram = () => {
    if (!canManageSchool) return;
    setEditingProgram(null);
    setProgramDialogOpen(true);
  };

  const openEditProgram = (p) => {
    if (!canManageSchool) return;
    setEditingProgram(p || null);
    setProgramDialogOpen(true);
  };

  const handleRemoveProgram = async (p) => {
    if (!p?.id) return;
    if (!fbUser?.uid) return;
    if (!canManageSchool) return;

    const ok = window.confirm("Remove this program? This cannot be undone.");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "schools", p.id));
      setPrograms((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      console.error("Remove program failed:", e);
      alert("Failed to remove program. Check console for details.");
    }
  };

  const handleSaveProgram = async (data) => {
    if (!fbUser?.uid) return;
    if (!school?.id) return;
    if (!canManageSchool) return;

    setProgramSaving(true);

    try {
      const basePayload = {
        user_id: fbUser.uid,
        school_id: school.id,
        institution_id: school.id,
        institutionId: school.id,
        institution_name: school.name,
        school_name: school.name,
        program_title: data?.program_title || "",
        program_level: data?.program_level || "",
        field_of_study: data?.field_of_study || "",
        duration_display: data?.duration_display || "",
        tuition_fee_cad: Number(data?.tuition_fee_cad) || 0,
        application_fee: Number(data?.application_fee) || 0,
        intake_dates: Array.isArray(data?.intake_dates) ? data.intake_dates : [],
        program_overview: data?.program_overview || "",
        is_featured: !!data?.is_featured,
        updated_at: serverTimestamp(),
      };

      if (editingProgram?.id) {
        await setDoc(doc(db, "schools", editingProgram.id), basePayload, { merge: true });
      } else {
        await addDoc(collection(db, "schools"), {
          ...basePayload,
          created_at: serverTimestamp(),
        });
      }

      const programsFound = [];

      try {
        const q1 = query(collection(db, "schools"), where("user_id", "==", fbUser.uid), limit(500));
        const snap1 = await getDocs(q1);
        snap1.forEach((d) => programsFound.push({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn("Refresh programs by user_id failed:", e);
      }

      try {
        const q2 = query(collection(db, "schools"), where("institution_id", "==", school.id), limit(500));
        const snap2 = await getDocs(q2);
        snap2.forEach((d) => {
          if (!programsFound.find((p) => p.id === d.id)) {
            programsFound.push({ id: d.id, ...d.data() });
          }
        });
      } catch {}

      try {
        const q3 = query(collection(db, "schools"), where("institutionId", "==", school.id), limit(500));
        const snap3 = await getDocs(q3);
        snap3.forEach((d) => {
          if (!programsFound.find((p) => p.id === d.id)) {
            programsFound.push({ id: d.id, ...d.data() });
          }
        });
      } catch {}

      setPrograms(programsFound);
      setProgramsPage(1);
      setProgramDialogOpen(false);
      setEditingProgram(null);
    } catch (e) {
      console.error(editingProgram?.id ? "Edit program failed:" : "Add program failed:", e);
      alert("Failed to save program. Check console for details.");
    } finally {
      setProgramSaving(false);
    }
  };

  const checkInterestStatus = useCallback(async () => {
    if (!school?.id || !fbUser?.uid) {
      setAlreadyInterested(false);
      return;
    }

    try {
      const qLead = query(
        collection(db, "school_leads"),
        where("school_id", "==", school.id),
        where("student_id", "==", fbUser.uid),
        limit(1)
      );
      const snap = await getDocs(qLead);
      setAlreadyInterested(!snap.empty);
    } catch (e) {
      console.error("Error checking interest status:", e);
      setAlreadyInterested(false);
    }
  }, [school?.id, fbUser?.uid]);

  useEffect(() => {
    if (!authReady) return;
    checkInterestStatus();
  }, [authReady, checkInterestStatus]);

  const submitInterest = useCallback(async () => {
    if (!school?.id || !fbUser?.uid) return;
    if (canManageSchool) return;

    setInterestedLoading(true);
    try {
      const qLead = query(
        collection(db, "school_leads"),
        where("school_id", "==", school.id),
        where("student_id", "==", fbUser.uid),
        limit(1)
      );
      const existing = await getDocs(qLead);

      if (!existing.empty) {
        setAlreadyInterested(true);
        return;
      }

      let assignedAgentId = "";
      let referredByAgentId = "";

      try {
        const meSnap = await getDoc(doc(db, "users", fbUser.uid));
        const me = meSnap.exists() ? meSnap.data() : {};
        assignedAgentId = String(me?.assigned_agent_id || "").trim();
        referredByAgentId = String(me?.referred_by_agent_id || "").trim();
      } catch (err) {
        console.error("Failed to load student ownership info:", err);
      }

      const linkedAgentId = assignedAgentId || referredByAgentId || "";

      await addDoc(collection(db, "school_leads"), {
        school_id: school.id,
        institution_id: school.id,
        institutionId: school.id,
        school_name: school.name || "",
        school_owner_user_id: school.user_id || "",

        student_id: fbUser.uid,
        student_name: pickFirst(fbProfile?.full_name, fbUser.displayName, ""),
        student_email: fbUser.email || "",
        student_phone: pickFirst(fbProfile?.phone, ""),

        status: "interested",
        source: "school_details",
        lead_type: "school_details",
        schoolLeadType: "school_details",

        linked_agent_id: linkedAgentId || null,
        assigned_agent_id: assignedAgentId || null,
        referred_by_agent_id: referredByAgentId || null,

        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      setAlreadyInterested(true);
    } catch (e) {
      console.error("Error saving school lead:", e);
      alert("Failed to save interest. Please try again.");
    } finally {
      setInterestedLoading(false);
      setPendingInterest(false);
    }
  }, [school, fbUser, fbProfile, canManageSchool]);

  useEffect(() => {
    if (!pendingInterest) return;
    if (!authReady) return;
    if (!fbUser?.uid) return;
    if (!school?.id) return;

    submitInterest();
  }, [pendingInterest, authReady, fbUser?.uid, school?.id, submitInterest]);

  const handleInterestedClick = async () => {
    if (!school?.id) return;
    if (canManageSchool) return;

    if (!isSignedIn) {
      setChosenRole("user");
      setLoginNextPage(currentPageHref);
      setPendingInterest(true);
      setLoginDialogOpen(true);
      return;
    }

    if (role !== "user") {
      alert("Only student or parent accounts can mark a school as interested.");
      return;
    }

    await submitInterest();
  };

  const formatLocation = (s) => {
    const parts = [s?.location, s?.province, s?.country].filter(Boolean);
    return parts.join(", ");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (authReady && !fbUser && !schoolIdParam) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-3 p-6 text-center">
            <Lock className="mx-auto h-10 w-10 text-gray-500" />
            <div className="text-lg font-semibold">Sign in required</div>
            <div className="text-sm text-gray-600">
              School Details is only available to your own school account.
            </div>
            <Button
              onClick={() => {
                setChosenRole("school");
                setLoginNextPage(defaultNextPage);
                setLoginDialogOpen(true);
              }}
              className="w-full"
            >
              Sign in
            </Button>
          </CardContent>
        </Card>

        <LoginDialog
          open={loginDialogOpen}
          onOpenChange={setLoginDialogOpen}
          entryRole={chosenRole}
          nextPage={loginNextPage}
        />
      </div>
    );
  }

  if (!school) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Building className="mx-auto mb-4 h-16 w-16 text-gray-400" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">School Not Found</h2>
          <p className="text-gray-600">We couldn't load your school profile.</p>
        </div>
      </div>
    );
  }

  const websiteHref = normalizeUrl(school.website);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6">
      <div className="mx-auto max-w-6xl">
        {school.banner_url ? (
          <div className="mb-6 overflow-hidden rounded-2xl bg-white shadow-lg">
            <img
              src={school.banner_url}
              alt={`${school.name} banner`}
              className="h-[180px] w-full object-cover md:h-[240px]"
              loading="lazy"
            />
          </div>
        ) : null}

        <Card className="mb-8 bg-white/80 shadow-xl backdrop-blur-sm">
          <CardContent className="p-8">
            <div className="flex flex-col gap-8 lg:flex-row">
              <div className="flex-shrink-0">
                {school.logo_url ? (
                  <img
                    src={school.logo_url}
                    alt={`${school.name} logo`}
                    className="h-32 w-48 rounded-lg object-cover shadow-md"
                  />
                ) : school.image_url ? (
                  <img
                    src={school.image_url}
                    alt={school.name}
                    className="h-32 w-48 rounded-lg object-cover shadow-md"
                  />
                ) : (
                  <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-400 to-blue-500">
                    <GraduationCap className="h-16 w-16 text-white" />
                  </div>
                )}
              </div>

              <div className="flex-grow space-y-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-bold text-gray-900">{school.name}</h1>

                  <div className="flex flex-wrap gap-2">
                    {school.verification_status && (
                      <Badge
                        className={
                          school.verification_status === "verified"
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }
                      >
                        {school.verification_status === "verified" ? " Verified" : "Pending"}
                      </Badge>
                    )}

                    {school.account_type && (
                      <Badge
                        className={
                          school.account_type === "real"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-gray-100 text-gray-800"
                        }
                      >
                        {school.account_type === "real" ? "Real" : "Demo"}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="flex items-center text-gray-600">
                      <MapPin className="mr-2 h-5 w-5 text-emerald-600" />
                      <span>{formatLocation(school)}</span>
                    </div>

                    {websiteHref && (
                      <div className="flex items-center text-gray-600">
                        <Globe className="mr-2 h-5 w-5 text-emerald-600" />
                        <a
                          href={websiteHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline"
                        >
                          {school.website}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center text-gray-600">
                      <Calendar className="mr-2 h-5 w-5 text-emerald-600" />
                      <span>
                        Avg Tuition: {avgTuitionDisplay ? money(avgTuitionDisplay) : "Contact School"}
                      </span>
                    </div>

                    {school.application_fee !== undefined && school.application_fee !== null && (
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">Application fee:</span>{" "}
                        {money(school.application_fee)}
                      </div>
                    )}
                  </div>
                </div>

                {school.about ? (
                  <div className="pt-2 text-gray-700">
                    <p>{school.about}</p>
                  </div>
                ) : null}

                {!canManageSchool && (
                  <div className="flex flex-wrap items-center gap-3 pt-3">
                    <Button
                      onClick={handleInterestedClick}
                      disabled={interestedLoading || alreadyInterested}
                      className="gap-2"
                      variant={alreadyInterested ? "secondary" : "default"}
                    >
                      {interestedLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Heart className="h-4 w-4" />
                      )}
                      {alreadyInterested ? "Interested" : "I'm Interested"}
                    </Button>

                    <p className="text-sm text-gray-500">
                      Click this if you want this school to see you in their lead list.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/80 shadow-xl backdrop-blur-sm">
          <CardContent className="p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Programs</h2>

              <div className="flex items-center gap-3">
                <div className="text-sm text-gray-600">
                  {totalPrograms} program{totalPrograms === 1 ? "" : "s"}
                </div>

                {canManageSchool && (
                  <Button onClick={openAddProgram} className="h-9">
                    Add Program
                  </Button>
                )}
              </div>
            </div>

            {totalPrograms === 0 ? (
              <div className="text-gray-600">No programs found.</div>
            ) : (
              <div className="space-y-4">
                {currentPrograms.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 transition hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-gray-900">
                          {pickFirst(p.program_title, p.title, p.program_name, "Program")}
                        </div>

                        <div className="text-sm text-gray-600">
                          {pickFirst(p.program_level, p.level, "")
                            ? `${pickFirst(p.program_level, p.level, "")} • `
                            : ""}
                          {pickFirst(p.duration_display, p.duration, "")}
                        </div>

                        {pickFirst(p.program_overview, p.overview, p.description, "") ? (
                          <div className="mt-2 text-sm text-gray-600">
                            {truncate(
                              pickFirst(p.program_overview, p.overview, p.description, ""),
                              160
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            const pid = pickFirst(p.id, p.program_id, p.programId);
                            const qs = new URLSearchParams();

                            if (pid) qs.set("programId", pid);

                            const sid = pickFirst(school?.id, schoolIdParam);
                            if (sid) qs.set("schoolId", sid);

                            navigate(`${createPageUrl("ProgramDetails")}?${qs.toString()}`, {
                              state: {
                                program: p,
                                school,
                                from: `${window.location.pathname}${window.location.search}`,
                                fromLabel: "School Details",
                                schoolId: sid || "",
                              },
                            });
                          }}
                        >
                          View details
                        </Button>

                        {canManageSchool && (
                          <>
                            <Button variant="outline" onClick={() => openEditProgram(p)}>
                              Edit
                            </Button>
                            <Button variant="destructive" onClick={() => handleRemoveProgram(p)}>
                              Remove
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4">
                    <Button
                      variant="outline"
                      onClick={() => setProgramsPage((v) => Math.max(1, v - 1))}
                      disabled={programsPage <= 1}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Prev
                    </Button>

                    <div className="text-sm text-gray-600">
                      Page {programsPage} of {totalPages}
                    </div>

                    <Button
                      variant="outline"
                      onClick={() => setProgramsPage((v) => Math.min(totalPages, v + 1))}
                      disabled={programsPage >= totalPages}
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={programDialogOpen && canManageSchool}
          onOpenChange={(open) => {
            if (!canManageSchool) return;
            setProgramDialogOpen(open);
            if (!open) setEditingProgram(null);
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
            <DialogHeader>
              <DialogTitle>{editingProgram ? "Edit Program" : "Add Program"}</DialogTitle>
              <DialogDescription>
                {editingProgram
                  ? "Update this program."
                  : "Create a new program under this school."}
              </DialogDescription>
            </DialogHeader>

            <div className="pb-2">
              <SchoolForm
                school={{
                  institution_name: school?.name || "",
                  institution_type: (school?.type || "University")
                    .toString()
                    .replace(/^\w/, (c) => c.toUpperCase()),
                  institution_logo_url: school?.logo_url || "",
                  school_name: school?.name || "",
                  school_country: school?.country || "Canada",
                  school_province: school?.province || "",
                  school_city: school?.location || "",
                  program_title:
                    pickFirst(
                      editingProgram?.program_title,
                      editingProgram?.title,
                      editingProgram?.program_name,
                      ""
                    ) || "",
                  program_level:
                    pickFirst(editingProgram?.program_level, editingProgram?.level, "bachelor") ||
                    "bachelor",
                  field_of_study: pickFirst(editingProgram?.field_of_study, "") || "",
                  duration_display:
                    pickFirst(editingProgram?.duration_display, editingProgram?.duration, "") || "",
                  tuition_fee_cad:
                    Number(
                      pickFirst(editingProgram?.tuition_fee_cad, editingProgram?.tuition, 0)
                    ) || 0,
                  application_fee:
                    Number(pickFirst(editingProgram?.application_fee, 0)) || 0,
                  intake_dates: Array.isArray(editingProgram?.intake_dates)
                    ? editingProgram.intake_dates
                    : [],
                  program_overview:
                    pickFirst(
                      editingProgram?.program_overview,
                      editingProgram?.overview,
                      editingProgram?.description,
                      ""
                    ) || "",
                  is_featured: !!editingProgram?.is_featured,
                }}
                onSave={handleSaveProgram}
                onCancel={() => {
                  setProgramDialogOpen(false);
                  setEditingProgram(null);
                }}
              />

              {programSaving && <div className="mt-3 text-sm text-gray-600">Saving program...</div>}
            </div>
          </DialogContent>
        </Dialog>

        <Card className="mt-8 bg-white/80 shadow-xl backdrop-blur-sm">
          <CardContent className="p-8">
            <h2 className="mb-4 text-2xl font-bold text-gray-900">School Details</h2>

            <div className="grid gap-4 text-sm text-gray-700 md:grid-cols-2">
              <div>
                <span className="font-semibold">Address:</span> {school.address || "-"}
              </div>
              <div>
                <span className="font-semibold">Phone:</span> {school.phone || "-"}
              </div>
              <div>
                <span className="font-semibold">Email:</span> {school.email || "-"}
              </div>
              <div>
                <span className="font-semibold">DLI Number:</span> {school.dliNumber || "-"}
              </div>
              <div>
                <span className="font-semibold">Year Established:</span>{" "}
                {school.year_established || "-"}
              </div>
              <div>
                <span className="font-semibold">Application Fee:</span>{" "}
                {school.application_fee ? money(school.application_fee) : "-"}
              </div>
              <div>
                <span className="font-semibold">Cost of Living:</span>{" "}
                {school.cost_of_living ? money(school.cost_of_living) : "-"}
              </div>
              <div>
                <span className="font-semibold">Public/Private:</span> {school.public_private || "-"}
              </div>
            </div>
          </CardContent>
        </Card>

        <LoginDialog
          open={loginDialogOpen}
          onOpenChange={setLoginDialogOpen}
          entryRole={chosenRole}
          nextPage={loginNextPage}
        />
      </div>
    </div>
  );
}