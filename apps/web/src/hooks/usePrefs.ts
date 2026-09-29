import { useEffect, useState } from "react";

export interface Prefs {
  sound: boolean;
  desktop: boolean;
  theme: "dark" | "light";
  groupByProject: boolean;
}

const KEY = "crewdesk.prefs";
const DEFAULTS: Prefs = { sound: true, desktop: false, theme: "dark", groupByProject: false };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked */
    }
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs]);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  return [prefs, update] as const;
}

let audioCtx: AudioContext | null = null;

/** Short two-tone chime; no asset needed. */
export function playChime(urgent = false) {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const tones = urgent ? [880, 660, 880] : [660, 880];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  } catch {
    /* audio unavailable */
  }
}

export function desktopNotify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: title, icon: "/favicon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
