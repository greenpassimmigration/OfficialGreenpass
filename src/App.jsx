// src/App.jsx
import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Layout from "@/pages/Layout.jsx";
import Organization from "@/pages/Organization";
import AcceptOrgInvite from "@/pages/AcceptOrgInvite";
import Welcome from "@/pages/Welcome.jsx";
import Directory from "@/pages/Directory";
import Dashboard from "@/pages/Dashboard";
import EventsPage from "@/pages/Events";
import Onboarding from "./pages/Onboarding";
import Connect from "@/pages/Connect";
import Tutors from "@/pages/Tutors";
import MySessions from "@/pages/MySessions";
import TutorStudents from "@/pages/TutorStudents";
import TutorSessions from "@/pages/TutorSessions";
import TutorAvailability from "@/pages/TutorAvailability";
import SchoolProfile from "@/pages/SchoolProfile";
import SchoolLeads from "@/pages/SchoolLeads";
import SchoolDetails from "@/pages/SchoolDetails";
import ProgramDetails from "@/pages/ProgramDetails";
import MyServices from "@/pages/MyServices";
import UserManagement from "@/pages/UserManagement";
import AdminSchools from "@/pages/AdminSchools";
import AdminInstitutions from "@/pages/AdminInstitutions";
import AdminAgentAssignments from "@/pages/AdminAgentAssignments";
import Verification from "@/pages/Verification";
import AdminPaymentVerification from "@/pages/AdminPaymentVerification";
import AdminPayments from "@/pages/AdminPayments";
import AdminWalletManagement from "@/pages/AdminWalletManagement";
import AdminEvents from "@/pages/AdminEvents";
import AdminBrandSettings from "@/pages/AdminBrandSettings";
import AdminChatSettings from "@/pages/AdminChatSettings";
import AdminBankSettings from "@/pages/AdminBankSettings";
import AdminReports from "@/pages/AdminReports";
import AdminClaimRequests from "@/pages/AdminClaimRequests";
import AgentAgreement from "@/pages/AgentAgreement";
import Checkout from "@/pages/Checkout";
import ReservationStatus from "@/pages/ReservationStatus";
import UserDetails from "@/pages/UserDetails";
import MyStudents from "./pages/MyStudents";
import Profile from "./pages/Profile";
import ResetPassword from "./pages/ResetPassword.jsx";
import PostDetail from "./pages/PostDetail";
import StudyCanada from "@/pages/countries/StudyCanada";
import StudyNewZealand from "@/pages/countries/StudyNewZealand";
import StudyAustralia from "@/pages/countries/StudyAustralia";
import StudyIreland from "@/pages/countries/StudyIreland";
import StudyGermany from "@/pages/countries/StudyGermany";
import StudyUnitedKingdom from "@/pages/countries/StudyUnitedKingdom";
import StudyUnitedStates from "@/pages/countries/StudyUnitedStates";
import Messages from "@/pages/Messages";
import AdminSubscription from "./pages/AdminSubscription";
import EventDetailsPage from "./pages/EventDetails";
import Connections from "./pages/Connections";
import ViewProfile from "./pages/ViewProfile";
import AuthBridge from "./pages/AuthBridge";
import TutorPlanner from "@/pages/TutorPlanner";
import CollaboratorReferrals from "@/pages/CollaboratorReferrals";
import PolicyCenter from "@/pages/PolicyCenter";
import TermsOfService from "@/pages/TermsOfService";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import CommunityGuidelines from "@/pages/CommunityGuidelines";
import VerificationPolicy from "@/pages/VerificationPolicy";
import ReferralPolicy from "@/pages/ReferralPolicy";
import RefundPolicy from "@/pages/RefundPolicy";
import ImmigrationDisclaimer from "@/pages/ImmigrationDisclaimer";
import MessagingPolicy from "@/pages/MessagingPolicy";
import StudentScanRouter from "./pages/StudentScanRouter";

/* ---------- Firebase auth/profile (lightweight for route-guards) ---------- */
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// --- Safe import of createPageUrl (with fallback if not exported) ---
import * as Utils from "@/utils";
const createPageUrl =
  (Utils && Utils.createPageUrl) ||
  ((label = "") =>
    label
      .toString()
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^\w/]/g, "")
      .toLowerCase());

