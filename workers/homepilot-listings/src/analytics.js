// homepilot-listings — analytics module
// Reports listing view events to CREA's DDF Analytics Web Service, per
// CREA's own documentation ("REALTOR.ca DDF Analytics Web Service - Real
// Estate Advertising Websites", v2.2). This is a compliance requirement
// (CREA DDF Policy and Rules, rule 5c) -- see workers/WORKER_STATUS.md or
// prior commit messages for the source.
//
// DestinationID=66674 was issued by CREA Member Experience Team for
// myhomepilot.ca on 2026-07-22 (case #00258976). This is a real, specific
// value tied to this site -- not a placeholder.
//
// Per the doc: "No response handling is required, so these requests may be
// made asynchronously." This module is designed to be called fire-and-forget
// from the browser (see the frontend listing display code), NOT to block
// rendering on the analytics call succeeding or failing.

export const ANALYTICS_ENDPOINT = "https://analytics.crea.ca/LogEvents.svc/LogEvents";
export const DESTINATION_ID = 66674;

// Builds the URL for a 'view' event. Does NOT make the request itself --
// this module is imported by both the Worker (for potential server-side use)
// and is mirrored in the frontend's vanilla-JS analytics call, so keeping
// URL-building as a pure function makes it independently testable without
// needing to mock fetch.
//
// uuid: a stable per-browser/device identifier (NOT tied to a real person's
// identity -- CREA's doc describes it as a GUID or device identifier, used
// only to de-duplicate repeat events within a 5-minute window per their own
// spec, not for tracking individuals across sessions in any other way).
export function buildViewEventUrl({ listingId, uuid, languageId = 1 }) {
  if (!listingId) throw new Error("buildViewEventUrl: listingId is required");
  if (!uuid) throw new Error("buildViewEventUrl: uuid is required");

  const params = new URLSearchParams({
    ListingID: String(listingId),
    DestinationID: String(DESTINATION_ID),
    EventType: "view",
    UUID: uuid,
    LanguageID: String(languageId),
  });

  return `${ANALYTICS_ENDPOINT}?${params.toString()}`;
}
