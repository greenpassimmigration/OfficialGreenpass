// src/lib/studentQr.js
export function getFunctionsBase() {
  const fromEnv =
    import.meta.env.VITE_FUNCTIONS_HTTP_BASE ||
    "";

  if (fromEnv) return String(fromEnv).replace(/\/+$/, "");

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) {
    return `https://us-central1-${projectId}.cloudfunctions.net`;
  }

  return "https://us-central1-greenpass-dc92d.cloudfunctions.net";
}

export function extractStudentRefFromScannedText(raw) {
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

export function getStudentQrEndpointByRole(role) {
  switch (String(role || "").toLowerCase()) {
    case "agent":
      return "acceptStudentReferralToAgent";
    case "school":
      return "acceptStudentReferralToSchool";
    case "tutor":
      return "acceptStudentReferralToTutor";
    default:
      throw new Error("Unsupported QR role.");
  }
}

export async function submitStudentQrByRole({ role, idToken, rawValue }) {
  const token = extractStudentRefFromScannedText(rawValue);
  if (!token) {
    throw new Error("Could not read a valid student QR token.");
  }

  const base = getFunctionsBase();
  const endpoint = getStudentQrEndpointByRole(role);

  const res = await fetch(`${base}/${endpoint}`, {
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
    throw new Error(data?.error || "Failed to process student QR.");
  }

  return {
    token,
    data,
  };
}