import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { User } from '@/api/entities';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Users,
  Search,
  Mail,
  Phone,
  MessageSquare,
  Loader2,
  Info,
  Lock,
  CheckCircle,
  QrCode,
  XCircle,
  Camera,
  Eye,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Html5Qrcode } from 'html5-qrcode';

import { db, auth } from '@/firebase';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { useSubscriptionMode } from '@/hooks/useSubscriptionMode';

function getFunctionsBase() {
  const fromEnv =
    import.meta.env.VITE_FUNCTIONS_BASE ||
    import.meta.env.VITE_FUNCTIONS_HTTP_BASE ||
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CLOUD_FUNCTIONS_BASE_URL ||
    "";

  if (fromEnv) return String(fromEnv).replace(/\/+$/, "");
  return "https://us-central1-greenpass-dc92d.cloudfunctions.net";
}

const StatusBadge = ({ status = '' }) => {
  const colors = {
    interested: 'bg-pink-100 text-pink-800',
    contacted: 'bg-blue-100 text-blue-800',
    closed: 'bg-gray-100 text-gray-800',
  };

  return (
    <Badge className={`${colors[status] || 'bg-gray-100 text-gray-800'} capitalize`}>
      {String(status || 'interested').replace(/_/g, ' ')}
    </Badge>
  );
};

function resolveUserRole(userDoc) {
  return String(
    userDoc?.role ||
      userDoc?.selected_role ||
      userDoc?.user_type ||
      userDoc?.userType ||
      'user'
  )
    .toLowerCase()
    .trim();
}

const SUBSCRIPTION_REQUIRED_ROLES = new Set(['agent', 'tutor', 'school']);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'paid', 'subscribed']);
const INACTIVE_SUBSCRIPTION_STATUSES = new Set([
  '',
  'none',
  'skipped',
  'inactive',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'unpaid',
  'canceled',
  'cancelled',
  'expired',
]);

function isSubscriptionAccessActive(userDoc) {
  if (!userDoc) return false;

  const status = String(
    userDoc?.subscription_status ||
      userDoc?.subscriptionStatus ||
      ''
  )
    .toLowerCase()
    .trim();

  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true;

  if (
    (userDoc?.subscription_active === true || userDoc?.subscriptionActive === true) &&
    !INACTIVE_SUBSCRIPTION_STATUSES.has(status)
  ) {
    return true;
  }

  return false;
}

function isSubInactiveForRole(userDoc) {
  const role = resolveUserRole(userDoc);
  if (!SUBSCRIPTION_REQUIRED_ROLES.has(role)) return false;

  return !isSubscriptionAccessActive(userDoc);
}

function buildSubscriptionCheckoutUrl(userDoc, fallbackPath = '/school-leads') {
  const role = resolveUserRole(userDoc);
  const safeRole = SUBSCRIPTION_REQUIRED_ROLES.has(role) ? role : 'school';
  const existingPlan = String(
    userDoc?.subscription_plan ||
      userDoc?.subscriptionPlan ||
      ''
  ).trim();
  const plan = existingPlan || `${safeRole}_monthly`;

  const query = new URLSearchParams({
    type: 'subscription',
    role: safeRole,
    plan,
    lock: '1',
    returnTo: fallbackPath,
  });

  return `${createPageUrl('Checkout')}?${query.toString()}`;
}

function maskName(name) {
  const value = String(name || '').trim();
  if (!value) return 'Locked Lead';

  const parts = value.split(/\s+/).filter(Boolean);
  return parts
    .map((part) => {
      if (part.length <= 1) return '*';
      if (part.length === 2) return `${part[0]}*`;
      return `${part[0]}${'*'.repeat(Math.max(1, part.length - 1))}`;
    })
    .join(' ');
}

