import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import {
  Mic,
  Square,
  Check,
  X,
  Clock,
  Pencil,
  Calendar as CalIcon,
  Loader2,
  ArrowRight,
  Plus,
  Bell,
  Video,
  FileText,
} from "lucide-react";
import {
  transcribeAudio,
  parseTasks,
  listTodayEvents,
  createEvent,
  type ParsedTask,
} from "@/lib/tempo.functions";

export const Route = createFileRoute("/")({
  component: Tempo,
});

type Phase = "idle" | "recording" | "processing" | "reviewing" | "done" | "error";

type Busy = { startISO: string; endISO: string };

type ReviewTask = {
  title: string;
  durationMin: number;
  startISO: string; // computed
  endISO: string;
  explicit: boolean;
  description: string;
  reminderMin: number | null; // null = tắt
  addMeet: boolean;
  meetLink?: string | null;
};

const TZ = "Asia/Ho_Chi_Minh";

// ---------- WAV encode (16 kHz mono PCM16) ----------

function floatToPCM16(input: Float32Array) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function downsampleTo16k(buffer: Float32Array, inputRate: number) {
  const target = 16000;
  if (inputRate === target) return buffer;
  const ratio = inputRate / target;
  const newLen = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offset = 0;
  for (let i = 0; i < newLen; i++) {
    const nextOffset = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = offset; j < nextOffset && j < buffer.length; j++) {
      sum += buffer[j];
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
    offset = nextOffset;
  }
  return result;
}

function encodeWAV(samples: Int16Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, samples[i], true);
  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------- Slot allocation ----------

function saigonTodayDateStr() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoFromSaigonHM(dateStr: string, hhmm: string) {
  return new Date(`${dateStr}T${hhmm}:00+07:00`).toISOString();
}

