import * as XLSX from 'xlsx';
import { computeDelta, deltaClassForSentiment, safeDiv } from './delta';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE PRODUCT OVERVIEW PARSING — ported 1:1 from the original vanilla-JS logic.
// ══════════════════════════════════════════════════════

// NOTE: unlike parseShopeeNum (Shopee Ads export), the Product Overview export
// uses "." as thousands separator and "," as decimal — the original code's
// own inconsistency, preserved here rather than "fixed" as part of a 1:1 port.
export function parseOverviewNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, '');
  return parseFloat(s) || 0;
}

// Detects a period from the Product Overview filename (e.g.
// "...20260701_20260731...") — purely cosmetic (shown next to the row count),
// not fed into the report's period labels the way Shopee Ads/TikTok's
// filename detection is.
export function periodFromOverviewFilename(filename: string): string {
  const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const m = filename.match(/(\d{4})(\d{2})\d{2}.*?(\d{4})(\d{2})\d{2}/);
  if (!m) return '';
  const mo1 = parseInt(m[2]) - 1;
  const yr1 = m[1];
  const mo2 = parseInt(m[4]) - 1;
  const yr2 = m[3];
  return mo1 === mo2 && yr1 === yr2 ? mn[mo1] + ' ' + yr1 : mn[mo1] + '–' + mn[mo2] + ' ' + yr2;
}

export interface OverviewMetrics {
  pengunjung: number;
  produkDilihat: number;
  atc: number;
  produkAtc: number;
  purchase: number;
  produkDibeli: number;
  purchaseValue: number;
}

export function calcOverviewMetrics(rows: SheetRow[]): OverviewMetrics | null {
  if (!rows || !rows.length) return null;
  const findCol = (kw: string) => Object.keys(rows[0]).find((h) => h.toLowerCase().includes(kw.toLowerCase())) || null;
  const colPengunjung = findCol('Kunjungan');
  const colDilihat = findCol('Halaman Produk Dilihat');
  const colAtcVisitor = findCol('Menambahkan Produk ke Keranjang');
  const colAtcProduk = findCol('Dimasukkan ke Keranjang (Produk)');
  const colPurchase = findCol('Total Pembeli (Pesanan Dibuat)');
  const colProdukDibeli = findCol('Produk (Pesanan Dibuat)');
  const colPurchaseVal = findCol('Total Penjualan (Pesanan Dibuat)');
  const sum = (col: string | null) => (col ? rows.reduce((s, r) => s + parseOverviewNum(r[col]), 0) : 0);
  return {
    pengunjung: sum(colPengunjung),
    produkDilihat: sum(colDilihat),
    atc: sum(colAtcVisitor),
    produkAtc: sum(colAtcProduk),
    purchase: sum(colPurchase),
    produkDibeli: sum(colProdukDibeli),
    purchaseValue: sum(colPurchaseVal),
  };
}

export type OverviewMetricFmt = 'num' | 'rp' | 'pct';

export interface OverviewMetricDef {
  key: keyof OverviewMetrics;
  label: string;
  fmt: OverviewMetricFmt;
  sentiment: Sentiment;
}

