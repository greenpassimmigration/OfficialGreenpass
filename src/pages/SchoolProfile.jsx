// src/pages/SchoolProfile.jsx
import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadFile } from "@/api/integrations";
import {
  Building,
  Save,
  Upload,
  Loader2,
  ShieldAlert,
  School,
  Clock3,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";

/* ---------- Firebase ---------- */
import { db, auth } from "@/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
} from "firebase/firestore";

/* ---------- Helpers ---------- */
const CLAIM_REQUESTS_COLL = "institution_claim_requests";

const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  return v === "true" || v === true;
};

const schoolLevelToType = (level) => {
  switch (level) {
    case "College":
      return "college";
    case "Language School":
      return "language_school";
    case "High School":
      return "high_school";
    case "University":
    default:
      return "university";
  }
};

const typeToSchoolLevel = (type) => {
  switch (type) {
    case "college":
      return "College";
    case "language_school":
      return "Language School";
    case "high_school":
      return "High School";
    case "university":
    default:
      return "University";
  }
};

const EMPTY_FORM = {
  institution_id: "",

  name: "",
  school_level: "University",
  school_type: "university",

  location: "",
  province: "",
  country: "",
  address: "",

  founded_year: new Date().getFullYear(),
  about: "",
  website: "",

  email: "",
  phone: "",

  image_url: "",
  image_urls: [],
  logo_url: "",
  banner_url: "",

  rating: 0,
  acceptance_rate: 0,
  tuition_fees: 0,
  application_fee: 0,
  cost_of_living: 0,

  is_public: "public",
  pgwp_available: "false",
  has_coop: "false",
  is_dli: "false",
  dli_number: "",
};

function toValidDate(v) {
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return Number.isNaN(d?.getTime()) ? null : d;
    }
    if (typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return Number.isNaN(d?.getTime()) ? null : d;
    }
  }
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d?.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d?.getTime()) ? null : d;
  }
  return null;
}

