import { invoke } from "@tauri-apps/api/core";
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ChangeEvent, type PointerEvent, type RefObject,
} from "react";
import Hls from "hls.js";
import type { FragBufferedData, FragLoadedData, FragLoadingData } from "hls.js";
import { copyText } from "../clipboard";

type Data = Record<string, unknown>;
export type PlaybackTrace = (event: string, data?: Record<string, unknown>) => void;
type Status = { enabled: boolean; path: string | null; error: string | null };
type Entry = { event: string; data: Data };
type Snapshot = Status & { ready: boolean; pending: boolean };

/* ── 播放诊断日志 ───────────────────────────────────────── */

// Separate transport also lets browser regressions verify diagnostics without Tauri or upstream.
export const playbackLogApi = {
  status: () => invoke<Status>("playback_log_status"),
  set: (enabled: boolean) => invoke<Status>("playback_log_set", { enabled }),
  write: (entries: Entry[]) => invoke<void>("playback_log_write", { entries }),
  read: () => invoke<string>("playback_log_read"),
};
let state: Snapshot = { enabled: false, path: null, error: null, ready: false, pending: false };
const listeners = new Set<() => void>();
const session = globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let init: Promise<void> | undefined;
let queue: Entry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> = Promise.resolve();
let nextPlayer = 0;
function publish(next: Partial<Snapshot>) {
  state = { ...state, ...next };
  listeners.forEach(fn => fn());
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const usePlaybackLog = () => useSyncExternalStore(subscribe, () => state);
export const playbackLogEnabled = () => state.enabled && !state.pending && !state.error;

export function tracePlayback(event: string, data: Data = {}) {
  if (!playbackLogEnabled()) return;
  // Bounded batches; sustained dragging must not create unlimited IPC or disk work.
  if (queue.length >= 512) {
    queue.splice(0, queue.length - 510);
    queue.unshift({ event: "queue.dropped", data: { session } });
  }
  queue.push({ event, data: { ...data, session, at: new Date().toISOString(), mono_ms: Math.round(performance.now()) } });
  if (!timer) timer = setTimeout(() => { void flushPlaybackLog(); }, 250);
}

export async function flushPlaybackLog() {
  clearTimeout(timer); timer = undefined;
  const entries = queue; queue = [];
  writing = writing.catch(() => {}).then(async () => {
    for (let i = 0; i < entries.length; i += 128) await playbackLogApi.write(entries.slice(i, i + 128));
  });
  try { await writing; }
  catch { publish({ error: "诊断日志写入失败，请检查可用空间后重新开启" }); }
}

export function initPlaybackLog() {
  return init ??= playbackLogApi.status().then(saved => {
    publish({ ...saved, ready: true });
    tracePlayback("app.start", { version: __APP_VERSION__, platform: navigator.platform, user_agent: navigator.userAgent, hls_version: Hls.version, media_source: !!window.MediaSource, managed_media_source: "ManagedMediaSource" in window });
  }).catch(() => { init = undefined; publish({ error: "无法读取诊断日志设置" }); });
}

export async function setPlaybackLog(on: boolean) {
  if (!state.ready || state.pending) throw new Error("日志设置尚未就绪");
  publish({ pending: true });
  try {
    await flushPlaybackLog();
    const saved = await playbackLogApi.set(on);
    publish({ ...saved, pending: false });
    tracePlayback("app.snapshot", { version: __APP_VERSION__, platform: navigator.platform, user_agent: navigator.userAgent, hls_version: Hls.version, media_source: !!window.MediaSource, managed_media_source: "ManagedMediaSource" in window });
  } finally { if (state.pending) publish({ pending: false }); }
}

export async function copyPlaybackLog() {
  await flushPlaybackLog();
  const text = await playbackLogApi.read();
  if (!text) throw new Error("尚无诊断日志，请开启后复现问题");
  await copyText(text);
}

/* ── 媒体标识与快照 ─────────────────────────────────────── */

export function mediaResource(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol === "hg:" || url.hostname === "hg.localhost") raw = url.searchParams.get("u") || raw;
  } catch { /* still fingerprint invalid targets without logging their contents */ }
  let hash = 2166136261;
  for (const b of new TextEncoder().encode(raw)) hash = Math.imul(hash ^ b, 16777619) >>> 0;
  return `r${hash.toString(16).padStart(8, "0")}`;
}

