// src/pages/TutorStudents.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Search,
  FileCheck,
  X,
  Plus,
  ClipboardList,
  MessageSquare,
  Trash2,
  ScanLine,
  Camera,
} from "lucide-react";
import { createPageUrl } from "@/utils";

// Firebase
import { getAuth } from "firebase/auth";
import { db } from "@/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  documentId,
  deleteDoc,
} from "firebase/firestore";

// QR
import { Html5Qrcode } from "html5-qrcode";

/**
 * TUTOR PAGE (Tutor Students)
 * SOURCE OF TRUTH:
 * - Student list = tutor_students only
 * - User profile details are loaded from users collection using IDs from tutor_students
 * - Document checklist per student stored in: tutor_student_checklists/{tutorId}_{studentId}
 * - QR scanner for tutor:
 *    scan student QR -> calls backend acceptStudentReferralToTutor -> student added to tutor_students
 */

const RELATION_COLLECTION = "tutor_students";
const CHECKLIST_COLLECTION = "tutor_student_checklists";
const ACCEPT_STUDENT_ENDPOINT = "acceptStudentReferralToTutor";

const chunk = (arr, size = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const makeRelId = (tutorId, studentId) => `${tutorId}_${studentId}`;

const defaultDocTemplate = () => [
  { name: "Passport bio page" },
  { name: "School records / transcript" },
  { name: "English test result (if available)" },
  { name: "Current study plan / goals" },
  { name: "Assignment or practice materials" },
  { name: "Class schedule / availability" },
  { name: "Parent consent (if applicable)" },
  { name: "Notes / learning assessment" },
];

const cryptoRandomId = () => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `doc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const normalizeDocs = (docs) => {
  if (!Array.isArray(docs)) return [];
  return docs
    .filter(Boolean)
    .map((d) => ({
      id: String(d.id || cryptoRandomId()),
      name: String(d.name || "").trim(),
      submitted: Boolean(d.submitted),
      created_at: d.created_at || null,
      updated_at: d.updated_at || null,
    }))
    .filter((d) => d.name.length > 0);
};

function ProgressBadge({ docs }) {
  const total = Array.isArray(docs) ? docs.length : 0;
  const done = Array.isArray(docs) ? docs.filter((d) => d.submitted).length : 0;

  if (!total) {
    return (
      <Badge variant="secondary" className="rounded-full">
        0
      </Badge>
    );
  }

  return (
    <Badge variant={done === total ? "default" : "secondary"} className="rounded-full">
      {done}/{total}
    </Badge>
  );
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl border">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full hover:bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function getFunctionsBase() {
  const fromEnv =
    import.meta.env.VITE_FUNCTIONS_BASE ||
    import.meta.env.VITE_FUNCTIONS_HTTP_BASE ||
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CLOUD_FUNCTIONS_BASE_URL ||
    "";

  if (fromEnv) return String(fromEnv).replace(/\/+$/, "");

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) {
    return `https://us-central1-${projectId}.cloudfunctions.net`;
  }

  return "https://us-central1-greenpass-dc92d.cloudfunctions.net";
}

function extractStudentRefFromScannedText(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    return (url.searchParams.get("student_ref") || url.searchParams.get("ref") || "").trim();
  } catch {
    return text;
  }
}

function getStudentIdFromRelation(data = {}) {
  return (
    data.studentId ||
    data.student_id ||
    data.userId ||
    data.user_id ||
    data.clientId ||
    data.client_id ||
    null
  );
}

function buildSuccessText(data) {
  let successText = "Student added successfully.";

  if (data?.alreadyExists) {
    successText = "Student is already in your student list.";
  } else if (data?.student?.full_name) {
    successText = `${data.student.full_name} added to your student list.`;
  }

  return successText;
}

