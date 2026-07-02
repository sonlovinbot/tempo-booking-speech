import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export async function requireUnlocked() {
  const { requireUnlockedImpl } = await import("./gate.server");
  await requireUnlockedImpl();
}

export const isUnlocked = createServerFn({ method: "GET" }).handler(async () => {
  const { isUnlockedImpl } = await import("./gate.server");
  return isUnlockedImpl();
});

export const unlockSite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ password: z.string().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { unlockImpl } = await import("./gate.server");
    return unlockImpl(data.password);
  });

export const lockSite = createServerFn({ method: "POST" }).handler(async () => {
  const { lockImpl } = await import("./gate.server");
  return lockImpl();
});
