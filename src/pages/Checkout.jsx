// src/pages/Checkout.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  AlertTriangle,
  Package as PackageIcon,
  CheckCircle,
  CreditCard,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Firebase
import { db, auth } from "@/firebase";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit,
  addDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import SharedPaymentGateway from "../components/payments/SharedPaymentGateway";
import {
  getDefaultPlanIdForRole,
  getPlanById,
  getPlansForRole,
} from "@/config/subscriptionPlans";

const PAID_ROLES = ["agent", "school", "tutor"];
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "paid", "subscribed"];

function normalizeRole(value) {
  const role = String(value || "").toLowerCase().trim();
  if (!role || role === "user" || role === "member") return "student";
  return role;
}

function resolveUserRole(userDoc) {
  return normalizeRole(
    userDoc?.selected_role ||
      userDoc?.user_type ||
      userDoc?.userType ||
      userDoc?.role ||
      "student"
  );
}

function getReturnPageForRole() {
  // All role dashboards are rendered by src/pages/Dashboard.jsx.
  // Do not return AgentDashboard/SchoolDashboard/TutorDashboard because those are not direct routes.
  return "Dashboard";
}

function isSubscriptionType(type, mode) {
  const t = String(type || "").toLowerCase().trim();
  const m = String(mode || "").toLowerCase().trim();
  return t === "subscription" || t === "subscribe" || m === "subscription";
}

