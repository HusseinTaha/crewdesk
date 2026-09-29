const SHORTCUTS: Array<[string, string]> = [
  ["J", "Next request"],
  ["K", "Previous request"],
  ["Enter", "Open selected request's agent"],
  ["A", "Allow selected permission"],
  ["D", "Deny selected permission"],
  ["R", "Focus response box"],
  ["/", "Search"],
  ["Esc", "Close dialog / leave text box"],
  ["?", "Show shortcuts"],
];

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className="w-full max-w-sm rounded-xl border border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-semibold">Keyboard shortcuts</h2>
        <dl className="space-y-1.5 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex justify-between">
              <dt>
                <kbd className="rounded border border-line bg-card-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
        <button onClick={onClose} className="mt-4 w-full rounded-md border border-line py-1.5 text-sm">
          Close
        </button>
      </div>
    </div>
  );
}
