import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileCheck2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import usePolicyAcceptance, { REQUIRED_POLICIES } from "@/hooks/usePolicyAcceptance";
import { createPageUrl } from "@/utils";

const POLICY_LINKS = {
  terms: {
    label: "Terms of Service",
    href: createPageUrl("TermsOfService"),
    description:
      "Rules for platform use, role-based access, account integrity, subscriptions, communications, and enforcement.",
    required: true,
  },
  privacy: {
    label: "Privacy Policy",
    href: createPageUrl("PrivacyPolicy"),
    description:
      "How GreenPass collects, uses, stores, protects, and reviews platform, messaging, verification, and payment-related data.",
    required: true,
  },
  community: {
    label: "Community Guidelines",
    href: createPageUrl("CommunityGuidelines"),
    description:
      "Rules for respectful conduct, truthful representation, anti-spam, anti-fraud, and safe professional behavior.",
    required: true,
  },
  refund: {
    label: "Refund and Payment Review Policy",
    href: createPageUrl("RefundPolicy"),
    description:
      "How subscription access, manual payment review, suspicious receipts, disputes, and refund requests are handled.",
    required: true,
  },
  verification: {
    label: "Verification Policy",
    href: createPageUrl("VerificationPolicy"),
    description:
      "How GreenPass reviews submitted records, trust signals, verification status, and feature eligibility.",
    required: true,
  },
  referral: {
    label: "Referral and Invitation Policy",
    href: createPageUrl("ReferralPolicy"),
    description:
      "Rules for invites, agent-linked relationships, organization access, referral integrity, and anti-abuse controls.",
    required: true,
  },
  messaging: {
    label: "Messaging and Investigation Policy",
    href: createPageUrl("MessagingPolicy"),
    description:
      "How chat records, reports, moderation, evidence review, and internal investigations are handled.",
    required: false,
  },
  immigrationdisclaimer: {
    label: "Immigration and Outcome Disclaimer",
    href: createPageUrl("ImmigrationDisclaimer"),
    description:
      "GreenPass does not guarantee school admission, visas, permits, jobs, income, or immigration outcomes.",
    required: false,
  },
};

export default function PolicyCenter() {
  const { loading, acceptPolicies } = usePolicyAcceptance();
  const [acceptedAll, setAcceptedAll] = useState(false);
  const [saving, setSaving] = useState(false);

  const requiredItems = useMemo(
    () =>
      REQUIRED_POLICIES.map((key) => ({ key, ...POLICY_LINKS[key] })).filter(
        (item) => item?.label && item?.href
      ),
    []
  );

  const optionalItems = useMemo(
    () =>
      Object.entries(POLICY_LINKS)
        .filter(([key, value]) => !value.required && !REQUIRED_POLICIES.includes(key))
        .map(([key, value]) => ({ key, ...value })),
    []
  );

  const onAcceptAll = async () => {
    if (!acceptedAll) return;
    setSaving(true);
    try {
      await acceptPolicies(REQUIRED_POLICIES);
      window.location.assign(createPageUrl("Dashboard"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="space-y-3">
          <CardTitle className="flex items-center gap-2 text-3xl">
            <FileCheck2 className="h-7 w-7" />
            Policy Center
          </CardTitle>

          <p className="text-sm text-gray-600">
            Please review the current GreenPass platform policies that apply to the features
            your account may access, including role-based dashboards, messaging, referrals,
            organization invites, tutoring tools, verification workflows, subscriptions,
            payment review, and admin-led trust or safety controls.
          </p>

          <div className="rounded-2xl border bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                These policies are written to match the current GreenPass routes and platform
                behavior. They do not automatically apply to future modules that are not yet
                active in the app.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold">Required policies</h2>
              <p className="text-sm text-gray-500">
                Please review these policies before continuing.
              </p>
            </div>

            {requiredItems.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border p-4"
              >
                <Link
                  to={item.href}
                  className="inline-flex items-center gap-1 font-semibold text-green-700 hover:underline"
                >
                  {item.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <p className="mt-1 text-sm text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="accept-all-policies"
                checked={acceptedAll}
                onCheckedChange={(value) => setAcceptedAll(!!value)}
              />
              <label
                htmlFor="accept-all-policies"
                className="text-sm text-gray-700 leading-6 cursor-pointer"
              >
                I accept all terms and conditions.
              </label>
            </div>
          </div>

          {optionalItems.length > 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold">Additional legal information</h2>
                <p className="text-sm text-gray-500">
                  Important guidance that supports platform clarity, trust, and safety.
                </p>
              </div>

              {optionalItems.map((item) => (
                <div key={item.key} className="rounded-2xl border p-4">
                  <Link
                    to={item.href}
                    className="inline-flex items-center gap-1 font-semibold text-green-700 hover:underline"
                  >
                    {item.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            disabled={loading || saving || !acceptedAll}
            onClick={onAcceptAll}
          >
            {saving ? "Saving acceptance..." : "Accept all terms and conditions"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}