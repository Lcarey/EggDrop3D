/**
 * Physics validation corpus: 100 structures across 10 families, plus
 * single-factor isolation variants appended per distinct failure signature.
 *
 * This file is intentionally import-free (pure data + local types) so it can
 * be consumed both by the Playwright runner (run-validation.spec.ts) and by
 * the vitest schema check (src/validation/corpus.test.ts) without dragging
 * app or test-framework dependencies across boundaries.
 *
 * Coordinate conventions (matching the app):
 * - Ground/pad is y = 0; positions are body centers; dimensions are full extents.
 * - Egg: 0.048 x 0.064 x 0.048 m (half-height 0.032), mass ~0.057 kg.
 * - The whole assembly is raised to the drop height at release, so designs
 *   are built resting near the ground.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface TransformSpec {
  position: Vec3;
  rotation: Quat;
  dimensions: Vec3;
}

export interface PartSpec {
  id: string;
  materialId: string;
  transform: TransformSpec;
}

export interface JointSpec {
  id: string;
  kind: "fixed" | "rope" | "spring";
  materialId: "tape" | "glue" | "string" | "rubberBand";
  bodyA: string;
  bodyB: string;
  anchorA: Vec3;
  anchorB: Vec3;
}

export interface DesignSpec {
  schemaVersion: 1;
  physicsVersion: 1;
  name: string;
  mode: "sandbox";
  missionId: null;
  heightFt: number;
  eggTransform: TransformSpec;
  parts: PartSpec[];
  joints: JointSpec[];
}

export type PlanetId =
  | "moon"
  | "mars"
  | "venus"
  | "earth"
  | "uranus"
  | "neptune"
  | "saturn"
  | "jupiter";

export const PLANET_INDEX: Record<PlanetId, number> = {
  moon: 0,
  mars: 1,
  venus: 2,
  earth: 3,
  uranus: 4,
  neptune: 5,
  saturn: 6,
  jupiter: 7,
};

/** Mirror of GRAVITY_BODIES in packages/shared/src/physics.ts (do not import app code). */
export const PLANET_INFO: Record<PlanetId, { gravityMps2: number; airDensityKgM3: number }> = {
  moon: { gravityMps2: 1.62, airDensityKgM3: 0 },
  mars: { gravityMps2: 3.72, airDensityKgM3: 0.02 },
  venus: { gravityMps2: 8.87, airDensityKgM3: 65 },
  earth: { gravityMps2: 9.80665, airDensityKgM3: 1.225 },
  uranus: { gravityMps2: 8.69, airDensityKgM3: 0.42 },
  neptune: { gravityMps2: 11.15, airDensityKgM3: 0.45 },
  saturn: { gravityMps2: 10.44, airDensityKgM3: 0.19 },
  jupiter: { gravityMps2: 24.79, airDensityKgM3: 0.16 },
};