function findSlot(
  busy: Busy[],
  cursorISO: string,
  durationMin: number,
  dayEndISO: string,
): string {
  // Find earliest start >= cursor where [start, start+dur) doesn't overlap any busy.
  const durMs = durationMin * 60_000;
  const sorted = [...busy].sort(
    (a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime(),
  );
  let start = new Date(cursorISO).getTime();
  const endLimit = new Date(dayEndISO).getTime();
  for (const b of sorted) {
    const bs = new Date(b.startISO).getTime();
    const be = new Date(b.endISO).getTime();
    if (start + durMs <= bs) return new Date(start).toISOString();
    if (be > start) start = be;
  }
  if (start + durMs > endLimit) start = endLimit - durMs;
  return new Date(start).toISOString();
}

function fmtHM(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function saigonDateStrOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function fmtDateLabel(iso: string) {
  const dateStr = saigonDateStrOf(iso);
  const today = saigonTodayDateStr();
  const tomorrow = (() => {
    const d = new Date(`${today}T00:00:00+07:00`);
    d.setDate(d.getDate() + 1);
    return saigonDateStrOf(d.toISOString());
  })();
  const yesterday = (() => {
    const d = new Date(`${today}T00:00:00+07:00`);
    d.setDate(d.getDate() - 1);
    return saigonDateStrOf(d.toISOString());
  })();
  if (dateStr === today) return "Hôm nay";
  if (dateStr === tomorrow) return "Ngày mai";
  if (dateStr === yesterday) return "Hôm qua";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

// ---------- Component ----------

function Tempo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(new Array(24).fill(0.08));
  const [processStep, setProcessStep] = useState<
    "listening" | "parsing" | "planning"
  >("listening");

  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [index, setIndex] = useState(0);
  const [addedCount, setAddedCount] = useState(0);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [lastMeet, setLastMeet] = useState<string | null>(null);

  const transcribeFn = useServerFn(transcribeAudio);
  const parseFn = useServerFn(parseTasks);
  const listFn = useServerFn(listTodayEvents);
  const createFn = useServerFn(createEvent);

  // Recording refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => undefined);
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
  }, []);

  useEffect(() => cleanupAudio, [cleanupAudio]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AC =
        (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext) as typeof AudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(ch));
      };
      source.connect(analyser);
      source.connect(processor);
      processor.connect(ctx.destination);

      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const bars: number[] = [];
        const step = Math.floor(buf.length / 24);
        for (let i = 0; i < 24; i++) {
          let s = 0;
          for (let j = 0; j < step; j++) s += buf[i * step + j];
          bars.push(Math.max(0.08, Math.min(1, s / step / 180)));
        }
        setLevels(bars);
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Không truy cập được micro";
      setError(`Không thể ghi âm: ${msg}`);
      setPhase("error");
    }
  }, []);

  const stopAndSubmit = useCallback(async () => {
    const ctx = audioCtxRef.current;
    const chunks = chunksRef.current;
    if (!ctx || chunks.length === 0) {
      cleanupAudio();
      setPhase("idle");
      return;
    }
    const sampleRate = ctx.sampleRate;
    // Concat float32 chunks
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      merged.set(c, o);
      o += c.length;
    }
    cleanupAudio();

    if (merged.length < sampleRate * 0.4) {
      setError("Ghi âm quá ngắn — hãy thử lại và nói rõ hơn.");
      setPhase("error");
      return;
    }

    setPhase("processing");
    setProcessStep("listening");

    try {
      const down = downsampleTo16k(merged, sampleRate);
      const pcm = floatToPCM16(down);
      const wav = encodeWAV(pcm, 16000);
      const b64 = await blobToBase64(wav);

      const { text } = await transcribeFn({
        data: { audioBase64: b64, mime: "audio/wav" },
      });
      if (!text) {
        setError("Không nghe ra nội dung. Hãy thử lại.");
        setPhase("error");
        return;
      }

      setProcessStep("parsing");
      const [{ tasks: parsed }, { busy }] = await Promise.all([
        parseFn({ data: { transcript: text } }),
        listFn(),
      ]);

      if (parsed.length === 0) {
        setError("Không tìm thấy công việc nào trong lời nói. Hãy thử lại.");
        setPhase("error");
        return;
      }

      setProcessStep("planning");
      const today = saigonTodayDateStr();
      const nowISO = new Date().toISOString();
      const busyList = [...busy];
      let cursor = nowISO;

      const review: ReviewTask[] = parsed.map((t: ParsedTask) => {
        const dateStr = t.explicitDate ?? today;
        const isToday = dateStr === today;
        const dayEndISO = new Date(`${dateStr}T23:59:00+07:00`).toISOString();
        let startISO: string;
        let explicit = false;
        let durationMin = t.durationMin;
        if (t.explicitStart) {
          startISO = isoFromSaigonHM(dateStr, t.explicitStart);
          explicit = true;
        } else if (isToday) {
          startISO = findSlot(busyList, cursor, durationMin, dayEndISO);
        } else {
          // Ngày khác: không có busy list → mặc định 09:00 ngày đó.
          startISO = isoFromSaigonHM(dateStr, "09:00");
        }
        let endISO: string;
        if (t.explicitEnd) {
          endISO = isoFromSaigonHM(dateStr, t.explicitEnd);
          // Nếu end <= start, đẩy end sang qua ngày không hợp lý → fallback dùng durationMin.
          if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
            endISO = new Date(
              new Date(startISO).getTime() + durationMin * 60_000,
            ).toISOString();
          } else {
            durationMin = Math.round(
              (new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000,
            );
          }
        } else {
          endISO = new Date(
            new Date(startISO).getTime() + durationMin * 60_000,
          ).toISOString();
        }
        // Reserve so subsequent auto-scheduled tasks (cùng ngày hôm nay) không chồng
        if (isToday) {
          busyList.push({ startISO, endISO });
          cursor = endISO;
        }
        return {
          title: t.title,
          durationMin,
          startISO,
          endISO,
          explicit,
          description: t.description ?? "",
          reminderMin: 30,
          addMeet: false,
        };
      });

      setTasks(review);
      setIndex(0);
      setAddedCount(0);
      setLastLink(null);
      setLastMeet(null);
      setPhase("reviewing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi xảy ra";
      setError(msg);
      setPhase("error");
    }
  }, [transcribeFn, parseFn, listFn, cleanupAudio]);

  const current = tasks[index];

  const nextOrDone = useCallback(() => {
    if (index + 1 >= tasks.length) setPhase("done");
    else setIndex((i) => i + 1);
  }, [index, tasks.length]);

  const skip = useCallback(() => nextOrDone(), [nextOrDone]);

  const approve = useCallback(async () => {
    if (!current) return;
    try {
      const res = await createFn({
        data: {
          title: current.title,
          startISO: current.startISO,
          endISO: current.endISO,
          description: current.description || undefined,
          reminderMin: current.reminderMin,
          addMeet: current.addMeet,
        },
      });
      setAddedCount((c) => c + 1);
      if (res.htmlLink) setLastLink(res.htmlLink);
      if (res.meetLink) {
        // Lưu meetLink vào task hiện tại để DoneView hiển thị.
        setTasks((prev) => {
          const copy = [...prev];
          copy[index] = { ...copy[index], meetLink: res.meetLink };
          return copy;
        });
        setLastMeet(res.meetLink);
      }
      nextOrDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Không thêm được vào Calendar";
      setError(msg);
      setPhase("error");
    }
  }, [current, createFn, nextOrDone, index]);

  const updateCurrent = (patch: Partial<ReviewTask>) => {
    setTasks((prev) => {
      const copy = [...prev];
      const cur = copy[index];
      const next = { ...cur, ...patch };
      // Nếu chỉnh startISO mà chưa chỉnh endISO: giữ nguyên thời lượng, dịch end theo start.
      if (patch.startISO && !patch.endISO) {
        next.endISO = new Date(
          new Date(next.startISO).getTime() + next.durationMin * 60_000,
        ).toISOString();
      }
      // Luôn tính lại durationMin từ start/end.
      const diff = Math.round(
        (new Date(next.endISO).getTime() - new Date(next.startISO).getTime()) /
          60_000,
      );
      next.durationMin = diff > 0 ? diff : next.durationMin;
      copy[index] = next;
      return copy;
    });
  };

  const reset = () => {
    setPhase("idle");
    setError(null);
    setTasks([]);
    setIndex(0);
    setElapsed(0);
    setAddedCount(0);
    setLastLink(null);
    setLastMeet(null);
  };

  return (
    <div className="min-h-dvh bg-background text-foreground flex justify-center">
      <div className="w-full max-w-[440px] px-6 pt-8 pb-10 flex flex-col min-h-dvh">
        <Header />

        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              {phase === "idle" && <IdleView onStart={startRecording} />}
              {phase === "recording" && (
                <RecordingView
                  elapsed={elapsed}
                  levels={levels}
                  onStop={stopAndSubmit}
                />
              )}
              {phase === "processing" && <ProcessingView step={processStep} />}
              {phase === "reviewing" && current && (
                <ReviewView
                  task={current}
                  index={index}
                  total={tasks.length}
                  onSkip={skip}
                  onApprove={approve}
                  onChange={updateCurrent}
                />
              )}
              {phase === "done" && (
                <DoneView
                  added={addedCount}
                  total={tasks.length}
                  link={lastLink}
                  meet={lastMeet}
                  onAgain={reset}
                />
              )}
              {phase === "error" && (
                <ErrorView message={error ?? "Có lỗi"} onRetry={reset} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <span className="text-primary font-semibold text-sm tracking-tight">
            T
          </span>
        </div>
        <span className="font-semibold tracking-tight text-lg">Tempo</span>
      </div>
      <span className="text-xs text-muted-foreground">Hôm nay</span>
    </header>
  );
}

function Footer() {
  return (
    <p className="text-center text-[11px] text-muted-foreground pt-8">
      Ghi âm → phân tích → thêm vào Google Calendar
    </p>
  );
}

// ---------- Views ----------

function IdleView({ onStart }: { onStart: () => void }) {
  const stagger: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  };
  return (
    <motion.div
      className="relative flex flex-col items-center text-center gap-10"
      variants={stagger}
      initial="hidden"
      animate="show"
    >
      {/* Ambient purple orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-primary/25 blur-3xl animate-orb" />
        <span
          className="absolute -bottom-24 -right-10 h-64 w-64 rounded-full bg-primary/15 blur-3xl animate-orb"
          style={{ animationDelay: "-6s" }}
        />
      </div>

      <motion.div variants={item} className="space-y-3">
        <h1 className="text-hero">
          Nói ra,<br />
          <span className="text-primary">Tempo</span> sắp xếp.
        </h1>
        <p className="text-muted-foreground text-[15px] leading-relaxed max-w-[300px] mx-auto">
          Bấm và nói việc bạn cần làm hôm nay. Tempo sẽ thêm chúng vào Google
          Calendar giúp bạn.
        </p>
      </motion.div>

      <motion.button
        variants={item}
        type="button"
        onClick={onStart}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.94 }}
        className="group relative h-40 w-40 rounded-full bg-primary text-primary-foreground purple-glow"
        aria-label="Bắt đầu ghi âm"
      >
        {/* pulsing rings */}
        <span className="absolute inset-0 rounded-full border border-primary/50 animate-ring" />
        <span
          className="absolute inset-0 rounded-full border border-primary/40 animate-ring"
          style={{ animationDelay: "-1.2s" }}
        />
        <span className="absolute inset-0 rounded-full bg-primary/40 blur-2xl -z-10 animate-pulse" />
        <Mic className="mx-auto h-14 w-14 relative" strokeWidth={1.6} />
      </motion.button>

      <motion.div variants={item} className="text-xs text-muted-foreground">
        Bấm 1 lần để bắt đầu, bấm lại để dừng
      </motion.div>
    </motion.div>
  );
}

