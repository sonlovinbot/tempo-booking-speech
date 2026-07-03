import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RedirectInput = z.object({ redirectUri: z.string().min(1).max(500) });

export const getGoogleAuthUrl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RedirectInput.parse(d))
  .handler(async ({ data }) => {
    const { buildAuthUrl } = await import("./google.server");
    return { url: buildAuthUrl(data.redirectUri) };
  });

export const connectGoogle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({ code: z.string().min(1).max(2000), redirectUri: z.string().min(1).max(500) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { exchangeCode } = await import("./google.server");
    await exchangeCode(data.code, data.redirectUri);
    return { ok: true as const };
  });

export const googleStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { isConnected } = await import("./google.server");
  return { connected: await isConnected() };
});

export const disconnectGoogle = createServerFn({ method: "POST" }).handler(async () => {
  const { disconnect } = await import("./google.server");
  await disconnect();
  return { ok: true as const };
});
