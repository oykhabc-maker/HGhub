import { useEffect, useState } from "react";
import { api, cover } from "../api";
import type { Detail } from "../types";
import { useStore } from "../store";
import { Empty, Img } from "../components/ui";
import { IBack, IChevR, IHist, ITrash } from "../icons";

/** 秒 → m:ss */
function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* 歷史播放：本機觀看記錄（store.history）的專用清單。
   電視模式沒有頁籤列，原本只有「我的 → 觀看歷史」進得去，
   這裡拉出來給遙控器直接看：一列一部、封面＋集數＋進度，點進去接著播。
   記錄只存在本機（localStorage），不上傳。 */
export default function HistoryPage({ onBack }: { onBack: () => void }) {
  const { history, push, clearHistory, toast } = useStore();
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [loading, setLoading] = useState(false);
  const ids = history.map((h) => h.id);

  useEffect(() => {
    let alive = true;
    const missing = ids.filter((id) => !details[id]);
    if (!missing.length) { setLoading(false); return undefined; }
    setLoading(true);
    Promise.allSettled(missing.map((id) => api.video(id)))
      .then((rs) => {
        if (!alive) return;
        setDetails((m) => {
          const next = { ...m };
          rs.forEach((r, i) => {
            if (r.status === "fulfilled") next[missing[i]] = (r as PromiseFulfilledResult<Detail>).value;
          });
          return next;
        });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 px-3 pt-2 pb-3" style={{ paddingTop: "calc(var(--sat, 0px) + 8px)" }}>
        <div className="flex items-center gap-2">
          <button onClick={onBack} aria-label="返回"
            className="w-10 h-10 rounded-full flex items-center justify-center text-on pressable">
            <IBack size={20} />
          </button>
          <span className="w-9 h-9 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center shrink-0">
            <IHist size={19} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[20px] font-bold text-on leading-none">歷史播放</div>
            <div className="text-[10.5px] text-mut mt-1">接著上次看到的地方 · {history.length} 條記錄</div>
          </div>
        </div>
      </div>

      <div className="flex-1 scroll-y px-3 pb-10">
        {loading && !ids.length ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 spinner" /></div>
        ) : ids.length ? (
          <div className="flex flex-col gap-2">
            {history.map((h, i) => {
              const d = details[h.id];
              const pct = h.dur > 0 ? Math.max(0, Math.min(100, (h.t / h.dur) * 100)) : 0;
              const finished = h.dur > 0 && h.t >= h.dur - 10;
              return (
                <button key={`${h.id}-${h.at}`}
                  onClick={() => push({
                    kind: "feed", videoIds: ids, index: i, title: "歷史播放",
                    startEp: h.ep, startTime: finished ? undefined : h.t,
                  })}
                  className="w-full flex items-center gap-3 p-2.5 rounded-(--r-md) bg-s1 elev-1 pressable text-left">
                  <div className="relative w-[118px] shrink-0 rounded-(--r-sm) overflow-hidden bg-s2" style={{ aspectRatio: "16 / 9" }}>
                    <Img src={d?.cover ? cover(d.cover, 320) : ""} />
                    <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/72 text-[9.5px] leading-none text-white/92">
                      {clock(h.t)}{h.dur > 0 ? ` / ${clock(h.dur)}` : ""}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-on truncate">{d?.title || `視頻 ${h.id}`}</div>
                    <div className="text-[10.5px] text-mut mt-1">
                      第 {h.ep} 集{finished ? " · 已看完" : h.t > 3 ? ` · 看到 ${clock(h.t)}` : " · 剛開始"}
                    </div>
                    {h.dur > 0 && (
                      <div className="mt-2 h-[3px] rounded-full bg-s3 overflow-hidden">
                        <div className="h-full" style={{ width: `${pct}%`, background: "var(--p-primary)" }} />
                      </div>
                    )}
                  </div>
                  <IChevR size={16} className="text-mut shrink-0" />
                </button>
              );
            })}
          </div>
        ) : (
          <Empty icon={<IHist size={24} />} title="還沒有觀看記錄"
            sub="看過的劇集會出現在這裡，點一下就從上次的位置接著播"
            action="去逛逛" onAction={() => push({ kind: "ranks" })} />
        )}

        {ids.length > 0 && (
          <button
            onClick={() => { clearHistory(); toast("已清空觀看記錄", "ok"); }}
            className="mt-4 w-full h-10 rounded-(--r-ctl) bg-s3 text-[12.5px] text-mut pressable flex items-center justify-center gap-1.5">
            <ITrash size={15} />
            清空觀看記錄
          </button>
        )}
      </div>
    </div>
  );
}
