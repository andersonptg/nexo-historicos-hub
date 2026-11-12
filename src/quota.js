// NEXO D1 free-tier protection. One collection per source within this window.
// The browser may still check for updated results every 5 seconds (reads only).
// Cloudflare D1 free tier has account-wide daily write quotas.
export const MIN_COLLECTION_INTERVAL_SECONDS = 45;
export function nextCollectionLeaseAt(now) {
  if(!Number.isFinite(now)) throw new TypeError('Timestamp inválido');
  return Math.floor(now) + MIN_COLLECTION_INTERVAL_SECONDS;
}
