/* eslint-disable react-hooks/rules-of-hooks -- useSession từ react-start/server là tiện ích server (đọc/ghi cookie), không phải React hook */
import { useSession } from "@tanstack/react-start/server";

// Server-only: OAuth với Google Calendar + lưu refresh token trong cookie phiên.
// Chỉ dùng fetch / URLSearchParams / useSession → an toàn trên Cloudflare Workers.

type GoogleSession = { refreshToken?: string };

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Sentinel để client nhận biết trạng thái "chưa kết nối" và mở modal đăng nhập.
export const GOOGLE_NOT_CONNECTED = "GOOGLE_NOT_CONNECTED";

function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET chưa được cấu hình");
  return {
    password,
    name: "tempo-google",
    maxAge: 60 * 60 * 24 * 180, // 180 ngày
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

function googleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth chưa được cấu hình (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  return { clientId, clientSecret };
}

export function buildAuthUrl(redirectUri: string): string {
  const { clientId } = googleCredentials();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<void> {
  const { clientId, clientSecret } = googleCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Google auth lỗi ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { refresh_token?: string };
  if (!json.refresh_token) {
    throw new Error("Google không trả về refresh token. Hãy thử kết nối lại.");
  }
  const session = await useSession<GoogleSession>(sessionConfig());
  await session.update({ refreshToken: json.refresh_token });
}

// Cache best-effort trong 1 isolate; isolate Workers có thể không giữ giữa các request.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const session = await useSession<GoogleSession>(sessionConfig());
  const refreshToken = session.data.refreshToken;
  if (!refreshToken) throw new Error(GOOGLE_NOT_CONNECTED);

  const { clientId, clientSecret } = googleCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // 400/401 = token bị thu hồi hoặc hết hạn (vd chế độ Testing sau 7 ngày) → xoá để mời kết nối lại.
    if (res.status === 400 || res.status === 401) {
      cachedToken = null;
      await session.clear();
      throw new Error(GOOGLE_NOT_CONNECTED);
    }
    const txt = await res.text().catch(() => "");
    throw new Error(`Google auth lỗi ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    cachedToken = null;
    await session.clear();
    throw new Error(GOOGLE_NOT_CONNECTED);
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

export async function isConnected(): Promise<boolean> {
  const session = await useSession<GoogleSession>(sessionConfig());
  return !!session.data.refreshToken;
}

export async function disconnect(): Promise<void> {
  cachedToken = null;
  const session = await useSession<GoogleSession>(sessionConfig());
  await session.clear();
}
