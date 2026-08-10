/**
 * The route map. Reads state and draws it; never mutates it.
 *
 * Coastlines are built once (they never change). Arcs, cities and labels are
 * rebuilt on every render — at ~200 cities and a few hundred arcs that is well
 * inside a frame, and it keeps the render a pure function of state.
 */
import worldGeo from '../data/world-110m.geo.json' with { type: 'json' };
import type { Carrier, City, CityId, Route } from '../sim/types.ts';
import { greatCirclePoints, splitAtAntimeridian } from '../sim/geo.ts';
import { CITIES, getCity } from '../sim/world.ts';
import {
  MAP_WIDTH, MAP_HEIGHT, VIEWBOX, VIEW_MIN_X, VIEW_MIN_Y, VIEW_W, VIEW_H, polyline, project,
} from './projection.ts';

const MAX_ZOOM = 6;
const ZOOM_STEP = 1.5;
/** Below this drag distance (in screen px) a pointer gesture is a click, not a pan. */
const PAN_THRESHOLD = 4;
/**
 * How close (in map units at 1x) a click must land to a city to pick it. Selection
 * is by NEAREST city centre, not by an invisible hit box — so dense clusters like
 * New York / Philadelphia / Boston can't steal each other's clicks by draw order.
 * Scaled by zoom so the reach stays roughly constant on screen.
 */
const CITY_HIT_RADIUS = 12;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** GeoJSON geometry -> SVG path data, with antimeridian-safe rings. */
function geometryToPath(geometry: unknown): string {
  const g = geometry as { type: string; coordinates: number[][][] | number[][][][] };
  const polygons: number[][][][] =
    g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);

  let d = '';
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = ring.map(([lon, lat]) => ({ lat: lat as number, lon: lon as number }));
      for (const run of splitAtAntimeridian(points)) {
        if (run.length < 2) continue;
        d += `${polyline(run.map(project))}Z`;
      }
    }
  }
  return d;
}

/** Cities are drawn as squares — a printed-map convention, not a data-viz dot. */
function citySize(city: City): number {
  // 2.2–4.6 units across, compressed so megacities don't swamp the map.
  return 2.2 + Math.min(1, Math.log10(city.pop + 1) / Math.log10(38)) * 2.4;
}

/**
 * What the map needs in order to draw. Deliberately narrower than GameState so
 * the map can also render before a game exists (home-city selection).
 */
export interface MapScene {
  readonly routes: readonly Route[];
  readonly carriers: readonly Carrier[];
  /**
   * Route ids with aircraft actually flying them. Anything absent is drawn as
   * dormant — opened, but not yet carrying anyone, because its metal is on order
   * or it has nothing assigned. Optional: without it every arc draws as flying.
   */
  readonly flying?: ReadonlySet<string>;
  /**
   * Player route id -> weight tier 0/1/2, by what the sector earns against the
   * rest of the player's own network. Optional: a bare GameState is still a valid
   * scene, and without it every arc draws at the middle weight.
   *
   * Relative rather than absolute on purpose. The map's job is to answer "where am
   * I strong" at a glance, and a fixed dollar threshold would answer it only for
   * whichever decade of the game it was calibrated against.
   */
  readonly routeWeight?: ReadonlyMap<string, number>;
}

export interface MapCallbacks {
  onSelectCity(id: CityId): void;
  onHoverCity(id: CityId | null): void;
  /**
   * A route line was clicked. The obvious thing to try when you want to know what
   * a line is, and it did nothing at all: arcs carried hover handlers and no
   * click, so the only way to pick a sector out was a list somewhere else.
   */
  onSelectRoute(routeId: string, carrierId: string): void;
  /** Fired when the zoom level changes, so the UI can enable/disable its controls. */
  onZoomChange?(): void;
}