function maskEmail(email) {
  const value = String(email || '').trim();
  if (!value || !value.includes('@')) return '********';

  const [local, domain] = value.split('@');
  const maskedLocal =
    local.length <= 1
      ? '*'
      : `${local[0]}${'*'.repeat(Math.max(3, local.length - 1))}`;

  const domainParts = String(domain || '').split('.');
  const domainName = domainParts[0] || '';
  const tld = domainParts.slice(1).join('.');

  const maskedDomainName =
    domainName.length <= 1
      ? '*'
      : `${domainName[0]}${'*'.repeat(Math.max(2, domainName.length - 1))}`;

  return `${maskedLocal}@${maskedDomainName}${tld ? `.${tld}` : ''}`;
}

function maskPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return '';

  const digits = value.replace(/\D/g, '');
  if (!digits) return '********';
  if (digits.length <= 4) return '*'.repeat(digits.length);

  const visible = digits.slice(-2);
  return `${'*'.repeat(Math.max(6, digits.length - 2))}${visible}`;
}

function extractStudentTokenFromScan(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    return (
      url.searchParams.get('student_ref') ||
      url.searchParams.get('ref') ||
      ''
    ).trim();
  } catch {
    return text;
  }
}

function getAssignedAgentId(lead) {
  const student = lead?.student || {};
  return (
    lead?.assignedAgentId ||
    lead?.assigned_agent_id ||
    lead?.linked_agent_id ||
    lead?.linkedAgentId ||
    lead?.referred_by_agent_id ||
    lead?.referredByAgentId ||
    student?.assigned_agent_id ||
    student?.assignedAgentId ||
    student?.referred_by_agent_id ||
    student?.referredByAgentId ||
    (student?.invited_by?.role === 'agent' ? student?.invited_by?.uid : '') ||
    ''
  );
}

function getAssignedAgentName(lead) {
  return (
    lead?.assignedAgent?.full_name ||
    lead?.assignedAgent?.name ||
    lead?.assignedAgent?.displayName ||
    lead?.assignedAgentName ||
    '—'
  );
}

