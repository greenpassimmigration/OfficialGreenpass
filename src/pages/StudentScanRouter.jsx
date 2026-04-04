import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { createPageUrl } from "@/utils";

function normalizeRole(data) {
  return String(
    data?.selected_role ||
    data?.role ||
    data?.user_type ||
    data?.userType ||
    ""
  )
    .trim()
    .toLowerCase();
}

function buildRoleTarget(role, token) {
  const encoded = encodeURIComponent(token);

  if (role === "school") return `${createPageUrl("SchoolLeads")}?student_ref=${encoded}`;
  if (role === "agent") return `${createPageUrl("MyStudents")}?student_ref=${encoded}`;
  if (role === "tutor") return `${createPageUrl("TutorStudents")}?student_ref=${encoded}`;
  return "";
}

export default function StudentScanRouter() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const studentRef = String(searchParams.get("student_ref") || searchParams.get("ref") || "").trim();

      if (!studentRef) {
        window.alert("Invalid student QR.");
        navigate(createPageUrl("Welcome"), { replace: true });
        return;
      }

      try {
        localStorage.setItem("gp_student_ref", studentRef);
      } catch {}

      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        navigate(`${createPageUrl("Welcome")}?student_ref=${encodeURIComponent(studentRef)}`, {
          replace: true,
        });
        return;
      }

      try {
        const db = getFirestore();
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const role = userSnap.exists() ? normalizeRole(userSnap.data()) : "";
        const target = buildRoleTarget(role, studentRef);

        if (cancelled) return;

        if (target) {
          navigate(target, { replace: true });
          return;
        }

        window.alert("This student QR can only be used by school, agent, or tutor accounts.");
        navigate(createPageUrl("Welcome"), { replace: true });
      } catch (error) {
        console.error("StudentScanRouter failed:", error);
        if (!cancelled) {
          window.alert("Unable to process the student QR right now.");
          navigate(createPageUrl("Welcome"), { replace: true });
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  return <div style={{ padding: 20 }}>Processing student QR...</div>;
}