function formatDateTime(v) {
  const d = toValidDate(v);
  if (!d) return "—";
  try {
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export default function SchoolProfile() {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);

  const [hasClaimedProfile, setHasClaimedProfile] = useState(false);
  const [latestClaimRequest, setLatestClaimRequest] = useState(null);
  const [saveMode, setSaveMode] = useState("user_draft"); // user_draft | institution
  const [draftDocId, setDraftDocId] = useState("");

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const loadSchoolData = useCallback(async () => {
    setLoading(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setHasClaimedProfile(false);
        setLatestClaimRequest(null);
        setSaveMode("user_draft");
        setDraftDocId("");
        setFormData(EMPTY_FORM);
        return;
      }

      const [institutionSnap, claimReqSnap, userSnap] = await Promise.all([
        getDocs(
          query(collection(db, "institutions"), where("user_id", "==", uid), limit(1))
        ),
        getDocs(
          query(
            collection(db, CLAIM_REQUESTS_COLL),
            where("requested_by_uid", "==", uid),
            orderBy("created_at", "desc"),
            limit(1)
          )
        ),
        getDoc(doc(db, "users", uid)),
      ]);

      if (!claimReqSnap.empty) {
        setLatestClaimRequest({
          id: claimReqSnap.docs[0].id,
          ...claimReqSnap.docs[0].data(),
        });
      } else {
        setLatestClaimRequest(null);
      }

      const userData = userSnap.exists() ? userSnap.data() || {} : {};
      const draft = userData?.school_profile_draft || {};

      if (institutionSnap.empty) {
        setHasClaimedProfile(false);
        setSaveMode("user_draft");
        setDraftDocId(uid);

        const loadedImageUrls = Array.isArray(draft.image_urls)
          ? draft.image_urls.filter(Boolean)
          : Array.isArray(draft.imageUrls)
          ? draft.imageUrls.filter(Boolean)
          : draft.image_url || draft.imageUrl
          ? [draft.image_url || draft.imageUrl].filter(Boolean)
          : [];

        setFormData({
          institution_id: "",

          name:
            draft.name ||
            draft.school_name ||
            userData?.school_name ||
            userData?.institution_name ||
            userData?.organization_name ||
            "",

          school_level:
            draft.school_level ||
            typeToSchoolLevel(draft.school_type || draft.type || "university"),

          school_type: draft.school_type || draft.type || "university",

          location: draft.location || draft.city || "",
          province: draft.province || "",
          country: draft.country || "",
          address: draft.address || "",

          founded_year:
            draft.founded_year ||
            draft.year_established ||
            new Date().getFullYear(),

          about: draft.about || draft.description || "",
          website: draft.website || "",

          email: draft.email || userData?.email || auth.currentUser?.email || "",
          phone: draft.phone || userData?.phone || "",

          image_url: draft.image_url || draft.imageUrl || loadedImageUrls[0] || "",
          image_urls: loadedImageUrls,
          logo_url: draft.logo_url || draft.logoUrl || "",
          banner_url: draft.banner_url || draft.bannerUrl || "",

          rating: draft.rating ?? 0,
          acceptance_rate: draft.acceptance_rate ?? 0,
          tuition_fees: draft.tuition_fees ?? draft.avgTuition ?? 0,
          application_fee: draft.application_fee ?? 0,
          cost_of_living: draft.cost_of_living ?? 0,

          is_public:
            draft.is_public ||
            draft.public_private ||
            (draft.isPublic === false ? "private" : "public"),

          pgwp_available: String(draft.pgwp_available ?? false),
          has_coop: String(draft.hasCoop ?? draft.has_coop ?? false),
          is_dli: String(draft.isDLI ?? draft.is_dli ?? false),
          dli_number: draft.dliNumber || draft.dli_number || "",
        });

        return;
      }

      const institutionDoc = institutionSnap.docs[0];
      const d = institutionDoc.data() || {};

      const loadedImageUrls = Array.isArray(d.imageUrls)
        ? d.imageUrls.filter(Boolean)
        : Array.isArray(d.image_urls)
        ? d.image_urls.filter(Boolean)
        : d.imageUrl || d.image_url
        ? [d.imageUrl || d.image_url].filter(Boolean)
        : [];

      const about = (d.about || d.description || "").toString();
      const schoolType = d.type || d.school_type || "university";
      const schoolLevel = d.school_level || typeToSchoolLevel(schoolType);

      setHasClaimedProfile(true);
      setSaveMode("institution");
      setDraftDocId(uid);

      setFormData({
        institution_id: institutionDoc.id,

        name: d.name || "",
        school_level: schoolLevel,
        school_type: schoolType,

        location: d.city || d.location || "",
        province: d.province || "",
        country: d.country || "",
        address: d.address || "",

        founded_year:
          d.year_established || d.founded_year || new Date().getFullYear(),

        about,
        website: d.website || "",

        email: d.email || "",
        phone: d.phone || "",

        image_url: d.imageUrl || d.image_url || loadedImageUrls[0] || "",
        image_urls: loadedImageUrls,

        logo_url: d.logoUrl || d.logo_url || "",
        banner_url: d.bannerUrl || d.banner_url || "",

        rating: d.rating ?? 0,
        acceptance_rate: d.acceptance_rate ?? 0,
        tuition_fees: d.avgTuition ?? d.tuition_fees ?? 0,
        application_fee: d.application_fee ?? 0,
        cost_of_living: d.cost_of_living ?? 0,

        is_public:
          d.public_private ||
          d.is_public ||
          (d.isPublic === false ? "private" : "public"),

        pgwp_available: String(d.pgwp_available ?? false),
        has_coop: String(d.hasCoop ?? d.has_coop ?? false),
        is_dli: String(d.isDLI ?? d.is_dli ?? false),
        dli_number: d.dliNumber || d.dli_number || "",
      });
    } catch (error) {
      console.error("Error loading school profile:", error);
      setHasClaimedProfile(false);
      setLatestClaimRequest(null);
      setSaveMode("user_draft");
      setDraftDocId("");
      setFormData(EMPTY_FORM);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSchoolData();
  }, [loadSchoolData]);

  const handleUploadSingle = async (e, field, setUploading) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { file_url } = await UploadFile({ file });
      setFormData((prev) => ({ ...prev, [field]: file_url }));
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload. Please try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleUploadMultipleImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingImages(true);
    try {
      const uploadedUrls = [];
      for (const file of files) {
        const { file_url } = await UploadFile({ file });
        if (file_url) uploadedUrls.push(file_url);
      }

      setFormData((prev) => {
        const merged = [...(prev.image_urls || []), ...uploadedUrls].filter(Boolean);
        const deduped = Array.from(new Set(merged));
        const primary = deduped[0] || "";

        return {
          ...prev,
          image_urls: deduped,
          image_url: primary,
        };
      });
    } catch (error) {
      console.error("Error uploading images:", error);
      alert("Failed to upload images. Please try again.");
    } finally {
      setUploadingImages(false);
      e.target.value = "";
    }
  };

  const removeAdditionalImage = (url) => {
    setFormData((prev) => {
      const next = (prev.image_urls || []).filter((u) => u !== url);
      return {
        ...prev,
        image_urls: next,
        image_url: next[0] || "",
      };
    });
  };

  const setPrimaryImage = (url) => {
    setFormData((prev) => {
      const arr = prev.image_urls || [];
      if (!arr.includes(url)) return prev;
      const reordered = [url, ...arr.filter((u) => u !== url)];
      return {
        ...prev,
        image_urls: reordered,
        image_url: url,
      };
    });
  };

  const inputClass = (_key) => "";

  const handleSave = async () => {
    setSaving(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Not signed in");

      const imageUrls = Array.isArray(formData.image_urls)
        ? formData.image_urls.filter(Boolean)
        : [];
      const primaryImage = (imageUrls[0] || formData.image_url || "").trim();

      if (saveMode === "institution") {
        const institutionId = formData.institution_id?.trim();
        if (!institutionId) {
          throw new Error("No approved school profile found for this account.");
        }

        const instRef = doc(db, "institutions", institutionId);
        const instSnap = await getDoc(instRef);

        if (!instSnap.exists()) {
          throw new Error("Approved institution record does not exist.");
        }

        const existingData = instSnap.data() || {};
        const existingOwner = existingData.user_id || "";

        if (!existingOwner) {
          throw new Error("This school profile is not yet approved and linked.");
        }

        if (existingOwner !== uid) {
          throw new Error("You do not have permission to edit this school profile.");
        }

        const institutionData = {
          user_id: uid,

          name: formData.name,
          short_name: formData.name || existingData.short_name || "",

          school_level: formData.school_level,
          type: formData.school_type,
          school_type: formData.school_type,

          public_private: formData.is_public,
          isPublic: formData.is_public === "public",
          is_public: formData.is_public,

          year_established: toNum(formData.founded_year),
          founded_year: toNum(formData.founded_year),

          country: formData.country,
          province: formData.province,
          city: formData.location,
          location: formData.location,
          address: formData.address,

          website: formData.website,
          email: formData.email,
          phone: formData.phone,

          logoUrl: formData.logo_url || primaryImage || "",
          logo_url: formData.logo_url || primaryImage || "",
          bannerUrl: formData.banner_url || "",
          banner_url: formData.banner_url || "",

          imageUrl: primaryImage,
          image_url: primaryImage,
          imageUrls: imageUrls,
          image_urls: imageUrls,

          about: formData.about,
          description: formData.about,

          pgwp_available: toBool(formData.pgwp_available),
          hasCoop: toBool(formData.has_coop),
          has_coop: toBool(formData.has_coop),
          isDLI: toBool(formData.is_dli),
          is_dli: toBool(formData.is_dli),
          dliNumber: formData.dli_number,
          dli_number: formData.dli_number,

          rating: toNum(formData.rating),
          acceptance_rate: toNum(formData.acceptance_rate),
          avgTuition: toNum(formData.tuition_fees),
          tuition_fees: toNum(formData.tuition_fees),
          application_fee: toNum(formData.application_fee),
          cost_of_living: toNum(formData.cost_of_living),

          status: existingData.status || "active",
          updated_at: serverTimestamp(),
        };

        await setDoc(instRef, institutionData, { merge: true });
        await loadSchoolData();
        alert("School profile saved successfully.");
        return;
      }

      const userRef = doc(db, "users", uid);
      const draftPayload = {
        school_profile_draft: {
          name: formData.name,
          school_name: formData.name,
          school_level: formData.school_level,
          school_type: formData.school_type,
          type: formData.school_type,

          location: formData.location,
          city: formData.location,
          province: formData.province,
          country: formData.country,
          address: formData.address,

          founded_year: toNum(formData.founded_year),
          year_established: toNum(formData.founded_year),

          about: formData.about,
          description: formData.about,
          website: formData.website,

          email: formData.email,
          phone: formData.phone,

          image_url: primaryImage,
          imageUrl: primaryImage,
          image_urls: imageUrls,
          imageUrls: imageUrls,
          logo_url: formData.logo_url || primaryImage || "",
          logoUrl: formData.logo_url || primaryImage || "",
          banner_url: formData.banner_url || "",
          bannerUrl: formData.banner_url || "",

          rating: toNum(formData.rating),
          acceptance_rate: toNum(formData.acceptance_rate),
          tuition_fees: toNum(formData.tuition_fees),
          avgTuition: toNum(formData.tuition_fees),
          application_fee: toNum(formData.application_fee),
          cost_of_living: toNum(formData.cost_of_living),

          is_public: formData.is_public,
          public_private: formData.is_public,
          isPublic: formData.is_public === "public",

          pgwp_available: toBool(formData.pgwp_available),
          has_coop: toBool(formData.has_coop),
          hasCoop: toBool(formData.has_coop),
          is_dli: toBool(formData.is_dli),
          isDLI: toBool(formData.is_dli),
          dli_number: formData.dli_number,
          dliNumber: formData.dli_number,

          updated_at: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      };

      await setDoc(userRef, draftPayload, { merge: true });
      await loadSchoolData();
      alert("School profile draft saved successfully.");
    } catch (error) {
      console.error("Error saving school profile:", error);
      alert(error?.message || "Failed to save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const latestRequestStatus = String(latestClaimRequest?.status || "").toLowerCase().trim();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-100 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-2">
          <Building className="w-8 h-8 text-blue-700" />
          <h1 className="text-4xl font-bold text-gray-800">School Profile</h1>
        </div>

        {!hasClaimedProfile ? (
          <Card className="mb-6 border-blue-200 bg-white">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Info className="w-8 h-8 text-blue-600" />
                <div>
                  <CardTitle>Claiming is Optional</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-gray-700">
              <div className="flex items-start gap-3">
                <School className="w-5 h-5 mt-0.5 text-blue-600" />
                <p>
                  You do not have a claimed institution linked to this account yet, but you can still save and manage your school profile information here.
                </p>
              </div>

              <p>
                This page will save your school profile as your account draft. If an existing institution is claimed and approved later, you can then manage the linked institution profile directly.
              </p>

              {latestClaimRequest ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-gray-900">
                    {latestRequestStatus === "pending" ? (
                      <Clock3 className="w-4 h-4 text-amber-600" />
                    ) : latestRequestStatus === "approved" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600" />
                    )}
                    Latest claim request
                  </div>

                  <div className="mt-3 space-y-1 text-gray-700">
                    <div>
                      <span className="font-medium">School:</span>{" "}
                      {latestClaimRequest?.institution_name || "—"}
                    </div>
                    <div>
                      <span className="font-medium">Status:</span>{" "}
                      {latestRequestStatus || "—"}
                    </div>
                    <div>
                      <span className="font-medium">Submitted:</span>{" "}
                      {formatDateTime(latestClaimRequest?.created_at)}
                    </div>
                    {latestRequestStatus === "rejected" &&
                    latestClaimRequest?.rejection_reason ? (
                      <div className="text-red-700">
                        <span className="font-medium">Reason:</span>{" "}
                        {latestClaimRequest.rejection_reason}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                  Claim an existing institution only if GreenPass already has your school profile. Otherwise, you can simply continue using this page normally.
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>
                  Save mode: <strong>School account draft</strong>
                </span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-6 border-green-200 bg-white">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-green-800">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Save mode: <strong>Linked institution profile</strong>
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">School Name</Label>
                  <Input
                    id="name"
                    className={inputClass("name")}
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="school_level">School Level</Label>
                  <Select
                    value={formData.school_level}
                    onValueChange={(value) => {
                      handleInputChange("school_level", value);
                      handleInputChange("school_type", schoolLevelToType(value));
                    }}
                  >
                    <SelectTrigger className={inputClass("school_level")}>
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="University">University</SelectItem>
                      <SelectItem value="College">College</SelectItem>
                      <SelectItem value="High School">High School</SelectItem>
                      <SelectItem value="Language School">Language School</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="location">City</Label>
                  <Input
                    id="location"
                    className={inputClass("location")}
                    value={formData.location}
                    onChange={(e) => handleInputChange("location", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="province">Province/State</Label>
                  <Input
                    id="province"
                    className={inputClass("province")}
                    value={formData.province}
                    onChange={(e) => handleInputChange("province", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    className={inputClass("country")}
                    value={formData.country}
                    onChange={(e) => handleInputChange("country", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="address">Full Address</Label>
                <Textarea
                  id="address"
                  className={inputClass("address")}
                  value={formData.address}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="founded_year">Founded Year</Label>
                  <Input
                    id="founded_year"
                    type="number"
                    className={inputClass("founded_year")}
                    value={formData.founded_year}
                    onChange={(e) => handleInputChange("founded_year", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    className={inputClass("website")}
                    value={formData.website}
                    onChange={(e) => handleInputChange("website", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <Label htmlFor="is_public">Public / Private</Label>
                  <Select
                    value={formData.is_public}
                    onValueChange={(v) => handleInputChange("is_public", v)}
                  >
                    <SelectTrigger className={inputClass("is_public")}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    className={inputClass("email")}
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    placeholder="admissions@school.edu"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    className={inputClass("phone")}
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                    placeholder="+1 ..."
                  />
                </div>
                <div>
                  <Label htmlFor="school_type">Institution Type</Label>
                  <Select
                    value={formData.school_type}
                    onValueChange={(v) => handleInputChange("school_type", v)}
                  >
                    <SelectTrigger className={inputClass("school_type")}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="university">University</SelectItem>
                      <SelectItem value="college">College</SelectItem>
                      <SelectItem value="high_school">High School</SelectItem>
                      <SelectItem value="language_school">Language School</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="pgwp_available">PGWP Available</Label>
                  <Select
                    value={String(formData.pgwp_available)}
                    onValueChange={(v) => handleInputChange("pgwp_available", v)}
                  >
                    <SelectTrigger className={inputClass("pgwp_available")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="has_coop">Co-op Offered</Label>
                  <Select
                    value={String(formData.has_coop)}
                    onValueChange={(v) => handleInputChange("has_coop", v)}
                  >
                    <SelectTrigger className={inputClass("has_coop")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="is_dli">DLI</Label>
                  <Select
                    value={String(formData.is_dli)}
                    onValueChange={(v) => handleInputChange("is_dli", v)}
                  >
                    <SelectTrigger className={inputClass("is_dli")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="dli_number">DLI Number</Label>
                  <Input
                    id="dli_number"
                    className={inputClass("dli_number")}
                    value={formData.dli_number}
                    onChange={(e) => handleInputChange("dli_number", e.target.value)}
                    placeholder="O123456789012"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Media</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="logo">Logo</Label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-2">
                  <input
                    type="file"
                    id="logo"
                    accept="image/*"
                    onChange={(e) => handleUploadSingle(e, "logo_url", setUploadingLogo)}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("logo")?.click()}
                    disabled={uploadingLogo}
                    className="w-full sm:w-auto"
                  >
                    {uploadingLogo ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Upload Logo
                  </Button>
                  {formData.logo_url && (
                    <img
                      src={formData.logo_url}
                      alt="Logo"
                      className="w-16 h-16 object-cover rounded"
                    />
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="banner">Banner / Hero</Label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-2">
                  <input
                    type="file"
                    id="banner"
                    accept="image/*"
                    onChange={(e) => handleUploadSingle(e, "banner_url", setUploadingBanner)}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("banner")?.click()}
                    disabled={uploadingBanner}
                    className="w-full sm:w-auto"
                  >
                    {uploadingBanner ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Upload Banner
                  </Button>
                  {formData.banner_url && (
                    <img
                      src={formData.banner_url}
                      alt="Banner"
                      className="w-28 h-16 object-cover rounded"
                    />
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="additional_images">Additional Images</Label>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-2">
                  <input
                    type="file"
                    id="additional_images"
                    accept="image/*"
                    multiple
                    onChange={handleUploadMultipleImages}
                    className="hidden"
                  />

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById("additional_images")?.click()}
                    disabled={uploadingImages}
                    className="w-full sm:w-auto"
                  >
                    {uploadingImages ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Upload Images
                  </Button>

                  {Array.isArray(formData.image_urls) && formData.image_urls.length > 0 && (
                    <span className="text-sm text-gray-600">
                      {formData.image_urls.length} image
                      {formData.image_urls.length === 1 ? "" : "s"} uploaded
                    </span>
                  )}
                </div>

                {Array.isArray(formData.image_urls) && formData.image_urls.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {formData.image_urls.map((url, idx) => (
                      <div
                        key={`${url}-${idx}`}
                        className={`relative rounded-lg overflow-hidden border ${
                          idx === 0 ? "border-blue-500" : "border-gray-200"
                        }`}
                      >
                        <img
                          src={url}
                          alt={`Additional ${idx + 1}`}
                          className="w-full h-28 object-cover"
                        />

                        {idx === 0 && (
                          <div className="absolute top-2 left-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                            Primary
                          </div>
                        )}

                        <div className="absolute bottom-2 left-2 right-2 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="w-full"
                            onClick={() => setPrimaryImage(url)}
                            disabled={idx === 0}
                          >
                            Set Primary
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            className="w-full"
                            onClick={() => removeAdditionalImage(url)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About the School</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="about">Description</Label>
              <Textarea
                id="about"
                className={inputClass("about")}
                value={formData.about}
                onChange={(e) => handleInputChange("about", e.target.value)}
                rows={6}
                placeholder="Tell prospective students about your institution..."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Financial Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="tuition_fees">Tuition Fees (per year)</Label>
                  <Input
                    id="tuition_fees"
                    type="number"
                    className={inputClass("tuition_fees")}
                    value={formData.tuition_fees}
                    onChange={(e) => handleInputChange("tuition_fees", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="application_fee">Application Fee</Label>
                  <Input
                    id="application_fee"
                    type="number"
                    className={inputClass("application_fee")}
                    value={formData.application_fee}
                    onChange={(e) =>
                      handleInputChange("application_fee", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="cost_of_living">Cost of Living (per year)</Label>
                  <Input
                    id="cost_of_living"
                    type="number"
                    className={inputClass("cost_of_living")}
                    value={formData.cost_of_living}
                    onChange={(e) =>
                      handleInputChange("cost_of_living", e.target.value)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>School Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rating">Overall Rating (out of 5)</Label>
                  <Input
                    id="rating"
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    className={inputClass("rating")}
                    value={formData.rating}
                    onChange={(e) => handleInputChange("rating", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="acceptance_rate">Acceptance Rate (%)</Label>
                  <Input
                    id="acceptance_rate"
                    type="number"
                    min="0"
                    max="100"
                    className={inputClass("acceptance_rate")}
                    value={formData.acceptance_rate}
                    onChange={(e) =>
                      handleInputChange("acceptance_rate", e.target.value)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {saveMode === "institution" ? "Save Profile" : "Save Draft"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}