export interface MapSelection {
  /** Chosen origin, awaiting a destination. */
  readonly from: CityId | null;
  readonly hovered: CityId | null;
  /** Cities the current origin cannot fly to, dimmed while choosing. */
  readonly unavailable: ReadonlySet<CityId>;
  /**
   * A carrier whose whole network is held at full strength. Hovering an arc has
   * always done this momentarily; this is the sticky version, so a rival can be
   * picked from the sidebar and their network actually looked at. Until it
   * existed there was no way to see one carrier's routes without already knowing
   * where on the map to point.
   */
  readonly focusedCarrier?: string | null;
  /**
   * A single sector held out from everything else — picked from a carrier's route
   * list. Narrower than `focusedCarrier`: that lights a whole network, this
   * answers "which line is that one".
   */
  readonly highlightedRoute?: string | null;
}

export class RouteMap {
  readonly root: SVGSVGElement;
  private readonly arcLayer = el('g', { class: 'layer-arcs' });
  private readonly cityLayer = el('g', { class: 'layer-cities' });
  private readonly labelLayer = el('g', { class: 'layer-labels' });
  /** Player route ids already on the map, so a newly opened one can draw itself in
   *  while the rest stay put. Seeded on the first render (a resumed network does not
   *  re-animate); only routes opened afterward flourish. */
  private drawnRouteIds: Set<string> | null = null;

  // View state: zoom (1 = whole plate, higher = closer) about a centre point.
  private zoom = 1;
  private centerX = VIEW_MIN_X + VIEW_W / 2;
  private centerY = VIEW_MIN_Y + VIEW_H / 2;
  // A pan in progress, and a flag so the click that ends a drag doesn't select a city.
  private pan: {
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: number;
    capturing: boolean;
  } | null = null;
  private suppressClick = false;

  constructor(private readonly callbacks: MapCallbacks) {
    this.root = el('svg', {
      viewBox: VIEWBOX,
      class: 'map',
      role: 'application',
      'aria-label': 'World route map. Choose an origin city, then a destination, to price a sector before opening it.',
    });

    this.root.append(
      el('rect', { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT, class: 'ocean' }),
      this.buildLand(),
      this.arcLayer,
      this.cityLayer,
      this.labelLayer,
    );

    // Select the city nearest the click (empty water clears a half-made selection).
    // A drag that ends over the map sets suppressClick, so it selects nothing.
    this.root.addEventListener('click', (event) => {
      if (this.suppressClick) return;
      this.callbacks.onSelectCity(this.cityAt(event.clientX, event.clientY) ?? '');
    });

    this.installPanZoom();
  }

