import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { TutoringSession } from '@/api/entities';
import { User } from '@/api/entities';
import { auth, db } from '@/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  where,
  documentId,
} from 'firebase/firestore';

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, MessageCircle, Calendar, Trash2, ScanLine, Camera, Loader2, X } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { Html5Qrcode } from 'html5-qrcode';

// ---- helpers ----
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const safeStr = (v) => (v == null ? "" : String(v));

const safeFormatDateTime = (ts) => {
  try {
    if (!ts) return "—";
    const d = typeof ts?.toDate === "function" ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
};

const flagUrlFromCode = (code) => {
  const cc = (code || '').toString().trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return '';
  return `https://flagcdn.com/w20/${cc}.png`;
};

const statusBadge = (status) => {
  const s = safeStr(status || "needs_schedule").toLowerCase();
  if (s === "scheduled") return <Badge className="bg-green-600">Scheduled</Badge>;
  if (s === "paused") return <Badge variant="secondary">Paused</Badge>;
  return <Badge variant="outline">Needs schedule</Badge>;
};

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
    return (
      url.searchParams.get("student_ref") ||
      url.searchParams.get("ref") ||
      ""
    ).trim();
  } catch {
    return text;
  }
}

function ScannerModal({ open, onClose, onSubmitToken, busy, errorText, successText }) {
  const qrRegionIdRef = useRef(`tutor-student-qr-reader-${Math.random().toString(36).slice(2)}`);
  const qrScannerRef = useRef(null);
  const handledTokenRef = useRef("");
  const [scannerStarting, setScannerStarting] = useState(false);
  const [manualQrValue, setManualQrValue] = useState("");
  const [cameraSupported, setCameraSupported] = useState(true);

  const stopScanner = async () => {
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
  };

  useEffect(() => {
    if (!open) {
      stopScanner();
      return;
    }

    let mounted = true;

    const startScanner = async () => {
      setScannerStarting(true);
      handledTokenRef.current = "";

      try {
        const hasCamera =
          typeof navigator !== "undefined" &&
          !!navigator.mediaDevices &&
          typeof navigator.mediaDevices.getUserMedia === "function";

        if (!hasCamera) {
          setCameraSupported(false);
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

        const onScanSuccess = async (decodedText) => {
          const token = extractStudentRefFromScannedText(decodedText);
          if (!token) return;
          if (handledTokenRef.current === token || busy) return;

          handledTokenRef.current = token;
          await onSubmitToken(token);
        };

        try {
          await scanner.start(
            { facingMode: { exact: "environment" } },
            config,
            onScanSuccess,
            () => {}
          );
        } catch (envErr) {
          console.warn("Environment camera failed, trying user camera:", envErr);

          try {
            await scanner.start(
              { facingMode: "user" },
              config,
              onScanSuccess,
              () => {}
            );
          } catch (userErr) {
            console.warn("User camera failed, trying first available camera:", userErr);

            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || !cameras.length) {
              throw new Error("No camera found on this device.");
            }

            await scanner.start(
              cameras[0].id,
              config,
              onScanSuccess,
              () => {}
            );
          }
        }
      } catch (e) {
        console.error("Scanner start failed:", e);

        const msg = String(e?.message || "");
        if (
          msg.includes("NotReadableError") ||
          msg.includes("Could not start video source")
        ) {
          console.warn("Camera is probably already being used by another app.");
        }
      } finally {
        if (mounted) setScannerStarting(false);
      }
    };

    const timer = setTimeout(() => {
      startScanner();
    }, 200);

    return () => {
      mounted = false;
      clearTimeout(timer);
      stopScanner();
    };
  }, [open, busy, onSubmitToken]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="font-semibold">Scan Student QR</div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full hover:bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
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
                  <div className="text-xs text-white/70 mt-1">
                    Use the manual token/link input below.
                  </div>
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

              {busy ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding student…
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {errorText ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorText}
            </div>
          ) : null}

          {successText ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {successText}
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">Manual QR token / link</label>
            <div className="flex gap-2">
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder="Paste student_ref link or token here..."
                value={manualQrValue}
                onChange={(e) => setManualQrValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualQrValue.trim()) {
                    onSubmitToken(manualQrValue);
                  }
                }}
              />
              <Button
                type="button"
                className="rounded-xl"
                disabled={busy || !manualQrValue.trim()}
                onClick={() => onSubmitToken(manualQrValue)}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TutorStudents() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const [meAuth, setMeAuth] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setMeAuth(u || null));
    return () => unsub?.();
  }, []);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleStudent, setScheduleStudent] = useState(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerSuccess, setScannerSuccess] = useState("");
  const [urlProcessing, setUrlProcessing] = useState(false);

  const processedUrlTokenRef = useRef("");

  const openScheduleStudentId = useMemo(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      return sp.get("openschedule") || sp.get("openSchedule") || "";
    } catch {
      return "";
    }
  }, [location.search]);

  const openScheduleFor = (student) => {
    setScheduleStudent(student);

    const next = student?.next_session_at;
    if (next?.toDate) {
      const d = next.toDate();
      const pad = (x) => String(x).padStart(2, "0");
      setScheduleValue(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      );
    } else {
      setScheduleValue("");
    }

    setFrequency(student?.session_frequency || "weekly");
    setNotes(student?.session_notes || "");
    setScheduleOpen(true);
  };

  const closeSchedule = () => {
    setScheduleOpen(false);
    setScheduleStudent(null);
    setScheduleValue("");
    setFrequency("weekly");
    setNotes("");
  };

  const loadData = async () => {
    setLoading(true);
    setErrorText("");

    try {
      const currentUser = await User.me();
      const tutorId = currentUser?.id || meAuth?.uid;
      if (!tutorId) {
        setStudents([]);
        return;
      }

      const sessionData = await TutoringSession.filter({ tutor_id: tutorId });
      const sessions = [...(sessionData || [])].sort(
        (a, b) => new Date(b.scheduled_date || 0) - new Date(a.scheduled_date || 0)
      );

      const byStudent = new Map();
      for (const s of sessions) {
        const key = s.student_id || s.student_email || `unknown-${(s.id || Math.random()).toString()}`;
        const bucket = byStudent.get(key) || [];
        bucket.push(s);
        byStudent.set(key, bucket);
      }

      const relQ1 = query(collection(db, "tutor_students"), where("tutor_id", "==", tutorId));
      const relQ2 = query(collection(db, "tutor_students"), where("tutorId", "==", tutorId));

      const [relSnap1, relSnap2] = await Promise.all([
        getDocs(relQ1).catch(() => ({ docs: [] })),
        getDocs(relQ2).catch(() => ({ docs: [] })),
      ]);

      const relByStudentId = {};
      const relStudentIds = [];

      [...(relSnap1.docs || []), ...(relSnap2.docs || [])].forEach((d) => {
        const data = d.data() || {};
        const sid = data.student_id || data.studentId;
        if (sid) {
          relByStudentId[sid] = { id: d.id, ...data };
          relStudentIds.push(sid);
        }
      });

      const userById = {};
      const uniqueRelIds = Array.from(new Set(relStudentIds));
      for (const batch of chunk(uniqueRelIds, 10)) {
        const usersQ = query(collection(db, "users"), where(documentId(), "in", batch));
        const usersSnap = await getDocs(usersQ);
        usersSnap.docs.forEach((u) => (userById[u.id] = { id: u.id, ...(u.data() || {}) }));
      }

      const rowsMap = new Map();

      for (const [key, sess] of byStudent.entries()) {
        const latest = sess[0];
        const fullName = latest.student_full_name || latest.student_name || "Unnamed";
        const email = latest.student_email || '';
        const completed = sess.filter(x => x.status === 'completed');
        const rated = sess.filter(x => typeof x.student_rating === 'number' && x.student_rating > 0);
        const averageRating =
          rated.length > 0
            ? rated.reduce((sum, x) => sum + (x.student_rating || 0), 0) / rated.length
            : 0;

        const rel = relByStudentId[key] || null;
        const userDoc = userById[key] || null;

        rowsMap.set(key, {
          id: key,
          full_name: userDoc?.fullName || userDoc?.full_name || userDoc?.displayName || fullName,
          email: userDoc?.email || email,
          role: userDoc?.role || userDoc?.user_role || "",
          country: userDoc?.country || userDoc?.country_name || "",
          country_code: userDoc?.country_code || userDoc?.countryCode || userDoc?.country_iso2 || "",
          profile_picture: userDoc?.profile_picture || userDoc?.profilePicture || userDoc?.photoURL || userDoc?.photo_url || userDoc?.photoUrl || userDoc?.avatar || "",
          subjects: Array.from(new Set(sess.map(x => x.subject).filter(Boolean))),
          totalSessions: sess.length,
          completedSessions: completed.length,
          averageRating,
          lastSession: latest,

          schedule_status: rel?.schedule_status || "needs_schedule",
          next_session_at: rel?.next_session_at || null,
          session_frequency: rel?.session_frequency || "weekly",
          session_notes: rel?.session_notes || "",
        });
      }

      for (const sid of uniqueRelIds) {
        if (rowsMap.has(sid)) continue;
        const rel = relByStudentId[sid];
        const u = userById[sid] || {};
        rowsMap.set(sid, {
          id: sid,
          full_name: (u.full_name || u.fullName || u.displayName || u.name || (u.email ? u.email.split("@")[0] : "") || "Unnamed"),
          email: u.email || "",
          role: u.role || u.user_role || "",
          country: u.country || u.country_name || "",
          country_code: u.country_code || u.countryCode || u.country_iso2 || "",
          profile_picture: u.profile_picture || u.profilePicture || u.photoURL || u.photo_url || u.photoUrl || u.avatar || "",
          subjects: [],
          totalSessions: 0,
          completedSessions: 0,
          averageRating: 0,
          lastSession: null,

          schedule_status: rel?.schedule_status || "needs_schedule",
          next_session_at: rel?.next_session_at || null,
          session_frequency: rel?.session_frequency || "weekly",
          session_notes: rel?.session_notes || "",
        });
      }

      const rows = Array.from(rowsMap.values());

      const order = { scheduled: 0, needs_schedule: 1, paused: 2 };
      rows.sort((a, b) => {
        const da = order[safeStr(a.schedule_status).toLowerCase()] ?? 99;
        const dbb = order[safeStr(b.schedule_status).toLowerCase()] ?? 99;
        if (da !== dbb) return da - dbb;
        return safeStr(a.full_name).localeCompare(safeStr(b.full_name));
      });

      setStudents(rows);
    } catch (error) {
      console.error('Error loading students:', error);
      setErrorText(error?.message || "Failed to load students");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [meAuth?.uid]);

  useEffect(() => {
    if (loading) return;
    if (!openScheduleStudentId) return;

    const found = students.find((s) => s.id === openScheduleStudentId);
    if (found) {
      openScheduleFor(found);

      try {
        const sp = new URLSearchParams(location.search || "");
        sp.delete("openschedule");
        sp.delete("openSchedule");
        navigate({ search: sp.toString() }, { replace: true });
      } catch {}
    }
  }, [loading, openScheduleStudentId, students]);

  const saveSchedule = async () => {
    try {
      if (!scheduleStudent?.id) return;

      const currentUser = await User.me();
      const tutorId = currentUser?.id || meAuth?.uid;
      if (!tutorId) return;

      setSaving(true);

      let nextVal = null;
      if (scheduleValue) {
        const d = new Date(scheduleValue);
        if (!Number.isNaN(d.getTime())) nextVal = d;
      }

      const relId = `${tutorId}_${scheduleStudent.id}`;
      await updateDoc(doc(db, "tutor_students", relId), {
        schedule_status: nextVal ? "scheduled" : "needs_schedule",
        next_session_at: nextVal ? nextVal : null,
        session_frequency: frequency || "weekly",
        session_notes: notes || "",
        updated_at: serverTimestamp(),
      });

      setStudents((prev) =>
        prev.map((s) =>
          s.id === scheduleStudent.id
            ? {
                ...s,
                schedule_status: nextVal ? "scheduled" : "needs_schedule",
                next_session_at: nextVal ? { toDate: () => nextVal } : null,
                session_frequency: frequency || "weekly",
                session_notes: notes || "",
              }
            : s
        )
      );

      closeSchedule();
    } catch (e) {
      console.error("saveSchedule error:", e);
      setErrorText(e?.message || "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const removeStudent = async (student) => {
    try {
      const currentUser = await User.me();
      const tutorId = currentUser?.id || meAuth?.uid;
      if (!tutorId) return;

      const relId = `${tutorId}_${student.id}`;
      await deleteDoc(doc(db, 'tutor_students', relId));

      setStudents((prev) => prev.filter((s) => s.id !== student.id));
    } catch (e) {
      console.error('removeStudent error:', e);
      setErrorText(e?.message || 'Failed to remove student');
    }
  };

  const goMessage = (studentId) => {
    navigate(createPageUrl(`Messages?to=${studentId}`));
  };

  const handleTutorQrSubmit = async (rawValue, options = {}) => {
    const token = extractStudentRefFromScannedText(rawValue);
    if (!token) {
      if (!options.silent) {
        setScannerError("Could not read a valid student QR token.");
      }
      return { ok: false };
    }

    if (scannerBusy) return { ok: false };

    setScannerBusy(true);
    if (!options.silent) {
      setScannerError("");
      setScannerSuccess("");
    }

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("You must be signed in.");

      const idToken = await currentUser.getIdToken();
      const base = getFunctionsBase();

      const res = await fetch(`${base}/acceptStudentReferralToTutor`, {
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

      let successText = "Student added successfully.";
      if (data?.alreadyExists) {
        successText = "Student is already in your list.";
      } else if (data?.student?.full_name) {
        successText = `${data.student.full_name} added to your student list.`;
      }

      if (!options.silent) {
        setScannerSuccess(successText);
      }

      await loadData();

      if (!options.keepOpen && !options.silent) {
        setTimeout(() => {
          setScannerOpen(false);
          setScannerSuccess("");
          setScannerError("");
        }, 900);
      }

      return { ok: true, data };
    } catch (e) {
      console.error("acceptStudentReferralToTutor failed:", e);
      if (!options.silent) {
        setScannerError(e?.message || "Failed to add student.");
      }
      return { ok: false, error: e };
    } finally {
      setScannerBusy(false);
    }
  };

  useEffect(() => {
    const studentRefFromUrl = (
      searchParams.get("student_ref") ||
      searchParams.get("ref") ||
      ""
    ).trim();

    if (!studentRefFromUrl) return;
    if (!auth.currentUser && !meAuth?.uid) return;
    if (processedUrlTokenRef.current === studentRefFromUrl) return;

    processedUrlTokenRef.current = studentRefFromUrl;
    setUrlProcessing(true);
    setScannerError("");
    setScannerSuccess("");

    (async () => {
      const result = await handleTutorQrSubmit(studentRefFromUrl, { silent: true });

      if (result?.ok) {
        setScannerSuccess(
          result?.data?.alreadyExists
            ? "Student is already in your list."
            : (result?.data?.student?.full_name
                ? `${result.data.student.full_name} added to your student list.`
                : "Student added successfully.")
        );
      } else {
        setScannerError(result?.error?.message || "Failed to add student.");
      }

      const next = new URLSearchParams(searchParams);
      next.delete("student_ref");
      next.delete("ref");
      setSearchParams(next, { replace: true });

      setUrlProcessing(false);
    })();
  }, [searchParams, meAuth?.uid]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Users className="w-8 h-8 text-purple-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              My Students
            </h1>
          </div>

          <Button
            type="button"
            className="rounded-xl"
            onClick={() => {
              setScannerOpen(true);
              setScannerError("");
              setScannerSuccess("");
            }}
          >
            <ScanLine className="h-4 w-4 mr-2" />
            Scan Student QR
          </Button>
        </div>

        {!!urlProcessing && (
          <div className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing student QR...
          </div>
        )}

        {!!errorText && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {errorText}
          </div>
        )}

        {!!scannerError && !scannerOpen && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            {scannerError}
          </div>
        )}

        {!!scannerSuccess && !scannerOpen && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            {scannerSuccess}
          </div>
        )}

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Student Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {students.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Next Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map(student => {
                    const flagUrl = flagUrlFromCode(student.country_code);
                    return (
                      <TableRow key={student.id}>
                        <TableCell>
                          {(() => {
                            const name =
                              student.full_name ||
                              student.fullName ||
                              student.displayName ||
                              student.name ||
                              "Unnamed";
                            const photo =
                              student.photoURL ||
                              student.photo_url ||
                              student.photoUrl ||
                              student.profile_photo ||
                              student.profilePhoto ||
                              student.profile_picture ||
                              student.profilePicture ||
                              student.avatarUrl ||
                              student.avatar ||
                              student.image ||
                              student.imageUrl ||
                              "";
                            const initials = name
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((p) => p[0].toUpperCase())
                              .join("");
                            return (
                              <div className="flex items-center gap-3">
                                {photo ? (
                                  <img
                                    src={photo}
                                    alt={name}
                                    className="w-9 h-9 rounded-full object-cover border"
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-gray-100 border flex items-center justify-center text-xs font-semibold text-gray-600">
                                    {initials || "U"}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{name}</div>
                                  {student.email ? (
                                    <div className="text-sm text-gray-500 truncate">{student.email}</div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {(student.country || student.country_code) ? (
                            <span className="text-sm">
                              {flagUrl ? (
                                <img
                                  src={flagUrl}
                                  alt=""
                                  className="inline-block w-5 h-[14px] mr-1 align-[-2px] rounded-sm"
                                  loading="lazy"
                                />
                              ) : null}
                              {student.country || student.country_code}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </TableCell>

                        <TableCell>{safeFormatDateTime(student.next_session_at)}</TableCell>
                        <TableCell>{statusBadge(student.schedule_status)}</TableCell>
                        <TableCell className="capitalize">{safeStr(student.session_frequency || "—").replace("_", " ")}</TableCell>

                        <TableCell>
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" title="Message" onClick={() => goMessage(student.id)}>
                              <MessageCircle className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title="Schedule / Reschedule" onClick={() => openScheduleFor(student)}>
                              <Calendar className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Remove"
                              onClick={() => removeStudent(student)}
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
            ) : (
              <div className="text-center py-8">
                <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Students Yet</h3>
                <p className="text-gray-600">Students you add or who book sessions with you will appear here.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {scheduleOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="text-lg font-semibold">Schedule session</div>
                  <div className="text-sm text-gray-500">
                    {scheduleStudent?.full_name || "Student"} {scheduleStudent?.email ? `• ${scheduleStudent.email}` : ""}
                  </div>
                </div>
                <Button variant="ghost" onClick={closeSchedule}>Close</Button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Next session date & time</label>
                  <input
                    type="datetime-local"
                    value={scheduleValue}
                    onChange={(e) => setScheduleValue(e.target.value)}
                    className="mt-1 w-full border rounded-lg p-2"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Leave blank if you want to schedule later.
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Frequency</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    className="mt-1 w-full border rounded-lg p-2"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="ad_hoc">Ad hoc</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full border rounded-lg p-2 min-h-[90px]"
                    placeholder="e.g., IELTS Speaking focus, homework, goals…"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={closeSchedule} disabled={saving}>Cancel</Button>
                  <Button onClick={saveSchedule} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <ScannerModal
          open={scannerOpen}
          onClose={() => {
            setScannerOpen(false);
            setScannerError("");
            setScannerSuccess("");
          }}
          onSubmitToken={handleTutorQrSubmit}
          busy={scannerBusy}
          errorText={scannerError}
          successText={scannerSuccess}
        />
      </div>
    </div>
  );
}