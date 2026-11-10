/* ============================================================
   遙控器焦點引擎
   ------------------------------------------------------------
   Chromium 在 Android WebView 裡不會用方向鍵移動 DOM 焦點（實測：
   ／分類／頁按 5 次 DPAD_DOWN，畫面逐像素比較 diff = 0.00），
   所以自己算幾何最近的目標，focus() 之後再畫焦點框。

   規則：
     - 方向鍵 → 找「當前焦點」在那個方向上最合理的鄰居
     - Enter / 空白 → 點擊當前焦點
     - 播放器（body[data-tv-playing]）沒開面板時，方向鍵讓給播放器
     - 有 [data-tv-overlay] 時（彈層 / 面板），只在彈層內移動
   ============================================================ */
import { logLine } from "../api";
import { tvOn } from "./tvMode";

type Dir = "up" | "down" | "left" | "right";

const KEYMAP: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const SEL = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let lastFocused: HTMLElement | null = null;
let installed = false;

function visible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.closest("[inert]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none") return false;
  if (Number(cs.opacity) === 0) return false;
  return true;
}

export function tvCandidates(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    if (el.closest("[data-tv-skip]")) return;
    if (visible(el)) out.push(el);
  });
  return out;
}

function nearest(cur: HTMLElement, dir: Dir, list: HTMLElement[]): HTMLElement | null {
  const c = cur.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  const vertical = dir === "up" || dir === "down";
  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of list) {
    if (el === cur || cur.contains(el) || el.contains(cur)) continue;
    if (el === cur.parentElement) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const primary = vertical ? dy : dx;
    if (dir === "down" && primary <= 2) continue;
    if (dir === "up" && primary >= -2) continue;
    if (dir === "right" && primary <= 2) continue;
    if (dir === "left" && primary >= -2) continue;

    /* 垂直移動時看水平重疊、水平移動時看垂直重疊：
       重疊的候選（同一欄 / 同一列）優先，否則依偏移量加重懲罰。 */
    const overlap = vertical
      ? Math.min(c.right, r.right) - Math.max(c.left, r.left)
      : Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
    const secondary = vertical ? Math.abs(dx) : Math.abs(dy);
    const score = Math.abs(primary) + secondary * (overlap > 0 ? 0.28 : 1.5);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function describe(el: HTMLElement): string {
  const label = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 36);
  const r = el.getBoundingClientRect();
  return `x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)} h=${Math.round(r.height)} "${label}"`;
}

export function focusEl(el: HTMLElement, scroll = true) {
  if (lastFocused && lastFocused !== el) lastFocused.classList.remove("tv-focus");
  lastFocused = el;
  el.classList.add("tv-focus");
  try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  if (scroll) {
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch { /* ignore */ }
  }
  /* 遙控器沒有滑鼠，出問題時只能靠這行日誌重建「焦點跑去哪」 */
  if (tvOn()) logLine(`[tv] focus ${describe(el)}`);
}

/** 把焦點放到畫面上第一個合理的元素（分頁切換、載入完成後呼叫） */
export function focusFirst(root?: ParentNode): boolean {
  const scope: ParentNode = root || (document.querySelector<HTMLElement>("[data-tv-overlay]") || document);
  const all = tvCandidates(scope);
  if (!all.length) return false;
  /* 文字框放最後：電視上沒有輸入法，先把焦點給可點的內容，
     使用者真的要走搜尋再自己往上一格。 */
  const list = all.filter((el) => !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const pool = list.length ? list : all;
  /* 取「最靠上、同高時最靠左」的一個，而不是 DOM 第一個 ——
     DOM 順序在瀑布流 / 橫向列表裡常常不是視覺順序。 */
  let best = pool[0];
  const br = best.getBoundingClientRect();
  for (const el of pool.slice(1)) {
    const r = el.getBoundingClientRect();
    if (r.top < br.top - 8 || (Math.abs(r.top - br.top) <= 8 && r.left < br.left)) best = el;
  }
  focusEl(best);
  return true;
}

export function blurFocus() {
  if (lastFocused) lastFocused.classList.remove("tv-focus");
  lastFocused = null;
}

function activeEl(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement) return null;
  return a;
}

/** 目前焦點還在不在「看得見、且屬於當前頁」的元素上 */
export function focusIsAlive(scope?: ParentNode | null): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement) return false;
  if (!a.classList || !a.classList.contains("tv-focus")) return false;
  if (!visible(a)) return false;
  if (scope && (scope as Element).contains && !(scope as Element).contains(a)) return false;
  return true;
}

/** 目前是否有播放器在吃方向鍵（Feed 會在有焦點、沒開面板時標記） */
export function playerActive(): boolean {
  return !!document.querySelector("[data-tv-playing='1']");
}

function onKeyDown(e: KeyboardEvent) {
  if (!tvOn()) return;
  if (e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const t = e.target as HTMLElement | null;
  const tag = t?.tagName || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t?.isContentEditable ?? false);
  const overlay = document.querySelector<HTMLElement>("[data-tv-overlay]");
  const playing = playerActive();

  /* 播放器：方向鍵 / 空白是播放器的（切集、快進、暫停），
     只有開了面板才由焦點引擎接管。 */
  if (playing && !overlay) return;

  if (e.key === "Enter" || (e.key === " " && !playing)) {
    if (typing && e.key !== "Enter") return;
    const a = activeEl();
    if (a && a.classList.contains("tv-focus")) {
      e.preventDefault();
      e.stopPropagation();
      a.click();
    }
    return;
  }

  const dir = KEYMAP[e.key];
  if (!dir) return;
  if (typing && (dir === "left" || dir === "right")) return; // 輸入框內移動游標

  const scope: ParentNode = overlay || document;
  const list = tvCandidates(scope);
  if (!list.length) return;

  const cur = activeEl();
  if (!cur || !list.includes(cur)) {
    /* 還沒有焦點：第一次按方向鍵就把焦點放進來，不消耗這個按鍵的語意 */
    e.preventDefault();
    e.stopPropagation();
    focusFirst(scope);
    return;
  }
  const next = nearest(cur, dir, list);
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  focusEl(next);
}

export function installFocusEngine(): () => void {
  if (installed) return () => {};
  installed = true;
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    installed = false;
    window.removeEventListener("keydown", onKeyDown, true);
    blurFocus();
  };
}