export const OVERVIEW_METRIC_DEFS: OverviewMetricDef[] = [
  { key: 'pengunjung', label: 'Pengunjung', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDilihat', label: 'Produk Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'atc', label: 'Add to Cart (ATC)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkAtc', label: 'Produk ATC', fmt: 'num', sentiment: 'higher-better' },
  { key: 'purchase', label: 'Purchase', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDibeli', label: 'Produk Dibeli', fmt: 'num', sentiment: 'higher-better' },
  { key: 'purchaseValue', label: 'Purchase Value', fmt: 'rp', sentiment: 'higher-better' },
];

// Derived ratio metrics — computed purely from the 7 metrics above, not from
// any new raw column. Kept in a separate defs array (and rendered in its own
// "Conversion & Ratio Metrics" sub-section) so it's visually obvious to a
// non-technical reader that these are calculated, not raw export data.
export interface OverviewCalcMetricDef {
  key: string;
  label: string;
  fmt: OverviewMetricFmt;
  sentiment: Sentiment;
  // Returns null (rendered "—") instead of Infinity/NaN when the underlying
  // denominator is 0 — see safeDiv.
  calc: (m: OverviewMetrics) => number | null;
}

export const OVERVIEW_CALC_METRIC_DEFS: OverviewCalcMetricDef[] = [
  // Denominator is "Add to Cart (ATC)" (visitor-level), NOT "Produk ATC"
  // (product-level) — ATC to Order tracks how many ATC-ing visitors convert.
  { key: 'atcToOrder', label: 'ATC to Order (%)', fmt: 'pct', sentiment: 'higher-better', calc: (m) => pctOrNull(m.purchase, m.atc) },
  { key: 'conversionRate', label: 'Conversion Rate (%)', fmt: 'pct', sentiment: 'higher-better', calc: (m) => pctOrNull(m.purchase, m.pengunjung) },
  { key: 'aov', label: 'AOV - Average Order Value (Rp)', fmt: 'rp', sentiment: 'higher-better', calc: (m) => safeDiv(m.purchaseValue, m.purchase) },
  { key: 'aur', label: 'AUR - Average Unit Retail (Rp)', fmt: 'rp', sentiment: 'higher-better', calc: (m) => safeDiv(m.purchaseValue, m.produkDibeli) },
];

function pctOrNull(num: number, den: number): number | null {
  const r = safeDiv(num, den);
  return r === null ? null : r * 100;
}

export interface OverviewKpiRow {
  key: string;
  label: string;
  old: string;
  cur: string;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

function fmtOverviewVal(v: number | null, fmt: OverviewMetricFmt): string {
  if (v === null) return '—';
  if (fmt === 'rp') return 'Rp' + Math.round(v).toLocaleString('id-ID');
  if (fmt === 'pct') return v.toFixed(2) + '%';
  return Math.round(v).toLocaleString('id-ID');
}

function buildOverviewRow(key: string, label: string, vOld: number | null, vCur: number | null, fmt: OverviewMetricFmt, sentiment: Sentiment): OverviewKpiRow {
  const { deltaNum, deltaStr } = vOld !== null && vCur !== null ? computeDelta(vOld, vCur) : { deltaNum: null, deltaStr: '—' };
  const cls = deltaClassForSentiment(deltaNum, sentiment);
  return {
    key,
    label,
    old: fmtOverviewVal(vOld, fmt),
    cur: fmtOverviewVal(vCur, fmt),
    deltaNum,
    delta: deltaStr,
    cls,
  };
}

// Pure row-builder extracted from the original buildOverviewKPITable (which
// mixed this calculation with HTML string rendering) — the JSX table itself
// is built by the Shopee tab UI component in a later checkpoint.
export function buildOverviewKPIRows(mOld: OverviewMetrics | null, mCur: OverviewMetrics | null): OverviewKpiRow[] {
  return OVERVIEW_METRIC_DEFS.map((def) => buildOverviewRow(def.key, def.label, mOld ? mOld[def.key] : null, mCur ? mCur[def.key] : null, def.fmt, def.sentiment));
}

// Same shape as buildOverviewKPIRows, for the derived ratio metrics.
export function buildOverviewCalcRows(mOld: OverviewMetrics | null, mCur: OverviewMetrics | null): OverviewKpiRow[] {
  return OVERVIEW_CALC_METRIC_DEFS.map((def) => buildOverviewRow(def.key, def.label, mOld ? def.calc(mOld) : null, mCur ? def.calc(mCur) : null, def.fmt, def.sentiment));
}

// Total Omzet Toko (Pesanan Dibuat) as the Product Overview export states it:
// the sum of its daily "Total Penjualan (Pesanan Dibuat)" — the same figure
// Seller Centre's Performa Toko shows for "Pesanan Dibuat". Rows without a
// date (a totals line some exports add) are left out so nothing is counted
// twice. Null when the file has no such column or no sales at all.
export function omzetFromOverview(rows: SheetRow[]): number | null {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  const col = headers.find((h) => /total penjualan \(pesanan dibuat\)/i.test(h));
  if (!col) return null;
  const dateCol = headers.find((h) => /^tanggal/i.test(h.trim()));
  const total = rows
    .filter((r) => !dateCol || /\d/.test(String(r[dateCol] ?? '')))
    .reduce((s, r) => s + parseOverviewNum(r[col]), 0);
  return total > 0 ? Math.round(total) : null;
}

// What a month's Performa Toko export says about the shop's own sales, all
// on the "Pesanan Dibuat" basis — the same one Shopee's ads report counts
// its GMV on (an order is credited when placed, even if later cancelled):
// the total, and how much of it was cancelled or returned. `adsSales` is
// the shop's own "Penjualan dari Iklan Shopee" (sheet "Asal Kunjungan"),
// null when the export has no such sheet.
export interface ShopStats {
  gmv: number;
  orders: number;
  cancelledOrders: number;
  cancelledSales: number;
  returnedOrders: number;
  returnedSales: number;
  adsSales: number | null;
}

const SHOP_RANGE_ROW = /^\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-\d{4}$/;
const SHOP_DAY_ROW = /^\d{2}-\d{2}-\d{4}$/;

// The period's rows of a Performa Toko sheet: its own total line
// ("01-08-2026-31-08-2026 | …") when the export opens with one, else every
// daily row (summed by the caller).
function shopPeriodRows(aoa: unknown[][], head: number): unknown[][] {
  const first = aoa[head + 1];
  if (first && SHOP_RANGE_ROW.test(String(first[0]).trim())) return [first];
  const out: unknown[][] = [];
  for (let i = head + 1; i < aoa.length; i++) {
    if (!SHOP_DAY_ROW.test(String(aoa[i][0]).trim())) break;
    out.push(aoa[i]);
  }
  return out;
}

// Shopee's Performa Toko export ("…shopee-shop-stats…", Pengaturan Brand ›
// Performance Overview), read off its "Pesanan Dibuat" sheet. Null when the
// file is not a Performa Toko export.
export function shopStatsFromShopStats(buffer: ArrayBuffer): ShopStats | null {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'pesanan dibuat');
  if (!name) return null;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '' });
  const head = aoa.findIndex((r) => String(r[0]).trim().toLowerCase() === 'tanggal' && r.some((c) => /total penjualan/i.test(String(c))));
  if (head < 0) return null;
  const cols = aoa[head].map((c) => String(c).trim().toLowerCase());
  const at = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const rows = shopPeriodRows(aoa, head);
  const sum = (re: RegExp) => {
    const i = at(re);
    return i < 0 ? 0 : Math.round(rows.reduce((t, r) => t + parseOverviewNum(r[i]), 0));
  };
  const stats: ShopStats = {
    gmv: sum(/^total penjualan/),
    orders: sum(/^total pesanan$/),
    cancelledOrders: sum(/^pesanan dibatalkan$/),
    cancelledSales: sum(/^penjualan dibatalkan$/),
    returnedOrders: sum(/^pesanan dikembalikan$/),
    returnedSales: sum(/^penjualan dikembalikan$/),
    adsSales: null,
  };

  // "Asal Kunjungan (pesanan yang …)": one line per order status; the
  // "Pesanan Dibuat" line's "Penjualan dari Iklan Shopee".
  const origin = wb.SheetNames.find((n) => /^asal kunjungan/i.test(n.trim()));
  if (origin) {
    const o = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[origin], { header: 1, defval: '' });
    const oh = o.findIndex((r) => String(r[0]).trim().toLowerCase() === 'tanggal');
    if (oh >= 0) {
      const oc = o[oh].map((c) => String(c).trim().toLowerCase());
      const statusCol = oc.findIndex((c) => c === 'status pesanan');
      const adsCol = oc.findIndex((c) => /iklan shopee/.test(c));
      if (statusCol >= 0 && adsCol >= 0) {
        const made = o.slice(oh + 1).filter((r) => /pesanan dibuat/i.test(String(r[statusCol])));
        const ranged = made.filter((r) => SHOP_RANGE_ROW.test(String(r[0]).trim()));
        const lines = ranged.length ? ranged : made.filter((r) => SHOP_DAY_ROW.test(String(r[0]).trim()));
        if (lines.length) stats.adsSales = Math.round(lines.reduce((t, r) => t + parseOverviewNum(r[adsCol]), 0));
      }
    }
  }
  return stats;
}

// Several parts of one month (a Performa Toko exported in pieces) as one.
export function addShopStats(parts: ShopStats[]): ShopStats | null {
  if (!parts.length) return null;
  const ads = parts.map((p) => p.adsSales).filter((v): v is number => v !== null);
  return {
    gmv: parts.reduce((t, p) => t + p.gmv, 0),
    orders: parts.reduce((t, p) => t + p.orders, 0),
    cancelledOrders: parts.reduce((t, p) => t + p.cancelledOrders, 0),
    cancelledSales: parts.reduce((t, p) => t + p.cancelledSales, 0),
    returnedOrders: parts.reduce((t, p) => t + p.returnedOrders, 0),
    returnedSales: parts.reduce((t, p) => t + p.returnedSales, 0),
    adsSales: ads.length === parts.length ? ads.reduce((t, v) => t + v, 0) : null,
  };
}

// Total Omzet Toko from a Performa Toko export: its "Pesanan Dibuat"
// total. Null when the file is not one, or shows no sales.
export function omzetFromShopStats(buffer: ArrayBuffer): number | null {
  const stats = shopStatsFromShopStats(buffer);
  return stats && stats.gmv > 0 ? stats.gmv : null;
}
