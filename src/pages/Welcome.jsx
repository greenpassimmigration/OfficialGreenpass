// src/pages/Welcome.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Eye, EyeOff, Check, X, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

import roleAgent from "@/assets/welcome/role_agent.png";
import roleSchool from "@/assets/welcome/role_school.png";
import roleStudent from "@/assets/welcome/role_student.png";
import roleTutor from "@/assets/welcome/role_tutor.jpg";

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
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";

function InfoDialog({ open, title, message, onClose, okLabel = "OK" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="mt-2 whitespace-pre-line text-sm text-gray-600">{message}</p>
          <div className="mt-4 flex justify-end">
            <Button onClick={onClose}>{okLabel}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const GoogleIcon = ({ className = "mr-3 h-5 w-5" }) => (
  <svg className={className} role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <title>Google</title>
    <path
      d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.18-1.73 4.1-1.05 1.05-2.48 1.68-4.34 1.68-3.66 0-6.6-3-6.6-6.6s2.94-6.6 6.6-6.6c1.93 0 3.33.72 4.14 1.48l2.5-2.5C18.17 2.09 15.65 1 12.48 1 7.02 1 3 5.02 3 10.5s4.02 9.5 9.48 9.5c2.82 0 5.2-1 6.9-2.73 1.76-1.79 2.5-4.35 2.5-6.81 0-.57-.05-.96-.12-1.32H12.48z"
      fill="currentColor"
    />
  </svg>
);

const VALID_ROLES = ["user", "agent", "tutor", "school", "vendor", "collaborator"];
const DEFAULT_ROLE = "user";

const SIGNUP_ROLE_OPTIONS = [
  { value: "user", labelKey: "roles.student", labelFallback: "Student" },
  { value: "agent", labelKey: "roles.agent", labelFallback: "Agent" },
  { value: "tutor", labelKey: "roles.tutor", labelFallback: "Tutor" },
  { value: "school", labelKey: "roles.school", labelFallback: "School" },
];

const APP_LOGO_URL =
  "https://firebasestorage.googleapis.com/v0/b/greenpass-dc92d.firebasestorage.app/o/rawdatas%2FGreenPass%20Official.png?alt=media&token=809da08b-22f6-4049-bbbf-9b82342630e8";

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_HTTP_BASE ||
  "https://us-central1-greenpass-dc92d.cloudfunctions.net";

function normalizeRole(r) {
  const v = (r || "").toString().trim().toLowerCase();
  return VALID_ROLES.includes(v) ? v : DEFAULT_ROLE;
}

function buildCollaboratorReferralFields(refCode = "", referredByUid = "") {
  const code = String(refCode || "").trim();
  if (!code) return {};

  return {
    referred_by_collaborator_code: code,
    referred_by_collaborator_uid: referredByUid || "",
    referred_by_collaborator_at: serverTimestamp(),
  };
}

function buildUserDoc({
  email,
  full_name = "",
  userType = DEFAULT_ROLE,
  signupEntryRole = DEFAULT_ROLE,
  collaboratorRef = "",
  referredByCollaboratorUid = "",
  referredByAgentId = "",
  assignedAgentId = "",
  referredByTutorId = "",
  tutorStudentStatus = "",
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
    address: { street: "", ward: "", district: "", province: "", postal_code: "" },
    profile_picture: "",
    is_verified: false,
    onboarding_completed: false,
    kyc_document_id: "",
    kyc_document_url: "",
    assigned_agent_id: assignedAgentId || "",
    referred_by_agent_id: referredByAgentId || "",
    referred_by_tutor_id: referredByTutorId || "",
    tutor_student_status: tutorStudentStatus || "",
    purchased_packages: [],
    purchased_tutor_packages: [],
    session_credits: 0,
    schoolId: "",
    programId: "",
    enrollment_date: null,
    agent_reassignment_request: { requested_at: null, reason: "", new_agent_id: "", status: "pending" },
    settings: {
      language: "en",
      timezone: "Asia/Ho_Chi_Minh",
      currency: "USD",
      notification_preferences: {
        email_notifications: true,
        sms_notifications: false,
        application_updates: true,
        marketing_emails: false,
        session_reminders: true,
      },
    },
    package_assignment: { package_id: "", assigned_at: null, expires_at: null },
    is_guest_created: false,
    created_at: serverTimestamp(),
    ...buildCollaboratorReferralFields(collaboratorRef, referredByCollaboratorUid),
    updated_at: serverTimestamp(),
  };
}

function validatePassword(pw) {
  const lengthOK = pw.length >= 8;
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSpecial = /[^A-Za-z0-9]/.test(pw);
  return { lengthOK, hasUpper, hasNumber, hasSpecial, ok: lengthOK && hasUpper && hasNumber && hasSpecial };
}

const isValidEmail = (em) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);

function RuleRow({ ok, label }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-gray-400" />}
      <span className={ok ? "text-green-700" : "text-gray-600"}>{label}</span>
    </li>
  );
}

