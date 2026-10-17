import {
  collection,
  query,
  orderBy,
  startAt,
  endAt,
  limit,
  getDocsFromServer,
} from "firebase/firestore";
import { auth, db } from "@/app/utils/firebase";
import { isPermissionDenied } from "@/app/utils/permissionDenied";
import {
  HOMEOWNER_LIMITED_NOTE,
  homeownersAccessDenied,
  markHomeownersAccessDenied,
} from "./access";
import {
  hashNumber,
  numberHash,
  parseHomeowner,
  QUERY_LIMIT,
  MIN_ZOOM,
  TILE_SIZE,
  type Range,
} from "./model";
/** The only production homeowners query. No listeners, writes, pagination or unbounded fallback. */
export async function readHomeownerRange(
  range: Range,
  zoom: number,
  uid: string,
) {
  if (homeownersAccessDenied(uid)) {
    throw Object.assign(new Error(HOMEOWNER_LIMITED_NOTE), { code: "permission-denied" });
  }
  if (!db || auth?.currentUser?.uid !== uid)
    throw Error("Sign in to view homeowner records.");
  if (
    zoom < MIN_ZOOM ||
    !Number.isSafeInteger(range.lo) ||
    !Number.isSafeInteger(range.hi) ||
    range.hi <= range.lo ||
    range.hi - range.lo > TILE_SIZE ||
    Math.floor(range.lo / TILE_SIZE) !== Math.floor((range.hi - 1) / TILE_SIZE)
  )
    throw Error("Homeowner reads require a small bounded map area.");
  const first = numberHash(range.lo),
    last = numberHash(range.hi - 1);
  const snapshot = await getDocsFromServer(
    query(
      collection(db, "homeowners"),
      orderBy("geohash"),
      startAt(first),
      endAt(last),
      limit(QUERY_LIMIT),
    ),
  ).catch((error: unknown) => {
    if (isPermissionDenied(error)) markHomeownersAccessDenied(uid);
    throw error;
  });
  if (auth?.currentUser?.uid !== uid) throw Error("Account changed.");
  const docs = snapshot.docs
    .map((d) => parseHomeowner(d.id, d.data()))
    .filter(
      (h): h is NonNullable<typeof h> =>
        !!h &&
        hashNumber(h.geohash) >= range.lo &&
        hashNumber(h.geohash) < range.hi,
    );
  return { docs, rawCount: snapshot.size };
}
