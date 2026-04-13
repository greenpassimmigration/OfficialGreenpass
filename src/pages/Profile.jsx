import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  User,
  Globe,
  BookOpen,
  Briefcase,
  Building,
  Store,
  Upload,
  Loader2,
  Save,
  Check,
  ChevronsUpDown,
  Pencil,
  X,
  QrCode,
  Copy,
  Download,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { UploadFile } from "@/api/integrations";
import { auth, db, storage } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
  limit,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useTr } from "@/i18n/useTr";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

/* ---------------- helpers ---------------- */
const VALID_ROLES = ["user", "agent", "tutor", "school", "vendor", "collaborator"];

const normalizeRole = (r) => {
  const v = String(r || "").trim().toLowerCase();
  return VALID_ROLES.includes(v) ? v : "user";
};

const csvToArray = (s) =>
  (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const arrayToCSV = (v) =>
  Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "fil", label: "Tagalog" },
  { value: "ceb", label: "Cebuano" },
  { value: "zh", label: "中文" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "ar", label: "العربية" },
  { value: "tr", label: "Türkçe" },
];

const APP_BASE =
  import.meta.env.VITE_APP_BASE_URL ||
  import.meta.env.VITE_PUBLIC_APP_URL ||
  import.meta.env.VITE_SITE_URL ||
  window.location.origin;

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_BASE ||
  "https://us-central1-greenpass-dc92d.cloudfunctions.net";

const flagUrlFromCode = (code) => {
  const cc = (code || "").toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  return `https://flagcdn.com/w20/${cc}.png`;
};