/**
 * 只取 host，用来判断「是哪条 CDN / 哪个接口域名」。
 * 不含 path 与 query，所以能落盘：出问题时一眼看出是源站、还是某个分片域名挂了。
 */
export function mediaHost(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "hg:" || url.hostname === "hg.localhost") {
      const inner = url.searchParams.get("u");
      if (inner) return new URL(inner).host;
    }
    return url.host;
  } catch {
    return "?";
  }
}

function ranges(value: TimeRanges) {
  return Array.from({ length: Math.min(value.length, 12) }, (_, i) => [round(value.start(i)), round(value.end(i))]);
}
const round = (n: number) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const engines = new WeakMap<Hls, string>();
export function mediaSnapshot(v: HTMLVideoElement, hls?: Hls | null) {
  return { time: round(v.currentTime), duration: round(v.duration), paused: v.paused, seeking: v.seeking, ready: v.readyState, network: v.networkState,
    buffered: ranges(v.buffered), seekable: ranges(v.seekable), muted: v.muted, volume: v.volume, rate: v.playbackRate,
    buffering_enabled: hls?.bufferingEnabled, loading_enabled: hls?.loadingEnabled, media_error: v.error?.code ?? null,
    engine: hls ? engines.get(hls) : "native", prefer_managed: hls?.config.preferManagedMediaSource,
    visible: getComputedStyle(v).visibility !== "hidden" && v.getClientRects().length > 0 };
}

