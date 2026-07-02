import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AI_BASE = "https://ai.gateway.lovable.dev/v1";
const GCAL_BASE =
  "https://connector-gateway.lovable.dev/google_calendar/calendar/v3";
const TZ = "Asia/Ho_Chi_Minh";

function gcalHeaders() {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!lovableKey) throw new Error("LOVABLE_API_KEY chưa được cấu hình");
  if (!connKey)
    throw new Error("Google Calendar chưa được kết nối (GOOGLE_CALENDAR_API_KEY)");
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

// ---------- Transcribe ----------

const TranscribeInput = z.object({
  audioBase64: z.string().min(1),
  mime: z.string().default("audio/wav"),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TranscribeInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY chưa được cấu hình");

    const bin = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const ext = data.mime.includes("mp3")
      ? "mp3"
      : data.mime.includes("mp4") || data.mime.includes("m4a")
        ? "m4a"
        : data.mime.includes("webm")
          ? "webm"
          : "wav";
    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("file", new Blob([bin], { type: data.mime }), `recording.${ext}`);
    // language hint (Vietnamese)
    form.append("language", "vi");

    const res = await fetch(`${AI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Transcribe lỗi ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });

// ---------- Parse tasks with Gemini ----------

const ParseInput = z.object({ transcript: z.string().min(1) });

export type ParsedTask = {
  title: string;
  durationMin: number;
  explicitStart?: string; // "HH:mm" 24h
};

export const parseTasks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data }): Promise<{ tasks: ParsedTask[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY chưa được cấu hình");

    const now = new Date();
    const nowStr = new Intl.DateTimeFormat("vi-VN", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "Bạn trích xuất danh sách công việc từ câu nói tiếng Việt. " +
            `Hiện tại là ${nowStr}. ` +
            "Trả về JSON DUY NHẤT dạng {\"tasks\":[{\"title\":string, \"durationMin\":number, \"explicitStart\":string|null}]} " +
            "trong đó explicitStart là HH:mm 24h nếu người dùng nói giờ cụ thể, ngược lại null. " +
            "Mặc định durationMin=30. Nếu người dùng nói thời lượng (vd '1 tiếng', '15 phút') dùng giá trị đó. " +
            "Nếu chỉ có 1 việc, mảng chứa 1 phần tử. Không thêm giải thích.",
        },
        { role: "user", content: data.transcript },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch(`${AI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Parse lỗi ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { tasks?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const arr = Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? ((parsed as { tasks: unknown[] }).tasks as unknown[])
      : [];
    const tasks: ParsedTask[] = arr
      .map((t) => {
        const o = t as Record<string, unknown>;
        const title = String(o.title ?? "").trim();
        const dur = Number(o.durationMin ?? 30);
        const start =
          typeof o.explicitStart === "string" && /^\d{1,2}:\d{2}$/.test(o.explicitStart)
            ? o.explicitStart
            : undefined;
        return {
          title,
          durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 30,
          explicitStart: start,
        };
      })
      .filter((t) => t.title.length > 0);

    return { tasks };
  });

// ---------- Google Calendar: busy blocks for today ----------

function todayBoundsISO() {
  // Bounds in Asia/Ho_Chi_Minh (+07:00). Server may be UTC; compute using Intl parts.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dateStr = `${get("year")}-${get("month")}-${get("day")}`; // YYYY-MM-DD in Saigon
  const startOfDay = new Date(`${dateStr}T00:00:00+07:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59+07:00`);
  return {
    startISO: startOfDay.toISOString(),
    endISO: endOfDay.toISOString(),
    dateStr,
  };
}

export const listTodayEvents = createServerFn({ method: "GET" }).handler(
  async () => {
    const { startISO, endISO } = todayBoundsISO();
    const url = new URL(`${GCAL_BASE}/calendars/primary/events`);
    url.searchParams.set("timeMin", startISO);
    url.searchParams.set("timeMax", endISO);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "50");

    const res = await fetch(url.toString(), { headers: gcalHeaders() });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Calendar lỗi ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      items?: Array<{
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };
    const busy = (json.items ?? [])
      .map((e) => ({
        startISO: e.start?.dateTime ?? null,
        endISO: e.end?.dateTime ?? null,
      }))
      .filter(
        (b): b is { startISO: string; endISO: string } =>
          !!b.startISO && !!b.endISO,
      );
    return { busy };
  },
);

// ---------- Create event ----------

const CreateInput = z.object({
  title: z.string().min(1),
  startISO: z.string().min(1),
  endISO: z.string().min(1),
});

export const createEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data }) => {
    const res = await fetch(`${GCAL_BASE}/calendars/primary/events`, {
      method: "POST",
      headers: gcalHeaders(),
      body: JSON.stringify({
        summary: data.title,
        start: { dateTime: data.startISO, timeZone: TZ },
        end: { dateTime: data.endISO, timeZone: TZ },
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Tạo event lỗi ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as { id?: string; htmlLink?: string };
    return { id: json.id ?? null, htmlLink: json.htmlLink ?? null };
  });