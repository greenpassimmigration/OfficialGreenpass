export const SUBSCRIPTION_PLANS = {
  student_free: {
    id: "student_free",
    role: "student",
    label: "Student",
    interval: "free",
    amount: 0,
    currency: "USD",
    providerType: "free",
  },

  school_monthly: {
    id: "school_monthly",
    role: "school",
    label: "School Monthly",
    interval: "month",
    amount: 299,
    currency: "USD",
    providerType: "subscription",
  },
  school_yearly: {
    id: "school_yearly",
    role: "school",
    label: "School Yearly",
    interval: "year",
    amount: 2000,
    currency: "USD",
    providerType: "subscription",
  },

  agent_monthly: {
    id: "agent_monthly",
    role: "agent",
    label: "Agent Monthly",
    interval: "month",
    amount: 39,
    currency: "USD",
    providerType: "subscription",
  },
  agent_yearly: {
    id: "agent_yearly",
    role: "agent",
    label: "Agent Yearly",
    interval: "year",
    amount: 299,
    currency: "USD",
    providerType: "subscription",
  },

  tutor_monthly: {
    id: "tutor_monthly",
    role: "tutor",
    label: "Tutor Monthly",
    interval: "month",
    amount: 29,
    currency: "USD",
    providerType: "subscription",
  },
  tutor_yearly: {
    id: "tutor_yearly",
    role: "tutor",
    label: "Tutor Yearly",
    interval: "year",
    amount: 199,
    currency: "USD",
    providerType: "subscription",
  },
};

export const ROLE_PLAN_OPTIONS = {
  student: ["student_free"],
  school: ["school_monthly", "school_yearly"],
  agent: ["agent_monthly", "agent_yearly"],
  tutor: ["tutor_monthly", "tutor_yearly"],
};

export function getPlanById(planId) {
  return SUBSCRIPTION_PLANS[planId] || null;
}

export function getPlansForRole(role) {
  const ids = ROLE_PLAN_OPTIONS[role] || [];
  return ids.map((id) => SUBSCRIPTION_PLANS[id]).filter(Boolean);
}

export function getDefaultPlanIdForRole(role) {
  const ids = ROLE_PLAN_OPTIONS[role] || [];
  return ids[0] || null;
}

export function formatPlanPrice(plan) {
  if (!plan) return "";

  if (plan.providerType === "free" || plan.amount === 0 || plan.interval === "free") {
    return "Free";
  }

  const amount = Number(plan.amount || 0).toLocaleString("en-US");

  if (plan.interval === "month") {
    return `$${amount}/month`;
  }

  if (plan.interval === "year") {
    return `$${amount}/year`;
  }

  return `$${amount}`;
}