export function usePlayerDiagnostics(videoRef: RefObject<HTMLVideoElement | null>, hlsRef: RefObject<Hls | null>, context: Data) {
  const id = useRef<string>("");
  if (!id.current) id.current = `player-${++nextPlayer}`;
  const current = useRef(context); current.current = context;
  const pending = useRef<{ id: number; target: number; start: number; seeks: number; seeked: boolean } | null>(null);
  const seekSeq = useRef(0);
  const snapshot = () => {
    const v = videoRef.current;
    return { player: id.current, ...current.current, ...(v ? mediaSnapshot(v, hlsRef.current) : {}) };
  };
  const trace = (event: string, data: Data = {}) => {
    if (!playbackLogEnabled()) return;
    try { tracePlayback(event, { ...snapshot(), seek: pending.current?.id, ...data }); } catch { /* diagnostics must never interrupt playback */ }
  };
  const requestSeek = (target: number, source: string) => {
    if (!playbackLogEnabled()) return;
    const previous = pending.current;
    if (previous) trace("seek.superseded", { seek: previous.id, next_target: round(target), elapsed_ms: Math.round(performance.now() - previous.start) });
    pending.current = { id: ++seekSeq.current, target, start: performance.now(), seeks: 0, seeked: false };
    trace("seek.request", { seek: seekSeq.current, target: round(target), source });
    if (videoRef.current && !videoRef.current.seeking && Math.abs(videoRef.current.currentTime - target) < .001) {
      trace("seek.noop", { seek: seekSeq.current });
      pending.current = null;
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let frame: number | undefined;
    let lastHeartbeat = 0;
    let timeoutReported = 0;
    const emit = (event: string, data: Data = {}) => {
      if (playbackLogEnabled()) {
        try { tracePlayback(event, { player: id.current, ...current.current, ...mediaSnapshot(v, hlsRef.current), ...data }); } catch { /* detached or changing ranges */ }
      }
    };
    const finish = (method: string, frameTime?: number) => {
      const p = pending.current;
      if (!p || !p.seeked) return;
      emit(method === "paused_ready" ? "seek.ready" : "seek.resumed", { seek: p.id, target: round(p.target), elapsed_ms: Math.round(performance.now() - p.start), method, frame_time: frameTime == null ? null : round(frameTime) });
      pending.current = null;
    };
    const onEvent = (e: Event) => {
      if (!playbackLogEnabled()) return;
      const p = pending.current;
      if (e.type === "seeking" && p) p.seeks++;
      if (e.type === "seeked" && p) p.seeked = true;
      emit(`media.${e.type}`, p ? { seek: p.id, target: round(p.target), elapsed_ms: Math.round(performance.now() - p.start), seeking_events: p.seeks } : {});
      if (e.type === "seeked") {
        if (frame != null) v.cancelVideoFrameCallback?.(frame);
        if (v.paused && v.readyState >= 2) finish("paused_ready");
        else if (v.requestVideoFrameCallback) {
          const expected = p?.id;
          frame = v.requestVideoFrameCallback((_now, metadata) => {
            if (pending.current?.id === expected) finish("video_frame", metadata.mediaTime);
          });
        }
      }
      if (e.type === "playing" && !v.requestVideoFrameCallback) finish("playing");
    };
    const events = ["loadstart", "loadedmetadata", "loadeddata", "play", "pause", "playing", "waiting", "stalled", "seeking", "seeked", "ended", "error", "emptied", "abort", "ratechange", "volumechange", "canplay"];
    events.forEach(event => v.addEventListener(event, onEvent));
    const stateChange = () => { if (playbackLogEnabled()) emit("player.snapshot"); else pending.current = null; };
    const unsubscribe = subscribe(stateChange);
    const heartbeat = setInterval(() => {
      if (!playbackLogEnabled()) return;
      const p = pending.current;
      if (p && performance.now() - p.start > 8000 && timeoutReported !== p.id) {
        timeoutReported = p.id;
        emit("seek.timeout", { seek: p.id, target: round(p.target), elapsed_ms: Math.round(performance.now() - p.start) });
      }
      if (performance.now() - lastHeartbeat >= 5000) { lastHeartbeat = performance.now(); emit("player.heartbeat"); }
    }, 1000);
    emit("player.mount");
    return () => {
      emit("player.unmount");
      events.forEach(event => v.removeEventListener(event, onEvent));
      clearInterval(heartbeat); unsubscribe();
      if (frame != null) v.cancelVideoFrameCallback?.(frame);
    };
  }, []);
  useEffect(() => { trace("player.context"); }, [context.active, context.view, context.video_id, context.episode, context.resource]);
  return { trace, requestSeek };
}

