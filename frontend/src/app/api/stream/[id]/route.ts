import { NextRequest } from "next/server";

/**
 * Proxy SSE investigasi.
 *
 * Kenapa tidak langsung ke API (bug produksi, 22 Okt 2026): setelah login lewat route
 * handler web, cookie sesi hanya ada di domain WEB. `EventSource` yang memanggil domain API
 * tidak membawa cookie itu, sehingga stream ditolak 401 dan trace agen tidak muncul.
 *
 * Proxy ini meneruskan cookie first-party ke API dan meneruskan balik stream apa adanya
 * (termasuk `id:` untuk Last-Event-ID), tanpa buffering.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  const lastEventId = req.headers.get("last-event-id");

  const headers: Record<string, string> = { Accept: "text/event-stream", cookie };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/api/v1/investigations/${id}/stream`, {
      headers,
      cache: "no-store",
      // Stream panjang: putus hanya bila klien memutus.
      signal: req.signal,
    });
  } catch {
    return new Response('event: error\ndata: {"code":"api_unreachable"}\n\n', {
      status: 502,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`event: error\ndata: {"code":"http_${upstream.status}"}\n\n`, {
      status: upstream.status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nonaktifkan buffering di proxy Cloud Run/NGINX.
      "X-Accel-Buffering": "no",
    },
  });
}
