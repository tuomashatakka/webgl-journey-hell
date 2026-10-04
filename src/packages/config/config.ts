// The one config file: every tunable, path, default and feature flag.
//
// Pure data, no imports, no side effects, so it can be read from anywhere:
// the workspace packages, the React app, next.config.ts and the CLI tools.
//
// The boundary. What lives here is anything a person might reasonably want to
// turn: deployment paths, quality and frame-pacing budgets, input feel, timings
// of the title card, the transport and signal loss, settings defaults, per-journey
// signal-loss laps and the tools' defaults. What stays beside the code that owns
// it is authored content, not settings: a journey's route table, its simulation's
// physical constants, its audio patches, GLSL constants inside a shader, and the
// delta asset manifest. Those are the work itself; changing one changes the piece.

/** The resolution value that hands the render scale to the adaptive governor. */
const AUTO_RESOLUTION = 0

export const CONFIG = {
  site: {
    /**
     * The deployment sub-path (GitHub Pages). Next rewrites it into next/link and
     * imported assets, but not into runtime URL strings: those go through
     * assetUrl, which reads it from NEXT_PUBLIC_BASE_PATH, set from here.
     */
    basePath: '/webgl-journey-hell',
    title: 'webgl-journey-hell',
    description: 'An index of WebGL shader journeys into the abyss.',
  },

  pan: {
    /** Ordinary-motion follow rate, 1/s. Higher = tighter tracking of the pointer. */
    followRate: 16,
    /** Target deltas beyond this (in -1..1 units) are treated as a jump and tweened. */
    jumpDistance: 0.3,
    /** Jump tween duration = distance × this, clamped to the bounds below. */
    jumpSecondsPerUnit: 0.35,
    jumpMinSeconds: 0.16,
    jumpMaxSeconds: 0.5,
    /** Tilt (degrees, from the calibration pose) that maps to a full-scale ±1 pan. */
    gyroRangeDeg: 35,
    /** Tilt below this is ignored, so a hand-held device doesn't jitter the camera. */
    gyroDeadzoneDeg: 1.5,
    /** Smoothing applied to raw orientation readings, 1/s. */
    gyroFollowRate: 6,
    /** Largest frame delta the tweens integrate, so a stalled tab doesn't snap. */
    maxDelta: 0.1,
  },

  frameLoop: {
    /** How early (ms) a capped frame may arrive and still run. */
    jitterMs: 1.5,
    /** Longest delta ever delivered. */
    maxDeltaMs: 100,
  },

  signal: {
    /** Seconds in the ending before the picture starts to go. */
    graceSeconds: 8,
    /** ...and how long it then takes to arrive, once it has started. */
    rampSeconds: 15,
    /**
     * Seconds of *active* loss before the dB meter appears.
     *
     * Zero: the readout comes up with the caption, not after it. The two are one
     * instrument panel, and a panel that arrives in two instalments reads as two
     * separate events rather than as one receiver giving up.
     */
    meterDelaySeconds: 0,
    /**
     * How long the meter takes to fade in once it is due.
     *
     * Long — most of the ramp. It is doing the work the delay used to do: the
     * readout is *there* from the first frame of the loss and simply cannot be read
     * yet, which is a slower and much less announced arrival than waiting eight
     * seconds and then cutting it in over two.
     */
    meterFadeSeconds: 12,
    /**
     * Never 1.
     *
     * The signal is weak and unwatchable, not absent. A transmission that reaches
     * zero is a blank screen, and a blank screen is indistinguishable from a crash —
     * there has to be enough left to see that something is still down there.
     */
    peak: 0.86,
    /** Reception in dB at onset, and where it settles. */
    dbStart: -12,
    dbFloor: -68,
    overlay: {
      /** Redraws a second. The caption is static and the trace does not need 60. */
      tickHz: 12,
      /** Seconds of history the dB trace shows. */
      windowSeconds: 12,
      /** The readout's vertical range. */
      dbTop: -4,
      dbBottom: -76,
      /** Cap on the drawing surface. Past this the text is already past crisp. */
      maxWidth: 1600,
    },

    lossLaps: {
      /**
       * The lap at which the route has stopped going anywhere and the signal starts to
       * go with it. This journey has no ending to reach, so the count stands in for
       * one. See lib/signalLoss.
       */
      loopLine: 5,
      /**
       * The lap on which the sun goes off.
       *
       * Two rather than the five every other looping journey uses, because here the
       * signal loss is not the point — it is the *consequence*. The star this whole
       * run is lit by comes apart (see the blast sequence in shader.ts), and an event
       * that only fires after nine minutes of walking is an event nobody sees. Two
       * laps is about three and a half minutes: long enough that the run has settled
       * into a rhythm, short enough that breaking it lands.
       */
      skybridges: 2,
      /**
       * Three laps, then the signal. Once the lap counter reads this the fourth lap
       * begins on the county road at night and the picture starts to go eight
       * seconds in — counted here, inside step(), never by the shell, because a
       * ?t= seek replays this simulation from zero without anyone watching.
       */
      scenicRoute: 3,
      /**
       * The lap at which the route has stopped going anywhere and the signal starts to
       * go with it. This journey has no ending to reach, so the count stands in for
       * one: by here its own decay has saturated and another lap says nothing new.
       * See lib/signalLoss.
       */
      natatorium: 5,
    },
  },

  settings: {
    /** The resolution value that hands the render scale to the adaptive governor. */
    autoResolution: AUTO_RESOLUTION,
    storageKey: 'journey-graphics-settings-v2',
    // Earlier keys, read once so existing users keep their config. v1 saved its
    // defaults on first visit, so a v1 resolution of 0.5 and heavy effects on are
    // what nobody chose: those migrate to the new defaults (AUTO, and heavy
    // effects only where the device can afford them).
    v1Key: 'journey-graphics-settings-v1',
    legacyKey: 'liminal-graphics-settings-v1',
    /** Static defaults: what the prerender and a desktop get. */
    defaults: {
      resolution:   AUTO_RESOLUTION,
      speed:        1,
      heavyEffects: true,
      brightness:   1,
      contrast:     1,
      maxFrameRate: 60,
      gyroscope:    true,
      crt:          true,
    },
    /** Allowed discrete choices surfaced in the settings UI. */
    resolutionChoices: [ AUTO_RESOLUTION, 0.15, 0.33, 0.5, 0.75, 1 ] as const,
    speedChoices: [ 1, 2, 4 ] as const,
    frameRateChoices: [ 30, 60, 120, 0 ] as const, // 0 = Unlimited
  },

  governor: {
    /** Frames per measurement window. */
    windowFrames: 24,
    /** Scale steps are quantised so a reallocation is never for a rounding error. */
    scaleQuantum: 0.05,
    /** Over budget by more than this fraction → step down. */
    overBudget: 1.2,
    /** Within this fraction of budget → the window counts as "holding". */
    holdBudget: 1.06,
    /** Holding windows before the first probe up, and its ceiling after backoff. */
    probeAfter: 4,
    probeAfterMax: 32,
    probeStep: 1.1,
  },

  quality: {
    /** What the prerender assumes, where there is no device to ask. */
    serverProfile: { mobile: false, dpr: 1, tier: 2 },

    /** What a renderer may spend at each device tier (0 phone .. 2 desktop). See QualityHints. */
    tiers: [
      { msaa: 0, bloomLevels: 3 },
      { msaa: 2, bloomLevels: 4 },
      { msaa: 4, bloomLevels: 5 },
    ],

    /** Highest dpr the render scale is ever derived from. */
    maxDpr: 2,

    /**
     * Render-scale bounds for the adaptive governor, in multiples of CSS pixels:
     * `maxOfDpr` is a fraction of the (capped) dpr, `maxCap` an absolute ceiling.
     *
     * A desktop starts at one backing pixel per CSS pixel and may climb to 1.5x. A
     * phone starts well under its CSS resolution (a 390-wide screen at 0.6x is
     * still 234 columns of a picture that is soft by design) and is never asked
     * for more than its CSS pixels.
     */
    scale: {
      phoneLow:   { min: 0.3, maxOfDpr: 0.6, maxCap: 1, start: 0.55 },
      phone:      { min: 0.35, maxOfDpr: 0.7, maxCap: 1, start: 0.7 },
      desktopMid: { min: 0.4, maxOfDpr: 0.6, maxCap: Infinity, start: 0.85 },
      desktop:    { min: 0.5, maxOfDpr: 0.75, maxCap: Infinity, start: 1 },
    },
  },

  transport: {
    /** Upper bound on seek iterations, so `?t=1e9` cannot hang the tab. */
    maxSeekSteps: 200_000,
    /** Forward search step: coarse, because it may cover minutes in one frame. */
    searchDt: 1 / 20,
    /** Journey-seconds a single forward move may cover before giving up. */
    forwardBudget: 900,
    /** Replay dt for backward moves. */
    seekDt: 1 / 20,
    /** How long you must be *into* a section (or lap) before going back restarts it. */
    graceSection: 1.5,
    graceLoop: 3,
    flashSeconds: 0.28,
    /** A progress sample is kept every this much of the lap. */
    sampleStep: 0.0025,
    // A journey with no marks() still gets working transport, it just moves by the
    // clock. These are the "lap" and "section" it pretends to have.
    fallbackLoopSeconds: 30,
    fallbackSectionSeconds: 8,
  },

  titleCard: {
    /** Seconds: fade in until IN, hold until HOLD, torn out by OUT. */
    fadeInAt: 1.15,
    holdUntil: 2.75,
    tornOutBy: 4,
    calm: {
      fadeInAt: 0.8,
      holdUntil: 2.2,
      tornOutBy: 3,
    },

    /** Byte-corrupted variants, from barely damaged to wrecked. */
    variants: 6,
    /** The glitch picks a new pattern this many times a second, like a frame rate. */
    glitchFps: 24,
  },

  crt: {
    /** The idle look. Subtle by design — every journey already grades its own image. */
    idle: {
      curve:      0.055,
      aberration: 0.0022,
      scanline:   0.045,
      vignette:   0.22,
    },
    /**
     * The tube switched off, for when the CRT setting is off but the pass still has
     * to run — for the signal loss, which is a story beat rather than a display
     * treatment, or for the display grade. Curvature and scanlines go; the
     * caption, the tearing, the snow and the grade stay.
     */
    bypass: {
      curve:      0,
      aberration: 0,
      scanline:   0,
      vignette:   0,
    },
  },

  gl: {
    /** Defaults tuned for a full-screen raymarch: no depth, no MSAA, opaque. */
    contextAttributes: {
      alpha:     false,
      antialias: false,
      depth:     false,
    },
  },

  runtime: {
    /** Loading bar progress at each stage, and what it says. */
    loading: {
      boot:      { progress: 0.04, status: 'LOADING' },
      compiling: { progress: 0.15, status: 'COMPILING SHADERS' },
      textures:  { from: 0.6, span: 0.32, status: 'LOADING TEXTURES' },
      warming:   { progress: 0.94, status: 'WARMING UP' },
      done:      { progress: 1, status: 'SIGNAL ACQUIRED' },
    },
    maxDpr: 2, // Backing-store cap for the fixed resolution choices, as before AUTO (and the preview canvas).
    warmFrames: 3, // Frames drawn at t = 0 once the assets are in, before the clock starts.
    assetTimeoutSeconds: 20, // Seconds to wait on a renderer's assets before starting without them.
    panEpsilon: 1e-4, // Pan movement too small to be worth redrawing a paused frame for.
  },

  ui: {
    // Render the preview below native resolution — plenty for a thumbnail, easy on the GPU.
    previewScale: 0.6,
    debugPanelSampleMs: 200,
    /** How long the bar takes to fade once loaded; the shell unmounts it after. */
    loaderFadeMs: 450,
    /** Arrow-key scrub step, as a fraction of the lap. */
    transportKeyStep: 0.02,
  },
} as const
