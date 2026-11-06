import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowUpRight, Check, ChevronDown, Crosshair, Flag, History, Link2, Loader2, PencilLine, Scale, X,
} from 'lucide-react';
import api from '../../api/client.js';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import { presetBrandSettings } from '../common/brandSettingsLink.js';
import {
  MONTH_LONG, MONTH_SHORT, changeFromOriginal, digits, followSales, monthLong, pct, signedPct, splitEqual, thousands,
} from './annualModel.js';
import './annualTarget.css';

// Brand Tracking › Target & Budget › Rencana tahunan — the year as a sheet,
// the way the team keeps it in a spreadsheet: the 12 months run across the
// top, the figures down the side, three blocks one above the other.
//
//   Target adjustment  the plan as it stands after every update — revenue,
//                      its share and growth, quarters and halves, the ad
//                      budget and its Cost per Revenue, daily targets. The
//                      split is edited right here: target by share (%) or
//                      amount, budget as a % of each month's target, a share
//                      of the year's budget, or an amount.
//   Realisasi          what was sold and spent, achievement against both
//                      plans, the gap and what is left to chase.
//   Target awal        the plan before the year ran (the baseline version's
//                      months, kept by the server since migration 063).
//
// The 12 months must add up exactly to the year set in Brand Setting.

const MODES_KEY = 'atlas.annualPlan.modes';
const UNIT_KEY = 'atlas.annualPlan.unit';
const SALES_MODES = [['pct', 'Kontribusi %'], ['rp', 'Nominal']];
const SPEND_MODES = [['cpr', '% dari target'], ['pct', 'Porsi %'], ['rp', 'Nominal']];
const QUARTERS = [0, 1, 2, 3];

const num2 = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const xOf = (sales, spend) => (sales && spend ? `${(sales / spend).toLocaleString('id-ID', { maximumFractionDigits: 2 })}x` : '—');
const sum = (a) => a.reduce((x, y) => x + (y ?? 0), 0);
const ratio = (a, b) => (a != null && b ? a / b : null);
const growth = (cur, prev) => (cur != null && prev ? cur / prev - 1 : null);
const daysIn = (year, i) => new Date(year, i + 1, 0).getDate();
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

// ── The split editor's units ─────────────────────────────────────────────
// pct: share of the year (0.085 = 8,5%) · rp: rupiah · cpr: budget ÷ the
// month's sales target (0.1 = 10%).
function unitsOf(mode, amounts, total, sales) {
  if (mode === 'rp') return amounts.map((v) => v ?? 0);
  if (mode === 'pct') return amounts.map((v) => (total ? (v ?? 0) / total : 0));
  return amounts.map((v, i) => (sales[i] ? (v ?? 0) / sales[i] : 0));
}
const textOf = (mode, v) => (mode === 'rp' ? String(Math.round(v)) : num2(v * 100));
function parseText(mode, text) {
  const t = String(text ?? '').trim();
  if (t === '') return 0;
  if (mode === 'rp') return Number(digits(t));
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n / 100 : null;
}
const makeSide = (mode, amounts, total, sales) => {
  const exact = unitsOf(mode, amounts, total, sales);
  return { texts: exact.map((v) => textOf(mode, v)), exact };
};
// Whole rupiah adding up exactly to `total`; the largest month takes the rounding.
function settle(raw, total) {
  const out = raw.map((v) => Math.round(v));
  const big = out.indexOf(Math.max(...out));
  out[big] += total - sum(out);
  return out;
}
// The rupiah a side gives. Shares and Cost per Revenue show and take two
// decimals, so each month can sit up to 0,005 points off what it holds:
// when they add up within that, they settle onto the year exactly. Typed
// amounts have to add up on their own. A Cost per Revenue typed as the
// year's own (as shown) counts as exactly the year's.
function resolve(mode, side, total, sales, yearRatio) {
  const vals = side.texts.map((t, i) => {
    if (side.exact[i] != null) return side.exact[i];
    if (mode === 'cpr' && yearRatio && String(t).trim() === textOf('cpr', yearRatio)) return yearRatio;
    return parseText(mode, t);
  });
  const valid = vals.every((v) => v != null);
  const raw = vals.map((v, i) => (v == null ? 0 : mode === 'pct' ? total * v : mode === 'rp' ? v : (sales[i] ?? 0) * v));
  const slack = mode === 'rp' ? 0 : mode === 'pct' ? total * 0.0006 + 12 : sum(sales) * 0.00005 + 12;
  const amounts = valid && Math.abs(sum(raw) - total) <= slack ? settle(raw, total) : raw.map((v) => Math.round(v));
  const got = sum(amounts);
  return { valid, amounts, got, ok: valid && got === total };
}

function readPref(key, fallback, allowed) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : allowed(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a per-viewer convenience only */ }
}
const readModes = () => {
  const m = readPref(MODES_KEY, {}, (v) => typeof v === 'object');
  return {
    sales: SALES_MODES.some(([k]) => k === m.sales) ? m.sales : 'pct',
    spend: SPEND_MODES.some(([k]) => k === m.spend) ? m.spend : 'cpr',
  };
};

