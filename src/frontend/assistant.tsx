import { BookmarkCheck, BookmarkPlus, Bot, ChevronRight, Copy, HelpCircle, MessageSquare, Minus, Send, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import Markdown from "react-markdown";

export interface AssistantContext {
  term: string;
  drug?: string;
  context?: string;
  mode?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface SavedInsight {
  drug?: string;
  term?: string;
  text: string;
  date?: string;
}

interface Props {
  context: AssistantContext | null;
  onContextConsumed: () => void;
}

export function AssistantPanel({ context, onContextConsumed }: Props) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [chatDrug, setChatDrug] = useState<string | undefined>();
  const [chatState, setChatState] = useState(() => {
    const key = chatKey();
    return { key, messages: loadMessages(key) };
  });
  const [pendingContext, setPendingContext] = useState<AssistantContext | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastUserTerm, setLastUserTerm] = useState("");
  const [lastSectionContext, setLastSectionContext] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const messages = chatState.messages;
  const currentKey = chatKey(chatDrug);
  const savedInsights = loadSavedInsights(savedVersion);

  useEffect(() => {
    setChatState({ key: currentKey, messages: loadMessages(currentKey) });
  }, [currentKey]);

  useEffect(() => {
    if (chatState.messages.length) {
      localStorage.setItem(chatState.key, JSON.stringify(chatState.messages));
    } else {
      localStorage.removeItem(chatState.key);
    }
  }, [chatState]);

  useEffect(() => {
    if (!context) return;
    setChatDrug(context.drug);
    setOpen(true);
    setMinimized(false);
    setPendingContext(context);
    onContextConsumed();
  }, [context]);

  useEffect(() => {
    if (!pendingContext) return;
    if (chatState.key !== chatKey(pendingContext.drug)) return;
    setPendingContext(null);
    void ask(pendingContext);
  }, [pendingContext, chatState.key]);

  async function ask(payload: AssistantContext) {
    setLoading(true);
    setLastUserTerm(payload.term);
    setLastSectionContext(payload.context || "");
    const targetKey = chatKey(payload.drug);
    const label = payload.drug ? `${payload.term} (${payload.drug})` : payload.term;
    if (payload.drug) trackDiscussedDrug(payload.drug);
    appendMessage({ role: "user", text: label }, targetKey);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json() as { explanation?: string; error?: string };
      appendMessage({ role: "assistant", text: data.explanation ?? data.error ?? "No explanation returned." }, targetKey);
    } catch {
      appendMessage({ role: "assistant", text: "The assistant is unavailable right now." }, targetKey);
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string, key: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => current === key ? "" : current), 1500);
  }

  function saveInsight(message: Message, drug?: string, term?: string) {
    const saved = loadSavedInsights();
    saved.unshift({ drug, term, text: message.text, date: new Date().toISOString() });
    localStorage.setItem("sentinel-saved-insights", JSON.stringify(saved.slice(0, 50)));
    setSavedVersion((version) => version + 1);
  }

  function deleteInsight(index: number) {
    const saved = loadSavedInsights();
    saved.splice(index, 1);
    localStorage.setItem("sentinel-saved-insights", JSON.stringify(saved));
    setSavedVersion((version) => version + 1);
  }

  function appendMessage(message: Message, key = chatState.key) {
    setChatState((current) => {
      const baseMessages = current.key === key ? current.messages : loadMessages(key);
      const updatedMessages = [...baseMessages, message];
      if (current.key !== key) {
        localStorage.setItem(key, JSON.stringify(updatedMessages));
      }
      return current.key === key ? { ...current, messages: updatedMessages } : current;
    });
  }

  function clearChat() {
    localStorage.removeItem(chatState.key);
    setChatState((current) => ({ ...current, messages: [] }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const term = input.trim();
    if (!term) return;
    setInput("");
    void ask({ term, drug: chatDrug, context: "General Sentinel assistant question" });
  }

  if (!open) {
    return (
      <button className="assistant-fab" type="button" onClick={() => setOpen(true)} aria-label="Open assistant">
        <MessageSquare size={22} />
      </button>
    );
  }

  return (
    <aside className={`assistant-panel ${minimized ? "is-minimized" : ""}`} aria-label="Sentinel assistant">
      <div className="assistant-header">
        <div>
          <Bot size={18} aria-hidden="true" />
          <span>Sentinel Assistant</span>
        </div>
        <div className="assistant-actions">
          <button className="icon-button" type="button" onClick={() => setShowSaved(!showSaved)} title="Saved insights" aria-label="Saved insights" aria-pressed={showSaved}>
            <BookmarkCheck size={16} />
          </button>
          <button className="icon-button" type="button" onClick={clearChat} title="Clear chat" aria-label="Clear chat">
            <Trash2 size={16} />
          </button>
          <button className="icon-button" type="button" onClick={() => setMinimized(!minimized)} aria-label="Minimize assistant">
            {minimized ? <ChevronRight size={16} /> : <Minus size={16} />}
          </button>
          <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
            <X size={16} />
          </button>
        </div>
      </div>
      {!minimized && (
        <>
          {showSaved ? (
            <div className="assistant-saved">
              {savedInsights.length === 0 ? (
                <div className="assistant-empty">
                  <p>No saved insights yet.</p>
                </div>
              ) : (
                savedInsights.map((insight, index) => {
                  const copyKey = `saved-${index}`;
                  return (
                    <div className="saved-insight" key={`${insight.date ?? "saved"}-${index}`}>
                      <div className="saved-meta">
                        {insight.drug && `${insight.drug} - `}
                        {insight.term && insight.term}
                        {insight.date && ` - ${new Date(insight.date).toLocaleDateString()}`}
                      </div>
                      <div className="saved-text">
                        <Markdown>{insight.text}</Markdown>
                      </div>
                      <button className="message-copy" type="button" onClick={() => copyText(insight.text, copyKey)} title={copiedKey === copyKey ? "Copied!" : "Copy"} aria-label="Copy saved insight">
                        <Copy size={14} />
                        {copiedKey === copyKey && <span className="copy-feedback">Copied!</span>}
                      </button>
                      <button className="message-delete" type="button" onClick={() => deleteInsight(index)} title="Delete" aria-label="Delete saved insight">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div className="assistant-messages">
              {messages.length === 0 && (
                <div className="assistant-empty">
                  <HelpCircle size={22} />
                  <p>Ask about a medication, monitoring parameter, contraindication, or symptom.</p>
                </div>
              )}
              {messages.map((message, index) => {
                const copyKey = `message-${index}`;
                return (
                  <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <div className="message-text">
                      <Markdown>{message.text}</Markdown>
                    </div>
                    {message.role === "assistant" && (
                      <>
                        <button className="message-copy" type="button" onClick={() => copyText(message.text, copyKey)} title={copiedKey === copyKey ? "Copied!" : "Copy"} aria-label="Copy assistant message">
                          <Copy size={14} />
                          {copiedKey === copyKey && <span className="copy-feedback">Copied!</span>}
                        </button>
                        <button className="message-save" type="button" onClick={() => saveInsight(message, chatDrug, lastUserTerm)} title="Save" aria-label="Save assistant message">
                          <BookmarkPlus size={14} />
                        </button>
                        <button className="dive-deeper" type="button" onClick={() => ask({ term: lastUserTerm, drug: chatDrug, context: lastSectionContext, mode: "deep" })}>
                          Dive Deeper →
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              {loading && <div className="message assistant">Thinking...</div>}
            </div>
          )}
          <form className="assistant-input" onSubmit={submit}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask a clinical reference question" />
            <button className="icon-button accent" type="submit" aria-label="Send">
              <Send size={17} />
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

function chatKey(drugName?: string): string {
  return `sentinel-chat-${drugName || "general"}`;
}

function loadMessages(key: string): Message[] {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as Message[] : [];
  } catch {
    return [];
  }
}

function loadSavedInsights(_version?: number): SavedInsight[] {
  try {
    const saved = localStorage.getItem("sentinel-saved-insights");
    return saved ? JSON.parse(saved) as SavedInsight[] : [];
  } catch {
    return [];
  }
}

function trackDiscussedDrug(drugName: string) {
  try {
    const recent = JSON.parse(localStorage.getItem("sentinel-recent-discussed") || "[]") as string[];
    const updated = [drugName, ...recent.filter((name) => name.toLowerCase() !== drugName.toLowerCase())].slice(0, 6);
    localStorage.setItem("sentinel-recent-discussed", JSON.stringify(updated));
  } catch {
    localStorage.setItem("sentinel-recent-discussed", JSON.stringify([drugName]));
  }
}

export function ExplainButton({ term, drug, context, onExplain }: AssistantContext & { onExplain: (context: AssistantContext) => void }) {
  return (
    <button className="explain-button" type="button" onClick={() => onExplain({ term, drug, context })} aria-label={`Explain ${term}`} title={`Explain ${term}`}>
      ?
    </button>
  );
}

export function ExplainTerm({ children, term, drug, context, onExplain }: AssistantContext & { children: React.ReactNode; onExplain: (context: AssistantContext) => void }) {
  return (
    <button className="explain-term" type="button" onClick={() => onExplain({ term, drug, context })}>
      {children}
    </button>
  );
}