function RecordingView({
  elapsed,
  levels,
  onStop,
}: {
  elapsed: number;
  levels: number[];
  onStop: () => void;
}) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex flex-col items-center text-center gap-10">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 text-xs text-primary">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          Đang nghe
        </div>
        <div className="text-4xl font-semibold tabular-nums tracking-tight">
          {mm}:{ss}
        </div>
      </div>

      <div className="flex items-center justify-center gap-[3px] h-24 w-full max-w-[280px]">
        {levels.map((l, i) => (
          <span
            key={i}
            className="w-[6px] rounded-full bg-primary/80 transition-[height] duration-75"
            style={{ height: `${Math.max(8, l * 96)}px` }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onStop}
        className="h-16 w-16 rounded-full bg-primary text-primary-foreground purple-glow flex items-center justify-center transition-transform active:scale-95"
        aria-label="Dừng ghi"
      >
        <Square className="h-6 w-6" fill="currentColor" strokeWidth={0} />
      </button>

      <p className="text-xs text-muted-foreground">Bấm để dừng và phân tích</p>
    </div>
  );
}

function ProcessingView({
  step,
}: {
  step: "listening" | "parsing" | "planning";
}) {
  const labels: Record<typeof step, string> = {
    listening: "Đang nghe lại…",
    parsing: "Đang hiểu nội dung…",
    planning: "Đang tìm khung giờ trống…",
  };
  return (
    <div className="flex flex-col items-center text-center gap-8">
      <div className="relative h-24 w-24">
        <span className="absolute inset-0 rounded-full bg-primary/25 blur-2xl animate-pulse" />
        <div className="relative h-full w-full rounded-full bg-card border border-primary/40 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" strokeWidth={1.8} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-lg font-medium">{labels[step]}</div>
        <p className="text-sm text-muted-foreground">Chỉ mất vài giây</p>
      </div>
      <StepDots active={step} />
    </div>
  );
}

function StepDots({ active }: { active: "listening" | "parsing" | "planning" }) {
  const order: Array<"listening" | "parsing" | "planning"> = [
    "listening",
    "parsing",
    "planning",
  ];
  return (
    <div className="flex gap-1.5">
      {order.map((s) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all ${
            s === active ? "w-8 bg-primary" : "w-1.5 bg-muted"
          }`}
        />
      ))}
    </div>
  );
}

function ReviewView({
  task,
  index,
  total,
  onSkip,
  onApprove,
  onChange,
}: {
  task: ReviewTask;
  index: number;
  total: number;
  onSkip: () => void;
  onApprove: () => void;
  onChange: (patch: Partial<ReviewTask>) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const startHM = fmtHM(task.startISO);
  const endHM = fmtHM(task.endISO);

  const durLabel = (() => {
    const m = task.durationMin;
    if (m >= 60 && m % 60 === 0) return `${m / 60} giờ`;
    if (m > 60) return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
    return `${m} phút`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-8 bg-primary" : i < index ? "w-4 bg-primary/40" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {index + 1} / {total}
        </div>
      </div>

      <div className="rounded-3xl bg-card border border-border p-6 space-y-5">
        <div className="text-xs text-muted-foreground uppercase tracking-wider">
          Xác nhận task
        </div>

        {editingTitle ? (
          <input
            autoFocus
            className="w-full bg-transparent text-2xl font-semibold leading-tight tracking-tight outline-none border-b border-primary/60 pb-1"
            value={task.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingTitle(true)}
            className="group flex items-start gap-2 text-left w-full"
          >
            <h2 className="text-2xl font-semibold leading-tight tracking-tight flex-1">
              {task.title}
            </h2>
            <Pencil className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 mt-2" />
          </button>
        )}

        <div className="h-px bg-border" />

        <div className="space-y-3">
          <Row icon={<CalIcon className="h-4 w-4" />} label="Ngày">
            <span className="text-sm text-muted-foreground capitalize">
              {fmtDateLabel(task.startISO)}
            </span>
          </Row>
          <Row icon={<Clock className="h-4 w-4" />} label="Thời gian">
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                className="bg-input rounded-lg px-2 py-1 text-sm outline-none border border-border tabular-nums"
                value={startHM}
                onChange={(e) => {
                  const dateStr = saigonDateStrOf(task.startISO);
                  onChange({
                    startISO: isoFromSaigonHM(dateStr, e.target.value),
                  });
                }}
              />
              <span className="text-muted-foreground text-sm">→</span>
              <input
                type="time"
                className="bg-input rounded-lg px-2 py-1 text-sm outline-none border border-border tabular-nums"
                value={endHM}
                onChange={(e) => {
                  const dateStr = saigonDateStrOf(task.endISO);
                  onChange({
                    endISO: isoFromSaigonHM(dateStr, e.target.value),
                  });
                }}
              />
            </div>
          </Row>
          <Row icon={<Clock className="h-4 w-4" />} label="Thời lượng">
            <span className="text-sm tabular-nums text-muted-foreground">
              {durLabel}
            </span>
          </Row>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 h-12 rounded-full border border-border text-sm font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-2"
        >
          <X className="h-4 w-4" /> Bỏ qua
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="flex-[1.4] h-12 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-2 purple-glow"
        >
          <Check className="h-4 w-4" /> Thêm vào Calendar
        </button>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function DoneView({
  added,
  total,
  link,
  meet,
  onAgain,
}: {
  added: number;
  total: number;
  link: string | null;
  meet: string | null;
  onAgain: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-8">
      <div className="relative">
        <span className="absolute inset-0 rounded-full bg-primary/30 blur-2xl" />
        <div className="relative h-24 w-24 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center">
          <Check className="h-10 w-10 text-primary" strokeWidth={2} />
        </div>
      </div>
      <div className="space-y-1">
        <h2 className="text-3xl font-semibold tracking-tight">Đã xong</h2>
        <p className="text-muted-foreground">
          {added > 0
            ? `Đã thêm ${added}/${total} task vào Google Calendar hôm nay.`
            : "Không có task nào được thêm."}
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full">
        {meet && (
          <a
            href={meet}
            target="_blank"
            rel="noreferrer"
            className="h-12 rounded-full border border-primary/50 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
          >
            <Video className="h-4 w-4" /> Mở Google Meet
          </a>
        )}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="h-12 rounded-full border border-border text-sm font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-2"
          >
            Xem trên Google Calendar <ArrowRight className="h-4 w-4" />
          </a>
        )}
        <button
          type="button"
          onClick={onAgain}
          className="h-12 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-2 purple-glow"
        >
          <Plus className="h-4 w-4" /> Ghi tiếp
        </button>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="h-20 w-20 rounded-full bg-destructive/10 border border-destructive/40 flex items-center justify-center">
        <X className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-2 max-w-[320px]">
        <h2 className="text-2xl font-semibold tracking-tight">Có gì đó lỗi</h2>
        <p className="text-sm text-muted-foreground break-words">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="h-12 px-6 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-2 purple-glow"
      >
        Thử lại
      </button>
    </div>
  );
}

// Silence unused import warning for useMemo (kept for potential future use).
void useMemo;
