"use client";

/**
 * The site's own controls. Nothing is left to the browser's default look: no native dropdown, checkbox or
 * file button appears anywhere. Each works from the keyboard and says what it is to a screen reader.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface Option<Value extends string | number> {
  value: Value;
  label: string;
  /** Shown at the right of the option, quietly: a balance, a count. */
  hint?: string;
}

/** A dropdown. Arrow keys move, Enter or Space chooses, Escape closes, typing a letter jumps to it. */
export function Choice<Value extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
  disabled,
}: {
  value: Value;
  options: Option<Value>[];
  onChange: (value: Value) => void;
  /** What the control is for, read out but not shown: the visible label sits beside it. */
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") return setOpen(false);
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setActive(Math.max(0, chosen));
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") setOpen(false);
    else if (event.key.length === 1) {
      const found = options.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (found >= 0) setActive(found);
    }
  };

  return (
    <div className="choice" ref={root}>
      <button
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(0, chosen));
          setOpen(!open);
        }}
        onKeyDown={onKey}
      >
        <span>{options[chosen]?.label ?? "Choose"}</span>
      </button>
      {open && (
        <ul role="listbox" id={listId} aria-label={label}>
          {options.map((option, index) => (
            <li
              key={String(option.value)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === chosen}
              className={index === active ? "active" : undefined}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.hint && <span className="quiet mono">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A checkbox. A real one underneath, so forms and keyboards treat it as one; the box that is seen is drawn here. */
export function Tick({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="tick">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="box" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/** A small set of choices side by side, one pressed. */
export function Segments<Value extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Choosing a file: a button of ours, with the chosen file's name beside it. */
export function FileButton({
  id,
  accept,
  onFile,
  chosen,
  children,
}: {
  id: string;
  accept: string;
  onFile: (file: File | undefined) => void;
  chosen?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="pick-file">
      <input ref={input} id={id} type="file" accept={accept} tabIndex={-1} onChange={(event) => onFile(event.target.files?.[0])} />
      <button className="btn" type="button" onClick={() => input.current?.click()}>
        {children}
      </button>
      <span className="quiet">{chosen || "No file chosen"}</span>
    </span>
  );
}
