import { createFileRoute, useRouter, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "motion/react";
import { Lock, Loader2 } from "lucide-react";
import { unlockSite, isUnlocked } from "@/lib/gate.functions";

export const Route = createFileRoute("/unlock")({
  beforeLoad: async () => {
    const { unlocked } = await isUnlocked();
    if (unlocked) throw redirect({ to: "/" });
  },
  component: UnlockPage,
});

function UnlockPage() {
  const router = useRouter();
  const unlock = useServerFn(unlockSite);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(false);
    try {
      const { ok } = await unlock({ data: { password } });
      if (ok) {
        await router.invalidate();
        await router.navigate({ to: "/" });
      } else {
        setError(true);
        setPassword("");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Tempo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhập mật khẩu để tiếp tục
            </p>
          </div>
        </div>

        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="Mật khẩu"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
        />

        {error && (
          <p className="text-center text-sm text-destructive">Mật khẩu không đúng</p>
        )}

        <button
          type="submit"
          disabled={!password || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Mở khoá
        </button>
      </motion.form>
    </div>
  );
}
