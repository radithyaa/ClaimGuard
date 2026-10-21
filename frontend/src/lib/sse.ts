"use client";

import { useEffect, useState } from "react";

import { api, USE_MOCK } from "@/lib/api-client";
import type { InvestigationEvent, InvestigationEventType } from "@/types/api";

const TERMINAL: InvestigationEventType[] = ["done", "error", "cancelled"];
const EVENT_TYPES: InvestigationEventType[] = ["status", "tool_start", "tool_end", "thought", "decision", "done", "error", "cancelled"];

export type StreamState = "connecting" | "open" | "reconnecting" | "closed";

/**
 * Berlangganan SSE investigasi. EventSource mengirim ulang Last-Event-ID saat reconnect otomatis,
 * jadi backend memutar ulang event yang terlewat; duplikat dibuang lewat `seq`.
 */
export function useInvestigationStream(id: string) {
  const [events, setEvents] = useState<InvestigationEvent[]>([]);
  const [state, setState] = useState<StreamState>("connecting");

  useEffect(() => {
    setEvents([]);
    setState("connecting");
    let lastSeq = 0;
    const push = (e: InvestigationEvent) => {
      if (e.seq <= lastSeq) return;
      lastSeq = e.seq;
      setEvents((prev) => [...prev, e]);
      if (TERMINAL.includes(e.type)) {
        setState("closed");
        stop();
      }
    };

    let stop: () => void;
    if (USE_MOCK) {
      let cancel = () => {};
      const t = setTimeout(async () => {
        const { mockStream } = await import("@/lib/mock/investigation");
        setState("open");
        cancel = mockStream(id, 0, push);
      }, 300);
      stop = () => {
        clearTimeout(t);
        cancel();
      };
    } else {
      const es = new EventSource(api.investigations.streamUrl(id), { withCredentials: true });
      es.onopen = () => setState("open");
      // Browser reconnect otomatis; CLOSED berarti server menolak (mis. 404)
      es.onerror = () => setState(es.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (msg) => push(JSON.parse((msg as MessageEvent<string>).data)));
      }
      stop = () => es.close();
    }
    return () => stop();
  }, [id]);

  return { events, state };
}
