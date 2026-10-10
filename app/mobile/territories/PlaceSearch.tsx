"use client";
import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { apiFetch } from "@/app/utils/apiFetch";
export type Place = {
  label: string;
  lat: number;
  lng: number;
  bounds?: [[number, number], [number, number]];
};
const cache = new Map<string, Place[]>();
function parsePlaces(data: {
  results?: {
    formatted_address?: string;
    geometry?: {
      location?: { lat?: number; lng?: number };
      viewport?: {
        southwest: { lat: number; lng: number };
        northeast: { lat: number; lng: number };
      };
    };
  }[];
}): Place[] {
  return (data.results || [])
    .flatMap((r) => {
      const loc = r.geometry?.location,
        v = r.geometry?.viewport;
      if (
        typeof loc?.lat !== "number" ||
        typeof loc.lng !== "number" ||
        !Number.isFinite(loc.lat) ||
        !Number.isFinite(loc.lng)
      )
        return [];
      return [
        {
          label: r.formatted_address || "Search result",
          lat: loc.lat,
          lng: loc.lng,
          bounds: v
            ? ([
                [v.southwest.lat, v.southwest.lng],
                [v.northeast.lat, v.northeast.lng],
              ] as Place["bounds"])
            : undefined,
        },
      ];
    })
    .slice(0, 5);
}
export default function PlaceSearch({
  onSelect,
  preview = false,
  disabled = false,
}: {
  onSelect: (p: Place) => void;
  preview?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0),
    inFlight = useRef(false);
  async function search() {
    const text = query.trim();
    if (!text || inFlight.current || disabled) return;
    const id = ++generation.current;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setResults([]);
    try {
      const key = text.toLowerCase();
      let places = cache.get(key);
      if (preview)
        places = /rochester|14618/i.test(text)
          ? [{ label: "Rochester, NY 14618 · Demo", lat: 43.12, lng: -77.56 }]
          : [];
      else if (!places) {
        const response = await apiFetch(
          `/api/geocode?address=${encodeURIComponent(text)}`
        );
        if (!response.ok)
          throw new Error(
            "Town search is unavailable. Check your connection and try again."
          );
        places = parsePlaces(await response.json());
        if (cache.size >= 30) cache.delete(cache.keys().next().value!);
        cache.set(key, places);
      }
      if (id !== generation.current) return;
      setResults(places);
      setMessage(
        places.length
          ? "Choose a location to move the map."
          : "No locations found. Try a town with its state, or a ZIP code."
      );
    } catch (e) {
      if (id === generation.current)
        setMessage(
          e instanceof Error ? e.message : "Search failed. Try again."
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="rt-place-search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={18} />
        <input
          aria-label="Town or ZIP code"
          placeholder="Town, state or ZIP code"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            generation.current++;
            setResults([]);
            setMessage("");
          }}
        />
        <button type="submit" disabled={busy || disabled || !query.trim()}>
          {busy ? "Finding…" : "Search"}
        </button>
      </form>
      {(message || results.length > 0) && (
        <div className="rt-place-results">
          <button
            className="rt-place-close"
            aria-label="Close search results"
            onClick={() => {
              generation.current++;
              setMessage("");
              setResults([]);
            }}
          >
            <X size={16} />
          </button>
          <p role="status">{message}</p>
          {results.map((p, i) => (
            <button
              key={i}
              disabled={disabled}
              onClick={() => {
                onSelect(p);
                setQuery(p.label);
                setResults([]);
                setMessage("");
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
