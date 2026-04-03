import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

function getUserRole(data) {
  return (
    data?.role ||
    data?.user_type ||
    data?.userType ||
    ""
  ).toLowerCase();
}

export default function StudentScanRouter() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      const studentRef = searchParams.get("student_ref");

      if (!studentRef) {
        alert("Invalid QR Code");
        return;
      }

      // Save for later (important)
      localStorage.setItem("gp_student_ref", studentRef);

      const auth = getAuth();
      const user = auth.currentUser;

      // Not logged in → go to welcome
      if (!user) {
        navigate(`/Welcome?student_ref=${studentRef}`);
        return;
      }

      const db = getFirestore();
      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (!userDoc.exists()) {
        alert("User not found");
        return;
      }

      const role = getUserRole(userDoc.data());

      if (role === "school") {
        navigate(`/SchoolLeads?student_ref=${studentRef}`);
      } else if (role === "agent") {
        navigate(`/MyStudents?student_ref=${studentRef}`);
      } else if (role === "tutor") {
        navigate(`/TutorStudents?student_ref=${studentRef}`);
      } else {
        alert("This QR is only for Schools, Agents, or Tutors.");
      }
    };

    run();
  }, [searchParams, navigate]);

  return <div style={{ padding: 20 }}>Processing QR...</div>;
}