// The split being edited: what each mode shows, the rupiah it gives, and
// the shortcuts (target even, budget following the target).
function useSplitEditor(data, onChange) {
  const annual = data.annual;
  const hasSpend = annual.targetSpend != null;
  const totalSales = annual.targetSales ?? 0;
  const totalSpend = annual.targetSpend ?? 0;
  const yearRatio = hasSpend && totalSales ? totalSpend / totalSales : null;
  const [modes, setModes] = useState(readModes);
  const [draft, setDraft] = useState(null);
  const stored = useMemo(() => ({
    sales: data.months.map((m) => m.targetSales ?? 0),
    spend: data.months.map((m) => m.targetSpend ?? 0),
  }), [data]);
  useEffect(() => { setDraft(null); }, [data]);

  const base = useMemo(() => ({
    sales: makeSide(modes.sales, stored.sales, totalSales, stored.sales),
    spend: makeSide(modes.spend, stored.spend, totalSpend, stored.sales),
  }), [modes, stored, totalSales, totalSpend]);
  const cur = draft ?? base;
  const sales = useMemo(() => (draft ? resolve(modes.sales, cur.sales, totalSales, stored.sales, null)
    : { valid: true, amounts: stored.sales, got: sum(stored.sales), ok: true }), [draft, cur, modes, totalSales, stored]);
  const spend = useMemo(() => {
    if (!hasSpend) return null;
    if (!draft) return { valid: true, amounts: stored.spend, got: sum(stored.spend), ok: sum(stored.spend) === totalSpend };
    return resolve(modes.spend, cur.spend, totalSpend, sales.amounts, yearRatio);
  }, [hasSpend, draft, cur, modes, totalSpend, sales, stored, yearRatio]);

  // Whether the saved budget follows the saved target (one Cost per Revenue
  // every month): more than Rp1.000 or 0,5% off in any month says it doesn't.
  const followsTarget = useMemo(() => {
    if (!hasSpend) return true;
    const want = followSales(totalSpend, stored.sales);
    return want.every((v, i) => Math.abs(v - stored.spend[i]) <= Math.max(1000, v * 0.005));
  }, [hasSpend, totalSpend, stored]);

  const open = () => draft ?? base;
  const setMode = (key, mode) => {
    const next = { ...modes, [key]: mode };
    writePref(MODES_KEY, next);
    if (draft) {
      setDraft((d) => ({
        ...d,
        [key]: key === 'sales'
          ? makeSide(mode, sales.amounts, totalSales, sales.amounts)
          : makeSide(mode, spend.amounts, totalSpend, sales.amounts),
      }));
    }
    setModes(next);
  };
  const type = (key, i, value) => {
    onChange?.();
    const clean = modes[key] === 'rp' ? digits(value) : value.replace(/[^\d.,]/g, '');
    const d = open();
    const side = d[key];
    setDraft({ ...d, [key]: { texts: side.texts.map((t, j) => (j === i ? clean : t)), exact: side.exact.map((v, j) => (j === i ? null : v)) } });
  };
  const spreadSales = () => {
    const even = splitEqual(totalSales);
    setDraft({ ...open(), sales: makeSide(modes.sales, even, totalSales, even) });
  };
  const followTarget = () => {
    const d = open();
    const target = draft ? sales.amounts : stored.sales;
    if (modes.spend === 'cpr') setDraft({ ...d, spend: { texts: target.map(() => textOf('cpr', yearRatio)), exact: target.map(() => yearRatio) } });
    else setDraft({ ...d, spend: makeSide(modes.spend, followSales(totalSpend, target), totalSpend, target) });
  };
  return {
    hasSpend, totalSales, totalSpend, yearRatio, modes, setMode, draft, reset: () => setDraft(null), cur, sales, spend,
    followsTarget, type, spreadSales, followTarget, ok: sales.ok && (!spend || spend.ok),
  };
}

// Achievement tone: met, close, or short once the month is over.
const toneOf = (r, done) => (r == null ? '' : r >= 1 ? 'is-good' : r >= 0.9 ? 'is-warn' : done ? 'is-bad' : '');

function Seg({ value, options, onChange, label, disabled }) {
  return (
    <div className="at-mini-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'is-on' : ''} onClick={() => onChange(k)} disabled={disabled}>{l}</button>
      ))}
    </div>
  );
}

