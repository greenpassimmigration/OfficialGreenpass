import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_BASE ||
  "https://us-central1-greenpass-dc92d.cloudfunctions.net";

const QR_READER_ID = 'school-student-qr-reader';

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

function isSubInactiveForRole(userDoc) {
  const role = resolveUserRole(userDoc);
  if (!(role === 'agent' || role === 'tutor' || role === 'school')) return false;

  if (userDoc?.subscription_active === true) return false;
  const s = String(userDoc?.subscription_status || '').toLowerCase().trim();
  return !(s === 'active' || s === 'trialing');
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

function removeStudentRefFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('student_ref');
    window.history.replaceState({}, '', url.toString());
  } catch {}
}

function extractStudentTokenFromScan(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    return (
      url.searchParams.get('student_ref') ||
      url.searchParams.get('ref') ||
      text
    );
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

  const response = await fetch(
    `${FUNCTIONS_BASE.replace(/\/+$/, '')}/resolveStudentReferralToken?student_ref=${encodeURIComponent(token)}`,
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

  const response = await fetch(
    `${FUNCTIONS_BASE.replace(/\/+$/, '')}/acceptStudentReferralToSchool`,
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
  const [scannerError, setScannerError] = useState('');
  const [scannerLoading, setScannerLoading] = useState(false);

  const scannerRef = useRef(null);
  const scannerStartingRef = useRef(false);

  const shouldMaskLeadInfo =
    subscriptionModeEnabled && isSubInactiveForRole(meDoc);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const fbUser = auth.currentUser;

      if (!fbUser?.uid) {
        setLeads([]);
        setMeDoc(null);
        return;
      }

      try {
        const meSnap = await getDoc(doc(db, 'users', fbUser.uid));
        setMeDoc(meSnap.exists() ? meSnap.data() : null);
      } catch (e) {
        console.error('Error loading current user doc:', e);
        setMeDoc(null);
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
        setLeads([]);
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

      setLeads(combinedLeads);
    } catch (error) {
      console.error('Error loading school leads:', error);
      setLeads([]);
      setErrorText(error?.message || 'Failed to load school leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;

    if (!scanner) return;

    try {
      const state = scanner.getState?.();
      if (state === 2 || state === 3) {
        await scanner.stop();
      }
    } catch (e) {
      console.warn('Scanner stop warning:', e);
    }

    try {
      await scanner.clear();
    } catch (e) {
      console.warn('Scanner clear warning:', e);
    }
  }, []);

  const resolveTokenIntoPendingLead = useCallback(async (token) => {
    const fbUser = auth.currentUser;
    if (!fbUser?.uid) return;

    setResolvingQrLead(true);
    setQrNotice('');
    setErrorText('');
    setPendingQrToken(token);

    try {
      const meSnap = await getDoc(doc(db, 'users', fbUser.uid));
      const currentMeDoc = meSnap.exists() ? meSnap.data() : null;
      setMeDoc(currentMeDoc);

      const role = resolveUserRole(currentMeDoc);
      if (role !== 'school') {
        setQrNotice('Only school accounts can accept student QR codes.');
        setPendingQrLead(null);
        return;
      }

      const resolved = await resolveStudentQrToken(token);

      setPendingQrLead({
        ...resolved,
        alreadyExists: false,
      });
    } catch (e) {
      console.error('Failed to resolve student QR:', e);
      setPendingQrLead(null);
      setErrorText(e?.message || 'Failed to resolve student QR.');
    } finally {
      setResolvingQrLead(false);
    }
  }, []);

  const resolvePendingQrLead = useCallback(async () => {
    const fbUser = auth.currentUser;
    if (!fbUser?.uid) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('student_ref');
    if (!token) return;

    await resolveTokenIntoPendingLead(token);
  }, [resolveTokenIntoPendingLead]);

  const startQrScanner = useCallback(async () => {
    if (scannerStartingRef.current) return;

    setScannerError('');
    setScannerLoading(true);
    scannerStartingRef.current = true;

    try {
      const hasCamera =
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function';

      if (!hasCamera) {
        throw new Error('Camera is not supported on this browser/device.');
      }

      await stopScanner();

      const qrScanner = new Html5Qrcode(QR_READER_ID);
      scannerRef.current = qrScanner;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        rememberLastUsedCamera: true,
      };

      const onScanSuccess = async (decodedText) => {
        const token = extractStudentTokenFromScan(decodedText);
        if (!token) return;

        try {
          await stopScanner();
          setShowScanner(false);
          await resolveTokenIntoPendingLead(token);
        } catch (e) {
          console.error('QR scan resolve failed:', e);
          setErrorText(e?.message || 'Failed to resolve scanned QR.');
        }
      };

      try {
        await qrScanner.start(
          { facingMode: { exact: 'environment' } },
          config,
          onScanSuccess,
          () => {}
        );
      } catch (envErr) {
        console.warn('Environment camera failed, trying user camera:', envErr);

        try {
          await qrScanner.start(
            { facingMode: 'user' },
            config,
            onScanSuccess,
            () => {}
          );
        } catch (userErr) {
          console.warn('User camera failed, trying first available camera:', userErr);

          const cameras = await Html5Qrcode.getCameras();
          if (!cameras || !cameras.length) {
            throw new Error('No camera found on this device.');
          }

          await qrScanner.start(
            cameras[0].id,
            config,
            onScanSuccess,
            () => {}
          );
        }
      }
    } catch (e) {
      console.error('QR scanner start failed:', e);

      const msg = String(e?.message || '');
      if (
        msg.includes('NotReadableError') ||
        msg.includes('Could not start video source')
      ) {
        setScannerError(
          'Camera is being used by another app like Discord, Zoom, or another browser tab. Please close it and try again.'
        );
      } else {
        setScannerError(msg || 'Unable to start QR scanner.');
      }
    } finally {
      setScannerLoading(false);
      scannerStartingRef.current = false;
    }
  }, [resolveTokenIntoPendingLead, stopScanner]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    resolvePendingQrLead();
  }, [resolvePendingQrLead]);

  useEffect(() => {
    if (!showScanner) {
      stopScanner();
      return;
    }

    const timer = window.setTimeout(() => {
      startQrScanner();
    }, 120);

    return () => {
      window.clearTimeout(timer);
      stopScanner();
    };
  }, [showScanner, startQrScanner, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const filteredLeads = leads.filter((lead) => {
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
    const studentUid = pendingQrLead?.studentId || '';
    if (!studentUid) return;

    navigate(`/view-profile/${studentUid}`, {
      state: {
        source: 'school_qr_preview',
      },
    });
  };

  const handleMessageLead = (lead) => {
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
      setUpdatingLeadId('');
    }
  };

  const handleDeclineQrLead = () => {
    setPendingQrLead(null);
    setPendingQrToken('');
    setQrNotice('');
    removeStudentRefFromUrl();
  };

  const handleAcceptQrLead = async () => {
    if (!pendingQrLead?.studentId || !pendingQrToken) return;

    setActingQrLead(true);
    setErrorText('');
    setQrNotice('');

    try {
      const result = await acceptStudentQrLead(pendingQrToken);

      setPendingQrLead(null);
      setPendingQrToken('');
      removeStudentRefFromUrl();

      if (result?.alreadyExists) {
        setQrNotice('This student is already in your leads.');
      } else {
        setQrNotice('Student added to your leads.');
      }

      await loadLeads();
    } catch (e) {
      console.error('Failed to accept QR lead:', e);
      setErrorText(e?.message || 'Failed to add student to school leads.');
    } finally {
      setActingQrLead(false);
    }
  };

  const handleGoToExistingLead = () => {
    setPendingQrLead(null);
    setPendingQrToken('');
    removeStudentRefFromUrl();
    setQrNotice('This student is already in your leads.');
  };

  const handleOpenScanner = () => {
    setScannerError('');
    setErrorText('');
    setShowScanner(true);
  };

  const handleCloseScanner = async () => {
    setShowScanner(false);
    setScannerError('');
    await stopScanner();
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
            className="bg-pink-600 hover:bg-pink-700 w-full md:w-auto"
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
                    name, email, and phone number.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {showScanner && (
          <Card className="mb-6 border-pink-200 shadow-md">
            <CardContent className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Scan Student QR</h3>
                  <p className="text-sm text-gray-600">
                    Point your camera at the student QR code to load their details.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={startQrScanner}
                    disabled={scannerLoading}
                  >
                    {scannerLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4 mr-2" />
                    )}
                    Restart Scanner
                  </Button>

                  <Button variant="outline" onClick={handleCloseScanner}>
                    Close
                  </Button>
                </div>
              </div>

              {scannerError ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {scannerError}
                </div>
              ) : null}

              <div className="rounded-2xl border border-pink-100 bg-white p-4">
                <div
                  id={QR_READER_ID}
                  className="w-full max-w-md mx-auto overflow-hidden rounded-xl"
                />
              </div>

              <p className="text-xs text-gray-500 mt-3 text-center">
                On mobile, allow camera access when prompted.
              </p>
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
                      disabled={!pendingQrLead?.studentId || actingQrLead}
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
                        disabled={actingQrLead}
                        className="bg-pink-600 hover:bg-pink-700"
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
                              disabled={!(lead?.student?.uid || lead?.student_id || lead?.student?.id)}
                              title="View student profile"
                            >
                              <Eye className="w-4 h-4" />
                              View Profile
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleMessageLead(lead)}
                              disabled={!assignedAgentId}
                              title={!assignedAgentId ? 'No assigned agent found for this student.' : 'Message assigned agent'}
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message Agent
                            </Button>

                            <Button
                              variant={isContacted ? "secondary" : "default"}
                              size="sm"
                              className="gap-2"
                              onClick={() => handleMarkContacted(lead)}
                              disabled={isContacted || isUpdating}
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
      </div>
    </div>
  );
}