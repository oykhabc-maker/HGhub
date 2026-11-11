import { useStore } from "./index";

/** Player 切片：播放器 UI / 偏好状态。 */
export function usePlayerStore() {
  const s = useStore();
  return {
    theater: s.theater, setTheater: s.setTheater,
    fs: s.fs, setFs: s.setFs, clean: s.clean, setClean: s.setClean,
    muted: s.muted, setMuted: s.setMuted,
    muteOnStartup: s.muteOnStartup, setMuteOnStartup: s.setMuteOnStartup,
    swipeEp: s.swipeEp, setSwipeEp: s.setSwipeEp,
    preferHevc: s.preferHevc, setPreferHevc: s.setPreferHevc,
    volume: s.volume, setVolume: s.setVolume,
  };
}
