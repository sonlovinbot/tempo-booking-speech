import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { connectGoogle } from "@/lib/google.functions";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

type Phase = "working" | "done" | "error";

function AuthCallback() {
  const router = useRouter();
  const connect = useServerFn(connectGoogle);
  const [phase, setPhase] = useState<Phase>("working");
  const [message, setMessage] = useState("Đang kết nối Google Calendar…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error");
    const isPopup = !!window.opener && window.opener !== window;

    function notify(kind: "google-connected" | "google-error") {
      if (isPopup) {
        try {
          window.opener.postMessage(kind, window.location.origin);
        } catch {
          // opener khác origin — bỏ qua
        }
      }
    }

    if (oauthError || !code) {
      setPhase("error");
      setMessage("Kết nối Google bị huỷ hoặc thất bại.");
      notify("google-error");
      return;
    }

    connect({
      data: { code, redirectUri: `${window.location.origin}/auth/callback` },
    })
      .then(() => {
        setPhase("done");
        setMessage("Đã kết nối Google Calendar.");
        notify("google-connected");
        if (isPopup) {
          setTimeout(() => window.close(), 600);
        } else {
          router.navigate({ to: "/" });
        }
      })
      .catch((e: unknown) => {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "Lỗi kết nối Google.");
        notify("google-error");
      });
  }, [connect, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        {phase === "working" && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
        {phase === "done" && <CheckCircle2 className="h-6 w-6 text-primary" />}
        {phase === "error" && <XCircle className="h-6 w-6 text-destructive" />}
        <p className="text-sm text-muted-foreground">{message}</p>
        {phase === "error" && (
          <p className="text-xs text-muted-foreground">Bạn có thể đóng cửa sổ này.</p>
        )}
      </div>
    </div>
  );
}
