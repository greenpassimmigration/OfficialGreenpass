// src/pages/AdminInstitutions.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { db } from "@/firebase";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
  limit,
  startAfter,
  getCountFromServer,
} from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusCircle,
  Edit,
  Trash2,
  Building,
  CheckCircle,
  XCircle,
  Search,
  Loader2,
  ShieldCheck,
  UserCheck,
  Landmark,
  BadgeDollarSign,
} from "lucide-react";
import InstitutionForm from "../components/institutions/InstitutionForm";

const COLL = "institutions";

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const formatMoney = (value) => {
  if (value === undefined || value === null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `$${num.toLocaleString()}`;
};

const normalizeVerificationStatus = (institution) => {
  const raw = firstDefined(
    institution?.verification_status,
    institution?.status,
    institution?.verificationStatus,
    ""
  );

  return String(raw || "").trim().toLowerCase();
};

const normalizeInstitutionType = (institution) => {
  return firstDefined(institution?.type, institution?.school_type, "—");
};

const normalizeUserId = (institution) => {
  return firstDefined(
    institution?.user_id,
    institution?.owner_user_id,
    institution?.uid,
    ""
  );
};

const normalizeLogo = (institution) => {
  return firstDefined(institution?.logoUrl, institution?.logo, "");
};

const normalizeDliNumber = (institution) => {
  return firstDefined(institution?.dliNumber, institution?.dli_number, "");
};

const normalizeYearEstablished = (institution) => {
  return firstDefined(institution?.year_established, institution?.founded_year, "");
};

export default function AdminInstitutions() {
  const [institutions, setInstitutions] = useState([]);
  const [filteredInstitutions, setFilteredInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedInstitution, setSelectedInstitution] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [dliFilter, setDliFilter] = useState("all");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageSize, setPageSize] = useState(25);

  const [totalCount, setTotalCount] = useState(null);

  const pageCursorsRef = useRef([]);

  const totalPages =
    totalCount != null ? Math.ceil(totalCount / pageSize) : null;

  const loadPage = useCallback(
    async (pageNumber = 1) => {
      setLoading(true);
      try {
        let q = query(
          collection(db, COLL),
          orderBy("name", "asc"),
          limit(pageSize)
        );

        if (pageNumber > 1) {
          const pageCursors = pageCursorsRef.current;
          const prevCursor = pageCursors[pageNumber - 2];
          if (!prevCursor) {
            setLoading(false);
            return;
          }

          q = query(
            collection(db, COLL),
            orderBy("name", "asc"),
            startAfter(prevCursor),
            limit(pageSize)
          );
        }

        const snap = await getDocs(q);

        const data = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const safeData = Array.isArray(data)
          ? data.filter((item) => item && typeof item === "object")
          : [];

        setInstitutions(safeData);

        if (snap.docs.length > 0) {
          const lastDoc = snap.docs[snap.docs.length - 1];
          const pageCursors = pageCursorsRef.current.slice();
          pageCursors[pageNumber - 1] = lastDoc;
          pageCursorsRef.current = pageCursors;
        }

        setHasMore(snap.docs.length === pageSize);
        setCurrentPage(pageNumber);
      } catch (error) {
        console.error("Error loading institutions:", error);
        setInstitutions([]);
        alert("Failed to load institutions.");
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  useEffect(() => {
    pageCursorsRef.current = [];
    setCurrentPage(1);
    loadPage(1);
  }, [loadPage]);

  useEffect(() => {
    let cancelled = false;

    const loadCount = async () => {
      try {
        const collRef = collection(db, COLL);
        const snapshot = await getCountFromServer(collRef);
        if (!cancelled) {
          setTotalCount(snapshot.data().count || 0);
        }
      } catch (err) {
        console.error("Error getting institutions count:", err);
      }
    };

    loadCount();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!Array.isArray(institutions)) {
      setFilteredInstitutions([]);
      return;
    }

    let list = [...institutions];

    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();

      list = list.filter((institution) => {
        if (!institution) return false;

        const name = (institution.name || "").toLowerCase();
        const city = (institution.city || "").toLowerCase();
        const province = (institution.province || "").toLowerCase();
        const country = (institution.country || "").toLowerCase();
        const type = String(normalizeInstitutionType(institution) || "").toLowerCase();
        const userId = String(normalizeUserId(institution) || "").toLowerCase();
        const verificationStatus = normalizeVerificationStatus(institution);
        const dliNumber = String(normalizeDliNumber(institution) || "").toLowerCase();
        const website = String(institution.website || "").toLowerCase();

        return (
          name.includes(term) ||
          city.includes(term) ||
          province.includes(term) ||
          country.includes(term) ||
          type.includes(term) ||
          userId.includes(term) ||
          verificationStatus.includes(term) ||
          dliNumber.includes(term) ||
          website.includes(term)
        );
      });
    }

    if (countryFilter !== "all") {
      const cf = countryFilter.trim().toLowerCase();
      list = list.filter((institution) => {
        const value = String(institution.country || "").trim().toLowerCase();
        return value === cf;
      });
    }

    if (dliFilter === "dli") {
      list = list.filter((institution) => institution.isDLI === true);
    } else if (dliFilter === "non_dli") {
      list = list.filter((institution) => institution.isDLI !== true);
    }

    if (ownershipFilter === "claimed") {
      list = list.filter((institution) => !!normalizeUserId(institution));
    } else if (ownershipFilter === "unclaimed") {
      list = list.filter((institution) => !normalizeUserId(institution));
    }

    if (verificationFilter !== "all") {
      list = list.filter(
        (institution) =>
          normalizeVerificationStatus(institution) === verificationFilter
      );
    }

    setFilteredInstitutions(list);
  }, [
    institutions,
    searchTerm,
    countryFilter,
    dliFilter,
    ownershipFilter,
    verificationFilter,
  ]);

  const uniqueCountries = useMemo(() => {
    const uniqueCountriesFromData = Array.from(
      new Set(
        institutions
          .map((i) => (i.country || "").toString().trim())
          .filter((v) => v.length > 0)
      )
    );

    const extraCountries = ["Germany", "Ireland", "New Zealand"];

    return Array.from(
      new Set([...uniqueCountriesFromData, ...extraCountries])
    ).sort((a, b) => a.localeCompare(b));
  }, [institutions]);

  const handleSave = async (institutionData) => {
    try {
      if (selectedInstitution?.id) {
        const ref = doc(db, COLL, selectedInstitution.id);
        await updateDoc(ref, {
          ...institutionData,
          updated_at: serverTimestamp(),
        });
      } else {
        const ref = collection(db, COLL);
        await addDoc(ref, {
          ...institutionData,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      }

      setIsFormOpen(false);
      setSelectedInstitution(null);
      await loadPage(currentPage);
    } catch (error) {
      console.error("Error saving institution:", error);
      alert("Failed to save institution. Please try again.");
    }
  };

  const handleDelete = async (institutionId) => {
    if (!institutionId) return;

    if (window.confirm("Are you sure you want to delete this institution?")) {
      try {
        const ref = doc(db, COLL, institutionId);
        await deleteDoc(ref);
        await loadPage(currentPage);
      } catch (error) {
        console.error("Error deleting institution:", error);
        alert("Failed to delete institution. Please try again.");
      }
    }
  };

  const openForm = (institution = null) => {
    setSelectedInstitution(institution);
    setIsFormOpen(true);
  };

  const handleNext = () => {
    if (!hasMore || loading) return;
    loadPage(currentPage + 1);
  };

  const handlePrev = () => {
    if (currentPage === 1 || loading) return;
    loadPage(currentPage - 1);
  };

  const startIndex =
    filteredInstitutions.length > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const endIndex =
    filteredInstitutions.length > 0
      ? startIndex + filteredInstitutions.length - 1
      : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <Building className="w-8 h-8 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-800">
              Institution Management
            </h1>
          </div>

          <Dialog
            open={isFormOpen}
            onOpenChange={(open) => {
              setIsFormOpen(open);
              if (!open) {
                setSelectedInstitution(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => openForm()}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Add Institution
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedInstitution ? "Edit Institution" : "Add New Institution"}
                </DialogTitle>
              </DialogHeader>

              <InstitutionForm
                institution={selectedInstitution}
                onSave={handleSave}
                onCancel={() => {
                  setIsFormOpen(false);
                  setSelectedInstitution(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="relative w-full md:max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search by name, location, type, owner, verification, DLI number, website..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <div className="flex flex-wrap gap-3 items-center justify-start md:justify-end">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Country</span>
                    <Select value={countryFilter} onValueChange={setCountryFilter}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="All countries" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All countries</SelectItem>
                        {uniqueCountries.map((country) => (
                          <SelectItem key={country} value={country}>
                            {country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">DLI Status</span>
                    <Select value={dliFilter} onValueChange={setDliFilter}>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="dli">DLI only</SelectItem>
                        <SelectItem value="non_dli">Non-DLI only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Ownership</span>
                    <Select
                      value={ownershipFilter}
                      onValueChange={setOwnershipFilter}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="claimed">Claimed / Owned</SelectItem>
                        <SelectItem value="unclaimed">Unclaimed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Verification</span>
                    <Select
                      value={verificationFilter}
                      onValueChange={setVerificationFilter}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="verified">Verified</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="unclaimed">Unclaimed</SelectItem>
                        <SelectItem value="claimed">Claimed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      Rows per page
                    </span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => setPageSize(Number(v))}
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  Current page records: {institutions.length}
                </Badge>
                <Badge variant="outline">
                  Filtered on page: {filteredInstitutions.length}
                </Badge>
                {totalCount != null && (
                  <Badge variant="outline">Total records: {totalCount}</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building className="w-5 h-5" />
              Institutions (Page {currentPage}
              {totalPages != null ? ` of ${totalPages}` : ""}, {filteredInstitutions.length} shown)
            </CardTitle>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="flex justify-center items-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : !filteredInstitutions || filteredInstitutions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No institutions found.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Institution</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Ownership / Verification</TableHead>
                        <TableHead>Type / DLI</TableHead>
                        <TableHead>Fees / Programs</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>

                    <TableBody>
                      {filteredInstitutions.map((institution) => {
                        const logoUrl = normalizeLogo(institution);
                        const userId = normalizeUserId(institution);
                        const verificationStatus = normalizeVerificationStatus(institution);
                        const type = normalizeInstitutionType(institution);
                        const dliNumber = normalizeDliNumber(institution);
                        const yearEstablished = normalizeYearEstablished(institution);

                        return (
                          <TableRow key={institution.id}>
                            <TableCell className="align-top">
                              <div className="flex items-start gap-3 min-w-[240px]">
                                {logoUrl ? (
                                  <img
                                    src={logoUrl}
                                    alt={institution.name || "Institution logo"}
                                    className="w-10 h-10 rounded-full object-cover border"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-full border flex items-center justify-center bg-gray-50">
                                    <Building className="w-4 h-4 text-gray-400" />
                                  </div>
                                )}

                                <div className="space-y-1">
                                  <div className="font-medium text-gray-900">
                                    {institution.name || "Unnamed institution"}
                                  </div>

                                  {institution.website && (
                                    <div className="text-sm text-gray-500 break-all">
                                      {institution.website}
                                    </div>
                                  )}

                                  {yearEstablished && (
                                    <div className="text-xs text-gray-500">
                                      Established: {yearEstablished}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="align-top">
                              <div className="text-sm min-w-[180px] space-y-1">
                                <div>
                                  {[institution.city, institution.province]
                                    .filter(Boolean)
                                    .join(", ") || "—"}
                                </div>
                                <div className="text-gray-500">
                                  {institution.country || "—"}
                                </div>
                                {institution.address && (
                                  <div className="text-xs text-gray-500 break-words">
                                    {institution.address}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="align-top">
                              <div className="flex flex-col gap-2 min-w-[220px]">
                                <div className="flex flex-wrap gap-1">
                                  {userId ? (
                                    <Badge className="bg-blue-100 text-blue-800">
                                      <UserCheck className="w-3 h-3 mr-1" />
                                      Claimed / Owned
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">Unclaimed</Badge>
                                  )}

                                  {verificationStatus === "verified" && (
                                    <Badge className="bg-green-100 text-green-800">
                                      <ShieldCheck className="w-3 h-3 mr-1" />
                                      Verified
                                    </Badge>
                                  )}

                                  {verificationStatus === "pending" && (
                                    <Badge className="bg-amber-100 text-amber-800">
                                      Pending
                                    </Badge>
                                  )}

                                  {verificationStatus === "rejected" && (
                                    <Badge className="bg-red-100 text-red-800">
                                      Rejected
                                    </Badge>
                                  )}

                                  {verificationStatus &&
                                    !["verified", "pending", "rejected"].includes(
                                      verificationStatus
                                    ) && (
                                      <Badge variant="outline">
                                        {verificationStatus}
                                      </Badge>
                                    )}
                                </div>

                                <div className="text-xs text-gray-600 break-all">
                                  <span className="font-medium text-gray-700">user_id:</span>{" "}
                                  {userId || "—"}
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="align-top">
                              <div className="flex flex-col gap-2 min-w-[180px]">
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline">
                                    {type || "—"}
                                  </Badge>

                                  {institution.isFeatured && (
                                    <Badge className="bg-yellow-100 text-yellow-800">
                                      Featured
                                    </Badge>
                                  )}

                                  {institution.isDLI ? (
                                    <Badge className="bg-green-100 text-green-800">
                                      <CheckCircle className="w-3 h-3 mr-1" />
                                      DLI
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">
                                      <XCircle className="w-3 h-3 mr-1" />
                                      Non-DLI
                                    </Badge>
                                  )}

                                  {institution.isPublic && (
                                    <Badge variant="outline">
                                      <Landmark className="w-3 h-3 mr-1" />
                                      Public
                                    </Badge>
                                  )}
                                </div>

                                {dliNumber && (
                                  <div className="text-xs text-gray-600 break-all">
                                    <span className="font-medium text-gray-700">DLI:</span>{" "}
                                    {dliNumber}
                                  </div>
                                )}

                                {institution.school_level && (
                                  <div className="text-xs text-gray-600">
                                    <span className="font-medium text-gray-700">
                                      Level:
                                    </span>{" "}
                                    {institution.school_level}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="align-top">
                              <div className="flex flex-col gap-2 min-w-[180px]">
                                <div className="text-sm text-gray-700">
                                  <div className="flex items-center gap-1">
                                    <BadgeDollarSign className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium">Application Fee:</span>{" "}
                                    {formatMoney(institution.application_fee)}
                                  </div>
                                  <div className="mt-1">
                                    <span className="font-medium">Cost of Living:</span>{" "}
                                    {formatMoney(institution.cost_of_living)}
                                  </div>
                                  <div className="mt-1">
                                    <span className="font-medium">Avg Tuition:</span>{" "}
                                    {formatMoney(institution.avgTuition)}
                                  </div>
                                </div>

                                <div className="flex flex-wrap gap-1">
                                  <Badge variant="outline">
                                    {institution.programCount || 0} programs
                                  </Badge>

                                  {institution.hasCoop && (
                                    <Badge variant="outline">Co-op</Badge>
                                  )}
                                </div>
                              </div>
                            </TableCell>

                            <TableCell className="align-top">
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openForm(institution)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>

                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDelete(institution.id)}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={handlePrev}
                      disabled={currentPage === 1 || loading}
                    >
                      Previous
                    </Button>

                    <Button
                      variant="outline"
                      onClick={handleNext}
                      disabled={!hasMore || loading}
                    >
                      Next
                    </Button>

                    <span className="text-sm text-gray-600 ml-2">
                      Page {currentPage}
                      {totalPages != null ? ` of ${totalPages}` : ""}
                    </span>
                  </div>

                  <span className="text-xs text-gray-500">
                    {totalCount != null
                      ? `Showing ${startIndex}–${endIndex} of ${totalCount}`
                      : `Showing ${startIndex}–${endIndex}`}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}