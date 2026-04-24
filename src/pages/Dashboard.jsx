// src/pages/Dashboard.jsx
import React, { useState, useEffect } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Firebase
import { auth, db } from "@/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

// Dashboards
import AdminDashboard from "../components/dashboards/AdminDashboard";
import AgentDashboard from "../components/dashboards/AgentDashboard";
import SchoolDashboard from "../components/dashboards/SchoolDashboard";
import StudentDashboard from "../components/dashboards/StudentDashboard";
import TutorDashboard from "../components/dashboards/TutorDashboard";
import VendorDashboard from "../components/dashboards/VendorDashboard";
import CollaboratorDashboard from "../components/dashboards/CollaboratorDashboard";
import { useTr } from "@/i18n/useTr";

function normalizeRole(role) {
  const raw = String(role || "student").toLowerCase().trim();

  if (raw === "user") return "student";
  if (raw === "institution") return "school";
  if (raw === "provider") return "vendor";

  return raw || "student";
}

export default function Dashboard() {
  const { tr } = useTr("dashboard");

  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        navigate(createPageUrl("Welcome"));
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data() || {};

          setCurrentUser({
            uid: firebaseUser.uid,
            id: firebaseUser.uid,
            user_id: firebaseUser.uid,
            email: firebaseUser.email,
            ...data,
            role: normalizeRole(data.role),
          });
        } else {
          setCurrentUser({
            uid: firebaseUser.uid,
            id: firebaseUser.uid,
            user_id: firebaseUser.uid,
            email: firebaseUser.email,
            role: "student",
          });
        }
      } catch (e) {
        console.error("Error fetching user profile from Firestore:", e);
        setError("Could not load user information. Please try refreshing the page.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold mb-2">An Error Occurred</h2>
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
      </div>
    );
  }

  const effectiveRole = currentUser.is_collaborator
    ? "collaborator"
    : normalizeRole(currentUser.role);

  switch (effectiveRole) {
    case "admin":
      return <AdminDashboard user={currentUser} />;
    case "agent":
      return <AgentDashboard user={currentUser} />;
    case "school":
      return <SchoolDashboard user={currentUser} />;
    case "tutor":
      return <TutorDashboard user={currentUser} />;
    case "vendor":
      return <VendorDashboard user={currentUser} />;
    case "collaborator":
      return <CollaboratorDashboard user={currentUser} />;
    case "student":
    case "user":
    default:
      return <StudentDashboard user={currentUser} />;
  }
}
