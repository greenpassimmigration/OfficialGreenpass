import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Lock,
  NotebookPen,
  Plus,
  Users,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { auth, db } from "@/firebase";
import { createPageUrl } from "@/utils";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTr } from "@/i18n/useTr";

const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  booked: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-blue-100 text-blue-800 border-blue-200",
  cancelled: "bg-red-100 text-red-800 border-red-200",
  rescheduled: "bg-purple-100 text-purple-800 border-purple-200",
  blocked: "bg-gray-200 text-gray-800 border-gray-300",
  note: "bg-slate-100 text-slate-800 border-slate-200",
};

function toDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (typeof value === "string") return parseISO(value);
  return new Date(value);
}

function formatDateTimeLocal(date) {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
}

function startOfGrid(date) {
  return startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
}

function endOfGrid(date) {
  return endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
}

function getWeekDates(baseDate) {
  const start = startOfWeek(baseDate, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function EventChip({ event, onClick }) {
  const cls = STATUS_STYLES[event.status] || STATUS_STYLES.note;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      className={`w-full text-left rounded-md border px-2 py-1 text-[11px] sm:text-xs mb-1 hover:opacity-90 ${cls}`}
    >
      <div className="font-medium truncate">{event.title}</div>
      <div className="truncate opacity-80">
        {format(event.start, "p")} - {format(event.end, "p")}
      </div>
    </button>
  );
}

function SummaryCard({ title, value, icon: Icon, subtitle }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-gray-500">{title}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
            {subtitle ? <div className="mt-1 text-xs text-gray-500">{subtitle}</div> : null}
          </div>
          <div className="rounded-xl bg-gray-100 p-2">
            <Icon className="h-5 w-5 text-gray-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AvailabilityDialog({ open, setOpen, availability, onSave, tr }) {
  const [timezone, setTimezone] = useState("America/Toronto");
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [minBookingNoticeHours, setMinBookingNoticeHours] = useState(12);
  const [maxAdvanceBookingDays, setMaxAdvanceBookingDays] = useState(30);
  const [weeklyAvailability, setWeeklyAvailability] = useState({
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
    saturday: [],
    sunday: [],
  });

  useEffect(() => {
    if (!availability) return;
    setTimezone(availability.timezone || "America/Toronto");
    setBufferMinutes(availability.bufferMinutes ?? 15);
    setMinBookingNoticeHours(availability.minBookingNoticeHours ?? 12);
    setMaxAdvanceBookingDays(availability.maxAdvanceBookingDays ?? 30);
    setWeeklyAvailability(
      availability.weeklyAvailability || {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      }
    );
  }, [availability]);

  const updateSlot = (day, idx, field, value) => {
    setWeeklyAvailability((prev) => {
      const next = { ...prev, [day]: [...(prev[day] || [])] };
      next[day][idx] = { ...next[day][idx], [field]: value };
      return next;
    });
  };

  const addSlot = (day) => {
    setWeeklyAvailability((prev) => ({
      ...prev,
      [day]: [...(prev[day] || []), { start: "09:00", end: "17:00" }],
    }));
  };

  const removeSlot = (day, idx) => {
    setWeeklyAvailability((prev) => ({
      ...prev,
      [day]: (prev[day] || []).filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async () => {
    await onSave({
      timezone,
      bufferMinutes: Number(bufferMinutes || 0),
      minBookingNoticeHours: Number(minBookingNoticeHours || 0),
      maxAdvanceBookingDays: Number(maxAdvanceBookingDays || 30),
      sessionDurations: [30, 60, 90],
      weeklyAvailability,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{tr("tutorPlanner.setAvailability", "Set Availability")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div>
              <Label>Buffer (minutes)</Label>
              <Input type="number" value={bufferMinutes} onChange={(e) => setBufferMinutes(e.target.value)} />
            </div>
            <div>
              <Label>Min notice (hours)</Label>
              <Input
                type="number"
                value={minBookingNoticeHours}
                onChange={(e) => setMinBookingNoticeHours(e.target.value)}
              />
            </div>
            <div>
              <Label>Max advance (days)</Label>
              <Input
                type="number"
                value={maxAdvanceBookingDays}
                onChange={(e) => setMaxAdvanceBookingDays(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="rounded-xl border p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-medium capitalize">{day}</div>
                  <Button type="button" variant="outline" size="sm" onClick={() => addSlot(day)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Slot
                  </Button>
                </div>

                {(weeklyAvailability[day] || []).length === 0 ? (
                  <div className="text-sm text-gray-500">No availability</div>
                ) : (
                  <div className="space-y-2">
                    {(weeklyAvailability[day] || []).map((slot, idx) => (
                      <div key={`${day}-${idx}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <Label>Start</Label>
                          <Input
                            type="time"
                            value={slot.start || ""}
                            onChange={(e) => updateSlot(day, idx, "start", e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>End</Label>
                          <Input
                            type="time"
                            value={slot.end || ""}
                            onChange={(e) => updateSlot(day, idx, "end", e.target.value)}
                          />
                        </div>
                        <Button type="button" variant="destructive" size="sm" onClick={() => removeSlot(day, idx)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("tutorPlanner.cancel", "Cancel")}
            </Button>
            <Button onClick={handleSave}>{tr("tutorPlanner.save", "Save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BlockTimeDialog({ open, setOpen, onSave, defaultDate }) {
  const [title, setTitle] = useState("Unavailable");
  const [reason, setReason] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (open && defaultDate) {
      const startDate = new Date(defaultDate);
      startDate.setHours(9, 0, 0, 0);

      const endDate = new Date(defaultDate);
      endDate.setHours(10, 0, 0, 0);

      setTitle("Unavailable");
      setReason("");
      setStart(formatDateTimeLocal(startDate));
      setEnd(formatDateTimeLocal(endDate));
      return;
    }

    if (!open) {
      setTitle("Unavailable");
      setReason("");
      setStart("");
      setEnd("");
    }
  }, [open, defaultDate]);

  const handleSave = async () => {
    if (!start || !end) return;
    await onSave({
      title: title || "Unavailable",
      reason,
      start: Timestamp.fromDate(new Date(start)),
      end: Timestamp.fromDate(new Date(end)),
      allDay: false,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Block Time</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div>
            <Label>Start</Label>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>End</Label>
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ open, setOpen, onSave, defaultDate }) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (open && defaultDate) {
      const startDate = new Date(defaultDate);
      startDate.setHours(9, 0, 0, 0);

      const endDate = new Date(defaultDate);
      endDate.setHours(10, 0, 0, 0);

      setTitle("");
      setNotes("");
      setStart(formatDateTimeLocal(startDate));
      setEnd(formatDateTimeLocal(endDate));
      return;
    }

    if (!open) {
      setTitle("");
      setNotes("");
      setStart("");
      setEnd("");
    }
  }, [open, defaultDate]);

  const handleSave = async () => {
    if (!title || !start || !end) return;
    await onSave({
      title,
      notes,
      start: Timestamp.fromDate(new Date(start)),
      end: Timestamp.fromDate(new Date(end)),
      allDay: false,
      type: "note",
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <Label>Start</Label>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>End</Label>
            <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateSessionDialog({ open, setOpen, onSave, defaultDate, tr }) {
  const [title, setTitle] = useState("");
  const [studentName, setStudentName] = useState("");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [status, setStatus] = useState("booked");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (open && defaultDate) {
      const startDate = new Date(defaultDate);
      startDate.setHours(9, 0, 0, 0);

      const endDate = new Date(defaultDate);
      endDate.setHours(10, 0, 0, 0);

      setTitle("");
      setStudentName("");
      setSubject("");
      setNotes("");
      setMeetingLink("");
      setPaymentStatus("pending");
      setStatus("booked");
      setStart(formatDateTimeLocal(startDate));
      setEnd(formatDateTimeLocal(endDate));
      return;
    }

    if (!open) {
      setTitle("");
      setStudentName("");
      setSubject("");
      setNotes("");
      setMeetingLink("");
      setPaymentStatus("pending");
      setStatus("booked");
      setStart("");
      setEnd("");
    }
  }, [open, defaultDate]);

  const handleSave = async () => {
    if (!studentName || !subject || !start || !end) return;

    await onSave({
      title: title || `${subject} Session`,
      studentName,
      subject,
      notes,
      meetingLink,
      paymentStatus,
      status,
      start: Timestamp.fromDate(new Date(start)),
      end: Timestamp.fromDate(new Date(end)),
    });

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tr("tutorPlanner.createSession", "Create Session")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>{tr("tutorPlanner.sessionTitle", "Session Title")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="IELTS Writing Session"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>{tr("tutorPlanner.studentName", "Student Name")}</Label>
              <Input
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="John Doe"
              />
            </div>
            <div>
              <Label>{tr("tutorPlanner.subject", "Subject")}</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="IELTS Writing"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
                <Label>{tr("tutorPlanner.status", "Status")}</Label>
                <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="booked">Booked</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="rescheduled">Rescheduled</SelectItem>
                </SelectContent>
                </Select>
            </div>

            <div>
                <Label>{tr("tutorPlanner.paymentStatus", "Payment Status")}</Label>
                <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger>
                    <SelectValue placeholder="Select payment status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
                </Select>
            </div>
            </div>

          <div>
            <Label>{tr("tutorPlanner.meetingLink", "Meeting Link")}</Label>
            <Input
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder="https://meet.google.com/..."
            />
          </div>

          <div>
            <Label>{tr("tutorPlanner.notes", "Notes")}</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Session notes..."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("tutorPlanner.cancel", "Cancel")}
            </Button>
            <Button onClick={handleSave}>{tr("tutorPlanner.save", "Save")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionDetailsDialog({ open, setOpen, event }) {
  if (!event) return null;

  const cls = STATUS_STYLES[event.status] || STATUS_STYLES.note;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Badge className={cls}>{event.status || event.type}</Badge>

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500">Start</div>
              <div className="font-medium">{format(event.start, "PPP p")}</div>
            </div>
            <div>
              <div className="text-gray-500">End</div>
              <div className="font-medium">{format(event.end, "PPP p")}</div>
            </div>
            {event.studentName ? (
              <div>
                <div className="text-gray-500">Student</div>
                <div className="font-medium">{event.studentName}</div>
              </div>
            ) : null}
            {event.subject ? (
              <div>
                <div className="text-gray-500">Subject</div>
                <div className="font-medium">{event.subject}</div>
              </div>
            ) : null}
            {event.paymentStatus ? (
              <div>
                <div className="text-gray-500">Payment</div>
                <div className="font-medium capitalize">{event.paymentStatus}</div>
              </div>
            ) : null}
          </div>

          {event.notes ? (
            <div>
              <div className="text-sm text-gray-500 mb-1">Notes</div>
              <div className="rounded-xl bg-gray-50 border p-3 text-sm">{event.notes}</div>
            </div>
          ) : null}

          {event.reason ? (
            <div>
              <div className="text-sm text-gray-500 mb-1">Reason</div>
              <div className="rounded-xl bg-gray-50 border p-3 text-sm">{event.reason}</div>
            </div>
          ) : null}

          {event.meetingLink ? (
            <a
              href={event.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-medium text-green-700 hover:underline"
            >
              Open meeting link
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DateActionDialog({
  open,
  setOpen,
  selectedDate,
  onAddNote,
  onBlockTime,
  onCreateSession,
  onViewDay,
}) {
  if (!selectedDate) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Manage {format(selectedDate, "EEEE, MMMM d, yyyy")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <Button
            variant="outline"
            onClick={() => {
              onViewDay();
              setOpen(false);
            }}
          >
            View Day
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              onCreateSession();
              setOpen(false);
            }}
          >
            Create Session
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              onAddNote();
              setOpen(false);
            }}
          >
            Add Note
          </Button>

          <Button
            onClick={() => {
              onBlockTime();
              setOpen(false);
            }}
          >
            Block Time
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


const SUBSCRIPTION_REQUIRED_ROLES = new Set(["agent", "school", "tutor"]);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid", "subscribed"]);
const INACTIVE_SUBSCRIPTION_STATUSES = new Set(["", "none", "skipped", "inactive", "incomplete", "incomplete_expired", "past_due", "unpaid", "canceled", "cancelled", "expired"]);

function normalizeRole(value) {
  const role = String(value || "").toLowerCase().trim();
  if (!role || role === "user" || role === "member" || role === "students") return "student";
  if (role === "agents") return "agent";
  if (role === "schools") return "school";
  if (role === "tutors") return "tutor";
  return role;
}

function resolveUserRole(userDoc, fallback = "student") {
  return normalizeRole(userDoc?.role || userDoc?.selected_role || userDoc?.user_type || userDoc?.userType || userDoc?.signup_entry_role || fallback);
}

function hasActiveSubscription(userDoc) {
  if (!userDoc) return false;
  const status = String(userDoc?.subscription_status || userDoc?.subscriptionStatus || "").toLowerCase().trim();
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true;
  if ((userDoc?.subscription_active === true || userDoc?.subscriptionActive === true) && !INACTIVE_SUBSCRIPTION_STATUSES.has(status)) return true;
  return false;
}

function isSubscriptionLockedForRole(userDoc, subscriptionModeEnabled, expectedRole) {
  if (!subscriptionModeEnabled) return false;
  const role = resolveUserRole(userDoc, expectedRole);
  const finalRole = SUBSCRIPTION_REQUIRED_ROLES.has(role) ? role : expectedRole;
  if (!SUBSCRIPTION_REQUIRED_ROLES.has(finalRole)) return false;
  return !hasActiveSubscription(userDoc);
}

function buildSubscriptionCheckoutUrl(userDoc, expectedRole, fallbackPath) {
  const roleFromDoc = resolveUserRole(userDoc, expectedRole);
  const role = SUBSCRIPTION_REQUIRED_ROLES.has(roleFromDoc) ? roleFromDoc : expectedRole;
  const existingPlan = String(userDoc?.subscription_plan || userDoc?.subscriptionPlan || "").trim();
  const plan = existingPlan || `${role}_monthly`;
  const query = new URLSearchParams({ type: "subscription", role, plan, lock: "1", returnTo: fallbackPath || window.location.pathname || "/dashboard" });
  return `${createPageUrl("Checkout")}?${query.toString()}`;
}

export default function TutorPlanner() {
  const { tr } = useTr();
  const currentUser = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("week");
  const [currentDate, setCurrentDate] = useState(new Date());

  const [availability, setAvailability] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [notes, setNotes] = useState([]);

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [blockTimeOpen, setBlockTimeOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [dateActionOpen, setDateActionOpen] = useState(false);
  const [meDoc, setMeDoc] = useState(null);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    const load = async () => {
      if (!currentUser?.uid) return;
      setLoading(true);

      try {
        const availabilityRef = doc(db, "tutor_availability", currentUser.uid);
        const availabilitySnap = await getDoc(availabilityRef);
        setAvailability(availabilitySnap.exists() ? availabilitySnap.data() : null);

        const sessionsQ = query(
          collection(db, "tutoring_sessions"),
          where("tutorId", "==", currentUser.uid),
          orderBy("start", "asc")
        );

        const blockedQ = query(
          collection(db, "tutor_blocked_times"),
          where("tutorId", "==", currentUser.uid),
          orderBy("start", "asc")
        );

        const notesQ = query(
          collection(db, "tutor_planner_notes"),
          where("tutorId", "==", currentUser.uid),
          orderBy("start", "asc")
        );

        const [sessionsSnap, blockedSnap, notesSnap] = await Promise.all([
          getDocs(sessionsQ),
          getDocs(blockedQ),
          getDocs(notesQ),
        ]);

        setSessions(sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setBlockedTimes(blockedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setNotes(notesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("[TutorPlanner] failed to load:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [currentUser?.uid]);

  const calendarEvents = useMemo(() => {
    const sessionEvents = sessions.map((item) => ({
      id: item.id,
      type: "session",
      title: item.title || item.subject || "Tutoring Session",
      start: toDate(item.start),
      end: toDate(item.end),
      status: item.status || "booked",
      studentName: item.studentName || "",
      subject: item.subject || "",
      notes: item.notes || "",
      paymentStatus: item.paymentStatus || "",
      meetingLink: item.meetingLink || "",
      raw: item,
    }));

    const blockedEvents = blockedTimes.map((item) => ({
      id: item.id,
      type: "blocked",
      title: item.title || "Blocked Time",
      start: toDate(item.start),
      end: toDate(item.end),
      status: "blocked",
      reason: item.reason || "",
      raw: item,
    }));

    const noteEvents = notes.map((item) => ({
      id: item.id,
      type: "note",
      title: item.title || "Note",
      start: toDate(item.start),
      end: toDate(item.end),
      status: "note",
      notes: item.notes || "",
      raw: item,
    }));

    return [...sessionEvents, ...blockedEvents, ...noteEvents]
      .filter((e) => e.start && e.end)
      .sort((a, b) => a.start - b.start);
  }, [sessions, blockedTimes, notes]);

  const todayEvents = useMemo(
    () => calendarEvents.filter((e) => isSameDay(e.start, new Date())),
    [calendarEvents]
  );

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const weekEvents = useMemo(
    () =>
      calendarEvents.filter((e) =>
        weekDates.some((d) => isSameDay(d, e.start))
      ),
    [calendarEvents, weekDates]
  );

  const upcomingEvents = useMemo(
    () => calendarEvents.filter((e) => e.start >= new Date()).slice(0, 5),
    [calendarEvents]
  );

  const bookedHoursThisWeek = useMemo(() => {
    return weekEvents
      .filter((e) => e.type === "session" && e.status !== "cancelled")
      .reduce((sum, e) => sum + (e.end - e.start) / (1000 * 60 * 60), 0);
  }, [weekEvents]);

  const availableHoursThisWeek = useMemo(() => {
    if (!availability?.weeklyAvailability) return 0;
    return WEEK_DAYS.reduce((sum, day) => {
      return (
        sum +
        (availability.weeklyAvailability[day] || []).reduce((acc, slot) => {
          if (!slot.start || !slot.end) return acc;
          const [sh, sm] = slot.start.split(":").map(Number);
          const [eh, em] = slot.end.split(":").map(Number);
          const mins = eh * 60 + em - (sh * 60 + sm);
          return acc + Math.max(0, mins / 60);
        }, 0)
      );
    }, 0);
  }, [availability]);

  const subscriptionLocked = useMemo(
    () => isSubscriptionLockedForRole(meDoc, subscriptionModeEnabled, "tutor"),
    [meDoc, subscriptionModeEnabled]
  );

  const subscriptionCheckoutUrl = useMemo(() => {
    const currentPath = `${window.location.pathname}${window.location.search || ""}`;
    return buildSubscriptionCheckoutUrl(meDoc, "tutor", currentPath);
  }, [meDoc]);

  const goToSubscription = () => navigate(subscriptionCheckoutUrl);

  const requireSubscription = (message = "Tutor Planner is locked. Activate your tutor subscription to continue.") => {
    if (!subscriptionLocked) return false;
    setErrorText(message);
    return true;
  };

  const handlePrev = () => {
    if (view === "month") setCurrentDate((d) => subMonths(d, 1));
    else setCurrentDate((d) => subWeeks(d, 1));
  };

  const handleNext = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else setCurrentDate((d) => addWeeks(d, 1));
  };

  const handleDateClick = (date) => {
    if (requireSubscription("Calendar actions are locked. Activate your tutor subscription to manage planner items.")) return;
    setSelectedDate(date);
    setCurrentDate(date);
    setDateActionOpen(true);
  };

  const handleSaveAvailability = async (payload) => {
    if (requireSubscription("Availability settings are locked. Activate your tutor subscription to save changes.")) return;
    if (!currentUser?.uid) return;

    const ref = doc(db, "tutor_availability", currentUser.uid);
    await setDoc(
      ref,
      {
        tutorId: currentUser.uid,
        ...payload,
        updatedAt: serverTimestamp(),
        createdAt: availability?.createdAt || serverTimestamp(),
      },
      { merge: true }
    );

    const snap = await getDoc(ref);
    setAvailability(snap.data());
  };

  const handleSaveBlockedTime = async (payload) => {
    if (requireSubscription("Blocked time is locked. Activate your tutor subscription to save changes.")) return;
    if (!currentUser?.uid) return;

    await addDoc(collection(db, "tutor_blocked_times"), {
      tutorId: currentUser.uid,
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const fresh = await getDocs(
      query(
        collection(db, "tutor_blocked_times"),
        where("tutorId", "==", currentUser.uid),
        orderBy("start", "asc")
      )
    );

    setBlockedTimes(fresh.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const handleSaveNote = async (payload) => {
    if (requireSubscription("Planner notes are locked. Activate your tutor subscription to save notes.")) return;
    if (!currentUser?.uid) return;

    await addDoc(collection(db, "tutor_planner_notes"), {
      tutorId: currentUser.uid,
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const fresh = await getDocs(
      query(
        collection(db, "tutor_planner_notes"),
        where("tutorId", "==", currentUser.uid),
        orderBy("start", "asc")
      )
    );

    setNotes(fresh.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const handleSaveSession = async (payload) => {
    if (requireSubscription("Session creation is locked. Activate your tutor subscription to create sessions.")) return;
    if (!currentUser?.uid) return;

    await addDoc(collection(db, "tutoring_sessions"), {
      tutorId: currentUser.uid,
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const fresh = await getDocs(
      query(
        collection(db, "tutoring_sessions"),
        where("tutorId", "==", currentUser.uid),
        orderBy("start", "asc")
      )
    );

    setSessions(fresh.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const openEvent = (event) => {
    setSelectedEvent(event);
    setDetailsOpen(true);
  };

  const handleOpenNoteForDate = () => {
    if (requireSubscription()) return;
    setNoteOpen(true);
  };

  const handleOpenBlockForDate = () => {
    if (requireSubscription()) return;
    setBlockTimeOpen(true);
  };

  const handleOpenCreateSessionForDate = () => {
    if (requireSubscription()) return;
    setCreateSessionOpen(true);
  };

  const handleViewDayFromDate = () => {
    if (selectedDate) {
      setCurrentDate(selectedDate);
      setView("day");
    }
  };

  const renderMonthView = () => {
    const start = startOfGrid(currentDate);
    const end = endOfGrid(currentDate);
    const days = [];
    let cursor = start;

    while (cursor <= end) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return (
      <div className="grid grid-cols-7 border rounded-2xl overflow-hidden bg-white">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
            {d}
          </div>
        ))}

        {days.map((day) => {
          const dayEvents = calendarEvents.filter((e) => isSameDay(e.start, day));

          return (
            <div
              key={day.toISOString()}
              onClick={() => handleDateClick(day)}
              className={`min-h-[140px] border-b border-r p-2 align-top cursor-pointer transition hover:bg-green-50 ${
                isSameMonth(day, currentDate) ? "bg-white" : "bg-gray-50/60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`text-sm font-medium ${
                    isToday(day)
                      ? "rounded-full bg-green-600 text-white px-2 py-0.5"
                      : "text-gray-700"
                  }`}
                >
                  {format(day, "d")}
                </div>
              </div>

              <div>
                {dayEvents.slice(0, 3).map((event) => (
                  <EventChip key={`${event.type}-${event.id}`} event={event} onClick={openEvent} />
                ))}
                {dayEvents.length > 3 ? (
                  <div className="text-[11px] text-gray-500 px-1">+{dayEvents.length - 3} more</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    return (
      <div className="grid md:grid-cols-7 gap-3">
        {weekDates.map((day) => {
          const dayEvents = calendarEvents.filter((e) => isSameDay(e.start, day));

          return (
            <Card
              key={day.toISOString()}
              className="rounded-2xl shadow-sm cursor-pointer transition hover:bg-green-50"
              onClick={() => handleDateClick(day)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{format(day, "EEE d")}</span>
                  {isToday(day) ? <Badge>Today</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {dayEvents.length === 0 ? (
                  <div className="text-sm text-gray-500">No events</div>
                ) : (
                  dayEvents.map((event) => (
                    <EventChip key={`${event.type}-${event.id}`} event={event} onClick={openEvent} />
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const dayEvents = calendarEvents.filter((e) => isSameDay(e.start, currentDate));

    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>{format(currentDate, "EEEE, MMMM d, yyyy")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4 gap-2">
            <Button variant="outline" onClick={() => handleDateClick(currentDate)}>
              <Plus className="h-4 w-4 mr-2" />
              Manage This Day
            </Button>
            <Button
              onClick={() => {
                setSelectedDate(currentDate);
                setCreateSessionOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Session
            </Button>
          </div>

          {dayEvents.length === 0 ? (
            <div className="text-sm text-gray-500">No events for this date.</div>
          ) : (
            <div className="space-y-3">
              {dayEvents.map((event) => (
                <div
                  key={`${event.type}-${event.id}`}
                  className="rounded-xl border p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => openEvent(event)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900">{event.title}</div>
                      <div className="text-sm text-gray-500">
                        {format(event.start, "p")} - {format(event.end, "p")}
                      </div>
                      {event.studentName ? (
                        <div className="text-sm text-gray-600 mt-1">{event.studentName}</div>
                      ) : null}
                    </div>
                    <Badge className={STATUS_STYLES[event.status] || STATUS_STYLES.note}>
                      {event.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!currentUser) {
    return (
      <div className="p-6">
        <Card className="rounded-2xl">
          <CardContent className="p-6 text-sm text-gray-600">
            Please log in to access Tutor Planner.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            {tr("tutorPlanner.title", "Tutor Planner")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {tr("tutorPlanner.subtitle", "Manage your tutoring schedule, availability, and sessions.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedDate(new Date());
              setAvailabilityOpen(true);
            }}
          >
            <Clock3 className="h-4 w-4 mr-2" />
            {tr("tutorPlanner.setAvailability", "Set Availability")}
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setSelectedDate(new Date());
              setBlockTimeOpen(true);
            }}
          >
            <Lock className="h-4 w-4 mr-2" />
            {tr("tutorPlanner.blockTime", "Block Time")}
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setSelectedDate(new Date());
              setCreateSessionOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {tr("tutorPlanner.createSession", "Create Session")}
          </Button>

          <Button
            onClick={() => {
              setSelectedDate(new Date());
              setNoteOpen(true);
            }}
          >
            <NotebookPen className="h-4 w-4 mr-2" />
            {tr("tutorPlanner.addNote", "Add Note")}
          </Button>
        </div>
      </div>

      {errorText ? (
        <Card className="rounded-2xl border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">{errorText}</CardContent>
        </Card>
      ) : null}

      {subscriptionLocked ? (
        <Card className="rounded-2xl border-amber-200 bg-amber-50">
          <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 text-amber-900">
              <Lock className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Subscription required</div>
                <div className="text-sm text-amber-800 mt-1">
                  Subscription mode is enabled. Activate your tutor subscription to manage availability, blocked time, notes, and sessions.
                </div>
              </div>
            </div>
            <Button type="button" onClick={goToSubscription} className="shrink-0">Go to Payment</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard
          title={tr("tutorPlanner.todaySessions", "Today's Sessions")}
          value={todayEvents.filter((e) => e.type === "session").length}
          subtitle="Booked today"
          icon={CalendarDays}
        />
        <SummaryCard
          title={tr("tutorPlanner.upcomingSessions", "Upcoming Sessions")}
          value={upcomingEvents.filter((e) => e.type === "session").length}
          subtitle="Next sessions"
          icon={Users}
        />
        <SummaryCard
          title={tr("tutorPlanner.hoursBooked", "Hours Booked")}
          value={bookedHoursThisWeek.toFixed(1)}
          subtitle="This week"
          icon={Clock3}
        />
        <SummaryCard
          title={tr("tutorPlanner.hoursAvailable", "Hours Available")}
          value={availableHoursThisWeek.toFixed(1)}
          subtitle="Weekly availability"
          icon={Lock}
        />
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => setCurrentDate(new Date())}>
              {tr("tutorPlanner.today", "Today")}
            </Button>
            <Button variant="outline" size="icon" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="font-semibold text-gray-900 ml-2">
              {view === "month" ? format(currentDate, "MMMM yyyy") : format(currentDate, "MMM d, yyyy")}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant={view === "month" ? "default" : "outline"} onClick={() => setView("month")}>
              {tr("tutorPlanner.month", "Month")}
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} onClick={() => setView("week")}>
              {tr("tutorPlanner.week", "Week")}
            </Button>
            <Button variant={view === "day" ? "default" : "outline"} onClick={() => setView("day")}>
              {tr("tutorPlanner.day", "Day")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
        </div>
      ) : view === "month" ? (
        renderMonthView()
      ) : view === "week" ? (
        renderWeekView()
      ) : (
        renderDayView()
      )}

      <AvailabilityDialog
        open={availabilityOpen}
        setOpen={setAvailabilityOpen}
        availability={availability}
        onSave={handleSaveAvailability}
        tr={tr}
      />

      <BlockTimeDialog
        open={blockTimeOpen}
        setOpen={setBlockTimeOpen}
        onSave={handleSaveBlockedTime}
        defaultDate={selectedDate}
      />

      <NoteDialog
        open={noteOpen}
        setOpen={setNoteOpen}
        onSave={handleSaveNote}
        defaultDate={selectedDate}
      />

      <CreateSessionDialog
        open={createSessionOpen}
        setOpen={setCreateSessionOpen}
        onSave={handleSaveSession}
        defaultDate={selectedDate || new Date()}
        tr={tr}
      />

      <DateActionDialog
        open={dateActionOpen}
        setOpen={setDateActionOpen}
        selectedDate={selectedDate}
        onAddNote={handleOpenNoteForDate}
        onBlockTime={handleOpenBlockForDate}
        onCreateSession={handleOpenCreateSessionForDate}
        onViewDay={handleViewDayFromDate}
      />

      <SessionDetailsDialog
        open={detailsOpen}
        setOpen={setDetailsOpen}
        event={selectedEvent}
      />
    </div>
  );
}