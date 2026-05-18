import { Mail, ClipboardList } from "lucide-react";
import { useState, useEffect } from "react";
import "./style.css";

export function LoginView({ onLoginSuccess }: { onLoginSuccess?: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    // Check for error in URL from redirect
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get("error");
    if (errorParam) {
      setStatus("error");
      setErrorMessage(errorParam);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) return;

    setStatus("sending");
    setErrorMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      if (response.ok) {
        setStatus("sent");
      } else {
        const data = await response.json() as { error?: string };
        setStatus("error");
        setErrorMessage(data.error || "Failed to send magic link. Please try again.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage("Network error. Please check your connection and try again.");
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <DoseAtlasMark />
          <h1>DoseAtlas</h1>
          <p className="login-tagline">Medication knowledge mapped for nurses.</p>
        </div>

        {status === "sent" ? (
          <div className="login-success">
            <Mail size={48} className="success-icon" />
            <h2>Check your email</h2>
            <p>We sent a magic link to <strong>{email}</strong>.</p>
            <p>Click the link to sign in instantly.</p>
            <button className="button secondary" onClick={() => setStatus("idle")}>
              Try another email
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                placeholder="nurse@hospital.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "sending"}
                autoFocus
              />
            </div>

            {status === "error" && (
              <div className="error-message" role="alert">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              className="button primary full-width"
              disabled={status === "sending" || !email}
            >
              {status === "sending" ? "Sending..." : "Send Magic Link"}
            </button>
          </form>
        )}

        <div className="login-footer">
          <div className="nurse-clippy-tag">
            <ClipboardList size={16} />
            <span>with Nurse Clippy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DoseAtlasMark() {
  return (
    <svg className="brand-mark-large" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="25" y="20" width="50" height="65" rx="4" stroke="#fb7185" strokeWidth="6" strokeLinejoin="round" />
      <path d="M40 20V12C40 9.79086 41.7909 8 44 8H56C58.2091 8 60 9.79086 60 12V20" stroke="#fb7185" strokeWidth="6" strokeLinejoin="round" />
      <path d="M50 40V65" stroke="#e07d5f" strokeWidth="6" strokeLinecap="round" />
      <path d="M38 52.5H62" stroke="#e07d5f" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
