import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";

type GateSession = { unlocked?: boolean };

function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET chưa được cấu hình");
  return {
    password,
    name: "tempo-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function requireUnlockedImpl() {
  const session = await useSession<GateSession>(sessionConfig());
  if (!session.data.unlocked) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export async function isUnlockedImpl() {
  const session = await useSession<GateSession>(sessionConfig());
  return { unlocked: !!session.data.unlocked };
}

export async function unlockImpl(password: string) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("SITE_PASSWORD chưa được cấu hình");
  if (!passwordMatches(password, expected)) return { ok: false as const };
  const session = await useSession<GateSession>(sessionConfig());
  await session.update({ unlocked: true });
  return { ok: true as const };
}

export async function lockImpl() {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
}