  /** Client (screen) coordinates -> map user units, honouring zoom and pan. */
  private toUser(clientX: number, clientY: number): { x: number; y: number } | null {
    const ctm = this.root.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** The city whose centre is nearest the click, within reach — or null (open water). */
  private cityAt(clientX: number, clientY: number): CityId | null {
    const u = this.toUser(clientX, clientY);
    if (!u) return null;
    let best: CityId | null = null;
    let bestDist = CITY_HIT_RADIUS / this.zoom;
    for (const city of CITIES) {
      const p = project(city);
      const d = Math.hypot(p.x - u.x, p.y - u.y);
      if (d < bestDist) {
        bestDist = d;
        best = city.id;
      }
    }
    return best;
  }

  /** Drag to pan, scroll to zoom — so a zoomed-in map can be moved to your region. */
  private installPanZoom(): void {
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.suppressClick = false;
      // Do NOT capture yet: capturing here would retarget pointerup to the root and
      // the browser would fire the click on the root, not the city under it. Capture
      // only once a real drag begins, so a plain click still selects a city.
      this.pan = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0, capturing: false };
    });

    this.root.addEventListener('pointermove', (e) => {
      const pan = this.pan;
      if (pan && e.pointerId === pan.pointerId) {
        const dxPx = e.clientX - pan.lastX;
        const dyPx = e.clientY - pan.lastY;
        pan.lastX = e.clientX;
        pan.lastY = e.clientY;
        pan.moved += Math.hypot(dxPx, dyPx);
        if (pan.moved > PAN_THRESHOLD && !pan.capturing) {
          // Now it is unmistakably a drag: swallow the ending click, and capture the
          // pointer so the pan keeps up even if it leaves the plate.
          pan.capturing = true;
          this.suppressClick = true;
          this.root.setPointerCapture(e.pointerId);
        }
        if (pan.capturing) {
          // Screen pixels -> user units: one viewBox is `clientWidth` pixels wide.
          const rect = this.root.getBoundingClientRect();
          const perPx = VIEW_W / this.zoom / (rect.width || 1);
          this.centerX -= dxPx * perPx;
          this.centerY -= dyPx * perPx;
          this.applyView();
          return; // panning: don't also hover
        }
      }
      // Not panning: highlight the nearest city under the pointer, and show a
      // pointer cursor when one is in reach so the map reads as clickable.
      const near = this.cityAt(e.clientX, e.clientY);
      this.root.classList.toggle('over-city', near !== null);
      this.callbacks.onHoverCity(near);
    });

    const endPan = (e: PointerEvent): void => {
      const pan = this.pan;
      if (!pan || e.pointerId !== pan.pointerId) return;
      if (pan.capturing && this.root.hasPointerCapture(e.pointerId)) {
        this.root.releasePointerCapture(e.pointerId);
      }
      this.pan = null;
    };
    this.root.addEventListener('pointerup', endPan);
    this.root.addEventListener('pointercancel', endPan);

    this.root.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Zoom toward the cursor, so the point under the pointer stays put.
        const rect = this.root.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / (rect.width || 1);
        const fy = (e.clientY - rect.top) / (rect.height || 1);
        this.zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, fx, fy);
      },
      { passive: false },
    );
  }

  /** Set the SVG viewBox from the current zoom and centre, clamped to the plate. */
  private applyView(): void {
    const w = VIEW_W / this.zoom;
    const h = VIEW_H / this.zoom;
    this.centerX = clamp(this.centerX, VIEW_MIN_X + w / 2, VIEW_MIN_X + VIEW_W - w / 2);
    this.centerY = clamp(this.centerY, VIEW_MIN_Y + h / 2, VIEW_MIN_Y + VIEW_H - h / 2);
    const x = this.zoom <= 1 ? VIEW_MIN_X : this.centerX - w / 2;
    const y = this.zoom <= 1 ? VIEW_MIN_Y : this.centerY - h / 2;
    this.root.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  }

  /** Zoom by `factor` about a fractional point (fx, fy) of the current viewport. */
  private zoomAt(factor: number, fx: number, fy: number): void {
    const prev = this.zoom;
    this.zoom = clamp(this.zoom * factor, 1, MAX_ZOOM);
    if (this.zoom === prev) return;
    this.callbacks.onZoomChange?.();
    // Keep the point under (fx, fy) fixed: shift the centre by the change in half-extents.
    const wPrev = VIEW_W / prev;
    const wNow = VIEW_W / this.zoom;
    const hPrev = VIEW_H / prev;
    const hNow = VIEW_H / this.zoom;
    this.centerX += (fx - 0.5) * (wPrev - wNow);
    this.centerY += (fy - 0.5) * (hPrev - hNow);
    this.applyView();
  }

  /** Public zoom controls for the on-map buttons — zoom about the view centre. */
  zoomIn(): void {
    this.zoomAt(ZOOM_STEP, 0.5, 0.5);
  }

  zoomOut(): void {
    this.zoomAt(1 / ZOOM_STEP, 0.5, 0.5);
  }

  resetView(): void {
    this.zoom = 1;
    this.centerX = VIEW_MIN_X + VIEW_W / 2;
    this.centerY = VIEW_MIN_Y + VIEW_H / 2;
    this.applyView();
    this.callbacks.onZoomChange?.();
  }

  get canZoomIn(): boolean {
    return this.zoom < MAX_ZOOM - 1e-9;
  }

  get canZoomOut(): boolean {
    return this.zoom > 1 + 1e-9;
  }

  private buildLand(): SVGGElement {
    const layer = el('g', { class: 'layer-land' });
    const features = (worldGeo as { features: { geometry: unknown }[] }).features;
    for (const feature of features) {
      const d = geometryToPath(feature.geometry);
      if (d) layer.append(el('path', { d, class: 'land' }));
    }
    return layer;
  }

  render(scene: MapScene, selection: MapSelection): void {
    this.pinnedCarrier = selection.focusedCarrier ?? null;
    this.highlighted = selection.highlightedRoute ?? null;
    this.renderArcs(scene, selection);
    this.renderCities(scene, selection);
    this.renderLabels(scene, selection);
  }

  private renderArcs(scene: MapScene, selection: MapSelection): void {
    this.arcLayer.replaceChildren();

    const playerId = scene.carriers.find((c) => c.isPlayer)?.id;
    // Rivals first, so the player's own network always draws on top of theirs.
    const ordered = [...scene.routes].sort(
      (a, b) => Number(a.carrierId === playerId) - Number(b.carrierId === playerId),
    );

    // A player route absent last render is one just opened — draw it in. On the very
    // first render everything is "already there" (a resumed game is not a fanfare).
    const seeded = this.drawnRouteIds;
    const playerRouteIds = new Set<string>();

    for (const route of ordered) {
      const carrier = scene.carriers.find((c) => c.id === route.carrierId);
      const mine = route.carrierId === playerId;
      if (mine) playerRouteIds.add(route.id);
      const isNew = mine && seeded !== null && !seeded.has(route.id);
      const points = greatCirclePoints(getCity(route.from), getCity(route.to));
      for (const run of splitAtAntimeridian(points)) {
        // isNew implies mine, so a drawing-in arc is always one of the player's own.
        const tier = mine ? (scene.routeWeight?.get(route.id) ?? 1) : 0;
        // A sector with no metal on it moves nobody. Drawn, because the player
        // needs to see their own dormant sector and a rival's announced one, but
        // drawn as what it is rather than as a served route.
        const dormant = scene.flying ? !scene.flying.has(route.id) : false;
        const base = isNew
          ? `arc arc-drawin arc-w${tier}`
          : mine
            ? `arc arc-w${tier}`
            : 'arc arc-rival';
        const classes = dormant ? `${base} arc-dormant` : base;
        const attrs: Record<string, string | number> = {
          d: polyline(run.map(project)),
          class: classes,
          stroke: carrier?.color ?? 'currentColor',
          // Lets a rival's whole network come forward together on hover, rather
          // than one arc lighting up out of the middle of it.
          'data-carrier': route.carrierId,
          // A sector may be drawn as several paths where it crosses the
          // antimeridian, so picking one out has to mark every segment of it.
          'data-route': route.id,
        };
        // pathLength normalizes the dash math to 1 so the draw-in works at any length.
        if (isNew) attrs['pathLength'] = 1;
        /*
         * An invisible fat twin, purely to be clicked.
         *
         * The visible stroke is between 1 and 2.8px and a great-circle arc is a
         * curve, so hitting it exactly is a fiddly thing to ask of anybody. This
         * carries the same geometry at a generous width with no paint, sits under
         * the real line, and holds the click handler. It is deliberately NOT
         * classed `arc`, so none of the focus or highlight queries ever see it.
         */
        this.arcLayer.append(el('path', {
          d: attrs['d'] as string,
          class: 'arc-hit',
          'data-route': route.id,
          'data-carrier': route.carrierId,
        }));
        this.arcLayer.append(el('path', attrs));
      }
    }
    this.drawnRouteIds = playerRouteIds;

    // A rival's network is deliberately faint, which makes "who else is here"
    // hard to read on a busy map. Hovering any of its arcs brings that carrier's
    // whole network up to full strength — the one moment a rival is allowed to
    // compete with the player's own arcs for attention.
    for (const path of this.arcLayer.querySelectorAll<SVGPathElement>('.arc-rival')) {
      path.addEventListener('mouseenter', () => this.focusCarrier(path.dataset['carrier'] ?? null));
      // Back to whatever is pinned, not to nothing.
      path.addEventListener('mouseleave', () => this.focusCarrier(this.pinnedCarrier));
    }

    // EVERY line is clickable, not only a rival's. Clicking a line to find out
    // what it is is the first thing anybody tries, and it did nothing whatever:
    // the click fell through to the map, which read it as picking the nearest
    // city and began building a route.
    for (const path of this.arcLayer.querySelectorAll<SVGPathElement>('.arc-hit')) {
      path.addEventListener('click', (event) => {
        // Beat the map's own handler, which is on the root and would otherwise
        // also fire and start a route from whatever city is nearest.
        event.stopPropagation();
        if (this.suppressClick) return;
        const routeId = path.dataset['route'];
        const carrierId = path.dataset['carrier'];
        if (routeId && carrierId) this.callbacks.onSelectRoute(routeId, carrierId);
      });
    }

    // The sector you are about to open, drawn as you consider it.
    if (selection.from && selection.hovered && selection.from !== selection.hovered) {
      const points = greatCirclePoints(getCity(selection.from), getCity(selection.hovered));
      for (const run of splitAtAntimeridian(points)) {
        this.arcLayer.append(el('path', { d: polyline(run.map(project)), class: 'arc arc-pending' }));
      }
    }
  }

  /** The carrier pinned from outside the map, if any. Hover overrides it briefly. */
  private pinnedCarrier: string | null = null;
  /** One sector held out from the rest, picked from a route list. */
  private highlighted: string | null = null;

  /** Bring one carrier's arcs to full strength; null returns them all to normal. */
  private focusCarrier(carrierId: string | null): void {
    for (const path of this.arcLayer.querySelectorAll<SVGPathElement>('.arc-rival')) {
      path.classList.toggle('is-carrier-focus', carrierId !== null && path.dataset['carrier'] === carrierId);
    }
  }

  /** Cities the PLAYER serves. Rival endpoints are not the player's network. */
  private playerCities(scene: MapScene): Set<CityId> {
    const playerId = scene.carriers.find((c) => c.isPlayer)?.id;
    const served = new Set<CityId>();
    for (const route of scene.routes) {
      if (route.carrierId !== playerId) continue;
      served.add(route.from);
      served.add(route.to);
    }
    return served;
  }

  private renderCities(scene: MapScene, selection: MapSelection): void {
    this.focusCarrier(this.pinnedCarrier);
    /*
     * Every segment of the picked sector, since one route can be several paths —
     * and everything else pushed back while one is picked.
     *
     * Without the second half the picked line was 3.4px among a pinned carrier's
     * six arcs all sitting at full opacity, which in a tight cluster of
     * short-haul sectors is not a highlight, it is a slightly fatter line in a
     * tangle. Asking for one sector should leave one sector to look at.
     */
    const picking = this.highlighted !== null;
    for (const path of this.arcLayer.querySelectorAll<SVGPathElement>('.arc')) {
      const isPicked = picking && path.dataset['route'] === this.highlighted;
      path.classList.toggle('is-route-focus', isPicked);
      path.classList.toggle('is-route-muted', picking && !isPicked);
    }
    this.cityLayer.replaceChildren();
    const served = this.playerCities(scene);

    for (const city of CITIES) {
      const p = project(city);
      const size = citySize(city);
      const classes = ['city'];
      if (served.has(city.id)) classes.push('city-served');
      if (city.id === selection.from) classes.push('city-origin');
      if (selection.from && selection.unavailable.has(city.id)) classes.push('city-unavailable');

      // Purely visual — clicks and hovers are resolved to the nearest city centre
      // at the map root (see cityAt), so overlapping marks can't steal each other's
      // clicks and there is nothing to listen on here.
      const group = el('g', { class: classes.join(' ') });
      group.append(
        el('rect', {
          x: p.x - size / 2,
          y: p.y - size / 2,
          width: size,
          height: size,
          class: 'city-mark',
        }),
      );

      this.cityLayer.append(group);
    }
  }

  /**
   * Labels only where they earn their space: cities the player serves, the
   * origin being chosen, and whatever is under the cursor. Labeling every
   * rival endpoint too would put a couple of hundred codes on the map.
   */
  private renderLabels(scene: MapScene, selection: MapSelection): void {
    this.labelLayer.replaceChildren();

    const show = this.playerCities(scene);
    if (selection.from) show.add(selection.from);
    if (selection.hovered) show.add(selection.hovered);

    for (const id of show) {
      const city = getCity(id);
      const p = project(city);
      const emphasized = id === selection.from || id === selection.hovered;

      const label = el('text', {
        x: p.x,
        y: p.y - 6,
        class: emphasized ? 'city-label city-label-strong' : 'city-label',
        'text-anchor': 'middle',
      });
      label.textContent = emphasized ? `${city.id} ${city.name}` : city.id;
      this.labelLayer.append(label);
    }
  }
}
