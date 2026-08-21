export const MIN_DROP_PLAYBACK_RATE = .1;
export const MAX_DROP_PLAYBACK_RATE = 2;
export const DEFAULT_DROP_PLAYBACK_RATE = .2;
export const DROP_PLAYBACK_RATE_STEP = .1;

export const normalizeDropPlaybackRate = (value: number) => {
  if (!Number.isFinite(value)) return DEFAULT_DROP_PLAYBACK_RATE;
  const clamped = Math.min(MAX_DROP_PLAYBACK_RATE, Math.max(MIN_DROP_PLAYBACK_RATE, value));
  return Number((Math.round(clamped / DROP_PLAYBACK_RATE_STEP) * DROP_PLAYBACK_RATE_STEP).toFixed(1));
};
