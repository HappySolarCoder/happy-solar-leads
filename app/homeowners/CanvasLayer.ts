import L from "leaflet";
import { homeownerPinArtwork } from "./artwork";
import { suspectedRenter, type Homeowner } from "./model";
const MAX_PINS = 2000;
/** One canvas and one tap handler, with reused image sprites. No per-home DOM markers. */
export class HomeownerCanvas extends L.Layer {
  private map?: L.Map;
  private canvas?: HTMLCanvasElement;
  private homes: Homeowner[] = [];
  private selected?: string;
  private images = new Map<string, HTMLImageElement>();
  private hits = new Map<string, { x: number; y: number; home: Homeowner }[]>();
  private origin?: L.LatLng;
  private frame = 0;
  constructor(private pick: (h: Homeowner) => void) {
    super();
  }
  onAdd(map: L.Map) {
    this.map = map;
    this.canvas = L.DomUtil.create(
      "canvas",
      "leaflet-zoom-animated raydar-homeowner-canvas",
    );
    this.canvas.style.pointerEvents = "none";
    this.canvas.setAttribute("aria-hidden", "true");
    const pane =
      map.getPane("raydar-homeowners") || map.createPane("raydar-homeowners");
    pane.style.zIndex = "550";
    pane.style.pointerEvents = "none";
    pane.appendChild(this.canvas);
    map.on("moveend zoomend resize", this.schedule, this);
    map.on("zoomanim", this.animate, this);
    map.on("click", this.tap, this);
    this.schedule();
    return this;
  }
  onRemove(map: L.Map) {
    cancelAnimationFrame(this.frame);
    map.off("moveend zoomend resize", this.schedule, this);
    map.off("zoomanim", this.animate, this);
    map.off("click", this.tap, this);
    this.canvas?.remove();
    this.map = undefined;
    this.canvas = undefined;
    this.hits.clear();
    return this;
  }
  update(homes: Homeowner[], selected?: string) {
    this.homes = homes;
    this.selected = selected;
    this.schedule();
  }
  private schedule = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  };
  private image(url: string) {
    let im = this.images.get(url);
    if (!im) {
      im = new Image();
      im.onload = this.schedule;
      im.src = url;
      this.images.set(url, im);
      if (this.images.size > 20) {
        const oldest = this.images.keys().next().value;
        if (oldest) this.images.delete(oldest);
      }
    }
    return im;
  }
  private draw() {
    const map = this.map,
      canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize(),
      dpr = Math.min(devicePixelRatio || 1, 2),
      zoom = map.getZoom();
    canvas.width = size.x * dpr;
    canvas.height = size.y * dpr;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    this.origin = map.containerPointToLatLng([0, 0]);
    this.hits.clear();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    if (zoom < 15) return;
    const sprites = new Map<string, ReturnType<typeof homeownerPinArtwork>>();
    let count = 0;
    for (const h of this.homes) {
      const p = map.latLngToContainerPoint([h.lat, h.lng]);
      if (p.x < 0 || p.y < 0 || p.x > size.x || p.y > size.y) continue;
      if (count++ >= MAX_PINS) break;
      const renter = suspectedRenter(h),
        selected = h.id === this.selected,
        key = `${renter}:${selected}`;
      let sprite = sprites.get(key);
      if (!sprite) {
        sprite = homeownerPinArtwork(renter, zoom, selected);
        sprites.set(key, sprite);
      }
      const im = this.image(sprite.url);
      if (im.complete && im.naturalWidth)
        ctx.drawImage(
          im,
          p.x - sprite.size / 2,
          p.y - sprite.height,
          sprite.size,
          sprite.height,
        );
      const y = p.y - sprite.height / 2,
        k = `${Math.floor(p.x / 48)}:${Math.floor(y / 48)}`;
      this.hits.set(k, [...(this.hits.get(k) || []), { x: p.x, y, home: h }]);
    }
  }
  private animate = (e: L.ZoomAnimEvent) => {
    if (!this.map || !this.canvas || !this.origin) return;
    const scale = this.map.getZoomScale(e.zoom),
      origin = this.map.project(this.origin, e.zoom),
      center = this.map.project(e.center, e.zoom),
      offset = origin
        .subtract(center)
        .add(this.map.getSize().divideBy(2))
        .add(this.map.containerPointToLayerPoint([0, 0]));
    L.DomUtil.setTransform(this.canvas, offset, scale);
  };
  private tap = (e: L.LeafletMouseEvent) => {
    const target = e.originalEvent.target;
    if (
      target instanceof Element &&
      target.closest(".leaflet-marker-icon,.leaflet-control,.leaflet-popup")
    )
      return;
    const p = e.containerPoint,
      cx = Math.floor(p.x / 48),
      cy = Math.floor(p.y / 48);
    let best = 24 * 24,
      home: Homeowner | undefined;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (const h of this.hits.get(`${cx + x}:${cy + y}`) || []) {
          const d = (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
          if (d < best) {
            best = d;
            home = h.home;
          }
        }
    if (home) {
      L.DomEvent.stop(e.originalEvent);
      this.pick(home);
    }
  };
}
