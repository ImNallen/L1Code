// The family control on a font row: a button showing the current family in that family, opening a
// searchable list of installed families, each drawn in its own font. The list renders only the rows
// in view, so hundreds of faces stay cheap. Without the Rust list (a plain browser) a text field
// takes a family name instead.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { rust, type FontFamily } from "@/core/ipc";
import { createStore, useStore } from "@/core/store";
import { defaultFace, familyCss, fontStack, fontSurfaces, type FontSurface } from "./fonts";
import { setSetting, settingsState, useSetting } from "./store";

type FontList = { readonly status: "idle" | "loading" | "failed" } | { readonly status: "ready"; readonly families: readonly FontFamily[] };

const fontList = createStore<FontList>({ status: "idle" });
const isMac = navigator.platform.toLowerCase().includes("mac");

/** Asks Rust for the installed families once per window. */
export function loadFonts(): void {
  if (fontList.get().status !== "idle") return;
  fontList.set({ status: "loading" });
  rust.fontsList().then(
    (families) => fontList.set({ status: "ready", families }),
    () => fontList.set({ status: "failed" }),
  );
}

const ROW = 28;
const LIST_H = ROW * 10;
const OVERSCAN = 6;

interface Item {
  readonly value: string;
  readonly name: string;
  readonly font: string;
}

interface Props {
  readonly surface: FontSurface;
  readonly id: string;
  readonly labelledBy: string;
  readonly describedBy: string;
}

export default function FontPicker(props: Props) {
  const list = useStore(fontList);
  const def = fontSurfaces[props.surface];
  const defaultStack = useStore(settingsState, def.fallback);
  const installed = list.status === "ready" ? list.families : null;
  const face = (installed && defaultFace(defaultStack, new Set(installed.map((f) => f.name)), isMac)) ?? "Default";
  if (list.status === "failed") return <FamilyInput {...props} placeholder={face} />;
  return <FamilyList {...props} families={installed} face={face} defaultStack={defaultStack} />;
}

function FamilyList({
  surface,
  id,
  labelledBy,
  describedBy,
  families,
  face,
  defaultStack,
}: Props & { families: readonly FontFamily[] | null; face: string; defaultStack: string }) {
  const def = fontSurfaces[surface];
  const family = useSetting(def.family);
  const stack = useStore(settingsState, (s) => fontStack(surface, s));
  const [open, setOpen] = useState<{ query: string; up: boolean } | null>(null);
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const listId = useId();

  const query = open?.query.trim().toLowerCase() ?? "";
  const items: Item[] = [
    ...(query ? [] : [{ value: "", name: face, font: defaultStack }]),
    ...(families ?? [])
      .filter((f) => (!def.mono || f.mono) && f.name.toLowerCase().includes(query))
      .map((f) => ({ value: f.name, name: f.name, font: `${familyCss(f.name)}, var(--font-ui)` })),
  ];

  const show = (q: string) => {
    const r = trigger.current!.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    setOpen({ query: q, up: below < LIST_H + 60 && r.top > below });
    const i = q ? 0 : Math.max(0, items.findIndex((it) => it.value === family));
    setActive(i);
    setScrollTop(Math.max(0, i * ROW - LIST_H / 2));
  };
  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) trigger.current?.focus();
  };
  const pick = (item: Item | undefined) => {
    if (item) setSetting(def.family, item.value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => wrap.current?.contains(e.target as Node) || setOpen(null);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (listEl.current && listEl.current.scrollTop !== scrollTop) listEl.current.scrollTop = scrollTop;
  }, [scrollTop, open]);

  const moveTo = (i: number) => {
    const next = Math.max(0, Math.min(i, items.length - 1));
    setActive(next);
    setScrollTop((top) => Math.min(Math.max(top, (next + 1) * ROW - LIST_H), next * ROW));
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 9, PageUp: -9 }[e.key];
    if (step) {
      e.preventDefault();
      moveTo(active + step);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveTo(e.key === "Home" ? 0 : items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show("");
    } else if (e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      show(e.key);
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + LIST_H) / ROW) + OVERSCAN);
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <div className="font-picker" ref={wrap}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="font-trigger"
        aria-haspopup="listbox"
        aria-expanded={!!open}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        style={{ fontFamily: stack }}
        onClick={() => (open ? close(false) : show(""))}
        onKeyDown={onTriggerKey}
      >
        <span>{family || face}</span>
        {!family && <small>Default</small>}
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="font-popover" data-up={open.up || undefined}>
          <input
            autoFocus
            className="input"
            role="combobox"
            aria-label="Search fonts"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={items[active] ? optionId(active) : undefined}
            placeholder="Search fonts…"
            spellCheck={false}
            value={open.query}
            onChange={(e) => {
              setOpen({ ...open, query: e.target.value });
              setActive(0);
              setScrollTop(0);
            }}
            onKeyDown={onSearchKey}
          />
          <div
            ref={listEl}
            id={listId}
            role="listbox"
            aria-label="Fonts"
            className="font-list"
            style={{ height: Math.min(LIST_H, items.length * ROW) }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: items.length * ROW }}>
              {items.slice(first, last).map((item, k) => {
                const i = first + k;
                return (
                  <div
                    key={item.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    className="font-option"
                    data-active={i === active || undefined}
                    style={{ top: i * ROW, height: ROW }}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(item);
                    }}
                  >
                    <span style={{ fontFamily: item.font }}>{item.name}</span>
                    {!item.value && <small>Default</small>}
                    {item.value === family && <Check aria-hidden />}
                  </div>
                );
              })}
            </div>
          </div>
          {!families ? <div className="font-empty">Loading fonts…</div> : !items.length && <div className="font-empty">No matching fonts</div>}
        </div>
      )}
    </div>
  );
}

/** A family typed by name, for when the installed list can't be read. Commits on Enter or blur. */
function FamilyInput({ surface, id, labelledBy, describedBy, placeholder }: Props & { placeholder: string }) {
  const def = fontSurfaces[surface];
  const family = useSetting(def.family);
  const commit = (el: HTMLInputElement) => setSetting(def.family, el.value.trim());
  return (
    <input
      key={family}
      id={id}
      className="input font-input"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      defaultValue={family}
      placeholder={placeholder}
      maxLength={200}
      spellCheck={false}
      autoComplete="off"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget);
        else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.value = family;
        }
      }}
    />
  );
}