/* =========================
   Auth + Role Guards
========================= */

function normalizeRole(u) {
  const raw = String(u?.user_type || u?.role || "student").toLowerCase().trim();
  if (raw === "user") return "student";
  return raw;
}

function useCurrentUser() {
  const [currentUser, setCurrentUser] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      try {
        const ref = doc(db, "users", fbUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setCurrentUser({ uid: fbUser.uid, ...snap.data() });
        } else {
          setCurrentUser({ uid: fbUser.uid, user_type: "student" });
        }
      } catch {
        setCurrentUser({ uid: fbUser.uid, user_type: "student" });
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  return { currentUser, loading };
}

function RequireAuth({ currentUser, loading, children }) {
  const location = useLocation();
  if (loading) return null;
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function RequireRole({ currentUser, loading, allow, children }) {
  if (loading) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  const role = normalizeRole(currentUser);
  const allowed = (Array.isArray(allow) ? allow : [allow]).map((r) =>
    normalizeRole({ user_type: r })
  );

  if (!allowed.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default function App() {
  const { currentUser, loading } = useCurrentUser();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Index → Home */}
        <Route index element={<Welcome />} />
        <Route path="welcome" element={<Welcome />} />

        {/* Public site */}
        <Route path="directory" element={<Directory />} />
        <Route path="auth-bridge" element={<AuthBridge />} />
        <Route path="accept-org-invite" element={<AcceptOrgInvite />} />
        <Route path="events" element={<EventsPage />} />
        <Route path={createPageUrl("StudyCanada")} element={<StudyCanada />} />
        <Route path={createPageUrl("StudyNewZealand")} element={<StudyNewZealand />} />
        <Route path={createPageUrl("StudyAustralia")} element={<StudyAustralia />} />
        <Route path={createPageUrl("StudyIreland")} element={<StudyIreland />} />
        <Route path={createPageUrl("StudyGermany")} element={<StudyGermany />} />
        <Route path={createPageUrl("StudyUnitedKingdom")} element={<StudyUnitedKingdom />} />
        <Route path={createPageUrl("StudyUnitedStates")} element={<StudyUnitedStates />} />

        {/* Public policy pages */}
        <Route path={createPageUrl("PolicyCenter")} element={<PolicyCenter />} />
        <Route path={createPageUrl("TermsOfService")} element={<TermsOfService />} />
        <Route path={createPageUrl("PrivacyPolicy")} element={<PrivacyPolicy />} />
        <Route path={createPageUrl("CommunityGuidelines")} element={<CommunityGuidelines />} />
        <Route path={createPageUrl("VerificationPolicy")} element={<VerificationPolicy />} />
        <Route path={createPageUrl("ReferralPolicy")} element={<ReferralPolicy />} />
        <Route path={createPageUrl("RefundPolicy")} element={<RefundPolicy />} />
        <Route path={createPageUrl("MessagingPolicy")} element={<MessagingPolicy />} />
        <Route path={createPageUrl("ImmigrationDisclaimer")} element={<ImmigrationDisclaimer />} />

        {/* Auth pages */}
        <Route path="resetpassword" element={<ResetPassword />} />
        <Route path="/scan/student" element={<StudentScanRouter />} />

        {/* Public content */}
        <Route path="postdetail" element={<PostDetail />} />
        <Route path="eventdetails" element={<EventDetailsPage />} />
        <Route path="tutors" element={<Tutors />} />

        {/* Authenticated (all roles) */}
        <Route
          path="dashboard"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="connections"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Connections />
            </RequireAuth>
          }
        />
        <Route
          path="connect"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Connect />
            </RequireAuth>
          }
        />
        <Route
          path="view-profile/:uid"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <ViewProfile />
            </RequireAuth>
          }
        />
        <Route
          path="messages"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Messages />
            </RequireAuth>
          }
        />
        <Route
          path="onboarding"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Onboarding />
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Profile />
            </RequireAuth>
          }
        />
        <Route
          path="referrals"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["collaborator", "admin"]}>
              <CollaboratorReferrals />
            </RequireRole>
          }
        />
        <Route
          path="checkout"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <Checkout />
            </RequireAuth>
          }
        />

        {/* Authenticated users can view school details */}
        <Route
          path="schooldetails"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <SchoolDetails />
            </RequireAuth>
          }
        />

        {/* Authenticated users can view program details */}
        <Route
          path="programdetails"
          element={
            <RequireAuth currentUser={currentUser} loading={loading}>
              <ProgramDetails />
            </RequireAuth>
          }
        />

        {/* Organization (School/Agent/Tutor) */}
        <Route
          path="organization"
          element={
            <RequireRole
              currentUser={currentUser}
              loading={loading}
              allow={["school", "agent", "tutor"]}
            >
              <Organization />
            </RequireRole>
          }
        />

        {/* Student-only */}
        <Route
          path="mysessions"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["student", "user"]}>
              <MySessions />
            </RequireRole>
          }
        />
        <Route
          path="reservationstatus"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["student", "user"]}>
              <ReservationStatus />
            </RequireRole>
          }
        />

        {/* Agent-only */}
        <Route
          path="agentagreement"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["agent"]}>
              <AgentAgreement />
            </RequireRole>
          }
        />
        <Route
          path="mystudents"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["agent"]}>
              <MyStudents />
            </RequireRole>
          }
        />

        {/* Tutor-only */}
        <Route
          path="tutorstudents"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["tutor"]}>
              <TutorStudents />
            </RequireRole>
          }
        />
        <Route
          path="tutorsessions"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["tutor"]}>
              <TutorSessions />
            </RequireRole>
          }
        />
        <Route
          path="tutoravailability"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["tutor"]}>
              <TutorAvailability />
            </RequireRole>
          }
        />
        <Route
          path="planner"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["tutor"]}>
              <TutorPlanner />
            </RequireRole>
          }
        />

        {/* School-only */}
        <Route
          path="schoolprofile"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["school"]}>
              <SchoolProfile />
            </RequireRole>
          }
        />
        <Route
          path="schoolleads"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["school"]}>
              <SchoolLeads />
            </RequireRole>
          }
        />

        {/* Vendor-only */}
        <Route
          path="myservices"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["vendor"]}>
              <MyServices />
            </RequireRole>
          }
        />

        {/* Admin-only */}
        <Route
          path="usermanagement"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <UserManagement />
            </RequireRole>
          }
        />
        <Route
          path="adminschools"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminSchools />
            </RequireRole>
          }
        />
        <Route
          path="admininstitutions"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminInstitutions />
            </RequireRole>
          }
        />
        <Route
          path="adminagentassignments"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminAgentAssignments />
            </RequireRole>
          }
        />
        <Route
          path="adminclaimrequests"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminClaimRequests />
            </RequireRole>
          }
        />
        <Route
          path="verification"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <Verification />
            </RequireRole>
          }
        />
        <Route
          path="adminpaymentverification"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminPaymentVerification />
            </RequireRole>
          }
        />
        <Route
          path="adminpayments"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminPayments />
            </RequireRole>
          }
        />
        <Route
          path="adminwalletmanagement"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminWalletManagement />
            </RequireRole>
          }
        />
        <Route
          path="adminevents"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminEvents />
            </RequireRole>
          }
        />
        <Route
          path="adminbrandsettings"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminBrandSettings />
            </RequireRole>
          }
        />
        <Route
          path="adminchatsettings"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminChatSettings />
            </RequireRole>
          }
        />
        <Route
          path="adminbanksettings"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminBankSettings />
            </RequireRole>
          }
        />
        <Route
          path="adminreports"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminReports />
            </RequireRole>
          }
        />
        <Route
          path="subscriptions"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <AdminSubscription />
            </RequireRole>
          }
        />
        <Route
          path="userdetails"
          element={
            <RequireRole currentUser={currentUser} loading={loading} allow={["admin"]}>
              <UserDetails />
            </RequireRole>
          }
        />
      </Route>
    </Routes>
  );
}