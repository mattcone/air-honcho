/**
 * The shell. Owns the current GameState, dispatches Actions into the sim, and
 * re-renders. All game logic lives behind sim/engine.ts — this file only knows
 * how to ask and how to draw the answer.
 */
import type { Action, AircraftType, Carrier, CityId, Difficulty, GameState, Ownership, PricingPosture } from '../sim/types.ts';
import { applyAction, endTurn, getCarrier, newGame, turnLabel } from '../sim/engine.ts';
import { CITIES, CONSTANTS, cityDistanceKm, getCity, hasCity } from '../sim/world.ts';
import { seasonalDemandFactor } from '../sim/demand.ts';
import {
  AIRCRAFT_TYPES, aircraftAvailable, ageYears, getAircraftType, leaseBreakFee, overhaulCost,
} from '../sim/fleet.ts';
import {
  assignedTo, buildMarketIndex, computeRouteEconomics, feedFactor, marketKey, rivalCapacityOf,
  rivalsOf, stationOverheadFor, technologyValue,
} from '../sim/economics.ts';
import { getArchetype } from '../sim/ai/archetype.ts';
import {
  conditionsFor, effectiveFuelPrice, klassesOf, marketFuelPrice, techEffects,
} from '../sim/conditions.ts';
import { getEvent } from '../sim/events.ts';
import { TECH_NODES, getTechNode, techStatus } from '../sim/tech.ts';
import type { MarketIndex } from '../sim/economics.ts';
import {
  autosave, clearAutosave, deleteSlot, deserialize, listSlots, loadAutosave, loadSlot,
  MAX_SLOTS, SaveError, saveSlot, serialize,
} from '../sim/save.ts';
import { RouteMap, type MapScene } from './map.ts';
import { renderInspector } from './inspector.ts';
import { buildBriefing, renderBriefing } from './briefing.ts';
import { markOnboardingSeen, nextStep, onboardingSeen, STEPS } from './onboarding.ts';
import { playAlert, playBadQuarter, playGoodQuarter, setSoundEnabled, soundEnabled } from './sound.ts';
import { tickNumber } from './ticker.ts';
import { prefersReducedMotion } from './motion.ts';
import { STRINGS } from './strings.ts';
import { routeWeights } from './arcweight.ts';
import { HOME_BASES } from './homebases.ts';
import {
  acquisitionCost, borrowingCapacity, commands, controlledBy, controls, creditRating,
  economicInterest, equityIssueDiscount, equityRaiseCeiling, interestRate, marketCap, sharePrice,
  stakePurchaseCeiling,
} from '../sim/market.ts';
import { MAP_ASPECT } from './projection.ts';
import { km, pct, rate, stake, techSummary, usd } from './format.ts';
import { quarterPanel, techPanel } from './techpanel.ts';

const EMPTY_SCENE: MapScene = { routes: [], carriers: [] };

export class App {
  private game: GameState | null = null;
  private from: CityId | null = null;
  private hovered: CityId | null = null;
  private selectedRouteId: string | null = null;
  /** Seed carried in from a shared link, spent on the next game started. */
  private pendingSeed: number | null = null;
  /** The control the live coaching note points at, so it can be re-placed. */
  private arcWeights: Map<string, number> = new Map();
  /** A rival whose network is pinned on the map, chosen from the sidebar list. */
  private focusedCarrier: string | null = null;
  /** One of their sectors picked out of the list, held brighter than the rest. */
  private highlightedRoute: string | null = null;
  /**
   * Routes with metal actually flying them. Recomputed with the board and reused
   * by the hover-only re-render, which must not walk the network again.
   */
  private flyingRoutes: Set<string> = new Set();
  private coachAnchor: string | null = null;
  /** Note the player has paged to with the arrows, or null to follow the game. */
  private coachIndex: number | null = null;
  /** The step the game says is live, so paging is dropped when it changes. */
  private coachLiveId: string | null = null;
  /** True once the player finished or dismissed the first-turn coaching. */
  private onboardingDone = onboardingSeen();
  /** The end-turn on which we last showed the verdict, so it pops once, not every render. */
  private verdictShownFor: number | null = null;
  /** Transient line under the panel heading. `error` is the only thing that goes red. */
  private message: { text: string; tone: 'info' | 'error' } = { text: '', tone: 'info' };
  private readonly map: RouteMap;

  private readonly nodes = {
    quarter: document.querySelector<HTMLElement>('#status-quarter')!,
    cash: document.querySelector<HTMLElement>('#status-cash')!,
    worth: document.querySelector<HTMLElement>('#status-worth')!,
    fleet: document.querySelector<HTMLElement>('#status-fleet')!,
    sectors: document.querySelector<HTMLElement>('#status-sectors')!,
    fuel: document.querySelector<HTMLElement>('#status-fuel')!,
    conditionsList: document.querySelector<HTMLElement>('#conditions-list')!,
    hedge: document.querySelector<HTMLButtonElement>('#hedge')!,
    tech: document.querySelector<HTMLButtonElement>('#tech')!,
    treasury: document.querySelector<HTMLButtonElement>('#treasury')!,
    treasuryDialog: document.querySelector<HTMLDialogElement>('#treasury-dialog')!,
    treasuryNote: document.querySelector<HTMLElement>('#treasury-note')!,
    treasuryFigures: document.querySelector<HTMLElement>('#treasury-figures')!,
    treasuryRivals: document.querySelector<HTMLElement>('#treasury-rivals')!,
    treasuryMarketNote: document.querySelector<HTMLElement>('#treasury-market-note')!,
    treasuryShareholders: document.querySelector<HTMLElement>('#treasury-shareholders')!,
    borrow: document.querySelector<HTMLButtonElement>('#borrow')!,
    repay: document.querySelector<HTMLButtonElement>('#repay')!,
    issueEquity: document.querySelector<HTMLButtonElement>('#issue-equity')!,
    ownDividend: document.querySelector<HTMLButtonElement>('#own-dividend')!,
    techDialog: document.querySelector<HTMLDialogElement>('#tech-dialog')!,
    techNote: document.querySelector<HTMLElement>('#tech-note')!,
    techBody: document.querySelector<HTMLElement>('#tech-body')!,
    techStanding: document.querySelector<HTMLElement>('#tech-standing')!,
    hint: document.querySelector<HTMLElement>('#hint')!,
    ledger: document.querySelector<HTMLElement>('#ledger')!,
    fleetList: document.querySelector<HTMLElement>('#fleet-list')!,
    rivalsList: document.querySelector<HTMLElement>('#rivals-list')!,
    rivalsDialog: document.querySelector<HTMLDialogElement>('#rivals-dialog')!,
    rivalsNote: document.querySelector<HTMLElement>('#rivals-note')!,
    rivalsBody: document.querySelector<HTMLElement>('#rivals-body')!,
    inspector: document.querySelector<HTMLElement>('#inspector')!,
    mapFrame: document.querySelector<HTMLElement>('#map-frame')!,
    zoomIn: document.querySelector<HTMLButtonElement>('#zoom-in')!,
    zoomOut: document.querySelector<HTMLButtonElement>('#zoom-out')!,
    acquire: document.querySelector<HTMLButtonElement>('#acquire')!,
    acquireDialog: document.querySelector<HTMLDialogElement>('#acquire-dialog')!,
    acquireNote: document.querySelector<HTMLElement>('#acquire-note')!,
    marketProvenance: document.querySelector<HTMLElement>('#market-provenance')!,
    amountDialog: document.querySelector<HTMLDialogElement>('#amount-dialog')!,
    amountTitle: document.querySelector<HTMLElement>('#amount-title')!,
    amountBlurb: document.querySelector<HTMLElement>('#amount-blurb')!,
    amountPresets: document.querySelector<HTMLElement>('#amount-presets')!,
    amountFieldLabel: document.querySelector<HTMLElement>('#amount-field-label')!,
    amountPrefix: document.querySelector<HTMLElement>('#amount-prefix')!,
    amountSuffix: document.querySelector<HTMLElement>('#amount-suffix')!,
    amountInput: document.querySelector<HTMLInputElement>('#amount-input')!,
    amountPreview: document.querySelector<HTMLElement>('#amount-preview')!,
    amountCancel: document.querySelector<HTMLButtonElement>('#amount-cancel')!,
    amountConfirm: document.querySelector<HTMLButtonElement>('#amount-confirm')!,
    choiceDialog: document.querySelector<HTMLDialogElement>('#choice-dialog')!,
    choiceTitle: document.querySelector<HTMLElement>('#choice-title')!,
    choiceBlurb: document.querySelector<HTMLElement>('#choice-blurb')!,
    choiceWarning: document.querySelector<HTMLElement>('#choice-warning')!,
    choiceActions: document.querySelector<HTMLElement>('#choice-actions')!,
    marketBody: document.querySelector<HTMLElement>('#market-body')!,
    closeBooks: document.querySelector<HTMLButtonElement>('#close-books')!,
    exportSave: document.querySelector<HTMLButtonElement>('#export-save')!,
    importSave: document.querySelector<HTMLButtonElement>('#import-save')!,
    newGame: document.querySelector<HTMLButtonElement>('#new-game')!,
    shareGame: document.querySelector<HTMLButtonElement>('#share-game')!,
    slots: document.querySelector<HTMLButtonElement>('#slots')!,
    rivalsReport: document.querySelector<HTMLButtonElement>('#rivals-report')!,
    sound: document.querySelector<HTMLButtonElement>('#sound')!,
    coach: document.querySelector<HTMLElement>('#coach')!,
    coachText: document.querySelector<HTMLElement>('#coach-text')!,
    coachStep: document.querySelector<HTMLElement>('#coach-step')!,
    coachDismiss: document.querySelector<HTMLButtonElement>('#coach-dismiss')!,
    coachPrev: document.querySelector<HTMLButtonElement>('#coach-prev')!,
    coachNext: document.querySelector<HTMLButtonElement>('#coach-next')!,
    slotsDialog: document.querySelector<HTMLDialogElement>('#slots-dialog')!,
    slotsList: document.querySelector<HTMLElement>('#slots-list')!,
    slotsNote: document.querySelector<HTMLElement>('#slots-note')!,
    slotSaveNew: document.querySelector<HTMLButtonElement>('#slot-save-new')!,
    fileInput: document.querySelector<HTMLInputElement>('#file-input')!,
    startDialog: document.querySelector<HTMLDialogElement>('#start-dialog')!,
    startScenario: document.querySelector<HTMLElement>('#start-scenario')!,
    startDifficulty: document.querySelector<HTMLElement>('#start-difficulty')!,
    startHome: document.querySelector<HTMLSelectElement>('#start-home-select')!,
    startHomeNote: document.querySelector<HTMLElement>('#start-home-note')!,
    startConfirm: document.querySelector<HTMLButtonElement>('#start-confirm')!,
    overDialog: document.querySelector<HTMLDialogElement>('#over-dialog')!,
    overEyebrow: document.querySelector<HTMLElement>('#over-eyebrow')!,
    overTitle: document.querySelector<HTMLElement>('#over-title')!,
    overReason: document.querySelector<HTMLElement>('#over-reason')!,
    overFigures: document.querySelector<HTMLElement>('#over-figures')!,
    overNew: document.querySelector<HTMLButtonElement>('#over-new')!,
    overDismiss: document.querySelector<HTMLButtonElement>('#over-dismiss')!,
    briefingDialog: document.querySelector<HTMLDialogElement>('#briefing-dialog')!,
    briefingTitle: document.querySelector<HTMLElement>('#briefing-title')!,
    briefingBody: document.querySelector<HTMLElement>('#briefing-body')!,
    briefingDismiss: document.querySelector<HTMLButtonElement>('#briefing-dismiss')!,
  };

