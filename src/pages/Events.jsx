// src/pages/Events.jsx
import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Link, useSearchParams } from "react-router-dom";
import { createPageUrl } from "@/components/URLRedirect";

/* ---------- Firebase ---------- */
import { db } from "@/firebase";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { useTr } from "@/i18n/useTr";

/* ---------- Helpers ---------- */
const toJsDate = (v) => {
  if (!v) return null;

  // Firestore Timestamp
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return isNaN(d?.getTime()) ? null : d;
    }
    if (typeof v.seconds === "number") {
      const d = new Date(v.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  // Numbers (ms or seconds)
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return isNaN(d.getTime()) ? null : d;
  }

  // Strings
  if (typeof v === "string") {
    const raw = v.trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      const d = new Date(n > 1e12 ? n : n * 1000);
      return isNaN(d.getTime()) ? null : d;
    }

    // Handle strings like: "January 27, 2026 at 7:00:00 PM UTC+8"
    const cleaned = raw
      .replace(" at ", " ")
      .replace(/UTC\+(\d{1,2})\b/g, "+$1:00")
      .replace(/UTC\-(\d{1,2})\b/g, "-$1:00");

    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const safeFormat = (v, fmtStr = "MMMM dd, yyyy", fallback = "—") => {
  const d = toJsDate(v);
  if (!d) return fallback;
  try {
    return format(d, fmtStr);
  } catch {
    try {
      return d.toLocaleString();
    } catch {
      return fallback;
    }
  }
};

const safeTime = (v, fallback = "—") => {
  const d = toJsDate(v);
  if (!d) return fallback;
  try {
    return format(d, "hh:mm a");
  } catch {
    try {
      return d.toLocaleTimeString();
    } catch {
      return fallback;
    }
  }
};

const normalizeCountry = (value = "") => String(value || "").trim().toLowerCase();

const getCountryFromEvent = (event) => {
  return (
    event.country ||
    event.country_name ||
    event.countryName ||
    event.selected_country ||
    event.selectedCountry ||
    event.location_country ||
    event.locationCountry ||
    ""
  );
};

const getLocationText = (event) => {
  if (event.location && String(event.location).trim()) return String(event.location).trim();

  const city = event.city || event.location_city || event.locationCity || "";
  const province =
    event.province ||
    event.state ||
    event.region ||
    event.location_province ||
    event.locationProvince ||
    "";
  const country = getCountryFromEvent(event);

  return [city, province, country].filter(Boolean).join(", ") || "—";
};

const getShortDescription = (event) => {
  const raw =
    event.short_description ||
    event.shortDescription ||
    event.summary ||
    event.description ||
    "";
  return String(raw || "").replace(/<[^>]*>/g, "").trim();
};

const getRegisterUrl = (event) => {
  return (
    event.registration_url ||
    event.registrationUrl ||
    event.register_url ||
    event.registerUrl ||
    event.external_url ||
    event.externalUrl ||
    ""
  );
};

const isBoostedNow = (event) => {
  const now = new Date();
  const until = event?.boosted_until;

  const untilDate =
    typeof until?.toDate === "function"
      ? until.toDate()
      : until?.seconds
      ? new Date(until.seconds * 1000)
      : toJsDate(until);

  return !!(untilDate && untilDate > now);
};

/* ---------- Small Components ---------- */
const FilterBox = ({
  countries,
  selectedCountry,
  setSelectedCountry,
  activeTab,
  setActiveTab,
  onReset,
  tr,
}) => {
  return (
    <div className="bg-[#eef4f7] border border-[#d8e3ea] p-5 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
        <div className="lg:col-span-4">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            {tr("location", "Location")}:
          </label>
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="w-full h-11 px-4 border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1d78b5]"
          >
            <option value="">{tr("select_country", "Select a Country")}</option>
            {countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            {tr("view", "View")}:
          </label>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
            className="w-full h-11 px-4 border border-gray-300 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1d78b5]"
          >
            <option value="upcoming">{tr("upcoming", "Upcoming Events")}</option>
            <option value="past">{tr("past", "Past Events")}</option>
          </select>
        </div>

        <div className="lg:col-span-5 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            className="h-11 px-6 bg-[#1d78b5] text-white font-semibold hover:bg-[#17679b] transition-colors"
          >
            {tr("filter", "Filter")}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="h-11 px-6 bg-[#1d78b5] text-white font-semibold hover:bg-[#17679b] transition-colors"
          >
            {tr("reset", "Reset")}
          </button>
        </div>
      </div>
    </div>
  );
};

const EventRow = ({ event, tr }) => {
  const title = event.title || tr("untitled_event", "Untitled Event");
  const locationText = getLocationText(event);
  const description = getShortDescription(event);
  const detailsLink = createPageUrl("EventDetails", `id=${event.id || event.event_id}`);
  const registerUrl = getRegisterUrl(event);

  const startDate = safeFormat(event.start, "MMMM dd, yyyy");
  const startTime = safeTime(event.start, "");
  const endTime = safeTime(event.end, "");

  return (
    <tr className="border-b border-gray-200 align-top">
      <td className="px-4 py-5">
        <div className="space-y-2">
          <Link
            to={detailsLink}
            className="text-[#1f6ea5] font-bold text-[18px] leading-snug hover:underline"
          >
            {title}
          </Link>

          {description ? (
            <p className="text-[15px] text-gray-600 leading-relaxed max-w-[95%] line-clamp-2">
              {description}
            </p>
          ) : null}

          <Link
            to={detailsLink}
            className="inline-block text-[#1f6ea5] font-semibold hover:underline"
          >
            {tr("click_for_more", "Click for more »")}
          </Link>
        </div>
      </td>

      <td className="px-4 py-5 text-[15px] text-gray-600 min-w-[180px]">
        {locationText}
      </td>

      <td className="px-4 py-5 min-w-[180px]">
        <div className="text-[15px] font-semibold text-gray-700">{startDate}</div>
        <div className="text-[15px] text-gray-500 mt-1">
          {startTime && endTime ? `${startTime} - ${endTime}` : startTime || "—"}
        </div>
      </td>

      <td className="px-4 py-5 min-w-[130px]">
        {registerUrl ? (
          <a
            href={registerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 border border-gray-200 bg-[#f6f8fa] text-[#1f6ea5] font-semibold hover:bg-[#edf3f7] transition-colors"
          >
            {tr("register", "Register")}
          </a>
        ) : (
          <span className="text-gray-500">{tr("na", "n/s")}</span>
        )}
      </td>
    </tr>
  );
};

const FeaturedEventCard = ({ event, tr }) => {
  const detailsLink = createPageUrl("EventDetails", `id=${event.id || event.event_id}`);
  const dateText = safeFormat(event.start, "MMMM dd, yyyy");
  const locationText = getLocationText(event);

  return (
    <div className="pb-5 border-b border-gray-200 last:border-b-0 last:pb-0">
      <Link
        to={detailsLink}
        className="text-[#1f6ea5] font-bold leading-snug hover:underline block"
      >
        {event.title || tr("untitled_event", "Untitled Event")}
      </Link>

      <div className="mt-2 text-gray-500 text-sm">
        {locationText !== "—" ? <div>{locationText}</div> : null}
        <div>{dateText}</div>
      </div>
    </div>
  );
};

const PageSkeleton = () => (
  <div className="min-h-screen bg-[#f5f7f9] animate-pulse">
    <div className="h-56 bg-gray-300" />
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="h-36 bg-gray-200 mb-6" />
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-9 h-[500px] bg-gray-200" />
        <div className="lg:col-span-3 h-[500px] bg-gray-200" />
      </div>
    </div>
  </div>
);

/* ---------- Page ---------- */
export default function EventsPage() {
  const { tr } = useTr("events");
  const [searchParams] = useSearchParams();
  const lang = (searchParams.get("lang") || localStorage.getItem("gp_lang") || "en").trim();

  const [events, setEvents] = useState([]);
  const [pageContent, setPageContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [activeTab, setActiveTab] = useState("upcoming");

  // Load events from Firestore
  const fetchEvents = async () => {
    const snap = await getDocs(collection(db, "events"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  // Load page header content from Firestore
  const fetchHeaderContent = async () => {
    try {
      const q = query(
        collection(db, "home_page_content"),
        where("singleton_key", "==", "SINGLETON"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const data = snap.docs[0].data();
      return data?.events_page_section || null;
    } catch {
      return null;
    }
  };

  function pickLocalized(header, baseKey) {
    if (!header) return null;

    const keyField = header[`${baseKey}_i18n_key`];
    if (keyField && typeof keyField === "string") {
      return tr(keyField, header[baseKey] || "");
    }

    const map = header[`${baseKey}_translations`];
    if (map && typeof map === "object") {
      const v = map[lang] || map[lang.toLowerCase()] || map[lang.split("-")[0]];
      if (v) return v;
    }

    const suffix = lang.replace("-", "_");
    const byLang =
      header[`${baseKey}_${lang}`] ||
      header[`${baseKey}_${suffix}`] ||
      header[`${baseKey}_${lang.split("-")[0]}`];
    if (byLang) return byLang;

    return header[baseKey] || null;
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [evs, header] = await Promise.all([fetchEvents(), fetchHeaderContent()]);

        const now = new Date();
        const isBoostActive = (e) => {
          const until = e?.boosted_until;
          if (!until) return false;
          const d =
            typeof until?.toDate === "function"
              ? until.toDate()
              : until?.seconds
              ? new Date(until.seconds * 1000)
              : toJsDate(until);
          return !!(d && d > now);
        };

        // retain original sorting logic: boosted first, then sort_order, then start
        const sorted = [...evs].sort((a, b) => {
          const aBoost = isBoostActive(a);
          const bBoost = isBoostActive(b);
          if (aBoost !== bBoost) return aBoost ? -1 : 1;

          const aOrder = a.sort_order ?? 999;
          const bOrder = b.sort_order ?? 999;
          if (aOrder !== bOrder) return aOrder - bOrder;

          const at = toJsDate(a.start)?.getTime() ?? 0;
          const bt = toJsDate(b.start)?.getTime() ?? 0;
          return at - bt;
        });

        setEvents(sorted);

        setPageContent(
          header
            ? {
                title: pickLocalized(header, "title") || tr("fallback_title", "Fairs and Events"),
                subtitle:
                  pickLocalized(header, "subtitle") ||
                  tr(
                    "fallback_subtitle",
                    "Join our premier international education fairs, workshops, and seminars."
                  ),
                header_image_url:
                  header.header_image_url ||
                  header.header_image ||
                  header.image ||
                  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920&h=420&fit=crop&q=80",
              }
            : {
                title: tr("fallback_title", "Fairs and Events"),
                subtitle: tr(
                  "fallback_subtitle",
                  "Join our premier international education fairs, workshops, and seminars."
                ),
                header_image_url:
                  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920&h=420&fit=crop&q=80",
              }
        );
      } catch (e) {
        console.error("Error loading events:", e);
        setPageContent({
          title: tr("fallback_title", "Fairs and Events"),
          subtitle: tr(
            "fallback_subtitle",
            "Join our premier international education fairs, workshops, and seminars."
          ),
          header_image_url:
            "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920&h=420&fit=crop&q=80",
        });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [lang, tr]);

  const now = new Date();

  const isArchived = (e) => {
    const a = toJsDate(e.archive_at);
    return !!(a && a < now);
  };

  // retain original logic exactly
  const upcomingEvents = useMemo(() => {
    return events
      .filter((e) => {
        const end = toJsDate(e.end);
        return !!(end && end >= now && !isArchived(e));
      })
      .sort((a, b) => (toJsDate(a.start)?.getTime() ?? 0) - (toJsDate(b.start)?.getTime() ?? 0));
  }, [events]);

  // retain original logic exactly
  const pastEvents = useMemo(() => {
    return events
      .filter((e) => {
        const end = toJsDate(e.end);
        return isArchived(e) || !end || end < now;
      })
      .sort((a, b) => (toJsDate(b.end)?.getTime() ?? 0) - (toJsDate(a.end)?.getTime() ?? 0))
      .slice(0, 12);
  }, [events]);

  const countries = useMemo(() => {
    const set = new Set();
    events.forEach((event) => {
      const country = getCountryFromEvent(event);
      if (country && String(country).trim()) set.add(String(country).trim());
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [events]);

  const displayedEventsRaw = activeTab === "past" ? pastEvents : upcomingEvents;

  const displayedEvents = useMemo(() => {
    return displayedEventsRaw.filter((event) => {
      if (!selectedCountry) return true;
      const eventCountry = normalizeCountry(getCountryFromEvent(event));
      return eventCountry === normalizeCountry(selectedCountry);
    });
  }, [displayedEventsRaw, selectedCountry]);

  const featuredEvents = useMemo(() => {
    const boosted = events.filter((e) => isBoostedNow(e));
    const source = boosted.length ? boosted : upcomingEvents;
    return source.slice(0, 5);
  }, [events, upcomingEvents]);

  const handleReset = () => {
    setSelectedCountry("");
    setActiveTab("upcoming");
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="min-h-screen bg-[#f5f7f9]">
      {pageContent && (
        <div className="relative border-b border-gray-200 bg-[#dfe8ee]">
          <img
            src={pageContent.header_image_url}
            alt={tr("events_bg_alt", "Events background")}
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="relative max-w-7xl mx-auto px-4 py-14 md:py-16">
            <div className="max-w-3xl">
              <h1 className="text-3xl md:text-4xl font-extrabold text-[#16364f]">
                {pageContent.title}
              </h1>
              <p className="mt-3 text-base md:text-lg text-[#32546b]">
                {pageContent.subtitle}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        <FilterBox
          countries={countries}
          selectedCountry={selectedCountry}
          setSelectedCountry={setSelectedCountry}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onReset={handleReset}
          tr={tr}
        />

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-9">
            <div className="mb-4 text-[15px] text-gray-600">
              {tr("found_events", "We have found")}{" "}
              <span className="font-bold text-gray-800">{displayedEvents.length}</span>{" "}
              {tr("events_suffix", "event(s).")}
            </div>

            <div className="bg-white border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-[#153b5b] text-white">
                    <tr>
                      <th className="text-left px-4 py-4 font-bold text-[16px]">
                        {tr("name", "Name")}
                      </th>
                      <th className="text-left px-4 py-4 font-bold text-[16px]">
                        {tr("location", "Location")}
                      </th>
                      <th className="text-left px-4 py-4 font-bold text-[16px]">
                        {tr("date", "Date")}
                      </th>
                      <th className="text-left px-4 py-4 font-bold text-[16px]">
                        {tr("register", "Register")}
                      </th>
                    </tr>
                  </thead>

                  <tbody className="bg-white">
                    {displayedEvents.length > 0 ? (
                      displayedEvents.map((event) => (
                        <EventRow key={event.id} event={event} tr={tr} />
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                          {activeTab === "past"
                            ? tr("no_past_body", "No past events to show yet.")
                            : tr(
                                "no_upcoming_body",
                                "There are no upcoming events yet. Please check back later."
                              )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="lg:col-span-3">
            <div className="bg-white border border-gray-200 p-5">
              <h3 className="text-[18px] font-bold text-center text-gray-800 pb-4 border-b border-gray-200">
                {tr("featured_events", "Featured Events")}
              </h3>

              <div className="pt-5 space-y-5">
                {featuredEvents.length > 0 ? (
                  featuredEvents.map((event) => (
                    <FeaturedEventCard key={event.id} event={event} tr={tr} />
                  ))
                ) : (
                  <p className="text-sm text-gray-500">
                    {tr("no_featured", "No featured events yet.")}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}