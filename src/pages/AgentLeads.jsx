// src/pages/AgentLeads.jsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search, Phone, Mail, MessageCircle, TrendingUp, Loader2, Lock, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { createPageUrl } from "@/utils";
import { useSubscriptionMode } from "@/hooks/useSubscriptionMode";

const toJsDate = (v) => {
  if (!v) return null;
  try {
    return typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  } catch {
    return null;
  }
};

const StatusBadge = ({ status, tr }) => {
  const normalized = String(status || "").toLowerCase().trim();

  const colors = {
    new: "bg-blue-100 text-blue-800",
    contacted: "bg-yellow-100 text-yellow-800",
    qualified: "bg-green-100 text-green-800",
    converted: "bg-emerald-100 text-emerald-800",
    lost: "bg-red-100 text-red-800",
  };

  const labels = {
    new: tr("agent_leads.status.new", "New"),
    contacted: tr("agent_leads.status.contacted", "Contacted"),
    qualified: tr("agent_leads.status.qualified", "Qualified"),
    converted: tr("agent_leads.status.converted", "Converted"),
    lost: tr("agent_leads.status.lost", "Lost"),
  };

  return (
    <Badge className={colors[normalized] || "bg-gray-100 text-gray-800"}>
      {labels[normalized] || status || tr("agent_leads.status.unknown", "Unknown")}
    </Badge>
  );
};


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
  const query = new URLSearchParams({
    type: "subscription",
    role,
    plan,
    lock: "1",
    returnTo: fallbackPath || window.location.pathname || "/dashboard",
  });
  return `${createPageUrl("Checkout")}?${query.toString()}`;
}

export default function AgentLeads() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { subscriptionModeEnabled } = useSubscriptionMode();
  const tr = useCallback(
    (key, def, vars = undefined) => t(key, { defaultValue: def, ...(vars || {}) }),
    [t]
  );

  const [leads, setLeads] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [meDoc, setMeDoc] = useState(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "leads"),
      where("assigned_agent_id", "==", uid),
      orderBy("created_at", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setLeads(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load leads:", err);
        setLeads([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const filteredLeads = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return leads;

    return leads.filter((lead) =>
      [lead.name, lead.email, lead.interest, lead.phone, lead.source, lead.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [leads, searchTerm]);

  const stats = useMemo(() => {
    const totalLeads = leads.length;
    const by = (s) => leads.filter((l) => String(l.status || "").toLowerCase().trim() === s).length;

    return {
      totalLeads,
      newLeads: by("new"),
      qualifiedLeads: by("qualified"),
      convertedLeads: by("converted"),
    };
  }, [leads]);

  const subscriptionLocked = useMemo(
    () => isSubscriptionLockedForRole(meDoc, subscriptionModeEnabled, "agent"),
    [meDoc, subscriptionModeEnabled]
  );

  const subscriptionCheckoutUrl = useMemo(() => {
    const currentPath = `${window.location.pathname}${window.location.search || ""}`;
    return buildSubscriptionCheckoutUrl(meDoc, "agent", currentPath);
  }, [meDoc]);

  const goToSubscription = () => navigate(subscriptionCheckoutUrl);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-emerald-50">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <TrendingUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
            {tr("agent_leads.title", "Leads & Pipeline")}
          </h1>
        </div>

        {subscriptionLocked ? (
          <Card className="mb-6 rounded-2xl border-amber-200 bg-amber-50">
            <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-amber-900">
                <Lock className="h-5 w-5 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">Subscription required</div>
                  <div className="text-sm text-amber-800 mt-1">
                    Subscription mode is enabled. Activate your agent subscription to access lead contact actions and messaging.
                  </div>
                </div>
              </div>
              <Button onClick={goToSubscription} className="shrink-0">
                <CreditCard className="h-4 w-4 mr-2" />
                Go to Payment
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-blue-600">{stats.totalLeads}</div>
                  <p className="text-gray-600">
                    {tr("agent_leads.stats.total_leads", "Total Leads")}
                  </p>
                </div>
                <Users className="w-8 h-8 text-blue-200" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-yellow-600">{stats.newLeads}</div>
                  <p className="text-gray-600">
                    {tr("agent_leads.stats.new_leads", "New Leads")}
                  </p>
                </div>
                <Users className="w-8 h-8 text-yellow-200" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-green-600">{stats.qualifiedLeads}</div>
                  <p className="text-gray-600">
                    {tr("agent_leads.stats.qualified", "Qualified")}
                  </p>
                </div>
                <Users className="w-8 h-8 text-green-200" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-emerald-600">{stats.convertedLeads}</div>
                  <p className="text-gray-600">
                    {tr("agent_leads.stats.converted", "Converted")}
                  </p>
                </div>
                <Users className="w-8 h-8 text-emerald-200" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder={tr("agent_leads.search_placeholder", "Search leads...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{tr("agent_leads.table.title", "Lead Pipeline")}</CardTitle>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("agent_leads.table.name", "Name")}</TableHead>
                  <TableHead>{tr("agent_leads.table.contact", "Contact")}</TableHead>
                  <TableHead>{tr("agent_leads.table.interest", "Interest")}</TableHead>
                  <TableHead>{tr("agent_leads.table.status", "Status")}</TableHead>
                  <TableHead>{tr("agent_leads.table.source", "Source")}</TableHead>
                  <TableHead>{tr("agent_leads.table.date", "Date")}</TableHead>
                  <TableHead>{tr("agent_leads.table.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredLeads.map((lead) => {
                  const created = toJsDate(lead.created_at);

                  return (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">
                        {lead.name || tr("agent_leads.common.not_available", "-")}
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1">
                          {lead.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-gray-400" />
                              <span className="text-sm">{lead.email}</span>
                            </div>
                          )}

                          {lead.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-400" />
                              <span className="text-sm">{lead.phone}</span>
                            </div>
                          )}

                          {!lead.email && !lead.phone && (
                            <span className="text-sm text-gray-500">
                              {tr("agent_leads.common.not_available", "-")}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>{lead.interest || tr("agent_leads.common.not_available", "-")}</TableCell>
                      <TableCell>
                        <StatusBadge status={lead.status} tr={tr} />
                      </TableCell>
                      <TableCell>{lead.source || tr("agent_leads.common.not_available", "-")}</TableCell>
                      <TableCell>{created ? format(created, "yyyy-MM-dd") : "-"}</TableCell>

                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={subscriptionLocked}
                          onClick={() => {
                            if (subscriptionLocked) return;
                            const targetId = lead.student_id || lead.user_id || lead.client_id || "";
                            if (targetId) navigate(`${createPageUrl("Messages")}?to=${encodeURIComponent(targetId)}`);
                          }}
                          title={tr("agent_leads.actions.message", "Message")}
                          aria-label={tr("agent_leads.actions.message", "Message")}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {filteredLeads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                      {tr("agent_leads.empty.no_leads", "No leads found.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}