export function observeHls(hls: Hls, trace: (event: string, data?: Data) => void) {
  hls.on(Hls.Events.MEDIA_ATTACHED, (_event, data) => {
    const source = data.mediaSource;
    engines.set(hls, source?.constructor.name || "MediaSource");
    trace("hls.attached", { engine: engines.get(hls), prefer_managed: hls.config.preferManagedMediaSource });
    if (source) {
      const start = () => trace("mms.startstreaming");
      const end = () => trace("mms.endstreaming");
      source.addEventListener("startstreaming", start);
      source.addEventListener("endstreaming", end);
      hls.once(Hls.Events.DESTROYING, () => { source.removeEventListener("startstreaming", start); source.removeEventListener("endstreaming", end); });
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => trace("hls.manifest", { levels: hls.levels.length }));
  for (const event of [Hls.Events.FRAG_LOADING, Hls.Events.FRAG_LOADED, Hls.Events.FRAG_BUFFERED, Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED] as const) {
    hls.on(event, (_event: string, data: FragLoadingData | FragLoadedData | FragBufferedData) => {
      if (!playbackLogEnabled()) return;
      const { frag } = data;
      const loading = frag.stats.loading;
      trace(event, { resource: mediaResource(frag.url), host: mediaHost(frag.url), fragment: frag.sn, start: round(frag.start), duration: round(frag.duration), bytes: frag.stats.loaded,
        load_ms: loading.end > 0 && loading.end >= loading.start ? round(loading.end - loading.start) : null,
        first_byte_ms: loading.first > 0 && loading.first >= loading.start ? round(loading.first - loading.start) : null });
    });
  }
  hls.on(Hls.Events.ERROR, (_event, data) => trace("hls.error", { type: data.type, detail: data.details, fatal: data.fatal, status: data.response?.code,
    fragment: data.frag?.sn, resource: data.frag ? mediaResource(data.frag.url) : undefined, host: data.frag ? mediaHost(data.frag.url) : undefined }));
}

export function installPlaybackPageEvents() {
  document.addEventListener("visibilitychange", () => tracePlayback("page.visibility", { visibility: document.visibilityState }));
  window.addEventListener("pagehide", () => { tracePlayback("page.hide"); void flushPlaybackLog(); });
  document.addEventListener("securitypolicyviolation", e => tracePlayback("security.csp_violation", { directive: e.effectiveDirective, disposition: e.disposition, resource: mediaResource(e.blockedURI) }));
}

/* ── 媒体错误提示 ───────────────────────────────────────── */

const isLinuxClient = () => {
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const macos = !ios && /Macintosh|Mac OS X/i.test(ua);
  return !android && !ios && !macos && /Linux|X11/i.test(ua);
};

export function mediaErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case 2:
      return "网络错误，视频加载失败，请检查网络后重试";
    case 3:
      return "视频解码失败，请重试";
    case 4:
      return isLinuxClient()
        ? "当前系统缺少 H.264/AAC 解码器，请安装 gstreamer1.0-libav 和 gstreamer1.0-plugins-bad 后重试"
        : "当前视频格式不受支持";
    default:
      return "视频加载失败，请重试";
  }
}

/* ── 播放活动控制 ───────────────────────────────────────── */

/** Keep asynchronous autoplay and error recovery subject to the latest page activity. */
export function usePlaybackActivity(
  videoRef: RefObject<HTMLVideoElement | null>, hlsRef: RefObject<Hls | null>,
  { active, autoPlay, src, trace }: { active: boolean; autoPlay: boolean; src: string; trace: (event: string, data?: Record<string, unknown>) => void },
) {
  const latest = useRef({ active, trace }); latest.current = { active, trace };
  const wanted = useRef(autoPlay);
  const mounted = useRef(true);
  const previous = useRef(active);
  useLayoutEffect(() => { wanted.current = autoPlay; }, [src, autoPlay]);

  const play = useCallback((source: string, automatic = false) => {
    const v = videoRef.current;
    if (!v) return;
    if (!mounted.current || !latest.current.active || (automatic && !wanted.current)) {
      latest.current.trace("play.blocked", { source, inactive: !latest.current.active, play_wanted: wanted.current });
      return;
    }
    wanted.current = true;
    const hls = hlsRef.current;
    if (hls?.levels.length && !hls.loadingEnabled) hls.startLoad(v.currentTime);
    latest.current.trace("play.request", { source });
    v.play().then(() => {
      // The page may have changed while play() was pending.
      if (!mounted.current || !latest.current.active) v.pause();
    }).catch(e => latest.current.trace("play.rejected", { source, error_name: e?.name }));
  }, []);
  const pause = useCallback((source = "handle") => {
    wanted.current = false;
    latest.current.trace("pause.request", { source });
    videoRef.current?.pause();
  }, []);

  useLayoutEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    mounted.current = true;
    const hls = hlsRef.current;
    if (!active) {
      // Include pauses made through native/PiP controls, which bypass our buttons.
      if (v.readyState >= 2) wanted.current = !v.paused;
      v.pause();
      // Let an in-flight manifest finish, but stop fragment loading for hidden pages.
      if (hls?.levels.length) hls.stopLoad();
      latest.current.trace("page.suspended", { play_wanted: wanted.current });
    } else if (!previous.current) {
      if (hls?.levels.length && !hls.loadingEnabled) hls.startLoad(v.currentTime);
      if (wanted.current && (hls?.levels.length || v.readyState > 0)) play("page_active", true);
    }
    previous.current = active;
  }, [active, play]);

  useLayoutEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const guard = () => {
      if (latest.current.active) return;
      latest.current.trace("play.blocked", { source: "media_event", inactive: true });
      v.pause();
      if (hlsRef.current?.levels.length) hlsRef.current.stopLoad();
    };
    v.addEventListener("play", guard);
    v.addEventListener("playing", guard);
    return () => { mounted.current = false; v.removeEventListener("play", guard); v.removeEventListener("playing", guard); v.pause(); };
  }, []);
  return { play, pause, isActive: () => mounted.current && latest.current.active };
}

