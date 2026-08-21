import type { MaterialId } from "@eggdrop/shared";

export type MaterialVisual = {
  label: string;
  shortLabel: string;
  emoji: string;
  color: string;
  accent: string;
  behavior: string;
  cost: number;
  massKg: number;
  friction: number;
  restitution: number;
  dragCoefficient: number;
  compliance: number;
  connector?: true;
};

export const MATERIAL_ORDER: MaterialId[] = [
  "straw", "tape", "glue", "balloon", "bubbleWrap", "string", "cardboard",
  "craftStick", "paperCup", "cottonBall", "foamBlock", "sponge",
  "rubberBand", "newspaper", "plasticBag", "packingPeanuts", "fishingWeight",
];

export const MATERIAL_VISUALS: Record<MaterialId, MaterialVisual> = {
  straw: { label: "Straws", shortLabel: "Straw", emoji: "🥤", color: "#ef476f", accent: "#ffd1dc", behavior: "Light, resizable beams", cost: 1, massKg: 0.004, friction: 0.45, restitution: 0.25, dragCoefficient: 1.05, compliance: 0.78 },
  tape: { label: "Tape", shortLabel: "Tape", emoji: "🟨", color: "#f6bd1f", accent: "#fff1a8", behavior: "Locks two parts together", cost: 1, massKg: 0, friction: 0, restitution: 0, dragCoefficient: 0, compliance: 0.72, connector: true },
  glue: { label: "Glue", shortLabel: "Glue", emoji: "🧴", color: "#efe9d5", accent: "#f8f4e4", behavior: "Sticks two parts together anywhere", cost: 2, massKg: 0, friction: 0, restitution: 0, dragCoefficient: 0, compliance: 0.72, connector: true },
  balloon: { label: "Balloons", shortLabel: "Balloon", emoji: "🎈", color: "#ef476f", accent: "#ffadc0", behavior: "Buoyant with lots of drag", cost: 5, massKg: 0.003, friction: 0.35, restitution: 0.72, dragCoefficient: 0.58, compliance: 0.18 },
  bubbleWrap: { label: "Bubble wrap", shortLabel: "Bubble wrap", emoji: "🫧", color: "#76c8e8", accent: "#d9f5ff", behavior: "Spreads out impact force", cost: 4, massKg: 0.008, friction: 0.62, restitution: 0.08, dragCoefficient: 1.15, compliance: 0.13 },
  string: { label: "String", shortLabel: "String", emoji: "🧵", color: "#7f5539", accent: "#e7d0b8", behavior: "Flexible rope connection", cost: 1, massKg: 0, friction: 0, restitution: 0, dragCoefficient: 0, compliance: 0.65, connector: true },
  cardboard: { label: "Cardboard", shortLabel: "Cardboard", emoji: "📦", color: "#a56f3f", accent: "#e2bd91", behavior: "Broad, sturdy panels", cost: 3, massKg: 0.025, friction: 0.65, restitution: 0.12, dragCoefficient: 1.28, compliance: 0.7 },
  craftStick: { label: "Craft sticks", shortLabel: "Craft stick", emoji: "🪵", color: "#d29b62", accent: "#f2d7b5", behavior: "Strong wooden beams", cost: 2, massKg: 0.006, friction: 0.58, restitution: 0.18, dragCoefficient: 1.05, compliance: 0.92 },
  paperCup: { label: "Paper cups", shortLabel: "Paper cup", emoji: "🥛", color: "#edf2f4", accent: "#cfd9df", behavior: "Lightweight crumple zones", cost: 3, massKg: 0.005, friction: 0.55, restitution: 0.12, dragCoefficient: 1.2, compliance: 0.38 },
  cottonBall: { label: "Cotton balls", shortLabel: "Cotton ball", emoji: "☁️", color: "#fffdf7", accent: "#dfe9ec", behavior: "Soft local cushioning", cost: 1, massKg: 0.001, friction: 0.75, restitution: 0.02, dragCoefficient: 0.95, compliance: 0.08 },
  foamBlock: { label: "Foam blocks", shortLabel: "Foam block", emoji: "🟦", color: "#5ec8e5", accent: "#bdeffa", behavior: "Light impact absorbers", cost: 4, massKg: 0.012, friction: 0.7, restitution: 0.05, dragCoefficient: 1.12, compliance: 0.12 },
  sponge: { label: "Sponges", shortLabel: "Sponge", emoji: "🧽", color: "#f7d154", accent: "#ffedaa", behavior: "Highly damped padding", cost: 4, massKg: 0.015, friction: 0.78, restitution: 0.03, dragCoefficient: 1.1, compliance: 0.1 },
  rubberBand: { label: "Rubber bands", shortLabel: "Rubber band", emoji: "➰", color: "#dc644d", accent: "#ffc0b3", behavior: "Stretchy spring connection", cost: 2, massKg: 0, friction: 0, restitution: 0, dragCoefficient: 0, compliance: 0.34, connector: true },
  newspaper: { label: "Newspaper", shortLabel: "Newspaper", emoji: "📰", color: "#d5d3ca", accent: "#f3f1e8", behavior: "Crumpled shock absorber", cost: 2, massKg: 0.004, friction: 0.62, restitution: 0.04, dragCoefficient: 1.04, compliance: 0.2 },
  plasticBag: { label: "Plastic bags", shortLabel: "Plastic bag", emoji: "🪂", color: "#bde0fe", accent: "#e7f4ff", behavior: "Canopy with strong air drag", cost: 4, massKg: 0.006, friction: 0.32, restitution: 0.1, dragCoefficient: 2.1, compliance: 0.56 },
  packingPeanuts: { label: "Packing peanuts", shortLabel: "Peanut cluster", emoji: "🥜", color: "#e9f1cf", accent: "#fbffe9", behavior: "Tiny lightweight cushions", cost: 1, massKg: 0.002, friction: 0.66, restitution: 0.06, dragCoefficient: 1.0, compliance: 0.14 },
  fishingWeight: { label: "Fishing weights", shortLabel: "Fishing weight", emoji: "🎣", color: "#5f6b76", accent: "#cfd8e0", behavior: "Dense lead ballast, editable weight", cost: 2, massKg: 0.064, friction: 0.4, restitution: 0.05, dragCoefficient: 0.45, compliance: 0.98 },
};

