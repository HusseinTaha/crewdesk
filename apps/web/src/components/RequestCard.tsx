import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { Agent, HubEvent, PermissionPayload, QuestionItem } from "@crewdesk/shared/types";
import { api, ApiError } from "../lib/api";
import { EVENT_LABEL, timeAgo } from "../lib/format";

export interface RequestCardHandle {
  allow(): void;
  deny(): void;
  focusResponse(): void;
}

interface Props {
  event: HubEvent;
  agent: Agent | undefined;
  selected: boolean;
  onSelect(): void;
}

const ACCENT: Record<string, string> = {
  "permission.created": "border-st-purple",
  "question.created": "border-st-orange",
  "prompt.created": "border-st-yellow",
  "task.failed": "border-st-red",
  "notification.created": "border-st-blue",
};

const TAG: Record<string, string> = {
  "permission.created": "bg-st-purple/15 text-st-purple",
  "question.created": "bg-st-orange/15 text-st-orange",
  "prompt.created": "bg-st-yellow/15 text-st-yellow",
  "task.failed": "bg-st-red/15 text-st-red",
  "notification.created": "bg-st-blue/15 text-st-blue",
};

const btn = "rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

export const RequestCard = forwardRef<RequestCardHandle, Props>(function RequestCard({ event, agent, selected, onSelect }, ref) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const textRef = useRef<HTMLTextAreaElement>(null);

  const isPermission = event.type === "permission.created";
  const isQuestion = event.type === "question.created";
  const isPrompt = event.type === "prompt.created";
  const perm = (isPermission ? event.payload : null) as PermissionPayload | null;
  const questions = ((isQuestion ? event.payload?.questions : null) ?? []) as QuestionItem[];

  async function send(body: Parameters<typeof api.respond>[1]) {
    setBusy(true);
    setError(null);
    try {
      await api.respond(event.id, { sessionId: event.sessionId, ...body });
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFIRMATION_REQUIRED") setConfirming(true);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  const allow = () => {
    if (!isPermission || busy) return;
    if (perm?.destructive && !confirming) {
      setConfirming(true);
      return;
    }
    void send({ action: "allow", confirm: perm?.destructive ? true : undefined });
  };
  const deny = () => {
    if (!isPermission || busy) return;
    void send({ action: "deny", response: text.trim() || undefined });
  };

  useImperativeHandle(ref, () => ({
    allow,
    deny,
    focusResponse: () => textRef.current?.focus(),
  }));

  const answerOption = (q: QuestionItem, label: string) => {
    if (q.multiSelect) {
      setPicked((p) => {
        const cur = p[q.question] ?? [];
        return { ...p, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      });
      return;
    }
    if (questions.length === 1) {
      void send({ action: "answer", answers: { [q.question]: label } });
      return;
    }
    setPicked((p) => ({ ...p, [q.question]: [label] }));
  };

  const submitAnswers = () => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const sel = picked[q.question];
      if (sel?.length) answers[q.question] = sel.join(", ");
      else if (text.trim()) answers[q.question] = text.trim();
    }
    if (!Object.keys(answers).length && !text.trim()) return;
    void send({ action: "answer", answers, response: text.trim() || undefined });
  };

  const onTextKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (isPrompt && text.trim()) void send({ action: "prompt", response: text.trim() });
      else if (isQuestion) submitAnswers();
    }
    if (e.key === "Escape") (e.target as HTMLElement).blur();
  };

  return (
    <article
      data-testid="request-card"
      data-event-id={event.id}
      data-type={event.type}
      onClick={onSelect}
      className={`min-w-0 rounded-xl border border-line bg-card p-4 shadow-sm border-l-4 ${ACCENT[event.type] ?? "border-line"} ${
        selected ? "ring-2 ring-st-blue/60" : ""
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TAG[event.type] ?? ""}`}>
          {EVENT_LABEL[event.type]}
        </span>
        {event.priority === "CRITICAL" && <span className="rounded bg-st-red/15 px-2 py-0.5 text-xs font-semibold text-st-red">CRITICAL</span>}
        <span className="font-semibold">{agent?.name ?? event.sessionId}</span>
        <span className="text-muted">· {agent?.projectName ?? "unknown"}</span>
        {agent?.account && <span className="text-muted">· {agent.account}</span>}
        <span className="ml-auto text-xs text-muted" title={event.createdAt}>
          {timeAgo(event.createdAt)}
        </span>
      </header>

      {isPermission && perm && (
        <div className="space-y-2">
          <div className="text-sm text-muted">
            Wants to use <span className="font-mono text-fg">{perm.toolName}</span>:
          </div>
          <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-card-2 p-3 font-mono text-sm">
            {perm.summary || JSON.stringify(perm.toolInput, null, 2)}
          </pre>
          {perm.cwd && (
            <div className="text-xs text-muted">
              Directory: <span className="font-mono">{perm.cwd}</span>
            </div>
          )}
          {perm.destructive && (
            <div className="rounded-md bg-st-red/10 px-3 py-2 text-sm text-st-red">⚠ {perm.destructiveReason ?? "This operation may delete files."}</div>
          )}
        </div>
      )}

      {isQuestion && (
        <div className="space-y-4">
          {questions.map((q) => (
            <div key={q.question}>
              <div className="mb-2 font-medium">
                {q.header && <span className="mr-2 text-xs uppercase text-muted">{q.header}</span>}
                {q.question}
              </div>
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => {
                  const on = picked[q.question]?.includes(o.label);
                  return (
                    <button
                      key={o.label}
                      disabled={busy}
                      title={o.description}
                      onClick={(e) => {
                        e.stopPropagation();
                        answerOption(q, o.label);
                      }}
                      className={`${btn} max-w-full text-left border ${on ? "border-st-orange bg-st-orange/20" : "border-line bg-card-2 hover:border-st-orange"}`}
                    >
                      {o.label}
                      {o.description && <span className="ml-2 hidden text-xs text-muted lg:inline">{o.description}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {isPrompt && (
        <div className="space-y-2">
          <div className="text-sm text-muted">Claude finished its turn:</div>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-card-2 p-3 text-sm">{event.message}</div>
        </div>
      )}

      {!isPermission && !isQuestion && !isPrompt && <div className="whitespace-pre-wrap text-sm">{event.message}</div>}

      {(isQuestion || isPrompt || isPermission) && (
        <textarea
          ref={textRef}
          data-testid="response-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onTextKey}
          onClick={(e) => e.stopPropagation()}
          rows={isPermission ? 1 : 2}
          placeholder={
            isPermission ? "Optional reason (sent with Deny)…" : isPrompt ? "Next instruction for Claude… (Ctrl+Enter to send)" : "Custom answer… (Ctrl+Enter to send)"
          }
          className="mt-3 w-full resize-y rounded-md border border-line bg-card-2 p-2 text-sm placeholder:text-muted focus:border-st-blue focus:outline-none"
        />
      )}

      {error && <div className="mt-2 text-sm text-st-red">{error}</div>}

      <footer className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isPermission && !confirming && (
          <>
            <button disabled={busy} onClick={allow} className={`${btn} bg-st-green text-white hover:bg-st-green/85`}>
              Allow <kbd className="ml-1 text-xs opacity-70">A</kbd>
            </button>
            <button disabled={busy} onClick={deny} className={`${btn} bg-st-red text-white hover:bg-st-red/85`}>
              Deny <kbd className="ml-1 text-xs opacity-70">D</kbd>
            </button>
          </>
        )}
        {isPermission && confirming && (
          <>
            <span className="text-sm text-st-red">This operation may delete files.</span>
            <button disabled={busy} onClick={allow} className={`${btn} bg-st-red text-white`}>
              Confirm Allow
            </button>
            <button disabled={busy} onClick={() => setConfirming(false)} className={`${btn} border border-line`}>
              Back
            </button>
          </>
        )}
        {isQuestion && (
          <>
            <button disabled={busy} onClick={submitAnswers} className={`${btn} bg-st-orange text-white hover:bg-st-orange/85`}>
              Send Answer
            </button>
            <button
              disabled={busy}
              onClick={() => void send({ action: "dismiss" })}
              className={`${btn} border border-line text-muted hover:text-fg`}
              title="Let Claude show this question in its terminal instead"
            >
              Answer in terminal
            </button>
          </>
        )}
        {isPrompt && (
          <>
            <button
              disabled={busy || !text.trim()}
              onClick={() => void send({ action: "prompt", response: text.trim() })}
              className={`${btn} bg-st-yellow text-black hover:bg-st-yellow/85`}
            >
              Send
            </button>
            <button
              disabled={busy}
              onClick={() => void send({ action: "dismiss" })}
              className={`${btn} border border-line text-muted hover:text-fg`}
              title="Stop waiting and return control to the terminal"
            >
              Back to terminal
            </button>
          </>
        )}
        {!isPermission && !isQuestion && !isPrompt && (
          <button disabled={busy} onClick={() => void send({ action: "dismiss" })} className={`${btn} border border-line`}>
            Dismiss
          </button>
        )}
        {isPermission && <span className="ml-auto text-xs text-muted">Also answerable in the terminal — first answer wins.</span>}
      </footer>
    </article>
  );
});
