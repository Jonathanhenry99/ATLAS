import { Link } from 'react-router-dom';
import { Download, ExternalLink, ShieldCheck, Puzzle } from 'lucide-react';
import extensions from 'virtual:atlas-extensions';
import PageBand from '../components/common/PageBand.jsx';
import atlasIcon from '../assets/atlas-icon.png';
import '../components/dashboard/console.css';
import '../components/dashboard/softShell.css';
import './extensions.css';

// Extensions: the browser extensions ATLAS ships, as zips built from the
// /extensions folder at build time (frontend/build/extensionZips.js), so the
// download is always the version in the repository. Installed unpacked —
// none is on the Chrome Web Store.

// What each extension is for, how to use it, and what it reads. Installing
// is the same for every extension, so it lives once on the page (INSTALL),
// not in each card or zip.
const GUIDE = {
  'google-reviews-exporter': {
    purpose: 'Mengumpulkan ulasan yang tampil di halaman bisnis Google Maps dan mengekspornya ke CSV untuk Google Reviews Analytics.',
    target: { to: '/google-reviews', label: 'Buka Google Reviews Analytics' },
    usage: [
      'Buka Google Maps di Chrome (login ke akun Google agar daftar ulasan lengkap), lalu buka halaman bisnisnya.',
      'Klik ikon extension → Start Collection. Biarkan tab Google Maps terbuka sampai status Completed.',
      'Tekan Export CSV, lalu unggah file-nya di Google Reviews Analytics → Upload Google Reviews CSV.',
    ],
    reads: 'Nama, alamat, rating, jumlah ulasan bisnis, dan ulasan yang tampil di halaman. Tidak membaca password, cookie, atau halaman di luar Google Maps; tidak mengirim data ke mana pun.',
  },
  'olx-leads-extension': {
    purpose: 'Menghitung jumlah chat/leads baru yang masuk setiap hari di OLX, lalu menyalin angkanya ke Brand Tracking.',
    target: { to: '/brand-tracking', label: 'Buka Brand Tracking' },
    rules: [
      <>Chat dihitung di <b>tanggal pertama kali mulai chat</b>, bukan tanggal chat terakhir dikirim.</>,
      <>Chat hanya dihitung saat <b>Mobil Seken sebagai penjual</b>, bukan sebagai pembeli.</>,
    ],
    usage: [
      <>Buka <a href="https://www.olx.co.id/nf/chat" target="_blank" rel="noreferrer">chat OLX</a> dengan akun Mobil Seken, lalu klik tombol <b>Leads OLX</b> di pojok kanan bawah.</>,
      <>Pilih tanggal mulai. Extension mengambil data dari hari ini mundur sampai tanggal mulai.</>,
      <>Klik <b>Mulai hitung</b>, lalu tunggu sampai selesai. Jangan klik halaman OLX selama proses berjalan.</>,
      <>Klik <b>Salin … angka</b> untuk tiap bulan, lalu tempel ke spreadsheet Brand Tracking.</>,
      <>Buka bagian <b>Rincian … percakapan</b> untuk melihat tanggal mulai chat, tanggal chat terakhir, nama orang yang chat dan produknya, serta peran Mobil Seken (penjual atau pembeli).</>,
    ],
    reads: 'Daftar percakapan di Kotak Masuk chat OLX dan riwayat pesannya, memakai sesi login OLX yang sedang terbuka. Hanya berjalan di halaman chat OLX; tidak membaca password dan tidak mengirim data ke mana pun selain OLX sendiri.',
  },
};

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const INSTALL = [
  <>Unduh file zip extension di bawah, lalu ekstrak (klik dua kali di Mac, atau klik kanan → <b>Extract All</b> di Windows).</>,
  <>Buka <b>Google Chrome</b>.</>,
  <>Klik ikon titik tiga (⋮) di sebelah foto profil, di kanan atas.</>,
  <>Pilih <b>Extensions</b> → <b>Manage Extensions</b>.</>,
  <>Aktifkan <b>Developer mode</b> di pojok kanan atas.</>,
  <>Klik <b>Load unpacked</b>, lalu pilih folder extension hasil ekstrak (folder yang berisi <code>manifest.json</code>).</>,
];

export default function ExtensionsPage() {
  return (
    <div className="con soft-shell ext-page">
      <div className="soft-frame">
        <PageBand
          kicker="Integration · Alat bantu"
          title="Extensions"
          desc="Chrome extension buatan ATLAS untuk mengumpulkan data dari luar ATLAS. Unduh, pasang sekali, lalu gunakan bersama halaman ATLAS terkait."
        />

        <section className="soft-card ext-card ext-install" aria-labelledby="ext-install" data-feature="ext-install">
          <h2 id="ext-install">Cara install extension</h2>
          <ol className="ext-steps">{INSTALL.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="ext-muted ext-small">Berlaku untuk semua extension di halaman ini. Versi baru: unduh lagi, ganti isi folder lama dengan yang baru, lalu tekan ikon ↻ pada kartu extension di halaman Manage Extensions. Sematkan ikon extension di toolbar lewat ikon puzzle → pin, dan muat ulang tab yang sudah terbuka sebelum extension dipasang.</p>
        </section>

        {!extensions.length && (
          <section className="soft-card ext-card"><p className="ext-muted">Belum ada extension yang tersedia.</p></section>
        )}

        {extensions.map((x) => {
          const g = GUIDE[x.id];
          return (
            <section key={x.id} className="soft-card ext-card" aria-labelledby={`ext-${x.id}`} data-feature={`ext-${x.id}`}>
              <div className="ext-head">
                <img src={atlasIcon} alt="" width="48" height="48" />
                <div className="ext-title">
                  <h2 id={`ext-${x.id}`}>{x.name}</h2>
                  <p>{g?.purpose ?? x.description}</p>
                  <span className="ext-meta">Versi {x.version} · {x.files} file · {fmtSize(x.bytes)} · Chrome (Manifest V3)</span>
                </div>
                <div className="ext-actions">
                  <a className="btn btn-primary" href={`/${x.file}`} download data-feature="ext-download">
                    <Download size={16} aria-hidden="true" /> Download .zip
                  </a>
                  {g?.target && <Link className="ext-link" to={g.target.to}>{g.target.label} <ExternalLink size={12} aria-hidden="true" /></Link>}
                </div>
              </div>

              {g && (
                <div className="ext-grid">
                  <div>
                    <h3>Cara memakai</h3>
                    <ol className="ext-steps">{g.usage.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </div>
                  <div>
                    {g.rules && (
                      <>
                        <h3>Aturan penghitungan</h3>
                        <ol className="ext-steps">{g.rules.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      </>
                    )}
                    <div className="ext-privacy">
                      <ShieldCheck size={16} aria-hidden="true" />
                      <p><b>Data yang dibaca:</b> {g.reads}</p>
                    </div>
                    <p className="ext-muted ext-small">
                      <Puzzle size={12} aria-hidden="true" />
                      {x.permissions.length ? `Izin: ${x.permissions.join(', ')}` : 'Tanpa izin khusus'}
                      {x.sites.length > 0 && ` · Berjalan di: ${x.sites.join(', ')}`}
                    </p>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
