"use client";

/**
 * Sign-out button for the shared header.
 *
 * Lives here and not in the theme package because the logout endpoint is this
 * application's, not the brand's: closing the SecretDrop session does not close
 * the sessions of the other services.
 */
export function SignOut({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--kc-text-2)" }}>
      <span className="hidden max-w-[16ch] truncate sm:inline" title={email}>
        {email}
      </span>
      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/";
        }}
        className="rounded-lg border px-2.5 py-1.5 transition-colors"
        style={{ borderColor: "var(--kc-line)", color: "var(--kc-text-1)" }}
      >
        Sign out
      </button>
    </div>
  );
}