/* ── 进度拖动输入 ───────────────────────────────────────── */

type SeekInputProps = {
  time: number; duration: number; enabled?: boolean; resetKey?: string;
  onSeek: (time: number, input: string) => void;
  onInteraction?: (phase: string, input: string, target: number, pointerTarget?: number) => void;
};

/** Preview pointer movement locally; commit a single seek on release. Keyboard stays native. */
export function useSeekInput({ time, duration, enabled = true, resetKey, onSeek, onInteraction }: SeekInputProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const pointer = useRef<{ id: number; x: number; moved: boolean; target: number; el: HTMLInputElement } | null>(null);
  const latest = useRef({ onSeek, onInteraction }); latest.current = { onSeek, onInteraction };
  const seekable = enabled && Number.isFinite(duration) && duration > 0;
  const release = () => {
    const p = pointer.current; pointer.current = null;
    if (p?.el.hasPointerCapture(p.id)) p.el.releasePointerCapture(p.id);
  };
  const cancel = () => {
    const p = pointer.current;
    if (p) latest.current.onInteraction?.("cancel", p.moved ? "drag" : "click", p.target);
    release(); setPreview(null);
  };
  useEffect(() => { cancel(); }, [seekable, duration, resetKey]);
  useEffect(() => () => { release(); }, []);
  const targetAt = (e: PointerEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration : 0;
  };
  const displayTime = preview ?? time;
  return {
    time: displayTime,
    inputProps: {
      disabled: !seekable, min: 0, max: seekable ? duration : 1, step: .01,
      value: Math.max(0, Math.min(displayTime, seekable ? duration : 0)),
      style: { touchAction: "none" },
      onPointerDown: (e: PointerEvent<HTMLInputElement>) => {
        if (!seekable || e.button !== 0 || pointer.current) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        const target = targetAt(e);
        pointer.current = { id: e.pointerId, x: e.clientX, moved: false, target, el: e.currentTarget };
        e.currentTarget.setPointerCapture(e.pointerId);
        setPreview(target);
        latest.current.onInteraction?.("down", "pointer", time, target);
        latest.current.onInteraction?.("change", "click", target);
      },
      onPointerMove: (e: PointerEvent<HTMLInputElement>) => {
        const p = pointer.current;
        if (!p || p.id !== e.pointerId) return;
        if (Math.abs(e.clientX - p.x) > 3) p.moved = true;
        p.target = targetAt(e); setPreview(p.target);
        latest.current.onInteraction?.("change", p.moved ? "drag" : "click", p.target);
      },
      onPointerUp: (e: PointerEvent<HTMLInputElement>) => {
        const p = pointer.current;
        if (!p || p.id !== e.pointerId) return;
        const target = targetAt(e), input = p.moved ? "drag" : "click";
        release(); setPreview(null);
        latest.current.onInteraction?.("up", input, target);
        if (seekable) latest.current.onSeek(target, input);
      },
      onPointerCancel: cancel,
      onLostPointerCapture: () => { if (pointer.current) cancel(); },
      onBlur: cancel,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        if (!seekable || pointer.current) return;
        const target = Number(e.target.value);
        latest.current.onInteraction?.("change", "keyboard", target);
        latest.current.onSeek(target, "keyboard");
      },
    },
  };
}