// `children` (the month's pacing and channel budget) sit between the year at
// a glance and the month-by-month sheets: year, this month, then the detail.
export default function AnnualPlan({ brandId, month, canEdit, onSaved, children }) {
  const year = Number(String(month).slice(0, 4));
  const [state, setState] = useState({ status: 'loading', data: null });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    setMessage(null);
    api.get('/daily-tracking/annual-targets', { params: { brandId, year } })
      .then(({ data }) => alive && setState({ status: 'ready', data }))
      .catch((err) => alive && setState({ status: 'error', error: err.response?.data?.message || 'Rencana tahunan tidak dapat dimuat' }));
    return () => { alive = false; };
  }, [brandId, year]);

  if (state.status === 'loading') return <><p className="at-state"><Loader2 size={14} className="dt-spin" /> Memuat rencana tahunan…</p>{children}</>;
  if (state.status === 'error') return <><p className="at-state is-error">{state.error}</p>{children}</>;
  if (!state.data.annual) {
    return (
      <>
      <section className="soft-card tb-card at-plan is-empty" data-feature="rencana-tahunan" aria-label="Rencana tahunan">
        <header className="tb-head">
          <div>
            <h2>Rencana tahunan {year}</h2>
            <p>Belum ada target tahunan untuk {year}.{canEdit ? ' Target bulanan di bawah tetap bisa diatur per bulan.' : ' Target diatur oleh tim MIL Digital.'}</p>
          </div>
          {canEdit && (
            <Link to={`/pengaturan-brand?detail=${brandId}`} className="bp-ghost" onClick={() => presetBrandSettings({ brandId })}>
              Isi di Brand Setting <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
        </header>
      </section>
      {children}
      </>
    );
  }
  return (
    <PlanBody
      key={`${brandId}-${year}`}
      data={state.data}
      brandId={brandId}
      year={year}
      canEdit={canEdit}
      message={message}
      setMessage={setMessage}
      onSaved={(next) => {
        setState({ status: 'ready', data: next });
        setMessage({ tone: 'ok', text: `Pembagian ${year} tersimpan.` });
        onSaved?.();
      }}
    >
      {children}
    </PlanBody>
  );
}

function PlanBody({ data, brandId, year, canEdit, message, setMessage, onSaved, children }) {
  const [unit, setUnitState] = useState(() => readPref(UNIT_KEY, 'jt', (v) => v === 'full' || v === 'jt'));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const ed = useSplitEditor(data, () => setMessage(null));
  const setUnit = (v) => { writePref(UNIT_KEY, v); setUnitState(v); };

  const annual = data.annual;
  const original = data.original;
  const updates = data.updates ?? 0;
  const months = data.months;
  const { hasSpend } = ed;
  const today = new Date();
  const thisYear = today.getFullYear();
  const throughIdx = year < thisYear ? 11 : year > thisYear ? -1 : today.getMonth();
  const currentIdx = year === thisYear ? today.getMonth() : -1;
  const lastUpdate = [...(data.revisions ?? [])].reverse().find((r) => r.kind === 'revision');

  // Plans and actuals, month by month. Months to come have no actual yet;
  // the running month reads Rp0 so far rather than nothing.
  const adjS = ed.sales.amounts;
  const adjP = hasSpend ? ed.spend.amounts : months.map(() => null);
  const initS = months.map((m) => m.initialSales);
  const initP = months.map((m) => m.initialSpend);
  const seen = (i) => i <= throughIdx;
  const actS = months.map((m, i) => (seen(i) ? m.actualSales ?? (i === currentIdx ? 0 : null) : null));
  const actP = months.map((m, i) => (seen(i) ? m.actualSpend ?? (i === currentIdx ? 0 : null) : null));
  const done = (i) => i < throughIdx || year < thisYear;
  const ytdIdx = range(0, throughIdx + 1);
  const ytd = {
    actual: sum(ytdIdx.map((i) => actS[i])),
    spend: sum(ytdIdx.map((i) => actP[i])),
    adj: sum(ytdIdx.map((i) => adjS[i])),
    adjSpend: sum(ytdIdx.map((i) => adjP[i])),
    init: sum(ytdIdx.map((i) => initS[i])),
  };
  const T = annual.targetSales;
  const P = annual.targetSpend;
  const I = sum(initS);
  const IP = initP.some((v) => v != null) ? sum(initP) : null;

  const money = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    return unit === 'jt' ? (v / 1e6).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : Math.round(v).toLocaleString('id-ID');
  };
  const unitLabel = unit === 'jt' ? 'Rp juta' : 'Rp';

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { data: next } = await api.put('/daily-tracking/annual-targets/split', {
        brandId, year,
        months: months.map((m, i) => ({ month: m.month, targetSales: ed.sales.amounts[i], targetSpend: hasSpend ? ed.spend.amounts[i] : null })),
      });
      setEditing(false);
      onSaved(next);
    } catch (err) {
      setMessage({ tone: 'error', text: err.response?.data?.message || 'Pembagian gagal disimpan' });
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => { ed.reset(); setEditing(false); setMessage(null); };

  // One editable month: the mode's own unit, typed in place.
  const input = (key, i, label) => {
    const mode = ed.modes[key];
    const text = ed.cur[key].texts[i];
    return (
      <span className="pt-in">
        <input inputMode={mode === 'rp' ? 'numeric' : 'decimal'} aria-label={label} value={mode === 'rp' ? thousands(text) : text} onChange={(e) => ed.type(key, i, e.target.value)} disabled={saving} />
        {mode !== 'rp' && <i>%</i>}
      </span>
    );
  };
  const sumCell = (side, total) => {
    const diff = side.got - total;
    const tone = !side.valid || diff > 0 ? 'is-bad' : side.ok ? 'is-good' : 'is-warn';
    return (
      <span className="pt-sum">
        <b>{money(side.got)}</b>
        <span className={`pt-pill ${tone}`}>{!side.valid ? 'Tidak valid' : side.ok ? 'Pas' : `${diff > 0 ? 'Lebih' : 'Kurang'} ${fmtRpShort(Math.abs(diff))}`}</span>
      </span>
    );
  };
  const qSum = (arr, q) => sum([q * 3, q * 3 + 1, q * 3 + 2].map((i) => arr[i]));
  const hSum = (arr, h) => sum(range(h * 6, h * 6 + 6).map((i) => arr[i]));
  const halves = (arr) => [0, 1].map((h) => ({
    span: 6,
    value: money(hSum(arr, h)),
    note: h ? growthChip(growth(hSum(arr, 1), hSum(arr, 0)), 'dari H1') : null,
  }));
  const planBands = (arr) => QUARTERS.map((q) => ({ value: money(qSum(arr, q)), note: q ? growthChip(growth(qSum(arr, q), qSum(arr, q - 1)), 'QoQ') : null }));

  // ── Target adjustment ────────────────────────────────────────────────
  const salesIn = editing && canEdit ? ed.modes.sales : null;
  const spendIn = editing && canEdit && hasSpend ? ed.modes.spend : null;
  const adjRows = [
    {
      id: 'a-target', label: 'Target revenue', hint: unitLabel, key: true, input: salesIn === 'rp',
      cells: adjS.map((v, i) => (salesIn === 'rp' ? input('sales', i, `Target ${monthLong(months[i].month)}`) : money(v))),
      total: salesIn ? sumCell(ed.sales, T) : money(T),
    },
    {
      id: 'a-share', label: 'Kontribusi', hint: 'porsi setahun', input: salesIn === 'pct',
      cells: adjS.map((v, i) => (salesIn === 'pct' ? input('sales', i, `Kontribusi ${monthLong(months[i].month)}`) : pct(ratio(v, T), 2))),
      total: salesIn === 'pct' ? <span className={`pt-pill ${ed.sales.ok ? 'is-good' : 'is-warn'}`}>{pct(ratio(ed.sales.got, T), 2)}</span> : '100%',
    },
    { id: 'a-growth', detail: true, label: 'Growth bulanan', cells: adjS.map((v, i) => signedTone(i ? growth(v, adjS[i - 1]) : null)), total: '—' },
    {
      id: 'a-vs', detail: true, label: 'vs target awal',
      cells: adjS.map((v, i) => { const g = growth(v, initS[i]); return g == null || Math.abs(g) < 0.0005 ? <span className="pt-dim">tetap</span> : signedTone(g); }),
      total: signedTone(growth(T, I)),
    },
    { id: 'a-h', detail: true, label: 'Per semester', spans: halves(adjS), total: money(T) },
    ...(hasSpend ? [
      { divider: 'Budget iklan' },
      {
        id: 'a-budget', label: 'Budget iklan', hint: unitLabel, key: true, input: spendIn === 'rp',
        cells: adjP.map((v, i) => (spendIn === 'rp' ? input('spend', i, `Budget ${monthLong(months[i].month)}`) : money(v))),
        total: spendIn ? sumCell(ed.spend, P) : money(P),
      },
      {
        id: 'a-cpr', label: '% alokasi budget', hint: 'Cost per Revenue', input: spendIn === 'cpr',
        cells: adjP.map((v, i) => (spendIn === 'cpr' ? input('spend', i, `Alokasi budget ${monthLong(months[i].month)}`) : pct(ratio(v, adjS[i]), 2))),
        total: pct(ratio(P, T), 2),
      },
      ...(spendIn === 'pct' ? [{
        id: 'a-pshare', label: 'Porsi budget', hint: 'porsi setahun', input: true,
        cells: adjP.map((v, i) => input('spend', i, `Porsi budget ${monthLong(months[i].month)}`)),
        total: <span className={`pt-pill ${ed.spend.ok ? 'is-good' : 'is-warn'}`}>{pct(ratio(ed.spend.got, P), 2)}</span>,
      }] : []),
      { id: 'a-roas', detail: true, label: 'Target ROAS', cells: adjP.map((v, i) => xOf(adjS[i], v)), total: xOf(T, P) },
    ] : []),
    { divider: 'Harian', detail: true },
    { id: 'a-daily', detail: true, label: 'Target harian', hint: unitLabel, cells: adjS.map((v, i) => money(v / daysIn(year, i))), total: money(T / (year % 4 ? 365 : 366)) },
    ...(hasSpend ? [{ id: 'a-dbudget', detail: true, label: 'Budget harian', hint: unitLabel, cells: adjP.map((v, i) => money(v / daysIn(year, i))), total: money(P / (year % 4 ? 365 : 366)) }] : []),
  ];

  // ── Realisasi ─────────────────────────────────────────────────────────
  const chase = [];
  months.forEach((_, i) => { chase.push((chase[i - 1] ?? 0) + (adjS[i] ?? 0) - (actS[i] ?? 0)); });
  const realBands = QUARTERS.map((q) => {
    const idx = [q * 3, q * 3 + 1, q * 3 + 2].filter(seen);
    if (!idx.length) return { value: '—' };
    const r = ratio(sum(idx.map((i) => actS[i])), qSum(adjS, q));
    return { value: money(sum(idx.map((i) => actS[i]))), note: <span className={`pt-chip ${toneOf(r, idx.length === 3 && done(q * 3 + 2))}`}>{pct(r, 0)}</span> };
  });
  const realRows = [
    {
      id: 'r-real', label: 'Realisasi revenue', hint: unitLabel, key: true,
      cells: actS.map((v) => money(v)),
      cellTone: (i) => (actS[i] == null || !done(i) ? '' : actS[i] >= adjS[i] ? 'is-fill-good' : 'is-fill-bad'),
      total: money(ytd.actual),
    },
    {
      id: 'r-ach', label: 'Achievement', hint: 'vs adjustment',
      cells: actS.map((v, i) => { const r = ratio(v, adjS[i]); return r == null ? <span className="pt-dim">—</span> : <AchBar r={r} tone={toneOf(r, done(i))} />; }),
      total: <AchBar r={ratio(ytd.actual, ytd.adj)} tone={toneOf(ratio(ytd.actual, ytd.adj), year < thisYear)} />,
    },
    {
      id: 'r-chase', label: 'To be chased', hint: 'gap kumulatif',
      cells: chase.map((v, i) => <span className={i > throughIdx ? 'pt-ghost' : ''}>{gapCell(v, money)}</span>),
      total: gapCell(T - ytd.actual, money),
    },
    { id: 'r-growth', detail: true, label: 'Growth bulanan', cells: actS.map((v, i) => signedTone(i && done(i) ? growth(v, actS[i - 1]) : null)), total: '—' },
    { id: 'r-ach0', detail: true, label: 'Achievement', hint: 'vs target awal', cells: actS.map((v, i) => pct(ratio(v, initS[i]), 0)), total: pct(ratio(ytd.actual, ytd.init), 1) },
    { id: 'r-gap', detail: true, label: 'Gap ke target', hint: 'target − realisasi', cells: actS.map((v, i) => (v == null ? <span className="pt-dim">—</span> : gapCell(adjS[i] - v, money))), total: gapCell(ytd.adj - ytd.actual, money) },
    { divider: 'Budget iklan' },
    { id: 'r-spend', label: 'Spend iklan riil', hint: unitLabel, key: true, cells: actP.map((v) => money(v)), total: money(ytd.spend) },
    {
      id: 'r-cpr', label: 'CPR riil', hint: 'cost per revenue',
      cells: actP.map((v, i) => {
        const r = ratio(v, actS[i]);
        if (r == null) return <span className="pt-dim">—</span>;
        const plan = ratio(adjP[i], adjS[i]);
        return <span className={plan == null ? '' : r > plan * 1.0005 ? 'pt-bad' : 'pt-good'}>{pct(r, 1)}</span>;
      }),
      total: pct(ratio(ytd.spend, ytd.actual), 2),
    },
    ...(hasSpend ? [{
      id: 'r-burn', detail: true, label: 'Penyerapan budget', hint: 'spend ÷ budget',
      cells: actP.map((v, i) => { const r = ratio(v, adjP[i]); return r == null ? <span className="pt-dim">—</span> : <span className={r > 1.02 ? 'pt-warn' : ''}>{pct(r, 1)}</span>; }),
      total: pct(ratio(ytd.spend, ytd.adjSpend), 1),
    }] : []),
    { id: 'r-roas', detail: true, label: 'ROAS riil', cells: actP.map((v, i) => (v == null ? <span className="pt-dim">—</span> : xOf(actS[i], v))), total: xOf(ytd.actual, ytd.spend) },
  ];

  // ── Target awal ───────────────────────────────────────────────────────
  const initRows = [
    { id: 'i-target', label: 'Target revenue', hint: unitLabel, key: true, cells: initS.map((v) => money(v)), total: money(I) },
    { id: 'i-share', label: 'Kontribusi', hint: 'porsi setahun', cells: initS.map((v) => pct(ratio(v, I), 2)), total: '100%' },
    { id: 'i-growth', detail: true, label: 'Growth bulanan', cells: initS.map((v, i) => signedTone(i ? growth(v, initS[i - 1]) : null)), total: '—' },
    { id: 'i-h', detail: true, label: 'Per semester', spans: halves(initS), total: money(I) },
    ...(IP != null ? [
      { divider: 'Budget iklan' },
      { id: 'i-budget', label: 'Budget iklan', hint: unitLabel, key: true, cells: initP.map((v) => money(v)), total: money(IP) },
      { id: 'i-cpr', label: '% alokasi budget', hint: 'Cost per Revenue', cells: initP.map((v, i) => pct(ratio(v, initS[i]), 2)), total: pct(ratio(IP, I), 2) },
    ] : []),
  ];

  const editTools = editing && (
    <div className="ps-edit">
      <div className="ps-edit-modes">
        <label><span>Isi target dengan</span><Seg value={ed.modes.sales} options={SALES_MODES} onChange={(m) => ed.setMode('sales', m)} label="Isi target dengan" disabled={saving} /></label>
        {hasSpend && <label><span>Isi budget dengan</span><Seg value={ed.modes.spend} options={SPEND_MODES} onChange={(m) => ed.setMode('spend', m)} label="Isi budget dengan" disabled={saving} /></label>}
      </div>
      <div className="ps-edit-tools">
        <button type="button" className="tb-link" onClick={ed.spreadSales} disabled={saving}><Scale size={14} aria-hidden="true" /> Target bagi rata</button>
        {hasSpend && <button type="button" className="tb-link" onClick={ed.followTarget} disabled={saving}><Link2 size={14} aria-hidden="true" /> Budget ikuti target · {pct(ed.yearRatio, 2)}</button>}
      </div>
      <p className="ps-edit-hint">
        Sel kuning bisa diisi. {ed.modes.spend === 'cpr' && hasSpend ? 'Budget = % × target bulan itu, jadi ikut berubah saat target diubah. ' : ''}
        Total 12 bulan harus pas {fmtRp(T)}{hasSpend ? ` dan ${fmtRp(P)}` : ''}.{updates === 0 ? ' Belum ada update, jadi target awal ikut berubah.' : ''}
      </p>
    </div>
  );

  return (
    <>
    <section className="at-plan ap-hero-block" data-feature="rencana-tahunan" aria-label="Rencana tahunan">
      <PlanHero
        year={year} T={T} P={P} I={I} IP={IP} ytd={ytd} updates={updates} lastUpdate={lastUpdate} corrected={data.corrected}
        throughIdx={throughIdx} currentIdx={currentIdx} adjS={adjS} actS={actS} initS={initS} done={done}
        hasSpend={hasSpend} unit={unit} setUnit={setUnit}
      />
    </section>

    {children}

    <section className="soft-card tb-card at-plan" data-feature="rencana-per-bulan" aria-label="Rencana per bulan">
      <header className="tb-head">
        <div>
          <h2>Rencana per bulan · {year}</h2>
          <p>Target adjustment, realisasi, dan target awal untuk 12 bulan. Pembagian target dan budget diatur di tabel pertama.</p>
        </div>
      </header>

      {message && <p className={`tb-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <Sheet
        tone="adj" icon={Crosshair} title="Target adjustment" feature="plan-adjustment" step="01"
        sub={updates > 0 ? `Berlaku sekarang · ${updates} update${lastUpdate ? `, terakhir mulai ${monthLong(lastUpdate.effectiveMonth)}` : ''}` : 'Berlaku sekarang · belum ada update'}
        editing={editing}
        actions={canEdit && !editing ? (
          <button type="button" className="bp-primary ps-edit-btn" onClick={() => { setEditing(true); setMessage(null); }}>
            <PencilLine size={15} aria-hidden="true" /> Atur pembagian
          </button>
        ) : editing ? (
          <div className="at-actions">
            <button type="button" className="bp-ghost" onClick={cancel} disabled={saving}><X size={15} aria-hidden="true" /> Batal</button>
            <button type="button" className="bp-primary" onClick={save} disabled={saving || !ed.ok || !ed.draft} title={!ed.ok ? 'Total 12 bulan harus pas dengan target dan budget setahun' : undefined}>
              {saving ? <Loader2 size={15} className="dt-spin" /> : <Check size={15} />} Simpan
            </button>
          </div>
        ) : null}
        banner={(
          <>
            {editTools}
            {hasSpend && !ed.followsTarget && !ed.draft && (
              <div className="ps-banner">
                <Link2 size={16} aria-hidden="true" />
                <p><b>Budget belum mengikuti target.</b> Bulan dengan target besar dapat budget yang sama dengan bulan kecil. Dengan {pct(ed.yearRatio, 2)} dari target tiap bulan, totalnya tetap {fmtRp(P)}.</p>
                {canEdit && <button type="button" className="bp-ghost" onClick={() => { setEditing(true); ed.followTarget(); }}>Ikuti target</button>}
              </div>
            )}
          </>
        )}
        bands={planBands(adjS)} rows={adjRows} year={year} currentIdx={currentIdx} unit={unit}
      />

      <Sheet
        tone="act" icon={Activity} title="Realisasi" feature="plan-actual" step="02"
        sub={throughIdx >= 0 ? `Input harian Brand Tracking · s.d. ${monthLong(months[throughIdx].month)}` : `${year} belum berjalan`}
        bands={realBands} rows={realRows} year={year} currentIdx={currentIdx} unit={unit}
      />

      <Sheet
        tone="init" icon={Flag} title="Target awal" feature="plan-initial" step="03"
        sub={data.initialEstimated
          ? 'Sebelum tahun berjalan · per bulan diperkirakan (dibagi rata), pembagiannya belum tersimpan saat update'
          : `Sebelum tahun berjalan${original ? ` · disusun ${new Date(original.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${data.corrected ? ' · dikoreksi' : ''}`}
        bands={planBands(initS)} rows={initRows} year={year} currentIdx={currentIdx} unit={unit}
      />

      <p className="tb-foot">
        Target tahunan dan update-nya diatur di Brand Setting › Annual Target. Target awal mengikuti pembagian di sini sampai ada update pertama; setelah itu terkunci, dan pembagian di sini mengubah target adjustment.
      </p>
    </section>
    </>
  );
}

// A growth or change, signed and coloured.
function signedTone(g) {
  if (g == null) return <span className="pt-dim">—</span>;
  return <span className={g > 0.0005 ? 'pt-good' : g < -0.0005 ? 'pt-bad' : 'pt-dim'}>{signedPct(g, 1)}</span>;
}
function growthChip(g, label) {
  if (g == null) return null;
  return <span className={`pt-chip ${g > 0.0005 ? 'is-up' : g < -0.0005 ? 'is-down' : ''}`}>{signedPct(g, 1)} {label}</span>;
}
// Target − actual: still to go (red), or past it (green, shown as a surplus).
function gapCell(v, money) {
  if (v == null) return '—';
  if (Math.abs(v) < 1) return <span className="pt-dim">0</span>;
  return v > 0 ? <span className="pt-bad">{money(v)}</span> : <span className="pt-good">+{money(-v)}</span>;
}
// Achievement as a figure over a thin meter.
function AchBar({ r, tone }) {
  if (r == null) return <span className="pt-dim">—</span>;
  return (
    <span className={`pt-ach ${tone}`}>
      <b>{pct(r, 0)}</b>
      <i aria-hidden="true"><em style={{ transform: `scaleX(${Math.min(r, 1)})` }} /></i>
    </span>
  );
}

// ── The year at a glance: achievement so far and the 12 months as bars ──
function PlanHero({ year, T, P, I, IP, ytd, updates, lastUpdate, corrected, throughIdx, currentIdx, adjS, actS, initS, done, hasSpend, unit, setUnit }) {
  const ach = ratio(ytd.actual, ytd.adj);
  const max = Math.max(1, ...adjS, ...actS.map((v) => v ?? 0), ...(updates > 0 ? initS.map((v) => v ?? 0) : []));
  const h = (v) => `${Math.max(((v ?? 0) / max) * 100, v ? 1.5 : 0)}%`;
  const R = 52;
  const C = 2 * Math.PI * R;
  const change = changeFromOriginal(T, I);
  return (
    <div className="ph" data-feature="plan-hero">
      <div className="ph-top">
        <div>
          <span className="ph-eyebrow">Rencana tahunan · {year}</span>
          <h2>{fmtRp(T)}</h2>
          <p>
            Target adjustment
            {updates > 0
              ? <> · <b className={change >= 0 ? 'is-up' : 'is-down'}>{signedPct(change)}</b> dari target awal {fmtRpShort(I)} · <History size={12} aria-hidden="true" /> {updates} update{lastUpdate ? `, mulai ${MONTH_SHORT[Number(lastUpdate.effectiveMonth.slice(5, 7)) - 1]}` : ''}</>
              : ' · belum ada update'}
            {corrected ? ' · target awal dikoreksi' : ''}
          </p>
        </div>
        <div className="ph-unit">
          <span>Angka tabel</span>
          <Seg value={unit} options={[['jt', 'Juta'], ['full', 'Rupiah penuh']]} onChange={setUnit} label="Satuan angka tabel" />
        </div>
      </div>

      <div className="ph-body">
        <div className="ph-gauge">
          <svg viewBox="0 0 128 128" role="img" aria-label={`Achievement ${pct(ach)} dari target adjustment`}>
            <defs>
              <linearGradient id="ph-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#5eead4" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
            </defs>
            <circle cx="64" cy="64" r={R} className="ph-ring-track" />
            <circle cx="64" cy="64" r={R} className="ph-ring-val" stroke="url(#ph-ring)" strokeDasharray={C} style={{ '--ph-off': C * (1 - Math.min(ach ?? 0, 1)), '--ph-c': C }} />
          </svg>
          <div className="ph-gauge-text">
            <strong>{throughIdx >= 0 ? pct(ach, 0) : '—'}</strong>
            <span>{throughIdx >= 0 ? `achievement s.d. ${MONTH_SHORT[throughIdx]}` : 'belum berjalan'}</span>
          </div>
        </div>

        <dl className="ph-stats">
          <div><dt>Realisasi</dt><dd>{fmtRpShort(ytd.actual)}</dd><small>dari {fmtRpShort(ytd.adj)} target s.d. {throughIdx >= 0 ? MONTH_SHORT[throughIdx] : '—'}</small></div>
          <div><dt>Sisa dikejar</dt><dd>{fmtRpShort(Math.max(T - ytd.actual, 0))}</dd><small>{pct(ratio(ytd.actual, T))} dari target setahun</small></div>
          <div><dt>Budget terpakai</dt><dd>{fmtRpShort(ytd.spend)}</dd><small>{hasSpend ? `${pct(ratio(ytd.spend, P))} dari ${fmtRpShort(P)}` : 'budget belum diisi'}</small></div>
          <div><dt>CPR riil</dt><dd>{pct(ratio(ytd.spend, ytd.actual), 1)}</dd><small>{hasSpend ? `rencana ${pct(ratio(P, T), 1)} · ROAS ${xOf(ytd.actual, ytd.spend)}` : `ROAS ${xOf(ytd.actual, ytd.spend)}`}</small></div>
          <div className="is-init"><dt>Target awal</dt><dd>{fmtRpShort(I)}</dd><small>{IP != null ? `budget ${fmtRpShort(IP)} · CPR ${pct(ratio(IP, I), 1)}` : 'tanpa budget'}</small></div>
        </dl>

        <div className="ph-chart" role="img" aria-label="Target dan realisasi per bulan">
          <div className="ph-bars">
            {adjS.map((v, i) => {
              const a = actS[i];
              const r = ratio(a, v);
              const tone = a == null ? '' : r >= 1 ? 'is-good' : r >= 0.9 ? 'is-warn' : done(i) ? 'is-bad' : 'is-run';
              return (
                <div key={MONTH_SHORT[i]} className={`ph-col${i === currentIdx ? ' is-now' : ''}`} style={{ '--i': i }} title={`${MONTH_LONG[i]}: target ${fmtRpShort(v)}${a != null ? ` · realisasi ${fmtRpShort(a)} (${pct(r, 0)})` : ''}${updates > 0 ? ` · target awal ${fmtRpShort(initS[i])}` : ''}`}>
                  <span className="ph-pct">{a != null && r != null ? pct(r, 0) : ''}</span>
                  <div className="ph-track">
                    <span className="ph-target" style={{ height: h(v) }} />
                    {a != null && <span className={`ph-real ${tone}`} style={{ height: h(a) }} />}
                    {updates > 0 && initS[i] != null && <span className="ph-init" style={{ bottom: h(initS[i]) }} />}
                  </div>
                  <span className="ph-month">{MONTH_SHORT[i]}</span>
                </div>
              );
            })}
          </div>
          <div className="ph-legend">
            <span><i className="is-target" /> Target adjustment</span>
            <span><i className="is-real" /> Realisasi</span>
            {updates > 0 && <span><i className="is-init" /> Target awal</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// One block of the sheet: its header, and the months table with the rows
// that matter on show; growth, daily figures and the like behind "Detail".
function Sheet({ tone, icon: Icon, title, sub, step, actions, banner, editing, feature, bands, rows, year, currentIdx, unit }) {
  const [detail, setDetail] = useState(false);
  const hidden = rows.filter((r) => r.detail && !r.divider).length;
  const shown = rows.filter((r) => detail || !r.detail);
  return (
    <section className={`ps-sheet is-${tone}${editing ? ' is-editing' : ''}`} data-feature={feature} aria-label={title}>
      <header className="ps-head">
        <span className="ps-icon" aria-hidden="true"><Icon size={16} /><em>{step}</em></span>
        <div className="ps-title">
          <h3>{title}</h3>
          <p>{sub}</p>
        </div>
        <div className="ps-actions">
          {hidden > 0 && (
            <button type="button" className={`ps-detail${detail ? ' is-on' : ''}`} aria-expanded={detail} onClick={() => setDetail((d) => !d)}>
              <ChevronDown size={14} aria-hidden="true" /> {detail ? 'Ringkas' : `Detail · ${hidden} baris`}
            </button>
          )}
          {actions}
        </div>
      </header>
      {banner}
      <div className="ps-scroll">
        <SheetTable year={year} currentIdx={currentIdx} rows={shown} bands={bands} unit={unit} />
      </div>
    </section>
  );
}

// Months across, figures down. The quarter band carries each quarter's
// total; the running month is lit down the whole column; the labels and the
// year's total stay put while the months scroll.
function SheetTable({ year, currentIdx, rows, bands, unit }) {
  const colCls = (i) => `${i % 3 === 0 ? ' is-qstart' : ''}${i === currentIdx ? ' is-now' : ''}`;
  return (
    <table className={`pt-table${unit === 'jt' ? ' is-jt' : ''}`}>
      <thead>
        <tr className="pt-qrow">
          <th rowSpan={2} className="pt-corner" scope="col"><b>{year}</b></th>
          {QUARTERS.map((q) => (
            <th key={q} colSpan={3} scope="colgroup" className="pt-q">
              <span className="pt-qband">
                <span className="pt-qname">Q{q + 1}</span>
                <span className="pt-qval">{bands[q].value}</span>
                {bands[q].note}
              </span>
            </th>
          ))}
          <th rowSpan={2} className="pt-total" scope="col">Total</th>
        </tr>
        <tr className="pt-mrow">
          {MONTH_SHORT.map((m, i) => (
            <th key={m} scope="col" className={`pt-m${colCls(i)}`}>{m}{i === currentIdx && <em title="Bulan berjalan" aria-label="bulan berjalan" />}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, n) => {
          if (r.divider) {
            return (
              <tr key={`d-${r.divider}-${n}`} className="pt-divider">
                <th scope="rowgroup" className="pt-label">{r.divider}</th>
                <td colSpan={13} />
              </tr>
            );
          }
          return (
            <tr key={r.id} className={`${r.key ? 'is-key' : ''}${r.input ? ' is-input' : ''}${r.detail ? ' is-detail' : ''}`}>
              <th scope="row" className="pt-label">{r.label}{r.hint && <small>{r.hint}</small>}</th>
              {r.spans
                ? r.spans.map((s, k) => <td key={k} colSpan={s.span} className={`pt-spancell${k ? ' is-qstart' : ''}`}><b>{s.value}</b>{s.note}</td>)
                : r.cells.map((c, i) => <td key={i} className={`pt-c${colCls(i)}${r.cellTone ? ` ${r.cellTone(i)}` : ''}`}>{c}</td>)}
              <td className="pt-total">{r.total}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
