import { DeltaPill } from '../../components/DeltaPill';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { Sentiment } from '../../lib/types';
import type { ChannelMixEntry, SalesContribution, SalesContributionSide } from './shopeeFunnelReport';

// ── Kontribusi Penjualan ────────────────────────────────────────────────────
// How much of the shop's sales the ads brought in, month against month; how
// much of those sales was cancelled or returned; and, last, the ad channels
// against each other.
//
// Every share is taken of the shop's total on the "Pesanan Dibuat" basis —
// the basis Shopee's ads report counts its own GMV on (an order is credited
// when placed, even if it is cancelled later). A total taken from paid or
// shipped orders is smaller than that, which is how an ads share above 100%
// comes about; the section says so instead of printing it.
//
// Part 3, the ad channels: which Shopee ad type (Produk / Toko / Live) pulls its weight. Two 100%
// stacked bars — share of Spend vs share of GMV — plus an efficiency index
// per channel (GMV share ÷ spend share). Index > 1 = the channel returns more
// revenue than its slice of the budget; that, not raw ROAS, is the verdict
// signal (raw ROAS spikes when a low-spend channel happens to land one big
// order).

function pctLabel(v: number): string {
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')}%`;
}

function StackedBar({ title, entries, valueOf, total }: { title: string; entries: ChannelMixEntry[]; valueOf: (e: ChannelMixEntry) => number; total: number }) {
  return (
    <div className="chan-bar-row">
      <div className="chan-bar-label">{title}</div>
      <div className="chan-bar">
        {entries.map((e) => {
          const share = total > 0 ? (valueOf(e) / total) * 100 : 0;
          if (share <= 0) return null;
          return (
            <div key={e.key} className="chan-seg" style={{ width: `${share}%`, background: e.color }} title={`${e.label} · ${pctLabel(share)}`}>
              {share >= 9 ? pctLabel(share) : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Part 3: the ad channels against each other (current period).
function ChannelMixPart({ mix, periodLabel }: { mix: ChannelMixEntry[]; periodLabel: string }) {
  if (mix.length < 1) return null;

  const totalSpend = mix.reduce((s, e) => s + e.spend, 0);
  const totalGmv = mix.reduce((s, e) => s + e.gmv, 0);

  const rows = mix.map((e) => {
    const spendShare = totalSpend > 0 ? (e.spend / totalSpend) * 100 : 0;
    const gmvShare = totalGmv > 0 ? (e.gmv / totalGmv) * 100 : 0;
    const eff = spendShare > 0 ? gmvShare / spendShare : null;
    return { ...e, spendShare, gmvShare, eff };
  });

  // Most effective = highest efficiency index among channels that actually
  // carry a meaningful slice of the budget (≥ 8%).
  const ranked = rows.filter((r) => r.spendShare >= 8 && r.eff !== null).sort((a, b) => (b.eff ?? 0) - (a.eff ?? 0));
  const best = ranked[0];

  const effTag = (eff: number | null) => {
    if (eff === null) return { text: '—', cls: 'chan-eff-neutral' };
    if (eff >= 1.15) return { text: `${eff.toFixed(2).replace('.', ',')}× · efisien`, cls: 'chan-eff-good' };
    if (eff <= 0.85) return { text: `${eff.toFixed(2).replace('.', ',')}× · kurang efisien`, cls: 'chan-eff-bad' };
    return { text: `${eff.toFixed(2).replace('.', ',')}× · seimbang`, cls: 'chan-eff-neutral' };
  };

  return (
    <div className="sc-part">
      <div className="sc-part-title">
        Antar channel iklan <span>periode {periodLabel}</span>
      </div>
      <div>
        {mix.length >= 2 && best ? (
          <div className="chan-verdict">
            <strong>{best.label}</strong> paling efektif — {pctLabel(best.spendShare)} dari spend menghasilkan {pctLabel(best.gmvShare)} dari GMV Ads
            (indeks efisiensi {best.eff!.toFixed(2).replace('.', ',')}×, ROAS {best.roas.toFixed(1).replace('.', ',')}×).
          </div>
        ) : mix.length === 1 ? (
          <div className="chan-verdict">
            Hanya <strong>{mix[0].label}</strong> yang punya data periode ini — ROAS {mix[0].roas.toFixed(1).replace('.', ',')}×. Pilih file Iklan Toko / Iklan Live dari Data Collection Hub
            untuk membandingkan kontribusi antar channel.
          </div>
        ) : null}

        <div className="chan-legend">
          {mix.map((e) => (
            <span key={e.key} className="chan-legend-item">
              <span className="chan-legend-dot" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>

        <StackedBar title="Distribusi Spend" entries={mix} valueOf={(e) => e.spend} total={totalSpend} />
        <StackedBar title="Distribusi GMV (Ads)" entries={mix} valueOf={(e) => e.gmv} total={totalGmv} />

        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table className="kpi-table chan-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Channel</th>
                <th>Spend</th>
                <th>Share Spend</th>
                <th>GMV Ads</th>
                <th>Share GMV</th>
                <th>ROAS</th>
                <th style={{ textAlign: 'left' }}>Indeks Efisiensi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tag = effTag(r.eff);
                return (
                  <tr key={r.key}>
                    <td style={{ textAlign: 'left', fontWeight: 700 }}>
                      <span className="chan-legend-dot" style={{ background: r.color, display: 'inline-block', marginRight: 6 }} />
                      {r.label}
                    </td>
                    <td>{fmtPivotVal(r.spend, 'rp')}</td>
                    <td>{pctLabel(r.spendShare)}</td>
                    <td>{fmtPivotVal(r.gmv, 'rp')}</td>
                    <td>{pctLabel(r.gmvShare)}</td>
                    <td>{r.roas.toFixed(1).replace('.', ',')}×</td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`chan-eff ${tag.cls}`}>{tag.text}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="empty-note" style={{ paddingTop: '.7rem' }}>
          Indeks efisiensi = share GMV ÷ share spend. Di atas 1,00× berarti channel menghasilkan porsi omzet lebih besar dari porsi budget-nya.
          Dipakai sebagai penilai utama, bukan ROAS mentah, karena ROAS bisa melonjak saat channel ber-spend kecil kebetulan menutup 1 order besar.
        </div>
      </div>
    </div>
  );
}

const pp = (v: number) => `${v >= 0 ? '+' : ''}${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

interface CompareRow {
  label: string;
  old: number | null;
  cur: number | null;
  fmt: 'rp' | 'pct' | 'num';
  sentiment: Sentiment;
  strong?: boolean;
  sub?: boolean;
}

// A row's change: a share moves in percentage points, an amount in %.
function changeOf(r: CompareRow): { text: string; cls: string } {
  if (r.old === null || r.cur === null) return { text: '—', cls: 'delta-neutral' };
  if (r.fmt === 'pct') {
    const d = r.cur - r.old;
    const cls = Math.abs(d) < 0.05 ? 'delta-neutral' : deltaClassForSentiment(d, r.sentiment);
    return { text: pp(d), cls };
  }
  const { deltaNum, deltaStr } = computeDelta(r.old, r.cur);
  return { text: formatDeltaID(deltaNum, deltaStr), cls: deltaClassForSentiment(deltaNum, r.sentiment) };
}

function CompareTable({ rows, p1, p2, first }: { rows: CompareRow[]; p1: string; p2: string; first: string }) {
  const cell = (v: number | null, fmt: CompareRow['fmt']) => (v === null ? '—' : fmtPivotVal(v, fmt));
  return (
    <table className="kpi-table sc-table">
      <thead>
        <tr>
          <th>{first}</th>
          <th>{p1}</th>
          <th>{p2}</th>
          <th>Perubahan</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const ch = changeOf(r);
          return (
            <tr key={r.label} className={`${r.strong ? 'sc-strong' : ''}${r.sub ? ' sc-sub' : ''}`.trim() || undefined}>
              <td>{r.label}</td>
              <td className="num">{cell(r.old, r.fmt)}</td>
              <td className="num">{cell(r.cur, r.fmt)}</td>
              <td>
                <DeltaPill cls={ch.cls}>{ch.text}</DeltaPill>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// One month as a 100% bar of the shop's sales: each ad channel's slice, then
// what came without ads. A month whose ads exceed the shop total cannot be
// drawn honestly, so it says so in place of the bar.
function SalesBar({ label, side }: { label: string; side: SalesContributionSide }) {
  const over = side.shopGmv > 0 && side.adsGmv > side.shopGmv;
  const nonAds = Math.max(side.shopGmv - side.adsGmv, 0);
  return (
    <div className="sc-bar-row">
      <div className="sc-bar-label">{label}</div>
      {side.shopGmv <= 0 ? (
        <div className="sc-bar sc-bar-empty">Total Omzet belum diisi</div>
      ) : over ? (
        <div className="sc-bar sc-bar-empty is-over">Penjualan iklan melebihi Total Omzet, lihat catatan di bawah</div>
      ) : (
        <div className="sc-bar chan-bar">
          {side.byChannel.map((c) => {
            const v = (c.gmv / side.shopGmv) * 100;
            return (
              <div key={c.key} className="chan-seg" style={{ width: `${v}%`, background: c.color }} title={`${c.label} · ${pctLabel(v)}`}>
                {v >= 9 ? pctLabel(v) : ''}
              </div>
            );
          })}
          {nonAds > 0 && (
            <div className="chan-seg sc-seg-organic" style={{ width: `${(nonAds / side.shopGmv) * 100}%` }} title={`Non-Iklan · ${pctLabel((nonAds / side.shopGmv) * 100)}`}>
              {(nonAds / side.shopGmv) * 100 >= 9 ? pctLabel((nonAds / side.shopGmv) * 100) : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// `alwaysOpen` is not used in here — SectionAccordion reads it off this
// element to render the section unfolded and without a toggle.
export function SalesContributionSection({ sales, mix, p1, p2 }: { sales: SalesContribution; mix: ChannelMixEntry[]; p1: string; p2: string; alwaysOpen?: boolean }) {
  const { old: o, cur: c } = sales;
  const adsShare = (s: SalesContributionSide) => share(s.adsGmv, s.shopGmv);
  const nonAdsOf = (s: SalesContributionSide) => (s.shopGmv > 0 ? Math.max(s.shopGmv - s.adsGmv, 0) : null);
  const overMonths = [o, c].map((s, i) => (s.shopGmv > 0 && s.adsGmv > s.shopGmv ? [p1, p2][i] : null)).filter(Boolean) as string[];
  const hasStats = Boolean(o.stats || c.stats);
  const hasShop = o.shopGmv > 0 || c.shopGmv > 0;
  if (!hasShop && !mix.length) return null;

  const legend = [
    ...[...o.byChannel, ...c.byChannel].filter((e, i, all) => all.findIndex((x) => x.key === e.key) === i),
    { key: 'organic', label: 'Non-Iklan', color: '' },
  ];

  const mixRows: CompareRow[] = [
    { label: 'Total penjualan toko', old: o.shopGmv || null, cur: c.shopGmv || null, fmt: 'rp', sentiment: 'higher-better', strong: true },
    { label: 'Penjualan dari iklan', old: o.adsGmv, cur: c.adsGmv, fmt: 'rp', sentiment: 'higher-better' },
    { label: 'Penjualan non-iklan', old: nonAdsOf(o), cur: nonAdsOf(c), fmt: 'rp', sentiment: 'higher-better' },
    { label: 'Kontribusi iklan', old: adsShare(o), cur: adsShare(c), fmt: 'pct', sentiment: 'neutral', strong: true },
    { label: 'Kontribusi non-iklan', old: share(nonAdsOf(o) ?? 0, o.shopGmv), cur: share(nonAdsOf(c) ?? 0, c.shopGmv), fmt: 'pct', sentiment: 'neutral' },
  ];

  const st = (s: SalesContributionSide, f: (x: NonNullable<SalesContributionSide['stats']>) => number | null) => (s.stats ? f(s.stats) : null);
  const qualityRows: CompareRow[] = [
    { label: 'Total pesanan', old: st(o, (x) => x.orders), cur: st(c, (x) => x.orders), fmt: 'num', sentiment: 'higher-better' },
    { label: 'Pesanan dibatalkan', old: st(o, (x) => x.cancelledOrders), cur: st(c, (x) => x.cancelledOrders), fmt: 'num', sentiment: 'lower-better', sub: true },
    { label: 'Cancel rate (pesanan)', old: st(o, (x) => share(x.cancelledOrders, x.orders)), cur: st(c, (x) => share(x.cancelledOrders, x.orders)), fmt: 'pct', sentiment: 'lower-better', strong: true },
    { label: 'Penjualan dibatalkan', old: st(o, (x) => x.cancelledSales), cur: st(c, (x) => x.cancelledSales), fmt: 'rp', sentiment: 'lower-better', sub: true },
    { label: 'Cancel rate (nilai)', old: st(o, (x) => share(x.cancelledSales, x.gmv)), cur: st(c, (x) => share(x.cancelledSales, x.gmv)), fmt: 'pct', sentiment: 'lower-better', strong: true },
    { label: 'Pesanan dikembalikan', old: st(o, (x) => x.returnedOrders), cur: st(c, (x) => x.returnedOrders), fmt: 'num', sentiment: 'lower-better', sub: true },
    { label: 'Return rate (pesanan)', old: st(o, (x) => share(x.returnedOrders, x.orders)), cur: st(c, (x) => share(x.returnedOrders, x.orders)), fmt: 'pct', sentiment: 'lower-better', strong: true },
    { label: 'Penjualan dikembalikan', old: st(o, (x) => x.returnedSales), cur: st(c, (x) => x.returnedSales), fmt: 'rp', sentiment: 'lower-better', sub: true },
    { label: 'Penjualan bersih', old: st(o, (x) => x.gmv - x.cancelledSales - x.returnedSales), cur: st(c, (x) => x.gmv - x.cancelledSales - x.returnedSales), fmt: 'rp', sentiment: 'higher-better', strong: true },
  ];

  // Total Omzet typed in differently from the month's Performa Toko total.
  const mismatch = [o, c]
    .map((s, i) => (s.stats && s.shopGmv > 0 && Math.abs(s.shopGmv - s.stats.gmv) > Math.max(1000, s.stats.gmv * 0.005) ? { label: [p1, p2][i], file: s.stats.gmv } : null))
    .filter(Boolean) as { label: string; file: number }[];

  const curShare = adsShare(c);
  const oldShare = adsShare(o);
  const cancelCur = c.stats ? share(c.stats.cancelledSales, c.stats.gmv) : null;

  return (
    <div className="sec-block" data-feature="sales-contribution">
      <div className="sec-heading shopee-heading">
        Kontribusi Penjualan <span className="sec-badge">Iklan vs non-iklan · {p1} → {p2}</span>
        <SectionDownloadButton />
      </div>
      <div className="sc-body">
        {hasShop && curShare !== null && !overMonths.length && (
          <div className="chan-verdict">
            Iklan menyumbang <strong>{pctLabel(curShare)}</strong> penjualan toko di {p2}
            {oldShare !== null ? <> ({pctLabel(oldShare)} di {p1})</> : null}; sisanya <strong>{pctLabel(100 - curShare)}</strong> datang tanpa iklan.
            {cancelCur !== null && cancelCur > 0 ? <> {pctLabel(cancelCur)} nilai penjualan {p2} dibatalkan.</> : null}
          </div>
        )}
        {overMonths.length > 0 && (
          <div className="sc-warn" role="note">
            <strong>Kontribusi iklan di {overMonths.join(' & ')} melebihi 100%.</strong> Penjualan iklan Shopee dihitung dari pesanan dibuat
            (termasuk yang kemudian dibatalkan), jadi Total Omzet perlu dari dasar yang sama: Performa Toko › Pesanan Dibuat › Total Penjualan.
            Angka dari pesanan dibayar atau siap dikirim lebih kecil dan membuat kontribusi lewat 100%.
          </div>
        )}
        {mismatch.length > 0 && (
          <div className="sc-warn is-soft" role="note">
            Total Omzet {mismatch.map((m) => `${m.label} berbeda dari Performa Toko (${fmtPivotVal(m.file, 'rp')})`).join('; ')}. Kontribusi di bawah memakai Total Omzet yang diisi.
          </div>
        )}

        {hasShop && (
          <div className={`sc-grid${hasStats ? '' : ' is-single'}`}>
            <div className="sc-part">
              <div className="sc-part-title">Iklan vs non-iklan</div>
              <div className="chan-legend">
                {legend.map((e) => (
                  <span key={e.key} className="chan-legend-item">
                    <span className={`chan-legend-dot${e.key === 'organic' ? ' sc-seg-organic' : ''}`} style={e.color ? { background: e.color } : undefined} />
                    {e.label}
                  </span>
                ))}
              </div>
              <SalesBar label={p1} side={o} />
              <SalesBar label={p2} side={c} />
              <CompareTable rows={mixRows} p1={p1} p2={p2} first="Penjualan" />
            </div>
            {hasStats && (
              <div className="sc-part">
                <div className="sc-part-title">Kualitas penjualan <span>Performa Toko · Pesanan Dibuat</span></div>
                <CompareTable rows={qualityRows} p1={p1} p2={p2} first="Pesanan" />
                {(o.stats?.adsSales != null || c.stats?.adsSales != null) && (
                  <div className="empty-note sc-note">
                    Versi Shopee sendiri (Performa Toko › Asal Kunjungan › Penjualan dari Iklan Shopee):{' '}
                    {[
                      [p1, o],
                      [p2, c],
                    ]
                      .filter(([, s]) => (s as SalesContributionSide).stats?.adsSales != null)
                      .map(([label, s]) => {
                        const side = s as SalesContributionSide;
                        const v = side.stats!.adsSales!;
                        const sh = share(v, side.stats!.gmv);
                        return `${label} ${fmtPivotVal(v, 'rp')}${sh !== null ? ` (${pctLabel(sh)})` : ''}`;
                      })
                      .join(' · ')}
                    .{' '}
                    {[o, c].every((s) => s.stats?.adsSales == null || Math.abs(s.stats.adsSales - s.adsGmv) <= Math.max(1000, s.adsGmv * 0.005))
                      ? 'Sama dengan total laporan iklan di atas.'
                      : 'Berbeda dari total laporan iklan di atas; cek apakah semua file iklan bulan itu sudah dipilih.'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {hasShop && !hasStats && (
          <div className="empty-note sc-note">
            Cancel & return rate muncul saat file Performa Toko (shop-stats) bulan ini ada di Data Collection Hub atau diunggah di kolom Total Omzet.
          </div>
        )}

        {mix.length > 0 && <ChannelMixPart mix={mix} periodLabel={p2} />}
      </div>
    </div>
  );
}
