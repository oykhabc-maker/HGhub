import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { logLine } from "../api";
import { installRemoteBridge } from "./bridge";
import { armRemoteWatcher, initTvMode, setTvMode, subscribeTv, tvOn } from "./tvMode";
import { blurFocus, focusFirst, focusIsAlive, installFocusEngine, playerActive } from "./focus";

/** 掛在 App 裡一次：電視模式開關、焦點引擎、換頁後的焦點歸位、預設分頁 */
export default function TvMode() {
  const { tab, stack, loginOpen, setTab } = useStore();
  const [on, setOn] = useState(() => initTvMode());

  useEffect(() => {
    installRemoteBridge();
    const unArm = armRemoteWatcher();
    const unSub = subscribeTv(setOn);
    return () => { unArm(); unSub(); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("tv-mode", on);
    logLine(`[tv] mode=${on ? "on" : "off"} ua="${navigator.userAgent.slice(0, 60)}" screen=${screen.width}x${screen.height}`);
    if (!on) { blurFocus(); return undefined; }
    const un = installFocusEngine();
    return un;
  }, [on, setTab]);

  /* 電視每次啟動都停在「分類」：首頁是全螢幕自動播放的短劇流，
     用遙控器的人開機要的是「挑片」，不是被塞一部正在播的劇。 */
  const seeded = useRef(false);
  useEffect(() => {
    if (!on || seeded.current) return;
    seeded.current = true;
    setTab("category");
  }, [on, setTab]);

  /* 換分頁 / 進出頁面 / 開關登入框 → 把焦點放到看得見的第一個項目 */
  useEffect(() => {
    if (!on) return undefined;
    let tries = 0;
    const tick = () => {
      const overlay = document.querySelector<HTMLElement>("[data-tv-overlay]");
      if (playerActive() && !overlay) return;
      /* 頁面堆疊：焦點一定要在「最上層那一頁」裡，否則按 OK 會點到
         被蓋住的舊頁面按鈕（畫面上完全看不出來）。 */
      const pages = document.querySelectorAll<HTMLElement>("[data-tv-page]");
      const top = pages.length ? pages[pages.length - 1] : null;
      const a = document.activeElement as HTMLElement | null;
      const inBar = !!(a && a.closest && a.closest(".hg-tabbar"));
      if (focusIsAlive(top || overlay || null) && !(inBar && tries < 3)) return;
      if (focusFirst(top || overlay || undefined)) return;
      if (++tries < 8) window.setTimeout(tick, 200);
    };
    const id = window.setTimeout(tick, 140);
    return () => window.clearTimeout(id);
  }, [on, tab, stack.length, loginOpen]);

  useEffect(() => {
    if (!on) return undefined;
    /* 給設定頁用的手動切換（Settings 直接呼叫 setTvMode） */
    (window as unknown as { hgSetTvMode?: (v: boolean) => void }).hgSetTvMode = (v: boolean) => setTvMode(v);
    return undefined;
  }, [on]);

  return null;
}

/** 給 UI 判斷用（例如設定頁的開關狀態） */
export function useTvMode(): boolean {
  const [on, setOn] = useState(() => tvOn());
  useEffect(() => subscribeTv(setOn), []);
  return on;
}