export interface ValidationSpec {
  id: string;
  family: string;
  name: string;
  intent: string;
  expectation: string;
  settings: { heightFt: number; planet: PlanetId; playback: number };
  design: DesignSpec;
  /** For variants: the base structure this isolates. */
  parentId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROT_ID: Quat = [0, 0, 0, 1];
/** 90 deg about z: local y axis (length) maps to world x. */
const ROT_Z90: Quat = [0, 0, 0.7071067811865476, 0.7071067811865476];
/** 90 deg about x: local y axis (length) maps to world z. */
const ROT_X90: Quat = [0.7071067811865476, 0, 0, 0.7071067811865476];

/** Catalog default dimensions (packages/shared/src/catalog.ts). */
const DIMS: Record<string, Vec3> = {
  straw: [0.012, 0.3, 0.012],
  tape: [0.025, 0.12, 0.002],
  glue: [0.02, 0.02, 0.02],
  balloon: [0.3, 0.38, 0.3],
  bubbleWrap: [0.25, 0.03, 0.25],
  string: [0.004, 0.35, 0.004],
  cardboard: [0.3, 0.012, 0.22],
  craftStick: [0.018, 0.15, 0.004],
  paperCup: [0.09, 0.11, 0.09],
  cottonBall: [0.06, 0.06, 0.06],
  foamBlock: [0.12, 0.12, 0.12],
  sponge: [0.12, 0.06, 0.08],
  rubberBand: [0.004, 0.12, 0.004],
  newspaper: [0.3, 0.008, 0.25],
  plasticBag: [0.45, 0.012, 0.45],
  packingPeanuts: [0.08, 0.05, 0.04],
  fishingWeight: [0.015, 0.025, 0.015],
};

const EGG_DIMS: Vec3 = [0.048, 0.064, 0.048];
export const EGG_HALF_HEIGHT = 0.032;

const part = (
  id: string,
  materialId: string,
  position: Vec3,
  options: { dims?: Vec3; rot?: Quat } = {},
): PartSpec => ({
  id,
  materialId,
  transform: {
    position,
    rotation: options.rot ?? ROT_ID,
    dimensions: options.dims ?? DIMS[materialId]!,
  },
});

const joint = (
  id: string,
  kind: JointSpec["kind"],
  materialId: JointSpec["materialId"],
  bodyA: string,
  bodyB: string,
  anchorA: Vec3,
  anchorB: Vec3,
): JointSpec => ({ id, kind, materialId, bodyA, bodyB, anchorA, anchorB });

const tape = (id: string, a: string, b: string, anchorA: Vec3, anchorB: Vec3) =>
  joint(id, "fixed", "tape", a, b, anchorA, anchorB);
const glue = (id: string, a: string, b: string, anchorA: Vec3, anchorB: Vec3) =>
  joint(id, "fixed", "glue", a, b, anchorA, anchorB);
const rope = (id: string, a: string, b: string, anchorA: Vec3, anchorB: Vec3) =>
  joint(id, "rope", "string", a, b, anchorA, anchorB);
const band = (id: string, a: string, b: string, anchorA: Vec3, anchorB: Vec3) =>
  joint(id, "spring", "rubberBand", a, b, anchorA, anchorB);

const eggAt = (position: Vec3): TransformSpec => ({
  position,
  rotation: ROT_ID,
  dimensions: EGG_DIMS,
});

interface SpecArgs {
  id: string;
  family: string;
  name: string;
  intent: string;
  expectation: string;
  heightFt: number;
  planet: PlanetId;
  playback?: number;
  egg: Vec3;
  parts?: PartSpec[];
  joints?: JointSpec[];
  parentId?: string;
}

const spec = (args: SpecArgs): ValidationSpec => ({
  id: args.id,
  family: args.family,
  name: args.name,
  intent: args.intent,
  expectation: args.expectation,
  settings: { heightFt: args.heightFt, planet: args.planet, playback: args.playback ?? 1 },
  parentId: args.parentId,
  design: {
    schemaVersion: 1,
    physicsVersion: 1,
    name: args.name.slice(0, 60),
    mode: "sandbox",
    missionId: null,
    heightFt: args.heightFt,
    eggTransform: eggAt(args.egg),
    parts: args.parts ?? [],
    joints: args.joints ?? [],
  },
});

// ---------------------------------------------------------------------------
// Family 1 — Baselines: bare egg, anchor expected cracks at plausible speeds
// ---------------------------------------------------------------------------

const bare = (id: string, planet: PlanetId, heightFt: number): ValidationSpec =>
  spec({
    id,
    family: "f1-baselines",
    name: `Bare egg ${heightFt} ft ${planet}`,
    intent: "Anchor: bare egg free-fall, no parts",
    expectation: "Cracks (except very low gravity/short drop); impact near sqrt(2gh) minus drag",
    heightFt,
    planet,
    egg: [0, 0.38, 0],
  });

const family1: ValidationSpec[] = [
  bare("f1-bare-earth-5", "earth", 5),
  bare("f1-bare-earth-25", "earth", 25),
  bare("f1-bare-earth-50", "earth", 50),
  bare("f1-bare-earth-100", "earth", 100),
  bare("f1-bare-moon-5", "moon", 5),
  bare("f1-bare-moon-100", "moon", 100),
  bare("f1-bare-jupiter-5", "jupiter", 5),
  bare("f1-bare-jupiter-50", "jupiter", 50),
  bare("f1-bare-mars-25", "mars", 25),
  bare("f1-bare-venus-25", "venus", 25),
];

// ---------------------------------------------------------------------------
// Family 2 — Cushion landings
// ---------------------------------------------------------------------------

const family2: ValidationSpec[] = [
  spec({
    id: "f2-foam-single",
    family: "f2-cushions",
    name: "Egg on one foam block",
    intent: "Minimal cushion landing",
    expectation: "Lands, settles quickly, plausible metrics; may survive",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.152, 0],
    parts: [part("foam", "foamBlock", [0, 0.06, 0])],
  }),
  spec({
    id: "f2-foam-stack-3",
    family: "f2-cushions",
    name: "Egg on three stacked foam blocks",
    intent: "Loose vertical cushion stack",
    expectation: "Stack may topple but no energy injection; egg cushioned",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.392, 0],
    parts: [
      part("foam1", "foamBlock", [0, 0.06, 0]),
      part("foam2", "foamBlock", [0, 0.18, 0]),
      part("foam3", "foamBlock", [0, 0.3, 0]),
    ],
  }),
  spec({
    id: "f2-cotton-nest",
    family: "f2-cushions",
    name: "Egg in a cotton-ball nest",
    intent: "Soft loose padding surrounding the egg",
    expectation: "Very soft landing; no jitter at rest",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.092, 0],
    parts: [
      part("c0", "cottonBall", [0, 0.03, 0]),
      part("c1", "cottonBall", [0.06, 0.03, 0]),
      part("c2", "cottonBall", [-0.06, 0.03, 0]),
      part("c3", "cottonBall", [0, 0.03, 0.06]),
      part("c4", "cottonBall", [0, 0.03, -0.06]),
    ],
  }),
  spec({
    id: "f2-sponge-pad",
    family: "f2-cushions",
    name: "Egg on two sponges",
    intent: "Springy cushion pair",
    expectation: "Compresses and settles; restitution 0.22 gives a small bounce only",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.092, 0],
    parts: [
      part("sp1", "sponge", [-0.06, 0.03, 0]),
      part("sp2", "sponge", [0.06, 0.03, 0]),
    ],
  }),
  spec({
    id: "f2-peanut-bed",
    family: "f2-cushions",
    name: "Egg on a 12-peanut bed",
    intent: "Many tiny light cushions under a heavier egg",
    expectation: "Peanuts scatter mildly but cushion; no squirting at high speed",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.082, 0],
    parts: [-0.12, -0.04, 0.04, 0.12].flatMap((x, ix) =>
      [-0.05, 0, 0.05].map((z, iz) => part(`pn-${ix}-${iz}`, "packingPeanuts", [x, 0.025, z])),
    ),
  }),
  spec({
    id: "f2-bubble-triple",
    family: "f2-cushions",
    name: "Egg on three bubble-wrap sheets",
    intent: "Layered thin cushioning",
    expectation: "Sheets absorb impact; plausible G",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.122, 0],
    parts: [
      part("bw1", "bubbleWrap", [0, 0.015, 0]),
      part("bw2", "bubbleWrap", [0, 0.045, 0]),
      part("bw3", "bubbleWrap", [0, 0.075, 0]),
    ],
  }),
  spec({
    id: "f2-cup-column",
    family: "f2-cushions",
    name: "Egg on a 3-cup crumple column",
    intent: "Tall light crush zone under the egg",
    expectation: "Column may collapse; egg decelerates over the collapse",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.362, 0],
    parts: [
      part("cup1", "paperCup", [0, 0.055, 0]),
      part("cup2", "paperCup", [0, 0.165, 0]),
      part("cup3", "paperCup", [0, 0.275, 0]),
    ],
  }),
  spec({
    id: "f2-layered-pad",
    family: "f2-cushions",
    name: "Taped layered pad (cardboard-foam-cotton)",
    intent: "Welded sandwich of very different densities under a taped egg",
    expectation: "Falls as one unit, cushioned landing, no weld oscillation",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.224, 0],
    parts: [
      part("board", "cardboard", [0, 0.006, 0]),
      part("foam", "foamBlock", [0, 0.072, 0]),
      part("cotton", "cottonBall", [0, 0.162, 0]),
    ],
    joints: [
      tape("t1", "board", "foam", [0, 0.006, 0], [0, -0.06, 0]),
      tape("t2", "foam", "cotton", [0, 0.06, 0], [0, -0.03, 0]),
      tape("t3", "egg", "cotton", [0, -0.032, 0], [0, 0.03, 0]),
    ],
  }),
  spec({
    id: "f2-newspaper-wrap",
    family: "f2-cushions",
    name: "Egg taped between two newspaper sheets",
    intent: "Thin crumple wrap above and below the egg",
    expectation: "Falls flat or tumbles; sheets add drag and cushioning",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.04, 0],
    parts: [
      part("news-lo", "newspaper", [0, 0.004, 0]),
      part("news-hi", "newspaper", [0, 0.076, 0]),
    ],
    joints: [
      tape("t1", "egg", "news-lo", [0, -0.032, 0], [0, 0.004, 0]),
      tape("t2", "egg", "news-hi", [0, 0.032, 0], [0, -0.004, 0]),
    ],
  }),
  spec({
    id: "f2-cushion-pyramid",
    family: "f2-cushions",
    name: "Loose cushion pyramid, egg on top",
    intent: "Tall loose stack from 100 ft",
    expectation: "Pyramid scatters on landing at plausible speeds; egg outcome depends on where it lands",
    heightFt: 100,
    planet: "earth",
    egg: [0, 0.272, 0],
    parts: [
      part("base1", "foamBlock", [-0.062, 0.06, -0.062]),
      part("base2", "foamBlock", [0.062, 0.06, -0.062]),
      part("base3", "foamBlock", [-0.062, 0.06, 0.062]),
      part("base4", "foamBlock", [0.062, 0.06, 0.062]),
      part("mid1", "sponge", [0, 0.15, -0.04]),
      part("mid2", "sponge", [0, 0.15, 0.04]),
      part("top", "cottonBall", [0, 0.21, 0]),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Family 3 — Balloon lift and suspension
// ---------------------------------------------------------------------------

const family3: ValidationSpec[] = [
  spec({
    id: "f3-string-single",
    family: "f3-balloons",
    name: "One balloon on a string above the egg",
    intent: "Simplest balloon suspension (0.3 m span)",
    expectation: "Slows the fall a little; stable tether",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("b1", "balloon", [0, 0.622, 0])],
    joints: [rope("s1", "egg", "b1", [0, 0.032, 0], [0, -0.19, 0])],
  }),
  spec({
    id: "f3-string-three",
    family: "f3-balloons",
    name: "Three balloons on strings",
    intent: "Multi-balloon soft suspension",
    expectation: "Noticeably slowed descent, no tether instability",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.62, 0]),
      part("b2", "balloon", [0.18, 0.62, 0]),
      part("b3", "balloon", [0, 0.62, 0.18]),
    ],
    joints: [
      rope("s1", "egg", "b1", [0, 0.032, 0], [0.05, -0.19, 0]),
      rope("s2", "egg", "b2", [0, 0.032, 0], [-0.05, -0.19, 0]),
      rope("s3", "egg", "b3", [0, 0.032, 0], [0, -0.19, -0.05]),
    ],
  }),
  spec({
    id: "f3-tape-two",
    family: "f3-balloons",
    name: "Egg taped to two balloons",
    intent: "Known ill-conditioned case: short rigid welds egg-balloon (fixed bug)",
    expectation: "No startup impulse, no mid-air crack, plausible speeds",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("bl", "balloon", [-0.18, 0.68, 0]),
      part("br", "balloon", [0.18, 0.68, 0]),
    ],
    joints: [
      tape("t1", "egg", "bl", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      tape("t2", "egg", "br", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
    ],
  }),
  spec({
    id: "f3-balloon-below",
    family: "f3-balloons",
    name: "Egg riding a balloon (balloon below)",
    intent: "Balloon as landing cushion, roped so it cannot escape",
    expectation: "Balloon cushions landing; egg stays on top or beside",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.412, 0],
    parts: [part("b1", "balloon", [0, 0.19, 0])],
    joints: [rope("s1", "egg", "b1", [0, -0.032, 0], [0, 0.19, 0])],
  }),
  spec({
    id: "f3-neutral-four",
    family: "f3-balloons",
    name: "Four corner balloons on strings",
    intent: "Near-neutral buoyancy cluster on separate strings",
    expectation: "Very slow descent on Earth; strings stay taut and stable",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [
      part("b1", "balloon", [-0.16, 0.62, -0.16]),
      part("b2", "balloon", [0.16, 0.62, -0.16]),
      part("b3", "balloon", [-0.16, 0.62, 0.16]),
      part("b4", "balloon", [0.16, 0.62, 0.16]),
    ],
    joints: [
      rope("s1", "egg", "b1", [0, 0.032, 0], [0.05, -0.19, 0.05]),
      rope("s2", "egg", "b2", [0, 0.032, 0], [-0.05, -0.19, 0.05]),
      rope("s3", "egg", "b3", [0, 0.032, 0], [0.05, -0.19, -0.05]),
      rope("s4", "egg", "b4", [0, 0.032, 0], [-0.05, -0.19, -0.05]),
    ],
  }),
  spec({
    id: "f3-glue-cluster-8",
    family: "f3-balloons",
    name: "Eight-balloon glued cluster on a string",
    intent: "Glue-cycle balloon blob lifting an egg on a string (near known bug shape)",
    expectation: "Cluster stays coherent; egg speed plausible",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [
      part("b0", "balloon", [0, 0.9, 0]),
      part("b1", "balloon", [0.2, 0.9, 0.04]),
      part("b2", "balloon", [-0.2, 0.9, -0.04]),
      part("b3", "balloon", [0.04, 0.9, 0.2]),
      part("b4", "balloon", [-0.04, 0.9, -0.2]),
      part("b5", "balloon", [0.02, 1.12, 0.02]),
      part("b6", "balloon", [0.21, 1.12, 0.05]),
      part("b7", "balloon", [-0.18, 1.12, -0.03]),
    ],
    joints: [
      glue("g0", "b0", "b1", [0.1, 0, 0], [-0.1, 0, 0]),
      glue("g1", "b1", "b3", [-0.08, 0, 0.08], [0.08, 0, -0.08]),
      glue("g2", "b3", "b2", [-0.1, 0, -0.1], [0.1, 0, 0.1]),
      glue("g3", "b2", "b4", [0.08, 0, -0.08], [-0.08, 0, 0.08]),
      glue("g4", "b4", "b0", [0.02, 0, 0.1], [-0.02, 0, -0.1]),
      glue("g5", "b0", "b5", [0, 0.11, 0], [0, -0.11, 0]),
      glue("g6", "b5", "b6", [0.1, 0, 0], [-0.1, 0, 0]),
      glue("g7", "b6", "b7", [-0.19, 0, -0.04], [0.19, 0, 0.04]),
      glue("g8", "b7", "b5", [0.1, 0, 0.025], [-0.1, 0, -0.025]),
      rope("s1", "egg", "b0", [0, 0.032, 0], [0, -0.19, 0]),
    ],
  }),
  spec({
    id: "f3-mega-balloon",
    family: "f3-balloons",
    name: "One double-size balloon on a string",
    intent: "Scaled dimensions: buoyancy and added mass scale with volume",
    expectation: "Strong lift; likely floats or descends very slowly; stable",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("mega", "balloon", [0, 0.9, 0], { dims: [0.6, 0.76, 0.6] })],
    joints: [rope("s1", "egg", "mega", [0, 0.032, 0], [0, -0.38, 0])],
  }),
  spec({
    id: "f3-tape-cluster-4",
    family: "f3-balloons",
    name: "Four balloons taped straight to the egg",
    intent: "Adversarial revisit of the taped-balloon weld case, doubled",
    expectation: "No solver oscillation despite 4 short rigid welds on a light egg",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.68, 0]),
      part("b2", "balloon", [0.18, 0.68, 0]),
      part("b3", "balloon", [0, 0.68, -0.18]),
      part("b4", "balloon", [0, 0.68, 0.18]),
    ],
    joints: [
      tape("t1", "egg", "b1", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      tape("t2", "egg", "b2", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
      tape("t3", "egg", "b3", [0, 0.03, -0.02], [0, -0.19, 0.16]),
      tape("t4", "egg", "b4", [0, 0.03, 0.02], [0, -0.19, -0.16]),
    ],
  }),
  spec({
    id: "f3-string-below-thresh",
    family: "f3-balloons",
    name: "Balloon on a 0.70 m string (below chain threshold)",
    intent: "Span just below MIN_SEGMENTED_ROPE_LENGTH_M = 0.85",
    expectation: "Single logical tether, no capsule segmentation",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("b1", "balloon", [0, 1.022, 0])],
    joints: [rope("s1", "egg", "b1", [0, 0.032, 0], [0, -0.19, 0])],
  }),
  spec({
    id: "f3-string-above-thresh",
    family: "f3-balloons",
    name: "Balloon on a 1.20 m string (above chain threshold)",
    intent: "Span above 0.85 m triggers the segmented-chain path",
    expectation: "Chained rope hangs and swings smoothly; no segment spray",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("b1", "balloon", [0, 1.522, 0])],
    joints: [rope("s1", "egg", "b1", [0, 0.032, 0], [0, -0.19, 0])],
  }),
];

// ---------------------------------------------------------------------------
// Family 4 — Parachutes (plastic bag canopies)
// ---------------------------------------------------------------------------

