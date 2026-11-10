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

/**
 * 候選範圍：彈層 > 最上層堆疊頁 > 整份文件。
 * 堆疊頁（分類 / 排行榜…）是「蓋在原本那頁之上」的 z-30 容器，下面那頁沒有被
 * display:none / visibility:hidden，所以整份文件一起找的話，焦點會跑到背後那頁
 * ——遙控器看起來就是「往下按一下，高亮框就不見了」（框其實在下面那頁的 banner 上）。
 */
export function activeScope(): ParentNode {
  const overlay = document.querySelector<HTMLElement>("[data-tv-overlay]");
  if (overlay) return overlay;
  const pages = document.querySelectorAll<HTMLElement>("[data-tv-page]");
  if (pages.length) return pages[pages.length - 1];
  return document;
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
    /* 垂直移動時，整塊在畫面左右之外的（橫向列的離屏卡片）不要選：
       scrollIntoView 對 transform 輪播沒用，選到就是「框跑到看不見的地方」。 */
    if (vertical && (r.right <= 0 || r.left >= window.innerWidth)) continue;
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    /* 底部頁籤列（首頁/搜索/分類/我的）不搶內容區的「往下」：
       內容最後一列按 DOWN 直接跳到頁籤列，使用者會覺得焦點莫名跑掉。
       要切分頁用數字鍵（1-4），或在頁籤列上左右移動。 */
    if (dir === "down" && !cur.closest("[data-tv-nav]") && el.closest("[data-tv-nav]")) continue;

    const primary = vertical ? dy : dx;
    /* 最小間距：網格裡左右兩欄常差幾像素，用固定 2px 判斷會把「隔壁欄同一列」
       當成「下面那一個」（往下按卻往右跑）。改成跟元素尺寸成比例。 */
    const gap = Math.max(6, Math.round(0.35 * Math.min(
      vertical ? c.height : c.width,
      vertical ? r.height : r.width,
    )));
    if (dir === "down" && primary <= gap) continue;
    if (dir === "up" && primary >= -gap) continue;
    if (dir === "right" && primary <= gap) continue;
    if (dir === "left" && primary >= -gap) continue;

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

let lastKey = "";

function keyOf(el: HTMLElement): string {
  return (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * 把元素捲進可視範圍。
 * scrollIntoView 在某些版面（flex 子項沒有 min-height:0、外層 overflow:hidden）
 * 會完全不動，遙控器看起來就是「焦點移到下面但畫面不捲」。這裡直接對
 * 最近的可捲動祖先改 scrollTop，是最可靠的一招。
 */
function ensureInView(el: HTMLElement) {
  const vh = window.innerHeight;
  let r = el.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= vh) return;
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    const cs = getComputedStyle(p);
    const scrollable = /auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4;
    if (scrollable) {
      const pr = p.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      if (box.top < pr.top + 8) p.scrollTop += box.top - pr.top - 16;
      else if (box.bottom > pr.bottom - 8) p.scrollTop += box.bottom - pr.bottom + 16;
      return;
    }
    p = p.parentElement;
  }
  /* 沒有可捲動祖先 → 退回視窗捲動 */
  r = el.getBoundingClientRect();
  if (r.top < 0) window.scrollBy(0, r.top - 16);
  else if (r.bottom > vh) window.scrollBy(0, r.bottom - vh + 16);
}

export function focusEl(el: HTMLElement, scroll = true) {
  if (lastFocused && lastFocused !== el) lastFocused.classList.remove("tv-focus");
  lastFocused = el;
  lastKey = keyOf(el);
  el.classList.add("tv-focus");
  try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
  if (scroll) {
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch { /* ignore */ }
    ensureInView(el);
  }
  /* 遙控器沒有滑鼠，出問題時只能靠這行日誌重建「焦點跑去哪」 */
  if (tvOn()) logLine(`[tv] focus ${describe(el)}`);
  /* 安全網：焦點落在畫面外＝使用者眼中「高亮框不見了」，一定要留下證據 */
  const rr = el.getBoundingClientRect();
  if (tvOn() && (rr.right <= 0 || rr.left >= window.innerWidth || rr.bottom <= 0 || rr.top >= window.innerHeight)) {
    logLine(`[tv] offscreen! vw=${window.innerWidth}x${window.innerHeight} ${describe(el)}`);
  }
}

/** 把焦點放到畫面上第一個合理的元素（分頁切換、載入完成後呼叫） */
export function focusFirst(root?: ParentNode): boolean {
  const scope: ParentNode = root || activeScope();
  const all = tvCandidates(scope);
  if (!all.length) return false;
  /* 文字框放最後：電視上沒有輸入法，先把焦點給可點的內容，
     使用者真的要走搜尋再自己往上一格。 */
  const list = all.filter((el) => !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  /* 頁籤列在電視模式是置頂的，幾何上最靠上 —— 但它不該是「進頁面後的第一個焦點」 */
  const content = list.filter((el) => !el.closest("[data-tv-nav]"));
  const pool = content.length ? content : (list.length ? list : all);
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

/**
 * 瀑布流 / 横向列表重繪時，原本那個節點會被 React 換掉，
 * `.tv-focus` 跟著消失 —— 遙控器看起來就是「高亮框移動一下就整個不見」。
 * 這裡用焦點文字當識別，把高亮框接回同一個邏輯元素。
 */
export function reanchor(): boolean {
  if (lastFocused && lastFocused.isConnected && lastFocused.classList.contains("tv-focus")) return true;
  if (!lastKey) return false;
  const hit = tvCandidates(activeScope()).find((el) => {
    if (keyOf(el) !== lastKey) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!hit) return false;
  focusEl(hit, true);
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

  const scope: ParentNode = overlay || activeScope();
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
