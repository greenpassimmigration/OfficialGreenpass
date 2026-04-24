import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2, CreditCard, Info } from "lucide-react";
import { auth, db } from "@/firebase";

function getFunctionsBaseUrl() {
  const envBase =
    import.meta.env.VITE_FUNCTIONS_HTTP_BASE ||
    import.meta.env.VITE_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_CLOUD_FUNCTIONS_BASE_URL ||
    import.meta.env.VITE_FUNCTIONS_BASE;

  if (envBase) return String(envBase).replace(/\/+$/, "");

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (projectId) return `https://us-central1-${projectId}.cloudfunctions.net`;

  return "https://us-central1-greenpass-dc92d.cloudfunctions.net";
}

function cleanupStripeParams() {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.delete("gp_payment_provider");
  url.searchParams.delete("gp_payment_status");
  url.searchParams.delete("stripe_session_id");

  const clean =
    url.pathname +
    (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
    (url.hash || "");

  window.history.replaceState({}, document.title, clean);
}

function getPayPalClientIdFromDoc(data = {}) {
  return (
    data.client_id ||
    data.paypal_client_id ||
    data.public_key ||
    data.value ||
    data.config?.client_id ||
    data.settings?.client_id ||
    null
  );
}

function getStripePublishableKeyFromDoc(data = {}) {
  return (
    data.publishable_key ||
    data.stripe_publishable_key ||
    data.public_key ||
    data.key ||
    data.value ||
    data.config?.publishable_key ||
    data.settings?.publishable_key ||
    null
  );
}

export default function SharedPaymentGateway({
  amountUSD,
  amountCAD,
  itemDescription,
  payerName,
  payerEmail,
  paypalClientId,
  onCardPaymentSuccess,
  onProcessing,
  onDoneProcessing,
  onError,

  paymentMode = "payment", // "payment" | "subscription"
  planId = "",
}) {
  const hasWindow = typeof window !== "undefined";
  const functionsBaseUrl = useMemo(() => getFunctionsBaseUrl(), []);

  const finalAmountUSD = Number(amountUSD || 0);
  const finalAmountCAD = Number(
    amountCAD !== undefined
      ? amountCAD
      : Math.round(Number(amountUSD || 0) * 1.35 * 100) / 100
  );

  const finalDescription = itemDescription || "Payment";

  const normalizedPaymentMode =
    String(paymentMode || "payment").toLowerCase() === "subscription"
      ? "subscription"
      : "payment";

  const containerRef = useRef(null);
  const buttonRenderedRef = useRef(false);
  const stripeReturnHandledRef = useRef(false);

  const [activeProvider, setActiveProvider] = useState("paypal");

  const [paypalConfigStatus, setPaypalConfigStatus] = useState("loading");
  const [stripeConfigStatus, setStripeConfigStatus] = useState("loading");

  const [resolvedPaypalClientId, setResolvedPaypalClientId] = useState(null);
  const [resolvedStripePublishableKey, setResolvedStripePublishableKey] =
    useState(null);
  const [resolvedStripeCurrency, setResolvedStripeCurrency] = useState("USD");

  const [sdkStatus, setSdkStatus] = useState("idle");
  const [stripeLoading, setStripeLoading] = useState(false);

  const clientId = useMemo(() => {
    return (
      (paypalClientId && String(paypalClientId).trim()) ||
      resolvedPaypalClientId ||
      null
    );
  }, [paypalClientId, resolvedPaypalClientId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const paypalEnv = String(
          import.meta.env.VITE_PAYPAL_CLIENT_ID || ""
        ).trim();

        const stripeEnv = String(
          import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ""
        ).trim();

        let paypalDocData = null;
        let stripeDocData = null;

        try {
          const paypalSnap = await getDoc(doc(db, "payment_settings", "paypal"));
          if (paypalSnap.exists()) paypalDocData = paypalSnap.data();
        } catch (e) {
          console.warn("Could not read payment_settings/paypal:", e);
        }

        try {
          const stripeSnap = await getDoc(doc(db, "payment_settings", "stripe"));
          if (stripeSnap.exists()) stripeDocData = stripeSnap.data();
        } catch (e) {
          console.warn("Could not read payment_settings/stripe:", e);
        }

        const paypalIdFromDoc = getPayPalClientIdFromDoc(paypalDocData || {});
        const stripeKeyFromDoc = getStripePublishableKeyFromDoc(
          stripeDocData || {}
        );

        const stripeCurrencyFromDoc =
          stripeDocData?.currency || stripeDocData?.stripe_currency || "USD";

        const effectivePaypalId =
          (paypalClientId && String(paypalClientId).trim()) ||
          paypalEnv ||
          paypalIdFromDoc ||
          null;

        const effectiveStripeKey = stripeEnv || stripeKeyFromDoc || null;

        if (!cancelled) {
          setResolvedPaypalClientId(effectivePaypalId);
          setPaypalConfigStatus(effectivePaypalId ? "ok" : "missing");

          setResolvedStripePublishableKey(
            effectiveStripeKey ? String(effectiveStripeKey).trim() : null
          );

          setResolvedStripeCurrency(
            String(stripeCurrencyFromDoc || "USD").toUpperCase()
          );

          setStripeConfigStatus(effectiveStripeKey ? "ok" : "missing");
        }
      } catch (err) {
        console.error("Failed to load payment settings:", err);

        if (!cancelled) {
          setPaypalConfigStatus("error");
          setStripeConfigStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paypalClientId]);

  const hasPaypal = !!clientId;
  const hasStripe = !!resolvedStripePublishableKey;

  useEffect(() => {
    if (hasPaypal) {
      setActiveProvider((prev) =>
        prev === "stripe" && hasStripe ? "stripe" : "paypal"
      );
    } else if (hasStripe) {
      setActiveProvider("stripe");
    }
  }, [hasPaypal, hasStripe]);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";
    buttonRenderedRef.current = false;
  }, [clientId, finalAmountUSD, finalDescription, normalizedPaymentMode, planId]);

  useEffect(() => {
    if (!hasWindow) return;
    if (!clientId) return;

    if (window.paypal) {
      setSdkStatus("ready");
      return;
    }

    setSdkStatus("loading");

    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId
    )}&currency=USD&intent=capture`;
    script.async = true;

    script.onload = () => setSdkStatus("ready");
    script.onerror = () => setSdkStatus("failed");

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [clientId, hasWindow]);

  useEffect(() => {
    if (!hasWindow) return;
    if (!hasPaypal) return;
    if (sdkStatus !== "ready") return;
    if (!containerRef.current) return;
    if (buttonRenderedRef.current) return;

    try {
      window.paypal
        .Buttons({
          createOrder: (_data, actions) =>
            actions.order.create({
              purchase_units: [
                {
                  description: finalDescription,
                  amount: { value: String(finalAmountUSD.toFixed(2)) },
                },
              ],
            }),

          onApprove: async (_data, actions) => {
            try {
              onProcessing && onProcessing();

              const details = await actions.order.capture();

              if (onCardPaymentSuccess) {
                await onCardPaymentSuccess("paypal", details?.id, {
                  provider: "paypal",
                  mode: normalizedPaymentMode,
                  planId: planId || "",
                  details,
                  payerName,
                  payerEmail,
                });
              }
            } catch (err) {
              console.error("PayPal onApprove error:", err);
              onError && onError(err);
            } finally {
              onDoneProcessing && onDoneProcessing();
            }
          },

          onError: (err) => {
            console.error("PayPal error:", err);
            onError && onError(err);
          },
        })
        .render(containerRef.current);

      buttonRenderedRef.current = true;
    } catch (err) {
      console.error("Failed to render PayPal buttons:", err);
      setSdkStatus("failed");
      onError && onError(err);
    }
  }, [
    hasWindow,
    hasPaypal,
    sdkStatus,
    finalAmountUSD,
    finalDescription,
    payerName,
    payerEmail,
    normalizedPaymentMode,
    planId,
    onCardPaymentSuccess,
    onProcessing,
    onDoneProcessing,
    onError,
  ]);

  useEffect(() => {
    if (!hasWindow) return;
    if (!hasStripe) return;
    if (stripeReturnHandledRef.current) return;

    const url = new URL(window.location.href);
    const provider = url.searchParams.get("gp_payment_provider");
    const status = url.searchParams.get("gp_payment_status");
    const sessionId = url.searchParams.get("stripe_session_id");

    if (provider !== "stripe") return;

    if (status === "cancel") {
      stripeReturnHandledRef.current = true;
      cleanupStripeParams();
      onError && onError(new Error("Stripe payment was cancelled."));
      return;
    }

    if (status !== "success" || !sessionId) return;

    stripeReturnHandledRef.current = true;

    (async () => {
      try {
        onProcessing && onProcessing();

        const res = await fetch(`${functionsBaseUrl}/getStripeCheckoutSession`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to verify Stripe payment.");
        }

        const subscriptionStatus = String(
          data?.session?.subscription_status || ""
        ).toLowerCase();

        const isSubscriptionPaid =
          data?.session?.mode === "subscription" &&
          ["active", "trialing"].includes(subscriptionStatus);

        const isOneTimePaid = !!data?.paid;

        if (!isOneTimePaid && !isSubscriptionPaid) {
          throw new Error("Stripe payment has not been marked as paid.");
        }

        if (onCardPaymentSuccess) {
          await onCardPaymentSuccess("stripe", data.session?.id || sessionId, {
            provider: "stripe",
            mode: data?.session?.mode || normalizedPaymentMode,
            planId:
              data?.session?.metadata?.gp_plan_id ||
              data?.session?.metadata?.planId ||
              planId ||
              "",
            session: data.session || null,
            payerName,
            payerEmail,
          });
        }

        cleanupStripeParams();
      } catch (err) {
        console.error("Stripe return verification failed:", err);
        cleanupStripeParams();
        onError && onError(err);
      } finally {
        onDoneProcessing && onDoneProcessing();
        setStripeLoading(false);
      }
    })();
  }, [
    hasWindow,
    hasStripe,
    functionsBaseUrl,
    normalizedPaymentMode,
    planId,
    onCardPaymentSuccess,
    onProcessing,
    onDoneProcessing,
    onError,
    payerName,
    payerEmail,
  ]);

  const handleStripeCheckout = async () => {
    try {
      if (!resolvedStripePublishableKey) {
        throw new Error("Stripe publishable key is missing.");
      }

      if (
        normalizedPaymentMode === "subscription" &&
        !String(planId || "").trim()
      ) {
        throw new Error("Missing subscription plan ID.");
      }

      setStripeLoading(true);
      onProcessing && onProcessing();

      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete("gp_payment_provider");
      currentUrl.searchParams.delete("gp_payment_status");
      currentUrl.searchParams.delete("stripe_session_id");

      const currentUser = auth.currentUser;

      const res = await fetch(`${functionsBaseUrl}/createStripeCheckoutSession`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMode: normalizedPaymentMode,
          planId: planId || "",
          amountUSD: finalAmountUSD,
          currency: resolvedStripeCurrency || "USD",
          description: finalDescription,
          payerName: payerName || "",
          payerEmail: payerEmail || currentUser?.email || "",
          returnUrl: currentUrl.toString(),

          // Important for webhook/user subscription linking
          uid: currentUser?.uid || "",
          userId: currentUser?.uid || "",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error || "Failed to create Stripe checkout session."
        );
      }

      if (!data?.url) {
        throw new Error(
          "Stripe Checkout URL was not returned by the server. Update createStripeCheckoutSession to return session.url."
        );
      }

      window.location.assign(data.url);
    } catch (err) {
      console.error("Stripe checkout error:", err);
      onError && onError(err);
      onDoneProcessing && onDoneProcessing();
      setStripeLoading(false);
    }
  };

  const noProviderConfigured = !hasPaypal && !hasStripe;

  const loadingConfigs =
    paypalConfigStatus === "loading" || stripeConfigStatus === "loading";

  const headingText =
    normalizedPaymentMode === "subscription"
      ? "Subscribe securely with PayPal or Stripe"
      : "Pay securely with PayPal or Stripe";

  const buttonText =
    normalizedPaymentMode === "subscription"
      ? "Subscribe with Stripe / Card"
      : "Pay with Stripe / Card";

  const helperText =
    normalizedPaymentMode === "subscription"
      ? "Subscribe by card using Stripe Checkout."
      : "Pay by card using Stripe Checkout.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {headingText}
        </CardTitle>

        <CardDescription>
          You will be charged <strong>${finalAmountUSD.toFixed(2)} USD</strong>
          {finalAmountCAD ? ` (≈ $${finalAmountCAD} CAD)` : ""}.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {loadingConfigs && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading payment settings…
          </div>
        )}

        {!loadingConfigs && noProviderConfigured && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              No online payment method is configured yet.
              <br />
              Add <code>VITE_PAYPAL_CLIENT_ID</code> and/or{" "}
              <code>VITE_STRIPE_PUBLISHABLE_KEY</code>, or save PayPal/Stripe
              settings in <code>payment_settings</code>.
            </AlertDescription>
          </Alert>
        )}

        {!loadingConfigs && !noProviderConfigured && (
          <>
            {hasPaypal && hasStripe && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={activeProvider === "paypal" ? "default" : "outline"}
                  onClick={() => setActiveProvider("paypal")}
                >
                  PayPal
                </Button>

                <Button
                  type="button"
                  variant={activeProvider === "stripe" ? "default" : "outline"}
                  onClick={() => setActiveProvider("stripe")}
                >
                  Stripe / Card
                </Button>
              </div>
            )}

            {hasPaypal && (
              <div className={activeProvider === "paypal" ? "block" : "hidden"}>
                {sdkStatus === "loading" && (
                  <div className="flex items-center justify-center p-6">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Loading PayPal…
                  </div>
                )}

                {sdkStatus === "failed" && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      PayPal SDK failed to load. Check your network or ad blocker
                      and try again.
                    </AlertDescription>
                  </Alert>
                )}

                <div ref={containerRef} />
              </div>
            )}

            {hasStripe && (
              <div className={activeProvider === "stripe" ? "block" : "hidden"}>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="text-sm text-muted-foreground">
                    {helperText}
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleStripeCheckout}
                    disabled={stripeLoading}
                  >
                    {stripeLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Redirecting to Stripe…
                      </>
                    ) : (
                      <>{buttonText}</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}