const bagSingle = (
  id: string,
  planet: PlanetId,
  heightFt: number,
  expectation: string,
): ValidationSpec =>
  spec({
    id,
    family: "f4-parachutes",
    name: `Bag parachute, 2 strings, ${planet} ${heightFt} ft`,
    intent: "Reference single-bag canopy with a 2-string harness",
    expectation,
    heightFt,
    planet,
    egg: [0, 0.1, 0],
    parts: [part("bag", "plasticBag", [0, 0.75, 0])],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.2, -0.006, 0]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.2, -0.006, 0]),
    ],
  });

const family4: ValidationSpec[] = [
  bagSingle("f4-bag-single", "earth", 50, "Canopy inflates, slows descent well below free-fall"),
  spec({
    id: "f4-bag-double",
    family: "f4-parachutes",
    name: "Two bag parachutes from 100 ft",
    intent: "Twin canopies on separate strings",
    expectation: "Slower than single bag; canopies may jostle but stay stable",
    heightFt: 100,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [
      part("bag1", "plasticBag", [-0.3, 0.75, 0]),
      part("bag2", "plasticBag", [0.3, 0.75, 0]),
    ],
    joints: [
      rope("s1", "egg", "bag1", [0, 0.032, 0], [0.1, -0.006, 0]),
      rope("s2", "egg", "bag2", [0, 0.032, 0], [-0.1, -0.006, 0]),
    ],
  }),
  spec({
    id: "f4-bag-harness-4",
    family: "f4-parachutes",
    name: "Bag with a 4-string corner harness",
    intent: "Proper 4-point harness geometry",
    expectation: "Most stable canopy; egg hangs centered",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("bag", "plasticBag", [0, 0.75, 0])],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.2, -0.006, 0.2]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.2, -0.006, 0.2]),
      rope("s3", "egg", "bag", [0, 0.032, 0], [0.2, -0.006, -0.2]),
      rope("s4", "egg", "bag", [0, 0.032, 0], [-0.2, -0.006, -0.2]),
    ],
  }),
  spec({
    id: "f4-bag-below",
    family: "f4-parachutes",
    name: "Bag below the egg",
    intent: "Payload above the canopy: blockage should kill most of the drag benefit",
    expectation: "Falls much faster than bag-above; canopy may flip or self-right",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.5, 0],
    parts: [part("bag", "plasticBag", [0, 0.05, 0])],
    joints: [rope("s1", "egg", "bag", [0, -0.032, 0], [0, 0.006, 0])],
  }),
  bagSingle("f4-bag-moon", "moon", 50, "No atmosphere: bag must NOT slow the fall at all"),
  bagSingle("f4-bag-venus", "venus", 50, "65 kg/m3 air: descent should be extremely slow"),
  bagSingle("f4-bag-mars", "mars", 50, "Thin CO2: bag barely helps"),
  spec({
    id: "f4-bag-ballast",
    family: "f4-parachutes",
    name: "Bag parachute with lead ballast under the egg",
    intent: "Heavy pendulum under a canopy",
    expectation: "Faster descent than unballasted; pendulum damps out",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.5, 0],
    parts: [
      part("bag", "plasticBag", [0, 1.15, 0]),
      part("weight", "fishingWeight", [0, 0.3, 0]),
    ],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.2, -0.006, 0]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.2, -0.006, 0]),
      rope("s3", "egg", "weight", [0, -0.032, 0], [0, 0.0125, 0]),
    ],
  }),
  spec({
    id: "f4-bag-taped",
    family: "f4-parachutes",
    name: "Bag taped rigidly to the egg",
    intent: "Adversarial: rigid weld to a draggy sheet instead of a soft harness",
    expectation: "Assembly tumbles or glides; no weld oscillation blow-up",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("bag", "plasticBag", [0, 0.35, 0])],
    joints: [tape("t1", "egg", "bag", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f4-bag-mega",
    family: "f4-parachutes",
    name: "Double-size bag canopy from 100 ft",
    intent: "Scaled canopy area (4x drag area)",
    expectation: "Very slow terminal descent; big canopy stays inflated",
    heightFt: 100,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("bag", "plasticBag", [0, 0.9, 0], { dims: [0.9, 0.012, 0.9] })],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.4, -0.006, 0.4]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.4, -0.006, 0.4]),
      rope("s3", "egg", "bag", [0, 0.032, 0], [0.4, -0.006, -0.4]),
      rope("s4", "egg", "bag", [0, 0.032, 0], [-0.4, -0.006, -0.4]),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Family 5 — Rigid frames
// ---------------------------------------------------------------------------

/** 4 vertical straws + cardboard roof, joints parameterized tape vs glue. */
const strawFrame = (
  id: string,
  name: string,
  intent: string,
  useGlue: boolean,
  planet: PlanetId,
  heightFt: number,
): ValidationSpec => {
  const j = useGlue ? glue : tape;
  return spec({
    id,
    family: "f5-frames",
    name,
    intent,
    expectation: "Frame lands as a unit or breaks at plausible loads; egg protected or not, plausibly",
    heightFt,
    planet,
    egg: [0, 0.032, 0],
    parts: [
      part("post1", "straw", [-0.08, 0.15, -0.08]),
      part("post2", "straw", [0.08, 0.15, -0.08]),
      part("post3", "straw", [-0.08, 0.15, 0.08]),
      part("post4", "straw", [0.08, 0.15, 0.08]),
      part("roof", "cardboard", [0, 0.306, 0]),
    ],
    joints: [
      j("j1", "post1", "roof", [0, 0.15, 0], [-0.08, -0.006, -0.08]),
      j("j2", "post2", "roof", [0, 0.15, 0], [0.08, -0.006, -0.08]),
      j("j3", "post3", "roof", [0, 0.15, 0], [-0.08, -0.006, 0.08]),
      j("j4", "post4", "roof", [0, 0.15, 0], [0.08, -0.006, 0.08]),
    ],
  });
};

