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
  private sprites = new Map<string, HTMLCanvasElement>();
  private projected = new WeakMap<Homeowner, L.Point>();
  private hits = new Map<string, { x: number; y: number; home: Homeowner }[]>();
  private origin?: L.LatLng;
  private frame = 0;
  private moving = false;
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
    map.on("movestart zoomstart", this.pause, this);
    map.on("moveend zoomend resize", this.resume, this);
    map.on("zoomanim", this.animate, this);
    map.on("click", this.tap, this);
    this.schedule();
    return this;
  }
  onRemove(map: L.Map) {
    cancelAnimationFrame(this.frame);
    map.off("movestart zoomstart", this.pause, this);
    map.off("moveend zoomend resize", this.resume, this);
    map.off("zoomanim", this.animate, this);
    map.off("click", this.tap, this);
    this.canvas?.remove();
    this.map = undefined;
    this.canvas = undefined;
    this.hits.clear();
    return this;
  }
  update(homes: Homeowner[], selected?: string) {
    if (homes === this.homes && selected === this.selected) return;
    this.homes = homes;
    this.selected = selected;
    this.schedule();
  }
  private schedule = () => {
    if (this.moving || !this.map) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  };
  private pause = () => {
    this.moving = true;
    cancelAnimationFrame(this.frame);
    this.hits.clear();
  };
  private resume = () => {
    this.moving = false;
    this.schedule();
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
  private sprite(artwork: ReturnType<typeof homeownerPinArtwork>, dpr: number) {
    const key = `${artwork.url}:${artwork.size}:${dpr}`;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const im = this.image(artwork.url);
      if (!im.complete || !im.naturalWidth) return;
      sprite = document.createElement('canvas');
      sprite.width = Math.ceil(artwork.size * dpr);
      sprite.height = Math.ceil(artwork.height * dpr);
      sprite.getContext('2d')?.drawImage(im, 0, 0, sprite.width, sprite.height);
      this.sprites.set(key, sprite);
      if (this.sprites.size > 24) this.sprites.delete(this.sprites.keys().next().value!);
    }
    return sprite;
  }
  private draw() {
    const map = this.map,
      canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize(),
      dpr = Math.min(devicePixelRatio || 1, 2),
      zoom = map.getZoom();
    // Reuse the backing buffer; allocating it on every pan creates avoidable work.
    const pixelWidth = Math.ceil(size.x * dpr), pixelHeight = Math.ceil(size.y * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    this.origin = map.containerPointToLatLng([0, 0]);
    this.hits.clear();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (zoom < 15) return;
    const sprites = new Map<string, ReturnType<typeof homeownerPinArtwork>>();
    const pixels = new Map<string, HTMLCanvasElement | undefined>();
    const scale = map.getZoomScale(zoom, 0);
    const offset = map.layerPointToContainerPoint(L.point(0, 0)).subtract(map.getPixelOrigin());
    let count = 0;
    for (const h of this.homes) {
      let world = this.projected.get(h);
      if (!world) {
        world = map.project([h.lat, h.lng], 0);
        this.projected.set(h, world);
      }
      const p = { x: Math.round(world.x * scale) + offset.x, y: Math.round(world.y * scale) + offset.y };
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
      if (!pixels.has(key)) pixels.set(key, this.sprite(sprite, dpr));
      const im = pixels.get(key);
      if (im)
        ctx.drawImage(
          im,
          p.x - sprite.anchorX,
          p.y - sprite.anchorY,
          sprite.size,
          sprite.height,
        );
      const y = p.y,
        k = `${Math.floor(p.x / 48)}:${Math.floor(y / 48)}`;
      let bucket = this.hits.get(k);
      if (!bucket) this.hits.set(k, bucket = []);
      bucket.push({ x: p.x, y, home: h });
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
    const hit = this.hitTest(e.containerPoint);
    if (hit) {
      L.DomEvent.stop(e.originalEvent);
      this.pick(hit.home);
    }
  };
  /** Shared with worked markers so their transparent tap padding cannot steal a home tap. */
  hitTest(p: L.Point, radius = 24) {
    const cx = Math.floor(p.x / 48),
      cy = Math.floor(p.y / 48);
    let best = radius * radius,
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
    return home ? { home, distanceSquared: best } : undefined;
  }
}
