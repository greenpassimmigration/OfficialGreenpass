import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams, useNavigate } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
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
import { auth, db } from "@/firebase";

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();

  // GreenPass role standard:
  // role = active/current role source of truth.
  // user = student/general user in the app.
  if (role === "student") return "user";
  if (role === "institution") return "school";
  if (role === "provider") return "vendor";

  if (["user", "agent", "tutor", "school", "vendor", "collaborator"].includes(role)) {
    return role;
  }

  return "user";
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

function buildCollaboratorReferralFields(refCode = "", referredByUid = "") {
  const code = String(refCode || "").trim();
  if (!code) return {};

  return {
    referred_by_collaborator_code: code,
    referred_by_collaborator_uid: referredByUid || "",
    referred_by_collaborator_at: serverTimestamp(),
  };
}

const PENDING_REFERRAL_STORAGE_KEY = "gp_pending_referral_context";

function cleanToken(value) {
  return String(value || "").trim();
}

function hasReferralContext(ctx = {}) {
  return Boolean(
    cleanToken(ctx?.ref) ||
      cleanToken(ctx?.student_ref) ||
      cleanToken(ctx?.agent_ref) ||
      cleanToken(ctx?.tutor_ref)
  );
}

function persistReferralContext(ctx = {}) {
  if (typeof window === "undefined" || !hasReferralContext(ctx)) return;

  const payload = {};
  if (cleanToken(ctx?.ref)) payload.ref = cleanToken(ctx.ref);
  if (cleanToken(ctx?.student_ref)) payload.student_ref = cleanToken(ctx.student_ref);
  if (cleanToken(ctx?.agent_ref)) payload.agent_ref = cleanToken(ctx.agent_ref);
  if (cleanToken(ctx?.tutor_ref)) payload.tutor_ref = cleanToken(ctx.tutor_ref);
  if (cleanToken(ctx?.role)) payload.role = cleanToken(ctx.role);

  try {
    window.sessionStorage.setItem(
      PENDING_REFERRAL_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {}

  try {
    window.localStorage.setItem(
      PENDING_REFERRAL_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {}
}

function readStoredReferralContext() {
  if (typeof window === "undefined") return {};

  let raw = "";
  try {
    raw = window.sessionStorage.getItem(PENDING_REFERRAL_STORAGE_KEY) || "";
  } catch {}

  if (!raw) {
    try {
      raw = window.localStorage.getItem(PENDING_REFERRAL_STORAGE_KEY) || "";
    } catch {}
  }

  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return {
      ref: cleanToken(parsed?.ref),
      student_ref: cleanToken(parsed?.student_ref),
      agent_ref: cleanToken(parsed?.agent_ref),
      tutor_ref: cleanToken(parsed?.tutor_ref),
      role: cleanToken(parsed?.role),
    };
  } catch {
    return {};
  }
}

function buildReferralContextFromSearch(search) {
  if (!search) return {};
  return {
    ref: cleanToken(search.get("ref")),
    student_ref: cleanToken(search.get("student_ref")),
    agent_ref: cleanToken(search.get("agent_ref")),
    tutor_ref: cleanToken(search.get("tutor_ref")),
    role: cleanToken(search.get("role") || search.get("userType")),
  };
}

function getMergedReferralContext(current = {}) {
  const stored = readStoredReferralContext();
  const merged = {
    ref: cleanToken(current?.ref) || cleanToken(stored?.ref),
    student_ref: cleanToken(current?.student_ref) || cleanToken(stored?.student_ref),
    agent_ref: cleanToken(current?.agent_ref) || cleanToken(stored?.agent_ref),
    tutor_ref: cleanToken(current?.tutor_ref) || cleanToken(stored?.tutor_ref),
    role: cleanToken(current?.role) || cleanToken(stored?.role),
  };

  if (hasReferralContext(merged)) {
    persistReferralContext(merged);
  }

  return merged;
}

function clearStoredReferralContext() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
  } catch {}
  try {
    window.localStorage.removeItem(PENDING_REFERRAL_STORAGE_KEY);
  } catch {}
  try {
    window.localStorage.removeItem("gp_collaborator_ref");
    window.localStorage.removeItem("gp_agent_ref");
    window.localStorage.removeItem("gp_tutor_ref");
    window.localStorage.removeItem("gp_student_ref");
  } catch {}
}

export default function AuthBridge() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const role = params.get("role");
  const navigate = useNavigate();

  const code = params.get("code");
  const lang = params.get("lang") || "en";
  const nextHint = params.get("next") || "";
  const collaboratorRef = String(params.get("ref") || "").trim();
  const studentRef = String(params.get("student_ref") || "").trim();
  const agentRef = String(params.get("agent_ref") || "").trim();
  const tutorRef = String(params.get("tutor_ref") || "").trim();

  const [status, setStatus] = React.useState("…");

  const safeInternalPath = (p) => {
    if (!p) return null;
    if (typeof p !== "string") return null;
    if (!p.startsWith("/")) return null;
    if (p.startsWith("//")) return null;
    if (p.includes("http://") || p.includes("https://")) return null;
    return p;
  };

  const appendQuery = (path, queryObj) => {
    try {
      const u = new URL(path, window.location.origin);
      Object.entries(queryObj || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") return;
        u.searchParams.set(k, String(v));
      });
      return u.pathname + (u.search ? u.search : "");
    } catch {
      return path;
    }
  };

  const exchangeUrl =
    import.meta.env?.VITE_EXCHANGE_AUTH_BRIDGE_URL ||
    "https://us-central1-greenpass-dc92d.cloudfunctions.net/exchangeAuthBridgeCode";

  React.useEffect(() => {
    try {
      localStorage.setItem("i18nextLng", lang);
      localStorage.setItem("gp_lang", lang);
      const currentReferral = buildReferralContextFromSearch(params);
      if (hasReferralContext(currentReferral)) {
        persistReferralContext(currentReferral);
      } else {
        getMergedReferralContext(currentReferral);
      }
    } catch {}
    if (i18n?.language !== lang) {
      i18n.changeLanguage(lang).catch(() => {});
    }
  }, [lang, i18n, params]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setStatus(t("authBridge.status_exchanging", "Exchanging sign-in code…"));

        if (!code) {
          setStatus(t("authBridge.status_missing_code", "Missing sign-in code."));
          navigate(`/login?mode=login&lang=${encodeURIComponent(lang)}`, { replace: true });
          return;
        }

        const res = await fetch(exchangeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`exchangeAuthBridgeCode failed (${res.status}): ${txt}`);
        }

        const data = await res.json().catch(() => ({}));
        const customToken = data?.customToken || data?.token;
        if (!customToken) throw new Error("No customToken returned from exchangeAuthBridgeCode.");
        if (cancelled) return;

        setStatus(t("authBridge.status_signing_in", "Signing you in…"));
        await signInWithCustomToken(auth, customToken);
        if (cancelled) return;

        const fbUser = auth.currentUser;
        if (!fbUser?.uid) throw new Error("Signed in but auth.currentUser is missing.");

        setStatus(t("authBridge.status_checking_profile", "Checking your profile…"));

        const userRef = doc(db, "users", fbUser.uid);
        const snap = await getDoc(userRef);

        const mergedReferral = getMergedReferralContext(
          buildReferralContextFromSearch(params)
        );

        const storedRef = cleanToken(mergedReferral.ref);
        const storedStudentRef = cleanToken(mergedReferral.student_ref);
        const storedAgentRef = cleanToken(mergedReferral.agent_ref);
        const storedTutorRef = cleanToken(mergedReferral.tutor_ref);
        const storedRole = cleanToken(mergedReferral.role);
        const effectiveRole = storedRole || role || "";

        const referredByCollaboratorUid = await resolveCollaboratorRef(storedRef);

        const hint = safeInternalPath(nextHint);
        const isHintMeaningful = !!(hint && hint !== "/onboarding" && hint !== "/dashboard");

        let goTo = "/dashboard";

        if (!snap.exists()) {
          const normalizedRole = normalizeRole(effectiveRole);

          await setDoc(
            userRef,
            {
              uid: fbUser.uid,
              email: fbUser.email || "",
              emailLower: (fbUser.email || "").toLowerCase(),
              full_name: fbUser.displayName || "",
              role: normalizedRole,
              signup_entry_role: normalizedRole,
              onboarding_completed: false,
              onboarding_step: "basic_info",
              ...buildCollaboratorReferralFields(storedRef, referredByCollaboratorUid),
              created_at: serverTimestamp(),
              updated_at: serverTimestamp(),
            },
            { merge: true }
          );

          goTo = isHintMeaningful
            ? appendQuery("/onboarding", {
              next: hint,
              lang,
              role: effectiveRole || undefined,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            })
            : appendQuery("/onboarding", {
              lang,
              role: effectiveRole || undefined,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            });
        } else {
          const u = snap.data() || {};
          const completed = u.onboarding_completed === true;

          const normalizedRole = normalizeRole(effectiveRole || u.role || "");

          // Keep existing users clean in the role-only model.
          // We only write role + signup_entry_role. Old aliases like user_type,
          // userType, and selected_role are no longer written by this bridge.
          if (normalizedRole && u.role !== normalizedRole) {
            await setDoc(
              userRef,
              {
                role: normalizedRole,
                signup_entry_role: u.signup_entry_role || normalizedRole,
                updated_at: serverTimestamp(),
              },
              { merge: true }
            );
          }

          if (storedRef && !u.referred_by_collaborator_code) {
            await setDoc(
              userRef,
              {
                ...buildCollaboratorReferralFields(
                  storedRef,
                  u.referred_by_collaborator_uid || referredByCollaboratorUid
                ),
                updated_at: serverTimestamp(),
              },
              { merge: true }
            );
          }

          if (!completed) {
            goTo = isHintMeaningful
              ? appendQuery("/onboarding", {
              next: hint,
              lang,
              role: effectiveRole || undefined,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            })
              : appendQuery("/onboarding", {
              lang,
              role: effectiveRole || undefined,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            });
          } else {
            goTo = hint
              ? appendQuery(hint, {
              lang,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            })
              : appendQuery("/dashboard", {
              lang,
              ref: storedRef || undefined,
              student_ref: storedStudentRef || undefined,
              agent_ref: storedAgentRef || undefined,
              tutor_ref: storedTutorRef || undefined,
            });
          }
        }

        if (cancelled) return;

        setStatus(t("authBridge.status_redirecting", "Redirecting…"));
        window.location.replace(goTo);
      } catch (err) {
        console.error("[AuthBridge] error:", err);
        if (cancelled) return;

        setStatus(t("authBridge.status_failed_redirecting", "Sign-in failed. Redirecting to login…"));
        setTimeout(() => {
          const fallbackParams = new URLSearchParams();
          fallbackParams.set("mode", "login");
          fallbackParams.set("lang", lang);
          fallbackParams.set("bridge", "fail");

          const mergedReferral = getMergedReferralContext(
            buildReferralContextFromSearch(params)
          );

          if (cleanToken(mergedReferral.ref)) fallbackParams.set("ref", cleanToken(mergedReferral.ref));
          if (cleanToken(mergedReferral.student_ref)) fallbackParams.set("student_ref", cleanToken(mergedReferral.student_ref));
          if (cleanToken(mergedReferral.agent_ref)) fallbackParams.set("agent_ref", cleanToken(mergedReferral.agent_ref));
          if (cleanToken(mergedReferral.tutor_ref)) fallbackParams.set("tutor_ref", cleanToken(mergedReferral.tutor_ref));
          if (cleanToken(mergedReferral.role)) fallbackParams.set("role", cleanToken(mergedReferral.role));

          navigate(`/login?${fallbackParams.toString()}`, {
            replace: true,
          });
        }, 600);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [code, exchangeUrl, lang, nextHint, navigate, role, t, collaboratorRef, params]);

  return (
    <div
      style={{
        minHeight: "60vh",
        padding: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div className="gp-spinner" aria-label={t("authBridge.aria_loading", "Loading")} />
      <div style={{ fontSize: 14, color: "#555", textAlign: "center" }}>{status}</div>

      <style>{`
        .gp-spinner {
          width: 52px;
          height: 52px;
          border-radius: 999px;
          border: 4px solid rgba(0, 0, 0, 0.12);
          border-top-color: rgba(0, 0, 0, 0.55);
          animation: gp-spin 0.9s linear infinite;
        }
        @keyframes gp-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}