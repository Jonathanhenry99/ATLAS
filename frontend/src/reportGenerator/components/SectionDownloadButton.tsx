import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { downloadSectionPNG } from '../utils/exportImage';

// A piece of the card that can be downloaded on its own, found inside the
// card by `selector`; `name` goes into the file name.
export interface SectionPart {
  label: string;
  name: string;
  selector: string;
}

interface FoundPart {
  label: string;
  name: string;
  el: HTMLElement;
}

// The box a chart is drawn in, legend included (a donut's sits beside it).
const CHART_BOX = '.donut, .chartbox, .gads-line-wrap, .prs-chart-box';

// Shown within the card — the card itself may be hidden (an inactive
// section in the workspace), so the page's own layout cannot tell.
function shownIn(el: HTMLElement, block: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== block; n = n.parentElement) {
    if (n.hidden || getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

// Several of a kind are numbered: "Grafik 1", "Grafik 2"; one alone is "… saja".
function named(els: HTMLElement[], word: string): FoundPart[] {
  return els.map((el, i) => (els.length === 1 ? { label: `${word} saja`, name: word, el } : { label: `${word} ${i + 1}`, name: `${word} ${i + 1}`, el }));
}

// What the card holds that can stand alone as an image, read off the card
// itself so every section gets its own choices without listing them: its
// tables, its charts, its root cause tree. `extra` adds pieces a section
// names itself.
function findParts(block: HTMLElement, extra?: SectionPart[]): FoundPart[] {
  const own = (el: HTMLElement) => el.closest('.sec-block') === block && shownIn(el, block);
  const tables = Array.from(block.querySelectorAll<HTMLElement>('table')).filter((t) => own(t) && !t.parentElement?.closest('table'));
  const charts = Array.from(new Set(
    Array.from(block.querySelectorAll<HTMLCanvasElement>('canvas'))
      .filter(own)
      .map((c) => c.closest<HTMLElement>(CHART_BOX) ?? c.parentElement ?? c),
  ));
  const roots = Array.from(block.querySelectorAll<HTMLElement>('.sympt-panel')).filter(own);
  const parts = [...named(tables, 'Tabel'), ...named(charts, 'Grafik'), ...named(roots, 'Root Cause')];
  for (const p of extra ?? []) {
    const el = block.querySelector<HTMLElement>(p.selector);
    if (el && own(el) && !parts.some((f) => f.el === el || f.name === p.name)) parts.push({ label: p.label, name: p.name, el });
  }
  return parts;
}

// Ported from the original attachSectionDownloadButtons: a small "PNG"
// button appended to every .sec-heading, downloading just that card as an
// image. Finds its own .sec-block ancestor, same as the original's
// `btn.closest('.sec-block')` — no ref plumbing needed.
// When the card holds a table, a chart or a root cause, the button opens a
// short menu instead: the whole card, or one of those pieces alone.
export function SectionDownloadButton({ parts }: { parts?: SectionPart[] }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const [found, setFound] = useState<FoundPart[]>([]);

  // Re-read whenever the card's content changes (data arrives, a lane or
  // view switch swaps the table for a chart).
  useLayoutEffect(() => {
    const block = wrap.current?.closest<HTMLElement>('.sec-block');
    if (!block) return undefined;
    const read = () => {
      const next = findParts(block, parts);
      setFound((prev) => (prev.length === next.length && prev.every((p, i) => p.el === next[i].el && p.label === next[i].label) ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(block, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    return () => mo.disconnect();
  }, [parts]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function download(from: HTMLElement, part?: FoundPart) {
    const block = from.closest('.sec-block') as HTMLElement | null;
    if (!block) return;
    if (part && !block.contains(part.el)) return;
    setOpen(false);
    setBusy(true);
    try {
      await downloadSectionPNG(block, part ? { el: part.el, name: part.name } : undefined);
    } finally {
      setBusy(false);
    }
  }

  const icon = busy ? <Loader2 size={12} className="rg-spin" aria-hidden /> : <Download size={12} aria-hidden />;

  if (!found.length) {
    return (
      <span className="sec-download-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="sec-download-btn"
        title="Download PNG"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          download(e.currentTarget);
        }}
      >
        {icon} PNG
      </button>
      </span>
    );
  }

  return (
    <span className="sec-download-menu-wrap" ref={wrap} data-feature="section-png-parts">
      <button
        type="button"
        className="sec-download-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          const block = e.currentTarget.closest<HTMLElement>('.sec-block');
          if (block && !open) setFound(findParts(block, parts));
          setOpen((v) => !v);
        }}
      >
        {icon} PNG <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <span className="sec-download-menu" role="menu">
          <button type="button" role="menuitem" onClick={(e) => download(e.currentTarget)}>
            Seluruh section
          </button>
          {found.map((p) => (
            <button key={p.name} type="button" role="menuitem" onClick={(e) => download(e.currentTarget, p)}>
              {p.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
