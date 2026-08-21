import {
  AlertTriangle, Box, CheckCircle2, ChevronDown, Copy, Edit3, FlaskConical,
  Focus, FolderOpen, Gauge, Info, Link2, LoaderCircle, Magnet, Move3D, PackageOpen, Play, Redo2,
  Rotate3D, RotateCcw, Save, Scale3D, Share2, Sparkles, Trash2, Trophy, Undo2, X,
} from "lucide-react";
import {
  DesignV1Schema, MATERIAL_BY_ID, MISSION_BY_ID, MISSION_CATALOG, calculatePartMassKg,
  countDesignMaterials, snapScalar, type DesignPartV1, type DesignV1, type PublicDesign, type Transform,
} from "@eggdrop/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Euler, Quaternion } from "three";
import {
  createDesign, deleteDesign, DesignApiError, forgetCloudDesign, getDesign, getEditToken,
  listRememberedDesigns, rememberCloudDesign, updateDesign,
} from "./api/designs";
import { MATERIAL_ORDER, MATERIAL_VISUALS } from "./editor/materialVisuals";
import { freshDesign, getBodyTransform, useEditorStore, type TransformMode } from "./editor/store";
import {
  MAX_DROP_PLAYBACK_RATE,
  MIN_DROP_PLAYBACK_RATE,
  DROP_PLAYBACK_RATE_STEP,
} from "./dropPlayback";
import { BuildScene } from "./scene/BuildScene";
import { DropScene } from "./scene/DropScene";

const DRAFT_KEY = "eggdrop3d:active-draft:v1";
const BESTS_KEY = "eggdrop3d:mission-bests:v1";
type Toast = { kind: "success" | "warning" | "error"; message: string } | null;

const AXIS_SHORTCUTS = ["X", "Y", "Z"] as const;
// Movement follows the default camera view: ←/→ slide along X, ↑/↓ slide along
// the ground-plane Z axis (↑ pushes away from the camera), PgUp/PgDn raise and
// lower along Y.
const MOVEMENT_SHORTCUTS = [
  { negativeKey: "←", negativeName: "Left arrow", negativeCode: "ArrowLeft", positiveKey: "→", positiveName: "Right arrow", positiveCode: "ArrowRight" },
  { negativeKey: "PgDn", negativeName: "Page Down", negativeCode: "PageDown", positiveKey: "PgUp", positiveName: "Page Up", positiveCode: "PageUp" },
  { negativeKey: "↑", negativeName: "Up arrow", negativeCode: "ArrowUp", positiveKey: "↓", positiveName: "Down arrow", positiveCode: "ArrowDown" },
] as const;
const ROTATION_SHORTCUTS = [
  { negativeKey: "U", negativeName: "U", negativeCode: "KeyU", positiveKey: "I", positiveName: "I", positiveCode: "KeyI" },
  { negativeKey: "J", negativeName: "J", negativeCode: "KeyJ", positiveKey: "K", positiveName: "K", positiveCode: "KeyK" },
  { negativeKey: "N", negativeName: "N", negativeCode: "KeyN", positiveKey: "M", positiveName: "M", positiveCode: "KeyM" },
] as const;

const isInteractiveTarget = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(
  target.isContentEditable || target.closest("input, select, textarea, button, a, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [role='slider'], [role='textbox'], [role='combobox']"),
);

const loadMissionBests = (): Record<string, number> => {
  try {
    const value = JSON.parse(localStorage.getItem(BESTS_KEY) ?? "{}");
    return value && typeof value === "object" ? value as Record<string, number> : {};
  } catch {
    return {};
  }
};

const loadDraft = (): DesignV1 | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = DesignV1Schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
};

