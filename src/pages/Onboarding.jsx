// src/pages/Onboarding.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  Loader2,
  User as UserIcon,
  Briefcase,
  BookOpen,
  Building,
  Store,
  ArrowRight,
  Check,
  ArrowLeft,
  LogOut,
  BadgeCheck,
  CreditCard,
  ShieldCheck,
  ChevronsUpDown,
  Users,
} from "lucide-react";

import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Firebase
import { auth, db } from "@/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";
import SharedPaymentGateway from "@/components/payments/SharedPaymentGateway";
import {
  getDefaultPlanIdForRole,
  getPlanById,
  getPlansForRole,
  formatPlanPrice,
} from "@/config/subscriptionPlans";

async function linkAgentClient({ agentUid, studentUid, inviteId = "" }) {
  if (!agentUid || !studentUid) return;

  const relId = `${agentUid}_${studentUid}`;

  await setDoc(
    doc(db, "agent_clients", relId),
    {
      agent_id: agentUid,
      student_id: studentUid,
      client_id: studentUid,
      status: "active",
      source: "invite",
      referralType: "invite",
      acceptedByAgent: false,
      assignmentLocked: false,
      inviteId: inviteId || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Prevent open-redirects: only allow internal paths like '/accept-org-invite?...'
function safeInternalPath(p) {
  if (!p || typeof p !== "string") return "";
  if (!p.startsWith("/")) return "";
  if (p.startsWith("//")) return "";
  if (p.includes("http://") || p.includes("https://")) return "";
  return p;
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

const STEPS = {
  CHOOSE_ROLE: "choose_role",
  BASIC_INFO: "basic_info",
  SUBSCRIPTION: "subscription",
  COMPLETE: "complete",
};

const buildRoleOptions = (tr) => [
  {
    type: "user",
    title: tr("onboarding.roles.student.title", "Student"),
    subtitle: tr("onboarding.roles.student.subtitle", "I want to study abroad"),
    description:
      "Find schools, get visa help, connect with tutors, and manage your study abroad journey",
    icon: <UserIcon className="w-8 h-8" />,
    color: "bg-blue-500",
    benefits: [
      "Access to thousands of programs",
      "Free counselor matching",
      "Visa application support",
      "Test prep resources",
    ],
  },
  {
    type: "agent",
    title: tr("onboarding.roles.agent.title", "Education Agent"),
    subtitle: tr("onboarding.roles.agent.subtitle", "I help students study abroad"),
    description:
      "Connect with students, manage applications, earn commissions, and grow your agency",
    icon: <Briefcase className="w-8 h-8" />,
    color: "bg-purple-500",
    benefits: ["Student referral system", "Commission tracking", "Case management tools", "Marketing support"],
  },
  {
    type: "tutor",
    title: tr("onboarding.roles.tutor.title", "Tutor"),
    subtitle: tr("onboarding.roles.tutor.subtitle", "I teach test prep & languages"),
    description: "Offer tutoring services, manage sessions, earn income teaching students",
    icon: <BookOpen className="w-8 h-8" />,
    color: "bg-green-500",
    benefits: ["Online session platform", "Student matching", "Payment processing", "Schedule management"],
  },
  {
    type: "school",
    title: tr("onboarding.roles.school.title", "Educational Institution"),
    subtitle: tr("onboarding.roles.school.subtitle", "I represent a school/college"),
    description: "Promote programs, connect with students, manage applications and enrollments",
    icon: <Building className="w-8 h-8" />,
    color: "bg-indigo-500",
    benefits: ["Program listings", "Student inquiries", "Application management", "Marketing tools"],
  },
  {
    type: "vendor",
    title: tr("onboarding.roles.vendor.title", "Service Provider"),
    subtitle: tr("onboarding.roles.vendor.subtitle", "I offer student services"),
    description: "Provide services like transport, SIM cards, accommodation to international students",
    icon: <Store className="w-8 h-8" />,
    color: "bg-orange-500",
    benefits: ["Service marketplace", "Order management", "Payment processing", "Customer reviews"],
  },
];

// Country helpers
const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

const getAllCountriesIntl = () => {
  try {
    if (typeof Intl === "undefined") return [];
    if (!Intl.supportedValuesOf) return [];

    const codes = Intl.supportedValuesOf("region") || [];
    const dn = Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

    return codes
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => ({
        code,
        name: dn?.of(code) || code,
        flagUrl: flagUrlFromCode(code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
};

async function getAllCountriesFallback() {
  const res = await fetch("https://restcountries.com/v3.1/all?fields=name,cca2");
  const json = await res.json();

  return (json || [])
    .filter((x) => x?.cca2 && /^[A-Z]{2}$/.test(x.cca2))
    .map((x) => ({
      code: x.cca2,
      name: x?.name?.common || x.cca2,
      flagUrl: flagUrlFromCode(x.cca2),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function CountrySelect({ valueCode, valueName, onChange }) {
  const { t: tr } = useTranslation();

  const [open, setOpen] = React.useState(false);
  const [countries, setCountries] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        const intlList = getAllCountriesIntl();
        if (alive && intlList.length) {
          setCountries(intlList);
          return;
        }

        const apiList = await getAllCountriesFallback();
        if (alive) setCountries(apiList);
      } catch (e) {
        console.error("Country list load failed:", e);
        if (alive) setCountries([]);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, []);

  const selected = React.useMemo(() => {
    const byCode = valueCode && countries.find((c) => c.code === valueCode.toUpperCase());
    if (byCode) return byCode;

    const n = (valueName || "").trim().toLowerCase();
    if (!n) return null;

    return (
      countries.find((c) => c.name.toLowerCase() === n) ||
      countries.find((c) => c.name.toLowerCase().startsWith(n)) ||
      null
    );
  }, [countries, valueCode, valueName]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between mt-1">
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                {selected.flagUrl ? (
                  <img
                    src={selected.flagUrl}
                    alt={`${selected.name} flag`}
                    width={20}
                    height={15}
                    className="rounded-[2px] border"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              <span className="text-gray-500">{tr("onboarding.placeholders.select_country","Select your country")}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={tr("onboarding.fields.search_country", "Search country...")} />
          <CommandList className="max-h-72">
            {loading && (
              <div className="p-3 text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {tr("onboarding.country.loading","Loading countries...")}
              </div>
            )}

            {!loading && <CommandEmpty>{tr("onboarding.country.no_results","No country found.")}</CommandEmpty>}

            <CommandGroup>
              {countries.map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  {c.flagUrl ? (
                    <img
                      src={c.flagUrl}
                      alt={`${c.name} flag`}
                      width={20}
                      height={15}
                      className="rounded-[2px] border"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const PUBLIC_ROLES = ["user", "agent", "tutor", "school", "vendor"];
const ALL_SUPPORTED_ROLES = [...PUBLIC_ROLES, "collaborator"];
const DEFAULT_ROLE = "user";

const normalizeRole = (r) => {
  const v = (r || "").toString().trim().toLowerCase();
  return ALL_SUPPORTED_ROLES.includes(v) ? v : DEFAULT_ROLE;
};

function buildRoleFields(role, { preserveSignupEntry = false, existingSignupEntry = "" } = {}) {
  const finalRole = normalizeRole(role);

  return {
    role: finalRole,
    signup_entry_role: preserveSignupEntry
      ? existingSignupEntry || finalRole
      : finalRole,
  };
}

function buildUserDefaults({
  email,
  full_name = "",
  role = DEFAULT_ROLE,
  collaboratorRef = "",
}) {
  const finalRole = normalizeRole(role);
  const defaultPlanId = getDefaultPlanIdForRole(finalRole);
  const defaultPlan = getPlanById(defaultPlanId);

  const collaboratorFields =
    finalRole === "collaborator" && collaboratorRef
      ? {
          referred_by_collaborator_code: collaboratorRef,
          referred_by_collaborator_at: serverTimestamp(),
        }
      : {};

  return {
    ...buildRoleFields(finalRole),
    email,
    full_name,
    phone: "",
    country: "",
    country_code: "",
    bio: "",
    address: { street: "", ward: "", district: "", province: "", postal_code: "" },
    profile_picture: "",
    is_verified: false,
    onboarding_completed: false,
    onboarding_step: finalRole === "collaborator" ? STEPS.BASIC_INFO : STEPS.CHOOSE_ROLE,

    subscription_active: false,
    subscription_status: "none",
    subscription_provider: "paypal",
    subscription_plan: defaultPlanId || "",
    subscription_interval: defaultPlan?.interval || "",
    subscription_amount: Number(defaultPlan?.amount || 0),
    subscription_currency: defaultPlan?.currency || "USD",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    ...collaboratorFields,
  };
}

function buildStudentScanUrl(studentRef) {
  const token = String(studentRef || "").trim();
  if (!token) return "";
  return `/scan/student?student_ref=${encodeURIComponent(token)}`;
}

function buildPolicyCenterUrl(studentRef = "") {
  const token = String(studentRef || "").trim();
  if (!token) return `/${createPageUrl("PolicyCenter")}`;
  const qp = new URLSearchParams();
  qp.set("student_ref", token);
  return `/${createPageUrl("PolicyCenter")}?${qp.toString()}`;
}

function buildDashboardUrl(studentRef = "") {
  const token = String(studentRef || "").trim();
  if (!token) return createPageUrl("Dashboard");
  return buildStudentScanUrl(token);
}

export default function Onboarding() {
  const { t } = useTranslation();
  const tr = React.useCallback((key, def, opts = {}) => t(key, { defaultValue: def, ...opts }), [t]);
  const publicRoleOptions = React.useMemo(() => buildRoleOptions(tr), [tr]);

  const collaboratorRoleOption = useMemo(
    () => ({
      type: "collaborator",
      title: tr("onboarding.roles.collaborator.title", "Collaborator"),
      subtitle: tr("onboarding.roles.collaborator.subtitle", "I was invited to help grow GreenPass"),
      description: tr(
        "onboarding.roles.collaborator.description",
        "Invite users, support onboarding, and help build the GreenPass community through your referral link."
      ),
      icon: <Users className="w-8 h-8" />,
      color: "bg-emerald-600",
      benefits: [
        tr("onboarding.roles.collaborator.benefit_1", "Referral tracking"),
        tr("onboarding.roles.collaborator.benefit_2", "Tier progression"),
        tr("onboarding.roles.collaborator.benefit_3", "Verified user rewards"),
        tr("onboarding.roles.collaborator.benefit_4", "Community growth tools"),
      ],
    }),
    [tr]
  );

  const navigate = useNavigate();
  const { subscriptionModeEnabled, loading: subscriptionModeLoading } = useSubscriptionMode();

  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const nextRaw = useMemo(() => params.get("next") || "", [params]);
  const next = useMemo(() => safeInternalPath(nextRaw), [nextRaw]);

  const mergedReferralContext = useMemo(
    () => getMergedReferralContext(buildReferralContextFromSearch(params)),
    [params]
  );

  const collaboratorRef = useMemo(() => {
    return cleanToken(mergedReferralContext?.ref);
  }, [mergedReferralContext]);

  const agentRef = useMemo(() => {
    return cleanToken(mergedReferralContext?.agent_ref);
  }, [mergedReferralContext]);

  const tutorRef = useMemo(() => {
    return cleanToken(mergedReferralContext?.tutor_ref);
  }, [mergedReferralContext]);

  const studentRef = useMemo(() => {
    return cleanToken(mergedReferralContext?.student_ref);
  }, [mergedReferralContext]);

  const urlRoleRaw = useMemo(() => {
    const raw =
      params.get("role") ??
      params.get("userType") ??
      mergedReferralContext?.role;
    return raw && String(raw).trim() ? String(raw).trim() : null;
  }, [params, mergedReferralContext]);

  const collaboratorInviteFlow = useMemo(() => {
    const role = (urlRoleRaw || "").toString().trim().toLowerCase();
    return role === "collaborator" && !!collaboratorRef;
  }, [urlRoleRaw, collaboratorRef]);

  const urlRole = useMemo(() => {
    if (collaboratorInviteFlow) return "collaborator";
    return urlRoleRaw ? normalizeRole(urlRoleRaw) : null;
  }, [urlRoleRaw, collaboratorInviteFlow]);

  const urlLock = useMemo(() => {
    const v = (params.get("lock") || params.get("locked") || "").toString();
    if (collaboratorInviteFlow) return true;
    if (agentRef || tutorRef) return true;
    return v === "1" || v.toLowerCase() === "true";
  }, [params, collaboratorInviteFlow, agentRef, tutorRef]);

  const sessionRoleRaw = useMemo(() => {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem("onboarding_role");
    return v && String(v).trim() ? String(v).trim() : null;
  }, []);

  const sessionRole = useMemo(() => {
    if (collaboratorInviteFlow) return "collaborator";
    return sessionRoleRaw ? normalizeRole(sessionRoleRaw) : null;
  }, [sessionRoleRaw, collaboratorInviteFlow]);

  const sessionLock = useMemo(() => {
    if (typeof window === "undefined") return false;
    if (collaboratorInviteFlow) return true;
    return sessionStorage.getItem("onboarding_role_locked") === "1";
  }, [collaboratorInviteFlow]);

  const rolePreselected = useMemo(() => Boolean(urlRole || sessionRole), [urlRole, sessionRole]);

  const roleHintFromEntry = useMemo(() => {
    if (collaboratorInviteFlow) return "collaborator";
    if (agentRef || tutorRef || studentRef) return "user";
    if (urlRole) return urlRole;
    if (sessionRole) return sessionRole;
    return DEFAULT_ROLE;
  }, [urlRole, sessionRole, collaboratorInviteFlow, agentRef, tutorRef, studentRef]);

  const roleLockedFromEntry = useMemo(() => {
    if (collaboratorInviteFlow) return true;
    return Boolean(urlLock || sessionLock || rolePreselected);
  }, [urlLock, sessionLock, rolePreselected, collaboratorInviteFlow]);

  const roleHintRef = useRef(roleHintFromEntry);
  const roleLockedRef = useRef(roleLockedFromEntry);
  useEffect(() => {
    roleHintRef.current = roleHintFromEntry;
    roleLockedRef.current = roleLockedFromEntry;
  }, [roleHintFromEntry, roleLockedFromEntry]);

  const formDirtyRef = useRef(false);

  const [skipChooseRole, setSkipChooseRole] = useState(roleLockedFromEntry);
  const [currentStep, setCurrentStep] = useState(roleLockedFromEntry ? STEPS.BASIC_INFO : STEPS.CHOOSE_ROLE);
  const [selectedRole, setSelectedRole] = useState(roleHintFromEntry || null);
  const [selectedPlanId, setSelectedPlanId] = useState(getDefaultPlanIdForRole(roleHintFromEntry || DEFAULT_ROLE));
  const [formData, setFormData] = useState({});
  const [profile, setProfile] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [paypalError, setPaypalError] = useState("");
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const rolePlanOptions = useMemo(() => {
    return getPlansForRole(selectedRole || DEFAULT_ROLE);
  }, [selectedRole]);

  const selectedPlan = useMemo(() => {
    const planFromState = getPlanById(selectedPlanId);
    if (planFromState && planFromState.role === selectedRole) return planFromState;

    const fallbackPlanId = getDefaultPlanIdForRole(selectedRole || DEFAULT_ROLE);
    return getPlanById(fallbackPlanId);
  }, [selectedPlanId, selectedRole]);

  useEffect(() => {
    const validPlanForRole = getPlanById(selectedPlanId);
    if (!selectedRole) return;

    if (!validPlanForRole || validPlanForRole.role !== selectedRole) {
      setSelectedPlanId(getDefaultPlanIdForRole(selectedRole));
    }
  }, [selectedRole, selectedPlanId]);

  const subscriptionRequired = useMemo(() => {
    if (!selectedRole) return false;
    if (selectedRole === "user") return false;
    if (selectedRole === "collaborator") return false;
    if (selectedRole === "vendor") return false;
    return subscriptionModeEnabled;
  }, [selectedRole, subscriptionModeEnabled]);

  const STEP_ORDER = useMemo(() => {
    const core =
      selectedRole === "user" || selectedRole === "collaborator" || selectedRole === "vendor"
        ? [STEPS.BASIC_INFO, STEPS.COMPLETE]
        : subscriptionRequired
          ? [STEPS.BASIC_INFO, STEPS.SUBSCRIPTION, STEPS.COMPLETE]
          : [STEPS.BASIC_INFO, STEPS.COMPLETE];

    return skipChooseRole ? core : [STEPS.CHOOSE_ROLE, ...core];
  }, [selectedRole, skipChooseRole, subscriptionRequired]);

  const getStepProgress = () => {
    const idx = Math.max(0, STEP_ORDER.indexOf(currentStep));
    const total = Math.max(1, STEP_ORDER.length - 1);
    return Math.round((idx / total) * 100);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (collaboratorInviteFlow) {
        sessionStorage.setItem("onboarding_role", "collaborator");
        sessionStorage.setItem("onboarding_role_locked", "1");
      } else if (agentRef || tutorRef || studentRef) {
        sessionStorage.setItem("onboarding_role", "user");
        sessionStorage.setItem("onboarding_role_locked", "1");
      }

      if (hasReferralContext(mergedReferralContext)) {
        persistReferralContext(mergedReferralContext);
      }
    } catch {}
  }, [collaboratorInviteFlow, agentRef, tutorRef, studentRef, mergedReferralContext]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        navigate(
          studentRef
            ? `${createPageUrl("Welcome")}?student_ref=${encodeURIComponent(studentRef)}`
            : createPageUrl("Welcome"),
          { replace: true }
        );
        return;
      }

      const entryRoleHint = roleHintRef.current;
      const entryRoleLocked = roleLockedRef.current;

      const ref = doc(db, "users", fbUser.uid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        await setDoc(
          ref,
          buildUserDefaults({
            email: fbUser.email || "",
            full_name: fbUser.displayName || "",
            role: entryRoleHint,
            collaboratorRef,
          })
        );
      }

      const finalSnap = await getDoc(ref);
      const data = finalSnap.data() || {};
      setProfile(data);

      const profileRoleRaw = data.role || DEFAULT_ROLE;

      const roleFromProfile = collaboratorInviteFlow
        ? "collaborator"
        : normalizeRole(profileRoleRaw);

      const hasRoleInProfile = Boolean(data.role);

      setSkipChooseRole(entryRoleLocked || hasRoleInProfile);
      const effectiveRole = entryRoleLocked
        ? normalizeRole(entryRoleHint)
        : roleFromProfile;

      let nextStep = data.onboarding_completed ? STEPS.COMPLETE : data.onboarding_step || STEPS.CHOOSE_ROLE;

      if (entryRoleLocked && nextStep === STEPS.CHOOSE_ROLE) {
        nextStep = STEPS.BASIC_INFO;
        await updateDoc(ref, {
          ...buildRoleFields(effectiveRole),
          onboarding_step: STEPS.BASIC_INFO,
          ...(collaboratorInviteFlow && collaboratorRef
            ? {
                referred_by_collaborator_code:
                  data.referred_by_collaborator_code || collaboratorRef,
                referred_by_collaborator_at:
                  data.referred_by_collaborator_at || serverTimestamp(),
              }
            : {}),
          updatedAt: serverTimestamp(),
        });
      } else if (!entryRoleLocked && hasRoleInProfile && nextStep === STEPS.CHOOSE_ROLE) {
        nextStep = STEPS.BASIC_INFO;
        await updateDoc(ref, { onboarding_step: STEPS.BASIC_INFO, updatedAt: serverTimestamp() });
      } else {
        const needsRoleSync =
          entryRoleLocked &&
          data.role !== effectiveRole;

        if (
          needsRoleSync ||
          (collaboratorInviteFlow && collaboratorRef && !data.referred_by_collaborator_code)
        ) {
          await updateDoc(ref, {
            ...buildRoleFields(effectiveRole, {
              preserveSignupEntry: true,
              existingSignupEntry: data.signup_entry_role,
            }),
            ...(collaboratorInviteFlow && collaboratorRef
              ? {
                  referred_by_collaborator_code:
                    data.referred_by_collaborator_code || collaboratorRef,
                  referred_by_collaborator_at:
                    data.referred_by_collaborator_at || serverTimestamp(),
                }
              : {}),
            updatedAt: serverTimestamp(),
          });
        }
      }

      setSelectedRole(effectiveRole);

      const storedPlanId =
        typeof data.subscription_plan === "string" && data.subscription_plan.trim()
          ? data.subscription_plan.trim()
          : getDefaultPlanIdForRole(effectiveRole);

      const storedPlan = getPlanById(storedPlanId);
      setSelectedPlanId(
        storedPlan && storedPlan.role === effectiveRole
          ? storedPlanId
          : getDefaultPlanIdForRole(effectiveRole)
      );

      setCurrentStep(nextStep);

      setFormData((prev) => {
        if (formDirtyRef.current) return prev;

        return {
          full_name: data.full_name || fbUser.displayName || "",
          phone: data.phone || "",
          country: data.country || "",
          country_code: data.country_code || "",
          email: data.email || fbUser.email || "",
        };
      });

      if (data.onboarding_completed) {
        try {
          sessionStorage.removeItem("onboarding_role_locked");
          sessionStorage.removeItem("onboarding_role");
          clearStoredReferralContext();
        } catch {}

        navigate(
          data?.policy_acceptance?.completed === true
            ? next || buildDashboardUrl(studentRef)
            : buildPolicyCenterUrl(studentRef),
          { replace: true }
        );
        return;
      }

      setProfileLoading(false);
      setAuthChecked(true);
    });

    return () => unsub();
  }, [navigate, next, collaboratorInviteFlow, collaboratorRef, studentRef]);

  const handleRoleSelect = async (roleType) => {
    if (roleLockedFromEntry) return;

    const defaultPlanId = getDefaultPlanIdForRole(roleType);

    setSelectedRole(roleType);
    setSelectedPlanId(defaultPlanId);
    setCurrentStep(STEPS.BASIC_INFO);

    if (auth.currentUser) {
      const ref = doc(db, "users", auth.currentUser.uid);
      const defaultPlan = getPlanById(defaultPlanId);

      await updateDoc(ref, {
        ...buildRoleFields(roleType),
        onboarding_step: STEPS.BASIC_INFO,
        subscription_plan: defaultPlanId || "",
        subscription_interval: defaultPlan?.interval || "",
        subscription_amount: Number(defaultPlan?.amount || 0),
        subscription_currency: defaultPlan?.currency || "USD",
        updatedAt: serverTimestamp(),
      });
    }
  };

  const validateBasicInfo = () => !!(formData.full_name && formData.phone && formData.country);

  const finalizeOnboarding = async ({
    subscriptionActive,
    paymentProvider = "",
    paymentOrderId = "",
    paymentDetails = null,
    skipped = false,
  }) => {
    if (!auth.currentUser || !selectedRole) return;

    setSaving(true);

    try {
      const uid = auth.currentUser.uid;
      const ref = doc(db, "users", uid);

      const fallbackPlanId = getDefaultPlanIdForRole(selectedRole);
      const finalPlanId = selectedPlan?.id || fallbackPlanId || "";
      const finalPlan = selectedPlan || getPlanById(fallbackPlanId);

      const updates = {
        ...buildRoleFields(selectedRole, {
          preserveSignupEntry: true,
          existingSignupEntry: profile?.signup_entry_role,
        }),

        onboarding_completed: true,
        onboarding_step: STEPS.COMPLETE,
        updatedAt: serverTimestamp(),

        subscription_active: Boolean(subscriptionActive),
        subscription_status: subscriptionActive ? "active" : skipped ? "skipped" : "none",
        subscription_provider: paymentProvider || "paypal",
        subscription_plan: finalPlanId,
        subscription_interval: finalPlan?.interval || "",
        subscription_amount: Number(finalPlan?.amount || 0),
        subscription_currency: finalPlan?.currency || "USD",

        payment_provider: paymentProvider || "",
        payment_order_id: paymentOrderId || "",
        payment_details: paymentDetails ? paymentDetails : null,
        paypal_order_id: paymentProvider === "paypal" ? paymentOrderId || "" : "",
        paypal_capture: paymentProvider === "paypal" ? paymentDetails : null,
        stripe_session_id: paymentProvider === "stripe" ? paymentOrderId || "" : "",
        stripe_checkout: paymentProvider === "stripe" ? paymentDetails : null,
        subscribed_at: subscriptionActive ? serverTimestamp() : null,
      };

      if (selectedRole === "collaborator" || selectedRole === "vendor" || selectedRole === "user") {
        updates.subscription_active = false;
        updates.subscription_status = "none";
      }

      await updateDoc(ref, updates);

      try {
        const userSnap = await getDoc(ref);
        const userData = userSnap.data() || {};
        const invitedBy = userData?.invited_by || {};

        const agentUid =
          invitedBy?.uid ||
          userData?.assigned_agent_id ||
          userData?.assignedAgentId ||
          userData?.referred_by_agent_id ||
          userData?.referredByAgentId ||
          "";

        const isInvitedByAgent =
          String(invitedBy?.role || "").toLowerCase() === "agent";

        if (isInvitedByAgent && agentUid && uid) {
          await linkAgentClient({
            agentUid,
            studentUid: uid,
            inviteId: invitedBy?.inviteId || "",
          });
        }
      } catch (e) {
        console.error("Error linking agent client:", e);
      }

      setCurrentStep(STEPS.COMPLETE);

      try {
        sessionStorage.removeItem("onboarding_role_locked");
        sessionStorage.removeItem("onboarding_role");
        clearStoredReferralContext();
      } catch {}

      setTimeout(() => navigate(buildPolicyCenterUrl(studentRef), { replace: true }), 600);
    } catch (e) {
      console.error("Error finalizing onboarding:", e);
      alert("An error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleBasicInfoSubmit = async () => {
    if (!selectedRole || !validateBasicInfo()) return;

    const fallbackPlanId = getDefaultPlanIdForRole(selectedRole);
    const finalPlanId = selectedPlan?.id || fallbackPlanId || "";
    const finalPlan = selectedPlan || getPlanById(fallbackPlanId);

    const nextStep =
      selectedRole === "user" || selectedRole === "collaborator" || selectedRole === "vendor"
        ? STEPS.COMPLETE
        : subscriptionRequired
          ? STEPS.SUBSCRIPTION
          : STEPS.COMPLETE;

    if (auth.currentUser) {
      const ref = doc(db, "users", auth.currentUser.uid);
      await updateDoc(ref, {
        onboarding_step: nextStep,
        full_name: formData.full_name || "",
        phone: formData.phone || "",
        country: formData.country || "",
        country_code: formData.country_code || "",
        ...buildRoleFields(selectedRole),
        subscription_plan: finalPlanId,
        subscription_interval: finalPlan?.interval || "",
        subscription_amount: Number(finalPlan?.amount || 0),
        subscription_currency: finalPlan?.currency || "USD",
        ...(selectedRole === "collaborator" && collaboratorRef
          ? {
              referred_by_collaborator_code: collaboratorRef,
              referred_by_collaborator_at: serverTimestamp(),
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
    }

    if (selectedRole === "user" || selectedRole === "collaborator" || selectedRole === "vendor" || !subscriptionRequired) {
      await finalizeOnboarding({ subscriptionActive: false, skipped: true });
      return;
    }

    setCurrentStep(nextStep);
  };

  const handleBack = async () => {
    let nextStep = STEPS.CHOOSE_ROLE;

    if (currentStep === STEPS.COMPLETE) {
      nextStep =
        selectedRole === "user" || selectedRole === "collaborator" || selectedRole === "vendor" || !subscriptionRequired
          ? STEPS.BASIC_INFO
          : STEPS.SUBSCRIPTION;
    } else if (currentStep === STEPS.SUBSCRIPTION) {
      nextStep = STEPS.BASIC_INFO;
    } else if (currentStep === STEPS.BASIC_INFO) {
      nextStep = roleLockedFromEntry ? STEPS.BASIC_INFO : STEPS.CHOOSE_ROLE;
    }

    if (nextStep === currentStep) return;

    setCurrentStep(nextStep);
    if (auth.currentUser) {
      const ref = doc(db, "users", auth.currentUser.uid);
      await updateDoc(ref, { onboarding_step: nextStep, updatedAt: serverTimestamp() });
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut(auth);
    } catch (e) {
      // ignore
    } finally {
      const welcomeUrl = studentRef
        ? `${createPageUrl("Welcome")}?student_ref=${encodeURIComponent(studentRef)}`
        : createPageUrl("Welcome");
      navigate(welcomeUrl, { replace: true });
      setLoggingOut(false);
    }
  };

  const RoleLockedPill = ({ role }) => {
    if (!roleLockedFromEntry) return null;
    const labelMap = {
      user: tr("onboarding.roles.student.title", "Student"),
      agent: tr("onboarding.roles.agent.title", "Education Agent"),
      tutor: tr("onboarding.roles.tutor.title", "Tutor"),
      school: tr("onboarding.roles.school.title", "Educational Institution"),
      vendor: tr("onboarding.roles.vendor.title", "Service Provider"),
      collaborator: tr("onboarding.roles.collaborator.title", "Collaborator"),
    };
    const label = labelMap[role] || role?.charAt(0).toUpperCase() + role?.slice(1);

    return (
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white/70">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        {tr("onboarding.ui.role_selected","Role selected:")} <span className="font-semibold">{label}</span>
        <BadgeCheck className="w-4 h-4 text-emerald-600" />
      </div>
    );
  };

  const renderChooseRole = () => (
    <div className="text-center max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">{tr("onboarding.ui.welcome","Welcome to GreenPass!")}</h1>
        <p className="text-lg text-gray-600">Choose your role to get started with your personalized experience</p>
        <div className="mt-3">
          <RoleLockedPill role={selectedRole} />
        </div>
      </div>
      <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {publicRoleOptions.map((role) => (
          <Card
            key={role.type}
            className={`cursor-pointer transition-all duration-300 border-2 hover:shadow-xl hover:scale-105 group
              ${roleLockedFromEntry ? "opacity-60 pointer-events-none" : "hover:border-green-500"}
            `}
            onClick={() => handleRoleSelect(role.type)}
            title={roleLockedFromEntry ? "Role already selected from previous step" : `Sign up as ${role.title}`}
          >
            <CardContent className="p-6">
              <div className="text-center">
                <div className={`${role.color} text-white p-4 rounded-full mb-4 mx-auto w-fit group-hover:scale-110 transition-transform`}>
                  {role.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{role.title}</h3>
                <p className="text-sm font-medium text-green-600 mb-3">{role.subtitle}</p>
                <p className="text-gray-600 text-sm mb-4 leading-relaxed">{role.description}</p>
                <div className="space-y-2">
                  {role.benefits.map((benefit, idx) => (
                    <div key={idx} className="flex items-center text-xs text-gray-500">
                      <Check className="w-3 h-3 text-green-500 mr-2 flex-shrink-0" />
                      <span>{benefit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderBasicInfo = () => {
    const selectedRoleData =
      selectedRole === "collaborator"
        ? collaboratorRoleOption
        : publicRoleOptions.find((r) => r.type === selectedRole) || publicRoleOptions[0];

    return (
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className={`${selectedRoleData?.color} text-white p-3 rounded-full mb-4 mx-auto w-fit`}>
            {selectedRoleData?.icon}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{tr("onboarding.ui.basic_info_title","Basic Information")}</h2>
          <p className="text-gray-600">
            {tr("onboarding.ui.setting_up_prefix","Setting up your")} {selectedRoleData?.title}{tr("onboarding.ui.profile_suffix"," profile")}
          </p>
          <div className="mt-3">
            <RoleLockedPill role={selectedRole} />
          </div>
        </div>

        {selectedRole === "collaborator" && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-left">
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-emerald-700 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-emerald-900">
                  {tr("onboarding.collaborator.invite_title", "Collaborator invite confirmed")}
                </div>
                <div className="text-sm text-emerald-800 mt-1">
                  {tr(
                    "onboarding.collaborator.invite_text",
                    "Your collaborator role was assigned through an invitation link and cannot be changed here."
                  )}
                </div>
                {!!collaboratorRef && (
                  <div className="mt-2 text-xs text-emerald-700 break-all">
                    {tr("onboarding.collaborator.ref_code", "Referral code:")} <span className="font-semibold">{collaboratorRef}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {studentRef && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-left">
            <div className="text-sm font-semibold text-blue-900">
              {tr("onboarding.student_scan.title", "Student QR detected")}
            </div>
            <div className="mt-1 text-sm text-blue-800">
              {tr(
                "onboarding.student_scan.text",
                "Finish your setup first. After onboarding and policy acceptance, we’ll continue the scanned student connection automatically."
              )}
            </div>
          </div>
        )}

        {rolePlanOptions.length > 1 && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
            <div className="text-sm font-semibold text-gray-900 mb-3">
              {tr("onboarding.subscription.choose_plan", "Choose your billing plan")}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rolePlanOptions.map((plan) => {
                const isSelected = selectedPlan?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`rounded-xl border p-4 text-left transition
                      ${isSelected ? "border-emerald-600 bg-emerald-50" : "border-gray-200 bg-white hover:border-emerald-300"}
                    `}
                  >
                    <div className="text-sm font-semibold text-gray-900">{plan.label}</div>
                    <div className="mt-1 text-sm text-gray-600 capitalize">
                      {plan.interval === "month" ? "Monthly" : "Yearly"}
                    </div>
                    <div className="mt-2 text-lg font-bold text-gray-900">
                      {formatPlanPrice(plan)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <Label htmlFor="full_name">{tr("onboarding.fields.full_name","Full Name *")}</Label>
            <Input
              id="full_name"
              value={formData.full_name || ""}
              onChange={(e) => {
                formDirtyRef.current = true;
                setFormData((p) => ({ ...p, full_name: e.target.value }));
              }}
              placeholder={tr("onboarding.placeholders.full_name","Enter your full name")}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="email">{tr("onboarding.fields.email","Email Address")}</Label>
            <Input id="email" value={formData.email || ""} disabled className="mt-1 bg-gray-100" />
            <p className="text-xs text-gray-500 mt-1">{tr("onboarding.fields.email_hint","This is your login email and cannot be changed")}</p>
          </div>

          <div>
            <Label htmlFor="phone">{tr("onboarding.fields.phone","Phone Number *")}</Label>
            <Input
              id="phone"
              value={formData.phone || ""}
              onChange={(e) => {
                formDirtyRef.current = true;
                setFormData((p) => ({ ...p, phone: e.target.value }));
              }}
              placeholder={tr("onboarding.placeholders.phone","Enter your phone number")}
              className="mt-1"
            />
          </div>

          <div>
            <Label>{tr("onboarding.fields.country","Country *")}</Label>
            <CountrySelect
              valueCode={formData.country_code || ""}
              valueName={formData.country || ""}
              onChange={(c) => {
                formDirtyRef.current = true;
                setFormData((p) => ({
                  ...p,
                  country: c.name,
                  country_code: c.code,
                }));
              }}
            />
            <p className="text-xs text-gray-500 mt-1">{tr("onboarding.fields.country_hint","Search and select your country (with flag).")}</p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={handleBack}
              className="flex-1"
              disabled={roleLockedFromEntry && currentStep === STEPS.BASIC_INFO}
              title={roleLockedFromEntry && currentStep === STEPS.BASIC_INFO ? "Role locked by entry flow" : "Back"}
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> {tr("common.back","Back")}
            </Button>
            <Button onClick={handleBasicInfoSubmit} className="flex-1" disabled={!validateBasicInfo() || saving}>
              {tr("common.continue","Continue")} <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderSubscription = () => {
    const plan = selectedPlan || getPlanById(getDefaultPlanIdForRole(selectedRole));

    if (!plan) return null;

    return (
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="bg-emerald-600 text-white p-3 rounded-full mb-4 mx-auto w-fit">
            <CreditCard className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{tr("onboarding.subscription.title","Subscription")}</h2>
          <p className="text-gray-600">Subscribe now or skip for later. We’ll store your choice.</p>
          <div className="mt-3">
            <RoleLockedPill role={selectedRole} />
          </div>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-gray-500">{tr("onboarding.subscription.plan","Plan")}</div>
                <div className="text-lg font-semibold text-gray-900">{plan.label}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-500">{tr("onboarding.subscription.price","Price")}</div>
                <div className="text-xl font-bold text-gray-900">{formatPlanPrice(plan)}</div>
              </div>
            </div>

            {rolePlanOptions.length > 1 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {rolePlanOptions.map((option) => {
                  const isSelected = option.id === plan.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedPlanId(option.id)}
                      className={`rounded-xl border p-4 text-left transition
                        ${isSelected ? "border-emerald-600 bg-emerald-50" : "border-gray-200 bg-white hover:border-emerald-300"}
                      `}
                    >
                      <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                      <div className="mt-1 text-lg font-bold text-gray-900">{formatPlanPrice(option)}</div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4 text-sm text-gray-600">
              <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
                Subscription unlocks your full {selectedRole} features.
              </div>
            </div>

            {studentRef && (
              <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                {tr(
                  "onboarding.subscription.student_scan_note",
                  "Your scanned student connection is saved and will continue automatically after onboarding."
                )}
              </div>
            )}

            <div className="mt-4">
              {paypalError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-3">
                  {typeof paypalError === "string" ? paypalError : "Payment error. Please try again."}
                </div>
              )}

              <SharedPaymentGateway
                amountUSD={plan.amount}
                itemDescription={`GreenPass Subscription (${plan.label})`}
                payerName={formData.full_name || ""}
                payerEmail={formData.email || ""}
                paymentMode="subscription"
                planId={plan.id}
                onProcessing={() => {
                  setSubmittingPayment(true);
                  setPaypalError("");
                }}
                onDoneProcessing={() => {
                  setSubmittingPayment(false);
                }}
                onCardPaymentSuccess={async (provider, transactionId, payload) => {
                  await finalizeOnboarding({
                    subscriptionActive: true,
                    paymentProvider: provider || "",
                    paymentOrderId: transactionId || "",
                    paymentDetails: payload?.details || payload?.session || payload || null,
                    skipped: false,
                  });
                }}
                onError={(err) => {
                  console.error("SharedPaymentGateway error:", err);
                  setPaypalError(
                    typeof err === "string"
                      ? err
                      : err?.message || "Payment error occurred. Please try again."
                  );
                  setSubmittingPayment(false);
                }}
              />
            </div>

            <div className="mt-4 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={handleBack} disabled={saving || submittingPayment}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {tr("common.back","Back")}
              </Button>

              <Button
                className="flex-1"
                variant="secondary"
                onClick={() => finalizeOnboarding({ subscriptionActive: false, skipped: true })}
                disabled={saving || submittingPayment}
                title="Skip subscription for now"
              >
                {tr("common.skip_for_now","Skip for now")}
              </Button>
            </div>

            <p className="mt-3 text-xs text-gray-500">
              Your selected plan and payment result will be saved in Firestore.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderComplete = () => (
    <div className="text-center max-w-md mx-auto">
      <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-white" />
      </div>
      <h2 className="text-3xl font-bold text-gray-900 mb-4">{tr("onboarding.ui.welcome","Welcome to GreenPass!")}</h2>
      <p className="text-gray-600 mb-6">Your account has been set up successfully. Get ready to start your journey!</p>
      <div className="bg-green-50 rounded-lg p-4 mb-6">
        <p className="text-sm text-green-800">
          {studentRef
            ? tr("onboarding.ui.redirecting_student_scan","Finishing setup and continuing your scanned student connection...")
            : tr("onboarding.ui.redirecting","Redirecting to your personalized dashboard...")}
        </p>
      </div>
      <div className="flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-green-600" />
      </div>
    </div>
  );

  if (!authChecked || profileLoading || subscriptionModeLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="w-full max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-600">
            Step {Math.max(1, STEP_ORDER.indexOf(currentStep) + 1)} of {STEP_ORDER.length}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
            className="text-red-600 hover:bg-red-50"
            title={tr("onboarding.ui.logout_title","Log out and exit onboarding")}
          >
            {loggingOut ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" /> {tr("common.logging_out","Logging out")}
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4 mr-1" /> {tr("common.logout","Log out")}
              </>
            )}
          </Button>
        </div>

        <Progress value={getStepProgress()} className="h-2 w-full max-w-md mx-auto mb-8" />

        <Card className="p-6 sm:p-8 lg:p-12 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardContent className="p-0">
            {currentStep === STEPS.CHOOSE_ROLE && renderChooseRole()}
            {currentStep === STEPS.BASIC_INFO && renderBasicInfo()}
            {currentStep === STEPS.SUBSCRIPTION &&
              selectedRole !== "user" &&
              selectedRole !== "collaborator" &&
              selectedRole !== "vendor" &&
              subscriptionRequired &&
              renderSubscription()}
            {currentStep === STEPS.COMPLETE && renderComplete()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}