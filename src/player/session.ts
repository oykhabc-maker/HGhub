import type { Episode, PlayInfo } from "../types";

/** 某一集的播放源。main 必选，hevc 只在当前集确实提供高清时存在。 */
export type PlaybackSource = {
  mainUrl: string;
  hevcUrl: string;
};

export type PlaybackQuality = "hd" | "sd";

/** PlayInfo → PlaybackSource：兼容新版 streams 和旧版 video_url 字段。 */
export function toPlaybackSource(info: PlayInfo | null | undefined): PlaybackSource | null {
  const mainUrl = info?.streams?.main || info?.video_url || "";
  if (!mainUrl) return null;
  const hevcUrl = info?.streams?.hevc || info?.video_url_hevc || "";
  return { mainUrl, hevcUrl };
}

export function hasHevc(source: PlaybackSource | null | undefined): boolean {
  return !!source?.hevcUrl;
}

/** 按用户画质偏好选择实际地址；没有高清源时永远回落到 main。 */
export function selectPlaybackUrl(source: PlaybackSource | null | undefined, preferHevc: boolean): string {
  return preferHevc && source?.hevcUrl ? source.hevcUrl : source?.mainUrl || "";
}

export function playbackQuality(source: PlaybackSource | null | undefined, preferHevc: boolean): PlaybackQuality {
  return preferHevc && source?.hevcUrl ? "hd" : "sd";
}

export function episodeKey(videoId: number | undefined, episode: number): string {
  return `${videoId ?? 0}:${episode}`;
}

/** 剧集列表里当前集的下一集；没有列表时按连续集号处理。 */
export function nextEpisodeNumber(episodes: readonly Episode[], current: number): number | null {
  if (!episodes.length) return current + 1;
  const nums = Array.from(new Set(episodes.map(e => e.ep_num).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  return nums.find(n => n > current) ?? null;
}

/** 剧集列表里当前集的上一集。 */
export function previousEpisodeNumber(episodes: readonly Episode[], current: number): number | null {
  if (!episodes.length) return current > 1 ? current - 1 : null;
  const nums = Array.from(new Set(episodes.map(e => e.ep_num).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  return [...nums].reverse().find(n => n < current) ?? null;
}

/**
 * 续播目标：只在记录位置大于 1 秒、且不会落到片尾 3 秒内时返回。
 * 返回 null 表示从开头播放。
 */
export function resumePosition(savedTime: number | undefined, duration: number): number | null {
  if (!savedTime || !Number.isFinite(savedTime) || savedTime <= 1) return null;
  if (Number.isFinite(duration) && duration > 0 && savedTime >= duration - 3) return null;
  return savedTime;
}