const family5: ValidationSpec[] = [
  spec({
    id: "f5-straw-cage",
    family: "f5-frames",
    name: "Straw cage with bubble-wrap floor",
    intent: "Taped straw box protecting a loose egg",
    expectation: "Cage absorbs the hit; joints may break at plausible loads",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.062, 0],
    parts: [
      part("floor", "bubbleWrap", [0, 0.015, 0]),
      part("post1", "straw", [-0.08, 0.18, -0.08]),
      part("post2", "straw", [0.08, 0.18, -0.08]),
      part("post3", "straw", [-0.08, 0.18, 0.08]),
      part("post4", "straw", [0.08, 0.18, 0.08]),
      part("beam1", "straw", [0, 0.336, -0.08], { rot: ROT_Z90 }),
      part("beam2", "straw", [0, 0.336, 0.08], { rot: ROT_Z90 }),
    ],
    joints: [
      tape("t1", "floor", "post1", [-0.08, 0.015, -0.08], [0, -0.15, 0]),
      tape("t2", "floor", "post2", [0.08, 0.015, -0.08], [0, -0.15, 0]),
      tape("t3", "floor", "post3", [-0.08, 0.015, 0.08], [0, -0.15, 0]),
      tape("t4", "floor", "post4", [0.08, 0.015, 0.08], [0, -0.15, 0]),
      tape("t5", "beam1", "post1", [0, -0.08, 0], [0, 0.15, 0]),
      tape("t6", "beam1", "post2", [0, 0.08, 0], [0, 0.15, 0]),
      tape("t7", "beam2", "post3", [0, -0.08, 0], [0, 0.15, 0]),
      tape("t8", "beam2", "post4", [0, 0.08, 0], [0, 0.15, 0]),
    ],
  }),
  spec({
    id: "f5-stick-lattice",
    family: "f5-frames",
    name: "Glued craft-stick lattice",
    intent: "Small dense wooden frame around the egg",
    expectation: "Stiff frame, high break force; lands hard but coherently",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.032, 0],
    parts: [
      part("v1", "craftStick", [-0.05, 0.075, -0.05]),
      part("v2", "craftStick", [0.05, 0.075, -0.05]),
      part("v3", "craftStick", [-0.05, 0.075, 0.05]),
      part("v4", "craftStick", [0.05, 0.075, 0.05]),
      part("x1", "craftStick", [0, 0.152, -0.05], { rot: ROT_Z90 }),
      part("x2", "craftStick", [0, 0.152, 0.05], { rot: ROT_Z90 }),
    ],
    joints: [
      glue("g1", "x1", "v1", [0, -0.05, 0], [0, 0.075, 0]),
      glue("g2", "x1", "v2", [0, 0.05, 0], [0, 0.075, 0]),
      glue("g3", "x2", "v3", [0, -0.05, 0], [0, 0.075, 0]),
      glue("g4", "x2", "v4", [0, 0.05, 0], [0, 0.075, 0]),
    ],
  }),
  spec({
    id: "f5-cardboard-box",
    family: "f5-frames",
    name: "Cardboard box with taped walls",
    intent: "Panel box: floor plus four taped walls, loose egg inside",
    expectation: "Box holds together; egg rattles but metrics stay sane",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.044, 0],
    parts: [
      part("floor", "cardboard", [0, 0.006, 0]),
      part("wall-e", "cardboard", [0.144, 0.162, 0], { rot: ROT_Z90 }),
      part("wall-w", "cardboard", [-0.144, 0.162, 0], { rot: ROT_Z90 }),
      part("wall-n", "cardboard", [0, 0.162, -0.104], { rot: ROT_X90 }),
      part("wall-s", "cardboard", [0, 0.162, 0.104], { rot: ROT_X90 }),
    ],
    joints: [
      tape("t1", "floor", "wall-e", [0.144, 0.006, 0], [0, -0.15, 0]),
      tape("t2", "floor", "wall-w", [-0.144, 0.006, 0], [0, 0.15, 0]),
      tape("t3", "floor", "wall-n", [0, 0.006, -0.104], [0, -0.15, 0]),
      tape("t4", "floor", "wall-s", [0, 0.006, 0.104], [0, 0.15, 0]),
    ],
  }),
  strawFrame("f5-frame-taped", "Straw frame, taped joints", "Tape welds (breakForceN 120)", false, "earth", 50),
  strawFrame("f5-frame-glued", "Straw frame, glued joints", "Glue welds (breakForceN 150), same geometry as taped twin", true, "earth", 50),
  spec({
    id: "f5-band-suspension",
    family: "f5-frames",
    name: "Egg suspended by 4 rubber bands in a straw frame",
    intent: "Classic suspension rig: spring joints inside a taped frame",
    expectation: "Egg oscillates gently and never touches ground hard",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.15, 0],
    parts: [
      part("post1", "straw", [-0.08, 0.15, -0.08]),
      part("post2", "straw", [0.08, 0.15, -0.08]),
      part("post3", "straw", [-0.08, 0.15, 0.08]),
      part("post4", "straw", [0.08, 0.15, 0.08]),
      part("roof", "cardboard", [0, 0.306, 0]),
    ],
    joints: [
      tape("t1", "post1", "roof", [0, 0.15, 0], [-0.08, -0.006, -0.08]),
      tape("t2", "post2", "roof", [0, 0.15, 0], [0.08, -0.006, -0.08]),
      tape("t3", "post3", "roof", [0, 0.15, 0], [-0.08, -0.006, 0.08]),
      tape("t4", "post4", "roof", [0, 0.15, 0], [0.08, -0.006, 0.08]),
      band("r1", "egg", "post1", [-0.02, 0.02, -0.02], [0, 0.1, 0]),
      band("r2", "egg", "post2", [0.02, 0.02, -0.02], [0, 0.1, 0]),
      band("r3", "egg", "post3", [-0.02, 0.02, 0.02], [0, 0.1, 0]),
      band("r4", "egg", "post4", [0.02, 0.02, 0.02], [0, 0.1, 0]),
    ],
  }),
  spec({
    id: "f5-cup-cradle",
    family: "f5-frames",
    name: "Egg in a paper cup with stick legs",
    intent: "Cup cradle geometry plus taped landing legs",
    expectation: "Cup cradles the egg; legs take first contact",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      part("cup", "paperCup", [0, 0.055, 0]),
      part("leg1", "craftStick", [-0.06, 0.075, -0.06]),
      part("leg2", "craftStick", [0.06, 0.075, -0.06]),
      part("leg3", "craftStick", [-0.06, 0.075, 0.06]),
      part("leg4", "craftStick", [0.06, 0.075, 0.06]),
    ],
    joints: [
      tape("t1", "cup", "leg1", [-0.045, 0, -0.045], [0.015, -0.02, 0.015]),
      tape("t2", "cup", "leg2", [0.045, 0, -0.045], [-0.015, -0.02, 0.015]),
      tape("t3", "cup", "leg3", [-0.045, 0, 0.045], [0.015, -0.02, -0.015]),
      tape("t4", "cup", "leg4", [0.045, 0, 0.045], [-0.015, -0.02, -0.015]),
    ],
  }),
  spec({
    id: "f5-corner-bumpers",
    family: "f5-frames",
    name: "Cardboard sled with foam corner bumpers",
    intent: "Heavy plate with cushioned corners from 100 ft",
    expectation: "Bumpers strike first; plate does not trampoline the egg",
    heightFt: 100,
    planet: "earth",
    egg: [0, 0.164, 0],
    parts: [
      part("plate", "cardboard", [0, 0.126, 0]),
      part("bump1", "foamBlock", [-0.105, 0.06, -0.08]),
      part("bump2", "foamBlock", [0.105, 0.06, -0.08]),
      part("bump3", "foamBlock", [-0.105, 0.06, 0.08]),
      part("bump4", "foamBlock", [0.105, 0.06, 0.08]),
    ],
    joints: [
      tape("t1", "plate", "bump1", [-0.105, -0.006, -0.08], [0, 0.06, 0]),
      tape("t2", "plate", "bump2", [0.105, -0.006, -0.08], [0, 0.06, 0]),
      tape("t3", "plate", "bump3", [-0.105, -0.006, 0.08], [0, 0.06, 0]),
      tape("t4", "plate", "bump4", [0.105, -0.006, 0.08], [0, 0.06, 0]),
      tape("t5", "egg", "plate", [0, -0.032, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "f5-straw-outriggers",
    family: "f5-frames",
    name: "Cup with four horizontal straw outriggers",
    intent: "Wide, light footprint to prevent tipping",
    expectation: "Outriggers stabilize the landing; taped joints hold or break plausibly",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      part("cup", "paperCup", [0, 0.055, 0]),
      part("out-e", "straw", [0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-w", "straw", [-0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-n", "straw", [0, 0.055, -0.195], { rot: ROT_X90 }),
      part("out-s", "straw", [0, 0.055, 0.195], { rot: ROT_X90 }),
    ],
    joints: [
      tape("t1", "cup", "out-e", [0.045, 0, 0], [0, -0.15, 0]),
      tape("t2", "cup", "out-w", [-0.045, 0, 0], [0, 0.15, 0]),
      tape("t3", "cup", "out-n", [0, 0, -0.045], [0, 0.15, 0]),
      tape("t4", "cup", "out-s", [0, 0, 0.045], [0, -0.15, 0]),
    ],
  }),
  strawFrame("f5-frame-jupiter", "Straw frame on Jupiter", "Glued frame under 24.8 m/s2 gravity", true, "jupiter", 25),
];

// ---------------------------------------------------------------------------
// Family 6 — Tethers and pendulums
// ---------------------------------------------------------------------------

const family6: ValidationSpec[] = [
  spec({
    id: "f6-string-1m",
    family: "f6-tethers",
    name: "Egg on a 1.0 m string under a cardboard plate",
    intent: "Metre-class string tether (segmented chain path)",
    expectation: "Chain hangs, swings, and lands smoothly; no stick spray",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.15, 0],
    parts: [part("plate", "cardboard", [0, 1.2, 0])],
    joints: [rope("s1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f6-tape-tether-12",
    family: "f6-tethers",
    name: "Egg on a 1.25 m tape tether",
    intent: "Long fixed-material tether: chained tape path",
    expectation: "Behaves like a stiff ribbon; no divergence",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("plate", "cardboard", [0, 1.4, 0])],
    joints: [tape("t1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f6-daisy-chain",
    family: "f6-tethers",
    name: "Four-body string daisy chain",
    intent: "Egg-straw-cup-foam chained by three short strings",
    expectation: "Chain unrolls in flight and lands sequentially",
    heightFt: 50,
    planet: "earth",
    egg: [0, 1.4, 0],
    parts: [
      part("link1", "straw", [0, 1.0, 0]),
      part("link2", "paperCup", [0, 0.5, 0]),
      part("link3", "foamBlock", [0, 0.1, 0]),
    ],
    joints: [
      rope("s1", "egg", "link1", [0, -0.032, 0], [0, 0.15, 0]),
      rope("s2", "link1", "link2", [0, -0.15, 0], [0, 0.055, 0]),
      rope("s3", "link2", "link3", [0, -0.055, 0], [0, 0.06, 0]),
    ],
  }),
  spec({
    id: "f6-heavy-pendulum",
    family: "f6-tethers",
    name: "Egg swinging under a glued lead cluster",
    intent: "Huge mass ratio across a ~0.95 m string",
    expectation: "Weights fall ballistically; egg trails as pendulum; string may break on arrest",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.3, 0],
    parts: [
      part("w1", "fishingWeight", [0, 1.3, 0]),
      part("w2", "fishingWeight", [0.015, 1.3, 0]),
      part("w3", "fishingWeight", [-0.015, 1.3, 0]),
      part("w4", "fishingWeight", [0, 1.3, 0.015]),
    ],
    joints: [
      glue("g1", "w1", "w2", [0.0075, 0, 0], [-0.0075, 0, 0]),
      glue("g2", "w1", "w3", [-0.0075, 0, 0], [0.0075, 0, 0]),
      glue("g3", "w1", "w4", [0, 0, 0.0075], [0, 0, -0.0075]),
      rope("s1", "egg", "w1", [0, 0.032, 0], [0, -0.0125, 0]),
    ],
  }),
  spec({
    id: "f6-slack-line",
    family: "f6-tethers",
    name: "Egg slung between two cardboard anchors",
    intent: "Two-anchor slack line with the egg at the middle",
    expectation: "Egg hangs between plates; assembly lands without whip",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.4, 0],
    parts: [
      part("anchor-l", "cardboard", [-0.5, 0.8, 0]),
      part("anchor-r", "cardboard", [0.5, 0.8, 0]),
    ],
    joints: [
      rope("s1", "egg", "anchor-l", [0, 0.032, 0], [0.1, -0.006, 0]),
      rope("s2", "egg", "anchor-r", [0, 0.032, 0], [-0.1, -0.006, 0]),
    ],
  }),
  spec({
    id: "f6-short-string",
    family: "f6-tethers",
    name: "Egg on a 0.42 m string (below chain threshold)",
    intent: "Twin of f6-string-1m below MIN_SEGMENTED_ROPE_LENGTH_M",
    expectation: "Simple distance constraint; no chaining",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [part("plate", "cardboard", [0, 0.55, 0])],
    joints: [rope("s1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f6-string-series",
    family: "f6-tethers",
    name: "Three strings in series through cotton balls",
    intent: "Serial rope constraints with light intermediate bodies",
    expectation: "Series chain stays orderly; no oscillation growth",
    heightFt: 50,
    planet: "earth",
    egg: [0, 1.1, 0],
    parts: [
      part("mid1", "cottonBall", [0, 0.8, 0]),
      part("mid2", "cottonBall", [0, 0.5, 0]),
      part("plate", "cardboard", [0, 0.2, 0]),
    ],
    joints: [
      rope("s1", "egg", "mid1", [0, -0.032, 0], [0, 0.03, 0]),
      rope("s2", "mid1", "mid2", [0, -0.03, 0], [0, 0.03, 0]),
      rope("s3", "mid2", "plate", [0, -0.03, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "f6-pendulum-moon",
    family: "f6-tethers",
    name: "Lead pendulum on the Moon",
    intent: "f6-heavy-pendulum twin in vacuum, low gravity",
    expectation: "Slower fall, no drag; pendulum dynamics still sane",
    heightFt: 50,
    planet: "moon",
    egg: [0, 0.3, 0],
    parts: [
      part("w1", "fishingWeight", [0, 1.3, 0]),
      part("w2", "fishingWeight", [0.015, 1.3, 0]),
    ],
    joints: [
      glue("g1", "w1", "w2", [0.0075, 0, 0], [-0.0075, 0, 0]),
      rope("s1", "egg", "w1", [0, 0.032, 0], [0, -0.0125, 0]),
    ],
  }),
  spec({
    id: "f6-tether-cross",
    family: "f6-tethers",
    name: "Crossing strings to two offset anchors",
    intent: "Deliberately crossed tethers that could tangle",
    expectation: "Ropes are constraints, not colliding lines; no snag explosion",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.3, 0],
    parts: [
      part("anchor-l", "cardboard", [-0.3, 0.9, 0]),
      part("anchor-r", "cardboard", [0.3, 0.9, 0]),
    ],
    joints: [
      rope("s1", "egg", "anchor-r", [0.02, 0.02, 0], [-0.14, -0.006, 0]),
      rope("s2", "egg", "anchor-l", [-0.02, 0.02, 0], [0.14, -0.006, 0]),
      rope("s3", "anchor-l", "anchor-r", [0.14, 0.006, 0], [-0.14, 0.006, 0]),
    ],
  }),
  spec({
    id: "f6-whip-150",
    family: "f6-tethers",
    name: "Egg above a lead weight on a 1.5 m string, 100 ft",
    intent: "Weight arrests first; the string then whips the egg",
    expectation: "Whip load may break the string (75 N); no solver spike beyond that",
    heightFt: 100,
    planet: "earth",
    egg: [0, 1.7, 0],
    parts: [part("weight", "fishingWeight", [0, 0.2, 0])],
    joints: [rope("s1", "egg", "weight", [0, -0.032, 0], [0, 0.0125, 0])],
  }),
];

// ---------------------------------------------------------------------------
// Family 7 — Springs (rubber bands)
// ---------------------------------------------------------------------------

const family7: ValidationSpec[] = [
  spec({
    id: "f7-band-single",
    family: "f7-springs",
    name: "Egg on one rubber band under a plate",
    intent: "Single spring joint suspension",
    expectation: "Bounces on its band and damps out",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.4, 0],
    parts: [part("plate", "cardboard", [0, 0.6, 0])],
    joints: [band("r1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f7-band-quad",
    family: "f7-springs",
    name: "Egg on four bands in a craft-stick frame",
    intent: "Symmetric four-spring suspension in a glued wooden frame",
    expectation: "Egg centered by springs; frame lands, egg oscillates gently",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.1, 0],
    parts: [
      part("v1", "craftStick", [-0.06, 0.075, -0.06]),
      part("v2", "craftStick", [0.06, 0.075, -0.06]),
      part("v3", "craftStick", [-0.06, 0.075, 0.06]),
      part("v4", "craftStick", [0.06, 0.075, 0.06]),
    ],
    joints: [
      band("r1", "egg", "v1", [-0.02, 0.02, -0.02], [0, 0.075, 0]),
      band("r2", "egg", "v2", [0.02, 0.02, -0.02], [0, 0.075, 0]),
      band("r3", "egg", "v3", [-0.02, 0.02, 0.02], [0, 0.075, 0]),
      band("r4", "egg", "v4", [0.02, 0.02, 0.02], [0, 0.075, 0]),
    ],
  }),
  spec({
    id: "f7-trampoline",
    family: "f7-springs",
    name: "Cardboard trampoline on four band-tethered cups",
    intent: "Egg rides a plate sprung to four corner cups",
    expectation: "Plate flexes on bands at landing; no trampoline launch",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.338, 0],
    parts: [
      part("raft", "cardboard", [0, 0.3, 0]),
      part("cup1", "paperCup", [-0.15, 0.055, -0.11]),
      part("cup2", "paperCup", [0.15, 0.055, -0.11]),
      part("cup3", "paperCup", [-0.15, 0.055, 0.11]),
      part("cup4", "paperCup", [0.15, 0.055, 0.11]),
    ],
    joints: [
      band("r1", "raft", "cup1", [-0.14, -0.006, -0.1], [0, 0.055, 0]),
      band("r2", "raft", "cup2", [0.14, -0.006, -0.1], [0, 0.055, 0]),
      band("r3", "raft", "cup3", [-0.14, -0.006, 0.1], [0, 0.055, 0]),
      band("r4", "raft", "cup4", [0.14, -0.006, 0.1], [0, 0.055, 0]),
    ],
  }),
  spec({
    id: "f7-band-chain",
    family: "f7-springs",
    name: "Three rubber bands chained through cotton balls",
    intent: "Serial springs: energy storage in a chain",
    expectation: "Chain stretches and recoils without gaining energy",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.9, 0],
    parts: [
      part("mid1", "cottonBall", [0, 0.65, 0]),
      part("mid2", "cottonBall", [0, 0.4, 0]),
      part("plate", "cardboard", [0, 0.15, 0]),
    ],
    joints: [
      band("r1", "egg", "mid1", [0, -0.032, 0], [0, 0.03, 0]),
      band("r2", "mid1", "mid2", [0, -0.03, 0], [0, 0.03, 0]),
      band("r3", "mid2", "plate", [0, -0.03, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "f7-band-restitution-stack",
    family: "f7-springs",
    name: "Sprung egg over a bouncy sponge stack",
    intent: "Spring suspension landing on high-restitution cushions",
    expectation: "Bounces decay; no resonance growth between spring and sponge",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.5, 0],
    parts: [
      part("plate", "cardboard", [0, 0.7, 0]),
      part("sp1", "sponge", [0, 0.03, 0]),
      part("sp2", "sponge", [0, 0.09, 0]),
      part("sp3", "sponge", [0, 0.15, 0]),
    ],
    joints: [band("r1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f7-band-ballast",
    family: "f7-springs",
    name: "Lead weight on a band under the egg",
    intent: "Dense ballast on a spring: strong oscillator",
    expectation: "Weight bobs under the egg; oscillation damps",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.5, 0],
    parts: [part("weight", "fishingWeight", [0, 0.3, 0])],
    joints: [band("r1", "egg", "weight", [0, -0.032, 0], [0, 0.0125, 0])],
  }),
  spec({
    id: "f7-band-long",
    family: "f7-springs",
    name: "Egg on a 0.9 m stretched band",
    intent: "Spring span near the rope-chaining threshold (springs should not chain)",
    expectation: "One long soft spring; large but bounded oscillation",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.5, 0],
    parts: [part("plate", "cardboard", [0, 1.45, 0])],
    joints: [band("r1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f7-band-jupiter",
    family: "f7-springs",
    name: "Four-band suspension on Jupiter",
    intent: "f7-band-quad twin at 24.8 m/s2: springs must not resonate",
    expectation: "Heavier sag, faster fall; still stable",
    heightFt: 25,
    planet: "jupiter",
    egg: [0, 0.1, 0],
    parts: [
      part("v1", "craftStick", [-0.06, 0.075, -0.06]),
      part("v2", "craftStick", [0.06, 0.075, -0.06]),
      part("v3", "craftStick", [-0.06, 0.075, 0.06]),
      part("v4", "craftStick", [0.06, 0.075, 0.06]),
    ],
    joints: [
      band("r1", "egg", "v1", [-0.02, 0.02, -0.02], [0, 0.075, 0]),
      band("r2", "egg", "v2", [0.02, 0.02, -0.02], [0, 0.075, 0]),
      band("r3", "egg", "v3", [-0.02, 0.02, 0.02], [0, 0.075, 0]),
      band("r4", "egg", "v4", [0.02, 0.02, 0.02], [0, 0.075, 0]),
    ],
  }),
  spec({
    id: "f7-band-moon",
    family: "f7-springs",
    name: "Single-band suspension on the Moon",
    intent: "f7-band-single twin in vacuum: no air damping on the oscillator",
    expectation: "Oscillation persists longer but does not grow",
    heightFt: 50,
    planet: "moon",
    egg: [0, 0.4, 0],
    parts: [part("plate", "cardboard", [0, 0.6, 0])],
    joints: [band("r1", "egg", "plate", [0, 0.032, 0], [0, -0.006, 0])],
  }),
  spec({
    id: "f7-band-cross",
    family: "f7-springs",
    name: "Egg pulled sideways by two crossing bands",
    intent: "Opposed lateral springs to two straw anchors",
    expectation: "Egg centers itself; lateral oscillation damps",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.25, 0],
    parts: [
      part("a1", "straw", [-0.2, 0.25, 0]),
      part("a2", "straw", [0.2, 0.25, 0]),
    ],
    joints: [
      band("r1", "egg", "a1", [-0.024, 0, 0], [0.006, 0, 0]),
      band("r2", "egg", "a2", [0.024, 0, 0], [-0.006, 0, 0]),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Family 8 — Ballast extremes (fishing weights, 11340 kg/m3)
// ---------------------------------------------------------------------------

const family8: ValidationSpec[] = [
  spec({
    id: "f8-lead-balloon",
    family: "f8-ballast",
    name: "Lead weight and balloon on one string, egg taped to weight",
    intent: "Opposed buoyancy/ballast couple",
    expectation: "Weight sinks, balloon trails above; stable couple",
    heightFt: 25,
    planet: "earth",
    egg: [0.05, 0.1, 0],
    parts: [
      part("weight", "fishingWeight", [0, 0.1, 0]),
      part("b1", "balloon", [0, 0.7, 0]),
    ],
    joints: [
      rope("s1", "weight", "b1", [0, 0.0125, 0], [0, -0.19, 0]),
      tape("t1", "egg", "weight", [-0.024, 0, 0], [0.0075, 0, 0]),
    ],
  }),
  spec({
    id: "f8-lead-pendulum",
    family: "f8-ballast",
    name: "Lead weight on a 0.5 m string below the egg",
    intent: "Dense pendulum bob under a light payload",
    expectation: "Bob leads the fall; arrest at ground may break the string plausibly",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.8, 0],
    parts: [part("weight", "fishingWeight", [0, 0.25, 0])],
    joints: [rope("s1", "egg", "weight", [0, -0.032, 0], [0, 0.0125, 0])],
  }),
  spec({
    id: "f8-heavy-raft",
    family: "f8-ballast",
    name: "Weighted cardboard raft on four sponges",
    intent: "Heavy raft (4 taped weights) landing on soft cushions",
    expectation: "Sponges compress; raft settles without trampolining the egg",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.104, 0],
    parts: [
      part("raft", "cardboard", [0, 0.066, 0]),
      part("sp1", "sponge", [-0.09, 0.03, -0.07]),
      part("sp2", "sponge", [0.09, 0.03, -0.07]),
      part("sp3", "sponge", [-0.09, 0.03, 0.07]),
      part("sp4", "sponge", [0.09, 0.03, 0.07]),
      part("w1", "fishingWeight", [-0.13, 0.0845, -0.09]),
      part("w2", "fishingWeight", [0.13, 0.0845, -0.09]),
      part("w3", "fishingWeight", [-0.13, 0.0845, 0.09]),
      part("w4", "fishingWeight", [0.13, 0.0845, 0.09]),
    ],
    joints: [
      tape("t1", "raft", "w1", [-0.13, 0.006, -0.09], [0, -0.0125, 0]),
      tape("t2", "raft", "w2", [0.13, 0.006, -0.09], [0, -0.0125, 0]),
      tape("t3", "raft", "w3", [-0.13, 0.006, 0.09], [0, -0.0125, 0]),
      tape("t4", "raft", "w4", [0.13, 0.006, 0.09], [0, -0.0125, 0]),
    ],
  }),
  spec({
    id: "f8-extreme-weld",
    family: "f8-ballast",
    name: "Lead weight glued to a packing peanut",
    intent: "945:1 density-ratio weld (11340 vs 12 kg/m3), egg taped on top",
    expectation: "Ill-conditioned weld must not oscillate or inject energy",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.107, 0],
    parts: [
      part("peanut", "packingPeanuts", [0, 0.025, 0]),
      part("weight", "fishingWeight", [0, 0.0625, 0]),
    ],
    joints: [
      glue("g1", "peanut", "weight", [0, 0.025, 0], [0, -0.0125, 0]),
      tape("t1", "egg", "weight", [0, -0.032, 0], [0, 0.0125, 0]),
    ],
  }),
  spec({
    id: "f8-weight-stack",
    family: "f8-ballast",
    name: "Egg on a 10-weight loose column",
    intent: "Tall dense stack of tiny boxes under the egg",
    expectation: "Column topples plausibly; no jitter or interlock explosion",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.282, 0],
    parts: Array.from({ length: 10 }, (_, i) =>
      part(`w${i}`, "fishingWeight", [0, 0.0125 + i * 0.025, 0]),
    ),
  }),
  spec({
    id: "f8-lead-egg-weld",
    family: "f8-ballast",
    name: "Lead weight taped to the egg's side",
    intent: "3x egg mass welded off-center: strong asymmetric inertia",
    expectation: "Assembly tumbles weight-first; plausible impact",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [part("weight", "fishingWeight", [0.0315, 0.38, 0])],
    joints: [tape("t1", "egg", "weight", [0.024, 0, 0], [-0.0075, 0, 0])],
  }),
  spec({
    id: "f8-weight-cluster",
    family: "f8-ballast",
    name: "Egg on a band above a 6-weight glued cluster",
    intent: "Very heavy anchor on a soft spring",
    expectation: "Spring stretches hard; no divergence when the cluster arrests",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.45, 0],
    parts: [
      part("w0", "fishingWeight", [0, 0.2, 0]),
      part("w1", "fishingWeight", [0.015, 0.2, 0]),
      part("w2", "fishingWeight", [-0.015, 0.2, 0]),
      part("w3", "fishingWeight", [0, 0.2, 0.015]),
      part("w4", "fishingWeight", [0, 0.2, -0.015]),
      part("w5", "fishingWeight", [0, 0.225, 0]),
    ],
    joints: [
      glue("g1", "w0", "w1", [0.0075, 0, 0], [-0.0075, 0, 0]),
      glue("g2", "w0", "w2", [-0.0075, 0, 0], [0.0075, 0, 0]),
      glue("g3", "w0", "w3", [0, 0, 0.0075], [0, 0, -0.0075]),
      glue("g4", "w0", "w4", [0, 0, -0.0075], [0, 0, 0.0075]),
      glue("g5", "w0", "w5", [0, 0.0125, 0], [0, -0.0125, 0]),
      band("r1", "egg", "w5", [0, -0.032, 0], [0, 0.0125, 0]),
    ],
  }),
  spec({
    id: "f8-seesaw",
    family: "f8-ballast",
    name: "Seesaw plank: weight vs cotton, egg in the middle",
    intent: "Asymmetric mass distribution on one plank",
    expectation: "Plank rotates weight-down in flight; sane landing",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.05, 0],
    parts: [
      part("plank", "cardboard", [0, 0.006, 0]),
      part("weight", "fishingWeight", [0.13, 0.0245, 0]),
      part("cotton", "cottonBall", [-0.12, 0.042, 0]),
    ],
    joints: [
      tape("t1", "plank", "weight", [0.13, 0.006, 0], [0, -0.0125, 0]),
      tape("t2", "plank", "cotton", [-0.12, 0.006, 0], [0, -0.03, 0]),
      tape("t3", "egg", "plank", [0, -0.032, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "f8-weights-jupiter",
    family: "f8-ballast",
    name: "Lead-taped egg on Jupiter",
    intent: "f8-lead-egg-weld twin at 24.8 m/s2",
    expectation: "Fast plausible fall (~19 m/s from 25 ft); hard crack",
    heightFt: 25,
    planet: "jupiter",
    egg: [0, 0.38, 0],
    parts: [part("weight", "fishingWeight", [0.0315, 0.38, 0])],
    joints: [tape("t1", "egg", "weight", [0.024, 0, 0], [-0.0075, 0, 0])],
  }),
  spec({
    id: "f8-lead-parachute",
    family: "f8-ballast",
    name: "Big bag canopy carrying egg plus three weights",
    intent: "Heavy payload under a large canopy from 100 ft",
    expectation: "Slower than free-fall but faster than light payload; harness holds or breaks at plausible load",
    heightFt: 100,
    planet: "earth",
    egg: [0, 0.35, 0],
    parts: [
      part("bag", "plasticBag", [0, 1.0, 0], { dims: [0.9, 0.012, 0.9] }),
      part("w1", "fishingWeight", [0, 0.15, 0]),
      part("w2", "fishingWeight", [0.02, 0.15, 0]),
      part("w3", "fishingWeight", [-0.02, 0.15, 0]),
    ],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.4, -0.006, 0.4]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.4, -0.006, 0.4]),
      rope("s3", "egg", "bag", [0, 0.032, 0], [0, -0.006, -0.4]),
      rope("s4", "egg", "w1", [0, -0.032, 0], [0, 0.0125, 0]),
      glue("g1", "w1", "w2", [0.01, 0, 0], [-0.01, 0, 0]),
      glue("g2", "w1", "w3", [-0.01, 0, 0], [0.01, 0, 0]),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Family 9 — Planet/atmosphere sweeps (fixed reference builds across planets)
// ---------------------------------------------------------------------------

/** Reference build A: two balloons on strings below the egg (mirrors the existing stability spec). */
const balloonsRef = (id: string, planet: PlanetId, expectation: string): ValidationSpec =>
  spec({
    id,
    family: "f9-planets",
    name: `Two string balloons on ${planet}`,
    intent: "Atmosphere sweep of a fixed balloon build",
    expectation,
    heightFt: 50,
    planet,
    egg: [0, 0.55, 0],
    parts: [
      part("bl", "balloon", [-0.22, 0.28, 0]),
      part("br", "balloon", [0.22, 0.28, 0]),
    ],
    joints: [
      rope("s1", "egg", "bl", [0, -0.032, 0], [0, 0.19, 0]),
      rope("s2", "egg", "br", [0, -0.032, 0], [0, 0.19, 0]),
    ],
  });

/** Reference build B: single foam cushion. */
const cushionRef = (id: string, planet: PlanetId, expectation: string): ValidationSpec =>
  spec({
    id,
    family: "f9-planets",
    name: `Foam cushion landing on ${planet}`,
    intent: "Gravity sweep of a fixed cushion build",
    expectation,
    heightFt: 25,
    planet,
    egg: [0, 0.152, 0],
    parts: [part("foam", "foamBlock", [0, 0.06, 0])],
  });

const family9: ValidationSpec[] = [
  balloonsRef("f9-balloons-moon", "moon", "Vacuum: balloons give NO lift and NO drag; near free-fall at 1.62 m/s2"),
  balloonsRef("f9-balloons-mars", "mars", "0.02 kg/m3 air: negligible lift, slight drag"),
  balloonsRef("f9-balloons-venus", "venus", "65 kg/m3 air: enormous buoyancy; assembly should rise or hover"),
  balloonsRef("f9-balloons-uranus", "uranus", "0.42 kg/m3: partial lift, gentler than Earth"),
  cushionRef("f9-cushion-moon", "moon", "Slow 1.62 m/s2 fall; soft landing, egg survives"),
  cushionRef("f9-cushion-jupiter", "jupiter", "24.8 m/s2: hits ~19 m/s; foam alone should not save it"),
  cushionRef("f9-cushion-neptune", "neptune", "11.15 m/s2: intermediate severity"),
  bare("f9-bare-saturn-25", "saturn", 25),
  bare("f9-bare-neptune-25", "neptune", 25),
  bare("f9-bare-uranus-25", "uranus", 25),
].map((s, index) => ({ ...s, family: "f9-planets", id: s.id.startsWith("f9") ? s.id : `f9-${index}` }));

// ---------------------------------------------------------------------------
// Family 10 — Adversarial / strange
// ---------------------------------------------------------------------------

const family10: ValidationSpec[] = [
  spec({
    id: "f10-interpenetrating-foam",
    family: "f10-adversarial",
    name: "Five foam blocks overlapping in one spot",
    intent: "Deep initial interpenetration of loose parts",
    expectation: "Depenetration should be gentle, not explosive",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.152, 0],
    parts: [
      part("f1", "foamBlock", [0, 0.06, 0]),
      part("f2", "foamBlock", [0.01, 0.06, 0.01]),
      part("f3", "foamBlock", [-0.01, 0.06, -0.01]),
      part("f4", "foamBlock", [0.01, 0.065, -0.01]),
      part("f5", "foamBlock", [-0.01, 0.065, 0.01]),
    ],
  }),
  spec({
    id: "f10-zero-span-joint",
    family: "f10-adversarial",
    name: "Co-located sticks with a zero-span tape joint",
    intent: "Degenerate fixed joint: identical anchors, overlapping bodies",
    expectation: "No NaN, no spin-up from the degenerate constraint",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.196, 0],
    parts: [
      part("stick1", "craftStick", [0, 0.075, 0]),
      part("stick2", "craftStick", [0, 0.075, 0.002]),
    ],
    joints: [
      tape("t1", "stick1", "stick2", [0, 0, 0], [0, 0, 0]),
      tape("t2", "egg", "stick1", [0, -0.032, 0], [0, 0.075, 0]),
    ],
  }),
  spec({
    id: "f10-joint-cycle",
    family: "f10-adversarial",
    name: "Straw triangle with a closed tape cycle",
    intent: "Constraint cycle (a-b, b-c, c-a) plus the egg",
    expectation: "Over-constrained loop stays rigid without fighting itself",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.24, 0],
    parts: [
      part("sa", "straw", [-0.08, 0.1, 0], { rot: ROT_Z90 }),
      part("sb", "straw", [0.08, 0.1, 0], { rot: ROT_Z90 }),
      part("sc", "straw", [0, 0.18, 0], { rot: ROT_Z90 }),
    ],
    joints: [
      tape("t1", "sa", "sb", [0, 0.08, 0], [0, -0.08, 0]),
      tape("t2", "sb", "sc", [0, 0.08, 0], [0, 0.08, 0]),
      tape("t3", "sc", "sa", [0, -0.08, 0], [0, -0.08, 0]),
      tape("t4", "egg", "sc", [0, -0.032, 0], [0, 0, 0.006]),
    ],
  }),
  spec({
    id: "f10-tape-through-part",
    family: "f10-adversarial",
    name: "Tape joint spanning through a third body",
    intent: "Weld line crosses an unrelated cardboard sheet",
    expectation: "Joint is a constraint, not a collider; middle sheet unaffected",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.132, 0],
    parts: [
      part("foam-l", "foamBlock", [-0.2, 0.06, 0]),
      part("foam-r", "foamBlock", [0.2, 0.06, 0]),
      part("sheet", "cardboard", [0, 0.06, 0], { rot: ROT_Z90 }),
    ],
    joints: [tape("t1", "foam-l", "foam-r", [0.06, 0, 0], [-0.06, 0, 0])],
  }),
  spec({
    id: "f10-balloon-sandwich",
    family: "f10-adversarial",
    name: "Egg squeezed between two overlapping balloons",
    intent: "Balloon shells interpenetrate the egg from above and below",
    expectation: "Pneumatic shells push apart gently; no jitter or ejection",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b-lo", "balloon", [0, 0.21, 0]),
      part("b-hi", "balloon", [0, 0.55, 0]),
    ],
    joints: [
      tape("t1", "egg", "b-lo", [0, -0.032, 0], [0, 0.17, 0]),
      tape("t2", "egg", "b-hi", [0, 0.032, 0], [0, -0.17, 0]),
    ],
  }),
  spec({
    id: "f10-spinner",
    family: "f10-adversarial",
    name: "Cardboard plate with one corner weight",
    intent: "Deliberately spin-prone asymmetric build",
    expectation: "May rotate in flight from aero asymmetry; spin must not accelerate unbounded",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.244, 0],
    parts: [
      part("plate", "cardboard", [0, 0.206, 0]),
      part("weight", "fishingWeight", [0.13, 0.2245, 0.09]),
    ],
    joints: [
      tape("t1", "plate", "weight", [0.13, 0.006, 0.09], [0, -0.0125, 0]),
      tape("t2", "egg", "plate", [0, -0.032, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "f10-breakforce-whip",
    family: "f10-adversarial",
    name: "Two glued weights on a string, 100 ft whip",
    intent: "Arrest load engineered near the string's 75 N break force",
    expectation: "String either holds or breaks cleanly; no post-break explosion",
    heightFt: 100,
    planet: "earth",
    egg: [0, 1.2, 0],
    parts: [
      part("w1", "fishingWeight", [0, 0.2, 0]),
      part("w2", "fishingWeight", [0.015, 0.2, 0]),
    ],
    joints: [
      glue("g1", "w1", "w2", [0.0075, 0, 0], [-0.0075, 0, 0]),
      rope("s1", "egg", "w1", [0, -0.032, 0], [0, 0.0125, 0]),
    ],
  }),
  spec({
    id: "f10-peanut-pile-96",
    family: "f10-adversarial",
    name: "96 packing peanuts under the egg (body-cap stress)",
    intent: "Max-part contact pile within the 100-body cap",
    expectation: "Large contact count stays stable; peanuts scatter plausibly",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.232, 0],
    parts: Array.from({ length: 4 }, (_, layer) =>
      Array.from({ length: 24 }, (_, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        return part(`pn-${layer}-${i}`, "packingPeanuts", [
          -0.2 + col * 0.081 + (layer % 2) * 0.02,
          0.025 + layer * 0.051,
          -0.09 + row * 0.045 + (layer % 2) * 0.01,
        ]);
      }),
    ).flat(),
  }),
  spec({
    id: "f10-weld-inside",
    family: "f10-adversarial",
    name: "Lead weight glued inside a foam block",
    intent: "Fully interpenetrating weld of extreme densities",
    expectation: "Acts as one composite body; no contact fight between welded shapes",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.152, 0],
    parts: [
      part("foam", "foamBlock", [0, 0.06, 0]),
      part("weight", "fishingWeight", [0, 0.06, 0]),
    ],
    joints: [glue("g1", "foam", "weight", [0, 0, 0], [0, 0, 0])],
  }),
  spec({
    id: "f10-rope-zero-length",
    family: "f10-adversarial",
    name: "Zero-length rope between touching cotton balls",
    intent: "Degenerate rope constraint with no slack",
    expectation: "Behaves like a contact pair; no oscillation",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.122, 0],
    parts: [
      part("c1", "cottonBall", [0, 0.03, 0]),
      part("c2", "cottonBall", [0, 0.09, 0]),
    ],
    joints: [
      rope("s1", "c1", "c2", [0, 0.03, 0], [0, -0.03, 0]),
      rope("s2", "egg", "c2", [0, -0.032, 0], [0, 0.03, 0]),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Corpus assembly
// ---------------------------------------------------------------------------

export const VALIDATION_SPECS: ValidationSpec[] = [
  ...family1,
  ...family2,
  ...family3,
  ...family4,
  ...family5,
  ...family6,
  ...family7,
  ...family8,
  ...family9,
  ...family10,
];

// ---------------------------------------------------------------------------
// Variants — single-factor isolations appended per distinct failure signature
// (step 4 of the campaign). Keyed to parents via `parentId`.
// ---------------------------------------------------------------------------

// SIG-A — f3-tape-cluster-4 diverged (TOP clamped at the 25 m/s watchdog
// ceiling within ~1 s). Isolate: balloon count, joint kind, height, buoyancy.
const sigA: ValidationSpec[] = [
  spec({
    id: "v-a1-tape-cluster-3",
    parentId: "f3-tape-cluster-4",
    family: "variants-sig-a",
    name: "Three balloons taped to the egg",
    intent: "Part count: does divergence need 4 welded balloons?",
    expectation: "Isolates the count factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.68, 0]),
      part("b2", "balloon", [0.18, 0.68, 0]),
      part("b3", "balloon", [0, 0.68, -0.18]),
    ],
    joints: [
      tape("t1", "egg", "b1", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      tape("t2", "egg", "b2", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
      tape("t3", "egg", "b3", [0, 0.03, -0.02], [0, -0.19, 0.16]),
    ],
  }),
  spec({
    id: "v-a2-rope-cluster-4",
    parentId: "f3-tape-cluster-4",
    family: "variants-sig-a",
    name: "Four balloons on strings instead of tape",
    intent: "Joint kind: fixed weld vs rope constraint",
    expectation: "Isolates the weld factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.68, 0]),
      part("b2", "balloon", [0.18, 0.68, 0]),
      part("b3", "balloon", [0, 0.68, -0.18]),
      part("b4", "balloon", [0, 0.68, 0.18]),
    ],
    joints: [
      rope("s1", "egg", "b1", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      rope("s2", "egg", "b2", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
      rope("s3", "egg", "b3", [0, 0.03, -0.02], [0, -0.19, 0.16]),
      rope("s4", "egg", "b4", [0, 0.03, 0.02], [0, -0.19, -0.16]),
    ],
  }),
  spec({
    id: "v-a3-tape-cluster-4-5ft",
    parentId: "f3-tape-cluster-4",
    family: "variants-sig-a",
    name: "Four taped balloons from 5 ft",
    intent: "Height: divergence should be height-independent if it is a weld instability",
    expectation: "Isolates the height factor",
    heightFt: 5,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.68, 0]),
      part("b2", "balloon", [0.18, 0.68, 0]),
      part("b3", "balloon", [0, 0.68, -0.18]),
      part("b4", "balloon", [0, 0.68, 0.18]),
    ],
    joints: [
      tape("t1", "egg", "b1", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      tape("t2", "egg", "b2", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
      tape("t3", "egg", "b3", [0, 0.03, -0.02], [0, -0.19, 0.16]),
      tape("t4", "egg", "b4", [0, 0.03, 0.02], [0, -0.19, -0.16]),
    ],
  }),
  spec({
    id: "v-a4-tape-cluster-4-moon",
    parentId: "f3-tape-cluster-4",
    family: "variants-sig-a",
    name: "Four taped balloons on the Moon",
    intent: "Atmosphere: no buoyancy/drag; is lift required for the divergence?",
    expectation: "Isolates the buoyancy factor",
    heightFt: 25,
    planet: "moon",
    egg: [0, 0.38, 0],
    parts: [
      part("b1", "balloon", [-0.18, 0.68, 0]),
      part("b2", "balloon", [0.18, 0.68, 0]),
      part("b3", "balloon", [0, 0.68, -0.18]),
      part("b4", "balloon", [0, 0.68, 0.18]),
    ],
    joints: [
      tape("t1", "egg", "b1", [-0.02, 0.03, 0], [0.16, -0.19, 0]),
      tape("t2", "egg", "b2", [0.02, 0.03, 0], [-0.16, -0.19, 0]),
      tape("t3", "egg", "b3", [0, 0.03, -0.02], [0, -0.19, 0.16]),
      tape("t4", "egg", "b4", [0, 0.03, 0.02], [0, -0.19, -0.16]),
    ],
  }),
];

// SIG-B — f10-balloon-sandwich launched at 15.7 m/s (> free-fall from the
// full height) within ~0.5 s of physics and flew off-screen. Isolate:
// joint kind, initial overlap, joints at all, part count, material.
const sandwichParts = () => [
  part("b-lo", "balloon", [0, 0.21, 0]),
  part("b-hi", "balloon", [0, 0.55, 0]),
];
const sigB: ValidationSpec[] = [
  spec({
    id: "v-b1-sandwich-rope",
    parentId: "f10-balloon-sandwich",
    family: "variants-sig-b",
    name: "Balloon sandwich with rope joints",
    intent: "Joint kind: same overlap, strings instead of welds",
    expectation: "Isolates the weld factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: sandwichParts(),
    joints: [
      rope("s1", "egg", "b-lo", [0, -0.032, 0], [0, 0.17, 0]),
      rope("s2", "egg", "b-hi", [0, 0.032, 0], [0, -0.17, 0]),
    ],
  }),
  spec({
    id: "v-b2-sandwich-nooverlap",
    parentId: "f10-balloon-sandwich",
    family: "variants-sig-b",
    name: "Taped balloon sandwich without overlap",
    intent: "Overlap: same welds, balloons just touching the egg",
    expectation: "Isolates the interpenetration factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("b-lo", "balloon", [0, 0.15, 0]),
      part("b-hi", "balloon", [0, 0.61, 0]),
    ],
    joints: [
      tape("t1", "egg", "b-lo", [0, -0.032, 0], [0, 0.19, 0]),
      tape("t2", "egg", "b-hi", [0, 0.032, 0], [0, -0.19, 0]),
    ],
  }),
  spec({
    id: "v-b3-sandwich-nojoints",
    parentId: "f10-balloon-sandwich",
    family: "variants-sig-b",
    name: "Overlapping balloon sandwich, no joints",
    intent: "Joints: same overlap, contact only",
    expectation: "Isolates the constraint-vs-contact factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: sandwichParts(),
  }),
  spec({
    id: "v-b4-sandwich-one",
    parentId: "f10-balloon-sandwich",
    family: "variants-sig-b",
    name: "One overlapping balloon taped to the egg",
    intent: "Part count: single overlapping weld",
    expectation: "Isolates the two-sided squeeze factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [part("b-hi", "balloon", [0, 0.55, 0])],
    joints: [tape("t1", "egg", "b-hi", [0, 0.032, 0], [0, -0.17, 0])],
  }),
  spec({
    id: "v-b5-sandwich-foam",
    parentId: "f10-balloon-sandwich",
    family: "variants-sig-b",
    name: "Egg taped between two overlapping foam blocks",
    intent: "Material: identical geometry with non-pneumatic parts",
    expectation: "Isolates the balloon-shell factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.38, 0],
    parts: [
      part("f-lo", "foamBlock", [0, 0.34, 0]),
      part("f-hi", "foamBlock", [0, 0.42, 0]),
    ],
    joints: [
      tape("t1", "egg", "f-lo", [0, -0.032, 0], [0, 0.04, 0]),
      tape("t2", "egg", "f-hi", [0, 0.032, 0], [0, -0.04, 0]),
    ],
  }),
];

// SIG-C — f5-straw-outriggers reported impact 22.6 m/s, above vacuum
// free-fall (17.3) and above the egg's own observed top speed (12.2).
// Isolate: joint material, outrigger count, part material, height.
const outriggerCup = () => part("cup", "paperCup", [0, 0.055, 0]);
const sigC: ValidationSpec[] = [
  spec({
    id: "v-c1-outriggers-glue",
    parentId: "f5-straw-outriggers",
    family: "variants-sig-c",
    name: "Straw outriggers glued instead of taped",
    intent: "Joint material: glue (150 N) vs tape (120 N)",
    expectation: "Isolates the joint-material factor",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      outriggerCup(),
      part("out-e", "straw", [0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-w", "straw", [-0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-n", "straw", [0, 0.055, -0.195], { rot: ROT_X90 }),
      part("out-s", "straw", [0, 0.055, 0.195], { rot: ROT_X90 }),
    ],
    joints: [
      glue("t1", "cup", "out-e", [0.045, 0, 0], [0, -0.15, 0]),
      glue("t2", "cup", "out-w", [-0.045, 0, 0], [0, 0.15, 0]),
      glue("t3", "cup", "out-n", [0, 0, -0.045], [0, 0.15, 0]),
      glue("t4", "cup", "out-s", [0, 0, 0.045], [0, -0.15, 0]),
    ],
  }),
  spec({
    id: "v-c2-outriggers-2",
    parentId: "f5-straw-outriggers",
    family: "variants-sig-c",
    name: "Only two straw outriggers",
    intent: "Part count: two rods instead of four",
    expectation: "Isolates the rod-count factor",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      outriggerCup(),
      part("out-e", "straw", [0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-w", "straw", [-0.195, 0.055, 0], { rot: ROT_Z90 }),
    ],
    joints: [
      tape("t1", "cup", "out-e", [0.045, 0, 0], [0, -0.15, 0]),
      tape("t2", "cup", "out-w", [-0.045, 0, 0], [0, 0.15, 0]),
    ],
  }),
  spec({
    id: "v-c3-outriggers-sticks",
    parentId: "f5-straw-outriggers",
    family: "variants-sig-c",
    name: "Craft-stick outriggers instead of straws",
    intent: "Part material: heavier, stiffer rods",
    expectation: "Isolates the rod-mass factor",
    heightFt: 50,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      outriggerCup(),
      part("out-e", "craftStick", [0.12, 0.055, 0], { rot: ROT_Z90 }),
      part("out-w", "craftStick", [-0.12, 0.055, 0], { rot: ROT_Z90 }),
      part("out-n", "craftStick", [0, 0.055, -0.12], { rot: ROT_X90 }),
      part("out-s", "craftStick", [0, 0.055, 0.12], { rot: ROT_X90 }),
    ],
    joints: [
      tape("t1", "cup", "out-e", [0.045, 0, 0], [0, -0.075, 0]),
      tape("t2", "cup", "out-w", [-0.045, 0, 0], [0, 0.075, 0]),
      tape("t3", "cup", "out-n", [0, 0, -0.045], [0, 0.075, 0]),
      tape("t4", "cup", "out-s", [0, 0, 0.045], [0, -0.075, 0]),
    ],
  }),
  spec({
    id: "v-c4-outriggers-25ft",
    parentId: "f5-straw-outriggers",
    family: "variants-sig-c",
    name: "Straw outriggers from 25 ft",
    intent: "Height: lower arrival speed",
    expectation: "Isolates the impact-energy factor",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.13, 0],
    parts: [
      outriggerCup(),
      part("out-e", "straw", [0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-w", "straw", [-0.195, 0.055, 0], { rot: ROT_Z90 }),
      part("out-n", "straw", [0, 0.055, -0.195], { rot: ROT_X90 }),
      part("out-s", "straw", [0, 0.055, 0.195], { rot: ROT_X90 }),
    ],
    joints: [
      tape("t1", "cup", "out-e", [0.045, 0, 0], [0, -0.15, 0]),
      tape("t2", "cup", "out-w", [-0.045, 0, 0], [0, 0.15, 0]),
      tape("t3", "cup", "out-n", [0, 0, -0.045], [0, 0.15, 0]),
      tape("t4", "cup", "out-s", [0, 0, 0.045], [0, -0.15, 0]),
    ],
  }),
];

// SIG-D — peak G scales inversely with planet gravity for identical
// impacts (Moon 2.2 m/s saturates 300 G; Jupiter 8.6 m/s reads 99 G).
// Bare-egg 5 ft drops across remaining planets complete the curve; the
// prediction is G = impact / (0.0035 * g_planet) if normalization is local.
const sigD: ValidationSpec[] = [
  { ...bare("v-d1-bare-mars-5", "mars", 5), family: "variants-sig-d", parentId: "f1-bare-moon-5" },
  { ...bare("v-d2-bare-venus-5", "venus", 5), family: "variants-sig-d", parentId: "f1-bare-moon-5" },
  { ...bare("v-d3-bare-saturn-5", "saturn", 5), family: "variants-sig-d", parentId: "f1-bare-moon-5" },
  { ...bare("v-d4-bare-neptune-5", "neptune", 5), family: "variants-sig-d", parentId: "f1-bare-moon-5" },
];

// SIG-E — Moon (vacuum) impacts land below vacuum free-fall, consistent
// with static linearDamping acting as drag with no atmosphere. Isolate:
// body damping value (cotton 0.4 vs egg 0.04), planet, fall time.
const cottonRider = (id: string, planet: PlanetId): ValidationSpec =>
  spec({
    id,
    parentId: "f1-bare-moon-100",
    family: "variants-sig-e",
    name: `Cotton ball taped on egg, ${planet} 50 ft`,
    intent: "High-damping part (cotton linearDamping 0.4) attached to the egg",
    expectation: "Vacuum deficit should grow with the damping coefficient",
    heightFt: 50,
    planet,
    egg: [0, 0.38, 0],
    parts: [part("cotton", "cottonBall", [0, 0.442, 0])],
    joints: [tape("t1", "egg", "cotton", [0, 0.032, 0], [0, -0.03, 0])],
  });
const sigE: ValidationSpec[] = [
  { ...bare("v-e1-bare-moon-50", "moon", 50), family: "variants-sig-e", parentId: "f1-bare-moon-100" },
  cottonRider("v-e2-cotton-moon-50", "moon"),
  cottonRider("v-e3-cotton-earth-50", "earth"),
  spec({
    id: "v-e4-bag-moon-25",
    parentId: "f1-bare-moon-100",
    family: "variants-sig-e",
    name: "Bag parachute on the Moon from 25 ft",
    intent: "Shorter fall: the vacuum deficit should shrink with fall time",
    expectation: "Isolates the fall-time factor",
    heightFt: 25,
    planet: "moon",
    egg: [0, 0.1, 0],
    parts: [part("bag", "plasticBag", [0, 0.75, 0])],
    joints: [
      rope("s1", "egg", "bag", [0, 0.032, 0], [0.2, -0.006, 0]),
      rope("s2", "egg", "bag", [0, 0.032, 0], [-0.2, -0.006, 0]),
    ],
  }),
];

// SIG-F — peak load routinely saturates near the 300 G display cap with
// contact forces of 150-200 N even for gentle cushioned landings
// (f5-corner-bumpers: impact 1.1 m/s, 300 G, 204 N). Isolate: height.
const sigF: ValidationSpec[] = [
  spec({
    id: "v-f1-foam-10ft",
    parentId: "f2-foam-single",
    family: "variants-sig-f",
    name: "Egg on one foam block from 10 ft",
    intent: "Short cushioned drop: healthy physics should report modest G",
    expectation: "G far above ~60 here means contact/solver spikes",
    heightFt: 10,
    planet: "earth",
    egg: [0, 0.152, 0],
    parts: [part("foam", "foamBlock", [0, 0.06, 0])],
  }),
  spec({
    id: "v-f2-foam-5ft",
    parentId: "f2-foam-single",
    family: "variants-sig-f",
    name: "Egg on one foam block from 5 ft",
    intent: "Minimal cushioned drop",
    expectation: "Isolates the impact-speed factor",
    heightFt: 5,
    planet: "earth",
    egg: [0, 0.152, 0],
    parts: [part("foam", "foamBlock", [0, 0.06, 0])],
  }),
  spec({
    id: "v-f3-bumpers-25ft",
    parentId: "f5-corner-bumpers",
    family: "variants-sig-f",
    name: "Corner-bumper sled from 25 ft",
    intent: "Same bumpered build at lower arrival speed",
    expectation: "Isolates the height factor for the 300 G saturation",
    heightFt: 25,
    planet: "earth",
    egg: [0, 0.164, 0],
    parts: [
      part("plate", "cardboard", [0, 0.126, 0]),
      part("bump1", "foamBlock", [-0.105, 0.06, -0.08]),
      part("bump2", "foamBlock", [0.105, 0.06, -0.08]),
      part("bump3", "foamBlock", [-0.105, 0.06, 0.08]),
      part("bump4", "foamBlock", [0.105, 0.06, 0.08]),
    ],
    joints: [
      tape("t1", "plate", "bump1", [-0.105, -0.006, -0.08], [0, 0.06, 0]),
      tape("t2", "plate", "bump2", [0.105, -0.006, -0.08], [0, 0.06, 0]),
      tape("t3", "plate", "bump3", [-0.105, -0.006, 0.08], [0, 0.06, 0]),
      tape("t4", "plate", "bump4", [0.105, -0.006, 0.08], [0, 0.06, 0]),
      tape("t5", "egg", "plate", [0, -0.032, 0], [0, 0.006, 0]),
    ],
  }),
  spec({
    id: "v-f4-foam-neptune-10",
    parentId: "f9-cushion-neptune",
    family: "variants-sig-f",
    name: "Foam cushion on Neptune from 10 ft",
    intent: "Cross planet at low height: spike vs kinematic G",
    expectation: "Separates the SIG-D normalization from the spike magnitude",
    heightFt: 10,
    planet: "neptune",
    egg: [0, 0.152, 0],
    parts: [part("foam", "foamBlock", [0, 0.06, 0])],
  }),
];

export const VALIDATION_VARIANTS: ValidationSpec[] = [
  ...sigA,
  ...sigB,
  ...sigC,
  ...sigD,
  ...sigE,
  ...sigF,
];

export const ALL_SPECS: ValidationSpec[] = [...VALIDATION_SPECS, ...VALIDATION_VARIANTS];