const getAllCountriesIntl = (locale = "en") => {
  try {
    if (typeof Intl === "undefined") return [];
    if (!Intl.DisplayNames) return [];

    const codes =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("region") || []
        : [];

    const fallbackCodes = [
      "TR", "VN", "PH", "CA", "US", "GB", "AU", "NZ", "FR", "DE", "ES", "IT",
      "JP", "KR", "CN", "TW", "HK", "SG", "MY", "TH", "ID", "IN", "AE", "SA",
      "QA", "KW", "OM", "BH", "EG", "ZA", "BR", "MX", "AR", "CL"
    ];

    const regionCodes = (codes.length ? codes : fallbackCodes).filter((code) =>
      /^[A-Z]{2}$/.test(code)
    );

    const dn = new Intl.DisplayNames([locale], { type: "region" });

    return regionCodes
      .map((code) => ({
        code,
        name: dn.of(code) || code,
        flagUrl: flagUrlFromCode(code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  } catch {
    return [];
  }
};

async function getAllCountriesFallback(locale = "en") {
  const res = await fetch("https://restcountries.com/v3.1/all?fields=name,cca2,translations");
  const json = await res.json();

  const translationMap = {
    vi: "vie",
    tr: "tur",
    es: "spa",
    fr: "fra",
    ar: "ara",
    zh: "zho",
  };

  const apiLang = translationMap[locale];

  return (json || [])
    .filter((x) => x?.cca2 && /^[A-Z]{2}$/.test(x.cca2))
    .map((x) => {
      const translatedName =
        (apiLang && x?.translations?.[apiLang]?.common) ||
        x?.name?.common ||
        x.cca2;

      return {
        code: x.cca2,
        name: translatedName,
        flagUrl: flagUrlFromCode(x.cca2),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

function buildAgentReferralLink(token) {
  return `${APP_BASE.replace(/\/+$/, "")}/?agent_ref=${encodeURIComponent(token)}`;
}

function buildStudentReferralLink(token) {
  return `${APP_BASE.replace(/\/+$/, "")}/scan/student?student_ref=${encodeURIComponent(token)}`;
}

function buildTutorReferralLink(token) {
  return `${APP_BASE.replace(/\/+$/, "")}/?tutor_ref=${encodeURIComponent(token)}`;
}

function buildCollaboratorReferralLink(token) {
  return `${APP_BASE.replace(/\/+$/, "")}/?ref=${encodeURIComponent(token)}`;
}

function createSchoolLeadsPath() {
  return "SchoolLeads";
}

function buildQrImageUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(
    text
  )}`;
}

async function getMyAgentReferralToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const idToken = await user.getIdToken();

  const r = await fetch(
    `${FUNCTIONS_BASE.replace(/\/+$/, "")}/getMyAgentReferralToken`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    }
  );

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg || "Failed to load referral token");
  }

  const data = await r.json().catch(() => ({}));
  if (!data?.token) throw new Error("No referral token returned");
  return data.token;
}

async function getMyStudentReferralToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const idToken = await user.getIdToken();

  const r = await fetch(
    `${FUNCTIONS_BASE.replace(/\/+$/, "")}/getMyStudentReferralToken`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    }
  );

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg || "Failed to load student QR token");
  }

  const data = await r.json().catch(() => ({}));
  if (!data?.token) throw new Error("No student token returned");
  return data.token;
}

async function getMyTutorReferralToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const idToken = await user.getIdToken();

  const r = await fetch(
    `${FUNCTIONS_BASE.replace(/\/+$/, "")}/getMyTutorReferralToken`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    }
  );

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(msg || "Failed to load tutor QR token");
  }

  const data = await r.json().catch(() => ({}));
  if (!data?.token) throw new Error("No tutor token returned");
  return data.token;
}

function CountrySelect({ valueCode, valueName, onChange, disabled = false, locale = "en"}) {
  const tr0 = useTr();
  const tr = React.useCallback(
    (key, fallback) => {
      if (typeof tr0 === "function") return tr0(key, fallback);
      if (tr0 && typeof tr0.tr === "function") return tr0.tr(key, fallback);
      if (tr0 && typeof tr0.t === "function") return tr0.t(key, fallback);
      return fallback ?? key;
    },
    [tr0]
  );

  const [open, setOpen] = React.useState(false);
  const [countries, setCountries] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      try {
        const intlList = getAllCountriesIntl(locale);
        if (alive && intlList.length) {
          setCountries(intlList);
          return;
        }

        const apiList = await getAllCountriesFallback(locale);
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
  }, [locale]);

  const selected = React.useMemo(() => {
    const byCode =
      valueCode && countries.find((c) => c.code === String(valueCode).toUpperCase());
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
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between disabled:opacity-100 disabled:cursor-default"
        >
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                {selected.flagUrl ? (
                  <img
                    src={selected.flagUrl}
                    alt={tr("country_flag_alt", `${selected.name} flag`)}
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
              <span className="text-gray-500">
                {tr("onboarding.placeholders.select_country", "Select your country")}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={tr("search_country", "Search country...")} />
          <CommandList>
            <CommandEmpty>
              {loading ? tr("loading", "Loading...") : tr("no_results", "No results.")}
            </CommandEmpty>

            <CommandGroup heading={tr("country", "Country")}>
              {(countries || []).map((c) => (
                <CommandItem
                  key={c.code}
                  value={`${c.name} ${c.code}`}
                  onSelect={() => {
                    onChange?.({ code: c.code, name: c.name });
                    setOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={[
                      "h-4 w-4",
                      selected?.code === c.code ? "opacity-100" : "opacity-0",
                    ].join(" ")}
                  />
                  {c.flagUrl ? (
                    <img
                      src={c.flagUrl}
                      alt={tr("country_flag_alt", `${c.name} flag`)}
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

function SimpleArrayInput({
  id,
  label,
  value,
  disabled,
  onChange,
  placeholder,
  helpText,
}) {
  const [text, setText] = React.useState(arrayToCSV(value));

  React.useEffect(() => {
    setText(arrayToCSV(value));
  }, [value]);

  const handleBlur = () => {
    onChange(csvToArray(text));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={3}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="resize-none"
      />
      {helpText ? <p className="text-sm text-gray-500">{helpText}</p> : null}
    </div>
  );
}

const safeExt = (name = "") => {
  const m = String(name).toLowerCase().match(/\.(pdf|png|jpg|jpeg|webp)$/);
  return m ? m[1] : "bin";
};

const isAllowedVerificationFile = (file) => {
  const okTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
  if (!file) return false;
  if (okTypes.includes(file.type)) return true;
  return /\.(pdf|png|jpg|jpeg|webp)$/i.test(file.name || "");
};

const buildVerificationFieldsForRole = (role, tr) => {
  const r = normalizeRole(role);

  if (r === "agent") {
    return [
      {
        key: "agent_id_front",
        label: tr("verification.agent_id_front", "Valid ID (Front)"),
        required: true,
      },
      {
        key: "agent_id_back",
        label: tr("verification.agent_id_back", "Valid ID (Back)"),
        required: true,
      },
      {
        key: "agent_business_permit",
        label: tr("verification.agent_business_permit", "Business Permit / Registration"),
        required: true,
      },
    ];
  }

  if (r === "tutor") {
    return [
      {
        key: "tutor_id_front",
        label: tr("verification.tutor_id_front", "Valid ID (Front)"),
        required: true,
      },
      {
        key: "tutor_id_back",
        label: tr("verification.tutor_id_back", "Valid ID (Back)"),
        required: true,
      },
      {
        key: "tutor_proof",
        label: tr("verification.tutor_proof", "Proof of Qualification (optional)"),
        required: false,
      },
    ];
  }

  if (r === "school") {
    return [
      {
        key: "school_dli_or_permit",
        label: tr(
          "verification.school_dli_or_permit",
          "DLI / School Permit / Accreditation Proof"
        ),
        required: true,
      },
    ];
  }

  if (r === "user") {
    return [
      {
        key: "student_id_front",
        label: tr("verification.student_id_front", "Valid ID (Front)"),
        required: true,
      },
      {
        key: "student_id_back",
        label: tr("verification.student_id_back", "Valid ID (Back)"),
        required: true,
      },
    ];
  }

  return [];
};

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

function roleMeta(role, tr) {
  if (role === "agent") {
    return { label: tr("role_agent", "Agent"), icon: <Briefcase className="w-5 h-5" /> };
  }
  if (role === "tutor") {
    return { label: tr("role_tutor", "Tutor"), icon: <BookOpen className="w-5 h-5" /> };
  }
  if (role === "school") {
    return { label: tr("role_school", "School"), icon: <Building className="w-5 h-5" /> };
  }
  if (role === "vendor") {
    return { label: tr("role_vendor", "Vendor"), icon: <Store className="w-5 h-5" /> };
  }
  return { label: tr("role_student", "Student"), icon: <User className="w-5 h-5" /> };
}

async function syncSchoolDraftOnly({ uid, payload }) {
  const schoolName = String(payload.school_name || "").trim();

  const schoolProfileData = {
    institution_id: String(payload.institution_id || "").trim(),
    user_id: uid,
    name: schoolName,
    school_name: schoolName,
    type: payload.type || "",
    school_level: payload.type || "",
    location: payload.location || "",
    website: payload.website || "",
    about: payload.about || "",
    bio: payload.bio || "",
    updated_at: serverTimestamp(),
  };

  await setDoc(
    doc(db, "users", uid),
    {
      school_profile: schoolProfileData,
      updated_at: serverTimestamp(),
    },
    { merge: true }
  );

  return schoolProfileData.institution_id || "";
}

function ProfileHeader({
  tr,
  displayName,
  roleLabel,
  profilePhoto,
  initial,
  avatarBg,
  onUpload,
  uploading,
  isVerified,
  isSubscribed,
  verificationLabel,
  subscriptionLabel,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  saving,
  languageValue = "en",
  onLanguageChange,
}) {
  return (
    <div className="rounded-3xl bg-white border shadow-sm p-5 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            {profilePhoto ? (
              <img
                src={profilePhoto}
                alt={tr("profile_picture", "Profile Picture")}
                className="w-24 h-24 rounded-3xl object-cover border bg-white shadow-sm"
              />
            ) : (
              <div
                className={`w-24 h-24 rounded-3xl ${avatarBg} text-white flex items-center justify-center text-3xl font-bold shadow-sm`}
              >
                {initial}
              </div>
            )}

            <input
              type="file"
              id="profile_picture_upload"
              accept="image/*"
              onChange={onUpload}
              className="hidden"
            />

            {isEditing && (
              <button
                type="button"
                onClick={() => document.getElementById("profile_picture_upload")?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full border bg-white shadow-sm flex items-center justify-center hover:bg-gray-50 disabled:opacity-60"
                title={tr("upload_picture", "Upload Picture")}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 truncate">
              {displayName}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{roleLabel}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={
                  isVerified
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 bg-gray-50 text-gray-700"
                }
              >
                {verificationLabel}
              </Badge>

              <Badge
                variant="outline"
                className={
                  isSubscribed
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-gray-50 text-gray-700"
                }
              >
                {subscriptionLabel}
              </Badge>
            </div>
          </div>
        </div>

        <div className="md:ml-auto flex flex-col items-stretch md:items-end gap-3 w-full md:w-auto">
          <div className="w-full md:w-44">
            <Select value={languageValue || "en"} onValueChange={onLanguageChange}>
              <SelectTrigger className="w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 md:justify-end">
            {!isEditing ? (
              <Button type="button" variant="outline" onClick={onStartEdit} className="rounded-xl">
                <Pencil className="w-4 h-4 mr-2" />
                {tr("edit_profile", "Edit Profile")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancelEdit}
                  className="rounded-xl"
                >
                  <X className="w-4 h-4 mr-2" />
                  {tr("cancel", "Cancel")}
                </Button>

                <Button
                  type="button"
                  className="rounded-xl bg-green-600 hover:bg-green-700"
                  onClick={onSave}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  {saving ? tr("saving", "Saving…") : tr("save_changes", "Save Changes")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ title, icon: Icon, action, children }) {
  return (
    <Card className="rounded-3xl shadow-sm border">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-gray-700" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function StudentQrGuideCard({
  tr,
  progressText,
  completedCount,
  totalCount,
  missingItemsDetailed,
  onboardingDone,
  onOpenTab,
}) {
  const grouped = missingItemsDetailed.reduce(
    (acc, item) => {
      const key = item.tab === "personal" ? "personal" : "details";
      acc[key].push(item);
      return acc;
    },
    { personal: [], details: [] }
  );

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {tr(
              "qr.student_complete_profile_first",
              "Complete onboarding first to unlock your QR."
            )}
          </p>

          <p className="text-sm mt-1 text-amber-800">
            {tr(
              "qr.student_complete_profile_help",
              "Complete onboarding to unlock your Student QR. You can still finish the rest of your profile later."
            )}
          </p>

          <div className="mt-4 rounded-xl border border-amber-200 bg-white px-4 py-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {tr("qr.profile_progress", "Profile progress")}
                </p>
                <p className="text-sm text-amber-800">{progressText}</p>
              </div>

              {!onboardingDone ? (
                <Badge variant="outline" className="border-amber-300 text-amber-800 bg-white">
                  {tr("onboarding_incomplete", "Onboarding incomplete")}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-white">
                  {tr("onboarding_complete", "Onboarding complete")}
                </Badge>
              )}
            </div>

            <div className="mt-3 h-2 w-full rounded-full bg-amber-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, (completedCount / totalCount) * 100))}%` }}
              />
            </div>
          </div>

          {missingItemsDetailed.length > 0 ? (
            <div className="mt-4 space-y-4">
              {grouped.personal.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-amber-900">
                      {tr("personal_information", "Personal Information")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl bg-white"
                      onClick={() => onOpenTab("personal")}
                    >
                      {tr("qr.go_to_personal_information", "Go to Personal Information")}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {grouped.personal.map((item) => (
                      <Badge
                        key={item.key}
                        variant="outline"
                        className="border-amber-300 bg-white text-amber-900"
                      >
                        {item.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {grouped.details.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-amber-900">
                      {tr("student_profile", "Student Profile")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl bg-white"
                      onClick={() => onOpenTab("details")}
                    >
                      {tr("qr.go_to_student_profile", "Go to Student Profile")}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {grouped.details.map((item) => (
                      <Badge
                        key={item.key}
                        variant="outline"
                        className="border-amber-300 bg-white text-amber-900"
                      >
                        {item.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function Profile() {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");
  const [viewerName, setViewerName] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const detectType = useCallback((url = "") => {
    const u = String(url || "").toLowerCase();
    if (u.includes(".pdf") || u.includes("application%2fpdf")) return "pdf";
    if (u.match(/\.(png|jpg|jpeg|webp)(\?|$)/) || u.includes("image%2f")) return "image";
    return "file";
  }, []);

  const tr0 = useTr("profile");
  const tr = useCallback(
    (key, fallback) => {
      if (typeof tr0 === "function") return tr0(key, fallback);
      if (tr0 && typeof tr0.tr === "function") return tr0.tr(key, fallback);
      if (tr0 && typeof tr0.t === "function") return tr0.t(key, fallback);
      return fallback ?? key;
    },
    [tr0]
  );

  const { subscriptionModeEnabled, loading: subscriptionModeLoading } = useSubscriptionMode();

  const [uid, setUid] = useState(null);
  const [role, setRole] = useState("user");
  const [userDoc, setUserDoc] = useState(null);
  const [activeTab, setActiveTab] = useState("personal");

  const [qrLoading, setQrLoading] = useState(false);
  const [agentReferralToken, setAgentReferralToken] = useState("");
  const [agentReferralLink, setAgentReferralLink] = useState("");
  const [agentReferralQr, setAgentReferralQr] = useState("");
  const [tutorReferralToken, setTutorReferralToken] = useState("");
  const [tutorReferralLink, setTutorReferralLink] = useState("");
  const [tutorReferralQr, setTutorReferralQr] = useState("");
  const [studentReferralToken, setStudentReferralToken] = useState("");
  const [studentReferralLink, setStudentReferralLink] = useState("");
  const [studentReferralQr, setStudentReferralQr] = useState("");
  const [collaboratorReferralToken, setCollaboratorReferralToken] = useState("");
  const [collaboratorReferralLink, setCollaboratorReferralLink] = useState("");
  const [collaboratorReferralQr, setCollaboratorReferralQr] = useState("");

  const meta = useMemo(() => roleMeta(role, tr), [role, tr]);
  const verificationFields = useMemo(() => buildVerificationFieldsForRole(role, tr), [role, tr]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [uploadingProfilePic, setUploadingProfilePic] = useState(false);

  const initialLang = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("lang") || localStorage.getItem("gp_lang") || "en";
    } catch {
      return "en";
    }
  })();

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    country: "",
    country_code: "",
    lang: initialLang,
    profile_picture: "",
    bio: "",

    date_of_birth: "",
    gender: "",
    age: "",
    interested_in: "",
    current_level: "",
    comments: "",
    interests: [],
    education: [],
    selected_courses: [],
    preferred_countries: [],
    study_areas: [],
    spoken_languages: [],

    gpa: "",
    ielts: "",
    budget: "",
    intake_year: "",
    preferred_programs: [],
    target_country: "",
    target_program: "",
    scholarship_interest: "",
    academic_background: "",
    high_school: "",
    university: "",
    achievements: "",

    company_name: "",
    business_license_mst: "",
    year_established: "",
    paypal_email: "",

    specializations: "",
    experience_years: "",
    hourly_rate: "",

    institution_id: "",
    school_name: "",
    type: "",
    location: "",
    website: "",
    about: "",

    business_name: "",
    service_categories: [],
  });

  const [verification, setVerification] = useState({
    status: "unverified",
    reason: "",
    docs: {},
  });
  const [docUploading, setDocUploading] = useState({});
  const [submittingVerification, setSubmittingVerification] = useState(false);

  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const v = form?.lang || "en";
    try {
      localStorage.setItem("gp_lang", v);
    } catch {}
    window.dispatchEvent(new CustomEvent("gp_lang_changed", { detail: v }));
  }, [form?.lang]);

  useEffect(() => {
    setActiveTab("personal");
  }, [role]);

  const handleLanguageChange = useCallback(
    async (v) => {
      if (!v) return;

      setField("lang", v);

      try {
        localStorage.setItem("gp_lang", v);
      } catch {}

      try {
        const url = new URL(window.location.href);
        url.searchParams.set("lang", v);
        window.history.replaceState({}, "", url.toString());
      } catch {}

      try {
        if (uid) {
          await updateDoc(doc(db, "users", uid), {
            lang: v,
            language: v,
            updated_at: serverTimestamp(),
          });
        }
      } catch (e) {
        console.error("Language update failed:", e);
      }

      window.location.reload();
    },
    [uid]
  );

  const vendorCategoryOptions = useMemo(
    () => [
      { value: "Transport", label: tr("cat_transport", "Transport") },
      { value: "SIM Card", label: tr("cat_sim", "SIM Card") },
      { value: "Banking", label: tr("cat_banking", "Banking") },
      { value: "Accommodation", label: tr("cat_accommodation", "Accommodation") },
      { value: "Delivery", label: tr("cat_delivery", "Delivery") },
      { value: "Tours", label: tr("cat_tours", "Tours") },
    ],
    [tr]
  );

  const schoolTypeOptions = useMemo(
    () => [
      { value: "High School", label: tr("type_high_school", "High School") },
      { value: "College", label: tr("type_college", "College") },
      { value: "University", label: tr("type_university", "University") },
      { value: "Institute", label: tr("type_institute", "Institute") },
      { value: "Vocational", label: tr("type_vocational", "Vocational School") },
      { value: "Other", label: tr("type_other", "Other") },
    ],
    [tr]
  );

  const loadProfile = useCallback(async (userId) => {
    setLoading(true);
    try {
      const uref = doc(db, "users", userId);
      const usnap = await getDoc(uref);

      if (!usnap.exists()) {
        await setDoc(uref, {
          role: "user",
          user_type: "user",
          userType: "user",
          selected_role: "user",
          email: auth.currentUser?.email || "",
          full_name: auth.currentUser?.displayName || "",
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }

      const u2 = await getDoc(uref);
      const u = u2.data() || {};

      const resolvedRole = normalizeRole(
        u.verification?.role || u.selected_role || u.user_type || u.userType || u.role || "user"
      );
      setRole(resolvedRole);
      setUserDoc(u);

      let institutionDoc = null;
        if (resolvedRole === "school") {
          try {
            const directInstitutionId = String(
              u.school_profile?.institution_id ||
              u.linked_institution_id ||
              ""
            ).trim();

            if (directInstitutionId) {
              const directSnap = await getDoc(doc(db, "institutions", directInstitutionId));
              if (directSnap.exists()) {
                const d = directSnap.data() || {};
                if (String(d.user_id || "").trim() === String(userId)) {
                  institutionDoc = { id: directSnap.id, ...d };
                }
              }
            }
          } catch (e) {
            console.error("Failed to load linked institution for school profile:", e);
            institutionDoc = null;
          }
        }

      const resolvedBio =
        u.bio ||
        u.agent_profile?.bio ||
        u.tutor_profile?.bio ||
        u.school_profile?.bio ||
        u.vendor_profile?.bio ||
        "";

      const isStudentRole = resolvedRole === "user";

      setForm((p) => ({
        ...p,
        full_name: u.full_name || "",
        email: u.email || auth.currentUser?.email || "",
        phone: u.phone || "",
        country: u.country || "",
        country_code: u.country_code || "",
        lang:
          (typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("lang") ||
              localStorage.getItem("gp_lang")
            : null) ||
          u.lang ||
          u.language ||
          "en",
        profile_picture: u.profile_picture || "",
        bio: resolvedBio || "",

        date_of_birth: !isStudentRole ? u.date_of_birth || "" : "",
        gender: !isStudentRole ? u.gender || "" : "",
        age: String(u.age || ""),
        interested_in: u.interested_in || "",
        current_level: u.current_level || "",
        comments: u.comments || "",
        interests: Array.isArray(u.interests) ? u.interests : [],
        education: Array.isArray(u.education) ? u.education : [],
        selected_courses: Array.isArray(u.selected_courses) ? u.selected_courses : [],
        preferred_countries: Array.isArray(u.preferred_countries) ? u.preferred_countries : [],
        study_areas: Array.isArray(u.study_areas) ? u.study_areas : [],
        spoken_languages: Array.isArray(u.spoken_languages) ? u.spoken_languages : [],

        gpa: u.gpa || "",
        ielts: u.ielts || "",
        budget: u.budget || "",
        intake_year: u.intake_year || "",
        preferred_programs: Array.isArray(u.preferred_programs) ? u.preferred_programs : [],
        target_country: u.target_country || "",
        target_program: u.target_program || "",
        scholarship_interest: u.scholarship_interest || "",
        academic_background: u.academic_background || "",
        high_school: u.high_school || "",
        university: u.university || "",
        achievements: u.achievements || "",

        company_name: u.agent_profile?.company_name || "",
        business_license_mst: u.agent_profile?.business_license_mst || "",
        year_established: u.agent_profile?.year_established || "",
        paypal_email:
          u.agent_profile?.paypal_email ||
          u.tutor_profile?.paypal_email ||
          u.vendor_profile?.paypal_email ||
          "",

        specializations: arrayToCSV(u.tutor_profile?.specializations),
        experience_years: u.tutor_profile?.experience_years || "",
        hourly_rate: u.tutor_profile?.hourly_rate || "",

        institution_id:
          institutionDoc?.id ||
          u.school_profile?.institution_id ||
          "",

        school_name:
          institutionDoc?.name ||
          u.school_profile?.school_name ||
          "",

        type:
          institutionDoc?.type ||
          institutionDoc?.school_type ||
          institutionDoc?.school_level ||
          u.school_profile?.type ||
          "",

        location:
          institutionDoc?.city ||
          institutionDoc?.location ||
          u.school_profile?.location ||
          "",

        website:
          institutionDoc?.website ||
          u.school_profile?.website ||
          "",

        about:
          institutionDoc?.about ||
          institutionDoc?.description ||
          u.school_profile?.about ||
          "",

        business_name: u.vendor_profile?.business_name || "",
        service_categories: u.vendor_profile?.service_categories || [],
      }));

      const vStatus =
        (u.verification && u.verification.status) ||
        u.verification_status ||
        (u.is_verified ? "verified" : "unverified") ||
        "unverified";

      const vReason =
        u.verification_rejection_reason ||
        (u.verification && (u.verification.reason || u.verification.rejection_reason)) ||
        "";

      const vDocs =
        (u.verification && u.verification.docs) ||
        u.verification_docs ||
        u.documents ||
        {};

      setVerification({
        status: String(vStatus || "unverified").toLowerCase(),
        reason: vReason || "",
        docs: vDocs && typeof vDocs === "object" ? vDocs : {},
      });
    } catch (e) {
      console.error("Profile load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUid(null);
        setLoading(false);
        return;
      }
      setUid(u.uid);
      await loadProfile(u.uid);
    });

    return () => unsub();
  }, [loadProfile]);

  const studentQrChecklist = useMemo(() => {
    if (role !== "user") return [];

    return [
      {
        key: "full_name",
        label: tr("full_name", "Full Name"),
        done: String(form.full_name || "").trim().length > 0,
        tab: "personal",
      },
      {
        key: "phone",
        label: tr("phone", "Phone"),
        done: String(form.phone || "").trim().length > 0,
        tab: "personal",
      },
      {
        key: "country",
        label: tr("country", "Country"),
        done: String(form.country || "").trim().length > 0,
        tab: "personal",
      },
      {
        key: "bio",
        label: tr("bio_label", "Biography / Description"),
        done: String(form.bio || "").trim().length > 0,
        tab: "personal",
      },
      {
        key: "current_level",
        label: tr("current_level", "Current Level"),
        done: String(form.current_level || "").trim().length > 0,
        tab: "personal",
      },
      {
        key: "target_country",
        label: tr("target_country", "Target Country"),
        done: String(form.target_country || "").trim().length > 0,
        tab: "details",
      },
      {
        key: "target_program",
        label: tr("target_program", "Target Program"),
        done: String(form.target_program || "").trim().length > 0,
        tab: "details",
      },
      {
        key: "academic_background",
        label: tr("academic_background", "Academic Background"),
        done: String(form.academic_background || "").trim().length > 0,
        tab: "details",
      },
      {
        key: "preferred_programs",
        label: tr("preferred_programs", "Preferred Programs"),
        done: Array.isArray(form.preferred_programs) && form.preferred_programs.length > 0,
        tab: "details",
      },
      {
        key: "study_areas",
        label: tr("areas", "Areas"),
        done: Array.isArray(form.study_areas) && form.study_areas.length > 0,
        tab: "details",
      },
      {
        key: "onboarding_completed",
        label: tr("onboarding_complete", "Complete onboarding"),
        done: Boolean(userDoc?.onboarding_completed),
        tab: "details",
      },
    ];
  }, [
    role,
    form.full_name,
    form.phone,
    form.country,
    form.bio,
    form.current_level,
    form.target_country,
    form.target_program,
    form.academic_background,
    form.preferred_programs,
    form.study_areas,
    userDoc?.onboarding_completed,
    tr,
  ]);

  const studentQrReady = useMemo(() => {
    if (role !== "user") return false;
    return Boolean(userDoc?.onboarding_completed);
  }, [role, userDoc?.onboarding_completed]);

  const studentQrMissingItemsDetailed = useMemo(() => {
    if (role !== "user") return [];
    return studentQrChecklist.filter((item) => !item.done);
  }, [role, studentQrChecklist]);

  const studentQrMissingItems = useMemo(() => {
    if (role !== "user") return [];
    return studentQrMissingItemsDetailed.map((item) => item.label);
  }, [role, studentQrMissingItemsDetailed]);

  const studentQrCompletedCount = useMemo(() => {
    if (role !== "user") return 0;
    return studentQrChecklist.filter((item) => item.done).length;
  }, [role, studentQrChecklist]);

  const studentQrTotalCount = useMemo(() => {
    if (role !== "user") return 0;
    return studentQrChecklist.length;
  }, [role, studentQrChecklist]);

  const studentQrProgressText = useMemo(() => {
    if (role !== "user") return "";
    return `${studentQrCompletedCount}/${studentQrTotalCount} ${tr(
      "qr.fields_completed",
      "required items completed"
    )}`;
  }, [role, studentQrCompletedCount, studentQrTotalCount, tr]);

  useEffect(() => {
    let mounted = true;

    async function loadQr() {
      if (!uid) {
        if (mounted) {
          setAgentReferralToken("");
          setAgentReferralLink("");
          setAgentReferralQr("");
          setStudentReferralToken("");
          setStudentReferralLink("");
          setStudentReferralQr("");
          setTutorReferralToken("");
          setTutorReferralLink("");
          setTutorReferralQr("");
          setCollaboratorReferralToken("");
          setCollaboratorReferralLink("");
          setCollaboratorReferralQr("");
        }
        return;
      }

      if (role === "agent") {
        try {
          setQrLoading(true);
          const token = await getMyAgentReferralToken();
          const link = buildAgentReferralLink(token);
          if (!mounted) return;
          setAgentReferralToken(token);
          setAgentReferralLink(link);
          setAgentReferralQr(buildQrImageUrl(link));
          setStudentReferralToken("");
          setStudentReferralLink("");
          setStudentReferralQr("");
        } catch (e) {
          console.error("Failed to load agent referral QR:", e);
          if (mounted) {
            setAgentReferralToken("");
            setAgentReferralLink("");
            setAgentReferralQr("");
          }
        } finally {
          if (mounted) setQrLoading(false);
        }
        return;
      }

      if (role === "tutor") {
        try {
          setQrLoading(true);
          const token = await getMyTutorReferralToken();
          const link = buildTutorReferralLink(token);
          if (!mounted) return;
          setTutorReferralToken(token);
          setTutorReferralLink(link);
          setTutorReferralQr(buildQrImageUrl(link));
          setAgentReferralToken("");
          setAgentReferralLink("");
          setAgentReferralQr("");
          setStudentReferralToken("");
          setStudentReferralLink("");
          setStudentReferralQr("");
          setCollaboratorReferralToken("");
          setCollaboratorReferralLink("");
          setCollaboratorReferralQr("");
        } catch (e) {
          console.error("Failed to load tutor referral QR:", e);
          if (mounted) {
            setTutorReferralToken("");
            setTutorReferralLink("");
            setTutorReferralQr("");
          }
        } finally {
          if (mounted) setQrLoading(false);
        }
        return;
      }

      if (role === "collaborator") {
        try {
          setQrLoading(true);

          const token =
            userDoc?.collaborator_referral_code ||
            form?.collaborator_referral_code ||
            "";

          const link =
            userDoc?.collaborator_referral_link ||
            form?.collaborator_referral_link ||
            buildCollaboratorReferralLink(token);

          if (!mounted) return;

          setCollaboratorReferralToken(token);
          setCollaboratorReferralLink(link);
          setCollaboratorReferralQr(token ? buildQrImageUrl(link) : "");

          setAgentReferralToken("");
          setAgentReferralLink("");
          setAgentReferralQr("");
          setStudentReferralToken("");
          setStudentReferralLink("");
          setStudentReferralQr("");
        } catch (e) {
          console.error("Failed to load collaborator referral QR:", e);
          if (mounted) {
            setCollaboratorReferralToken("");
            setCollaboratorReferralLink("");
            setCollaboratorReferralQr("");
          }
        } finally {
          if (mounted) setQrLoading(false);
        }
        return;
      }

      if (role === "user") {
        if (!studentQrReady) {
          if (mounted) {
            setStudentReferralToken("");
            setStudentReferralLink("");
            setStudentReferralQr("");
            setAgentReferralToken("");
            setAgentReferralLink("");
            setAgentReferralQr("");
            setTutorReferralToken("");
            setTutorReferralLink("");
            setTutorReferralQr("");
            setCollaboratorReferralToken("");
            setCollaboratorReferralLink("");
            setCollaboratorReferralQr("");
            setQrLoading(false);
          }
          return;
        }

        try {
          setQrLoading(true);
          const token = await getMyStudentReferralToken();
          const link = buildStudentReferralLink(token);
          if (!mounted) return;
          setStudentReferralToken(token);
          setStudentReferralLink(link);
          setStudentReferralQr(buildQrImageUrl(link));
          setAgentReferralToken("");
          setAgentReferralLink("");
          setAgentReferralQr("");
        } catch (e) {
          console.error("Failed to load student referral QR:", e);
          if (mounted) {
            setStudentReferralToken("");
            setStudentReferralLink("");
            setStudentReferralQr("");
          }
        } finally {
          if (mounted) setQrLoading(false);
        }
        return;
      }

      if (mounted) {
        setAgentReferralToken("");
        setAgentReferralLink("");
        setAgentReferralQr("");
        setStudentReferralToken("");
        setStudentReferralLink("");
        setStudentReferralQr("");
        setTutorReferralToken("");
        setTutorReferralLink("");
        setTutorReferralQr("");
        setCollaboratorReferralToken("");
        setCollaboratorReferralLink("");
        setCollaboratorReferralQr("");
        setQrLoading(false);
      }
    }

    loadQr();
    return () => {
      mounted = false;
    };
  }, [
    uid,
    role,
    studentQrReady,
    userDoc?.collaborator_referral_code,
    userDoc?.collaborator_referral_link,
    form?.collaborator_referral_code,
    form?.collaborator_referral_link,
  ]);

  const handleUploadProfilePicture = async (e) => {
    if (!isEditing) return;

    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingProfilePic(true);
    try {
      const { file_url } = await UploadFile({ file });
      setField("profile_picture", file_url);

      if (uid) {
        await updateDoc(doc(db, "users", uid), {
          profile_picture: file_url,
          updated_at: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error("Profile picture upload failed:", err);
      alert(tr("alerts.upload_failed", "Failed to upload profile picture. Please try again."));
    } finally {
      setUploadingProfilePic(false);
      e.target.value = "";
    }
  };

  const uploadVerificationDoc = async (docKey, file) => {
    if (!uid || !file || !isEditing) return;

    if (!isAllowedVerificationFile(file)) {
      alert(tr("alerts.verification_bad_file", "Please upload a PDF, JPG, PNG, or WEBP file."));
      return;
    }

    setDocUploading((p) => ({ ...p, [docKey]: true }));
    try {
      const submissionId = `sub_${Date.now()}`;
      const ext = safeExt(file.name);
      const path = `verification/${uid}/${submissionId}/${docKey}.${ext}`;
      const sref = storageRef(storage, path);

      await uploadBytes(sref, file);
      const url = await getDownloadURL(sref);

      setVerification((p) => ({
        ...p,
        docs: { ...(p.docs || {}), [docKey]: url },
      }));

      const uref = doc(db, "users", uid);
      await updateDoc(uref, {
        [`verification.docs.${docKey}`]: url,
        updated_at: serverTimestamp(),
      });
    } catch (e) {
      console.error("Verification doc upload failed:", e);
      alert(tr("alerts.upload_failed", "Upload failed. Please try again."));
    } finally {
      setDocUploading((p) => ({ ...p, [docKey]: false }));
    }
  };

  const clearVerificationDoc = async (docKey) => {
    if (!uid || !isEditing) return;

    setVerification((p) => {
      const next = { ...(p.docs || {}) };
      delete next[docKey];
      return { ...p, docs: next };
    });

    try {
      const uref = doc(db, "users", uid);
      await updateDoc(uref, {
        [`verification.docs.${docKey}`]: null,
        updated_at: serverTimestamp(),
      });
    } catch (e) {
      console.error("Clear verification doc failed:", e);
    }
  };

  const submitVerificationForReview = async () => {
    if (!uid || !isEditing) return;

    const fields = buildVerificationFieldsForRole(role, tr);
    const docs = verification.docs || {};
    const missingRequired = fields.filter((f) => f.required).filter((f) => !docs?.[f.key]);

    if (missingRequired.length) {
      alert(
        tr(
          "alerts.verification_missing_required",
          "Please upload all required verification documents before submitting."
        )
      );
      return;
    }

    setSubmittingVerification(true);
    try {
      const uref = doc(db, "users", uid);

      await updateDoc(uref, {
        verification_status: "pending",
        verification_rejection_reason: "",
        "verification.status": "pending",
        "verification.reason": "",
        "verification.submittedAt": serverTimestamp(),
        updated_at: serverTimestamp(),
        is_verified: false,
      });

      setVerification((p) => ({ ...p, status: "pending", reason: "" }));
      alert(tr("alerts.verification_submitted", "Submitted for review!"));
    } catch (e) {
      console.error("Submit verification failed:", e);
      alert(tr("alerts.save_failed", "Failed to submit. Please try again."));
    } finally {
      setSubmittingVerification(false);
    }
  };

  const handleSaveAll = async () => {
    if (!uid) return;

    if (!form.full_name?.trim()) {
      setActiveTab("personal");
      return alert(tr("alerts.required_full_name", "Full name is required."));
    }
    if (!form.phone?.trim()) {
      setActiveTab("personal");
      return alert(tr("alerts.required_phone", "Phone is required."));
    }
    if (!form.country?.trim()) {
      setActiveTab("personal");
      return alert(tr("alerts.required_country", "Country is required."));
    }

    if (role === "user") {
      if (!userDoc?.onboarding_completed) {
        setActiveTab("details");
        return alert(tr("alerts.required_onboarding", "Please complete onboarding first."));
      }
    }

    if (role === "agent") {
      if (!form.company_name?.trim()) {
        setActiveTab("details");
        return alert(tr("alerts.required_company_name", "Company name is required."));
      }
      if (!form.business_license_mst?.trim()) {
        setActiveTab("details");
        return alert(tr("alerts.required_business_license", "Business license (MST) is required."));
      }
    }

    if (role === "tutor") {
      if (csvToArray(form.specializations).length === 0) {
        setActiveTab("details");
        return alert(tr("alerts.required_specializations", "Specializations are required."));
      }
      if (!String(form.experience_years).trim()) {
        setActiveTab("details");
        return alert(
          tr("alerts.required_experience_years", "Years of experience is required.")
        );
      }
      if (!String(form.hourly_rate).trim()) {
        setActiveTab("details");
        return alert(tr("alerts.required_hourly_rate", "Hourly rate is required."));
      }
    }

    if (role === "vendor") {
      if (!form.business_name?.trim()) {
        setActiveTab("details");
        return alert(tr("alerts.required_business_name", "Business name is required."));
      }
      if (!Array.isArray(form.service_categories) || form.service_categories.length === 0) {
        setActiveTab("details");
        return alert(tr("alerts.required_service_category", "Select at least 1 service category."));
      }
      if (!form.paypal_email?.trim()) {
        setActiveTab("details");
        return alert(tr("alerts.required_paypal_email", "PayPal email is required."));
      }
    }

    setSaveNotice(null);
    setSaving(true);

    try {
      const uref = doc(db, "users", uid);

      const updates = {
        full_name: form.full_name || "",
        phone: form.phone || "",
        country: form.country || "",
        country_code: form.country_code || "",
        lang: form.lang || "en",
        language: form.lang || "en",
        profile_picture: form.profile_picture || "",
        bio: form.bio || "",
        age: form.age ? Number(form.age) : "",
        current_level: form.current_level || "",
        interested_in: form.interested_in || "",
        comments: form.comments || "",
        interests: Array.isArray(form.interests) ? form.interests : [],
        education: Array.isArray(form.education) ? form.education : [],
        selected_courses: Array.isArray(form.selected_courses) ? form.selected_courses : [],
        preferred_countries: Array.isArray(form.preferred_countries) ? form.preferred_countries : [],
        study_areas: Array.isArray(form.study_areas) ? form.study_areas : [],
        spoken_languages: Array.isArray(form.spoken_languages) ? form.spoken_languages : [],
        gpa: form.gpa || "",
        ielts: form.ielts || "",
        budget: form.budget || "",
        intake_year: form.intake_year || "",
        preferred_programs: Array.isArray(form.preferred_programs) ? form.preferred_programs : [],
        target_country: form.target_country || "",
        target_program: form.target_program || "",
        scholarship_interest: form.scholarship_interest || "",
        academic_background: form.academic_background || "",
        high_school: form.high_school || "",
        university: form.university || "",
        achievements: form.achievements || "",
        updated_at: serverTimestamp(),
      };

      if (role !== "user") {
        updates.date_of_birth = form.date_of_birth || "";
        updates.gender = form.gender || "";
      }

      if (role === "agent") {
        updates.agent_profile = {
          company_name: form.company_name || "",
          business_license_mst: form.business_license_mst || "",
          year_established: form.year_established || "",
          bio: form.bio || "",
        };
      }

      if (role === "tutor") {
        updates.tutor_profile = {
          specializations: csvToArray(form.specializations),
          experience_years: Number(form.experience_years) || 0,
          hourly_rate: Number(form.hourly_rate) || 0,
          bio: form.bio || "",
        };
      }

      if (role === "vendor") {
        updates.vendor_profile = {
          business_name: form.business_name || "",
          service_categories: form.service_categories || [],
          paypal_email: form.paypal_email || "",
          bio: form.bio || "",
        };
      }

      await updateDoc(uref, updates);

      try {
        localStorage.setItem("gp_lang", updates.lang || "en");
      } catch {}

      window.dispatchEvent(new CustomEvent("gp_lang_changed", { detail: updates.lang || "en" }));

      setSaveNotice({
        type: "success",
        text: tr("alerts.saved", "Saved! All changes were updated."),
      });

      setTimeout(() => setSaveNotice(null), 4000);
      setIsEditing(false);
      await loadProfile(uid);
    } catch (e) {
      console.error("Save failed:", e);
      setSaveNotice({
        type: "error",
        text: tr("alerts.save_failed", "Failed to save changes. Please try again."),
      });
      setTimeout(() => setSaveNotice(null), 6000);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = async () => {
    setIsEditing(false);
    if (uid) {
      await loadProfile(uid);
    }
  };

  const activeQrToken = showReferralByRole(
    role,
    agentReferralToken,
    studentReferralToken,
    tutorReferralToken,
    collaboratorReferralToken
  );
  const activeQrLink = showReferralByRole(
    role,
    agentReferralLink,
    studentReferralLink,
    tutorReferralLink,
    collaboratorReferralLink
  );
  const activeQrImage = showReferralByRole(
    role,
    agentReferralQr,
    studentReferralQr,
    tutorReferralQr,
    collaboratorReferralQr
  );

  const handleCopyReferralLink = async () => {
    if (!activeQrLink) return;

    try {
      await navigator.clipboard.writeText(activeQrLink);
      setSaveNotice({
        type: "success",
        text: tr("qr.link_copied", "Referral link copied."),
      });
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (e) {
      console.error("Copy referral link failed:", e);
      setSaveNotice({
        type: "error",
        text: tr("qr.copy_failed", "Failed to copy referral link."),
      });
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  const handleDownloadQr = () => {
    if (!activeQrImage) return;
    const a = document.createElement("a");
    a.href = activeQrImage;
    a.download =
      role === "agent"
        ? "greenpass-agent-referral-qr.png"
        : role === "tutor"
          ? "greenpass-tutor-referral-qr.png"
          : role === "collaborator"
            ? "greenpass-collaborator-referral-qr.png"
            : "greenpass-student-qr.png";
    a.click();
  };

  const displayName = (form.full_name || tr("default_user", "User")).trim();
  const initial = displayName.charAt(0).toUpperCase() || "U";
  const avatarBg = "bg-gradient-to-br from-green-500 to-blue-500";
  const profilePhoto = form.profile_picture || form.photo_url || form.photoURL || "";

  const isVerified = verification?.status === "verified" || Boolean(userDoc?.is_verified);
  const isSubscribed =
    Boolean(userDoc?.subscription_active) ||
    ["active", "subscribed"].includes(String(userDoc?.subscription_status || "").toLowerCase());

  const subscriptionLabel = isSubscribed
    ? tr("subscription.subscribed", "Subscribed")
    : tr("subscription.not_subscribed", "Not subscribed");

  const verificationLabel = isVerified
    ? tr("verification.verified", "Verified")
    : tr("verification.unverified", "Unverified");

  const memberSince = useMemo(() => {
    const raw = userDoc?.created_at;

    try {
      const date =
        typeof raw?.toDate === "function"
          ? raw.toDate()
          : raw instanceof Date
            ? raw
            : null;

      if (!date || Number.isNaN(date.getTime())) {
        return tr("member_since_unknown", "Recently joined");
      }

      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return tr("member_since_unknown", "Recently joined");
    }
  }, [userDoc?.created_at, tr]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 animate-spin text-green-600" />
      </div>
    );
  }

  const showStudent = role === "user";
  const showAgent = role === "agent";
  const showTutor = role === "tutor";
  const showSchool = role === "school";
  const showVendor = role === "vendor";
  const showCollaborator = role === "collaborator";

  const detailsTabLabel = showStudent
    ? tr("student_profile", "Student Profile")
    : showAgent
      ? tr("agent_details", "Agent Details")
      : showTutor
        ? tr("tutor_details", "Tutor Details")
        : showSchool
          ? tr("school_details", "School Details")
          : showCollaborator
          ? tr("collaborator_details", "Collaborator Details")
          : tr("vendor_details", "Vendor Details");

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
          <ProfileHeader
            tr={tr}
            displayName={displayName}
            roleLabel={meta.label}
            profilePhoto={profilePhoto}
            initial={initial}
            avatarBg={avatarBg}
            onUpload={handleUploadProfilePicture}
            uploading={uploadingProfilePic}
            isVerified={isVerified}
            isSubscribed={!subscriptionModeLoading && subscriptionModeEnabled && isSubscribed}
            verificationLabel={verificationLabel}
            subscriptionLabel={subscriptionLabel}
            isEditing={isEditing}
            onStartEdit={() => setIsEditing(true)}
            onCancelEdit={handleCancelEdit}
            onSave={handleSaveAll}
            saving={saving}
            languageValue={form.lang || "en"}
            onLanguageChange={handleLanguageChange}
          />
          {saveNotice && (
            <div
              className={[
                "rounded-2xl border px-4 py-3 text-sm",
                saveNotice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-rose-200 bg-rose-50 text-rose-900",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="leading-5">{saveNotice.text}</div>
                <button
                  type="button"
                  onClick={() => setSaveNotice(null)}
                  className="rounded-full px-2 py-1 text-xs font-semibold hover:bg-white/60"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <ProfileSection title={tr("about", "About")} icon={User}>
                <div className="space-y-3 text-sm text-gray-600">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr("role", "Role")}</p>
                    <Badge variant="outline">{meta.label}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">
                      {tr("member_since", "Member Since")}
                    </p>
                    <p>{memberSince}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{tr("status", "Status")}</p>
                    <Badge
                      variant="secondary"
                      className={
                        isVerified
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }
                    >
                      {verificationLabel}
                    </Badge>
                  </div>
                </div>
              </ProfileSection>
            </div>

            <div className="lg:col-span-2 space-y-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full grid grid-cols-4 rounded-2xl h-auto p-1">
                  <TabsTrigger value="personal" className="rounded-xl">
                    {tr("personal_information", "Personal Information")}
                  </TabsTrigger>
                  <TabsTrigger value="details" className="rounded-xl">
                    {detailsTabLabel}
                  </TabsTrigger>
                  <TabsTrigger value="qr" className="rounded-xl">
                    {tr("qr.title", "QR Code")}
                  </TabsTrigger>
                  <TabsTrigger value="validation" className="rounded-xl">
                    {tr("validation.title", "Validation")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="personal" className="mt-6">
                  <ProfileSection
                    title={tr("personal_information", "Personal Information")}
                    icon={Globe}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="full_name">
                          {tr("full_name", "Full Name")} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="full_name"
                          value={form.full_name}
                          disabled={!isEditing}
                          onChange={(e) => setField("full_name", e.target.value)}
                          placeholder={tr("enter_full_name", "Enter your full name")}
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label htmlFor="email">
                          {tr("email_login", "Email (Login)")} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          value={form.email}
                          disabled
                          className="bg-gray-50"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Label htmlFor="phone">
                          {tr("phone", "Phone")} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={form.phone}
                          disabled={!isEditing}
                          onChange={(e) => setField("phone", e.target.value)}
                          placeholder="+1 234 567 8900"
                        />
                      </div>

                      {showStudent ? (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="current_level">
                            {tr("current_level", "Current Level")}{" "}
                            <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="current_level"
                            value={form.current_level}
                            disabled={!isEditing}
                            onChange={(e) => setField("current_level", e.target.value)}
                            placeholder={tr("current_level_placeholder", "e.g. Masters")}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="date_of_birth">{tr("date_of_birth", "Date of Birth")}</Label>
                          <Input
                            id="date_of_birth"
                            type="date"
                            value={form.date_of_birth}
                            disabled={!isEditing}
                            onChange={(e) => setField("date_of_birth", e.target.value)}
                          />
                        </div>
                      )}

                      {showStudent ? (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="age">{tr("age", "Age")}</Label>
                          <Input
                            id="age"
                            type="number"
                            min="0"
                            value={form.age}
                            disabled={!isEditing}
                            onChange={(e) => setField("age", e.target.value)}
                            placeholder={tr("age_placeholder", "Enter your age")}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="gender">{tr("gender", "Gender")}</Label>
                          <Select
                            value={form.gender}
                            onValueChange={(value) => isEditing && setField("gender", value)}
                            disabled={!isEditing}
                          >
                            <SelectTrigger id="gender">
                              <SelectValue placeholder={tr("select_gender", "Select gender")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">{tr("gender_male", "Male")}</SelectItem>
                              <SelectItem value="female">{tr("gender_female", "Female")}</SelectItem>
                              <SelectItem value="other">{tr("gender_other", "Other")}</SelectItem>
                              <SelectItem value="prefer-not-to-say">
                                {tr("gender_prefer_not_to_say", "Prefer not to say")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      <div className="flex flex-col gap-2 md:col-span-2">
                        <Label htmlFor="country">
                          {tr("country", "Country")} <span className="text-red-500">*</span>
                        </Label>
                        <CountrySelect
                          disabled={!isEditing}
                          locale={form.lang || "en"}
                          valueCode={form.country_code}
                          valueName={form.country}
                          onChange={({ code, name }) => {
                            setField("country", name || "");
                            setField("country_code", (code || "").toUpperCase());
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-6">
                      <Label htmlFor="bio">
                        {tr("bio_label", "Biography / Description")}{" "}
                        {showStudent ? <span className="text-red-500">*</span> : null}
                      </Label>
                      <Textarea
                        id="bio"
                        value={form.bio}
                        disabled={!isEditing}
                        onChange={(e) => setField("bio", e.target.value)}
                        placeholder={tr(
                          "bio_placeholder",
                          "Write a short bio/description shown on your profile..."
                        )}
                        rows={6}
                        className="resize-none"
                      />
                      <p className="text-sm text-gray-500">
                        {tr(
                          "bio_help_long",
                          "Tell others about yourself, your interests, and what makes you unique."
                        )}
                      </p>
                    </div>
                  </ProfileSection>
                </TabsContent>

                <TabsContent value="details" className="mt-6">
                  {showStudent && (
                    <ProfileSection title={tr("student_profile", "Student Profile")} icon={BookOpen}>
                      <div className="space-y-6">
                        {/* Student Snapshot */}
                        <div className="rounded-2xl border bg-gradient-to-br from-slate-50 to-white p-5">
                          <div className="flex items-center justify-between gap-3 mb-4">
                            <div>
                              <h3 className="text-base font-semibold text-gray-900">
                                {tr("student_snapshot", "Student Snapshot")}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {tr(
                                  "student_snapshot_help",
                                  "A quick overview of the student's goals and academic profile."
                                )}
                              </p>
                            </div>
                            <Badge variant="outline" className="rounded-full">
                              {tr("profile_summary", "Profile Summary")}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            <div className="rounded-xl border bg-white p-4">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                {tr("target", "Target")}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-gray-900">
                                {form.target_country || tr("not_set", "Not set")}
                              </p>
                              <p className="text-sm text-gray-600">
                                {form.target_program || tr("not_set", "Not set")}
                              </p>
                            </div>

                            <div className="rounded-xl border bg-white p-4">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                {tr("intake_budget", "Intake & Budget")}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-gray-900">
                                {form.intake_year || tr("not_set", "Not set")}
                              </p>
                              <p className="text-sm text-gray-600">
                                {form.budget || tr("not_set", "Not set")}
                              </p>
                            </div>

                            <div className="rounded-xl border bg-white p-4">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                {tr("academic", "Academic")}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-gray-900">
                                GPA: {form.gpa || tr("not_set", "Not set")}
                              </p>
                              <p className="text-sm text-gray-600">
                                IELTS: {form.ielts || tr("not_set", "Not set")}
                              </p>
                            </div>

                            <div className="rounded-xl border bg-white p-4">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                {tr("scholarship", "Scholarship")}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-gray-900 capitalize">
                                {form.scholarship_interest || tr("not_set", "Not set")}
                              </p>
                              <p className="text-sm text-gray-600 line-clamp-2">
                                {form.academic_background || tr("no_summary_yet", "No academic summary yet")}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Study Goal */}
                        <div className="rounded-2xl border bg-white p-5">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-gray-900">
                              {tr("study_goal", "Study Goal")}
                            </h3>
                            <p className="text-sm text-gray-500">
                              {tr(
                                "study_goal_help",
                                "Define where the student wants to study, what they want to take, and their intake plan."
                              )}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-2">
                              <Label htmlFor="target_country">
                                {tr("target_country", "Target Country")}{" "}
                                <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                id="target_country"
                                value={form.target_country}
                                disabled={!isEditing}
                                onChange={(e) => setField("target_country", e.target.value)}
                                placeholder={tr("target_country_placeholder", "e.g. Canada")}
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="target_program">
                                {tr("target_program", "Target Program")}{" "}
                                <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                id="target_program"
                                value={form.target_program}
                                disabled={!isEditing}
                                onChange={(e) => setField("target_program", e.target.value)}
                                placeholder={tr("target_program_placeholder", "e.g. Computer Engineering")}
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="intake_year">{tr("intake_year", "Intake Year")}</Label>
                              <Input
                                id="intake_year"
                                value={form.intake_year}
                                disabled={!isEditing}
                                onChange={(e) => setField("intake_year", e.target.value)}
                                placeholder={tr("intake_year_placeholder", "e.g. 2026")}
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="budget">{tr("budget", "Budget")}</Label>
                              <Input
                                id="budget"
                                value={form.budget}
                                disabled={!isEditing}
                                onChange={(e) => setField("budget", e.target.value)}
                                placeholder={tr("budget_placeholder", "e.g. 25000")}
                              />
                            </div>

                            <div className="flex flex-col gap-2 md:col-span-2">
                              <Label htmlFor="scholarship_interest">
                                {tr("scholarship_interest", "Scholarship Interest")}
                              </Label>
                              <Select
                                value={form.scholarship_interest || ""}
                                onValueChange={(value) => isEditing && setField("scholarship_interest", value)}
                                disabled={!isEditing}
                              >
                                <SelectTrigger id="scholarship_interest">
                                  <SelectValue
                                    placeholder={tr(
                                      "scholarship_interest_placeholder",
                                      "Select scholarship interest"
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="yes">{tr("yes", "Yes")}</SelectItem>
                                  <SelectItem value="no">{tr("no", "No")}</SelectItem>
                                  <SelectItem value="maybe">{tr("maybe", "Maybe")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>

                        {/* Academic Snapshot */}
                        <div className="rounded-2xl border bg-white p-5">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-gray-900">
                              {tr("academic_snapshot", "Academic Snapshot")}
                            </h3>
                            <p className="text-sm text-gray-500">
                              {tr(
                                "academic_snapshot_help",
                                "Highlight academic history, qualifications, and language test results."
                              )}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex flex-col gap-2">
                              <Label htmlFor="gpa">{tr("gpa", "GPA")}</Label>
                              <Input
                                id="gpa"
                                value={form.gpa}
                                disabled={!isEditing}
                                onChange={(e) => setField("gpa", e.target.value)}
                                placeholder={tr("gpa_placeholder", "e.g. 3.5 / 4.0")}
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="ielts">{tr("ielts", "IELTS")}</Label>
                              <Input
                                id="ielts"
                                value={form.ielts}
                                disabled={!isEditing}
                                onChange={(e) => setField("ielts", e.target.value)}
                                placeholder={tr("ielts_placeholder", "e.g. 6.5")}
                              />
                            </div>

                            <div className="flex flex-col gap-2 md:col-span-2">
                              <Label htmlFor="academic_background">
                                {tr("academic_summary", "Academic Summary")}{" "}
                                <span className="text-red-500">*</span>
                              </Label>
                              <Textarea
                                id="academic_background"
                                rows={4}
                                value={form.academic_background}
                                disabled={!isEditing}
                                onChange={(e) => setField("academic_background", e.target.value)}
                                placeholder={tr(
                                  "academic_background_placeholder",
                                  "Summarize your education, honors, strand, major, and current academic standing"
                                )}
                                className="resize-none"
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="high_school">{tr("high_school", "High School")}</Label>
                              <Input
                                id="high_school"
                                value={form.high_school}
                                disabled={!isEditing}
                                onChange={(e) => setField("high_school", e.target.value)}
                                placeholder={tr("high_school_placeholder", "Enter your high school")}
                              />
                            </div>

                            <div className="flex flex-col gap-2">
                              <Label htmlFor="university">{tr("university", "University / College")}</Label>
                              <Input
                                id="university"
                                value={form.university}
                                disabled={!isEditing}
                                onChange={(e) => setField("university", e.target.value)}
                                placeholder={tr("university_placeholder", "Enter your university or college")}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Preferences */}
                        <div className="rounded-2xl border bg-white p-5">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-gray-900">
                              {tr("preferences", "Preferences")}
                            </h3>
                            <p className="text-sm text-gray-500">
                              {tr(
                                "preferences_help",
                                "List the student's preferred programs, countries, study areas, and languages."
                              )}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <SimpleArrayInput
                              id="preferred_programs"
                              label={
                                <>
                                  {tr("preferred_programs", "Preferred Programs")}{" "}
                                  <span className="text-red-500">*</span>
                                </>
                              }
                              value={form.preferred_programs}
                              disabled={!isEditing}
                              onChange={(v) => setField("preferred_programs", v)}
                              placeholder={tr(
                                "preferred_programs_placeholder",
                                "Example: Computer Engineering, Information Technology, Data Analytics"
                              )}
                              helpText={tr("comma_help", "Separate multiple values with commas.")}
                            />

                            <SimpleArrayInput
                              id="selected_courses"
                              label={tr("programs_of_interest", "Programs of Interest")}
                              value={form.selected_courses}
                              disabled={!isEditing}
                              onChange={(v) => setField("selected_courses", v)}
                              placeholder={tr(
                                "courses_placeholder",
                                "Example: Diploma, Bachelor's Degree, Postgraduate Certificate"
                              )}
                              helpText={tr("comma_help", "Separate multiple values with commas.")}
                            />

                            <SimpleArrayInput
                              id="preferred_countries"
                              label={tr("preferred_study_countries", "Preferred Study Countries")}
                              value={form.preferred_countries}
                              disabled={!isEditing}
                              onChange={(v) => setField("preferred_countries", v)}
                              placeholder={tr(
                                "countries_placeholder",
                                "Example: Canada, Australia, New Zealand"
                              )}
                              helpText={tr("comma_help", "Separate multiple values with commas.")}
                            />

                            <SimpleArrayInput
                              id="study_areas"
                              label={
                                <>
                                  {tr("study_areas", "Study Areas / Fields of Interest")}{" "}
                                  <span className="text-red-500">*</span>
                                </>
                              }
                              value={form.study_areas}
                              disabled={!isEditing}
                              onChange={(v) => setField("study_areas", v)}
                              placeholder={tr(
                                "areas_placeholder",
                                "Example: Engineering, Business, Healthcare, Media"
                              )}
                              helpText={tr("comma_help", "Separate multiple values with commas.")}
                            />

                            <div className="md:col-span-2">
                              <SimpleArrayInput
                                id="spoken_languages"
                                label={tr("languages_spoken", "Languages Spoken")}
                                value={form.spoken_languages}
                                disabled={!isEditing}
                                onChange={(v) => setField("spoken_languages", v)}
                                placeholder={tr(
                                  "languages_placeholder",
                                  "Example: English, Tagalog, Cebuano"
                                )}
                                helpText={tr("comma_help", "Separate multiple values with commas.")}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Strengths */}
                        <div className="rounded-2xl border bg-white p-5">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-gray-900">
                              {tr("strengths", "Strengths")}
                            </h3>
                            <p className="text-sm text-gray-500">
                              {tr(
                                "strengths_help",
                                "Show achievements, awards, leadership experience, and recognitions."
                              )}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-6">
                            <div className="flex flex-col gap-2">
                              <Label htmlFor="achievements">
                                {tr("awards_leadership_recognitions", "Awards, Leadership, and Recognitions")}
                              </Label>
                              <Textarea
                                id="achievements"
                                rows={4}
                                value={form.achievements}
                                disabled={!isEditing}
                                onChange={(e) => setField("achievements", e.target.value)}
                                placeholder={tr(
                                  "achievements_placeholder",
                                  "Include awards, honors, leadership roles, recognitions, competitions, or certifications"
                                )}
                                className="resize-none"
                              />
                            </div>
                          </div>
                        </div>

                        {!userDoc?.onboarding_completed ? (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                              <div>
                                <p className="font-semibold">
                                  {tr("onboarding_incomplete", "Onboarding incomplete")}
                                </p>
                                <p className="mt-1 text-amber-800">
                                  {tr(
                                    "qr.onboarding_required_help",
                                    "You must complete onboarding before your Student QR can unlock."
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </ProfileSection>
                  )}

                  {showAgent && (
                    <ProfileSection title={tr("agent_details", "Agent Details")} icon={Briefcase}>
                      <div className="space-y-4">
                        <div>
                          <Label>{tr("company_name", "Company Name *")}</Label>
                          <Input
                            value={form.company_name}
                            disabled={!isEditing}
                            onChange={(e) => setField("company_name", e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{tr("business_license_mst", "Business License (MST) *")}</Label>
                          <Input
                            value={form.business_license_mst}
                            disabled={!isEditing}
                            onChange={(e) => setField("business_license_mst", e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{tr("year_established", "Year Established")}</Label>
                          <Input
                            type="number"
                            value={form.year_established}
                            disabled={!isEditing}
                            onChange={(e) => setField("year_established", e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </ProfileSection>
                  )}

                  {showTutor && (
                    <ProfileSection title={tr("tutor_details", "Tutor Details")} icon={BookOpen}>
                      <div className="space-y-4">
                        <div>
                          <Label>{tr("specializations", "Specializations *")}</Label>
                          <Input
                            value={form.specializations}
                            disabled={!isEditing}
                            onChange={(e) => setField("specializations", e.target.value)}
                            className="mt-1"
                            placeholder={tr("specializations_placeholder", "IELTS, TOEFL...")}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label>{tr("experience_years", "Years of Experience *")}</Label>
                            <Input
                              type="number"
                              value={form.experience_years}
                              disabled={!isEditing}
                              onChange={(e) => setField("experience_years", e.target.value)}
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label>{tr("hourly_rate_usd", "Hourly Rate (USD) *")}</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={form.hourly_rate}
                              disabled={!isEditing}
                              onChange={(e) => setField("hourly_rate", e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        </div>

                      </div>
                    </ProfileSection>
                  )}

                  {showVendor && (
                    <ProfileSection title={tr("vendor_details", "Vendor Details")} icon={Store}>
                      <div className="space-y-4">
                        <div>
                          <Label>{tr("business_name", "Business Name *")}</Label>
                          <Input
                            value={form.business_name}
                            disabled={!isEditing}
                            onChange={(e) => setField("business_name", e.target.value)}
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label>{tr("service_categories", "Service Categories *")}</Label>
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            {vendorCategoryOptions.map(({ value, label }) => (
                              <div key={value} className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={`cat-${value}`}
                                  checked={form.service_categories?.includes(value) || false}
                                  disabled={!isEditing}
                                  onChange={(e) => {
                                    const cur = form.service_categories || [];
                                    const next = e.target.checked
                                      ? [...cur, value]
                                      : cur.filter((c) => c !== value);
                                    setField("service_categories", next);
                                  }}
                                  className="h-4 w-4"
                                />
                                <label htmlFor={`cat-${value}`} className="text-sm text-gray-700">
                                  {label}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <Label>{tr("paypal_email", "PayPal Email *")}</Label>
                          <Input
                            type="email"
                            value={form.paypal_email}
                            disabled={!isEditing}
                            onChange={(e) => setField("paypal_email", e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </ProfileSection>
                  )}

                  {showSchool && (
                    <ProfileSection title={tr("school_details", "School Details")} icon={Building}>
                      <div className="space-y-4">
                        <div>
                          <Label>{tr("institution_name", "Institution Name *")}</Label>
                          <Input
                            value={form.school_name}
                            disabled={!isEditing}
                            onChange={(e) => setField("school_name", e.target.value)}
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label>{tr("school_type", "School Type *")}</Label>
                          <Select
                            value={form.type || ""}
                            onValueChange={(v) => isEditing && setField("type", v)}
                            disabled={!isEditing}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue
                                placeholder={tr(
                                  "select_institution_type",
                                  "Select institution type"
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {schoolTypeOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>{tr("city_location", "City/Location *")}</Label>
                          <Input
                            value={form.location}
                            disabled={!isEditing}
                            onChange={(e) => setField("location", e.target.value)}
                            className="mt-1"
                          />
                        </div>

                        <div>
                          <Label>{tr("official_website", "Official Website *")}</Label>
                          <Input
                            value={form.website}
                            disabled={!isEditing}
                            onChange={(e) => setField("website", e.target.value)}
                            className="mt-1"
                            placeholder="https://..."
                          />
                        </div>

                        <div>
                          <Label>{tr("about_institution", "About Your Institution")}</Label>
                          <Textarea
                            value={form.about}
                            disabled={!isEditing}
                            onChange={(e) => setField("about", e.target.value)}
                            className="mt-1"
                            rows={3}
                          />
                        </div>
                      </div>
                    </ProfileSection>
                  )}
                </TabsContent>

                <TabsContent value="qr" className="mt-6">
                  <ProfileSection title={tr("qr.title", "QR Code")} icon={QrCode}>
                    {showAgent ? (
                      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
                        <Card className="rounded-3xl border shadow-none">
                          <CardContent className="p-5 flex flex-col items-center gap-4">
                            {qrLoading ? (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                              </div>
                            ) : agentReferralQr ? (
                              <img
                                src={agentReferralQr}
                                alt="Agent referral QR"
                                className="w-[280px] h-[280px] object-contain rounded-2xl border bg-white"
                              />
                            ) : (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-4">
                                {tr("qr.unavailable", "QR code unavailable.")}
                              </div>
                            )}

                            <div className="text-center">
                              <p className="font-semibold text-gray-900">
                                {tr("qr.agent_title", "My Referral QR")}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {tr(
                                  "qr.agent_help",
                                  "Students who use this QR will open signup with the Student role already selected, then get linked to your referral after signup or acceptance."
                                )}
                              </p>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-5">
                          <div className="space-y-2">
                            <Label>{tr("qr.referral_link", "Referral Link")}</Label>
                            <Input
                              value={agentReferralLink}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_link", "Loading referral link...")}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>{tr("qr.referral_token", "Referral Token")}</Label>
                            <Input
                              value={agentReferralToken}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_token", "Loading token...")}
                            />
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCopyReferralLink}
                              disabled={!agentReferralLink}
                              className="rounded-xl"
                            >
                              <Copy className="w-4 h-4 mr-2" />
                              {tr("qr.copy_link", "Copy Link")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleDownloadQr}
                              disabled={!agentReferralQr}
                              className="rounded-xl"
                            >
                              <Download className="w-4 h-4 mr-2" />
                              {tr("qr.download_qr", "Download QR")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => window.open(agentReferralLink, "_blank", "noopener,noreferrer")}
                              disabled={!agentReferralLink}
                              className="rounded-xl"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              {tr("qr.open_link", "Open Link")}
                            </Button>
                          </div>

                          <div className="rounded-2xl border bg-blue-50 text-blue-900 p-4 text-sm leading-6">
                            <p className="font-semibold mb-1">
                              {tr("qr.how_it_works", "How it works")}
                            </p>
                            <p>
                              {tr(
                                "qr.how_it_works_body",
                                "Share this QR with students. New users who open it will go straight into signup with Student preselected, while existing students can still accept the referral and be added to your client list."
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : showStudent ? (
                      <>
                        {!userDoc?.onboarding_completed && (
                          <div className="mb-6">
                            <StudentQrGuideCard
                              tr={tr}
                              progressText={studentQrProgressText}
                              completedCount={studentQrCompletedCount}
                              totalCount={studentQrTotalCount}
                              missingItemsDetailed={studentQrMissingItemsDetailed}
                              onboardingDone={Boolean(userDoc?.onboarding_completed)}
                              onOpenTab={setActiveTab}
                            />
                          </div>
                        )}

                        {studentQrReady ? (
                          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
                            <Card className="rounded-3xl border shadow-none">
                              <CardContent className="p-5 flex flex-col items-center gap-4">
                                {qrLoading ? (
                                  <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                                  </div>
                                ) : studentReferralQr ? (
                                  <img
                                    src={studentReferralQr}
                                    alt="Student school lead QR"
                                    className="w-[280px] h-[280px] object-contain rounded-2xl border bg-white"
                                  />
                                ) : (
                                  <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-4">
                                    {tr("qr.unavailable", "QR code unavailable.")}
                                  </div>
                                )}

                                <div className="text-center">
                                  <p className="font-semibold text-gray-900">
                                    {tr("qr.student_title", "My Student QR")}
                                  </p>
                                  <p className="text-sm text-gray-600 mt-1">
                                    {tr(
                                      "qr.student_help",
                                      "Share this QR with schools. They will be taken to School Leads and can choose whether to add you to their lead list."
                                    )}
                                  </p>
                                </div>
                              </CardContent>
                            </Card>

                            <div className="space-y-5">
                              <div className="space-y-2">
                                <Label>{tr("qr.referral_link", "Referral Link")}</Label>
                                <Input
                                  value={studentReferralLink}
                                  readOnly
                                  className="bg-gray-50"
                                  placeholder={tr("qr.loading_link", "Loading referral link...")}
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>{tr("qr.referral_token", "Referral Token")}</Label>
                                <Input
                                  value={studentReferralToken}
                                  readOnly
                                  className="bg-gray-50"
                                  placeholder={tr("qr.loading_token", "Loading token...")}
                                />
                              </div>

                              <div className="flex flex-wrap gap-3">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={handleCopyReferralLink}
                                  disabled={!studentReferralLink}
                                  className="rounded-xl"
                                >
                                  <Copy className="w-4 h-4 mr-2" />
                                  {tr("qr.copy_link", "Copy Link")}
                                </Button>

                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={handleDownloadQr}
                                  disabled={!studentReferralQr}
                                  className="rounded-xl"
                                >
                                  <Download className="w-4 h-4 mr-2" />
                                  {tr("qr.download_qr", "Download QR")}
                                </Button>

                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => window.open(studentReferralLink, "_blank", "noopener,noreferrer")}
                                  disabled={!studentReferralLink}
                                  className="rounded-xl"
                                >
                                  <ExternalLink className="w-4 h-4 mr-2" />
                                  {tr("qr.open_link", "Open Link")}
                                </Button>
                              </div>

                              <div className="rounded-2xl border bg-blue-50 text-blue-900 p-4 text-sm leading-6">
                                <p className="font-semibold mb-1">
                                  {tr("qr.how_it_works", "How it works")}
                                </p>
                                <p>
                                  {tr(
                                    "qr.student_how_it_works_body",
                                    "A school with an existing school account can scan this QR. They will see your name first, then choose Accept or Decline before you are added to School Leads."
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
                            <div className="flex items-start gap-3">
                              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <p className="font-semibold">
                                  {tr(
                                    "qr.student_complete_profile_first",
                                    "Complete onboarding first to unlock your QR."
                                  )}
                                </p>
                                <p className="text-sm mt-1 text-amber-800">
                                  {tr(
                                    "qr.student_complete_profile_help",
                                    "Complete onboarding first. Once onboarding is done, your Student QR will be available even if the rest of your profile is not finished yet."
                                  )}
                                </p>
                                {studentQrMissingItems.length > 0 ? (
                                  <div className="mt-3 text-sm text-amber-800">
                                    <span className="font-medium">
                                      {tr("qr.missing_items", "Missing items")}:
                                    </span>{" "}
                                    {studentQrMissingItems.join(", ")}
                                  </div>
                                ) : null}
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-xl bg-white"
                                    onClick={() => setActiveTab("details")}
                                  >
                                    {tr("qr.go_to_student_profile", "Go to Student Profile")}
                                  </Button>
                                  {!userDoc?.onboarding_completed ? (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-300 text-amber-800 bg-white"
                                    >
                                      {tr("onboarding_incomplete", "Onboarding incomplete")}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : showTutor ? (
                      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
                        <Card className="rounded-3xl border shadow-none">
                          <CardContent className="p-5 flex flex-col items-center gap-4">
                            {qrLoading ? (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                              </div>
                            ) : tutorReferralQr ? (
                              <img
                                src={tutorReferralQr}
                                alt="Tutor referral QR"
                                className="w-[280px] h-[280px] object-contain rounded-2xl border bg-white"
                              />
                            ) : (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-4">
                                {tr("qr.unavailable", "QR code unavailable.")}
                              </div>
                            )}

                            <div className="text-center">
                              <p className="font-semibold text-gray-900">
                                {tr("qr.tutor_title", "My Tutor QR")}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {tr(
                                  "qr.tutor_help",
                                  "Share this QR or link so users can open your tutor referral flow."
                                )}
                              </p>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-5">
                          <div className="space-y-2">
                            <Label>{tr("qr.referral_link", "Referral Link")}</Label>
                            <Input
                              value={tutorReferralLink}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_link", "Loading referral link...")}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>{tr("qr.referral_token", "Referral Token")}</Label>
                            <Input
                              value={tutorReferralToken}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_token", "Loading token...")}
                            />
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCopyReferralLink}
                              disabled={!tutorReferralLink}
                              className="rounded-xl"
                            >
                              <Copy className="w-4 h-4 mr-2" />
                              {tr("qr.copy_link", "Copy Link")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleDownloadQr}
                              disabled={!tutorReferralQr}
                              className="rounded-xl"
                            >
                              <Download className="w-4 h-4 mr-2" />
                              {tr("qr.download_qr", "Download QR")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => window.open(tutorReferralLink, "_blank", "noopener,noreferrer")}
                              disabled={!tutorReferralLink}
                              className="rounded-xl"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              {tr("qr.open_link", "Open Link")}
                            </Button>
                          </div>

                          <div className="rounded-2xl border bg-blue-50 text-blue-900 p-4 text-sm leading-6">
                            <p className="font-semibold mb-1">
                              {tr("qr.how_it_works", "How it works")}
                            </p>
                            <p>
                              {tr(
                                "qr.tutor_how_it_works_body",
                                "Share this QR with users who want to connect with you for tutoring services."
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : showCollaborator ? (
                      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
                        <Card className="rounded-3xl border shadow-none">
                          <CardContent className="p-5 flex flex-col items-center gap-4">
                            {qrLoading ? (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
                              </div>
                            ) : collaboratorReferralQr ? (
                              <img
                                src={collaboratorReferralQr}
                                alt="Collaborator referral QR"
                                className="w-[280px] h-[280px] object-contain rounded-2xl border bg-white"
                              />
                            ) : (
                              <div className="w-[280px] h-[280px] rounded-2xl border bg-gray-50 flex items-center justify-center text-sm text-gray-500 text-center px-4">
                                {tr("qr.unavailable", "QR code unavailable.")}
                              </div>
                            )}

                            <div className="text-center">
                              <p className="font-semibold text-gray-900">
                                {tr("qr.collaborator_title", "My Collaborator Referral QR")}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {tr(
                                  "qr.collaborator_help",
                                  "Share this QR or link with users. They will open signup through your collaborator referral flow."
                                )}
                              </p>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-5">
                          <div className="space-y-2">
                            <Label>{tr("qr.referral_link", "Referral Link")}</Label>
                            <Input
                              value={activeQrLink || ""}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_link", "Loading referral link...")}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>{tr("qr.referral_token", "Referral Token")}</Label>
                            <Input
                              value={activeQrToken || ""}
                              readOnly
                              className="bg-gray-50"
                              placeholder={tr("qr.loading_token", "Loading token...")}
                            />
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCopyReferralLink}
                              disabled={!activeQrLink}
                              className="rounded-xl"
                            >
                              <Copy className="w-4 h-4 mr-2" />
                              {tr("qr.copy_link", "Copy Link")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleDownloadQr}
                              disabled={!activeQrImage}
                              className="rounded-xl"
                            >
                              <Download className="w-4 h-4 mr-2" />
                              {tr("qr.download_qr", "Download QR")}
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => window.open(activeQrLink, "_blank", "noopener,noreferrer")}
                              disabled={!activeQrLink}
                              className="rounded-xl"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              {tr("qr.open_link", "Open Link")}
                            </Button>
                          </div>

                          <div className="rounded-2xl border bg-emerald-50 text-emerald-900 p-4 text-sm leading-6">
                            <p className="font-semibold mb-1">
                              {tr("qr.how_it_works", "How it works")}
                            </p>
                            <p>
                              {tr(
                                "qr.collaborator_how_it_works_body",
                                "When a user signs up using this link or QR, then completes profile and gets verified, your collaborator stats update in your dashboard and in admin progress."
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border bg-gray-50 p-5 text-sm text-gray-600">
                        {tr(
                          "qr.not_available_for_role",
                          "QR code is currently available for agent, student, tutor, and collaborator referral flows in this phase."
                        )}
                      </div>
                    )}
                  </ProfileSection>
                </TabsContent>

                <TabsContent value="validation" className="mt-6">
                  <ProfileSection title={tr("validation.title", "Validation")} icon={Briefcase}>
                    <div className="space-y-4">
                      {(verification.status === "rejected" || verification.status === "denied") &&
                      verification.reason ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                          <div className="font-semibold">
                            {tr("verification.denied_title", "Verification denied")}
                          </div>
                          <div className="mt-1">{verification.reason}</div>
                        </div>
                      ) : null}

                      {verificationFields.length === 0 ? (
                        <div className="text-sm text-gray-600">
                          {tr(
                            "verification.none_required",
                            "No verification documents required for your role."
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {verificationFields.map((f) => {
                            const url = verification.docs?.[f.key] || "";
                            const uploading = !!docUploading?.[f.key];

                            return (
                              <div key={f.key} className="rounded-2xl border bg-white p-4 space-y-3">
                                <div className="font-medium text-gray-900">
                                  {f.label} {f.required ? "*" : ""}
                                </div>

                                {url ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      setViewerUrl(url);
                                      setViewerName(f.label);
                                      setViewerOpen(true);
                                    }}
                                  >
                                    {tr("verification.view", "View uploaded document")}
                                  </Button>
                                ) : (
                                  <div className="text-sm text-gray-500">
                                    {tr("verification.no_file", "No file uploaded yet")}
                                  </div>
                                )}

                                {isEditing && (
                                  <div className="flex items-center gap-2">
                                    {url ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => clearVerificationDoc(f.key)}
                                      >
                                        {tr("verification.remove", "Remove")}
                                      </Button>
                                    ) : null}

                                    <label className="inline-flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="file"
                                        accept=".pdf,image/*"
                                        className="hidden"
                                        disabled={uploading}
                                        onChange={(e) => {
                                          const file = e.target.files?.[0] || null;
                                          e.target.value = "";
                                          if (file) uploadVerificationDoc(f.key, file);
                                        }}
                                      />
                                      <span
                                        className={
                                          "inline-flex items-center rounded-md border px-3 py-2 text-sm " +
                                          (uploading
                                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                            : "bg-white hover:bg-gray-50 text-gray-900")
                                        }
                                      >
                                        {uploading ? (
                                          <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            {tr("verification.uploading", "Uploading...")}
                                          </>
                                        ) : url ? (
                                          tr("verification.replace", "Replace")
                                        ) : (
                                          tr("verification.upload", "Upload")
                                        )}
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {verificationFields.length > 0 && isEditing ? (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            onClick={submitVerificationForReview}
                            disabled={submittingVerification || verification.status === "verified"}
                            className="bg-emerald-600 hover:bg-emerald-700"
                          >
                            {submittingVerification ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                {tr("verification.submitting", "Submitting...")}
                              </>
                            ) : verification.status === "pending" ? (
                              tr("verification.resubmit", "Submit again")
                            ) : (
                              tr("verification.submit", "Submit for review")
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </ProfileSection>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewerName || tr("verification.document", "Document")}</DialogTitle>
          </DialogHeader>

          <div className="w-full">
            {detectType(viewerUrl) === "image" ? (
              <img
                src={viewerUrl}
                alt={viewerName}
                className="w-full max-h-[70vh] object-contain rounded-lg"
              />
            ) : detectType(viewerUrl) === "pdf" ? (
              <iframe
                src={viewerUrl}
                title={viewerName || tr("verification.document", "Document")}
                className="w-full h-[70vh] rounded-lg border"
              />
            ) : (
              <div className="text-sm text-gray-700">
                {tr("verification.cannot_preview", "This file type can’t be previewed here.")}
                <div className="mt-3">
                  <a className="underline" href={viewerUrl} target="_blank" rel="noreferrer">
                    {tr("verification.open_new_tab", "Open in new tab")}
                  </a>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function showReferralByRole(role, agentValue, studentValue, collaboratorValue) {
  if (role === "agent") return agentValue;
  if (role === "user") return studentValue;
  if (role === "collaborator") return collaboratorValue;
  return "";
}