async function resolveCollaboratorRef(refCode) {
  const code = String(refCode || "").trim();
  if (!code) return "";

  try {
    const q = query(
      collection(db, "users"),
      where("collaborator_referral_code", "==", code),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return "";
    return snap.docs[0]?.id || "";
  } catch (error) {
    console.error("resolveCollaboratorRef error:", error);
    return "";
  }
}

function buildOnboardingUrl({
  role = DEFAULT_ROLE,
  collaboratorRef = "",
  agentRef = "",
  tutorRef = "",
  studentRef = "",
}) {
  const qp = new URLSearchParams();
  qp.set("role", role);

  if (collaboratorRef) qp.set("ref", collaboratorRef);
  if (agentRef) qp.set("agent_ref", agentRef);
  if (tutorRef) qp.set("tutor_ref", tutorRef);
  if (studentRef) qp.set("student_ref", studentRef);

  return `${createPageUrl("Onboarding")}?${qp.toString()}`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `Request failed: ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function resolveAgentReferral(agentRef) {
  const token = String(agentRef || "").trim();
  if (!token) return null;

  try {
    return await fetchJson(
      `${FUNCTIONS_BASE}/getAgentReferralPublic?ref=${encodeURIComponent(token)}`
    );
  } catch (error) {
    console.error("resolveAgentReferral error:", error);
    return null;
  }
}

async function resolveTutorReferral(tutorRef) {
  const token = String(tutorRef || "").trim();
  if (!token) return null;

  try {
    return await fetchJson(
      `${FUNCTIONS_BASE}/getTutorReferralPublic?tutor_ref=${encodeURIComponent(token)}`
    );
  } catch (error) {
    console.error("resolveTutorReferral error:", error);
    return null;
  }
}

async function acceptAgentReferralForUser(fbUser, agentRef) {
  const token = String(agentRef || "").trim();
  if (!token || !fbUser) return null;

  try {
    const idToken = await fbUser.getIdToken();
    return await fetchJson(`${FUNCTIONS_BASE}/acceptAgentReferral`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ ref: token }),
    });
  } catch (error) {
    console.error("acceptAgentReferralForUser error:", error);
    return null;
  }
}

async function acceptTutorReferralForUser(fbUser, tutorRef) {
  const token = String(tutorRef || "").trim();
  if (!token || !fbUser) return null;

  try {
    const idToken = await fbUser.getIdToken();
    return await fetchJson(`${FUNCTIONS_BASE}/acceptTutorReferral`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ tutor_ref: token }),
    });
  } catch (error) {
    console.error("acceptTutorReferralForUser error:", error);
    return null;
  }
}

function buildStudentScanUrl(studentRef) {
  const token = String(studentRef || "").trim();
  if (!token) return "";
  return `/scan/student?student_ref=${encodeURIComponent(token)}`;
}

async function routeAfterSignIn(
  navigate,
  fbUser,
  roleHint = DEFAULT_ROLE,
  referralContext = {
    collaboratorRef: "",
    agentRef: "",
    tutorRef: "",
    studentRef: "",
  }
) {
  const collaboratorRef = String(referralContext?.collaboratorRef || "").trim();
  const agentRef = String(referralContext?.agentRef || "").trim();
  const tutorRef = String(referralContext?.tutorRef || "").trim();
  const studentRef = String(referralContext?.studentRef || "").trim();

  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);

  const isCollaboratorInvite =
    String(roleHint || "").trim().toLowerCase() === "collaborator" && !!collaboratorRef;

  const isAgentInvite =
    String(roleHint || "").trim().toLowerCase() === "user" && !!agentRef;

  const isTutorInvite =
    String(roleHint || "").trim().toLowerCase() === "user" && !!tutorRef;

  const referredByCollaboratorUid = collaboratorRef
    ? await resolveCollaboratorRef(collaboratorRef)
    : "";

  const agentInviteData = agentRef ? await resolveAgentReferral(agentRef) : null;
  const tutorInviteData = tutorRef ? await resolveTutorReferral(tutorRef) : null;

  if (!snap.exists()) {
    const createRole = isCollaboratorInvite ? "collaborator" : normalizeRole(roleHint);

    await setDoc(
      ref,
      buildUserDoc({
        email: fbUser.email || "",
        full_name: fbUser.displayName || "",
        userType: createRole,
        signupEntryRole: createRole,
        collaboratorRef,
        referredByCollaboratorUid,
        referredByAgentId:
          agentInviteData?.agentUid ||
          agentInviteData?.uid ||
          agentInviteData?.userId ||
          "",
        assignedAgentId:
          agentInviteData?.agentUid ||
          agentInviteData?.uid ||
          agentInviteData?.userId ||
          "",
        referredByTutorId:
          tutorInviteData?.tutorUid ||
          tutorInviteData?.uid ||
          tutorInviteData?.userId ||
          "",
        tutorStudentStatus: isTutorInvite ? "pending" : "",
      }),
      { merge: true }
    );

    if (isAgentInvite) {
      await acceptAgentReferralForUser(fbUser, agentRef);
    }

    if (isTutorInvite) {
      await acceptTutorReferralForUser(fbUser, tutorRef);
    }

    return navigate(
      buildOnboardingUrl({
        role: createRole,
        collaboratorRef,
        agentRef,
        tutorRef,
        studentRef,
      })
    );
  }

  const profile = snap.data();

  const mergePayload = {
    updated_at: serverTimestamp(),
  };

  if (collaboratorRef && !profile?.referred_by_collaborator_code) {
    Object.assign(
      mergePayload,
      buildCollaboratorReferralFields(
        collaboratorRef,
        profile?.referred_by_collaborator_uid || referredByCollaboratorUid
      )
    );
  }

  if (isAgentInvite) {
    const resolvedAgentUid =
      agentInviteData?.agentUid ||
      agentInviteData?.uid ||
      agentInviteData?.userId ||
      "";

    if (resolvedAgentUid && !profile?.referred_by_agent_id) {
      mergePayload.referred_by_agent_id = resolvedAgentUid;
    }
    if (resolvedAgentUid && !profile?.assigned_agent_id) {
      mergePayload.assigned_agent_id = resolvedAgentUid;
    }

    await acceptAgentReferralForUser(fbUser, agentRef);
  }

  if (isTutorInvite) {
    const resolvedTutorUid =
      tutorInviteData?.tutorUid ||
      tutorInviteData?.uid ||
      tutorInviteData?.userId ||
      "";

    if (resolvedTutorUid && !profile?.referred_by_tutor_id) {
      mergePayload.referred_by_tutor_id = resolvedTutorUid;
    }
    if (!profile?.tutor_student_status) {
      mergePayload.tutor_student_status = "pending";
    }

    await acceptTutorReferralForUser(fbUser, tutorRef);
  }

  if (Object.keys(mergePayload).length > 1) {
    await setDoc(ref, mergePayload, { merge: true });
  }

  if (!profile?.onboarding_completed) {
    const roleToUse = isCollaboratorInvite
      ? "collaborator"
      : normalizeRole(profile?.user_type || roleHint || DEFAULT_ROLE);

    return navigate(
      buildOnboardingUrl({
        role: roleToUse,
        collaboratorRef,
        agentRef,
        tutorRef,
        studentRef,
      })
    );
  }

  if (studentRef) {
    return navigate(buildStudentScanUrl(studentRef));
  }

  return navigate(createPageUrl("Dashboard"));
}

export default function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, i18n } = useTranslation();

  const tr = React.useCallback((key, fallback) => t(key, { defaultValue: fallback }), [t]);

  useEffect(() => {
    const langFromUrl = params.get("lang");
    const saved = localStorage.getItem("gp_lang");
    const nextLang = langFromUrl || saved || i18n?.language || "en";

    if (i18n?.language !== nextLang) i18n.changeLanguage(nextLang);
    localStorage.setItem("gp_lang", nextLang);

    const collaboratorRef = (params.get("ref") || "").trim();
    const rawRole = (params.get("role") || params.get("userType") || "").toString().trim().toLowerCase();
    const agentRef = (params.get("agent_ref") || "").trim();
    const tutorRef = (params.get("tutor_ref") || "").trim();
    const studentRef = (params.get("student_ref") || "").trim();

    if (rawRole === "collaborator" && collaboratorRef) {
      localStorage.setItem("gp_collaborator_ref", collaboratorRef);
    }

    if (agentRef) {
      localStorage.setItem("gp_agent_ref", agentRef);
    }

    if (tutorRef) {
      localStorage.setItem("gp_tutor_ref", tutorRef);
    }

    if (studentRef) {
      localStorage.setItem("gp_student_ref", studentRef);
    }
  }, [params, i18n]);

  const collaboratorInviteFlow = useMemo(() => {
    const rawRole = (params.get("role") || params.get("userType") || "").toString().trim().toLowerCase();
    const refCode = (params.get("ref") || "").toString().trim();
    return rawRole === "collaborator" && !!refCode;
  }, [params]);

  const agentInviteFlow = useMemo(() => {
    const agentRef = (params.get("agent_ref") || "").toString().trim();
    return !!agentRef;
  }, [params]);

  const tutorInviteFlow = useMemo(() => {
    const tutorRef = (params.get("tutor_ref") || "").toString().trim();
    return !!tutorRef;
  }, [params]);

  const studentScanFlow = useMemo(() => {
    const studentRef = (params.get("student_ref") || "").toString().trim();
    return !!studentRef;
  }, [params]);

  const referralContext = useMemo(() => {
    return {
      collaboratorRef:
        params.get("ref") || localStorage.getItem("gp_collaborator_ref") || "",
      agentRef:
        params.get("agent_ref") || localStorage.getItem("gp_agent_ref") || "",
      tutorRef:
        params.get("tutor_ref") || localStorage.getItem("gp_tutor_ref") || "",
      studentRef:
        params.get("student_ref") || localStorage.getItem("gp_student_ref") || "",
    };
  }, [params]);

  const entryRole = useMemo(() => {
    if (collaboratorInviteFlow) return "collaborator";
    if (agentInviteFlow || tutorInviteFlow) return "user";

    const raw = params.get("role") ?? params.get("userType");
    return normalizeRole(raw);
  }, [params, collaboratorInviteFlow, agentInviteFlow, tutorInviteFlow]);

  const forcedSignupFlow = collaboratorInviteFlow || agentInviteFlow || tutorInviteFlow;

  const [mode, setMode] = useState(forcedSignupFlow ? "signup" : "signin");
  const [signupRole, setSignupRole] = useState(() => {
    if (collaboratorInviteFlow) return "collaborator";
    if (agentInviteFlow || tutorInviteFlow) return "user";
    return entryRole && entryRole !== DEFAULT_ROLE ? entryRole : "";
  });

  const activeRole = mode === "signup" ? signupRole : entryRole;
  const isRoleLocked = forcedSignupFlow;

  useEffect(() => {
    if (collaboratorInviteFlow) {
      setMode("signup");
      setSignupRole("collaborator");
      return;
    }

    if (agentInviteFlow || tutorInviteFlow) {
      setMode("signup");
      setSignupRole("user");
    }
  }, [collaboratorInviteFlow, agentInviteFlow, tutorInviteFlow]);

  useEffect(() => {
    if (activeRole) sessionStorage.setItem("onboarding_role", activeRole);
  }, [activeRole]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showSigninPw, setShowSigninPw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  const [dialog, setDialog] = useState({ open: false, title: "", message: "" });
  const [emailCheck, setEmailCheck] = useState({ checking: false, available: null, methods: [], error: "" });
  const [emailCheckVersion, setEmailCheckVersion] = useState(0);
  const emailCheckVersionRef = useRef(0);

  useEffect(() => {
    emailCheckVersionRef.current = emailCheckVersion;
  }, [emailCheckVersion]);

  const pwStatus = validatePassword(password);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch {}

      unsub = onAuthStateChanged(auth, async (user) => {
        setChecking(false);
        if (user) {
          const roleHint = sessionStorage.getItem("onboarding_role") || entryRole || DEFAULT_ROLE;

          await routeAfterSignIn(
            navigate,
            user,
            roleHint,
            referralContext
          );
        }
      });
    })();

    return () => unsub && unsub();
  }, [navigate, entryRole, referralContext]);

  async function runEmailCheck(em, versionAtCall) {
    try {
      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (versionAtCall !== emailCheckVersionRef.current) return;
      setEmailCheck({ checking: false, available: methods.length === 0, methods, error: "" });
    } catch {
      if (versionAtCall !== emailCheckVersionRef.current) return;
      setEmailCheck({
        checking: false,
        available: null,
        methods: [],
        error: tr("auth.email_check_failed", "Could not check email right now."),
      });
    }
  }

  useEffect(() => {
    if (mode !== "signup") return;
    const em = email.trim().toLowerCase();
    if (!em || !isValidEmail(em)) {
      setEmailCheck({ checking: false, available: null, methods: [], error: "" });
      return;
    }
    const nextVersion = emailCheckVersion + 1;
    setEmailCheckVersion(nextVersion);
    setEmailCheck({ checking: true, available: null, methods: [], error: "" });

    const handle = setTimeout(() => runEmailCheck(em, nextVersion), 400);
    return () => clearTimeout(handle);
  }, [email, mode]);

  const requireRoleIfSignup = () => {
    if (mode === "signup" && !signupRole) {
      setDialog({
        open: true,
        title: tr("auth.choose_role_title", "Choose a role"),
        message: tr("auth.choose_role_message", "Please select a role to continue."),
      });
      return false;
    }
    return true;
  };

  const handleLoginGoogle = async () => {
    if (!requireRoleIfSignup()) return;
    try {
      setBusy(true);
      sessionStorage.setItem("onboarding_role", activeRole || DEFAULT_ROLE);
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await routeAfterSignIn(
        navigate,
        cred.user,
        activeRole || DEFAULT_ROLE,
        referralContext
      );
    } catch (err) {
      if (err?.code === "auth/account-exists-with-different-credential") {
        setDialog({
          open: true,
          title: tr("auth.use_original_method_title", "Use your original sign-in method"),
          message: tr(
            "auth.use_original_method_message_google",
            "This email is already linked to a different sign-in method. Try signing in with Email & Password or Apple."
          ),
        });
      } else if (err?.code !== "auth/popup-closed-by-user") {
        setDialog({
          open: true,
          title: tr("auth.google_failed_title", "Google sign-in failed"),
          message: err?.code ? `Firebase: ${err.code}` : err?.message || tr("auth.google_failed_message", "Google sign-in failed"),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLoginApple = async () => {
    if (!requireRoleIfSignup()) return;
    try {
      setBusy(true);
      sessionStorage.setItem("onboarding_role", activeRole || DEFAULT_ROLE);
      const appleProvider = new OAuthProvider("apple.com");
      const cred = await signInWithPopup(auth, appleProvider);
      await routeAfterSignIn(
        navigate,
        cred.user,
        activeRole || DEFAULT_ROLE,
        referralContext
      );
    } catch (err) {
      if (err?.code === "auth/operation-not-supported-in-this-environment") {
        setDialog({
          open: true,
          title: tr("auth.apple_unavailable_title", "Apple sign-in unavailable"),
          message: tr("auth.apple_unavailable_message", "Apple sign-in is not enabled for this project/environment."),
        });
      } else if (err?.code === "auth/account-exists-with-different-credential") {
        setDialog({
          open: true,
          title: tr("auth.use_original_method_title", "Use your original sign-in method"),
          message: tr(
            "auth.use_original_method_message_apple",
            "This email is already linked to a different sign-in method. Try signing in with Email & Password or Google."
          ),
        });
      } else if (err?.code !== "auth/popup-closed-by-user") {
        setDialog({
          open: true,
          title: tr("auth.apple_failed_title", "Apple sign-in failed"),
          message: err?.code ? `Firebase: ${err.code}` : err?.message || tr("auth.apple_failed_message", "Apple sign-in failed"),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = () => {
    const em = (email || "").trim();
    const currentLang = params.get("lang") || localStorage.getItem("gp_lang") || i18n?.language || "en";
    const studentRef = String(referralContext?.studentRef || "").trim();

    const qp = new URLSearchParams();
    qp.set("lang", currentLang);
    if (studentRef) qp.set("student_ref", studentRef);

    navigate(`${createPageUrl("ResetPassword")}?${qp.toString()}`, { state: { email: em } });
  };

  const handleSignInEmail = async () => {
    const em = email.trim().toLowerCase();
    if (!em || !isValidEmail(em)) {
      setDialog({
        open: true,
        title: tr("auth.invalid_email_title", "Invalid email"),
        message: tr("auth.invalid_email_message", "Please enter a valid email address."),
      });
      return;
    }
    try {
      setBusy(true);
      sessionStorage.setItem("onboarding_role", activeRole || DEFAULT_ROLE);
      const cred = await signInWithEmailAndPassword(auth, em, password);
      await routeAfterSignIn(
        navigate,
        cred.user,
        activeRole || DEFAULT_ROLE,
        referralContext
      );
    } catch (err) {
      if (err?.code === "auth/wrong-password" || err?.code === "auth/invalid-credential") {
        setDialog({
          open: true,
          title: tr("auth.incorrect_password_title", "Incorrect password"),
          message: tr("auth.incorrect_password_message", "The password you entered is incorrect. Please try again."),
        });
      } else if (err?.code === "auth/user-not-found") {
        setMode("signup");
        setDialog({
          open: true,
          title: tr("auth.no_account_title", "No account found"),
          message: tr("auth.no_account_message", "We couldn’t find an account for that email. Please create one."),
        });
      } else {
        setDialog({
          open: true,
          title: tr("auth.signin_failed_title", "Sign-in failed"),
          message: err?.code ? `Firebase: ${err.code}` : err?.message || tr("auth.email_signin_failed", "Email sign-in failed."),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpEmail = async () => {
    try {
      setBusy(true);
      const em = email.trim().toLowerCase();

      if (!signupRole) {
        setDialog({
          open: true,
          title: tr("auth.choose_role_title", "Choose a role"),
          message: tr("auth.choose_role_message", "Please select a role to continue."),
        });
        return;
      }

      const { ok, lengthOK, hasUpper, hasNumber, hasSpecial } = validatePassword(password);
      if (!ok) {
        const issues = [
          !lengthOK && tr("auth.pw_min_len", "• Minimum length is 8 characters"),
          !hasUpper && tr("auth.pw_upper", "• At least 1 capital letter"),
          !hasNumber && tr("auth.pw_number", "• At least 1 number"),
          !hasSpecial && tr("auth.pw_special", "• At least 1 special character"),
        ]
          .filter(Boolean)
          .join("\n");

        setDialog({
          open: true,
          title: tr("auth.password_requirements_title", "Password requirements"),
          message: `${tr("auth.password_requirements_message", "Password does not meet requirements:")}\n${issues}`,
        });
        return;
      }

      if (password !== confirm) {
        setDialog({
          open: true,
          title: tr("auth.passwords_no_match_title", "Passwords do not match"),
          message: tr("auth.passwords_no_match_message", "Please make sure the passwords are identical."),
        });
        return;
      }

      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (methods.length > 0) {
        setDialog({
          open: true,
          title: tr("auth.email_already_registered_title", "Email already registered"),
          message: tr("auth.email_already_registered_simple", "This email is already registered. Try signing in."),
        });
        setMode("signin");
        return;
      }

      sessionStorage.setItem("onboarding_role", signupRole);

      const cred = await createUserWithEmailAndPassword(auth, em, password);
      await updateProfile(cred.user, {
        displayName: em.split("@")[0] || "GreenPass User",
      });

      await routeAfterSignIn(
        navigate,
        cred.user,
        signupRole,
        referralContext
      );
    } catch (err) {
      let message = err?.message || tr("auth.signup_failed_message", "Sign-up failed.");
      if (err?.code === "auth/invalid-email") message = tr("auth.invalid_email_message", "Please enter a valid email address.");
      else if (err?.code === "auth/weak-password") message = tr("auth.weak_password_message", "Password should meet the requirements listed.");
      else if (err?.code === "auth/email-already-in-use") message = tr("auth.email_in_use_message", "Email already in use.");
      setDialog({ open: true, title: tr("auth.signup_failed_title", "Sign-up failed"), message });
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-gray-700">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600" />
          <div className="text-sm font-medium">Loading…</div>
        </div>
      </div>
    );
  }

  const emailIsGoogleOnly =
    emailCheck.methods.includes?.("google.com") &&
    !emailCheck.methods.includes?.("password") &&
    !emailCheck.methods.includes?.("apple.com");

  const emailIsAppleOnly =
    emailCheck.methods.includes?.("apple.com") &&
    !emailCheck.methods.includes?.("password") &&
    !emailCheck.methods.includes?.("google.com");

  const emailTaken = emailCheck.available === false;

  const canSubmitSignup =
    mode !== "signup" ||
    (!emailCheck.checking && emailCheck.available === true && pwStatus.ok && confirm === password && !!signupRole);

  return (
    <div className="min-h-screen overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 text-gray-900">
      <main className="flex min-h-screen w-full items-center overflow-hidden px-2 py-4 sm:px-4 lg:px-6">
        <div className="mx-auto grid w-full max-w-[1720px] grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,520px)] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(360px,560px)]">
          <section className="lg:pr-6 xl:pr-10">
            <div className="relative mx-auto w-full max-w-[1100px] overflow-hidden rounded-[36px] border border-white/15 bg-white/10 p-3 shadow-[0_22px_90px_rgba(0,0,0,0.35)] backdrop-blur sm:p-4 lg:p-5">
              <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(900px_circle_at_15%_20%,rgba(255,255,255,0.22),transparent_55%),radial-gradient(900px_circle_at_85%_30%,rgba(16,185,129,0.18),transparent_55%),radial-gradient(900px_circle_at_60%_90%,rgba(255,255,255,0.10),transparent_55%)]" />
              <div className="relative">
                <h1 className="mt-2 text-center text-xl font-extrabold leading-[1.06] tracking-tight text-white sm:text-3xl lg:text-4xl xl:text-[3rem]">
                  <span className="block">{tr("hero_h1_1", "The Global Marketplace Connecting")}</span>
                  <span className="block">{tr("hero_h1_2", "Schools, Agents, Tutors & Students")}</span>
                </h1>

                <p className="mx-auto mt-2 max-w-2xl text-center text-sm leading-6 text-white/85 sm:text-base">
                  {tr(
                    "hero_tagline",
                    "Study, work, and immigration pathways. Connected transparently in one trusted platform."
                  )}
                </p>

                <div className="relative my-10 hidden h-[62vh] min-h-[460px] max-h-[600px] md:block lg:max-h-[640px]">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[600px] w-[920px] origin-center scale-[0.72] lg:scale-[0.78] xl:scale-[0.9]">
                      <svg
                        className="absolute inset-0 z-0 h-full w-full opacity-70"
                        viewBox="0 0 1000 640"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <defs>
                          <linearGradient id="gpGreen" x1="0" y1="0" x2="1" y2="1">
                            <stop stopColor="rgba(52,211,153,0.95)" />
                            <stop offset="1" stopColor="rgba(16,185,129,0.25)" />
                          </linearGradient>
                          <linearGradient id="gpBlue" x1="0" y1="0" x2="1" y2="1">
                            <stop stopColor="rgba(96,165,250,0.95)" />
                            <stop offset="1" stopColor="rgba(59,130,246,0.25)" />
                          </linearGradient>
                          <linearGradient id="gpPurple" x1="0" y1="0" x2="1" y2="1">
                            <stop stopColor="rgba(167,139,250,0.95)" />
                            <stop offset="1" stopColor="rgba(124,58,237,0.25)" />
                          </linearGradient>
                          <linearGradient id="gpAmber" x1="0" y1="0" x2="1" y2="1">
                            <stop stopColor="rgba(251,191,36,0.95)" />
                            <stop offset="1" stopColor="rgba(245,158,11,0.25)" />
                          </linearGradient>
                          <marker id="arrowGreen" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                            <path d="M0 0 L12 6 L0 12 Z" fill="rgba(16,185,129,0.95)" />
                          </marker>
                          <marker id="arrowBlue" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                            <path d="M0 0 L12 6 L0 12 Z" fill="rgba(59,130,246,0.95)" />
                          </marker>
                          <marker id="arrowPurple" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                            <path d="M0 0 L12 6 L0 12 Z" fill="rgba(124,58,237,0.95)" />
                          </marker>
                          <marker id="arrowAmber" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                            <path d="M0 0 L12 6 L0 12 Z" fill="rgba(245,158,11,0.95)" />
                          </marker>
                        </defs>

                        <circle cx="500" cy="320" r="120" stroke="rgba(255,255,255,0.28)" strokeWidth="3" strokeDasharray="2 10" />
                        <circle cx="500" cy="320" r="170" stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeDasharray="3 14" />

                        <path d="M372.7 192.7 A180 180 0 0 1 627.3 192.7" stroke="url(#gpAmber)" strokeWidth="12" strokeLinecap="round" opacity="0.9" markerEnd="url(#arrowAmber)" />
                        <path d="M627.3 192.7 A180 180 0 0 1 627.3 447.3" stroke="url(#gpBlue)" strokeWidth="12" strokeLinecap="round" opacity="0.9" markerEnd="url(#arrowBlue)" />
                        <path d="M627.3 447.3 A180 180 0 0 1 372.7 447.3" stroke="url(#gpPurple)" strokeWidth="12" strokeLinecap="round" opacity="0.9" markerEnd="url(#arrowPurple)" />
                        <path d="M372.7 447.3 A180 180 0 0 1 372.7 192.7" stroke="url(#gpGreen)" strokeWidth="12" strokeLinecap="round" opacity="0.9" markerEnd="url(#arrowGreen)" />
                      </svg>

                      <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
                        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white/95 shadow-[0_14px_50px_rgba(0,0,0,0.25)]">
                          <div className="absolute inset-[-10px] rounded-full border-2 border-white/30" />
                          <span className="text-2xl font-extrabold text-emerald-700">GP</span>
                        </div>
                      </div>

                      {[
                        {
                          key: "school",
                          img: roleSchool,
                          title: tr("role_school", "School"),
                          desc: tr("school_desc", "Connect with trusted global agents and students"),
                          bullets: [
                            tr("school_b1", "Reach verified agents worldwide"),
                            tr("school_b2", "Manage recruitment transparently"),
                            tr("school_b3", "Reduce marketing and admission costs"),
                          ],
                          badge: "bg-emerald-100 text-emerald-700",
                          pos: "absolute left-6 top-4 z-10 w-[44%] px-2",
                        },
                        {
                          key: "agent",
                          img: roleAgent,
                          title: tr("role_agent", "Agent"),
                          desc: tr("agent_desc", "Work directly with real schools. No middle layers"),
                          bullets: [
                            tr("agent_b1", "Access verified schools and programs"),
                            tr("agent_b2", "Track student leads and cases clearly"),
                            tr("agent_b3", "Build long-term, trusted partnerships"),
                          ],
                          badge: "bg-blue-100 text-blue-700",
                          pos: "absolute right-6 top-4 z-10 w-[44%] px-2",
                        },
                        {
                          key: "user",
                          img: roleStudent,
                          title: tr("role_student", "Student"),
                          desc: tr("student_desc", "Find schools, agents, and tutors you can trust"),
                          bullets: [
                            tr("student_b1", "Discover verified schools and programs"),
                            tr("student_b2", "Connect with reliable agents and tutors"),
                            tr("student_b3", "Get guided step by step transparently"),
                          ],
                          badge: "bg-violet-100 text-violet-700",
                          pos: "absolute left-6 bottom-4 z-10 w-[44%] px-2",
                        },
                        {
                          key: "tutor",
                          img: roleTutor,
                          title: tr("role_tutor", "Tutor"),
                          desc: tr("tutor_desc", "Support students globally and grow your practice"),
                          bullets: [
                            tr("tutor_b1", "Find students internationally"),
                            tr("tutor_b2", "Offer academic and pathway support"),
                            tr("tutor_b3", "Build your professional profile"),
                          ],
                          badge: "bg-amber-100 text-amber-700",
                          pos: "absolute right-6 bottom-4 z-10 w-[44%] px-2",
                        },
                      ].map((item) => (
                        <div key={item.key} className={item.pos}>
                          <button
                            type="button"
                            onClick={() => {
                              if (isRoleLocked) return;
                              setMode("signup");
                              setSignupRole(item.key);
                            }}
                            className={`w-full rounded-3xl border border-white/15 bg-white/10 p-4 text-left shadow-[0_18px_50px_rgba(0,0,0,0.20)] backdrop-blur transition ${
                              isRoleLocked ? "cursor-not-allowed opacity-50" : "hover:-translate-y-1 hover:bg-white/15"
                            } ${
                              mode === "signup" && signupRole === item.key ? "ring-2 ring-emerald-400" : ""
                            }`}
                          >
                            <div className="mb-3 flex items-center justify-center">
                              <img src={item.img} alt={item.title} className="h-20 w-full max-w-[92%] object-contain" loading="lazy" />
                            </div>
                            <div className="text-lg font-extrabold text-white">{item.title}</div>
                            <div className="mt-1 text-xs text-white/85">{item.desc}</div>
                            <ul className="mt-2 space-y-1 text-xs text-white/90">
                              {item.bullets.map((bullet) => (
                                <li key={bullet} className="flex items-start gap-2">
                                  <span className={`mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full ${item.badge}`}>✓</span>
                                  {bullet}
                                </li>
                              ))}
                            </ul>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-8 w-full text-white/95">
                  <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
                          <path d="M9 12l2 2 4-4" />
                        </svg>
                      </span>
                      <span className="text-lg font-semibold leading-tight">{tr("trust_verified", "Verified profiles").replace("✔", "").trim()}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 6a3 3 0 103 3" />
                          <path d="M12 21a9 9 0 110-18 9 9 0 010 18z" />
                          <path d="M7.5 12h9" />
                          <path d="M12 7.5v9" />
                        </svg>
                      </span>
                      <span className="text-lg font-semibold leading-tight">{tr("trust_transparent", "Transparent partnerships").replace("✔", "").trim()}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3v18" />
                          <path d="M7 8l5-5 5 5" />
                          <path d="M7 16l5 5 5-5" />
                        </svg>
                      </span>
                      <span className="text-lg font-semibold leading-tight">{tr("trust_no_hidden", "No hidden agendas").replace("✔", "").trim()}</span>
                    </div>
                  </div>
                </div>

                <p className="mt-8 text-center text-sm font-semibold text-white/85">
                  {tr("one_platform", "One platform. One journey. Real connections that matter.")}
                </p>

                {studentScanFlow && (
                  <div className="mx-auto mt-5 max-w-2xl rounded-2xl border border-emerald-200/40 bg-emerald-500/15 px-4 py-3 text-center text-sm text-white">
                    {tr(
                      "auth.student_scan_notice",
                      "You scanned a student QR. Sign in as a School, Agent, or Tutor and we’ll continue the connection automatically."
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section id="auth-card" className="w-full">
            <div className="mx-auto w-full max-w-[440px]">
              <div className="rounded-[28px] border border-white/45 bg-white/95 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.24)] backdrop-blur sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[1.7rem] font-bold tracking-tight text-gray-900">
                      {mode === "signin" ? tr("auth.log_in_title", "Log in") : tr("auth.create_account", "Create account")}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {mode === "signin"
                        ? tr("auth.log_in_subtitle", "Welcome back.")
                        : tr("auth.create_account_subtitle", "Sign up to start your journey")}
                    </p>
                  </div>

                  <img
                    src={APP_LOGO_URL}
                    alt={tr("brand.alt", "GreenPass Super App")}
                    className="h-10 w-auto shrink-0 sm:h-11"
                  />
                </div>

                <div className="grid grid-cols-2 rounded-2xl bg-gray-100 p-1">
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      mode === "signin" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
                    } ${isRoleLocked ? "cursor-not-allowed opacity-60" : ""}`}
                    onClick={() => {
                      if (isRoleLocked) return;
                      setMode("signin");
                    }}
                  >
                    {tr("auth.signin", "Sign in")}
                  </button>
                  <button
                    type="button"
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      mode === "signup" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
                    }`}
                    onClick={() => {
                      setMode("signup");
                      if (collaboratorInviteFlow) setSignupRole("collaborator");
                      if (agentInviteFlow || tutorInviteFlow) setSignupRole("user");
                    }}
                  >
                    {tr("auth.signup", "Sign up")}
                  </button>
                </div>

                {mode === "signup" && (
                  <div className="mt-4">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {tr("auth.choose_role", "Choose role")}
                    </label>

                    {isRoleLocked ? (
                      <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold text-emerald-800">
                            {collaboratorInviteFlow
                              ? tr("role_collaborator", "Collaborator")
                              : tr("roles.student", "Student")}
                          </div>
                          <div className="text-xs text-emerald-700">
                            {collaboratorInviteFlow
                              ? tr("auth.role_locked_invite", "This role was assigned through your invitation link.")
                              : tr("auth.role_locked_student_referral", "This signup came from an agent or tutor referral, so the role is locked to Student.")}
                          </div>
                        </div>
                        <div className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                          {tr("auth.locked", "Locked")}
                        </div>
                      </div>
                    ) : (
                      <select
                        value={signupRole}
                        onChange={(e) => setSignupRole(e.target.value)}
                        className="h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-800 outline-none transition focus:border-blue-400"
                      >
                        <option value="">{tr("auth.select_role_placeholder", "Select a role...")}</option>
                        {SIGNUP_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {tr(opt.labelKey, opt.labelFallback)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <Button size="lg" variant="outline" className="h-12 w-full rounded-2xl text-base font-semibold" onClick={handleLoginGoogle} disabled={busy}>
                    <GoogleIcon />
                    {tr("auth.continue_google", "Continue with Google")}
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 w-full rounded-2xl bg-slate-950 text-base font-semibold text-white hover:bg-slate-900 hover:text-white"
                    onClick={handleLoginApple}
                    disabled={busy}
                  >
                    <span className="mr-3"></span>
                    {tr("auth.continue_apple", "Continue with Apple")}
                  </Button>
                </div>

                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-xs font-medium uppercase tracking-wide text-gray-400">
                      {tr("auth.or", "or")}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {tr("auth.email", "Email")}
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <Input
                        type="email"
                        placeholder={tr("auth.email_placeholder", "Email address")}
                        className={`h-12 rounded-2xl pl-10 pr-10 ${isValidEmail(email) && emailTaken ? "border-red-300" : ""}`}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isValidEmail(email) && emailCheck.checking && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}
                        {isValidEmail(email) && emailCheck.available === true && <Check className="h-5 w-5 text-green-600" />}
                        {isValidEmail(email) && emailTaken && <X className="h-5 w-5 text-red-500" />}
                      </div>
                    </div>
                  </div>

                  {isValidEmail(email) && emailTaken && (
                    emailIsGoogleOnly ? (
                      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                        <GoogleIcon className="mr-0 h-4 w-4" />
                        {tr("auth.email_google_only", "This email is already registered with Google. Please use Continue with Google.")}
                      </div>
                    ) : emailIsAppleOnly ? (
                      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                        <span className="inline-block text-base leading-none"></span>
                        {tr("auth.email_apple_only", "This email is already registered with Apple. Please use Continue with Apple.")}
                      </div>
                    ) : (
                      <p className="text-xs text-red-600">
                        {tr("auth.email_already_registered_simple", "This email is already registered. Try signing in with your existing method.")}
                      </p>
                    )
                  )}

                  {emailCheck.error && <p className="text-xs text-amber-600">{emailCheck.error}</p>}

                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {tr("auth.password", "Password")}
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                      <Input
                        type={mode === "signin" ? (showSigninPw ? "text" : "password") : (showPw ? "text" : "password")}
                        placeholder={tr("auth.password_placeholder", "Password")}
                        className={`h-12 rounded-2xl pl-10 pr-10 ${mode === "signup" && password && !pwStatus.ok ? "border-red-300" : ""}`}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => (mode === "signin" ? setShowSigninPw((v) => !v) : setShowPw((v) => !v))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
                      >
                        {mode === "signin"
                          ? (showSigninPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />)
                          : (showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />)}
                      </button>
                    </div>
                  </div>

                  {mode === "signup" && (
                    <>
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs leading-5">
                        <div className="mb-1 font-medium text-gray-700">
                          {tr("auth.password_requirements_label", "Password requirements:")}
                        </div>
                        <ul className="ml-1 space-y-1">
                          <RuleRow ok={pwStatus.lengthOK} label={tr("auth.pw_rule_len", "Minimum length: 8 characters")} />
                          <RuleRow ok={pwStatus.hasUpper} label={tr("auth.pw_rule_upper", "At least 1 capital letter")} />
                          <RuleRow ok={pwStatus.hasNumber} label={tr("auth.pw_rule_number", "At least 1 number")} />
                          <RuleRow ok={pwStatus.hasSpecial} label={tr("auth.pw_rule_special", "At least 1 special character")} />
                        </ul>
                      </div>

                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {tr("auth.confirm_password", "Confirm password")}
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                          <Input
                            type={showConfirm ? "text" : "password"}
                            placeholder={tr("auth.confirm_password_placeholder", "Confirm password")}
                            className="h-12 rounded-2xl pl-10 pr-10"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700"
                          >
                            {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {mode === "signin" && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-sm font-medium text-blue-700 hover:text-blue-600"
                        disabled={busy}
                      >
                        {tr("auth.forgot_password", "Forgot password?")}
                      </button>
                    </div>
                  )}

                  <Button
                    size="lg"
                    className="h-12 w-full rounded-2xl bg-blue-500 text-base font-semibold text-white hover:bg-blue-600"
                    onClick={mode === "signin" ? handleSignInEmail : handleSignUpEmail}
                    disabled={busy || (mode === "signup" ? !canSubmitSignup : false)}
                  >
                    {mode === "signin" ? tr("auth.log_in_title", "Log in") : tr("auth.create_account", "Create account")}
                  </Button>

                  <p className="text-center text-sm text-gray-500">
                    {studentScanFlow
                      ? tr("auth.after_login_student_scan_note", "After login, we’ll continue the scanned student connection automatically.")
                      : tr("auth.after_login_note", "After login, you will continue inside the GreenPass app.")}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-white/45 bg-white/95 px-5 py-4 text-center text-sm text-gray-700 shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
                {mode === "signin" ? tr("auth.no_account", "Don’t have an account?") : tr("auth.have_account", "Have an account?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    if (isRoleLocked && mode === "signup") return;
                    setMode(mode === "signin" ? "signup" : "signin");
                  }}
                  className="font-semibold text-blue-700 hover:text-blue-600"
                >
                  {mode === "signin" ? tr("auth.signup", "Sign up") : tr("auth.signin", "Sign in")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      <InfoDialog
        open={dialog.open}
        title={dialog.title}
        message={dialog.message}
        okLabel={tr("common.ok", "OK")}
        onClose={() => setDialog({ open: false, title: "", message: "" })}
      />
    </div>
  );
}