export default function Checkout() {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [paypalClientId, setPaypalClientId] = useState(null); // resolved client id

  const navigate = useNavigate();

  const urlParams = new URLSearchParams(window.location.search);
  const packageType = urlParams.get("type") || urlParams.get("mode");
  const requestedRole = normalizeRole(urlParams.get("role"));
  const requestedPlanId =
    urlParams.get("plan") ||
    urlParams.get("planId") ||
    urlParams.get("subscriptionPlan") ||
    "";
  const packageId =
    urlParams.get("packageId") || urlParams.get("package") || urlParams.get("id");
  const returnTo = urlParams.get("returnTo") || urlParams.get("redirect") || "";

  const checkoutMode = isSubscriptionType(packageType, urlParams.get("mode"))
    ? "subscription"
    : "payment";

  const isSubscriptionCheckout = checkoutMode === "subscription";

  // ---------- helpers ----------
  const getUserDocRef = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    return doc(db, "users", uid);
  };

  const safePrice = (v) => Number(v || 0);

  const selectedPlanOptions = useMemo(() => {
    if (!pkg?.role) return [];
    return getPlansForRole(pkg.role).filter((p) => p.providerType === "subscription");
  }, [pkg?.role]);

  const isAlreadySubscribed = useMemo(() => {
    if (!userDoc) return false;
    if (userDoc.subscription_active === true) return true;
    const status = String(userDoc.subscription_status || "").toLowerCase().trim();
    return ACTIVE_SUBSCRIPTION_STATUSES.includes(status);
  }, [userDoc]);

  // Pull a string-like "client id" from many possible shapes
  const extractClientId = (obj) => {
    const raw =
      obj?.client_id ??
      obj?.paypal_client_id ??
      obj?.public_key ??
      obj?.merchant_id ??
      obj?.value ??
      obj?.config?.client_id ??
      obj?.settings?.client_id ??
      obj?.credentials?.client_id ??
      null;
    return typeof raw === "string" ? raw.trim() : raw ? String(raw).trim() : null;
  };

  // Try multiple collection names to be resilient to snake/camel case
  const findByIdOrNameFromCollections = async (colNames, idOrName) => {
    for (const colName of colNames) {
      // 1) try by id
      try {
        const byIdRef = doc(db, colName, idOrName);
        const byIdSnap = await getDoc(byIdRef);
        if (byIdSnap.exists()) {
          return { id: byIdSnap.id, ...byIdSnap.data(), __collection: colName };
        }
      } catch (_) {}

      // 2) fallback: query by name
      try {
        const qy = query(
          collection(db, colName),
          where("name", "==", idOrName),
          limit(1)
        );
        const snap = await getDocs(qy);
        if (!snap.empty) {
          const d = snap.docs[0];
          return { id: d.id, ...d.data(), __collection: colName };
        }
      } catch (_) {}
    }
    return null;
  };

  const buildSubscriptionPackage = (loadedUserDoc) => {
    const profileRole = resolveUserRole(loadedUserDoc);
    const role = PAID_ROLES.includes(requestedRole) ? requestedRole : profileRole;

    if (!PAID_ROLES.includes(role)) {
      throw new Error(
        "Subscription checkout is only available for agent, school, and tutor accounts."
      );
    }

    const defaultPlanId = getDefaultPlanIdForRole(role);
    const finalPlanId = requestedPlanId || packageId || defaultPlanId;
    const plan = getPlanById(finalPlanId);

    if (!plan || plan.providerType !== "subscription") {
      throw new Error(
        `Invalid subscription plan: ${finalPlanId || "missing"}. Expected a valid ${role} monthly/yearly plan.`
      );
    }

    if (normalizeRole(plan.role) !== role) {
      throw new Error(
        `The selected plan (${plan.id}) does not match the requested role (${role}).`
      );
    }

    const intervalLabel = plan.interval === "year" ? "year" : "month";

    return {
      id: plan.id,
      planId: plan.id,
      type: "subscription",
      role,
      interval: plan.interval,
      name: plan.label,
      description: `Recurring ${role} subscription billed every ${intervalLabel}.`,
      price_usd: plan.amount ?? 0,
      currency: plan.currency || "USD",
      features: [
        `Unlock ${role} dashboard features`,
        "Messaging and organization access when subscription mode is enabled",
        "Automatic Stripe subscription status sync",
        plan.interval === "year" ? "Yearly billing" : "Monthly billing",
      ],
    };
  };

  const loadPackage = async (type, id) => {
    switch (type) {
      case "visa": {
        const p = await findByIdOrNameFromCollections(
          ["visa_packages", "visaPackages", "VisaPackages"],
          id
        );
        return p
          ? {
              ...p,
              type: "visa",
              price_usd: p.price_usd ?? p.price ?? 0,
              name: p.name || "Unnamed Package",
              description: p.description || "No description available",
              features: p.features || p.key_benefits || [],
            }
          : null;
      }
      case "tutor": {
        const p = await findByIdOrNameFromCollections(
          ["tutor_packages", "tutorPackages", "TutorPackages"],
          id
        );
        return p
          ? {
              ...p,
              type: "tutor",
              price_usd: p.price_usd ?? p.price ?? 0,
              name: p.name || "Unnamed Package",
              description: p.description || "No description available",
              features: p.features || p.key_benefits || [],
            }
          : null;
      }
      case "student_tutor": {
        const p = await findByIdOrNameFromCollections(
          ["student_tutor_packages", "studentTutorPackages", "StudentTutorPackages"],
          id
        );
        return p
          ? {
              ...p,
              type: "student_tutor",
              price_usd: p.price_usd ?? p.price ?? 0,
              name: p.name || "Unnamed Package",
              description: p.description || "No description available",
              features: p.features || p.key_benefits || [],
              num_sessions: p.num_sessions || 1,
            }
          : null;
      }
      case "tutoring_session": {
        const sRef = doc(db, "tutoring_sessions", id);
        const sSnap = await getDoc(sRef);
        if (!sSnap.exists()) return null;
        const s = { id: sSnap.id, ...sSnap.data() };
        return {
          id: s.id,
          type: "tutoring_session",
          name: `Tutoring Session - ${s.subject || "Session"}`,
          description: `${s.duration || 60} minute session`,
          price_usd: s.price ?? s.price_usd ?? 0,
          features: [
            `Subject: ${s.subject || "-"}`,
            `Duration: ${s.duration || 60} minutes`,
          ],
        };
      }
      case "marketplace_order": {
        const orderRef = doc(db, "marketplace_orders", id);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) return null;
        const order = { id: orderSnap.id, ...orderSnap.data() };

        let serviceName = "Service";
        let serviceDesc = "";
        if (order.service_id) {
          const svcRef = doc(db, "services", order.service_id);
          const svcSnap = await getDoc(svcRef);
          if (svcSnap.exists()) {
            const svc = svcSnap.data();
            serviceName = svc.name || serviceName;
            serviceDesc = svc.description || "";
          }
        }

        return {
          id: order.id,
          type: "marketplace_order",
          name: serviceName,
          description: serviceDesc,
          price_usd: order.amount_usd ?? order.amount ?? 0,
          features: [
            serviceName,
            order.category ? `Category: ${order.category}` : null,
          ].filter(Boolean),
        };
      }
      default:
        throw new Error(
          `Invalid package type: ${type}. Expected: subscription, visa, tutor, student_tutor, tutoring_session, marketplace_order`
        );
    }
  };

  // ---------- PayPal client ID resolver ----------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1) Vite env or window global
        const envId =
          (typeof import.meta !== "undefined" &&
            import.meta?.env?.VITE_PAYPAL_CLIENT_ID) ||
          (typeof window !== "undefined" && window.__PAYPAL_CLIENT_ID__);
        if (envId && !cancelled) {
          setPaypalClientId(String(envId).trim());
          return;
        }

        // 2) Well-known doc id "paypal" in common collections
        const docPaths = [
          ["payment_settings", "paypal"],
          ["paymentSettings", "paypal"],
          ["PaymentSettings", "paypal"],
        ];
        for (const [colName, docId] of docPaths) {
          try {
            const ref = doc(db, colName, docId);
            const snap = await getDoc(ref);
            if (snap.exists()) {
              const cid = extractClientId(snap.data());
              if (cid && !cancelled) {
                setPaypalClientId(cid);
                return;
              }
            }
          } catch (_) {}
        }

        // 3) Fallback: query by provider/type/payment_type === "paypal"
        const colCandidates = ["payment_settings", "paymentSettings", "PaymentSettings"];
        for (const colName of colCandidates) {
          // provider
          try {
            const q1 = query(
              collection(db, colName),
              where("provider", "==", "paypal"),
              limit(1)
            );
            const r1 = await getDocs(q1);
            if (!r1.empty) {
              const cid = extractClientId(r1.docs[0].data());
              if (cid && !cancelled) {
                setPaypalClientId(cid);
                return;
              }
            }
          } catch (_) {}

          // type
          try {
            const q2 = query(
              collection(db, colName),
              where("type", "==", "paypal"),
              limit(1)
            );
            const r2 = await getDocs(q2);
            if (!r2.empty) {
              const cid = extractClientId(r2.docs[0].data());
              if (cid && !cancelled) {
                setPaypalClientId(cid);
                return;
              }
            }
          } catch (_) {}

          // payment_type
          try {
            const q3 = query(
              collection(db, colName),
              where("payment_type", "==", "paypal"),
              limit(1)
            );
            const r3 = await getDocs(q3);
            if (!r3.empty) {
              const cid = extractClientId(r3.docs[0].data());
              if (cid && !cancelled) {
                setPaypalClientId(cid);
                return;
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        if (!packageType) {
          throw new Error(
            `Checkout type is missing from URL. Expected ?type=subscription|visa|tutor|student_tutor|tutoring_session|marketplace_order`
          );
        }

        // user
        const userRef = getUserDocRef();
        if (!userRef) throw new Error("You must be signed in to checkout.");
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) throw new Error("User profile not found.");
        const loadedUserDoc = { id: userSnap.id, ...userSnap.data() };
        setUserDoc(loadedUserDoc);

        if (isSubscriptionCheckout) {
          setPkg(buildSubscriptionPackage(loadedUserDoc));
          return;
        }

        if (!packageId) {
          throw new Error(`Package ID is missing from URL. Expected ?packageId=...`);
        }

        // package
        const pkgLoaded = await loadPackage(packageType, packageId);
        if (!pkgLoaded) {
          throw new Error(
            `Package not found for type=${packageType}, id/name=${packageId}.`
          );
        }
        setPkg(pkgLoaded);
      } catch (e) {
        console.error("Checkout load error:", e);
        setError(e.message || "Failed to load checkout information.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageType, packageId, requestedPlanId, requestedRole, isSubscriptionCheckout]);

  // ---------- payment handlers ----------
  const handleSubscriptionSuccess = async (paymentData) => {
    const userRef = getUserDocRef();
    if (!userRef) throw new Error("No authenticated user.");

    const provider = String(paymentData?.provider || "stripe").toLowerCase();
    const session = paymentData?.session || null;
    const subscriptionStatus = String(
      session?.subscription_status || session?.status || "active"
    )
      .toLowerCase()
      .trim();

    const finalStatus = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscriptionStatus)
      ? subscriptionStatus
      : provider === "stripe"
        ? "active"
        : "paid";

    await updateDoc(userRef, {
      // Canonical role field used by App.jsx/Dashboard.jsx.
      role: pkg.role,
      // Legacy compatibility fields kept temporarily for older pages/helpers.
      selected_role: pkg.role,
      user_type: pkg.role,
      subscription_active: true,
      subscription_status: finalStatus,
      subscription_provider: provider,
      subscription_plan: pkg.planId,
      subscription_role: pkg.role,
      subscription_interval: pkg.interval || "month",
      subscription_amount: safePrice(pkg.price_usd),
      stripe_session_id:
        provider === "stripe" ? paymentData?.transactionId || paymentData?.id || null : null,
      stripe_subscription_id:
        provider === "stripe" ? session?.subscription_id || session?.subscription || null : null,
      stripe_customer_id:
        provider === "stripe" ? session?.customer_id || session?.customer || null : null,
      subscription_updated_at: serverTimestamp(),
    });

    // Optional local payment audit. The webhook may also write payment/subscription data.
    await addDoc(collection(db, "payments"), {
      user_id: userRef.id,
      related_entity_type: "subscription_checkout",
      related_entity_id: pkg.planId,
      amount_usd: safePrice(pkg.price_usd),
      status: "successful",
      provider,
      transaction_id: paymentData?.transactionId || paymentData?.id || null,
      created_date: serverTimestamp(),
      meta: {
        mode: "subscription",
        planId: pkg.planId,
        role: pkg.role,
        interval: pkg.interval,
        description: `${pkg.name} subscription`,
      },
    });

    const destination = returnTo || createPageUrl(getReturnPageForRole());
    navigate(destination);
  };

  const handlePaymentSuccess = async (paymentData) => {
    try {
      setLoading(true);
      setProcessing(true);
      setError(null);

      const userRef = getUserDocRef();
      if (!userRef) throw new Error("No authenticated user.");

      if (pkg?.type === "subscription") {
        await handleSubscriptionSuccess(paymentData);
        return;
      }

      // Record the payment
      await addDoc(collection(db, "payments"), {
        user_id: userRef.id,
        related_entity_type: `${pkg.type}_package_purchase`,
        related_entity_id: pkg.id,
        amount_usd: safePrice(pkg.price_usd),
        status: "successful",
        provider: paymentData?.provider || "PayPal",
        transaction_id: paymentData?.transactionId || paymentData?.id || null,
        created_date: serverTimestamp(),
        meta: {
          description: `${pkg.name} - ${pkg.type} package`,
        },
      });

      // Update user and create case if needed
      const u = userDoc || {};
      const updates = {};

      // Derive agent for visa cases
      const agentId = u.assigned_agent_id || u.referred_by_agent_id || null;

      switch (pkg.type) {
        case "visa": {
          const purchased = Array.isArray(u.purchased_packages)
            ? u.purchased_packages
            : [];
          updates.purchased_packages = [...purchased, pkg.name];
          if (u.user_type !== "student") updates.user_type = "student";

          await addDoc(collection(db, "cases"), {
            student_id: userRef.id,
            agent_id: agentId,
            case_type: pkg.name,
            package_id: pkg.id,
            status: "Application Started",
            case_requirements: pkg.doc_requirements || [],
            case_upload_tips: pkg.upload_tips || [],
            checklist: (pkg.doc_requirements || []).map((r) => ({
              task: r.label || String(r),
              status: "pending",
            })),
            timeline: [
              {
                event: "Package purchased and case created",
                date: new Date().toISOString(),
                actor: "system",
              },
            ],
            created_date: serverTimestamp(),
          });
          break;
        }

        case "tutor": {
          const tPurchased = Array.isArray(u.purchased_tutor_packages)
            ? u.purchased_tutor_packages
            : [];
          updates.purchased_tutor_packages = [...tPurchased, pkg.name];
          if (u.user_type !== "tutor") updates.user_type = "tutor";
          break;
        }

        case "student_tutor": {
          const credits = Number(u.session_credits || 0);
          updates.session_credits = credits + Number(pkg.num_sessions || 1);
          break;
        }

        case "tutoring_session":
          // session-specific updates already handled elsewhere (booking)
          break;

        case "marketplace_order":
          break;

        default:
          break;
      }

      if (Object.keys(updates).length) {
        await updateDoc(userRef, updates);
      }

      // Navigate to the right place
      switch (pkg.type) {
        case "visa":
          navigate(createPageUrl("VisaRequests"));
          break;
        case "tutor":
          navigate(createPageUrl("TutorAvailability"));
          break;
        case "student_tutor":
          navigate(createPageUrl("Tutors"));
          break;
        case "tutoring_session":
          navigate(createPageUrl("MySessions"));
          break;
        case "marketplace_order":
          navigate(createPageUrl("Dashboard"));
          break;
        default:
          navigate(createPageUrl("Dashboard"));
      }
    } catch (e) {
      console.error("Post-payment update error:", e);
      setError(
        "Payment succeeded, but we couldn't update your account. Please contact support."
      );
      setLoading(false);
      setProcessing(false);
    }
  };

  const handlePaymentError = (err) => {
    console.error("Payment error:", err);
    setError(err?.message || "Payment failed. Please try again.");
    setProcessing(false);
  };

  const handlePlanSwitch = (planId) => {
    if (!pkg?.role || !planId) return;
    const next = new URL(window.location.href);
    next.searchParams.set("type", "subscription");
    next.searchParams.set("role", pkg.role);
    next.searchParams.set("plan", planId);
    next.searchParams.delete("packageId");
    next.searchParams.delete("package");
    next.searchParams.delete("id");
    navigate(`${next.pathname}${next.search}${next.hash || ""}`);
  };

  // ---------- UI ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading checkout...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Checkout Error
            </h2>
            <p className="text-gray-600 mb-4 text-sm">{error}</p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => navigate(createPageUrl("Dashboard"))}
                variant="outline"
              >
                Return to Dashboard
              </Button>
              <Button
                onClick={() => window.location.reload()}
                size="sm"
                variant="ghost"
              >
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <PackageIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Package Not Found
            </h2>
            <p className="text-gray-600 mb-4">
              The requested checkout item could not be found.
            </p>
            <Button
              onClick={() => navigate(createPageUrl("Dashboard"))}
              variant="outline"
            >
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const title = isSubscriptionCheckout
    ? "Activate Your Subscription"
    : "Complete Your Purchase";

  const subtitle = isSubscriptionCheckout
    ? "Choose your plan and activate access to your GreenPass features."
    : "Review your selection and complete payment.";

  const summaryTitle = isSubscriptionCheckout ? "Subscription Summary" : "Package Summary";
  const totalLabel = isSubscriptionCheckout ? "Due today:" : "Total:";
  const intervalText =
    isSubscriptionCheckout && pkg.interval
      ? pkg.interval === "year"
        ? "/year"
        : "/month"
      : "";

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{title}</h1>
          <p className="text-gray-600">{subtitle}</p>
        </div>

        {isSubscriptionCheckout && isAlreadySubscribed ? (
          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Your account already has an active subscription. You can still change plans if needed.
          </div>
        ) : null}

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Package / Subscription Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageIcon className="w-5 h-5" />
                {summaryTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{pkg.name}</h3>
                <p className="text-gray-600 mt-1">{pkg.description}</p>
              </div>

              {isSubscriptionCheckout && selectedPlanOptions.length > 1 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedPlanOptions.map((plan) => {
                    const active = plan.id === pkg.planId;
                    return (
                      <Button
                        key={plan.id}
                        type="button"
                        variant={active ? "default" : "outline"}
                        className="justify-between rounded-2xl"
                        onClick={() => handlePlanSwitch(plan.id)}
                      >
                        <span>{plan.interval === "year" ? "Yearly" : "Monthly"}</span>
                        <span>${Number(plan.amount || 0)}</span>
                      </Button>
                    );
                  })}
                </div>
              ) : null}

              {pkg.features?.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Included:</h4>
                  <ul className="space-y-1">
                    {pkg.features.map((feature, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 text-sm text-gray-600"
                      >
                        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">{totalLabel}</span>
                  <span className="text-2xl font-bold text-green-600">
                    ${safePrice(pkg.price_usd)}{intervalText}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Payment Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {processing ? (
                <div className="mb-4 rounded-xl border bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Finalizing your checkout...
                </div>
              ) : null}

              <SharedPaymentGateway
                paymentMode={isSubscriptionCheckout ? "subscription" : "payment"}
                planId={isSubscriptionCheckout ? pkg.planId : ""}
                amountUSD={safePrice(pkg.price_usd)}
                itemDescription={
                  isSubscriptionCheckout
                    ? `${pkg.name} subscription`
                    : `${pkg.name} - ${pkg.type} package`
                }
                payerName={userDoc?.full_name || userDoc?.name || ""}
                payerEmail={userDoc?.email || auth.currentUser?.email || ""}
                paypalClientId={paypalClientId || undefined}
                onProcessing={() => setProcessing(true)}
                onDoneProcessing={() => setProcessing(false)}
                onCardPaymentSuccess={(provider, transactionId, meta) =>
                  handlePaymentSuccess({ provider, transactionId, ...meta })
                }
                onError={handlePaymentError}
              />

              {isSubscriptionCheckout ? (
                <p className="mt-3 text-xs text-gray-500">
                  Stripe subscriptions are synced back to your user profile. Once payment is successful, locked pages will unlock automatically when your subscription status becomes active.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
