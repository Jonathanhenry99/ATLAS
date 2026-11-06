import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { addShopStats, omzetFromShopStats, shopStatsFromShopStats } from './shopeeOverview';

const HEAD = ['Tanggal', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan', 'Penjualan Dikembalikan'];

function book(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

test('Performa Toko: the period total line, cancelled / returned, and Shopee ads sales', () => {
  const buf = book({
    'Pesanan Dibuat': [['Ringkasan'], HEAD, ['01-09-2026-30-09-2026', '22.979.770', '58', '396.202,93', '10', '4.358.877', '1', '120.000'], ['01-09-2026', '1.000', '1', '1.000', '0', '0', '0', '0']],
    'Asal Kunjungan (pesanan yan...': [
      ['Tanggal', 'Status Pesanan', 'Penjualan (IDR)', 'Penjualan dari Iklan Shopee'],
      ['01-09-2026-30-09-2026', 'Pesanan Dibuat', '22.979.770', '14.500.868'],
      ['01-09-2026-30-09-2026', 'Pesanan Siap Dikirim', '20.110.619', '13.000.000'],
    ],
  });
  assert.deepEqual(shopStatsFromShopStats(buf), {
    gmv: 22979770, orders: 58, cancelledOrders: 10, cancelledSales: 4358877, returnedOrders: 1, returnedSales: 120000, adsSales: 14500868,
  });
  assert.equal(omzetFromShopStats(buf), 22979770);
});

test('Performa Toko without a total line sums its daily rows; no origin sheet → adsSales null', () => {
  const buf = book({ 'Pesanan Dibuat': [HEAD, ['01-09-2026', '1.000', '2', '500', '1', '400', '0', '0'], ['02-09-2026', '3.000', '3', '1.000', '0', '0', '1', '900']] });
  const s = shopStatsFromShopStats(buf)!;
  assert.equal(s.gmv, 4000);
  assert.equal(s.cancelledSales, 400);
  assert.equal(s.returnedSales, 900);
  assert.equal(s.adsSales, null);
  assert.equal(shopStatsFromShopStats(book({ Other: [['x']] })), null);
});

test('addShopStats keeps adsSales only when every part has it', () => {
  const a = { gmv: 10, orders: 1, cancelledOrders: 0, cancelledSales: 0, returnedOrders: 0, returnedSales: 0, adsSales: 5 };
  assert.equal(addShopStats([a, a])!.adsSales, 10);
  assert.equal(addShopStats([a, { ...a, adsSales: null }])!.adsSales, null);
  assert.equal(addShopStats([]), null);
});