export default function TutorStudents() {
  const [students, setStudents] = useState([]);
  const [removableStudentIds, setRemovableStudentIds] = useState(new Set());
  const [checklistsByStudent, setChecklistsByStudent] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [errorText, setErrorText] = useState("");
  const [searchParams] = useSearchParams();

  const [docsOpen, setDocsOpen] = useState(false);
  const [activeStudent, setActiveStudent] = useState(null);
  const [docsSaving, setDocsSaving] = useState(false);
  const [docName, setDocName] = useState("");

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStarting, setScannerStarting] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerSuccess, setScannerSuccess] = useState("");
  const [manualQrValue, setManualQrValue] = useState("");
  const [cameraSupported, setCameraSupported] = useState(true);

  const qrRegionIdRef = useRef(`tutor-student-qr-reader-${Math.random().toString(36).slice(2)}`);
  const qrScannerRef = useRef(null);
  const handledTokenRef = useRef("");
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const openDocs = (student) => {
    setActiveStudent(student);
    setDocName("");
    setDocsOpen(true);
  };

  const closeDocs = () => {
    setDocsOpen(false);
    setActiveStudent(null);
    setDocName("");
    setDocsSaving(false);
  };

  const activeDocs = useMemo(() => {
    if (!activeStudent?.id) return [];
    return normalizeDocs(checklistsByStudent[activeStudent.id] || []);
  }, [activeStudent?.id, checklistsByStudent]);

  const saveChecklist = async (tutorId, studentId, nextDocs) => {
    const relId = makeRelId(tutorId, studentId);
    const ref = doc(db, CHECKLIST_COLLECTION, relId);

    const payload = {
      tutor_id: tutorId,
      student_id: studentId,
      documents: nextDocs.map((d) => ({
        id: d.id,
        name: d.name,
        submitted: !!d.submitted,
        updated_at: new Date().toISOString(),
        created_at: d.created_at || new Date().toISOString(),
      })),
      updated_at: serverTimestamp(),
      created_at: serverTimestamp(),
    };

    await setDoc(ref, payload, { merge: true });

    if (!isMountedRef.current) return;

    setChecklistsByStudent((prev) => ({
      ...prev,
      [studentId]: payload.documents,
    }));
  };

  const handleToggleDoc = async (docId) => {
    const auth = getAuth();
    const me = auth.currentUser;
    if (!me || !activeStudent?.id) return;

    const next = activeDocs.map((d) =>
      d.id === docId ? { ...d, submitted: !d.submitted, updated_at: new Date().toISOString() } : d
    );

    setDocsSaving(true);
    try {
      await saveChecklist(me.uid, activeStudent.id, next);
    } catch (e) {
      console.error("Checklist toggle failed:", e);
      setErrorText(e?.message || "Failed to update document checklist.");
    } finally {
      if (isMountedRef.current) setDocsSaving(false);
    }
  };

  const handleAddDoc = async () => {
    const name = String(docName || "").trim();
    if (!name) return;

    const auth = getAuth();
    const me = auth.currentUser;
    if (!me || !activeStudent?.id) return;

    const next = [
      ...activeDocs,
      {
        id: cryptoRandomId(),
        name,
        submitted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    setDocsSaving(true);
    try {
      await saveChecklist(me.uid, activeStudent.id, next);
      if (isMountedRef.current) setDocName("");
    } catch (e) {
      console.error("Checklist add failed:", e);
      setErrorText(e?.message || "Failed to add document.");
    } finally {
      if (isMountedRef.current) setDocsSaving(false);
    }
  };

  const handleRemoveDoc = async (docId) => {
    const auth = getAuth();
    const me = auth.currentUser;
    if (!me || !activeStudent?.id) return;

    const next = activeDocs.filter((d) => d.id !== docId);

    setDocsSaving(true);
    try {
      await saveChecklist(me.uid, activeStudent.id, next);
    } catch (e) {
      console.error("Checklist remove failed:", e);
      setErrorText(e?.message || "Failed to remove document.");
    } finally {
      if (isMountedRef.current) setDocsSaving(false);
    }
  };

  const handleApplyTemplate = async () => {
    const auth = getAuth();
    const me = auth.currentUser;
    if (!me || !activeStudent?.id) return;

    const base = defaultDocTemplate().map((d) => ({
      id: cryptoRandomId(),
      name: d.name,
      submitted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    setDocsSaving(true);
    try {
      await saveChecklist(me.uid, activeStudent.id, base);
    } catch (e) {
      console.error("Checklist template failed:", e);
      setErrorText(e?.message || "Failed to apply template.");
    } finally {
      if (isMountedRef.current) setDocsSaving(false);
    }
  };

  const handleMessage = (studentId) => {
    window.location.href = createPageUrl(`Messages?to=${studentId}`);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorText("");

    try {
      const auth = getAuth();
      const me = auth.currentUser;

      if (!me) {
        setStudents([]);
        setRemovableStudentIds(new Set());
        setChecklistsByStudent({});
        setLoading(false);
        return;
      }

      const relationQueries = [
        query(collection(db, RELATION_COLLECTION), where("tutorId", "==", me.uid)),
        query(collection(db, RELATION_COLLECTION), where("tutor_id", "==", me.uid)),
      ];

      const relationSnapshots = await Promise.all(
        relationQueries.map((qRef) =>
          getDocs(qRef).catch((err) => {
            console.error(`${RELATION_COLLECTION} query failed:`, err);
            return { docs: [] };
          })
        )
      );

      const relationDocs = relationSnapshots.flatMap((snap) => snap.docs || []);

      const seenRelationDocIds = new Set();
      const uniqueRelationDocs = relationDocs.filter((d) => {
        if (!d?.id) return false;
        if (seenRelationDocIds.has(d.id)) return false;
        seenRelationDocIds.add(d.id);
        return true;
      });

      const relationUserIds = [];
      const removableIds = new Set();

      uniqueRelationDocs.forEach((d) => {
        const studentId = getStudentIdFromRelation(d.data() || {});
        if (!studentId) return;
        relationUserIds.push(studentId);
        removableIds.add(studentId);
      });

      const uniqueUserIds = Array.from(new Set(relationUserIds));
      const relationUsers = [];

      if (uniqueUserIds.length) {
        for (const batch of chunk(uniqueUserIds, 10)) {
          const usersQ = query(collection(db, "users"), where(documentId(), "in", batch));
          const usersSnap = await getDocs(usersQ);
          usersSnap.docs.forEach((u) => {
            relationUsers.push({ id: u.id, ...u.data() });
          });
        }
      }

      const seenUserIds = new Set();
      const studentDocs = relationUsers.filter((u) => {
        if (!u?.id) return false;
        if (seenUserIds.has(u.id)) return false;
        seenUserIds.add(u.id);
        return true;
      });

      const map = {};
      const checklistQueries = [
        query(collection(db, CHECKLIST_COLLECTION), where("tutor_id", "==", me.uid)),
        query(collection(db, CHECKLIST_COLLECTION), where("tutorId", "==", me.uid)),
      ];

      const checklistSnapshots = await Promise.all(
        checklistQueries.map((qRef) =>
          getDocs(qRef).catch((err) => {
            console.error("Checklist query failed:", err);
            return { docs: [] };
          })
        )
      );

      checklistSnapshots.forEach((snap) => {
        (snap.docs || []).forEach((d) => {
          const data = d.data() || {};
          const sid = data.student_id || data.studentId;
          if (!sid) return;
          map[sid] = Array.isArray(data.documents) ? data.documents : [];
        });
      });

      if (!isMountedRef.current) return;

      setStudents(studentDocs);
      setRemovableStudentIds(removableIds);
      setChecklistsByStudent(map);
    } catch (err) {
      console.error("Error fetching students/checklists:", err);
      if (isMountedRef.current) {
        setErrorText(err?.message || "Failed to load students.");
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const stopScanner = useCallback(async () => {
    try {
      const scanner = qrScannerRef.current;
      if (scanner) {
        const state = scanner.getState?.();
        if (state === 2 || state === 3) {
          await scanner.stop().catch(() => {});
        }
        await scanner.clear().catch(() => {});
      }
    } catch {}
    qrScannerRef.current = null;
  }, []);

  const closeScanner = useCallback(async () => {
    await stopScanner();
    if (!isMountedRef.current) return;

    setScannerOpen(false);
    setScannerStarting(false);
    setScannerBusy(false);
    setScannerError("");
    setScannerSuccess("");
    setManualQrValue("");
    handledTokenRef.current = "";
  }, [stopScanner]);

  const handleAcceptStudentQr = useCallback(
    async (rawValue) => {
      const token = extractStudentRefFromScannedText(rawValue);
      if (!token) {
        setScannerError("Could not read a valid student QR token.");
        return;
      }

      if (scannerBusy) return;
      if (handledTokenRef.current === token) return;

      handledTokenRef.current = token;
      setScannerBusy(true);
      setScannerError("");
      setScannerSuccess("");

      try {
        const auth = getAuth();
        const me = auth.currentUser;
        if (!me) throw new Error("You must be signed in.");

        const idToken = await me.getIdToken();
        const base = getFunctionsBase();

        const res = await fetch(`${base}/${ACCEPT_STUDENT_ENDPOINT}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            student_ref: token,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Failed to add student.");
        }

        if (!isMountedRef.current) return;

        setScannerSuccess(buildSuccessText(data));
        await fetchData();

        setTimeout(() => {
          closeScanner();
        }, 900);
      } catch (e) {
        console.error(`${ACCEPT_STUDENT_ENDPOINT} failed:`, e);
        handledTokenRef.current = "";
        if (isMountedRef.current) {
          setScannerError(e?.message || "Failed to add student.");
        }
      } finally {
        if (isMountedRef.current) {
          setScannerBusy(false);
        }
      }
    },
    [scannerBusy, fetchData, closeScanner]
  );

  const startScanner = async () => {
    setScannerOpen(true);
    setScannerStarting(true);
    setScannerError("");
    setScannerSuccess("");
    handledTokenRef.current = "";

    setTimeout(async () => {
      try {
        const hasCamera =
          typeof navigator !== "undefined" &&
          !!navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === "function";

        if (!hasCamera) {
          setCameraSupported(false);
          setScannerError("Camera is not supported on this browser/device. Paste the QR token or link below.");
          return;
        }

        setCameraSupported(true);

        await stopScanner();

        const scanner = new Html5Qrcode(qrRegionIdRef.current);
        qrScannerRef.current = scanner;

        const config = {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.7778,
          rememberLastUsedCamera: true,
        };

        const onScan = async (decodedText) => {
          await handleAcceptStudentQr(decodedText);
        };

        try {
          await scanner.start({ facingMode: { exact: "environment" } }, config, onScan, () => {});
        } catch {
          try {
            await scanner.start({ facingMode: "user" }, config, onScan, () => {});
          } catch {
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || !cameras.length) {
              throw new Error("No camera found on this device.");
            }
            await scanner.start(cameras[0].id, config, onScan, () => {});
          }
        }
      } catch (e) {
        console.error("Scanner start failed:", e);
        setScannerError(e?.message || "Could not access the camera. You can paste the QR token or link below.");
      } finally {
        if (isMountedRef.current) {
          setScannerStarting(false);
        }
      }
    }, 250);
  };

  const handleRemoveStudent = async (student) => {
    const auth = getAuth();
    const me = auth.currentUser;
    if (!me || !student?.id) return;
    if (!removableStudentIds.has(student.id)) return;

    const ok = window.confirm(
      `Remove ${student.full_name || student.email || "this student"} from your student list?`
    );
    if (!ok) return;

    try {
      await deleteDoc(doc(db, RELATION_COLLECTION, makeRelId(me.uid, student.id)));

      try {
        await deleteDoc(doc(db, CHECKLIST_COLLECTION, makeRelId(me.uid, student.id)));
      } catch {}

      if (!isMountedRef.current) return;

      setStudents((prev) => prev.filter((s) => s.id !== student.id));
      setRemovableStudentIds((prev) => {
        const next = new Set(prev);
        next.delete(student.id);
        return next;
      });
      setChecklistsByStudent((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
    } catch (e) {
      console.error("Remove student failed:", e);
      if (isMountedRef.current) {
        setErrorText(e?.message || "Failed to remove student.");
      }
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const studentRef = searchParams.get("student_ref") || searchParams.get("ref");
    if (!studentRef) return;

    const process = async () => {
      try {
        await handleAcceptStudentQr(studentRef);
        window.history.replaceState({}, "", "/TutorStudents");
      } catch (err) {
        console.error(err);
      }
    };

    process();
  }, [searchParams, handleAcceptStudentQr]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const filteredStudents = useMemo(() => {
    const s = searchTerm.toLowerCase().trim();
    if (!s) return students;

    return students.filter(
      (student) =>
        String(student.full_name || "").toLowerCase().includes(s) ||
        String(student.email || "").toLowerCase().includes(s)
    );
  }, [students, searchTerm]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-gray-700">
          <Loader2 className="animate-spin w-5 h-5" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Tutor Students</h1>
          <div className="mt-2 hidden sm:flex items-center gap-2 text-sm text-gray-600">
            <ClipboardList className="h-4 w-4" />
            Track required documents per student
          </div>
        </div>

        <Button type="button" className="rounded-xl" onClick={startScanner}>
          <ScanLine className="h-4 w-4 mr-2" />
          Scan Student QR
        </Button>
      </div>

      {errorText ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorText}
        </div>
      ) : null}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>My Students List</CardTitle>
          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search by student name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 rounded-xl"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredStudents.map((student) => {
                  const isRemovable = removableStudentIds.has(student.id);

                  return (
                    <TableRow key={student.id}>
                      <TableCell>
                        <div className="font-medium">{student.full_name || "Unnamed"}</div>
                        <div className="text-sm text-muted-foreground">{student.email || "No email"}</div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <ProgressBadge docs={checklistsByStudent[student.id]} />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => openDocs(student)}
                          >
                            <FileCheck className="h-4 w-4 mr-2" />
                            Documents
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant={student.onboarding_completed ? "default" : "secondary"}
                          className="rounded-full"
                        >
                          {student.onboarding_completed ? "Complete" : "Incomplete"}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => handleMessage(student.id)}
                          >
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Message
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            disabled={!isRemovable}
                            title={
                              isRemovable ? "Remove from your student list" : "Student cannot be removed"
                            }
                            onClick={() => handleRemoveStudent(student)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden grid grid-cols-1 gap-4">
            {filteredStudents.map((student) => {
              const isRemovable = removableStudentIds.has(student.id);

              return (
                <Card key={student.id} className="p-4 rounded-2xl">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-bold">{student.full_name || "Unnamed"}</p>
                      <p className="text-sm text-gray-500">{student.email || "No email"}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-gray-500">Docs</span>
                        <ProgressBadge docs={checklistsByStudent[student.id]} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 items-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => openDocs(student)}
                      >
                        <FileCheck className="h-4 w-4 mr-2" />
                        Docs
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        onClick={() => handleMessage(student.id)}
                      >
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Message
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={!isRemovable}
                        title={
                          isRemovable ? "Remove from your student list" : "Student cannot be removed"
                        }
                        onClick={() => handleRemoveStudent(student)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
                    <div>
                      <p className="text-gray-500">Profile</p>
                      <Badge
                        variant={student.onboarding_completed ? "default" : "secondary"}
                        className="mt-1 rounded-full"
                      >
                        {student.onboarding_completed ? "Complete" : "Incomplete"}
                      </Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {filteredStudents.length === 0 && (
            <div className="text-center py-12">
              <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                <FileCheck className="h-6 w-6 text-gray-500" />
              </div>
              <h3 className="mt-2 text-sm font-medium text-gray-900">No students found</h3>
              <p className="mt-1 text-sm text-gray-500">No students match your search criteria.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={docsOpen}
        onClose={closeDocs}
        title={activeStudent ? `Documents • ${activeStudent.full_name || activeStudent.email || "Student"}` : "Documents"}
      >
        {!activeStudent ? null : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">
                Create a required document list for this student, then tick off items as they submit them.
              </div>

              <div className="flex items-center gap-2">
                <ProgressBadge docs={activeDocs} />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={handleApplyTemplate}
                  disabled={docsSaving}
                  title="Adds a default checklist (you can edit after)"
                >
                  Use template
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                className="rounded-xl"
                placeholder="Add a document (e.g., assessment form)…"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddDoc();
                }}
              />
              <Button
                type="button"
                className="rounded-xl"
                onClick={handleAddDoc}
                disabled={docsSaving || !docName.trim()}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            <div className="border rounded-2xl overflow-hidden">
              {activeDocs.length === 0 ? (
                <div className="p-4 text-sm text-gray-600">
                  No documents yet. Click <span className="font-medium">Use template</span> or add your own.
                </div>
              ) : (
                <div className="divide-y">
                  {activeDocs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 p-3">
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!d.submitted}
                          onChange={() => handleToggleDoc(d.id)}
                          disabled={docsSaving}
                          className="h-4 w-4"
                        />
                        <div>
                          <div className="font-medium">{d.name}</div>
                          <div className="text-xs text-gray-500">{d.submitted ? "Submitted" : "Pending"}</div>
                        </div>
                      </label>

                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-xl"
                        onClick={() => handleRemoveDoc(d.id)}
                        disabled={docsSaving}
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {docsSaving ? (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal open={scannerOpen} onClose={() => closeScanner()} title="Scan Student QR">
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Scan the student QR using your camera, or paste the student QR link/token manually.
          </div>

          <div className="overflow-hidden rounded-2xl border bg-black">
            <div className="relative aspect-video w-full">
              <div id={qrRegionIdRef.current} className="h-full w-full" />

              {!cameraSupported ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 bg-black/70 px-4 text-center">
                  <Camera className="h-8 w-8 mb-3" />
                  <div className="text-sm">Live camera QR scan is not supported here.</div>
                  <div className="text-xs text-white/70 mt-1">Use the manual token/link input below.</div>
                </div>
              ) : null}

              {scannerStarting ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting camera…
                  </div>
                </div>
              ) : null}

              {scannerBusy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding student…
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {scannerError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {scannerError}
            </div>
          ) : null}

          {scannerSuccess ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {scannerSuccess}
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">Manual QR token / link</label>
            <div className="flex gap-2">
              <Input
                className="rounded-xl"
                placeholder="Paste student_ref link or token here..."
                value={manualQrValue}
                onChange={(e) => setManualQrValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualQrValue.trim()) {
                    handleAcceptStudentQr(manualQrValue);
                  }
                }}
              />
              <Button
                type="button"
                className="rounded-xl"
                disabled={scannerBusy || !manualQrValue.trim()}
                onClick={() => handleAcceptStudentQr(manualQrValue)}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => closeScanner()}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}