const currentCloudId = () => location.pathname.match(/^\/design\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? null;

const usePhoneLayout = () => {
  const [matches, setMatches] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const change = () => setMatches(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return matches;
};

function Brand() {
  return (
    <div className="brand-lockup">
      <span className="brand-mark" aria-hidden="true">🥚</span>
      <div><strong>EggDrop3D</strong><span>Virtual STEM Lab</span></div>
    </div>
  );
}

function ModeControls({ readOnly }: { readOnly: boolean }) {
  const design = useEditorStore((state) => state.design);
  const setModeAndMission = useEditorStore((state) => state.setModeAndMission);
  const hasBuild = design.parts.length > 0 || design.joints.length > 0;
  const change = (mode: DesignV1["mode"], missionId: DesignV1["missionId"]) => {
    if (readOnly || (mode === design.mode && missionId === design.missionId)) return;
    if (hasBuild && !window.confirm("Switching modes starts a fresh contraption. Continue?")) return;
    const height = mode === "challenge" ? MISSION_BY_ID[missionId ?? "first-flight"].targetHeightFt : 15;
    setModeAndMission(mode, missionId, height);
  };
  return (
    <div className="mode-area">
      <div className="mode-switch" aria-label="Game mode">
        <button className={design.mode === "sandbox" ? "active" : ""} onClick={() => change("sandbox", null)} disabled={readOnly}><FlaskConical size={14} /> Sandbox</button>
        <button className={design.mode === "challenge" ? "active" : ""} onClick={() => change("challenge", design.missionId ?? "first-flight")} disabled={readOnly}><Trophy size={14} /> Challenge</button>
      </div>
      {design.mode === "challenge" && (
        <label className="mission-picker">
          <span className="sr-only">Mission</span>
          <select value={design.missionId ?? "first-flight"} onChange={(event) => change("challenge", event.target.value as DesignV1["missionId"])} disabled={readOnly}>
            {MISSION_CATALOG.map((mission) => <option key={mission.id} value={mission.id}>{mission.label} · {mission.targetHeightFt} ft</option>)}
          </select>
          <ChevronDown size={14} />
        </label>
      )}
    </div>
  );
}

function Inventory({ readOnly, bestScore }: { readOnly: boolean; bestScore: number | null }) {
  const design = useEditorStore((state) => state.design);
  const activeMaterial = useEditorStore((state) => state.activeMaterial);
  const connectorDraft = useEditorStore((state) => state.connectorDraft);
  const stage = useEditorStore((state) => state.stage);
  const chooseMaterial = useEditorStore((state) => state.chooseMaterial);
  const counts = useMemo(() => countDesignMaterials(design), [design]);
  const mission = design.mode === "challenge" && design.missionId ? MISSION_BY_ID[design.missionId] : null;
  return (
    <aside className="inventory-panel" aria-label="Material inventory">
      <div className="panel-heading">
        <div><span className="eyebrow">BUILD KIT</span><h1>Choose a material</h1></div>
        <span className="count-badge">15</span>
      </div>
      <p className="panel-copy">Place solid materials in the scene. Tape, glue, string, and rubber bands connect two anchor points.</p>
      {mission && <div className="mission-brief"><Trophy size={15} /><div><strong>{mission.label}</strong><span>Survive at {mission.targetHeightFt} ft or higher{bestScore ? ` · Best ${bestScore.toLocaleString()}` : ""}</span></div></div>}
      <div className="material-grid">
        {MATERIAL_ORDER.map((materialId) => {
          const visual = MATERIAL_VISUALS[materialId];
          const definition = MATERIAL_BY_ID[materialId];
          const limit = mission?.inventory[materialId] ?? Infinity;
          const remaining = limit === Infinity ? null : Math.max(0, limit - counts[materialId]);
          const disabled = readOnly || stage !== "build" || remaining === 0;
          const active = activeMaterial === materialId;
          return (
            <button
              className={`material-card ${active ? "selected" : ""}`}
              key={materialId}
              onClick={() => chooseMaterial(active ? null : materialId)}
              disabled={disabled}
              title={`${definition.description} · ${definition.cost} cost point${definition.cost === 1 ? "" : "s"}`}
              aria-pressed={active}
            >
              <span className="material-icon" style={{ background: visual.accent }}>{visual.emoji}</span>
              <span className="material-copy"><strong>{visual.label}</strong><small>{visual.behavior}</small></span>
              <span className="material-meta"><b>{definition.cost}</b>{remaining === null ? <em>∞</em> : <em>{remaining} left</em>}</span>
            </button>
          );
        })}
      </div>
      {connectorDraft && (
        <div className="connector-help">
          <Link2 size={16} />
          <div><strong>{connectorDraft.bodyA ? "Choose the second anchor" : "Choose the first anchor"}</strong><span>{connectorDraft.materialId === "glue" && connectorDraft.bodyA ? "The second piece slides over and bonds at the glue spot." : "Click a part or the egg in the 3D workspace."}</span></div>
          <button aria-label="Cancel connector" onClick={() => chooseMaterial(null)}><X size={14} /></button>
        </div>
      )}
    </aside>
  );
}

function TransformFields({ id, transform, disabled }: { id: string; transform: Transform; disabled: boolean }) {
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const rotationDegrees = useMemo(() => {
    const euler = new Euler().setFromQuaternion(new Quaternion(...transform.rotation), "XYZ");
    return [euler.x, euler.y, euler.z].map((value) => value * 180 / Math.PI);
  }, [transform.rotation]);
  const updateTuple = (key: "position" | "dimensions", index: number, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const next = structuredClone(transform);
    next[key][index] = key === "dimensions" ? Math.max(.01, number) : snapScalar(number, .05);
    updateTransform(id, next);
  };
  const updateRotation = (index: number, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const nextDegrees = [...rotationDegrees];
    nextDegrees[index] = Math.round(number / 15) * 15;
    const euler = new Euler(...nextDegrees.map((degrees) => degrees * Math.PI / 180) as [number, number, number], "XYZ");
    const rotation = new Quaternion().setFromEuler(euler).normalize();
    updateTransform(id, {
      ...structuredClone(transform),
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    });
  };
  return (
    <div className="transform-fields">
      <span>Position · metres</span>
      <div>{AXIS_SHORTCUTS.map((axis, index) => {
        const shortcutId = `position-${axis.toLowerCase()}-shortcut`;
        const shortcut = MOVEMENT_SHORTCUTS[index]!;
        return <label key={axis}><span className="field-label"><span>{axis}</span>{!disabled && <span className="shortcut-badges"><span className="shortcut-command"><i aria-hidden="true">−</i><kbd title={`${shortcut.negativeName}: move −0.05 m on the ${axis} axis`} aria-label={`${shortcut.negativeName}: move negative 0.05 metres on the ${axis} axis`}>{shortcut.negativeKey}</kbd></span><span className="shortcut-command"><i aria-hidden="true">+</i><kbd title={`${shortcut.positiveName}: move +0.05 m on the ${axis} axis`} aria-label={`${shortcut.positiveName}: move positive 0.05 metres on the ${axis} axis`}>{shortcut.positiveKey}</kbd></span></span>}</span><input aria-label={`${axis} position in metres`} aria-describedby={disabled ? undefined : shortcutId} type="number" step="0.05" value={transform.position[index]!.toFixed(2)} onChange={(event) => updateTuple("position", index, event.target.value)} disabled={disabled} />{!disabled && <span className="sr-only" id={shortcutId}>Press {shortcut.negativeName} to move negative 0.05 metres. Press {shortcut.positiveName} to move positive 0.05 metres.</span>}</label>;
      })}</div>
      <span>Rotation · degrees</span>
      <div>{AXIS_SHORTCUTS.map((axis, index) => {
        const shortcutId = `rotation-${axis.toLowerCase()}-shortcut`;
        const shortcut = ROTATION_SHORTCUTS[index]!;
        return <label key={axis}><span className="field-label"><span>{axis}</span>{!disabled && <span className="shortcut-badges"><span className="shortcut-command"><i aria-hidden="true">−</i><kbd title={`${shortcut.negativeName}: rotate −15° about the ${axis} axis`} aria-label={`${shortcut.negativeName}: rotate negative 15 degrees about the ${axis} axis`}>{shortcut.negativeKey}</kbd></span><span className="shortcut-command"><i aria-hidden="true">+</i><kbd title={`${shortcut.positiveName}: rotate +15° about the ${axis} axis`} aria-label={`${shortcut.positiveName}: rotate positive 15 degrees about the ${axis} axis`}>{shortcut.positiveKey}</kbd></span></span>}</span><input aria-label={`${axis} rotation in degrees`} aria-describedby={disabled ? undefined : shortcutId} type="number" step="15" value={Math.round(rotationDegrees[index] ?? 0)} onChange={(event) => updateRotation(index, event.target.value)} disabled={disabled} />{!disabled && <span className="sr-only" id={shortcutId}>Press {shortcut.negativeName} to rotate negative 15 degrees. Press {shortcut.positiveName} to rotate positive 15 degrees.</span>}</label>;
      })}</div>
      {id !== "egg" && <><span>Dimensions · metres</span><div>{(["W", "H", "D"] as const).map((axis, index) => <label key={axis}>{axis}<input aria-label={`${axis} dimension in metres`} type="number" min="0.01" step="0.01" value={transform.dimensions[index]!.toFixed(2)} onChange={(event) => updateTuple("dimensions", index, event.target.value)} disabled={disabled} /></label>)}</div></>}
    </div>
  );
}

const WEIGHT_MIN_G = 10;
const WEIGHT_MAX_G = 500;

function WeightField({ part, disabled }: { part: DesignPartV1; disabled: boolean }) {
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const grams = calculatePartMassKg(part.materialId, part.transform.dimensions) * 1000;
  const setWeight = (value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return;
    const targetGrams = Math.min(WEIGHT_MAX_G, Math.max(WEIGHT_MIN_G, number));
    // Lead density is fixed, so the sinker reaches the target mass by scaling
    // its dimensions uniformly (mass scales with the cube of the size factor).
    const factor = Math.cbrt(targetGrams / grams);
    const next = structuredClone(part.transform);
    next.dimensions = next.dimensions.map((dimension) => Math.max(0.005, dimension * factor)) as [number, number, number];
    updateTransform(part.id, next);
  };
  return (
    <div className="transform-fields">
      <span>Weight · grams</span>
      <div>
        <label>g<input aria-label="Weight in grams" type="number" min={WEIGHT_MIN_G} max={WEIGHT_MAX_G} step="5" value={Math.round(grams)} onChange={(event) => setWeight(event.target.value)} disabled={disabled} /></label>
      </div>
    </div>
  );
}

function Inspector({ readOnly, onDeleteCloud }: { readOnly: boolean; onDeleteCloud: () => void }) {
  const design = useEditorStore((state) => state.design);
  const selectedId = useEditorStore((state) => state.selectedId);
  const transformMode = useEditorStore((state) => state.transformMode);
  const cloud = useEditorStore((state) => state.cloud);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const removeJoint = useEditorStore((state) => state.removeJoint);
  const part = design.parts.find((candidate) => candidate.id === selectedId);
  const transform = selectedId ? getBodyTransform(design, selectedId) : undefined;
  const visual = part ? MATERIAL_VISUALS[part.materialId] : null;
  const mass = part ? calculatePartMassKg(part.materialId, part.transform.dimensions) : .057;
  const modes: Array<[TransformMode, typeof Move3D]> = [["translate", Move3D], ["rotate", Rotate3D], ["scale", Scale3D]];
  return (
    <aside className="inspector-panel" aria-label="Inspector">
      <span className="eyebrow">INSPECTOR</span>
      {!selectedId || !transform ? (
        <div className="empty-inspector"><PackageOpen size={34} /><h2>Nothing selected</h2><p>Click the egg or a material to inspect and transform it.</p></div>
      ) : (
        <>
          <h2>{selectedId === "egg" ? "Your egg" : visual?.shortLabel}</h2>
          <div className="selection-card">
            <span style={{ background: visual?.accent ?? "#fff0c2" }}>{visual?.emoji ?? "🥚"}</span>
            <div><strong>{selectedId === "egg" ? "Chicken egg" : visual?.label}</strong><small>{Math.round(mass * 1000)} g · {selectedId === "egg" ? "fragile core" : visual?.behavior.toLowerCase()}</small></div>
            {selectedId === "egg" && <em>CORE</em>}
          </div>
          <div className="meter-label"><span>Shell health</span><strong>100%</strong></div><div className="health-meter"><i /></div>
          {!readOnly && <div className="gizmo-modes">{modes.map(([mode, Icon]) => <button key={mode} className={transformMode === mode ? "active" : ""} onClick={() => setTransformMode(mode)} disabled={selectedId === "egg" && mode === "scale"} title={mode}><Icon size={15} /><span>{mode}</span></button>)}</div>}
          <TransformFields id={selectedId} transform={transform} disabled={readOnly} />
          {part?.materialId === "fishingWeight" && <WeightField part={part} disabled={readOnly} />}
          {part && !readOnly && <div className="inspector-actions"><button onClick={duplicateSelected}><Copy size={14} /> Duplicate</button><button className="danger" onClick={deleteSelected}><Trash2 size={14} /> Delete</button></div>}
        </>
      )}
      <div className="joint-list">
        <div><span>Connections</span><b>{design.joints.length}</b></div>
        {design.joints.length === 0 ? <p>Use tape, string, or a rubber band to hold pieces together.</p> : design.joints.map((joint, index) => (
          <div className="joint-row" key={joint.id}><span>{MATERIAL_VISUALS[joint.materialId].emoji}</span><div><strong>{MATERIAL_VISUALS[joint.materialId].shortLabel} {index + 1}</strong><small>{joint.bodyA === "egg" ? "Egg" : `Part ${design.parts.findIndex((part) => part.id === joint.bodyA) + 1}`} → {joint.bodyB === "egg" ? "Egg" : `Part ${design.parts.findIndex((part) => part.id === joint.bodyB) + 1}`}</small></div>{!readOnly && <button onClick={() => removeJoint(joint.id)} aria-label="Remove connection"><X size={13} /></button>}</div>
        ))}
      </div>
      <div className="tip-card"><b>💡</b><div><strong>Engineer’s tip</strong><p>Build a cage first, then add soft materials where the egg may strike.</p></div></div>
      {cloud.id && !cloud.readOnly && <button className="delete-cloud" onClick={onDeleteCloud}><Trash2 size={13} /> Delete cloud copy</button>}
    </aside>
  );
}

function DropSetup() {
  const design = useEditorStore((state) => state.design);
  const playbackRate = useEditorStore((state) => state.playbackRate);
  const setHeight = useEditorStore((state) => state.setHeight);
  const setPlaybackRate = useEditorStore((state) => state.setPlaybackRate);
  const cancel = useEditorStore((state) => state.cancelDropSetup);
  const release = useEditorStore((state) => state.release);
  const mission = design.mode === "challenge" && design.missionId ? MISSION_BY_ID[design.missionId] : null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="drop-setup modal-card" role="dialog" aria-modal="true" aria-labelledby="drop-title">
        <button className="modal-close" onClick={cancel} aria-label="Close"><X size={18} /></button>
        <div className="modal-kicker"><Gauge size={16} /> DROP SETUP</div>
        <h2 id="drop-title">How high should we go?</h2>
        <p>Choose any height from 5 to 50 feet. The whole contraption starts this far above the landing pad.</p>
        {design.parts.length === 0 && <div className="bare-warning"><AlertTriangle size={17} /><span>This is a bare-egg baseline drop. It probably won’t end sunny-side up.</span></div>}
        <div className="height-readout"><strong>{design.heightFt.toFixed(1)}</strong><span>feet</span><em>{(design.heightFt * .3048).toFixed(2)} m</em></div>
        <input className="height-slider" type="range" min="5" max="50" step="0.5" value={design.heightFt} onChange={(event) => setHeight(Number(event.target.value))} aria-label="Drop height in feet" />
        <div className="slider-labels"><span>5 ft</span>{mission && <b style={{ left: `${((mission.targetHeightFt - 5) / 45) * 100}%` }}>★ {mission.targetHeightFt} ft target</b>}<span>50 ft</span></div>
        <div className="playback-control">
          <div className="playback-heading"><div><Play size={14} /><span>Playback speed</span></div><strong>{playbackRate.toFixed(1)}×</strong></div>
          <p>Changes how fast you watch. Gravity, damage, metrics, and score stay the same.</p>
          <input
            className="playback-slider"
            type="range"
            min={MIN_DROP_PLAYBACK_RATE}
            max={MAX_DROP_PLAYBACK_RATE}
            step={DROP_PLAYBACK_RATE_STEP}
            value={playbackRate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            aria-label="Drop playback speed"
            aria-valuetext={`${playbackRate.toFixed(1)} times speed`}
          />
          <div className="playback-labels"><span>0.1× slow</span><span>1× real time</span><span>2× fast</span></div>
        </div>
        <div className="drop-fact"><Sparkles size={17} /><span>Without air resistance, the fall reaches about <strong>{Math.sqrt(2 * 9.81 * design.heightFt * .3048).toFixed(1)} m/s</strong>.</span></div>
        <div className="modal-actions"><button className="secondary" onClick={cancel}>Keep building</button><button className="release-button" onClick={release}><Play size={17} fill="currentColor" /> Release contraption</button></div>
      </section>
    </div>
  );
}

function ResultModal() {
  const result = useEditorStore((state) => state.result);
  const dropAgain = useEditorStore((state) => state.dropAgain);
  const editBuild = useEditorStore((state) => state.editBuild);
  if (!result) return null;
  const survived = result.outcome === "survived";
  return (
    <div className="modal-backdrop result-backdrop">
      <section className={`result-card modal-card ${survived ? "success" : "cracked"}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
        <div className="result-icon">{survived ? "🥚" : "🍳"}</div>
        <span className="eyebrow">TEST COMPLETE</span>
        <h2 id="result-title">{survived ? "The egg survived!" : "Crack! Back to the lab."}</h2>
        <p>{survived ? "Your contraption kept the shell below its damage limit." : "The shell absorbed too much force. Try more cushioning, drag, or space to decelerate."}</p>
        <div className="metric-grid">
          <div><span>Drop height</span><strong>{result.heightFt.toFixed(1)} ft</strong></div>
          <div><span>Impact speed</span><strong>{result.impactSpeedMps.toFixed(1)} m/s</strong></div>
          <div><span>Peak load</span><strong>{Math.round(result.peakG)} G</strong></div>
          <div><span>Peak force</span><strong>{Math.round(result.peakForceN)} N</strong></div>
        </div>
        {result.score !== null && <div className="score-banner"><Trophy size={22} /><span>Mission score</span><strong>{result.score.toLocaleString()}</strong></div>}
        <div className="modal-actions"><button className="secondary" onClick={editBuild}><Edit3 size={15} /> Edit build</button><button className="release-button" onClick={dropAgain}><RotateCcw size={16} /> Drop again</button></div>
      </section>
    </div>
  );
}

function CloudMenu({ open, close }: { open: boolean; close: () => void }) {
  const items = open ? listRememberedDesigns() : [];
  if (!open) return null;
  return (
    <div className="cloud-menu">
      <div><strong>My cloud designs</strong><button onClick={close}><X size={14} /></button></div>
      {items.length === 0 ? <p>No saved designs on this device yet.</p> : items.map((item) => <a key={item.id} href={`/design/${item.id}`}><span>🥚</span><div><strong>{item.name}</strong><small>{new Date(item.updatedAt).toLocaleDateString()}</small></div></a>)}
    </div>
  );
}

export function App() {
  const design = useEditorStore((state) => state.design);
  const stage = useEditorStore((state) => state.stage);
  const runId = useEditorStore((state) => state.runId);
  const playbackRate = useEditorStore((state) => state.playbackRate);
  const result = useEditorStore((state) => state.result);
  const cloud = useEditorStore((state) => state.cloud);
  const past = useEditorStore((state) => state.past);
  const future = useEditorStore((state) => state.future);
  const setDesign = useEditorStore((state) => state.setDesign);
  const setCloud = useEditorStore((state) => state.setCloud);
  const setName = useEditorStore((state) => state.setName);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const clear = useEditorStore((state) => state.clear);
  const select = useEditorStore((state) => state.select);
  const chooseMaterial = useEditorStore((state) => state.chooseMaterial);
  const snapDraft = useEditorStore((state) => state.snapDraft);
  const setSnapMode = useEditorStore((state) => state.setSnapMode);
  const deleteSelected = useEditorStore((state) => state.deleteSelected);
  const duplicateSelected = useEditorStore((state) => state.duplicateSelected);
  const openDropSetup = useEditorStore((state) => state.openDropSetup);
  const finishRun = useEditorStore((state) => state.finishRun);
  const abortRun = useEditorStore((state) => state.abortRun);
  const [fitNonce, setFitNonce] = useState(0);
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);
  const [cloudMenu, setCloudMenu] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [missionBests, setMissionBests] = useState<Record<string, number>>(loadMissionBests);
  const initialised = useRef(false);
  const readOnly = cloud.readOnly;
  const phoneLayout = usePhoneLayout();
  const editingLocked = readOnly || phoneLayout;
  const designFingerprint = useMemo(() => JSON.stringify(design), [design]);
  const cloudDirty = Boolean(cloud.id && savedFingerprint !== designFingerprint);

  useEffect(() => {
    let cancelled = false;
    const initialise = async () => {
      const id = currentCloudId();
      if (!id) {
        const draft = loadDraft();
        if (draft) setDesign(draft);
        setLoading(false);
        initialised.current = true;
        return;
      }
      try {
        const stored = await getDesign(id);
        if (cancelled) return;
        const token = getEditToken(id);
        setDesign(stored.design);
        setSavedFingerprint(JSON.stringify(stored.design));
        setCloud({ id, version: stored.version, editToken: token, readOnly: !token });
      } catch (error) {
        if (cancelled) return;
        setToast({ kind: "error", message: error instanceof Error ? error.message : "Could not load that design." });
        history.replaceState({}, "", "/");
        setDesign(loadDraft() ?? freshDesign());
      } finally {
        if (!cancelled) { setLoading(false); initialised.current = true; }
      }
    };
    void initialise();
    return () => { cancelled = true; };
  }, [setCloud, setDesign]);

  useEffect(() => {
    if (!initialised.current || cloud.readOnly) return;
    const timeout = window.setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(design)), 500);
    return () => window.clearTimeout(timeout);
  }, [design, cloud.readOnly]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (result?.score === null || result?.score === undefined || !design.missionId) return;
    setMissionBests((current) => {
      const next = { ...current, [design.missionId!]: Math.max(current[design.missionId!] ?? 0, result.score!) };
      localStorage.setItem(BESTS_KEY, JSON.stringify(next));
      return next;
    });
  }, [result, design.missionId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || isInteractiveTarget(event.target)) return;
      if (event.key === "Escape" && stage === "dropping") { event.preventDefault(); abortRun(); return; }
      if (editingLocked || stage !== "build") return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      else if (event.key === "Escape") { chooseMaterial(null); select(null); }
      else if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        const state = useEditorStore.getState();
        if (!state.selectedId) return;
        const transform = getBodyTransform(state.design, state.selectedId);
        if (!transform) return;

        const movementAxis = MOVEMENT_SHORTCUTS.findIndex(({ negativeCode, positiveCode }) => event.code === negativeCode || event.code === positiveCode);
        if (movementAxis >= 0) {
          const shortcut = MOVEMENT_SHORTCUTS[movementAxis]!;
          const direction = event.code === shortcut.negativeCode ? -1 : 1;
          event.preventDefault();
          const next = structuredClone(transform);
          next.position[movementAxis] = snapScalar(next.position[movementAxis]! + direction * .05, .05);
          state.updateTransform(state.selectedId, next);
          return;
        }

        const rotationAxis = ROTATION_SHORTCUTS.findIndex(({ negativeCode, positiveCode }) => event.code === negativeCode || event.code === positiveCode);
        if (rotationAxis >= 0) {
          const shortcut = ROTATION_SHORTCUTS[rotationAxis]!;
          const direction = event.code === shortcut.negativeCode ? -1 : 1;
          event.preventDefault();
          const euler = new Euler().setFromQuaternion(new Quaternion(...transform.rotation), "XYZ");
          const degrees = [euler.x, euler.y, euler.z].map((value) => value * 180 / Math.PI);
          degrees[rotationAxis] = Math.round((degrees[rotationAxis]! + direction * 15) / 15) * 15;
          const nextEuler = new Euler(...degrees.map((value) => value * Math.PI / 180) as [number, number, number], "XYZ");
          const quaternion = new Quaternion().setFromEuler(nextEuler).normalize();
          state.updateTransform(state.selectedId, {
            ...structuredClone(transform),
            rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [undo, redo, duplicateSelected, deleteSelected, chooseMaterial, select, abortRun, editingLocked, stage]);

  const save = async (forceNew = false): Promise<PublicDesign | null> => {
    if (readOnly && !forceNew) return null;
    setCloud({ saving: true });
    try {
      if (!forceNew && cloud.id && cloud.editToken && cloud.version) {
        const updated = await updateDesign(cloud.id, design, cloud.editToken, cloud.version);
        rememberCloudDesign(updated);
        setSavedFingerprint(JSON.stringify(updated.design));
        setCloud({ version: updated.version, saving: false });
        setToast({ kind: "success", message: "Cloud design updated." });
        return updated;
      }
      const created = await createDesign(design);
      rememberCloudDesign(created, created.editToken);
      setSavedFingerprint(JSON.stringify(created.design));
      setCloud({ id: created.id, version: created.version, editToken: created.editToken, readOnly: false, saving: false });
      history.replaceState({}, "", `/design/${created.id}`);
      setToast({ kind: "success", message: "Saved! Your private edit key stays on this device." });
      return created;
    } catch (error) {
      setCloud({ saving: false });
      if (error instanceof DesignApiError && error.status === 409) setConflict(true);
      else setToast({ kind: "error", message: error instanceof Error ? error.message : "Cloud save failed. Your local draft is safe." });
      return null;
    }
  };

  const share = async () => {
    if (!cloud.id) {
      setToast({ kind: "warning", message: "Save this design before sharing it." });
      return;
    }
    if (cloudDirty) {
      setToast({ kind: "warning", message: "Update the cloud copy before sharing your latest changes." });
      return;
    }
    const url = `${location.origin}/design/${cloud.id}`;
    try { await navigator.clipboard.writeText(url); setToast({ kind: "success", message: "Read-only share link copied." }); }
    catch { setToast({ kind: "warning", message: url }); }
  };

  const remix = () => {
    setDesign({ ...structuredClone(design), name: `${design.name} remix`, mode: "sandbox", missionId: null });
    setSavedFingerprint(null);
    setCloud({ id: null, version: null, editToken: null, readOnly: false });
    history.pushState({}, "", "/");
    setToast({ kind: "success", message: "Remix created as a new local draft." });
  };

  const removeCloud = async () => {
    if (!cloud.id || !cloud.editToken || !cloud.version || !window.confirm("Delete this public cloud copy? Your local draft will remain.")) return;
    try {
      await deleteDesign(cloud.id, cloud.editToken, cloud.version);
      forgetCloudDesign(cloud.id);
      setSavedFingerprint(null);
      setCloud({ id: null, version: null, editToken: null, readOnly: false });
      history.replaceState({}, "", "/");
      setToast({ kind: "success", message: "Cloud copy deleted. Your local draft remains." });
    } catch (error) { setToast({ kind: "error", message: error instanceof Error ? error.message : "Could not delete the cloud copy." }); }
  };

  const reloadCloud = async () => {
    if (!cloud.id) return;
    try {
      const latest = await getDesign(cloud.id);
      setDesign(latest.design); setSavedFingerprint(JSON.stringify(latest.design)); setCloud({ version: latest.version }); setConflict(false);
    } catch (error) { setToast({ kind: "error", message: error instanceof Error ? error.message : "Could not reload." }); }
  };

  if (loading) return <div className="loading-screen"><span>🥚</span><LoaderCircle className="spin" size={28} /><strong>Opening the lab…</strong></div>;

  return (
    <main className={`app-shell stage-${stage}`}>
      <header className="topbar">
        <Brand />
        <ModeControls readOnly={editingLocked} />
        <label className="design-name"><span className="sr-only">Design name</span><input value={design.name} maxLength={60} onChange={(event) => setName(event.target.value)} disabled={editingLocked} /></label>
        <div className="top-actions">
          {readOnly ? <button className="remix-button" onClick={remix}><Copy size={15} /> Remix</button> : <button className="my-designs-button" onClick={() => setCloudMenu((open) => !open)}><FolderOpen size={15} /><span>My designs</span></button>}
          {!readOnly && <button className="primary-small" onClick={() => void save()} disabled={cloud.saving}>{cloud.saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}<span>{cloud.id ? "Update" : "Save"}</span></button>}
          <button onClick={() => void share()} disabled={cloud.saving} title={!cloud.id ? "Save before sharing" : cloudDirty ? "Update before sharing" : "Copy share link"}><Share2 size={15} /><span>Share</span></button>
          <CloudMenu open={cloudMenu} close={() => setCloudMenu(false)} />
        </div>
      </header>
      <Inventory readOnly={editingLocked} bestScore={design.missionId ? missionBests[design.missionId] ?? null : null} />
      <section className="lab-stage" aria-label="3D building workspace">
        <div className="stage-toolbar">
          <span><i className={`status-dot ${stage === "dropping" ? "falling" : ""}`} /> {stage === "build" ? (readOnly ? "VIEW MODE" : "BUILD MODE") : stage === "dropping" ? "PHYSICS LIVE" : stage === "result" ? "TEST COMPLETE" : "DROP SETUP"}</span>
          {stage === "build" && !readOnly && <><button onClick={undo} disabled={!past.length} title="Undo"><Undo2 size={14} /> Undo</button><button onClick={redo} disabled={!future.length} title="Redo"><Redo2 size={14} /> Redo</button><button className={snapDraft ? "active" : ""} onClick={() => setSnapMode(!snapDraft)} title="Snap ends together" aria-pressed={Boolean(snapDraft)}><Magnet size={14} /> Snap</button><button onClick={() => { if (!design.parts.length || window.confirm("Clear every material and connection?")) clear(); }} title="Clear build"><Trash2 size={14} /> Clear</button></>}
          {stage === "build" && <button onClick={() => setFitNonce((value) => value + 1)} title="Fit view"><Focus size={14} /> Fit view</button>}
        </div>
        <div className="height-chip"><Gauge size={14} /><strong>{design.heightFt.toFixed(1)} ft</strong><span>drop</span></div>
        {stage === "dropping" || stage === "result" ? (
          <DropScene design={design} runId={runId} running={stage === "dropping"} playbackRate={playbackRate} onComplete={finishRun} />
        ) : <BuildScene editable={!editingLocked && stage === "build"} fitNonce={fitNonce} />}
        {stage === "build" && design.parts.length === 0 && !snapDraft && <div className="stage-hint"><strong>Start with the egg</strong><span>Choose a material, then click the grid to place it.</span></div>}
        {stage === "build" && snapDraft && (
          <div className="stage-hint snap-hint">
            <strong>{snapDraft.bodyA ? "Snap: pick the end to move" : "Snap: pick the end that stays"}</strong>
            <span>{snapDraft.bodyA ? "Click near an end of another part — it slides over so the two ends touch. Esc to cancel." : "Click near an end of a part or the egg. That end stays put. Esc to cancel."}</span>
          </div>
        )}
        {stage === "dropping" && <div className="drop-live"><span>↓</span><div><strong>Dropping from {design.heightFt.toFixed(1)} ft · {playbackRate.toFixed(1)}× playback</strong><small>Pinch with two fingers to zoom · camera angle locked · press Esc to quit</small></div></div>}
        {readOnly && <div className="readonly-banner"><Info size={15} /><span>This shared design is read-only. You can drop it or make your own remix.</span></div>}
      </section>
      {(stage === "build" || stage === "dropSetup") && <Inspector readOnly={editingLocked} onDeleteCloud={() => void removeCloud()} />}
      <footer className="drop-dock">
        <div><span className="eyebrow">READY WHEN YOU ARE</span><strong>{design.parts.length ? `${design.parts.length} part${design.parts.length === 1 ? "" : "s"} · ${design.joints.length} connection${design.joints.length === 1 ? "" : "s"}` : "Protect the egg—or test the bare-shell baseline."}</strong></div>
        <div className="dock-legend"><span><i className="blue-dot" /> {design.mode === "sandbox" ? "Unlimited sandbox" : MISSION_BY_ID[design.missionId!].label}</span><span><Box size={13} /> {design.parts.length}/100 bodies</span></div>
        <button className="drop-button" onClick={openDropSetup} disabled={stage !== "build"}><span>↓</span> Set up drop</button>
      </footer>
      <div className="phone-notice"><AlertTriangle size={17} /><div><strong>Small-screen viewer</strong><span>Drop and remix here; use a tablet or computer for precise 3D editing.</span></div></div>
      {stage === "dropSetup" && <DropSetup />}
      {stage === "result" && <ResultModal />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.kind === "success" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span>{toast.message}</span><button onClick={() => setToast(null)}><X size={14} /></button></div>}
      {conflict && <div className="modal-backdrop"><section className="modal-card conflict-card"><AlertTriangle size={28} /><h2>This design changed elsewhere</h2><p>Reload the newest cloud version, or keep your current work as a new remix.</p><div className="modal-actions"><button className="secondary" onClick={() => void reloadCloud()}>Reload newest</button><button className="release-button" onClick={() => { setConflict(false); void save(true); }}>Save as remix</button></div></section></div>}
    </main>
  );
}