  constructor() {
    this.map = new RouteMap({
      onSelectCity: (id) => this.selectCity(id),
      onHoverCity: (id) => this.hoverCity(id),
      /*
       * A line on the map was clicked. Your own sector opens its dossier, exactly
       * as picking it from the schedule does. A rival's pins that carrier, picks
       * the sector out, and puts their network in the pane — the same three
       * things clicking through the sidebar does, reached the obvious way round.
       */
      onSelectRoute: (routeId, carrierId) => {
        if (!this.game) return;
        if (carrierId === this.game.playerCarrierId) {
          this.selectedRouteId = this.selectedRouteId === routeId ? null : routeId;
          this.focusedCarrier = null;
        } else {
          const same = this.focusedCarrier === carrierId && this.highlightedRoute === routeId;
          this.selectedRouteId = null;
          this.focusedCarrier = same ? null : carrierId;
          this.highlightedRoute = same ? null : routeId;
        }
        this.render();
      },
      onZoomChange: () => this.syncZoomButtons(),
    });
    // The frame's aspect comes from the projection itself, so the plate is never
    // letterboxed against empty paper and the two cannot drift apart.
    this.nodes.mapFrame.style.setProperty('--map-aspect', MAP_ASPECT.toFixed(4));
    this.nodes.mapFrame.append(this.map.root);

    this.nodes.zoomIn.addEventListener('click', () => this.map.zoomIn());
    this.nodes.zoomOut.addEventListener('click', () => this.map.zoomOut());
    this.syncZoomButtons();

    this.nodes.closeBooks.addEventListener('click', () => this.closeBooks());
    this.nodes.exportSave.addEventListener('click', () => this.exportSave());
    this.nodes.importSave.addEventListener('click', () => this.nodes.fileInput.click());
    this.nodes.newGame.addEventListener('click', () => this.startNewGame());
    this.nodes.startConfirm.addEventListener('click', () => this.startChosenGame());
    // The new-game screen is not dismissable into an empty board: there is nothing
    // to do behind it. Escape re-opens it rather than leaving the player stranded.
    this.nodes.startDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
    });
    this.nodes.shareGame.addEventListener('click', () => void this.copyShareLink());
    this.nodes.slots.addEventListener('click', () => this.openSlots());
    this.nodes.rivalsReport.addEventListener('click', () => this.openRivals());
    this.nodes.sound.addEventListener('click', () => {
      setSoundEnabled(!soundEnabled());
      this.syncSoundButton();
      if (soundEnabled()) playGoodQuarter(); // confirm it works, at the moment they ask for it
    });
    this.syncSoundButton();
    this.nodes.coachDismiss.addEventListener('click', () => this.dismissOnboarding());
    this.nodes.coachPrev.addEventListener('click', () => this.pageCoach(-1));
    this.nodes.coachNext.addEventListener('click', () => this.pageCoach(1));
    this.nodes.slotSaveNew.addEventListener('click', () => this.saveToNewSlot());
    this.nodes.fileInput.addEventListener('change', () => void this.importSave());
    this.nodes.acquire.addEventListener('click', () => this.openMarket());
    this.nodes.tech.addEventListener('click', () => this.openTech());
    this.nodes.hedge.addEventListener('click', () => this.hedgeFuel());
    this.nodes.treasury.addEventListener('click', () => this.openTreasury());
    this.nodes.borrow.addEventListener('click', () => this.financeAmount('BORROW'));
    this.nodes.repay.addEventListener('click', () => this.financeAmount('REPAY_DEBT'));
    this.nodes.issueEquity.addEventListener('click', () => this.financeAmount('ISSUE_EQUITY'));
    this.nodes.ownDividend.addEventListener('click', () => this.setDividend(this.game?.playerCarrierId ?? ''));
    this.nodes.overNew.addEventListener('click', () => {
      this.nodes.overDialog.close();
      this.startNewGame();
    });
    this.nodes.overDismiss.addEventListener('click', () => this.nodes.overDialog.close());
    this.nodes.briefingDismiss.addEventListener('click', () => this.nodes.briefingDialog.close());

    document.addEventListener('keydown', (event) => this.onKey(event));
    // A note is placed in viewport coordinates, so a resize strands it away from
    // the control it points at until the next render.
    window.addEventListener('resize', () => {
      if (!this.onboardingDone && this.coachAnchor) this.positionCoach(this.coachAnchor);
    });

    this.game = loadAutosave();
    if (this.game) this.say('Resumed from your last autosave.');
    // A shared link only applies to a fresh start; it never overwrites a game in
    // progress without the player choosing New game first.
    else this.applySharedLink();
    this.render();
    // Nothing to resume means a first visit, which is exactly who the new-game
    // screen is written for. Opened after the first render so the board is drawn
    // behind it rather than appearing when it closes.
    if (!this.game) this.openStartDialog();
  }

  // --- Intent ---------------------------------------------------------------

  private selectCity(id: CityId): void {
    if (id === '') {
      this.from = null;
      this.selectedRouteId = null;
      this.render();
      return;
    }

    // No game yet: the board is not a chooser any more. The home base is picked on
    // the new-game screen, with the figures for each option in front of the player,
    // so a click on an empty map brings that back rather than quietly starting a
    // game on whichever dot was under the cursor.
    if (!this.game) {
      this.openStartDialog();
      return;
    }

    // Clicking a city you already serve selects that sector.
    if (!this.from) {
      const serving = this.game.routes.find(
        (r) => r.carrierId === this.game!.playerCarrierId && (r.from === id || r.to === id),
      );
      if (serving && this.selectedRouteId !== serving.id) {
        this.selectedRouteId = serving.id;
        this.prospect = null;
        this.from = null;
        this.say('');
        this.render();
        return;
      }
      this.from = id;
      this.prospect = null;
      this.say('');
      this.render();
      return;
    }

    if (this.from === id) {
      this.from = null;
      this.render();
      return;
    }

    /*
     * Two clicks PROPOSE a sector; they no longer open one.
     *
     * Opening spends real money — a station somewhere new costs multiples of the
     * base fee — and a click-click gesture that silently commits eight figures is
     * not a decision the player got to make. So the second click selects the pair
     * and the pane under the map does what it does for every other sector: says
     * what this one is, what it costs, and what would fly it. Committing is a
     * button, deliberately pressed.
     */
    this.prospect = { from: this.from, to: id };
    this.selectedRouteId = null;
    this.focusedCarrier = null;
    this.from = null;
    this.render();
  }

  /** Commit the proposed sector. The only path from a prospect to a real route. */
  private openProspect(): void {
    if (!this.game || !this.prospect) return;
    const { from, to } = this.prospect;
    this.dispatch({ type: 'OPEN_ROUTE', carrierId: this.game.playerCarrierId, from, to }, () => {
      // Look the new sector up rather than rebuilding the sim's id format here:
      // duplicating that rule would fail silently the day the engine changes it.
      const opened = this.game!.routes.find(
        (r) =>
          r.carrierId === this.game!.playerCarrierId &&
          ((r.from === from && r.to === to) || (r.from === to && r.to === from)),
      );
      this.prospect = null;
      this.selectedRouteId = opened?.id ?? null;
      this.say('Sector open. Assign an aircraft to start flying it.');
    });
  }

  private hoverCity(id: CityId | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    // Only the map depends on hover; skip the full re-render.
    this.map.render(this.scene(this.game), this.selection());
  }

  /**
   * Keyboard shortcuts. Single letters for the panels a CEO opens every quarter,
   * Enter to close the books, Escape to back out. Deliberately unmodified keys —
   * this is a game, not a text editor — but suppressed whenever the player is
   * typing into a field or a modal is up, so a shortcut can never fire under a
   * dialog the player thinks they are answering.
   */
  private onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    if (event.key === 'Escape') {
      // Escape backs out one step at a time: the half-made sector first, then the
      // selected one. Open dialogs handle their own Escape natively.
      if (this.from) {
        this.from = null;
        this.render();
      } else if (this.prospect) {
        this.prospect = null;
        this.render();
      } else if (this.selectedRouteId) {
        this.selectedRouteId = null;
        this.render();
      }
      return;
    }

    // A modal owns the keyboard while it is up.
    if (document.querySelector('dialog[open]')) return;

    const act: Record<string, () => void> = {
      Enter: () => this.closeBooks(),
      t: () => this.openTreasury(),
      r: () => this.openRivals(),
      f: () => this.openMarket(),
      y: () => this.openTech(),
      '?': () => this.showShortcuts(),
      '+': () => { this.map.zoomIn(); },
      '=': () => { this.map.zoomIn(); },
      '-': () => { this.map.zoomOut(); },
    };
    const run = act[event.key] ?? act[event.key.toLowerCase()];
    if (!run) return;
    event.preventDefault();
    run();
  }

  /**
   * Seed sharing. The whole game is a pure function of (seed, scenario,
   * difficulty, home city), so a link carrying those four is the entire game —
   * the same rivals, the same shocks, the same aircraft timeline. Two people can
   * play identical worlds and compare what they built, which is the payoff of
   * having been deterministic from day one.
   */
  private shareLink(): string | null {
    const game = this.game;
    if (!game) return null;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('seed', String(game.seed));
    url.searchParams.set('home', getCarrier(game, game.playerCarrierId).homeCityId);
    url.searchParams.set('scenario', game.scenario);
    url.searchParams.set('difficulty', game.difficulty);
    return url.toString();
  }

  private async copyShareLink(): Promise<void> {
    const link = this.shareLink();
    if (!link) {
      this.say('Start a game first — then you can share it.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.say('Link copied. Whoever opens it plays this exact world.');
    } catch {
      // Clipboard blocked (insecure origin, or the user said no). Show it instead
      // so the link is never simply lost.
      window.prompt('Copy this link to share the exact game:', link);
    }
  }

  /**
   * Apply a shared link, if the page was opened with one: preselect the scenario
   * and difficulty and hold the seed for the home city the player is about to pick.
   * The city travels in the link too, so following one lands on the same board.
   */
  private applySharedLink(): void {
    const params = new URLSearchParams(window.location.search);
    // Check for the parameter before reading it as a number: Number(null) is 0,
    // which would make every ordinary visit look like a share of seed 0 — one
    // fixed world for every new player, announced as a shared game.
    const raw = params.get('seed');
    if (raw === null || raw.trim() === '') return; // Number('') is 0 for the same reason
    const seed = Number(raw);
    if (!Number.isInteger(seed) || seed < 0) return;
    this.pendingSeed = seed;

    const scenario = params.get('scenario');
    if (scenario === 'present' || scenario === 'history') {
      const input = this.nodes.startScenario.querySelector<HTMLInputElement>(`input[value="${scenario}"]`);
      if (input) input.checked = true;
    }
    const difficulty = params.get('difficulty');
    if (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') {
      const input = this.nodes.startDifficulty.querySelector<HTMLInputElement>(`input[value="${difficulty}"]`);
      if (input) input.checked = true;
    }
    const home = params.get('home');
    if (home && hasCity(home)) {
      this.say(`Shared game — click ${getCity(home).name} to fly it.`);
    } else {
      this.say('Shared game — pick your home city to begin.');
    }
  }

  /**
   * Save slots. The autosave is a safety net; a slot is a decision — the save you
   * take before betting the company on a widebody order, so you can come back and
   * play the other branch of the same seeded world.
   */
  private openSlots(): void {
    this.renderSlots();
    if (!this.nodes.slotsDialog.open) this.nodes.slotsDialog.showModal();
  }

  private renderSlots(): void {
    const list = this.nodes.slotsList;
    list.replaceChildren();
    const slots = listSlots();

    this.nodes.slotsNote.textContent = slots.length === 0
      ? STRINGS.empty.slots
      : `${slots.length} of ${MAX_SLOTS} slots used. Loading one replaces the game in progress.`;

    for (const slot of slots) {
      const row = document.createElement('div');
      row.className = 'slot-row';

      const name = document.createElement('span');
      name.className = 'slot-name';
      name.textContent = slot.name;

      const detail = document.createElement('span');
      detail.className = 'slot-detail';
      detail.textContent =
        `${turnLabel(slot.turn, slot.startYear)} · ${slot.scenario === 'history' ? 'History' : 'Present'} · ` +
        `${slot.difficulty}`;

      const actions = document.createElement('span');
      actions.className = 'slot-actions';
      actions.append(
        this.marketButton('Load', true, () => this.loadFromSlot(slot.name), `Load ${slot.name}`),
        this.marketButton('Save', this.game !== null, () => this.writeSlot(slot.name), `Overwrite ${slot.name} with the current game`),
        this.marketButton('Delete', true, () => {
          if (!confirm(`Delete the slot "${slot.name}"? This cannot be undone.`)) return;
          deleteSlot(slot.name);
          this.renderSlots();
        }, `Delete ${slot.name}`),
      );

      row.append(name, detail, actions);
      list.append(row);
    }

    this.nodes.slotSaveNew.disabled = this.game === null || slots.length >= MAX_SLOTS;
  }

  private writeSlot(name: string): void {
    if (!this.game) return;
    if (!saveSlot(name, this.game)) {
      this.say('Could not write that slot — storage may be full or unavailable.', 'error');
      return;
    }
    this.say(`Saved to "${name}".`);
    this.renderSlots();
  }

  private loadFromSlot(name: string): void {
    if (this.game && !confirm(`Load "${name}"? The game in progress will be discarded.`)) return;
    try {
      const loaded = loadSlot(name);
      if (!loaded) {
        this.say('That slot is empty.', 'error');
        return;
      }
      this.game = loaded;
      this.from = null;
      this.selectedRouteId = null;
      this.verdictShownFor = null;
      this.nodes.slotsDialog.close();
      this.say(`Loaded "${name}".`);
      this.commit();
    } catch (err) {
      this.say(err instanceof Error ? err.message : 'That slot could not be read.', 'error');
    }
  }

  private saveToNewSlot(): void {
    if (!this.game) return;
    const suggested = `${this.game.scenario === 'history' ? 'History' : 'Present'} ${turnLabel(this.game.turn, this.game.startYear)}`;
    const name = window.prompt('Name this save:', suggested);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      this.say('A slot needs a name.', 'error');
      return;
    }
    if (listSlots().some((s) => s.name === trimmed) && !confirm(`"${trimmed}" already exists. Overwrite it?`)) return;
    this.writeSlot(trimmed);
  }

  /**
   * Show the note for whatever the player has not done yet, anchored under its
   * control. Called after every render, so it follows the game rather than a
   * script — work a step out for yourself and its note never appears.
   */
  private renderOnboarding(): void {
    const tip = this.nodes.coach;
    if (this.onboardingDone) {
      tip.hidden = true;
      return;
    }
    /*
     * No game yet means the start dialog is up. Hide the note — it would render
     * behind that dialog, which showModal() puts in the browser's top layer — but
     * return BEFORE the retirement branch below.
     *
     * `nextStep` returns null both for "not started" and for "finished", and only
     * the second should retire the sequence. Letting the first fall through would
     * call markOnboardingSeen() on first paint, writing to localStorage before the
     * player has begun, and every new player would silently lose the coaching.
     */
    if (this.game === null) {
      tip.hidden = true;
      return;
    }
    // The LIVE step is still whatever the game says you have not done — reading
    // ahead never marks anything done, and the sequence still retires on real
    // state rather than on how far you paged.
    const live = nextStep(this.game);
    if (!live) {
      this.onboardingDone = true;
      markOnboardingSeen();
      tip.hidden = true;
      return;
    }
    // Doing the thing snaps the note back to what is next, which is the whole job
    // of the coaching. Paging holds only until the game moves on.
    if (live.id !== this.coachLiveId) {
      this.coachLiveId = live.id;
      this.coachIndex = null;
    }

    const step = this.coachIndex === null ? live : (STEPS[this.coachIndex] ?? live);
    const anchor = document.querySelector(step.anchor);
    if (!anchor) {
      tip.hidden = true;
      return;
    }

    const at = STEPS.indexOf(step);
    const browsing = step.id !== live.id;
    this.nodes.coachText.textContent = step.text;
    // Copy belongs in strings.ts, not in a CSS `content:` — it was the one line of
    // interface text this session put somewhere item 7 could not reach it.
    this.nodes.coachStep.textContent = browsing
      ? `${at + 1}/${STEPS.length} · ${STRINGS.coach.readingAhead}`
      : `${at + 1}/${STEPS.length}`;
    this.nodes.coachPrev.disabled = at <= 0;
    this.nodes.coachNext.disabled = at >= STEPS.length - 1;
    // A note you have paged to is one you are reading rather than acting on; say
    // so, so "3/5" while standing on step 1 is not simply confusing.
    tip.classList.toggle('is-browsing', browsing);
    tip.hidden = false;
    this.positionCoach(step.anchor);

    // The rail is still settling when this render returns — panels fill, the web
    // font lands, the ledger grows — and the anchor moves out from under a note
    // placed against its old rect. Measure again once the browser has laid the
    // frame out, or the note points at where the control USED to be.
    this.coachAnchor = step.anchor;
    requestAnimationFrame(() => {
      if (!this.onboardingDone && this.coachAnchor) this.positionCoach(this.coachAnchor);
    });
  }

  /** Place the note under its control, clamped into the viewport. */
  private positionCoach(anchorSelector: string): void {
    const tip = this.nodes.coach;
    const anchor = document.querySelector(anchorSelector);
    if (!anchor || tip.hidden) return;

    const box = anchor.getBoundingClientRect();
    const own = tip.getBoundingClientRect();
    const gap = 10;
    const left = Math.min(
      Math.max(gap, box.left + box.width / 2 - own.width / 2),
      window.innerWidth - own.width - gap,
    );

    // Below by preference, above when there is no room for it — and when both fit,
    // whichever side sits on fewer controls. The note itself no longer takes clicks,
    // but its "Got it" does, and one laid over Export is a misclick waiting to happen.
    const below = box.bottom + gap;
    const above = box.top - own.height - gap;
    const fitsBelow = below + own.height <= window.innerHeight - gap;
    const fitsAbove = above >= gap;
    let top: number;
    if (fitsBelow && fitsAbove) {
      top = this.controlsUnder(left, below, own) <= this.controlsUnder(left, above, own) ? below : above;
    } else {
      top = fitsBelow ? below : above;
    }

    // Clamped into the viewport whatever the anchor did. A control scrolled out of
    // its pane reports a rect off the bottom of the window, and both candidates
    // then land off-screen too — which put the note, and its buttons, somewhere
    // nobody could reach. A note pointing approximately at its control beats a
    // note that cannot be seen.
    const maxTop = Math.max(gap, window.innerHeight - own.height - gap);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.min(Math.max(gap, top), maxTop))}px`;
  }

  /** How many controls a note placed here would cover. Used to pick a side. */
  private controlsUnder(left: number, top: number, own: DOMRect): number {
    const right = left + own.width;
    const bottom = top + own.height;
    let hits = 0;
    for (const el of document.querySelectorAll('button, input, select')) {
      if (el.closest('#coach')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) hits += 1;
    }
    return hits;
  }

  /** Page the coaching one note either way, clamped to the ends. */
  private pageCoach(delta: number): void {
    const live = nextStep(this.game);
    const from = this.coachIndex ?? (live ? STEPS.indexOf(live) : 0);
    this.coachIndex = Math.max(0, Math.min(STEPS.length - 1, from + delta));
    this.renderOnboarding();
  }

  private dismissOnboarding(): void {
    this.onboardingDone = true;
    this.coachAnchor = null;
    this.coachIndex = null;
    markOnboardingSeen();
    this.nodes.coach.hidden = true;
  }

  private syncSoundButton(): void {
    const on = soundEnabled();
    this.nodes.sound.textContent = on ? 'Sound on' : 'Sound off';
    this.nodes.sound.setAttribute('aria-pressed', String(on));
  }

  private showShortcuts(): void {
    this.say(
      'Keys — Enter: close the books · T: treasury · R: rivals · F: fleet market · Y: technology · +/−: zoom · Esc: back out',
    );
  }

  /** Grey out a zoom button when the map is at that limit. */
  private syncZoomButtons(): void {
    this.nodes.zoomIn.disabled = !this.map.canZoomIn;
    this.nodes.zoomOut.disabled = !this.map.canZoomOut;
  }

  private dispatch(action: Action, onSuccess?: () => void): void {
    if (!this.game) return;
    const result = applyAction(this.game, action);
    if (result.ok) {
      this.game = result.state;
      this.say('');
      onSuccess?.();
    } else {
      this.say(result.error ?? 'That is not a legal move.', 'error');
    }
    this.commit();
  }

  /**
   * Closing the books is the one moment in a quarter that deserves a beat.
   *
   * The board dims while the quarter settles, the masthead figures roll rather
   * than jump (tickNumber, already), the ledger rows come back top to bottom, and
   * the briefing presents itself before anything is clickable again. None of it is
   * load-bearing: under prefers-reduced-motion every step collapses to an instant
   * swap and the game plays identically.
   */
  private settleCeremony(): void {
    if (prefersReducedMotion()) return;
    const board = document.querySelector<HTMLElement>('.board');
    if (!board) return;
    board.classList.add('is-settling');
    window.setTimeout(() => board.classList.remove('is-settling'), 420);

    // The ledger returns a row at a time, so the eye follows the schedule down
    // rather than being handed a whole new table at once.
    const rows = this.nodes.ledger.querySelectorAll<HTMLElement>('tr');
    rows.forEach((row, i) => {
      row.style.setProperty('--stagger', `${Math.min(i * 45, 400)}ms`);
      row.classList.remove('is-restaged');
      // Reading offsetWidth restarts the animation on a row that already has it.
      void row.offsetWidth;
      row.classList.add('is-restaged');
    });
  }

  private closeBooks(): void {
    if (!this.game || this.game.gameOver) return;
    const before = this.game.turn;
    const prev = this.game; // immutable — safe to diff against after the turn
    this.game = endTurn(this.game);
    this.say(`${turnLabel(before, this.game.startYear)} closed.`);
    // The quarter's verdict, as a sound: risen for a profit, fallen for a loss.
    const closed = this.game.history.filter((h) => h.carrierId === this.game!.playerCarrierId).at(-1);
    if (closed) (closed.netIncome >= 0 ? playGoodQuarter : playBadQuarter)();
    this.commit();
    // After commit, so the ledger the stagger animates is the new quarter's.
    this.settleCeremony();
    // The board briefing reports what changed this quarter. On a turn that ends
    // the game the verdict card (shown by commit) is the terminal briefing, so
    // the quarterly one stands down.
    if (!this.game.gameOver) this.showBriefing(prev, this.game);
  }

  private showBriefing(prev: GameState, next: GameState): void {
    const briefing = buildBriefing(prev, next);
    this.nodes.briefingTitle.textContent = briefing.quarterLabel;
    renderBriefing(this.nodes.briefingBody, briefing);
    // A danger alert is a way to lose the game telegraphing itself — a raider at
    // the door, or the bank about to run dry. It gets a sound of its own, after
    // the quarter's chime has died away rather than over it. Warnings do not: the
    // briefing is full of those, and an alarm that cries every quarter is furniture.
    if (briefing.alerts.some((a) => a.tone === 'danger')) playAlert(0.9);
    if (!this.nodes.briefingDialog.open) this.nodes.briefingDialog.showModal();
  }

  /** The scenario the player has selected on the pre-game chooser. */
  private chosenScenario(): 'present' | 'history' {
    const picked = this.nodes.startScenario.querySelector<HTMLInputElement>(
      'input[name="start-scenario"]:checked',
    );
    return picked?.value === 'history' ? 'history' : 'present';
  }

  /** The difficulty the player has selected on the pre-game chooser. */
  private chosenDifficulty(): Difficulty {
    const picked = this.nodes.startDifficulty.querySelector<HTMLInputElement>(
      'input[name="start-difficulty"]:checked',
    );
    return picked?.value === 'easy' || picked?.value === 'hard' ? picked.value : 'medium';
  }

  private startNewGame(): void {
    if (this.game && !confirm('Start a new game? The current one will be discarded.')) return;
    clearAutosave();
    this.game = null;
    this.from = null;
    this.prospect = null;
    this.selectedRouteId = null;
    this.focusedCarrier = null;
    this.verdictShownFor = null;
    this.say('');
    this.render();
    this.openStartDialog();
  }

  /*
   * The new-game screen.
   *
   * The board used to open empty with two radio fieldsets tucked into the schedule
   * panel and no statement anywhere of what the game was, who the player was, or
   * how it ended — the home base was chosen by clicking one of two hundred
   * identical dots on a map, which is not a decision anyone could make on turn one.
   * This states the job, states the win and lose conditions, and offers ten bases
   * that genuinely play differently, each with the figures behind it.
   */
  private openStartDialog(): void {
    const select = this.nodes.startHome;
    if (select.options.length === 0) {
      for (const base of HOME_BASES) {
        const city = getCity(base.id);
        const option = document.createElement('option');
        option.value = base.id;
        option.textContent = `${city.name}, ${city.country}`;
        select.append(option);
      }
      select.addEventListener('change', () => this.renderHomeNote());
    }
    this.renderHomeNote();
    if (!this.nodes.startDialog.open) this.nodes.startDialog.showModal();
  }

  /** The note under the dropdown: what this base is like to fly out of. */
  private renderHomeNote(): void {
    const base = HOME_BASES.find((b) => b.id === this.nodes.startHome.value);
    this.nodes.startHomeNote.textContent = base?.note ?? '';
  }

  /** Commit the new-game screen: this is the only place a game is created. */
  private startChosenGame(): void {
    const home = this.nodes.startHome.value;
    if (!hasCity(home)) return;
    // Math.random is fine here — the UI picks the seed, the sim never rolls one.
    const seed = this.pendingSeed ?? Math.floor(Math.random() * 2 ** 31);
    this.pendingSeed = null;
    this.game = newGame(seed, home, undefined, {
      scenario: this.chosenScenario(),
      difficulty: this.chosenDifficulty(),
    });
    this.verdictShownFor = null;
    if (this.nodes.startDialog.open) this.nodes.startDialog.close();
    this.say(`${getCity(home).name} is your home base. Lease an aircraft, then open a sector.`);
    this.commit();
  }

  private exportSave(): void {
    if (!this.game) return;
    const blob = new Blob([serialize(this.game)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `air-honcho-${this.game.scenario}-q${this.game.turn}.json`;
    link.click();
    // Revoked on the next tick, not synchronously: some browsers have not started
    // reading the blob when click() returns, and pulling the URL out from under
    // them fails the download silently.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.say('Save exported.');
    this.render();
  }

  private async importSave(): Promise<void> {
    const file = this.nodes.fileInput.files?.[0];
    if (!file) return;
    try {
      this.game = deserialize(await file.text());
      this.from = null;
      this.selectedRouteId = null;
      this.verdictShownFor = null;
      this.say(`Loaded ${turnLabel(this.game.turn, this.game.startYear)}.`);
      this.commit();
    } catch (error) {
      this.say(error instanceof SaveError ? error.message : 'That file could not be read.', 'error');
      this.render();
    } finally {
      // Let the same file be picked again after a failure.
      this.nodes.fileInput.value = '';
    }
  }

  private say(text: string, tone: 'info' | 'error' = 'info'): void {
    this.message = { text, tone };
  }

  /** Persist and redraw. Every state change ends here. */
  private commit(): void {
    if (this.game) autosave(this.game);
    this.render();
  }

  // --- Ask dialogs ----------------------------------------------------------
  //
  // Every capital decision used to be a window.prompt. A prompt cannot show the
  // ceiling, cannot offer a default worth accepting, and cannot say what the
  // number will do — so the player typed millions into an empty box and learned
  // the answer from an error toast. Worse, `confirm` has exactly two outcomes,
  // which is how "OK to fund with debt, Cancel to pay cash" ended up with no way
  // to abandon an acquisition at all.

  /**
   * Ask for a number. Resolves to the value in base units (dollars, or a rate
   * 0-1 for a percentage ask), or null if the player backed out.
   */
  private askAmount(spec: {
    title: string;
    blurb: string;
    /** 'usd' shows millions in the field; 'pct' shows whole percent. */
    unit: 'usd' | 'pct';
    /** Ceiling in base units. Offered as Maximum, and used to clamp. */
    max: number;
    initial?: number;
    /** Quick picks, in base units. */
    presets?: ReadonlyArray<{ label: string; value: number }>;
    /** What this amount would do. The reason these dialogs exist. */
    preview?: (value: number) => string;
    confirmLabel?: string;
    /** Zero is a real answer for some asks (a dividend of none). */
    allowZero?: boolean;
  }): Promise<number | null> {
    const n = this.nodes;
    const floor = spec.allowZero ? 0 : 1e-9;
    /*
     * The field's precision has to be able to express the ceiling, or the dialog
     * refuses its own maximum.
     *
     * It was two decimals of a millions field always — one step of $10k — which is
     * right for the usual eight- and nine-figure asks and silently broken below
     * them. Any ceiling under $10k rounded DOWN to zero, so "Maximum" set the field
     * to nothing and Confirm stayed greyed: the dialog could not express a single
     * valid amount. Reachable on a small stake sale or a repayment against a nearly
     * empty account. Decimals now follow the size of the ask, so the step is always
     * fine enough to land on the ceiling exactly, and the common case is unchanged.
     */
    const decimals = spec.unit === 'usd'
      ? (spec.max >= 1e6 ? 2 : spec.max >= 1e5 ? 3 : 4)
      : 2;
    const step = spec.unit === 'usd' ? 10 ** (6 - decimals) : 1e-4;
    const toStep = (v: number): number => Math.floor(v / step) * step;
    const toField = (v: number): number => (spec.unit === 'usd' ? v / 1e6 : v * 100);
    const toBase = (v: number): number => (spec.unit === 'usd' ? v * 1e6 : v / 100);

    n.amountTitle.textContent = spec.title;
    n.amountBlurb.textContent = spec.blurb;
    n.amountFieldLabel.textContent = spec.unit === 'usd' ? 'Amount' : 'Rate';
    n.amountPrefix.textContent = spec.unit === 'usd' ? '$' : '';
    n.amountSuffix.textContent = spec.unit === 'usd' ? 'million' : '%';
    n.amountConfirm.textContent = spec.confirmLabel ?? 'Confirm';

    const presets = [
      ...(spec.presets ?? []),
      ...(spec.max > 0 ? [{ label: 'Maximum', value: spec.max }] : []),
    ].filter((p) => p.value > 0 || spec.unit === 'pct');

    n.amountPresets.replaceChildren();
    const buttons: HTMLButtonElement[] = [];
    for (const preset of presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ask-preset';
      b.textContent = preset.label;
      // Out-of-reach presets stay on screen, greyed. Dropping them hid the fact
      // that a per-quarter cap exists at all: a player who could not afford 5% of
      // a carrier just saw "Maximum" and no hint of why.
      b.disabled = spec.max <= 0 || preset.value > spec.max + step;
      if (b.disabled && spec.max > 0) b.title = 'More than you can commit this quarter.';
      b.addEventListener('click', () => {
        // The value the field is actually set to, remembered so the highlight can
        // compare like with like — see `update`.
        const snapped = toStep(preset.value);
        n.amountInput.value = String(Number(toField(snapped).toFixed(decimals)));
        update();
      });
      buttons.push(b);
      n.amountPresets.append(b);
    }

    const readValue = (): number => toBase(Number(n.amountInput.value));
    const update = (): void => {
      const value = readValue();
      const valid = Number.isFinite(value) && value >= floor && value <= spec.max + step;
      n.amountConfirm.disabled = !valid;
      /*
       * Light the preset the field currently matches.
       *
       * Compared against the STEPPED value, which is what clicking actually sets.
       * Against the raw preset it was comparing 12.345678 with the 12.34 in the
       * field and calling them different, so "Maximum" went dark the instant it was
       * pressed on any ceiling that was not already a round number — which reads as
       * a button that does nothing.
       */
      buttons.forEach((b, i) => {
        const p = presets[i]!;
        const shown = Number(toField(toStep(p.value)).toFixed(decimals));
        b.classList.toggle('is-on', Math.abs(shown - Number(n.amountInput.value)) < step / 2e6);
      });
      if (!Number.isFinite(value) || value < floor) {
        n.amountPreview.textContent = '';
        n.amountPreview.classList.remove('is-error');
        return;
      }
      if (value > spec.max + step) {
        n.amountPreview.textContent =
          spec.unit === 'usd'
            ? `That is more than the ${usd(spec.max)} available.`
            : `The most you can set is ${pct(spec.max)}.`;
        n.amountPreview.classList.add('is-error');
        return;
      }
      n.amountPreview.classList.remove('is-error');
      n.amountPreview.textContent = spec.preview ? spec.preview(value) : '';
    };

    n.amountInput.value = spec.initial !== undefined
      ? String(Number(toField(toStep(spec.initial)).toFixed(decimals)))
      : '';
    update();

    return new Promise<number | null>((resolve) => {
      const finish = (value: number | null): void => {
        n.amountInput.removeEventListener('input', update);
        n.amountConfirm.removeEventListener('click', onConfirm);
        n.amountCancel.removeEventListener('click', onCancel);
        n.amountDialog.removeEventListener('close', onCancel);
        n.amountInput.removeEventListener('keydown', onKey);
        if (n.amountDialog.open) n.amountDialog.close();
        resolve(value);
      };
      const onConfirm = (): void => {
        const value = readValue();
        if (!Number.isFinite(value) || value < floor || value > spec.max + step) return;
        finish(Math.min(value, spec.max));
      };
      const onCancel = (): void => finish(null);
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      };
      n.amountInput.addEventListener('input', update);
      n.amountConfirm.addEventListener('click', onConfirm);
      n.amountCancel.addEventListener('click', onCancel);
      n.amountDialog.addEventListener('close', onCancel);
      n.amountInput.addEventListener('keydown', onKey);
      n.amountDialog.showModal();
      n.amountInput.focus();
      n.amountInput.select();
    });
  }

  /**
   * Ask the player to pick one of several courses. Resolves to the chosen id, or
   * null if they backed out — which is a real outcome here, unlike `confirm`.
   */
  private askChoice(spec: {
    title: string;
    blurb: string;
    warning?: string | undefined;
    options: ReadonlyArray<{ id: string; label: string; detail?: string; primary?: boolean }>;
  }): Promise<string | null> {
    const n = this.nodes;
    n.choiceTitle.textContent = spec.title;
    n.choiceBlurb.textContent = spec.blurb;
    n.choiceWarning.textContent = spec.warning ?? '';
    n.choiceWarning.hidden = !spec.warning;

    return new Promise<string | null>((resolve) => {
      const finish = (value: string | null): void => {
        n.choiceDialog.removeEventListener('close', onClose);
        if (n.choiceDialog.open) n.choiceDialog.close();
        resolve(value);
      };
      const onClose = (): void => finish(null);
      n.choiceActions.replaceChildren();
      for (const option of spec.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ask-choice' + (option.primary ? ' ask-choice--primary' : '');
        b.textContent = option.label;
        if (option.detail) {
          const small = document.createElement('small');
          small.textContent = option.detail;
          b.append(small);
        }
        b.addEventListener('click', () => finish(option.id));
        n.choiceActions.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ask-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => finish(null));
      n.choiceActions.append(cancel);

      n.choiceDialog.addEventListener('close', onClose);
      n.choiceDialog.showModal();
    });
  }

  // --- Aircraft market ------------------------------------------------------

  private openMarket(): void {
    if (!this.game) return;
    this.renderMarket();
    this.nodes.acquireDialog.showModal();
  }

  private acquire(typeId: string, ownership: Ownership, distressed = false): void {
    if (!this.game) return;
    const type = getAircraftType(typeId);
    this.dispatch(
      { type: 'ACQUIRE_AIRCRAFT', carrierId: this.game.playerCarrierId, typeId, ownership, distressed },
      () => this.say(distressed
        ? `${type.name} bought out of the estate. It is already built — assign it and it flies this quarter.`
        : `${type.name} ordered. It arrives in a few quarters — assign it now and it flies on delivery.`),
    );
    // Keep the sheet open so several aircraft can be ordered in one sitting,
    // but refresh it — cash changed, so affordability changed.
    if (this.nodes.acquireDialog.open) this.renderMarket();
  }

  private renderMarket(): void {
    const game = this.game;
    if (!game) return;
    const cash = getCarrier(game, game.playerCarrierId).cash;

    this.nodes.acquireNote.textContent =
      `Buying spends cash now and puts an asset on the balance sheet. Leasing costs a month up front, then rent every quarter. You hold ${usd(cash)}.`;

    this.nodes.marketBody.replaceChildren();
    // Available aircraft first, then the not-yet-launched; smallest gauge first
    // within each, so a startup meets the affordable regional metal before the
    // widebodies it cannot yet fill.
    const ordered = [...AIRCRAFT_TYPES].sort((a, b) =>
      (game.aircraftIntro[a.id] ?? 0) - (game.aircraftIntro[b.id] ?? 0) || a.seats - b.seats);
    for (const type of ordered) {
      this.nodes.marketBody.append(this.marketCard(type, game, cash));
    }
    this.nodes.marketProvenance.textContent = STRINGS.marketProvenance;
  }

  /** One aircraft in the market: the specs a route decision turns on, and the
   *  buy/lease levers — or a launch date if it is not yet in service. */
  private marketCard(type: AircraftType, game: GameState, cash: number): HTMLElement {
    const available = aircraftAvailable(game, type.id);
    const card = document.createElement('article');
    card.className = 'ac-card';
    if (!available) card.classList.add('is-gone');

    const ident = document.createElement('div');
    ident.className = 'ac-ident';
    const name = document.createElement('h3');
    name.className = 'ac-name';
    name.textContent = type.name;
    const sub = document.createElement('p');
    sub.className = 'ac-sub';
    sub.textContent = `${type.maker} · ${type.klass}`;
    ident.append(name, sub);

    // Fuel per 100 available seat-km: the honest cross-size efficiency number, so a
    // dense jet reads as thriftier per seat than a small one even if it burns more.
    const fuelPerSeat = (type.fuelBurnLPerKm / type.seats) * 100;
    const specs = document.createElement('dl');
    specs.className = 'ac-specs';
    for (const [label, value, hint] of [
      ['Seats', String(type.seats), 'Gauge: match it to how thick the market is.'],
      ['Range', `${km(type.rangeKm)} km`, 'The hard limit — it cannot fly a sector longer than this.'],
      ['Cruise', `${km(type.cruiseKmh)} km/h`, 'Faster metal turns more round trips a week from the same aircraft.'],
      ['Fuel', `${fuelPerSeat.toFixed(2)} L`, 'Litres burned per 100 seat-km — lower is thriftier per passenger.'],
      ['Buy', usd(type.price), 'Cash now, an asset on the balance sheet.'],
      ['Lease', `${usd(type.leaseMonthly)}/mo`, 'Rent, with a few months down. Frees the capital a purchase ties up.'],
    ] as const) {
      const cell = document.createElement('div');
      cell.className = 'ac-spec';
      cell.title = hint;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      // Figure and unit are different kinds of thing, so they are set as such: the
      // number in the tabular monospace, the unit in the grotesque at a smaller
      // size and softer ink. Setting "1,500 km" as one monospace run gave the unit
      // a full monospace space in front of it and read as a typo.
      const [figure, ...unitParts] = value.split(' ');
      dd.textContent = figure ?? value;
      if (unitParts.length > 0) {
        const unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = unitParts.join(' ');
        dd.append(unit);
      }
      cell.append(dt, dd);
      specs.append(cell);
    }

    const actions = document.createElement('div');
    actions.className = 'ac-actions';
    const deposit = type.leaseMonthly * CONSTANTS.fleet.leaseDepositMonths;
    if (!available) {
      const introTurn = game.aircraftIntro[type.id] ?? 0;
      const label = document.createElement('span');
      label.className = 'ac-soon';
      label.textContent =
        introTurn >= game.horizonTurns ? 'In development' : `Enters service ${turnLabel(introTurn, game.startYear)}`;
      label.title = 'Not yet in service — no airline can order it until it launches.';
      actions.append(label);
    } else {
      actions.append(
        this.marketButton('Buy', cash >= type.price, () => this.acquire(type.id, 'owned'),
          cash >= type.price ? `Buy a ${type.name} for ${usd(type.price)}` : `You hold ${usd(cash)}; a ${type.name} costs ${usd(type.price)}`),
        this.marketButton('Lease', cash >= deposit, () => this.acquire(type.id, 'leased'),
          cash >= deposit ? `Lease a ${type.name}, ${usd(deposit)} down` : `Lease deposit is ${usd(deposit)}`),
      );
    }
    card.append(ident, specs, actions);

    /*
     * A wound-up carrier's fleet, while the estate is still selling it.
     *
     * Its own row under the card rather than a third button, because it is a
     * different proposition from the two above it: cheaper, already built so it
     * flies this quarter rather than in a year, purchase only, and gone when the
     * lot is or the estate disperses. A rival folding is the one chance to grow
     * faster than the order book allows, and it should read as an opportunity
     * with a clock on it.
     */
    const lot = (game.distressed ?? []).find((l) => l.typeId === type.id && l.count > 0);
    if (lot && available) {
      const price = type.price * lot.priceFraction;
      const left = lot.untilTurn - game.turn;
      const row = document.createElement('div');
      row.className = 'ac-distressed';
      const blurb = document.createElement('span');
      blurb.textContent =
        `${lot.count} from ${lot.fromName}'s estate · ${usd(price)} · flies now · ` +
        `${left === 1 ? 'last quarter' : `${left} quarters left`}`;
      row.append(blurb);
      row.append(
        this.marketButton(`Buy at ${Math.round(lot.priceFraction * 100)}%`, cash >= price,
          () => this.acquire(type.id, 'owned', true),
          cash >= price
            ? `Buy a ${type.name} out of ${lot.fromName}'s estate for ${usd(price)} — already built, flies this quarter`
            : `You hold ${usd(cash)}; the estate wants ${usd(price)}`),
      );
      card.append(row);
    }
    return card;
  }

  private marketButton(label: string, enabled: boolean, onClick: () => void, title: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'market-buy';
    button.textContent = label;
    button.disabled = !enabled;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  // --- Render ---------------------------------------------------------------

  /** A city pair the player has proposed but not yet paid to open. */
  private prospect: { from: CityId; to: CityId } | null = null;

  private selection() {
    const unavailable = new Set<CityId>();
    if (this.game && this.from) {
      const flown = new Set(
        this.game.routes
          .filter((r) => r.carrierId === this.game!.playerCarrierId)
          .flatMap((r) => (r.from === this.from ? [r.to] : r.to === this.from ? [r.from] : [])),
      );
      for (const city of CITIES) {
        if (city.id === this.from) continue;
        if (flown.has(city.id) || cityDistanceKm(this.from, city.id) < CONSTANTS.routes.minDistanceKm) {
          unavailable.add(city.id);
        }
      }
    }
    return {
      // A prospect pins both ends of the pending arc the map already knows how to
      // draw, so the proposed sector stays on screen instead of following the mouse.
      from: this.prospect ? this.prospect.from : this.from,
      hovered: this.prospect ? this.prospect.to : this.hovered,
      unavailable,
      focusedCarrier: this.focusedCarrier,
      highlightedRoute: this.highlightedRoute,
    };
  }

  /** The map's view of the world: the board plus how heavily to draw each sector. */
  private scene(game: GameState | null): MapScene {
    if (!game) return EMPTY_SCENE;
    return {
      routes: game.routes,
      carriers: game.carriers,
      routeWeight: this.arcWeights,
      flying: this.flyingRoutes,
    };
  }

  private render(): void {
    const game = this.game;
    // Built once per render: the ledger, the rivals panel and the dossier all
    // need it, and it walks every route in the world.
    const index = game ? buildMarketIndex(game) : null;
    // A selected sector can vanish (closed, or a save was loaded).
    if (this.selectedRouteId && !game?.routes.some((r) => r.id === this.selectedRouteId)) {
      this.selectedRouteId = null;
    }
    /*
     * A picked sector only means anything while the list it was picked from is on
     * screen. One guard here rather than a clear at each of the ten places
     * selection changes — miss one and an arc stays lit with nothing explaining
     * why, which is the failure mode this whole area keeps producing.
     */
    if (this.selectedRouteId !== null || this.focusedCarrier === null) {
      this.highlightedRoute = null;
    }

    // Arc weight is recomputed with the rest of the board, then reused by the
    // hover-only re-render below, which must not walk the network again.
    this.arcWeights = game && index ? routeWeights(game, index) : new Map();
    /*
     * Which arcs represent a route that is actually being flown.
     *
     * Taken from the SAME index the market board reads, so the two can never
     * disagree again. They did: the map drew every route in the world while the
     * index excluded any whose aircraft were ordered and not yet delivered — so a
     * rival that opened a sector and placed an order showed a line on the map for
     * a quarter or two with nobody on the market underneath it. Measured at 6.6%
     * of drawn route-quarters, and it reads as a ghost carrier.
     */
    this.flyingRoutes = new Set();
    if (game && index) {
      for (const presences of index.values()) {
        for (const p of presences) this.flyingRoutes.add(p.routeId);
      }
    }
    this.map.render(this.scene(game), this.selection());

    // Coaching follows the game state, so it retires each note as the player does
    // the thing — including things they worked out before being told.
    this.renderOnboarding();

    const player = game ? getCarrier(game, game.playerCarrierId) : null;
    this.nodes.quarter.textContent = game ? turnLabel(game.turn, game.startYear) : '—';
    if (player) tickNumber(this.nodes.cash, player.cash, usd);
    else this.nodes.cash.textContent = '—';
    this.nodes.cash.classList.toggle('is-negative', (player?.cash ?? 0) < 0);
    if (player && game) tickNumber(this.nodes.worth, marketCap(game, player), usd);
    else this.nodes.worth.textContent = '—';
    this.nodes.fleet.textContent = player ? String(player.fleet.length) : '—';
    this.nodes.sectors.textContent = game
      ? String(game.routes.filter((r) => r.carrierId === game.playerCarrierId).length)
      : '—';

    this.nodes.fuel.textContent =
      game && player ? `${rate(effectiveFuelPrice(game, player))}/L` : '—';
    // Fuel reads as bad news only when it is dear against its OWN long-run level,
    // not against a number picked by hand. The walk mean-reverts to
    // startingFuelPricePerL, so that price is the trailing average by
    // construction; one volatility step above it is the band the walk itself says
    // is a genuinely high quarter rather than ordinary wander.
    const fuelBaseline =
      CONSTANTS.game.startingFuelPricePerL * (1 + CONSTANTS.events.fuelVolatility);
    this.nodes.fuel.classList.toggle(
      'is-negative',
      !!game && !!player && effectiveFuelPrice(game, player) > fuelBaseline,
    );
    this.nodes.closeBooks.disabled = !game || game.gameOver !== null;
    this.nodes.tech.disabled = !game || game.gameOver !== null;
    this.nodes.hedge.disabled =
      !game || game.gameOver !== null || (!!player?.hedge && game.turn < player.hedge.untilTurn);
    this.nodes.exportSave.disabled = !game;
    this.nodes.acquire.disabled = !game || game.gameOver !== null;

    // The verdict pops once, the first render after the game ends.
    if (game?.gameOver && this.verdictShownFor !== game.gameOver.turn) {
      this.verdictShownFor = game.gameOver.turn;
      this.showVerdict(game);
    }

    this.renderHint(game);
    this.renderLedger(game, index);
    this.renderConditions(game);
    this.renderRivals(game, index);
    this.renderFleet(game);

    renderInspector(this.nodes.inspector, game, index, this.selectedRouteId, this.focusedCarrier, this.highlightedRoute, this.prospect, {
      onOpenProspect: () => this.openProspect(),
      onDiscardProspect: () => {
        this.prospect = null;
        this.render();
      },
      onSetPosture: (routeId, posture: PricingPosture) =>
        this.dispatch({ type: 'SET_POSTURE', routeId, posture }),
      onCloseRoute: (routeId) => {
        this.selectedRouteId = null;
        this.dispatch({ type: 'CLOSE_ROUTE', routeId });
      },
      onAssign: (tailId, routeId) =>
        this.dispatch({ type: 'ASSIGN_AIRCRAFT', carrierId: game!.playerCarrierId, tailId, routeId }),
      onUnassign: (tailId) =>
        this.dispatch({ type: 'UNASSIGN_AIRCRAFT', carrierId: game!.playerCarrierId, tailId }),
      onHighlightRoute: (routeId) => {
        this.highlightedRoute = routeId;
        this.render();
      },
    });
  }

  /** The end-of-game card: won or lost, why, and where the airline finished. */
  private showVerdict(game: GameState): void {
    const over = game.gameOver!;
    const won = over.outcome === 'won';
    const player = getCarrier(game, game.playerCarrierId);

    this.nodes.overDialog.classList.toggle('is-won', won);
    this.nodes.overDialog.classList.toggle('is-lost', !won);
    this.nodes.overEyebrow.textContent = won ? 'Victory' : 'Game over';
    this.nodes.overTitle.textContent = won ? 'You built the airline.' : 'The airline is finished.';
    this.nodes.overReason.textContent = over.reason;

    const figures: Array<[string, string]> = [
      ['Final quarter', turnLabel(over.turn, game.startYear)],
      ['Market cap', usd(marketCap(game, player))],
      ['Cash', usd(player.cash)],
      ['Fleet', `${player.fleet.length} aircraft`],
      ['Sectors', String(game.routes.filter((r) => r.carrierId === player.id).length)],
    ];
    this.nodes.overFigures.replaceChildren(
      ...figures.flatMap(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );

    if (!this.nodes.overDialog.open) this.nodes.overDialog.showModal();
  }

  private renderHint(game: GameState | null): void {
    const hint = this.nodes.hint;
    hint.classList.toggle('is-alert', this.message.tone === 'error');

    if (this.message.text) {
      hint.textContent = this.message.text;
    } else if (!game) {
      hint.textContent = 'No game running. Choose a home base to start one.';
    } else if (game.gameOver) {
      hint.textContent = game.gameOver.reason;
    } else if (this.from) {
      hint.textContent = `${getCity(this.from).name} selected. Click a second city to price the sector.`;
    } else if (!game.routes.some((r) => r.carrierId === game.playerCarrierId)) {
      hint.textContent = 'Click two cities to price your first sector.';
    } else if (getCarrier(game, game.playerCarrierId).fleet.length === 0) {
      hint.textContent = 'You have no aircraft. Acquire one, then assign it to a sector.';
    } else {
      hint.textContent = 'Select a sector to manage it, or close the books on the quarter.';
    }
  }

  private renderLedger(game: GameState | null, index: MarketIndex | null): void {
    const body = this.nodes.ledger;
    body.replaceChildren();

    const playerRoutes = game ? game.routes.filter((r) => r.carrierId === game.playerCarrierId) : [];
    if (!game || playerRoutes.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.className = 'ledger-empty';
      cell.textContent = STRINGS.empty.schedule;
      row.append(cell);
      body.append(row);
      return;
    }

    const player = getCarrier(game, game.playerCarrierId);
    for (const route of game.routes) {
      if (route.carrierId !== player.id) continue;
      const assigned = assignedTo(player, route.id);
      const econ = computeRouteEconomics(
        route, assigned, game.turn, conditionsFor(game, player, route, klassesOf(assigned)),
        index ? rivalsOf(index, route) : 0,
        index ? rivalCapacityOf(index, route) : 0,
        feedFactor(game.routes, player.id, route.from, route.to, route.id),
        stationOverheadFor(game.routes, player.id, route.from, route.to, true),
      );
      const row = document.createElement('tr');
      row.className = 'ledger-row';
      row.classList.toggle('is-selected', route.id === this.selectedRouteId);

      const sector = document.createElement('th');
      sector.scope = 'row';
      sector.className = 'cell-sector';
      sector.textContent = `${route.from}–${route.to}`;
      sector.title = `${getCity(route.from).name} – ${getCity(route.to).name}`;

      const cells = [
        km(econ.distanceKm),
        String(econ.aircraftCount),
        econ.capacityWeekly > 0 ? pct(econ.loadFactor) : '—',
      ].map((text) => {
        const td = document.createElement('td');
        td.className = 'cell-num';
        td.textContent = text;
        return td;
      });

      // The same figure the dossier's "Sector net" shows — the route's true
      // contribution after owned metal's depreciation, not just its cash — so the
      // two never disagree on the same sector.
      const net = document.createElement('td');
      net.className = 'cell-num';
      net.textContent = econ.aircraftCount > 0 ? usd(econ.netEconomic) : '—';
      net.classList.toggle('is-negative', econ.netEconomic < 0 && econ.aircraftCount > 0);

      row.append(sector, ...cells, net);
      row.addEventListener('click', () => {
        this.selectedRouteId = this.selectedRouteId === route.id ? null : route.id;
        this.from = null;
        this.render();
      });
      body.append(row);
    }
  }

  private renderFleet(game: GameState | null): void {
    const list = this.nodes.fleetList;
    list.replaceChildren();

    const player = game ? getCarrier(game, game.playerCarrierId) : null;
    if (!player || player.fleet.length === 0) {
      list.append(this.note(STRINGS.empty.fleet));
      return;
    }

    // Grouped by type and ownership — a fleet plan is a board-level view, not a
    // tail-by-tail register. Age is shown because it drives maintenance.
    interface Group {
      typeId: string;
      ownership: Ownership;
      idle: number;
      delivering: number;
      total: number;
      ageSum: number;
      tails: string[];
    }
    const groups = new Map<string, Group>();
    for (const tail of player.fleet) {
      const key = `${tail.typeId}:${tail.ownership}`;
      const group = groups.get(key) ??
        { typeId: tail.typeId, ownership: tail.ownership, idle: 0, delivering: 0, total: 0, ageSum: 0, tails: [] };
      group.total += 1;
      group.ageSum += ageYears(tail, game!.turn);
      group.tails.push(tail.id);
      const undelivered = game!.turn < tail.deliversTurn;
      if (undelivered) group.delivering += 1;
      else if (tail.routeId === null) group.idle += 1;
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const type = getAircraftType(group.typeId);
      const avgAge = group.ageSum / group.total;

      const row = document.createElement('div');
      row.className = 'fleet-row';

      const name = document.createElement('span');
      name.className = 'fleet-name';
      name.textContent = `${group.total}× ${type.name}`;

      const tenure = document.createElement('span');
      tenure.className = 'fleet-tenure';
      tenure.textContent = group.ownership === 'owned' ? 'owned' : 'leased';

      const age = document.createElement('span');
      age.className = 'fleet-age';
      age.textContent = `${avgAge.toFixed(1)}y`;
      age.title = 'Average airframe age. Maintenance rises with it.';

      const idle = document.createElement('span');
      idle.className = 'fleet-idle';
      idle.textContent = group.delivering > 0
        ? `${group.delivering} arriving`
        : group.idle > 0 ? `${group.idle} parked` : '';
      idle.classList.toggle('is-alert', group.idle > 0 || group.delivering > 0);
      if (group.delivering > 0) {
        idle.title = 'Ordered and not yet delivered. It cannot fly until it arrives.';
      }

      row.append(name, tenure, age, idle);
      list.append(row);

      // Owned airframes can be overhauled to reset the maintenance clock. Only the
      // ones with time on that clock: a freshly overhauled airframe has nothing to
      // reset, and billing for it turned a stray second click into a heavy
      // maintenance visit bought for nothing — once per tail in the group.
      if (group.ownership === 'owned') {
        const due = group.tails.filter((id) => {
          const tail = player.fleet.find((a) => a.id === id);
          return tail !== undefined && ageYears(tail, game!.turn) > 0;
        });
        const cost = overhaulCost(type) * due.length;
        const nothingDue = due.length === 0;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fleet-action';
        button.textContent = nothingDue
          ? `Overhaul — nothing due`
          : `Overhaul ${due.length}× — ${usd(cost)}`;
        button.title = nothingDue
          ? `Every ${type.name} you own is freshly overhauled; there is no airframe time to undo.`
          : `A heavy maintenance visit resets the airframe clock on ${due.length} of the ` +
            `${type.name}s you own, undoing the maintenance those ${avgAge.toFixed(1)} years have added.`;
        button.disabled = nothingDue || cost > player.cash;
        button.addEventListener('click', () => {
          for (const tailId of due) {
            this.dispatch({ type: 'OVERHAUL_AIRCRAFT', carrierId: player.id, tailId });
          }
          this.say(`${due.length}× ${type.name} overhauled.`);
          this.commit();
        });
        list.append(button);
      }
    }

    const parked = player.fleet.filter((a) => a.routeId === null);
    if (parked.length > 0) {
      const breakFees = parked.reduce(
        (sum, a) =>
          sum +
          (a.ownership === 'leased'
            ? leaseBreakFee(getAircraftType(a.typeId), a.acquiredTurn, game!.turn)
            : 0),
        0,
      );
      const sell = document.createElement('button');
      sell.type = 'button';
      sell.className = 'wide-action wide-action--quiet';
      sell.textContent = breakFees > 0
        ? `Release ${parked.length} parked — ${usd(breakFees)} in break fees`
        : `Release ${parked.length} parked aircraft`;
      sell.title = breakFees > 0
        ? 'Some of these are still inside their lease term, so handing them back costs money'
        : 'Parked aircraft still owe lease and standing costs every quarter';
      sell.addEventListener('click', () => {
        for (const tail of parked) {
          this.dispatch({ type: 'DISPOSE_AIRCRAFT', carrierId: player.id, tailId: tail.id });
        }
        this.say(`Released ${parked.length} aircraft.`);
        this.commit();
      });
      list.append(sell);
    }
  }

  /** Rail summary: who is out there, and how many of your sectors they contest. */
  private renderRivals(game: GameState | null, index: MarketIndex | null): void {
    const list = this.nodes.rivalsList;
    list.replaceChildren();

    /*
     * Live carriers first, biggest first; the failed ones always last.
     *
     * The list was in the order rivals happened to enter the game, which is
     * meaningless by year five — it is read to answer "who is the threat", and
     * that is a ranking question. Failure is sorted on explicitly rather than
     * left to fall out of the valuation: a carrier that has just entered, or one
     * in real distress, can be worth about nothing while still flying, and it
     * would otherwise sit among the dead. A struck-through name is history, and
     * history belongs at the bottom whatever the arithmetic says.
     */
    const rivals = game
      ? [...game.carriers.filter((c) => !c.isPlayer)].sort((a, b) => {
          const aDead = a.bankruptTurn !== null;
          const bDead = b.bankruptTurn !== null;
          if (aDead !== bDead) return aDead ? 1 : -1;
          return marketCap(game, b) - marketCap(game, a);
        })
      : [];
    if (!game || rivals.length === 0) {
      const note = document.createElement('p');
      note.className = 'fleet-empty';
      note.textContent = game ? STRINGS.empty.rivals : 'No game running.';
      list.append(note);
      return;
    }

    const contestedBy = this.contestedCounts(game, index);

    for (const rival of rivals) {
      const row = document.createElement('div');
      row.className = 'rival-row';
      if (rival.bankruptTurn !== null) row.classList.add('is-gone');

      const swatch = document.createElement('span');
      swatch.className = 'rival-swatch';
      swatch.style.background = rival.color;

      const name = document.createElement('span');
      name.className = 'rival-name';
      name.textContent = rival.name;
      name.title = rival.archetypeId ? getArchetype(rival.archetypeId).blurb : '';

      const against = document.createElement('span');
      against.className = 'rival-against';
      const n = contestedBy.get(rival.id) ?? 0;
      if (rival.bankruptTurn !== null) {
        against.textContent = 'failed';
      } else if (n > 0) {
        against.textContent = `${n} of yours`;
        against.classList.add('is-alert');
      }

      /*
       * What each rival is WORTH, which is the number the game is scored on and
       * the one the sidebar was missing. Market cap rather than `netWorth`: the
       * latter is cash plus the book value of owned metal, so it reads a
       * leased-fleet carrier as nearly worthless and ignores debt entirely. The
       * horizon victory check compares market cap, and so does the treasury.
       */
      const value = document.createElement('span');
      value.className = 'rival-value';
      const routeCount = game.routes.filter((r) => r.carrierId === rival.id).length;
      if (rival.bankruptTurn === null) {
        value.textContent = usd(marketCap(game, rival));
        value.title = `${rival.name} is worth ${usd(marketCap(game, rival))} and flies ${routeCount} sector${routeCount === 1 ? '' : 's'}.`;
      }

      // Contested count before the valuation: "3 of yours" is the thing that
      // changes what you do this quarter, and the money is context for it.
      row.append(swatch, name, against, value);

      // Pinning a rival holds their whole network at full strength on the map.
      // Hovering an arc has always done this for as long as the cursor was on it,
      // which is no use unless you already know where their routes are.
      if (rival.bankruptTurn === null && routeCount > 0) {
        row.classList.add('is-pickable');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        const pinned = this.focusedCarrier === rival.id;
        row.classList.toggle('is-pinned', pinned);
        // The pin marker carries the carrier's own colour, so the row and the lit
        // arcs on the map read as the same thing.
        row.style.setProperty('--pin', rival.color);
        row.setAttribute('aria-pressed', String(pinned));
        const showingDossier = pinned && this.selectedRouteId === null;
        row.title = showingDossier
          ? `Close ${rival.name}'s network`
          : `See ${rival.name}'s ${routeCount} sector${routeCount === 1 ? '' : 's'} — listed below the map, and lit on it`;
        /*
         * Three-way, not two.
         *
         * A plain toggle meant that once a sector was selected the dossier could
         * not be got back to: the rival was still pinned, so clicking them
         * unpinned instead of returning to their network. Clicking a pinned rival
         * whose dossier is NOT on screen brings it back; clicking one whose
         * dossier is already up puts it away.
         */
        const toggle = (): void => {
          const showing = this.focusedCarrier === rival.id && this.selectedRouteId === null;
          this.focusedCarrier = showing ? null : rival.id;
          if (!showing) this.selectedRouteId = null;
          // A picked sector belongs to the list it was picked from; leaving that
          // list has to take it with you, or an arc stays lit with nothing on
          // screen explaining why.
          this.highlightedRoute = null;
          this.render();
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        });
      }
      list.append(row);
    }
    // "Read their books" is a static control below the list, not appended to it —
    // the list scrolls inside its pane now, and an action must not scroll away.
  }

  /** How many of the player's sectors each rival is on. */
  private contestedCounts(game: GameState, index: MarketIndex | null): Map<string, number> {
    const counts = new Map<string, number>();
    if (!index) return counts;
    for (const route of game.routes) {
      if (route.carrierId !== game.playerCarrierId) continue;
      for (const p of index.get(marketKey(route.from, route.to)) ?? []) {
        if (p.carrierId === game.playerCarrierId) continue;
        counts.set(p.carrierId, (counts.get(p.carrierId) ?? 0) + 1);
      }
    }
    return counts;
  }

  /** What the world is doing to you right now: fuel, hedge, and live events. */
  private renderConditions(game: GameState | null): void {
    const list = this.nodes.conditionsList;
    list.replaceChildren();
    if (!game) return;

    const me = getCarrier(game, game.playerCarrierId);
    const baseline = CONSTANTS.game.startingFuelPricePerL;
    // What the market is trading at, which is the spot walk plus any fuel event
    // — quoting the bare walk while an oil spike runs understates the bill.
    const market = marketFuelPrice(game);
    const paid = effectiveFuelPrice(game, me);

    const line = (label: string, value: string, alarming: boolean): void => {
      const row = document.createElement('div');
      row.className = 'condition-row';
      const name = document.createElement('span');
      name.className = 'condition-name';
      name.textContent = label;
      const val = document.createElement('span');
      val.className = 'condition-value';
      // Same split as the aircraft specs: the figure in the tabular monospace, any
      // trailing word in the grotesque. "+2% demand" set as one monospace run put a
      // full monospace space between the two and read as a double space.
      const [figure, ...rest] = value.split(' ');
      val.textContent = figure ?? value;
      if (rest.length > 0) {
        const unit = document.createElement('span');
        unit.className = 'unit';
        unit.textContent = rest.join(' ');
        val.append(unit);
      }
      val.classList.toggle('is-negative', alarming);
      row.append(name, val);
      list.append(row);
    };

    // The season the player is deciding *into*: the quarter about to be settled,
    // not the one just settled. Averaged over their own network, because a
    // northern and a southern route are in opposite seasons.
    const mine = game.routes.filter((r) => r.carrierId === me.id);
    const nextTurn = game.turn + 1;
    const season =
      mine.length > 0
        ? mine.reduce(
            (sum, r) => sum + seasonalDemandFactor(getCity(r.from), getCity(r.to), nextTurn),
            0,
          ) / mine.length
        : seasonalDemandFactor(getCity(me.homeCityId), getCity(me.homeCityId), nextTurn);
    if (Math.abs(season - 1) > 0.005) {
      const swing = Math.round((season - 1) * 100);
      line(
        `Season, ${turnLabel(nextTurn, game.startYear)}`,
        `${swing > 0 ? '+' : '−'}${Math.abs(swing)}% demand`,
        season < 1,
      );
    }

    line('Fuel, market', `${rate(market)}/L`, market > baseline * 1.25);
    // Only worth a second line when a hedge is making the two differ.
    if (Math.abs(paid - market) > 0.005) {
      line('Fuel, you pay', `${rate(paid)}/L`, paid > baseline * 1.25);
    }
    if (me.hedge && game.turn < me.hedge.untilTurn) {
      line(
        `Hedged ${pct(me.hedge.fraction)} at ${rate(me.hedge.pricePerL)}/L`,
        `${me.hedge.untilTurn - game.turn}q left`,
        false,
      );
    }

    const events = game.events;
    if (events.length === 0) {
      const calm = document.createElement('p');
      calm.className = 'fleet-empty';
      calm.textContent = STRINGS.empty.conditions;
      list.append(calm);
    }
    for (const effect of events) {
      const card = getEvent(effect.source);
      const row = document.createElement('div');
      row.className = `condition-row condition-${card.tone}`;
      const name = document.createElement('span');
      name.className = 'condition-name';
      name.textContent = card.name;
      name.title = card.blurb;
      const val = document.createElement('span');
      val.className = 'condition-value';
      val.textContent = effect.until === null ? '' : `${effect.until - game.turn}q`;
      row.append(name, val);
      list.append(row);
    }

    const pipeline = me.techInProgress;
    for (const item of pipeline) {
      const row = document.createElement('div');
      row.className = 'condition-row condition-pending';
      const name = document.createElement('span');
      name.className = 'condition-name';
      name.textContent = getTechNode(item.nodeId).name;
      const val = document.createElement('span');
      val.className = 'condition-value';
      val.textContent = `${item.completesTurn - game.turn}q`;
      row.append(name, val);
      list.append(row);
    }
  }

  private async hedgeFuel(): Promise<void> {
    if (!this.game) return;
    const fraction = CONSTANTS.events.hedgeMaxFraction;
    // The market price, matching both the masthead and what the sim charges.
    // Quoting the bare walk here told the player fuel was one price while the
    // rest of the screen showed another.
    const spot = marketFuelPrice(this.game);
    const price = spot * CONSTANTS.events.hedgePremium;
    const chosen = await this.askChoice({
      title: 'Hedge fuel',
      // Explanatory, not dangerous: this belongs in the blurb. The warning band is
      // red, and spending it on "here is how a swap works" leaves nothing louder
      // for "this hands a rival control of you".
      blurb: `Lock ${pct(fraction)} of your fuel for the next ${CONSTANTS.events.hedgeQuarters} ` +
        `quarters at ${rate(price)} a litre, against a market at ${rate(spot)}. This is a swap, ` +
        `not an option: you go on buying fuel at whatever the market charges and settle the ` +
        `difference either way — so it shelters you from a spike and costs you when fuel falls. ` +
        `Fares track the market too, so a hedge that goes the wrong way squeezes from both sides.`,
      options: [{ id: 'hedge', label: `Lock ${pct(fraction)} at ${rate(price)}/L`, primary: true }],
    });
    if (chosen === null) return;
    this.dispatch(
      { type: 'HEDGE_FUEL', carrierId: this.game.playerCarrierId, fraction },
      () => this.say(`Locked ${Math.round(fraction * 100)}% of fuel at ${rate(price)}/L.`),
    );
  }

  private openTreasury(): void {
    if (!this.game) return;
    this.renderTreasury();
    this.nodes.treasuryDialog.showModal();
  }

  private renderTreasury(): void {
    const game = this.game;
    if (!game) return;
    const me = getCarrier(game, game.playerCarrierId);
    const cap = marketCap(game, me);
    const rating = creditRating(game, me);
    const capacity = borrowingCapacity(game, me);

    this.nodes.treasuryNote.textContent =
      `Your shares trade at ${rate(sharePrice(game, me))}. Borrow cheap when you are strong, ` +
      `raise equity when the price is high, and buy rivals when they are weak.`;

    const fig = (label: string, value: string, negative = false): HTMLElement => {
      const wrap = document.createElement('div');
      wrap.className = 'figure';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dd.classList.toggle('is-negative', negative);
      wrap.append(dt, dd);
      return wrap;
    };
    this.nodes.treasuryFigures.replaceChildren(
      fig('Market cap', usd(cap)),
      fig('Share price', rate(sharePrice(game, me))),
      fig('Credit rating', rating),
      fig('Debt', usd(me.debt), me.debt > 0),
      fig('Interest', `${(interestRate(game, me) * 100).toFixed(1)}%/qtr`),
      fig('Can borrow', usd(capacity)),
      fig('Your dividend', pct(me.dividend)),
      // How much of you is still buyable — the ceiling on any raid against you.
      fig('Your free float', pct(this.freeFloat(game, me.id))),
    );

    const capPct = Math.round(CONSTANTS.finance.stakePurchaseCapPerQuarter * 100);
    this.nodes.treasuryMarketNote.textContent =
      `You can buy at most ${capPct}% of a carrier's shares a quarter, so control is built up in the open over several turns. ` +
      `Past ${Math.round(CONSTANTS.finance.controlThreshold * 100)}% you control it — set its dividend, then buy out the rest.`;

    // Who holds YOU — a rival building a stake in the player is the warning before
    // a takeover bid, so surface it plainly.
    const yourHolders = this.stakeholdersOf(game, game.playerCarrierId);
    const holders = this.nodes.treasuryShareholders;
    holders.classList.toggle('is-alert', yourHolders.some((h) => h.pct >= 0.25));
    holders.replaceChildren();
    if (yourHolders.length === 0) {
      holders.textContent = 'No rival holds your stock.';
    } else {
      const lead = document.createElement('span');
      lead.textContent = 'Your shareholders: ';
      holders.append(lead);
      // Each one with the price of making them go away — greenmail.
      yourHolders.forEach((h, i) => {
        const rival = getCarrier(game, h.id);
        const cost = (rival.holdings[me.id] ?? 0) * sharePrice(game, me) * CONSTANTS.finance.greenmailPremium;
        const name = document.createElement('span');
        name.textContent = `${rival.name} ${stake(h.pct)}`;
        holders.append(name);
        holders.append(
          this.marketButton('Buy out', me.cash >= cost, () => this.buyBackStake(h.id),
            `Pay ${usd(cost)} to buy ${rival.name}'s entire stake and retire it`),
        );
        if (i < yourHolders.length - 1) holders.append(document.createTextNode(', '));
      });
    }

    // Rival stakes, control and buyouts.
    this.nodes.treasuryRivals.replaceChildren();
    const rivals = game.carriers.filter((c) => !c.isPlayer && c.bankruptTurn === null);
    for (const rival of rivals) {
      const row = document.createElement('tr');
      // Through the chain, not just directly: a carrier your subsidiary controls is
      // one you command, and the table has to say so or the structure is invisible.
      const inControl = commands(game, me, rival);
      const directly = controls(me, rival);
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = inControl ? `${rival.name} ·` : rival.name;
      name.title = !inControl
        ? ''
        : directly
          ? 'You control this carrier.'
          : `You command this carrier through the chain — ${pct(economicInterest(game, me, rival))} of it is actually yours.`;
      name.style.borderLeft = `3px solid ${rival.color}`;
      name.style.paddingLeft = '7px';

      const held = me.holdings[rival.id] ?? 0;
      const stakePct = rival.shares > 0 ? (held / rival.shares) * 100 : 0;
      /*
       * What you own, counting what your subsidiaries own for you.
       *
       * This column read the DIRECT holding only, which was the same thing until
       * carriers could hold each other. After that a company bought by a subsidiary
       * showed 0% here and turned up under "Held by" as though a stranger were
       * accumulating it — the two columns between them managed to hide a position
       * the player had just paid for.
       *
       * `economicInterest` multiplies the stakes along the chain, so 60% of a
       * carrier holding 10% of this one reads as 6%: what you would actually
       * receive. The direct figure still governs the Sell button, because you can
       * only sell shares you hold yourself.
       */
      const effectivePct = economicInterest(game, me, rival) * 100;
      const float = this.freeFloat(game, rival.id);
      const stakeCell = effectivePct >= 0.5
        ? `${effectivePct.toFixed(0)}%${inControl ? ' ✦' : ''}`
        : '—';
      const cells = [
        usd(marketCap(game, rival)),
        rate(sharePrice(game, rival)),
        stakeCell,
        pct(float),
        pct(rival.dividend),
      ].map((t) => {
        const td = document.createElement('td');
        td.className = 'cell-num';
        td.textContent = t;
        return td;
      });
      /*
       * Where the stake comes from, when it is not all held in your own name. A
       * single percentage that silently sums a direct holding and three subsidiaries'
       * is worse than no number: it cannot be checked against anything on screen.
       */
      if (effectivePct >= 0.5) {
        const viaChain = controlledBy(game, me)
          .filter((c) => !c.isPlayer && (c.holdings[rival.id] ?? 0) > 0)
          .map((c) => `${c.name} ${stake((c.holdings[rival.id] ?? 0) / rival.shares)}`);
        cells[2]!.title = viaChain.length === 0
          ? `You hold ${stake(held / rival.shares)} of ${rival.name} directly.`
          : `${stake(effectivePct / 100)} of ${rival.name} is yours once the chain is counted: `
            + `${stakePct >= 0.5 ? `${stake(held / rival.shares)} in your own name, plus ` : ''}`
            + `${viaChain.join(', ')} — held by ${viaChain.length === 1 ? 'a carrier' : 'carriers'} you command.`;
      }

      // A float under half means control can no longer be bought on the market.
      if (float < 1 - CONSTANTS.finance.controlThreshold) {
        cells[3]!.classList.add('is-faint');
        cells[3]!.title = 'Less than half the shares are still on the market — nobody can buy control outright from here.';
      }

      /*
       * Who ELSE is buying this carrier — so a rival's raids and the field's own
       * consolidation stay visible.
       *
       * "Else" has to mean not you AND not a carrier you command. It used to mean
       * only the former, which was right until subsidiaries existed and then filed
       * your own holdings here under the name of the company that made them, next to
       * genuine rivals, with no way to tell the two apart.
       */
      const heldBy = document.createElement('td');
      heldBy.className = 'market-class';
      const others = this.stakeholdersOf(game, rival.id).filter(
        (h) => h.id !== me.id && !commands(game, me, getCarrier(game, h.id)),
      );
      heldBy.textContent = others.length > 0
        ? `${getCarrier(game, others[0]!.id).name} ${Math.round(others[0]!.pct * 100)}%`
        : '—';
      if (others.length > 1) {
        heldBy.title = others.map((h) => `${getCarrier(game, h.id).name} ${stake(h.pct)}`).join(', ');
      }

      const actions = document.createElement('td');
      actions.className = 'market-actions';
      actions.append(
        this.marketButton('Buy', me.cash > 0, () => this.buyStake(rival.id),
          `Buy a slice of ${rival.name} — up to ${Math.round(CONSTANTS.finance.stakePurchaseCapPerQuarter * 100)}% a quarter`),
      );
      if (stakePct >= 1) {
        actions.append(
          this.marketButton('Sell', true, () => this.sellStake(rival.id),
            `Sell part or all of your ${stakePct.toFixed(0)}% stake in ${rival.name}`),
        );
      }
      if (inControl) {
        // No "Invest" button here any more. It opened a picker of TARGETS capped at
        // four out of a field of up to eleven, chosen by roster order, so most of the
        // board was simply unreachable. `Buy` on the target's own row now asks which
        // of your carriers pays — the short list goes in a dialog and the long list
        // stays in this table, where every carrier already has a row.
        //
        // Cash is the exception: a treasury belongs to its direct owner (TRANSFER_CASH) —
        // so these only appear on carriers you hold outright, and the tooltip on the
        // rest says why rather than leaving a missing button to be puzzled over.
        if (directly) {
          actions.append(
            this.marketButton('Dividend', true, () => this.setDividend(rival.id),
              `Set ${rival.name}'s dividend — pull its profit up to you`),
            this.marketButton('Cash', true, () => this.moveCash(rival.id),
              `Move cash between your treasury and ${rival.name}'s`),
            this.marketButton('Acquire', true, () => this.acquireCarrier(rival.id),
              rival.debt > 0
                ? `Buy out the rest of ${rival.name}: ${usd(acquisitionCost(game, me, rival))} for the shares ` +
                  `plus ${usd(rival.debt)} of its debt`
                : `Buy out the rest of ${rival.name} for ${usd(acquisitionCost(game, me, rival))}`),
          );
        } else {
          const held = game.carriers.find((c) => (c.holdings[rival.id] ?? 0) / rival.shares > 0.5);
          actions.append(
            this.marketButton('Cash', false, () => undefined,
              `${rival.name}'s treasury belongs to ${held ? held.name : 'its direct owner'}, not to you. ` +
              `You can direct what it buys, but its cash has to move a step at a time.`),
          );
        }
      }
      row.append(name, ...cells, heldBy, actions);
      this.nodes.treasuryRivals.append(row);
    }
  }

  /**
   * Greenmail: pay a shareholder a premium for their whole stake in you. Retiring
   * the shares shrinks the company, so every remaining holder's slice grows — which
   * the confirmation spells out, because it can hand the NEXT raider control.
   */
  private async buyBackStake(holderId: string): Promise<void> {
    const game = this.game;
    if (!game) return;
    const me = getCarrier(game, game.playerCarrierId);
    const holder = getCarrier(game, holderId);
    const heldShares = holder.holdings[me.id] ?? 0;
    if (heldShares <= 0) return;
    const cost = heldShares * sharePrice(game, me) * CONSTANTS.finance.greenmailPremium;
    const remaining = me.shares - heldShares;

    // What the other shareholders become once the company is that much smaller.
    const top = this.stakeholdersOf(game, me.id)
      .filter((h) => h.id !== holderId)
      .map((h) => {
        const shares = getCarrier(game, h.id).holdings[me.id] ?? 0;
        return { name: getCarrier(game, h.id).name, before: shares / me.shares, after: shares / remaining };
      })
      .sort((a, b) => b.after - a.after)[0];
    const asPct = (v: number): string => `${Math.round(v * 100)}%`;
    // Retiring shares lifts everyone else's percentage. If that hands somebody
    // control of you, that is the headline, not a footnote.
    const danger = top && top.after > CONSTANTS.finance.controlThreshold;
    const chosen = await this.askChoice({
      title: `Buy out ${holder.name}`,
      blurb: `${usd(cost)} for their ${asPct(heldShares / me.shares)} of you. The shares are ` +
        `retired, so they cannot buy back in cheaply — but your share count falls, which lifts ` +
        `every other holder's percentage and lowers how much new equity you may ever issue.` +
        (top && !danger
          ? ` ${top.name}, your largest remaining shareholder, would go from ` +
            `${asPct(top.before)} to ${asPct(top.after)}.`
          : ''),
      warning: danger
        ? `This would leave ${top!.name} on ${asPct(top!.after)} — a controlling stake in you.`
        : undefined,
      options: [{ id: 'buy', label: `Buy out for ${usd(cost)}`, primary: !danger }],
    });
    if (chosen === null) return;
    this.dispatch({ type: 'BUY_BACK_STAKE', carrierId: me.id, holderId }, () => {
      this.say(`Bought out ${holder.name}'s stake for ${usd(cost)}.`);
      if (this.nodes.treasuryDialog.open) this.renderTreasury();
    });
  }

  /**
   * The free float: shares no carrier holds, as a fraction of those outstanding.
   * This is all anyone — you included — can still buy, so it is the ceiling on any
   * raid. A carrier whose float has fallen below half can no longer be taken over
   * on the open market at all.
   */
  private freeFloat(game: GameState, targetId: string): number {
    const target = getCarrier(game, targetId);
    if (target.shares <= 0) return 0;
    let held = 0;
    for (const c of game.carriers) held += c.holdings[targetId] ?? 0;
    return Math.max(0, (target.shares - held) / target.shares);
  }

  /** Every carrier holding a stake in `targetId`, largest first, as fractions. */
  private stakeholdersOf(game: GameState, targetId: string): Array<{ id: string; pct: number }> {
    const target = getCarrier(game, targetId);
    if (target.shares <= 0) return [];
    return game.carriers
      .filter((c) => c.id !== targetId && (c.holdings[targetId] ?? 0) > 0)
      .map((c) => ({ id: c.id, pct: (c.holdings[targetId] ?? 0) / target.shares }))
      .sort((a, b) => b.pct - a.pct);
  }

  private async sellStake(targetId: string): Promise<void> {
    if (!this.game) return;
    const game = this.game;
    const target = getCarrier(game, targetId);
    const playerId = game.playerCarrierId;
    const me = getCarrier(game, playerId);
    const held = me.holdings[targetId] ?? 0;
    const price = sharePrice(game, target);
    const value = held * price;
    const stakeNow = target.shares > 0 ? held / target.shares : 0;

    const amount = await this.askAmount({
      title: `Sell your ${target.name} stake`,
      blurb: `You hold ${pct(stakeNow)} of ${target.name}, worth about ${usd(value)} ` +
        `at ${rate(price)} a share.`,
      unit: 'usd',
      max: value,
      initial: value,
      presets: [{ label: 'A quarter', value: value * 0.25 }, { label: 'Half', value: value * 0.5 }],
      preview: (v) => {
        const soldFraction = value > 0 ? v / value : 0;
        const after = stakeNow * (1 - soldFraction);
        return `Raises ${usd(v)} in cash and leaves you ` +
          (after > 0.0005 ? `${pct(after)} of ${target.name}.` : `out of ${target.name} entirely.`);
      },
      confirmLabel: 'Sell',
    });
    if (amount === null) return;
    this.dispatch(
      { type: 'SELL_SHARES', carrierId: playerId, targetId, amount },
      () => {
        const now = getCarrier(this.game!, playerId).holdings[targetId] ?? 0;
        const stake = target.shares > 0 ? now / target.shares : 0;
        this.say(now > 0 ? `Sold. You now hold ${pct(stake)} of ${target.name}.` : `Sold your stake in ${target.name}.`);
        if (this.nodes.treasuryDialog.open) this.renderTreasury();
      },
    );
  }

  private async setDividend(targetId: string): Promise<void> {
    if (!this.game || targetId === '') return;
    const game = this.game;
    const target = getCarrier(game, targetId);
    const max = CONSTANTS.finance.maxDividend;
    const whose = target.isPlayer ? 'your' : `${target.name}'s`;

    const chosen = await this.askAmount({
      title: target.isPlayer ? 'Set your dividend' : `Set ${target.name}'s dividend`,
      blurb: `The share of each quarter's profit paid out to shareholders. It lifts the ` +
        `share price and drains cash. Currently ${pct(target.dividend)}.`,
      unit: 'pct',
      max,
      initial: target.dividend,
      allowZero: true,
      presets: [
        { label: 'None', value: 0 },
        { label: '10%', value: 0.1 },
        { label: '20%', value: 0.2 },
      ].filter((p) => p.value <= max),
      preview: (v) => v <= 0
        ? `Pays nothing out; every dollar earned stays in ${whose} balance sheet.`
        : `Pays out ${pct(v)} of each profitable quarter, keeping ${pct(1 - v)} to reinvest.`,
      confirmLabel: 'Set dividend',
    });
    // A dividend of zero is a legitimate answer, so only null means "backed out".
    if (chosen === null) return;
    this.dispatch(
      { type: 'SET_DIVIDEND', carrierId: game.playerCarrierId, targetId, rate: chosen },
      () => {
        this.say(`Dividend set to ${pct(chosen)}.`);
        if (this.nodes.treasuryDialog.open) this.renderTreasury();
      },
    );
  }

  private async financeAmount(type: 'BORROW' | 'REPAY_DEBT' | 'ISSUE_EQUITY'): Promise<void> {
    if (!this.game) return;
    const game = this.game;
    const me = getCarrier(game, game.playerCarrierId);
    const fin = CONSTANTS.finance;
    const verb = type === 'BORROW' ? 'borrow' : type === 'REPAY_DEBT' ? 'repay' : 'raise';

    let spec: Parameters<typeof this.askAmount>[0];
    if (type === 'BORROW') {
      const max = borrowingCapacity(game, me);
      const quarterly = interestRate(game, me);
      spec = {
        title: 'Borrow',
        blurb: max > 0
          ? `Your ${creditRating(game, me)} rating carries ${(quarterly * 100).toFixed(1)}% a quarter. ` +
            `You can draw up to ${usd(max)} against the balance sheet.`
          : 'You have no borrowing capacity left. Repay debt or grow the balance sheet first.',
        unit: 'usd',
        max,
        presets: [
          { label: 'A quarter', value: max * 0.25 },
          { label: 'Half', value: max * 0.5 },
        ],
        preview: (v) =>
          `Cash goes to ${usd(me.cash + v)}, debt to ${usd(me.debt + v)}. ` +
          `Interest costs about ${usd(v * quarterly)} a quarter on this alone.`,
        confirmLabel: 'Borrow',
      };
    } else if (type === 'REPAY_DEBT') {
      const max = Math.min(me.debt, me.cash);
      spec = {
        title: 'Repay debt',
        blurb: me.debt <= 0
          ? 'You have no debt to repay.'
          : `You owe ${usd(me.debt)} and hold ${usd(me.cash)}. Repaying frees future quarters ` +
            `of interest and improves your rating.`,
        unit: 'usd',
        max,
        presets: [{ label: 'A quarter', value: max * 0.25 }, { label: 'Half', value: max * 0.5 }],
        preview: (v) =>
          `Debt falls to ${usd(me.debt - v)}, cash to ${usd(me.cash - v)}, ` +
          `saving about ${usd(v * interestRate(game, me))} a quarter in interest.`,
        confirmLabel: 'Repay',
      };
    } else {
      const price = sharePrice(game, me);
      const issued = me.issuedShares ?? 0;
      const headroomShares =
        (fin.authorizedIssuanceFraction * me.shares - issued) / (1 - fin.authorizedIssuanceFraction);
      // The engine's own ceiling, not a second copy of it.
      const max = equityRaiseCeiling(game, me);
      spec = {
        title: 'Issue equity',
        blurb: headroomShares <= 0
          ? 'You have issued all your authorized shares — the well is dry.'
          : `You can raise up to ${usd(max)}. New shares clear below market at ` +
            `a discount that widens with the size of the raise, so this dilutes you, and authorized ` +
            `issuance is a finite well.`,
        unit: 'usd',
        max,
        presets: [{ label: 'A quarter', value: max * 0.25 }, { label: 'Half', value: max * 0.5 }],
        preview: (v) => {
          // Priced at the discount THIS raise would clear at, so the preview matches
          // what the engine will do rather than a flat figure that only holds for a
          // small top-up.
          const newShares = v / (price * equityIssueDiscount(v, marketCap(game, me)));
          const dilution = me.shares > 0 ? newShares / (me.shares + newShares) : 0;
          return `Raises ${usd(v)} by issuing ${Math.round(newShares).toLocaleString('en-US')} ` +
            `shares — about ${pct(dilution)} of the enlarged company.`;
        },
        confirmLabel: 'Issue',
      };
    }

    const amount = await this.askAmount(spec);
    if (amount === null) return;
    this.dispatch({ type, carrierId: game.playerCarrierId, amount }, () => {
      this.say(`${verb[0]!.toUpperCase()}${verb.slice(1)}d ${usd(amount)}.`);
      if (this.nodes.treasuryDialog.open) this.renderTreasury();
    });
  }

  /*
   * Move cash between your treasury and one you command.
   *
   * Both directions matter and they are different decisions. Pulling cash UP is the
   * robber-baron move: you keep the whole sum and only your own share of the value
   * it took with it, so the minority holders fund the difference. Sending it DOWN is
   * the unglamorous half nobody remembers — a subsidiary too poor to buy aircraft
   * never grows into the thing you bought it for.
   */
  private async moveCash(subsidiaryId: string): Promise<void> {
    if (!this.game) return;
    const game = this.game;
    const me = getCarrier(game, game.playerCarrierId);
    const sub = getCarrier(game, subsidiaryId);
    const fin = CONSTANTS.finance;

    const moved = sub.transferredThisQuarter ?? 0;
    const headroom = Math.max(0, Math.max(0, sub.cash) * fin.subsidiaryTransferCapPerQuarter - moved);
    const upMax = Math.min(headroom, Math.max(0, sub.cash - fin.subsidiaryReserve));
    const downMax = Math.min(headroom, Math.max(0, me.cash));

    const direction = await this.askChoice({
      title: `${sub.name}'s treasury`,
      blurb:
        `${sub.name} holds ${usd(sub.cash)}; you hold ${usd(me.cash)}. You own ` +
        `${pct(economicInterest(game, me, sub))} of it, and may move ` +
        `${pct(fin.subsidiaryTransferCapPerQuarter)} of its cash a quarter — ` +
        `${usd(headroom)} is left this quarter.`,
      warning: upMax <= 0 && downMax <= 0 ? 'Nothing can move this quarter.' : undefined,
      options: [
        { id: 'up', label: `Pull cash up — to ${usd(upMax)}`, primary: true,
          detail: `You keep the cash; ${sub.name}'s value falls by it, and you carry only your own share of that loss.` },
        { id: 'down', label: `Send cash down — to ${usd(downMax)}`,
          detail: `Fund ${sub.name} so it can buy aircraft and open sectors of its own.` },
      ],
    });
    if (direction !== 'up' && direction !== 'down') return;

    const up = direction === 'up';
    const max = up ? upMax : downMax;
    if (max <= 0) {
      this.say(up
        ? `${sub.name} must keep ${usd(fin.subsidiaryReserve)} to keep flying.`
        : 'You have no cash to send.', 'error');
      return;
    }
    const amount = await this.askAmount({
      title: up ? `Pull cash from ${sub.name}` : `Send cash to ${sub.name}`,
      blurb: up
        ? `Leaves ${sub.name} at least ${usd(fin.subsidiaryReserve)} to keep flying.`
        : `Out of your own ${usd(me.cash)}.`,
      unit: 'usd',
      max,
      initial: max,
      presets: [{ label: 'A quarter', value: max * 0.25 }, { label: 'Half', value: max * 0.5 }],
    });
    if (amount === null || amount <= 0) return;
    this.dispatch({
      type: 'TRANSFER_CASH',
      controllerId: me.id,
      fromId: up ? sub.id : me.id,
      toId: up ? me.id : sub.id,
      amount,
    }, () => this.say(up
      ? `Pulled ${usd(amount)} out of ${sub.name}.`
      : `Sent ${usd(amount)} down to ${sub.name}.`));
  }

  /*
   * Which of your carriers pays for a stake.
   *
   * The target is whichever row was clicked, so every company on the board is
   * reachable by construction. This used to run the other way — an "Invest" button
   * on each subsidiary opened a picker of TARGETS, and that picker was capped at
   * four entries out of a field of up to eleven, chosen by roster order rather than
   * merit. Asking who pays instead puts the short list in the dialog (you, plus the
   * handful of carriers you command) and the long list in the table, where it
   * already was.
   *
   * Returns the buyer, or null if the player backed out. With nothing commanded and
   * no subsidiary holding cash there is no question to ask, so no dialog appears and
   * the flow is exactly what it was before any of this existed.
   */
  private async chooseBuyer(targetId: string): Promise<Carrier | null> {
    const game = this.game!;
    const me = getCarrier(game, game.playerCarrierId);
    const target = getCarrier(game, targetId);

    const candidates = [me, ...controlledBy(game, me).filter((c) => !c.isPlayer)]
      .filter((c) => c.id !== targetId && stakePurchaseCeiling(game, c, target) > 0);
    if (candidates.length <= 1) return candidates[0] ?? me;

    const chosen = await this.askChoice({
      title: `Who buys into ${target.name}?`,
      blurb:
        `Shares trade at ${rate(sharePrice(game, target))}. A stake bought by a carrier ` +
        `you control belongs to IT, not to you — but you command what it commands, ` +
        `which is the whole point of holding one.`,
      options: candidates.map((c) => ({
        id: c.id,
        label: c.isPlayer ? `${c.name} (you)` : c.name,
        primary: c.isPlayer,
        detail:
          `${usd(c.cash)} on hand · up to ${usd(stakePurchaseCeiling(game, c, target))} this quarter` +
          (c.isPlayer ? '' : ` · you own ${pct(economicInterest(game, me, c))} of it`),
      })),
    });
    return chosen === null ? null : (candidates.find((c) => c.id === chosen) ?? null);
  }

  private async buyStake(targetId: string): Promise<void> {
    if (!this.game) return;
    const game = this.game;
    const me = getCarrier(game, game.playerCarrierId);
    const target = getCarrier(game, targetId);
    // Who pays. Only asked when there is more than one answer.
    const buyer = await this.chooseBuyer(targetId);
    if (!buyer) return;
    const viaSubsidiary = buyer.id !== me.id;

    const capPerQuarter = CONSTANTS.finance.stakePurchaseCapPerQuarter;
    const price = sharePrice(game, target);
    const held = buyer.holdings[targetId] ?? 0;
    const stakeNow = target.shares > 0 ? held / target.shares : 0;
    const float = this.freeFloat(game, targetId);
    // The ceiling is the sim's, not this panel's — see `stakePurchaseCeiling`.
    const boughtThisQuarter = target.shares > 0 ? (buyer.stakeBought[targetId] ?? 0) / target.shares : 0;
    const cap = Math.max(0, capPerQuarter - boughtThisQuarter);
    const costOf = (fraction: number): number => fraction * target.shares * price;
    const max = stakePurchaseCeiling(game, buyer, target);
    const slice = (fraction: number): { label: string; value: number } =>
      ({ label: `${Math.round(fraction * 100)}%`, value: costOf(fraction) });

    const amount = await this.askAmount({
      title: viaSubsidiary ? `${buyer.name} buys into ${target.name}` : `Buy into ${target.name}`,
      blurb: `Shares trade at ${rate(price)}. ` +
        (boughtThisQuarter > 0
          ? `${viaSubsidiary ? buyer.name + ' has' : 'You have'} already bought ${pct(boughtThisQuarter)} of it this quarter, so ${pct(cap)} of the ${pct(capPerQuarter)} allowance is left, `
          : `A carrier may buy ${pct(capPerQuarter)} of another a quarter, `) +
        `${pct(float)} is still on the open market, and ${viaSubsidiary ? buyer.name + ' holds' : 'you hold'} ${usd(buyer.cash)}. ` +
        (stakeNow > 0
          ? `${viaSubsidiary ? 'It' : 'You'} already own${viaSubsidiary ? 's' : ''} ${pct(stakeNow)}. `
          : `${viaSubsidiary ? 'It owns' : 'You own'} none of it yet. `) +
        (max > 0 && target.shares > 0
          ? `That stretches to about ${pct(max / (target.shares * price))} of it.`
          : ''),
      unit: 'usd',
      max,
      presets: [slice(0.05), slice(0.1)],
      preview: (v) => {
        const bought = target.shares > 0 ? v / price / target.shares : 0;
        const after = stakeNow + bought;
        const who = viaSubsidiary ? buyer.name : 'you';
        const control = after >= CONSTANTS.finance.controlThreshold
          ? viaSubsidiary
            ? ` That takes ${buyer.name} past control — and you command what it commands.`
            : ' That takes you past control — you could set its dividend and then buy out the rest.'
          : '';
        return `Buys about ${pct(bought)} of ${target.name}, taking ${who} to ${pct(after)}. ` +
          `Leaves ${viaSubsidiary ? buyer.name : 'you'} ${usd(buyer.cash - v)}.${control}`;
      },
      confirmLabel: 'Buy',
    });
    if (amount === null) return;
    const action = viaSubsidiary
      ? { type: 'DIRECT_BUY_SHARES' as const, controllerId: me.id, buyerId: buyer.id, targetId, amount }
      : { type: 'BUY_SHARES' as const, carrierId: me.id, targetId, amount };
    this.dispatch(action, () => {
      const t = getCarrier(this.game!, targetId);
      const holder = getCarrier(this.game!, buyer.id);
      const stake = t.shares > 0 ? (holder.holdings[targetId] ?? 0) / t.shares : 0;
      this.say(viaSubsidiary
        ? `${buyer.name} now holds ${pct(stake)} of ${t.name}.`
        : `You now hold ${pct(stake)} of ${t.name}.`);
      if (this.nodes.treasuryDialog.open) this.renderTreasury();
    });
  }

  private async acquireCarrier(targetId: string): Promise<void> {
    if (!this.game) return;
    const game = this.game;
    const me = getCarrier(game, game.playerCarrierId);
    const target = getCarrier(game, targetId);
    const cost = acquisitionCost(game, me, target);
    /*
     * Quoted at ENTERPRISE value, not the equity price.
     *
     * `acquisitionCost` is what the shares cost; the merge also moves the target's
     * whole debt onto your balance sheet, and `ACQUIRE_CARRIER` refuses unless you
     * can carry both. This dialog showed only the share price, so a carrier could be
     * offered at $500M and land as billions — the engine's own rejection message had
     * been naming both figures for weeks while the screen the player actually reads
     * named one.
     *
     * Broken out rather than summed, for the same reason the sector panel itemises:
     * a single total cannot tell you that almost all of it is somebody else's
     * borrowing, and that is the whole character of the deal.
     */
    const assumed = Math.max(0, target.debt);
    const total = cost + assumed;
    const reach = me.cash + borrowingCapacity(game, me);
    // This was a confirm(), where Cancel meant "pay cash" rather than "stop" — so
    // there was no way to back out of an acquisition once the dialog was up.
    const funding = await this.askChoice({
      title: `Acquire ${target.name}`,
      blurb: assumed > 0
        ? `${usd(cost)} for the shares, and you assume ${usd(assumed)} of its debt — ` +
          `${usd(total)} in all. You absorb its routes, fleet and cash with it, and run a ` +
          `few quarters of integration drag while the two networks merge.`
        : `${usd(cost)} for the whole carrier, which carries no debt. You absorb its routes, ` +
          `fleet and cash, and run a few quarters of integration drag while the two networks merge.`,
      warning: reach < total
        ? `You can reach ${usd(reach)} with cash and borrowing, ${usd(total - reach)} short of ` +
          `the ${usd(total)} this takes. It will be refused.`
        : me.cash < total
          ? `Your ${usd(me.cash)} does not cover ${usd(total)}. Paying cash only will fail — ` +
            `fund it with debt.`
          : undefined,
      options: [
        {
          id: 'debt',
          label: 'Fund with debt',
          detail: 'Pay what cash covers and borrow the rest. A leveraged buyout.',
          primary: true,
        },
        {
          id: 'cash',
          label: 'Pay cash only',
          detail: assumed > 0
            ? `Draws ${usd(cost)} from your ${usd(me.cash)} — the ${usd(assumed)} of debt comes across regardless.`
            : `Draws ${usd(cost)} straight from your ${usd(me.cash)}.`,
        },
      ],
    });
    if (funding === null) return;
    this.dispatch(
      { type: 'ACQUIRE_CARRIER', carrierId: game.playerCarrierId, targetId, withDebt: funding === 'debt' },
      () => {
        this.say(`Acquired ${target.name}.`);
        if (this.nodes.treasuryDialog.open) this.renderTreasury();
      },
    );
  }

  private openTech(): void {
    if (!this.game) return;
    this.renderTech();
    this.nodes.techDialog.showModal();
  }

  private renderTech(): void {
    const game = this.game;
    if (!game) return;
    const me = getCarrier(game, game.playerCarrierId);
    const cash = me.cash;
    const done = me.tech.length;

    this.nodes.techNote.textContent =
      `Each program is cash now for a permanent improvement later — nothing lands the quarter ` +
      `you fund it. ${done} of ${TECH_NODES.length} in service. You hold ${usd(cash)}.`;

    // What the programs already funded are returning, in one place that does not
    // depend on having a sector selected or a rival to compare against.
    this.nodes.techStanding.replaceChildren();
    if (done > 0) {
      this.nodes.techStanding.append(
        techPanel(
          techSummary(me.tech, techEffects(me.tech), (id) => getTechNode(id).name, {
            loadCeiling: CONSTANTS.demand.maxLoadFactor,
            loadCeilingMax: CONSTANTS.demand.loadCeilingMax,
          }),
          technologyValue(game, buildMarketIndex(game), me),
          'across your network',
        ),
      );
    }

    this.nodes.techBody.replaceChildren();
    for (const node of TECH_NODES) {
      const status = techStatus(me, node);
      const row = document.createElement('tr');
      if (status === 'delivered') row.className = 'is-gone';

      const name = document.createElement('th');
      name.scope = 'row';
      name.className = 'market-name';
      name.textContent = node.name;

      const blurb = document.createElement('td');
      blurb.className = 'market-class';
      blurb.textContent = node.blurb;

      const cost = document.createElement('td');
      cost.className = 'cell-num';
      cost.textContent = usd(node.cost);

      const lead = document.createElement('td');
      lead.className = 'cell-num';
      lead.textContent = `${node.quarters}q`;

      const action = document.createElement('td');
      action.className = 'market-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'market-buy';
      button.textContent =
        status === 'delivered' ? 'In service'
        : status === 'in-progress' ? 'Under way'
        : status === 'locked' ? 'Locked'
        : 'Fund';
      button.disabled = status !== 'available' || cash < node.cost;
      button.title =
        status === 'locked' && node.requires
          ? `Needs ${getTechNode(node.requires).name} first`
          : status === 'available' && cash < node.cost
            ? `Costs ${usd(node.cost)}; you hold ${usd(cash)}`
            : node.blurb;
      button.addEventListener('click', () => {
        this.dispatch(
          { type: 'START_TECH', carrierId: game.playerCarrierId, nodeId: node.id },
          () => this.say(`${node.name} funded — ${node.quarters} quarters to delivery.`),
        );
        if (this.nodes.techDialog.open) this.renderTech();
      });
      action.append(button);

      row.append(name, blurb, cost, lead, action);
      this.nodes.techBody.append(row);
    }
  }

  private openRivals(): void {
    if (!this.game) return;
    this.renderRivalReport();
    this.nodes.rivalsDialog.showModal();
  }

  /** Annual-report style: every carrier's last quarter, side by side with yours. */
  private renderRivalReport(): void {
    const game = this.game;
    if (!game) return;
    const lastFor = (id: string) => game.history.filter((h) => h.carrierId === id).at(-1);
    const index = buildMarketIndex(game);
    const contestedBy = this.contestedCounts(game, index);

    const entered = game.carriers.filter((c) => !c.isPlayer).length;
    const pending = game.rivalPlan.length - entered;
    this.nodes.rivalsNote.textContent =
      `${entered} carrier${entered === 1 ? '' : 's'} have entered` +
      (pending > 0 ? `, ${pending} still to come. ` : '. ') +
      'Sustained profits bring them in sooner.';

    this.nodes.rivalsBody.replaceChildren();
    const order = [game.carriers.find((c) => c.isPlayer)!, ...game.carriers.filter((c) => !c.isPlayer)];

    for (const carrier of order) {
      const last = lastFor(carrier.id);
      const routes = game.routes.filter((r) => r.carrierId === carrier.id).length;
      const row = document.createElement('tr');
      if (carrier.isPlayer) row.className = 'is-you';
      if (carrier.bankruptTurn !== null) row.classList.add('is-gone');

      const name = document.createElement('th');
      name.scope = 'row';
      name.className = 'market-name';
      name.textContent = carrier.isPlayer ? `${carrier.name} (you)` : carrier.name;
      name.style.borderLeft = `3px solid ${carrier.color}`;
      name.style.paddingLeft = '8px';

      const tech = techSummary(
        carrier.tech,
        techEffects(carrier.tech),
        (id) => getTechNode(id).name,
        {
          loadCeiling: CONSTANTS.demand.maxLoadFactor,
          loadCeilingMax: CONSTANTS.demand.loadCeilingMax,
        },
      );
      const alive = carrier.bankruptTurn === null;
      const versus = contestedBy.get(carrier.id) ?? 0;
      // Described rather than indexed, so inserting a column cannot silently
      // move the styling onto the wrong one.
      const columns: { text: string; numeric?: boolean; title?: string; negative?: boolean }[] = [
        { text: carrier.archetypeId ? getArchetype(carrier.archetypeId).name : 'You' },
        { text: getCity(carrier.homeCityId).name },
        { text: alive ? String(routes) : '—', numeric: true },
        { text: alive ? String(carrier.fleet.length) : '—', numeric: true },
        { text: tech.count > 0 ? String(tech.count) : '—', numeric: true, title: tech.detail },
        { text: last && alive ? usd(last.revenue) : '—', numeric: true },
        {
          text: last && alive ? usd(last.netIncome) : '—',
          numeric: true,
          negative: !!last && alive && last.netIncome < 0,
        },
        { text: alive ? usd(carrier.cash) : 'failed', numeric: true },
        {
          text: carrier.isPlayer ? '—' : String(versus),
          numeric: true,
          negative: !carrier.isPlayer && versus > 0,
        },
      ];
      const cells = columns.map((column) => {
        const td = document.createElement('td');
        td.className = column.numeric ? 'cell-num' : 'market-class';
        td.textContent = column.text;
        if (column.title) td.title = column.title;
        if (column.negative) td.classList.add('is-negative');
        return td;
      });

      row.append(name, ...cells);

      // Same disclosure as the market board, reachable without a sector
      // selected — this dialog is where a player looks for "who has what".
      const detail = document.createElement('tr');
      detail.className = 'board-detail';
      detail.hidden = true;
      const holder = document.createElement('td');
      holder.colSpan = columns.length + 1;
      // The quarter first — it is what the row's own figures are drawn from —
      // then what their technology contributed to it.
      const trailing = game.history.filter((h) => h.carrierId === carrier.id).slice(-4);
      if (last && alive) holder.append(quarterPanel(last, trailing, game.startYear));
      holder.append(
        techPanel(
          tech,
          alive ? technologyValue(game, index, carrier) : null,
          'across their network',
        ),
      );
      detail.append(holder);

      row.classList.add('is-expandable');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', 'false');
      const toggle = (): void => {
        detail.hidden = !detail.hidden;
        row.setAttribute('aria-expanded', String(!detail.hidden));
        row.classList.toggle('is-open', !detail.hidden);
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });

      this.nodes.rivalsBody.append(row, detail);
    }
  }

  private note(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'fleet-empty';
    p.textContent = text;
    return p;
  }
}
