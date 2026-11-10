/**
 * Limits shared by the Google proxy routes (server) and their callers (client), so a caller can
 * stay inside what the server accepts instead of being rejected.
 */
/** Longest address string accepted (real lead queries "street, city, ST zip" are under 80 chars). */
export const MAX_ADDRESS_CHARS = 300;
/**
 * Most stops accepted by /api/route. The server splits them into 25-intermediate Routes API calls
 * (Google's limit with waypoint optimization) and runs a few at a time, so 1500 stops = 60 calls.
 */
export const MAX_ROUTE_STOPS = 1500;
