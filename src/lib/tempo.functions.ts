import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUnlocked } from "./gate.functions";

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
  // ~5MB base64 cap → ~60s of 16kHz PCM16 WAV
  audioBase64: z.string().min(1).max(7_000_000),
  mime: z.string().default("audio/wav"),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => TranscribeInput.parse(d))
  .handler(async ({ data }) => {
    await requireUnlocked();
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

const ParseInput = z.object({ transcript: z.string().min(1).max(10_000) });

export type ParsedTask = {
  title: string;
  durationMin: number;
  explicitStart?: string; // "HH:mm" 24h
  explicitEnd?: string; // "HH:mm" 24h
  explicitDate?: string; // "YYYY-MM-DD" (Asia/Ho_Chi_Minh)
  description?: string;
};

export const parseTasks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data }): Promise<{ tasks: ParsedTask[] }> => {
    await requireUnlocked();
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY chưa được cấu hình");

    const now = new Date();
    const nowStr = new Intl.DateTimeFormat("vi-VN", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const g = (t: string) => dateParts.find((p) => p.type === t)?.value ?? "";
    const todayStr = `${g("year")}-${g("month")}-${g("day")}`; // YYYY-MM-DD
    const weekdayVi = new Intl.DateTimeFormat("vi-VN", {
      timeZone: TZ,
      weekday: "long",
    }).format(now); // "Thứ Hai" / "Chủ Nhật"

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "Bạn trích xuất danh sách công việc từ câu nói tiếng Việt.\n" +
            `Hiện tại (Asia/Ho_Chi_Minh): ${todayStr} ${nowStr}, ${weekdayVi}.\n` +
            "Trả về JSON DUY NHẤT dạng: {\"tasks\":[{\"title\":string, \"durationMin\":number, \"explicitStart\":string|null, \"explicitEnd\":string|null, \"explicitDate\":string|null, \"description\":string|null}]}\n" +
            "\n" +
            "QUY TẮC NGÀY (explicitDate = YYYY-MM-DD hoặc null nếu không nói):\n" +
            "- 'hôm nay' = hôm nay. 'ngày mai' = +1 ngày. 'hôm qua' = -1 ngày. 'ngày kia' = +2 ngày.\n" +
            "- 'thứ Hai/Ba/Tư/Năm/Sáu/Bảy' hoặc 'Chủ Nhật' (không kèm 'tuần sau') = ngày đó GẦN NHẤT SẮP TỚI (>= hôm nay). Nếu hôm nay đúng thứ đó và câu ám chỉ sắp tới, dùng hôm nay; nếu đã qua giờ ám chỉ, dùng +7 ngày.\n" +
            "- 'thứ ... tuần sau' hoặc 'thứ ... tuần tới' = ngày đó của TUẦN KẾ TIẾP (tuần bắt đầu Thứ Hai). Không phải lần gần nhất sắp tới.\n" +
            "- 'tuần sau' không có thứ = cùng thứ, +7 ngày.\n" +
            "- 'đầu tháng sau' = ngày 1 tháng kế tiếp. 'cuối tuần' = Thứ Bảy gần nhất sắp tới.\n" +
            "- Ngày dạng số 'ngày 15', '15/8' → suy ra năm sao cho >= hôm nay khi có thể.\n" +
            "\n" +
            "QUY TẮC GIỜ (explicitStart / explicitEnd = 'HH:mm' 24h hoặc null):\n" +
            "- Giờ cụ thể ('3 giờ chiều' = 15:00, '9h sáng' = 09:00, '10 giờ tối' = 22:00) → explicitStart.\n" +
            "- Khoảng giờ ('20-23h', 'từ 9 tới 10 giờ', '14h đến 15h30') → explicitStart + explicitEnd. Trong trường hợp này KHÔNG tự đặt durationMin, giữ = 30.\n" +
            "- 'buổi sáng' → explicitStart='09:00' (mặc định trước 11h).\n" +
            "- 'buổi trưa' → explicitStart='12:00'.\n" +
            "- 'buổi chiều' → explicitStart='14:00' (13–16h).\n" +
            "- 'buổi tối' → explicitStart='19:00'.\n" +
            "- 'sau bữa trưa' → explicitStart='13:00' (sau 12h trưa).\n" +
            "- 'sáng sớm' → '07:00'. 'khuya' → '22:00'.\n" +
            "- Nếu chỉ nói mốc mờ ('sáng', 'chiều', 'tối') mà không có giờ cụ thể, dùng mặc định ở trên nhưng KHÔNG đặt explicitEnd.\n" +
            "\n" +
            "QUY TẮC THỜI LƯỢNG (durationMin = số phút, mặc định 30):\n" +
            "- '30 phút' = 30. 'một tiếng' / '1 tiếng' / '1 giờ' = 60. 'nửa tiếng' = 30. '90 phút' = 90. '1 tiếng rưỡi' = 90. '2 tiếng' = 120.\n" +
            "- Nếu đã có explicitStart + explicitEnd thì giữ durationMin=30 (client sẽ tự tính lại từ start/end).\n" +
            "\n" +
            "QUY TẮC MÔ TẢ (description):\n" +
            "- title là tên việc ngắn gọn (3–8 từ). Nếu người dùng nói thêm chi tiết/ngữ cảnh (địa điểm, người tham gia, mục đích, ghi chú), đưa vào description (tối đa ~200 ký tự). Không lặp lại title.\n" +
            "- Nếu không có chi tiết gì thêm, description = null.\n" +
            "\n" +
            "Chỉ trả JSON, không giải thích. Nếu chỉ 1 việc → mảng 1 phần tử.",
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
        const end =
          typeof o.explicitEnd === "string" && /^\d{1,2}:\d{2}$/.test(o.explicitEnd)
            ? o.explicitEnd
            : undefined;
        const date =
          typeof o.explicitDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(o.explicitDate)
            ? o.explicitDate
            : undefined;
        const desc =
          typeof o.description === "string" && o.description.trim().length > 0
            ? o.description.trim().slice(0, 500)
            : undefined;
        return {
          title,
          durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 30,
          explicitStart: start,
          explicitEnd: end,
          explicitDate: date,
          description: desc,
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
    await requireUnlocked();
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
  title: z.string().min(1).max(300),
  startISO: z.string().min(1).max(64),
  endISO: z.string().min(1).max(64),
  description: z.string().max(2000).optional(),
  reminderMin: z.number().int().nullable().optional(),
  addMeet: z.boolean().optional(),
});

export const createEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data }) => {
    await requireUnlocked();
    const body: Record<string, unknown> = {
      summary: data.title,
      start: { dateTime: data.startISO, timeZone: TZ },
      end: { dateTime: data.endISO, timeZone: TZ },
    };
    if (data.description) body.description = data.description;
    if (data.reminderMin === null) {
      body.reminders = { useDefault: false, overrides: [] };
    } else if (typeof data.reminderMin === "number") {
      body.reminders = {
        useDefault: false,
        overrides: [{ method: "popup", minutes: data.reminderMin }],
      };
    }
    if (data.addMeet) {
      body.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }
    const url = new URL(`${GCAL_BASE}/calendars/primary/events`);
    if (data.addMeet) url.searchParams.set("conferenceDataVersion", "1");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: gcalHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Tạo event lỗi ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
        createRequest?: { status?: { statusCode?: string } };
      };
    };
    const videoEntry = json.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video" && !!e.uri,
    );
    const meetLink = videoEntry?.uri ?? json.hangoutLink ?? null;
    const meetStatus = json.conferenceData?.createRequest?.status?.statusCode ?? null;
    return {
      id: json.id ?? null,
      htmlLink: json.htmlLink ?? null,
      meetLink,
      meetStatus,
    };
  });