async function resolveStudentQrToken(token) {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Not signed in');

  const idToken = await fbUser.getIdToken();
  const base = getFunctionsBase();

  const response = await fetch(
    `${base}/resolveStudentReferralToken?student_ref=${encodeURIComponent(token)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to resolve student QR token');
  }

  const student = data?.student;
  if (!student?.studentId) {
    throw new Error('Student token did not return a student');
  }

  return student;
}

async function acceptStudentQrLead(token) {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Not signed in');

  const idToken = await fbUser.getIdToken();
  const base = getFunctionsBase();

  const response = await fetch(
    `${base}/acceptStudentReferralToSchool`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ student_ref: token }),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to accept student QR');
  }

  return data;
}

function buildSchoolQrSuccessText(data) {
  if (data?.alreadyExists) return 'This student is already in your leads.';
  if (data?.student?.full_name) return `${data.student.full_name} added to your leads.`;
  return 'Student added to your leads.';
}

function ScannerModal({ open, onClose, onSubmitToken, busy, errorText, successText }) {
  const qrRegionIdRef = useRef(`school-student-qr-reader-${Math.random().toString(36).slice(2)}`);
  const qrScannerRef = useRef(null);
  const handledTokenRef = useRef("");
  const [scannerStarting, setScannerStarting] = useState(false);
  const [manualQrValue, setManualQrValue] = useState("");
  const [cameraSupported, setCameraSupported] = useState(true);

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
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          rememberLastUsedCamera: true,
        };

        const onScanSuccess = async (decodedText) => {
          const token = extractStudentTokenFromScan(decodedText);
          if (!token) return;
          if (handledTokenRef.current === token || busy) return;

          handledTokenRef.current = token;
          const result = await onSubmitToken(token);

          if (!result?.ok) {
            handledTokenRef.current = "";
          }
        };

        try {
          await scanner.start(
            { facingMode: { exact: 'environment' } },
            config,
            onScanSuccess,
            () => {}
          );
        } catch {
          try {
            await scanner.start(
              { facingMode: 'user' },
              config,
              onScanSuccess,
              () => {}
            );
          } catch {
            const cameras = await Html5Qrcode.getCameras();
            if (!cameras || !cameras.length) {
              throw new Error('No camera found on this device.');
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
        console.error('QR scanner start failed:', e);
      } finally {
        if (mounted) setScannerStarting(false);
      }
    };

    const timer = setTimeout(() => {
      startScanner();
    }, 120);

    return () => {
      mounted = false;
      clearTimeout(timer);
      stopScanner();
    };
  }, [open, onSubmitToken, busy, stopScanner]);

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
                    Processing QR…
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
              <Input
                className="rounded-xl"
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

export default function SchoolLeads() {
  const navigate = useNavigate();
  const { subscriptionModeEnabled } = useSubscriptionMode();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [meDoc, setMeDoc] = useState(null);
  const [updatingLeadId, setUpdatingLeadId] = useState('');
  const [errorText, setErrorText] = useState('');

  const [pendingQrLead, setPendingQrLead] = useState(null);
  const [pendingQrToken, setPendingQrToken] = useState('');
  const [resolvingQrLead, setResolvingQrLead] = useState(false);
  const [actingQrLead, setActingQrLead] = useState(false);
  const [qrNotice, setQrNotice] = useState('');

  const [showScanner, setShowScanner] = useState(false);
  const [scannerBusy, setScannerBusy] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [scannerSuccess, setScannerSuccess] = useState('');

  const isMountedRef = useRef(true);
  const handledUrlTokenRef = useRef("");

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const subscriptionLocked =
    subscriptionModeEnabled && isSubInactiveForRole(meDoc);

  const shouldMaskLeadInfo = subscriptionLocked;

  const handleGoToSubscription = useCallback(() => {
    const currentPath = `${window.location.pathname}${window.location.search || ''}`;
    navigate(buildSubscriptionCheckoutUrl(meDoc, currentPath));
  }, [meDoc, navigate]);

  const loadLeads = useCallback(async () => {
    setLoading(true);

    try {
      const fbUser = auth.currentUser;

      if (!fbUser?.uid) {
        if (isMountedRef.current) {
          setLeads([]);
          setMeDoc(null);
        }
        return;
      }

      try {
        const meSnap = await getDoc(doc(db, 'users', fbUser.uid));
        if (isMountedRef.current) {
          setMeDoc(meSnap.exists() ? meSnap.data() : null);
        }
      } catch (e) {
        console.error('Error loading current user doc:', e);
        if (isMountedRef.current) setMeDoc(null);
      }

      const qLead = query(
        collection(db, 'school_leads'),
        where('school_owner_user_id', '==', fbUser.uid)
      );

      const leadSnap = await getDocs(qLead);
      const schoolLeads = leadSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      schoolLeads.sort((a, b) => {
        const ad =
          a.created_date
            ? new Date(a.created_date).getTime()
            : a.created_at?.toDate
              ? a.created_at.toDate().getTime()
              : a.createdAt?.toDate
                ? a.createdAt.toDate().getTime()
                : 0;

        const bd =
          b.created_date
            ? new Date(b.created_date).getTime()
            : b.created_at?.toDate
              ? b.created_at.toDate().getTime()
              : b.createdAt?.toDate
                ? b.createdAt.toDate().getTime()
                : 0;

        return bd - ad;
      });

      if (schoolLeads.length === 0) {
        if (isMountedRef.current) setLeads([]);
        return;
      }

      const studentIds = [
        ...new Set(schoolLeads.map((l) => l.student_id).filter(Boolean)),
      ];

      const studentResults = await Promise.all(
        studentIds.map(async (studentUid) => {
          try {
            const q = query(collection(db, 'users'), where('uid', '==', studentUid));
            const snap = await getDocs(q);
            if (snap.empty) return null;

            const userDoc = snap.docs[0];
            return {
              id: userDoc.id,
              ...userDoc.data(),
            };
          } catch (e) {
            console.error(`Error loading student by uid ${studentUid}:`, e);
            return null;
          }
        })
      );

      const studentsMap = studentResults
        .filter(Boolean)
        .reduce((acc, student) => {
          acc[student.uid] = student;
          return acc;
        }, {});

      const agentIds = [
        ...new Set(
          schoolLeads
            .map((lead) => {
              const student = lead?.student_id ? studentsMap[lead.student_id] : null;
              return (
                lead?.assigned_agent_id ||
                lead?.assignedAgentId ||
                lead?.linked_agent_id ||
                lead?.linkedAgentId ||
                lead?.referred_by_agent_id ||
                lead?.referredByAgentId ||
                student?.assigned_agent_id ||
                student?.assignedAgentId ||
                student?.referred_by_agent_id ||
                student?.referredByAgentId ||
                (student?.invited_by?.role === 'agent' ? student?.invited_by?.uid : '') ||
                ''
              );
            })
            .filter(Boolean)
        ),
      ];

      const agentResults = await Promise.all(
        agentIds.map(async (agentUid) => {
          try {
            const q = query(collection(db, 'users'), where('uid', '==', agentUid));
            const snap = await getDocs(q);
            if (snap.empty) return null;

            const userDoc = snap.docs[0];
            return {
              id: userDoc.id,
              ...userDoc.data(),
            };
          } catch (e) {
            console.error(`Error loading agent by uid ${agentUid}:`, e);
            return null;
          }
        })
      );

      const agentsMap = agentResults
        .filter(Boolean)
        .reduce((acc, agent) => {
          acc[agent.uid] = agent;
          return acc;
        }, {});

      const combinedLeads = schoolLeads.map((lead) => {
        const student = lead.student_id ? studentsMap[lead.student_id] : null;

        const assignedAgentId =
          lead?.assigned_agent_id ||
          lead?.assignedAgentId ||
          lead?.linked_agent_id ||
          lead?.linkedAgentId ||
          lead?.referred_by_agent_id ||
          lead?.referredByAgentId ||
          student?.assigned_agent_id ||
          student?.assignedAgentId ||
          student?.referred_by_agent_id ||
          student?.referredByAgentId ||
          (student?.invited_by?.role === 'agent' ? student?.invited_by?.uid : '') ||
          '';

        const assignedAgent = assignedAgentId ? agentsMap[assignedAgentId] : null;

        return {
          ...lead,
          student,
          assignedAgentId,
          assignedAgent,
          assignedAgentName:
            assignedAgent?.full_name ||
            assignedAgent?.name ||
            assignedAgent?.displayName ||
            '—',
        };
      });

      if (isMountedRef.current) setLeads(combinedLeads);
    } catch (error) {
      console.error('Error loading school leads:', error);
      if (isMountedRef.current) {
        setLeads([]);
        setErrorText(error?.message || 'Failed to load school leads.');
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const removeStudentRefFromUrl = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('student_ref');
      url.searchParams.delete('ref');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }, []);

  const resolveTokenIntoPendingLead = useCallback(async (token) => {
    const fbUser = auth.currentUser;
    if (!fbUser?.uid) return { ok: false };

    setResolvingQrLead(true);
    setQrNotice('');
    setErrorText('');
    setPendingQrToken(token);

    try {
      const meSnap = await getDoc(doc(db, 'users', fbUser.uid));
      const currentMeDoc = meSnap.exists() ? meSnap.data() : null;
      if (isMountedRef.current) setMeDoc(currentMeDoc);

      const role = resolveUserRole(currentMeDoc);
      if (role !== 'school') {
        if (isMountedRef.current) {
          setQrNotice('Only school accounts can accept student QR codes.');
          setPendingQrLead(null);
        }
        return { ok: false };
      }

      if (subscriptionModeEnabled && isSubInactiveForRole(currentMeDoc)) {
        if (isMountedRef.current) {
          setQrNotice('Subscription required. Activate your subscription before scanning or accepting student QR leads.');
          setPendingQrLead(null);
        }
        return { ok: false };
      }

      const resolved = await resolveStudentQrToken(token);

      if (isMountedRef.current) {
        setPendingQrLead({
          ...resolved,
          alreadyExists: false,
        });
      }

      return { ok: true, data: resolved };
    } catch (e) {
      console.error('Failed to resolve student QR:', e);
      if (isMountedRef.current) {
        setPendingQrLead(null);
        setErrorText(e?.message || 'Failed to resolve student QR.');
      }
      return { ok: false, error: e };
    } finally {
      if (isMountedRef.current) setResolvingQrLead(false);
    }
  }, [subscriptionModeEnabled]);

  const handleSchoolQrSubmit = useCallback(
    async (rawValue, options = {}) => {
      const token = extractStudentTokenFromScan(rawValue);
      if (!token) {
        if (!options.silent) setScannerError('Could not read a valid student QR token.');
        return { ok: false };
      }

      if (scannerBusy) return { ok: false };

      setScannerBusy(true);
      if (!options.silent) {
        setScannerError('');
        setScannerSuccess('');
      }

      try {
        const result = await resolveTokenIntoPendingLead(token);

        if (result?.ok && !options.silent && isMountedRef.current) {
          setScannerSuccess('Student QR resolved successfully.');
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setShowScanner(false);
            setScannerSuccess('');
            setScannerError('');
          }, 700);
        }

        return result;
      } catch (e) {
        console.error('School QR resolve failed:', e);
        if (!options.silent && isMountedRef.current) {
          setScannerError(e?.message || 'Failed to resolve student QR.');
        }
        return { ok: false, error: e };
      } finally {
        if (isMountedRef.current) setScannerBusy(false);
      }
    },
    [scannerBusy, resolveTokenIntoPendingLead]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = (
      url.searchParams.get('student_ref') ||
      url.searchParams.get('ref') ||
      ''
    ).trim();

    if (!token) return;
    if (!auth.currentUser?.uid) return;
    if (handledUrlTokenRef.current === token) return;

    handledUrlTokenRef.current = token;

    (async () => {
      await handleSchoolQrSubmit(token, { silent: true });
    })();
  }, [handleSchoolQrSubmit]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const term = (searchTerm || '').toLowerCase();

      const visibleName = shouldMaskLeadInfo
        ? maskName(lead.student?.full_name || lead.student_name || '')
        : (lead.student?.full_name || lead.student_name || '');

      const visibleEmail = shouldMaskLeadInfo
        ? maskEmail(lead.student?.email || lead.student_email || '')
        : (lead.student?.email || lead.student_email || '');

      const visiblePhone = shouldMaskLeadInfo
        ? maskPhone(lead.student?.phone || lead.student_phone || '')
        : (lead.student?.phone || lead.student_phone || '');

      const agentName = String(getAssignedAgentName(lead) || '').toLowerCase();

      return (
        visibleName.toLowerCase().includes(term) ||
        visibleEmail.toLowerCase().includes(term) ||
        visiblePhone.toLowerCase().includes(term) ||
        agentName.includes(term)
      );
    });
  }, [leads, searchTerm, shouldMaskLeadInfo]);

  const stats = {
    totalLeads: leads.length,
    interested: leads.filter((l) => (l.status || 'interested') === 'interested').length,
    contacted: leads.filter((l) => l.status === 'contacted').length,
  };

  const formatLeadDate = (lead) => {
    try {
      if (lead.created_date) {
        return format(new Date(lead.created_date), 'MMM dd, yyyy');
      }

      if (lead.created_at?.toDate) {
        return format(lead.created_at.toDate(), 'MMM dd, yyyy');
      }

      if (lead.createdAt?.toDate) {
        return format(lead.createdAt.toDate(), 'MMM dd, yyyy');
      }

      return '—';
    } catch {
      return '—';
    }
  };

  const handleViewStudentProfile = (lead) => {
    if (subscriptionLocked) {
      setErrorText('Student profile is locked. Activate your subscription to view full lead profiles.');
      return;
    }

    const studentUid =
      lead?.student?.uid ||
      lead?.student_id ||
      lead?.student?.id ||
      '';

    if (!studentUid) return;

    navigate(`/view-profile/${studentUid}`, {
      state: {
        source: 'school_leads',
        leadId: lead?.id || '',
      },
    });
  };

  const handleViewPendingQrStudentProfile = () => {
    if (subscriptionLocked) {
      setErrorText('Student profile is locked. Activate your subscription to view full lead profiles.');
      return;
    }

    const studentUid = pendingQrLead?.studentId || '';
    if (!studentUid) return;

    navigate(`/view-profile/${studentUid}`, {
      state: {
        source: 'school_qr_preview',
      },
    });
  };

  const handleMessageLead = (lead) => {
    if (subscriptionLocked) {
      setErrorText('Messaging from leads is locked. Activate your subscription to message assigned agents.');
      return;
    }

    const agentId = getAssignedAgentId(lead);
    if (!agentId) return;

    const qs = new URLSearchParams();
    qs.set('to', agentId);
    qs.set('toRole', 'agent');

    navigate(`${createPageUrl("Messages")}?${qs.toString()}`, {
      state: {
        source: 'school_leads',
        leadId: lead.id,
        studentId: lead?.student_id || lead?.student?.id || lead?.student?.uid || '',
        agentId,
      },
    });
  };

  const handleMarkContacted = async (lead) => {
    if (subscriptionLocked) {
      setErrorText('Lead status updates are locked. Activate your subscription to manage lead status.');
      return;
    }

    if (!lead?.id) return;
    if ((lead.status || 'interested') === 'contacted') return;

    setUpdatingLeadId(lead.id);
    setErrorText('');

    const previousLeads = leads;

    try {
      setLeads((prev) =>
        prev.map((item) =>
          item.id === lead.id
            ? {
                ...item,
                status: 'contacted',
                updated_at: { toDate: () => new Date() },
              }
            : item
        )
      );

      await updateDoc(doc(db, 'school_leads', lead.id), {
        status: 'contacted',
        updated_at: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error marking lead as contacted:', error);
      setLeads(previousLeads);
      alert('Failed to update lead status to contacted.');
    } finally {
      if (isMountedRef.current) setUpdatingLeadId('');
    }
  };

  const handleDeclineQrLead = () => {
    setPendingQrLead(null);
    setPendingQrToken('');
    setQrNotice('');
    removeStudentRefFromUrl();
  };

  const handleAcceptQrLead = async () => {
    if (subscriptionLocked) {
      setErrorText('Accepting QR leads is locked. Activate your subscription to add students to your leads.');
      return;
    }

    if (!pendingQrLead?.studentId || !pendingQrToken) return;

    setActingQrLead(true);
    setErrorText('');
    setQrNotice('');

    try {
      const result = await acceptStudentQrLead(pendingQrToken);

      if (isMountedRef.current) {
        setPendingQrLead(null);
        setPendingQrToken('');
      }
      removeStudentRefFromUrl();

      if (isMountedRef.current) {
        setQrNotice(buildSchoolQrSuccessText(result));
      }

      await loadLeads();
    } catch (e) {
      console.error('Failed to accept QR lead:', e);
      if (isMountedRef.current) {
        setErrorText(e?.message || 'Failed to add student to school leads.');
      }
    } finally {
      if (isMountedRef.current) setActingQrLead(false);
    }
  };

  const handleGoToExistingLead = () => {
    setPendingQrLead(null);
    setPendingQrToken('');
    removeStudentRefFromUrl();
    setQrNotice('This student is already in your leads.');
  };

  const handleOpenScanner = () => {
    if (subscriptionLocked) {
      setErrorText('QR scanning is locked. Activate your subscription to scan and accept student QR leads.');
      return;
    }

    setScannerError('');
    setScannerSuccess('');
    setErrorText('');
    setShowScanner(true);
  };

  const handleCloseScanner = () => {
    setShowScanner(false);
    setScannerError('');
    setScannerSuccess('');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-12 h-12 animate-spin text-pink-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Users className="w-8 h-8 text-pink-700" />
            <h1 className="text-4xl font-bold text-gray-800">Student Leads</h1>
          </div>

          <Button
            onClick={handleOpenScanner}
            disabled={subscriptionLocked}
            title={subscriptionLocked ? 'Activate your subscription to scan student QR leads.' : 'Scan Student QR'}
            className="bg-pink-600 hover:bg-pink-700 w-full md:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Scan Student QR
          </Button>
        </div>

        {errorText ? (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="p-4 text-red-800 text-sm">
              {errorText}
            </CardContent>
          </Card>
        ) : null}

        {shouldMaskLeadInfo && (
          <Card className="mb-6 border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3 text-amber-900">
                <Lock className="w-5 h-5 mt-0.5" />
                <div>
                  <p className="font-semibold">Lead details are locked</p>
                  <p className="text-sm text-amber-800 mt-1">
                    Subscription mode is enabled. Activate your subscription to view full student
                    name, email, phone number, profiles, QR lead actions, messaging, and lead status updates.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 bg-amber-700 hover:bg-amber-800"
                    onClick={handleGoToSubscription}
                  >
                    Go to Payment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!!scannerError && !showScanner && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="p-4 text-red-800 text-sm">
              {scannerError}
            </CardContent>
          </Card>
        )}

        {!!scannerSuccess && !showScanner && (
          <Card className="mb-6 border-green-200 bg-green-50">
            <CardContent className="p-4 text-green-800 text-sm">
              {scannerSuccess}
            </CardContent>
          </Card>
        )}

        {(resolvingQrLead || pendingQrLead || qrNotice) && (
          <Card className="mb-6 border-pink-200 bg-pink-50">
            <CardContent className="p-5">
              {resolvingQrLead ? (
                <div className="flex items-center gap-3 text-pink-900">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <div>
                    <p className="font-semibold">Resolving student QR</p>
                    <p className="text-sm text-pink-800 mt-1">
                      Please wait while we load the student details.
                    </p>
                  </div>
                </div>
              ) : pendingQrLead ? (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-pink-100 flex items-center justify-center shrink-0">
                      <QrCode className="w-5 h-5 text-pink-700" />
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {pendingQrLead.alreadyExists
                          ? `${pendingQrLead.full_name || 'This student'} is already in your leads`
                          : `Add ${pendingQrLead.full_name || 'this student'} to your leads?`}
                      </h3>

                      <p className="text-sm text-gray-600 mt-1">
                        {pendingQrLead.alreadyExists
                          ? 'This student has already been linked to your school lead list.'
                          : 'This student shared their QR code with your school.'}
                      </p>

                      <div className="mt-3 space-y-1 text-sm text-gray-700">
                        <div>
                          <span className="font-medium">Student:</span>{' '}
                          {pendingQrLead.full_name || '—'}
                        </div>
                        {pendingQrLead.email ? (
                          <div>
                            <span className="font-medium">Email:</span> {pendingQrLead.email}
                          </div>
                        ) : null}
                        {pendingQrLead.phone ? (
                          <div>
                            <span className="font-medium">Phone:</span> {pendingQrLead.phone}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={handleViewPendingQrStudentProfile}
                      disabled={!pendingQrLead?.studentId || actingQrLead || subscriptionLocked}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Profile
                    </Button>

                    <Button
                      variant="outline"
                      onClick={handleDeclineQrLead}
                      disabled={actingQrLead}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {pendingQrLead.alreadyExists ? 'Close' : 'Decline'}
                    </Button>

                    {pendingQrLead.alreadyExists ? (
                      <Button
                        onClick={handleGoToExistingLead}
                        className="bg-pink-600 hover:bg-pink-700"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Go to Leads
                      </Button>
                    ) : (
                      <Button
                        onClick={handleAcceptQrLead}
                        disabled={actingQrLead || subscriptionLocked}
                        className="bg-pink-600 hover:bg-pink-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {actingQrLead ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-2" />
                        )}
                        Accept
                      </Button>
                    )}
                  </div>
                </div>
              ) : qrNotice ? (
                <div className="flex items-start gap-3 text-pink-900">
                  <CheckCircle className="w-5 h-5 mt-0.5" />
                  <div>
                    <p className="font-semibold">QR action completed</p>
                    <p className="text-sm text-pink-800 mt-1">{qrNotice}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Total Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-pink-600">{stats.totalLeads}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Interested</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-pink-500">{stats.interested}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.contacted}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder={
                  shouldMaskLeadInfo
                    ? "Search visible masked lead info..."
                    : "Search by student name, email, phone, or assigned agent..."
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Lead Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredLeads.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Assigned Agent</TableHead>
                    <TableHead>Date Interested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLeads.map((lead) => {
                    const rawName = lead.student?.full_name || lead.student_name || 'Unnamed Student';
                    const rawEmail = lead.student?.email || lead.student_email || '—';
                    const rawPhone = lead.student?.phone || lead.student_phone || '';
                    const displayAgentName = getAssignedAgentName(lead);
                    const assignedAgentId = getAssignedAgentId(lead);

                    const displayName = shouldMaskLeadInfo ? maskName(rawName) : rawName;
                    const displayEmail = shouldMaskLeadInfo ? maskEmail(rawEmail) : rawEmail;
                    const displayPhone = shouldMaskLeadInfo ? maskPhone(rawPhone) : rawPhone;
                    const isContacted = (lead.status || 'interested') === 'contacted';
                    const isUpdating = updatingLeadId === lead.id;

                    return (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{displayName}</p>

                            <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                              <Mail className="w-3 h-3" />
                              {displayEmail}
                            </div>

                            {rawPhone && (
                              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                                <Phone className="w-3 h-3" />
                                {displayPhone}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="font-medium text-gray-800">
                            {displayAgentName}
                          </div>
                        </TableCell>

                        <TableCell>{formatLeadDate(lead)}</TableCell>

                        <TableCell>
                          <StatusBadge status={lead.status || 'interested'} />
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleViewStudentProfile(lead)}
                              disabled={subscriptionLocked || !(lead?.student?.uid || lead?.student_id || lead?.student?.id)}
                              title={subscriptionLocked ? 'Activate your subscription to view student profiles.' : 'View student profile'}
                            >
                              <Eye className="w-4 h-4" />
                              View Profile
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleMessageLead(lead)}
                              disabled={subscriptionLocked || !assignedAgentId}
                              title={subscriptionLocked ? 'Activate your subscription to message assigned agents.' : (!assignedAgentId ? 'No assigned agent found for this student.' : 'Message assigned agent')}
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message Agent
                            </Button>

                            <Button
                              variant={isContacted ? "secondary" : "default"}
                              size="sm"
                              className="gap-2"
                              onClick={() => handleMarkContacted(lead)}
                              disabled={subscriptionLocked || isContacted || isUpdating}
                              title={subscriptionLocked ? 'Activate your subscription to update lead status.' : undefined}
                            >
                              {isUpdating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                              {isContacted ? 'Contacted' : 'Mark Contacted'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12">
                <Info className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Leads Found</h3>
                <p className="text-gray-600">
                  When students click Interested on your school profile, they will appear here.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <ScannerModal
          open={showScanner}
          onClose={handleCloseScanner}
          onSubmitToken={handleSchoolQrSubmit}
          busy={scannerBusy}
          errorText={scannerError}
          successText={scannerSuccess}
        />
      </div>
    </div>
  );
}