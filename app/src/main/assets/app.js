(() => {
  const KEY = 'jammasjid.digital.v2.settings';
  const DB = 'JamMasjidMediaV2';
  const STORE = 'photos';
  const baseNames = ['Subuh', 'Syuruq', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'];

  const defaults = {
    displayMode: 'background', // 'background' | 'info' | 'youtube' | 'auto'
    infoSlideDuration: 12,
    mosque: 'Masjid Nurul Himmah',
    location: 'Jl. Raya Surabaya, Jawa Timur. Telp. 031-8064544',
    hijriOffset: 0,
    fridayMode: 'auto',
    times: ['04:05', '05:23', '11:44', '15:07', '17:57', '19:11'],
    iq: ['15', '0', '10', '10', '5', '10'],
    offsets: ['0', '0', '0', '0', '0', '0'],
    kasAwal: 12500000,
    kasMasuk: 2350000,
    kasKeluar: 850000,
    kasNote: 'Infaq Jumat & Kotak Amal Masjid',
    jumatKhatib: 'Ustadz H. Ahmad Fauzi, Lc.',
    jumatImam: 'Ustadz Muhammad Ridwan',
    jumatMuadzin: 'Bapak Sutrisno',
    jumatTema: 'Memakmurkan Masjid sebagai Pusat Peradaban Umat',
    announcement: '1. Kajian Rutin Ahad Ba\'da Subuh bersama Ustadz Ahmad.\n2. Mari jaga kebersihan dan ketertiban lingkungan masjid.',
    report: 'Program Santunan Anak Yatim & Dhuafa akan dilaksanakan pada hari Ahad pekan depan pukul 09.00 WIB.',
    message: 'Selamat datang di masjid kami • Harap matikan atau senyapkan nada dering ponsel saat memasuki area salat • Luruskan dan rapatkan shaf.',
    youtube: '',
    backgroundUrl: '',
    slideDuration: 15,
    photoIds: []
  };

  const getSettings = () => {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch (e) {
      return { ...defaults };
    }
  };

  let cfg = getSettings();
  let photoUrls = [];
  let bgSlide = 0;
  let bgTimer = null;
  let infoSlide = 0;
  let infoTimer = null;
  let autoCycleStep = 0;
  let autoTimer = null;
  let iqomahEndTimestamp = 0;
  let iqomahPrayerName = '';
  let lastTriggeredMinute = '';

  const el = (id) => document.getElementById(id);
  const rupiah = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

  // --- INDEXED DB UNTUK FOTO LOKAL ---
  function dbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function photoSave(file) {
    const db = await dbOpen();
    const id = 'p' + Date.now() + Math.random().toString(16).slice(2);
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob: file });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return id;
  }

  async function photoGet(id) {
    const db = await dbOpen();
    const item = await new Promise((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return item?.blob || null;
  }

  async function clearAllPhotos() {
    const db = await dbOpen();
    await new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = res;
      tx.onerror = res;
    });
    db.close();
    cfg.photoIds = [];
    localStorage.setItem(KEY, JSON.stringify(cfg));
    await loadPhotos();
  }

  // --- RENDER JARUM & ANGKA JAM ANALOG ---
  function buildAnalogDial() {
    const ticksWrap = el('dialTicks');
    const numsWrap = el('dialNumbers');
    if (!ticksWrap || !numsWrap) return;

    let ticksHtml = '';
    for (let i = 0; i < 60; i++) {
      const isMajor = i % 5 === 0;
      ticksHtml += `<div class="dial-tick ${isMajor ? 'major' : ''}" style="transform: rotate(${i * 6}deg)"></div>`;
    }
    ticksWrap.innerHTML = ticksHtml;

    let numsHtml = '';
    for (let n = 1; n <= 12; n++) {
      const angle = (n * 30 - 90) * (Math.PI / 180);
      const r = 36; // persen dari pusat
      const x = 50 + r * Math.cos(angle);
      const y = 50 + r * Math.sin(angle);
      numsHtml += `<span class="dial-num" style="left:${x}%;top:${y}%">${n}</span>`;
    }
    numsWrap.innerHTML = numsHtml;
  }

  // --- KALENDER HIJRIAH ---
  function getHijriDate(dateObj, offsetDays = 0) {
    try {
      const shifted = new Date(dateObj.getTime() + Number(offsetDays || 0) * 86400000);
      const formatted = new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(shifted);
      return formatted.replace('AH', 'H');
    } catch (e) {
      return '';
    }
  }

  // --- WAKTU SALAT ---
  function getPrayerLabels(now = new Date()) {
    const isFriday = now.getDay() === 5;
    return baseNames.map((name, idx) => {
      if (idx === 2) {
        if (cfg.fridayMode === 'always_jumuah') return "Jumu'ah";
        if (cfg.fridayMode === 'always_dzuhur') return 'Dzuhur';
        return isFriday ? "Jumu'ah" : 'Dzuhur';
      }
      return name;
    });
  }

  function timeToMinutes(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + m;
  }

  function adjust(t, offset) {
    const n = (timeToMinutes(t) + Number(offset || 0) + 1440) % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  }

  function effectiveTimes() {
    return cfg.times.map((t, i) => adjust(t, cfg.offsets?.[i] || 0));
  }

  function renderTimes(now = new Date()) {
    const times = effectiveTimes();
    const labels = getPrayerLabels(now);
    if (el('times')) {
      el('times').innerHTML = labels
        .map(
          (n, i) =>
            `<div class="prayer-card" data-prayer="${i}">
              <div class="name">${n}</div>
              <div class="time">${times[i]}</div>
            </div>`
        )
        .join('');
    }
  }

  // --- SLIDE INFORMASI (KAS, JUMAT, PENGUMUMAN, LAPORAN) ---
  function getInfoSlides() {
    const slides = [];
    const saldoAkhir = (Number(cfg.kasAwal) || 0) + (Number(cfg.kasMasuk) || 0) - (Number(cfg.kasKeluar) || 0);

    // 1. Slide Laporan Kas Masjid
    slides.push({
      badge: 'LAPORAN KEUANGAN / KAS MASJID',
      html: `
        <div class="kas-grid">
          <div class="kas-item"><span class="lbl">Saldo Awal</span><span class="val">${rupiah(cfg.kasAwal)}</span></div>
          <div class="kas-item"><span class="lbl">Pemasukan Pekan Ini</span><span class="val" style="color:#7ef59b">+ ${rupiah(cfg.kasMasuk)}</span></div>
          <div class="kas-item"><span class="lbl">Pengeluaran Pekan Ini</span><span class="val" style="color:#ff9494">- ${rupiah(cfg.kasKeluar)}</span></div>
          <div class="kas-item saldo"><span class="lbl">Saldo Akhir Kas Masjid</span><span class="val">${rupiah(saldoAkhir)}</span></div>
        </div>
        ${cfg.kasNote ? `<p style="margin-top:14px;font-size:0.8em;color:#d6e9ff;">Keterangan: ${cfg.kasNote}</p>` : ''}
      `
    });

    // 2. Slide Petugas Salat Jumat
    slides.push({
      badge: 'PETUGAS SALAT JUMAT PEKAN INI',
      html: `
        <div class="jumat-list">
          <div class="jumat-box"><small>Khatib</small><strong>${cfg.jumatKhatib || '-'}</strong></div>
          <div class="jumat-box"><small>Imam</small><strong>${cfg.jumatImam || '-'}</strong></div>
          <div class="jumat-box"><small>Muadzin / Bilal</small><strong>${cfg.jumatMuadzin || '-'}</strong></div>
        </div>
        ${cfg.jumatTema ? `<div class="jumat-box" style="margin-top:8px"><small>Tema Khutbah</small><strong>${cfg.jumatTema}</strong></div>` : ''}
      `
    });

    // 3. Slide Pengumuman
    if (cfg.announcement && cfg.announcement.trim()) {
      slides.push({
        badge: 'PENGUMUMAN MASJID',
        html: `<div style="white-space:pre-wrap">${cfg.announcement}</div>`
      });
    }

    // 4. Slide Laporan Kegiatan
    if (cfg.report && cfg.report.trim()) {
      slides.push({
        badge: 'LAPORAN & AGENDA KEGIATAN',
        html: `<div style="white-space:pre-wrap">${cfg.report}</div>`
      });
    }

    return slides;
  }

  function renderCurrentInfoSlide() {
    const slides = getInfoSlides();
    if (!slides.length) return;
    infoSlide = infoSlide % slides.length;
    const current = slides[infoSlide];

    if (el('slideBadge')) el('slideBadge').textContent = current.badge;
    if (el('slideContent')) el('slideContent').innerHTML = current.html;
    if (el('slideDots')) {
      el('slideDots').innerHTML = slides
        .map((_, idx) => `<span class="${idx === infoSlide ? 'active' : ''}"></span>`)
        .join('');
    }
  }

  function startInfoSlider() {
    if (infoTimer) clearInterval(infoTimer);
    renderCurrentInfoSlide();
    const dur = Math.max(5, Number(cfg.infoSlideDuration) || 12) * 1000;
    infoTimer = setInterval(() => {
      infoSlide++;
      renderCurrentInfoSlide();
    }, dur);
  }

  // --- YOUTUBE EMBED ---
  function youtubeEmbed(url) {
    try {
      const u = new URL(url);
      let id = '';
      if (u.hostname.includes('youtu.be')) {
        id = u.pathname.slice(1);
      } else if (u.hostname.includes('youtube.com')) {
        id = u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
      }
      if (!id) return '';
      return `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=0&rel=0`;
    } catch (e) {
      return '';
    }
  }

  // --- KONTROL MODE LAYAR TENGAH ---
  function applyStageMode(modeOverride) {
    const mode = modeOverride || cfg.displayMode || 'background';
    const infoStage = el('infoStage');
    const ytStage = el('youtubeStage');
    const ytFrame = el('youtube');

    if (mode === 'youtube' && cfg.youtube.trim()) {
      infoStage.hidden = true;
      ytStage.hidden = false;
      const embedUrl = youtubeEmbed(cfg.youtube);
      if (ytFrame.src !== embedUrl) ytFrame.src = embedUrl;
    } else if (mode === 'info') {
      ytStage.hidden = true;
      ytFrame.src = '';
      infoStage.hidden = false;
      startInfoSlider();
    } else {
      // mode 'background'
      infoStage.hidden = true;
      ytStage.hidden = true;
      ytFrame.src = '';
    }
  }

  function setupDisplayMode() {
    if (autoTimer) clearInterval(autoTimer);
    if (cfg.displayMode === 'auto') {
      const modes = ['background', 'info'];
      if (cfg.youtube && cfg.youtube.trim()) modes.push('youtube');
      autoCycleStep = 0;
      applyStageMode(modes[0]);
      autoTimer = setInterval(() => {
        autoCycleStep = (autoCycleStep + 1) % modes.length;
        applyStageMode(modes[autoCycleStep]);
      }, Math.max(15, Number(cfg.slideDuration) || 15) * 1000);
    } else {
      applyStageMode(cfg.displayMode);
    }
  }

  // --- SLIDESHOW BACKGROUND ---
  function setBg(url) {
    if (!el('background')) return;
    el('background').style.backgroundImage = url
      ? `url("${url.replaceAll('"', '')}")`
      : 'linear-gradient(135deg, #0d3b66 0%, #1d5b96 50%, #092642 100%)';
  }

  async function loadPhotos() {
    for (const u of photoUrls) URL.revokeObjectURL(u);
    photoUrls = [];
    for (const id of cfg.photoIds || []) {
      const blob = await photoGet(id);
      if (blob) photoUrls.push(URL.createObjectURL(blob));
    }
    startBgSlide();
  }

  function startBgSlide() {
    if (bgTimer) clearInterval(bgTimer);
    const sources = [...(photoUrls || [])];
    if (cfg.backgroundUrl) sources.push(cfg.backgroundUrl);
    if (!sources.length) {
      setBg('');
      return;
    }
    bgSlide = bgSlide % sources.length;
    setBg(sources[bgSlide]);
    if (sources.length > 1) {
      bgTimer = setInterval(() => {
        bgSlide = (bgSlide + 1) % sources.length;
        setBg(sources[bgSlide]);
      }, Math.max(5, Number(cfg.slideDuration) || 15) * 1000);
    }
  }

  // --- DETAK JAM REAL-TIME & COUNTDOWN ---
  function tick() {
    const now = new Date();

    // Update Jarum Jam Analog
    const sec = now.getSeconds();
    const min = now.getMinutes();
    const hr = now.getHours() % 12;
    if (el('secondHand')) el('secondHand').style.transform = `rotate(${sec * 6}deg)`;
    if (el('minuteHand')) el('minuteHand').style.transform = `rotate(${min * 6 + sec * 0.1}deg)`;
    if (el('hourHand')) el('hourHand').style.transform = `rotate(${hr * 30 + min * 0.5}deg)`;

    // Update Tanggal Masehi + Hijriah
    const masehi = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const hijri = getHijriDate(now, cfg.hijriOffset);
    if (el('dateBar')) {
      el('dateBar').textContent = hijri ? `${masehi} / ${hijri}` : masehi;
    }

    // Hitung Salat Berikutnya
    const times = effectiveTimes();
    const labels = getPrayerLabels(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let target = -1;
    let delta = Infinity;

    for (let i = 0; i < times.length; i++) {
      // Cek apakah baru saja masuk waktu salat untuk memicu Iqomah
      if (times[i] === currentHHMM && sec === 0 && lastTriggeredMinute !== currentHHMM) {
        lastTriggeredMinute = currentHHMM;
        const iqMins = Number(cfg.iq?.[i] || 0);
        if (iqMins > 0 && i !== 1) {
          iqomahEndTimestamp = Date.now() + iqMins * 60 * 1000;
          iqomahPrayerName = labels[i];
        }
      }

      const m = timeToMinutes(times[i]);
      let d = m - currentMinutes;
      if (d < 0) d += 1440;
      if (d < delta) {
        delta = d;
        target = i;
      }
    }

    // Update Kapsul Countdown & Highlight Kartu Aktif
    if (target >= 0) {
      if (el('nextLabel')) el('nextLabel').textContent = labels[target];
      const totalSec = Math.floor(delta * 60);
      const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      if (el('count')) el('count').textContent = `-${hh}:${mm}:${ss}`;

      document.querySelectorAll('.prayer-card').forEach((card, idx) => {
        const nameEl = card.querySelector('.name');
        if (nameEl) nameEl.textContent = labels[idx];
        card.classList.toggle('active', idx === target);
      });
    }

    // Cek Overlay Iqomah
    const iqOverlay = el('iqomahOverlay');
    if (iqOverlay) {
      const remMs = iqomahEndTimestamp - Date.now();
      if (remMs > 0) {
        iqOverlay.hidden = false;
        const remSec = Math.ceil(remMs / 1000);
        const im = String(Math.floor(remSec / 60)).padStart(2, '0');
        const is = String(remSec % 60).padStart(2, '0');
        if (el('iqomahTitle')) el('iqomahTitle').textContent = `MENUJU IQOMAH ${iqomahPrayerName.toUpperCase()}`;
        if (el('iqomahTimer')) el('iqomahTimer').textContent = `${im}:${is}`;
      } else {
        iqOverlay.hidden = true;
      }
    }
  }

  // --- RENDER PENGATURAN KE LAYAR ---
  function renderSettings() {
    cfg = getSettings();
    if (el('mosque')) el('mosque').textContent = cfg.mosque;
    if (el('locationText')) el('locationText').textContent = cfg.location;
    if (el('tickerText')) el('tickerText').textContent = cfg.message;
    renderTimes();
    setupDisplayMode();
  }

  // --- PANEL ADMIN ---
  function openAdminPanel() {
    el('screen').hidden = true;
    el('admin').hidden = false;

    el('displayMode').value = cfg.displayMode || 'background';
    el('infoSlideDuration').value = cfg.infoSlideDuration || 12;
    el('mosqueInput').value = cfg.mosque;
    el('location').value = cfg.location;
    el('hijriOffset').value = cfg.hijriOffset || 0;
    el('fridayMode').value = cfg.fridayMode || 'auto';
    el('backgroundUrl').value = cfg.backgroundUrl;
    el('slideDuration').value = cfg.slideDuration;
    el('youtubeUrl').value = cfg.youtube;

    el('kasAwal').value = cfg.kasAwal ?? 0;
    el('kasMasuk').value = cfg.kasMasuk ?? 0;
    el('kasKeluar').value = cfg.kasKeluar ?? 0;
    el('kasNote').value = cfg.kasNote || '';

    el('jumatKhatib').value = cfg.jumatKhatib || '';
    el('jumatImam').value = cfg.jumatImam || '';
    el('jumatMuadzin').value = cfg.jumatMuadzin || '';
    el('jumatTema').value = cfg.jumatTema || '';

    el('announcementInput').value = cfg.announcement;
    el('reportInput').value = cfg.report;
    el('message').value = cfg.message;

    el('imageStatus').textContent = cfg.photoIds?.length
      ? `${cfg.photoIds.length} foto lokal tersimpan di perangkat.`
      : 'Belum ada foto lokal tersimpan.';

    el('timeFields').innerHTML = baseNames
      .map((n, i) => `<label>${n}<input type="time" id="time${i}" value="${cfg.times[i] || '00:00'}"></label>`)
      .join('');

    el('iqFields').innerHTML = baseNames
      .map((n, i) => `<label>${n}<input type="number" min="0" max="60" id="iq${i}" value="${cfg.iq[i] || 0}" ${i === 1 ? 'disabled' : ''}></label>`)
      .join('');

    el('offFields').innerHTML = baseNames
      .map((n, i) => `<label>${n}<input type="number" min="-30" max="30" id="off${i}" value="${cfg.offsets[i] || 0}"></label>`)
      .join('');
  }

  function closeAdminPanel() {
    el('admin').hidden = true;
    el('screen').hidden = false;
    renderSettings();
  }

  function initAdminEvents() {
    if (!el('admin')) return;

    const isAdminUrl =
      location.pathname.endsWith('/admin') ||
      location.pathname.endsWith('/admin/') ||
      new URLSearchParams(location.search).has('admin');

    if (isAdminUrl) openAdminPanel();

    el('openAdminBtn')?.addEventListener('click', openAdminPanel);
    el('backToScreenBtn')?.addEventListener('click', closeAdminPanel);

    el('clearPhotosBtn')?.addEventListener('click', async () => {
      await clearAllPhotos();
      el('imageStatus').textContent = 'Semua foto lokal telah dihapus.';
    });

    el('backgroundFile')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      el('imageStatus').textContent = 'Menyimpan foto...';
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const id = await photoSave(f);
        cfg.photoIds.push(id);
      }
      localStorage.setItem(KEY, JSON.stringify(cfg));
      await loadPhotos();
      el('imageStatus').textContent = `${cfg.photoIds.length} foto lokal tersimpan.`;
    });

    el('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      cfg = {
        ...cfg,
        displayMode: el('displayMode').value,
        infoSlideDuration: Math.max(5, Number(el('infoSlideDuration').value) || 12),
        mosque: el('mosqueInput').value.trim() || defaults.mosque,
        location: el('location').value.trim(),
        hijriOffset: Number(el('hijriOffset').value) || 0,
        fridayMode: el('fridayMode').value,
        backgroundUrl: el('backgroundUrl').value.trim(),
        slideDuration: Math.max(5, Number(el('slideDuration').value) || 15),
        youtube: el('youtubeUrl').value.trim(),
        kasAwal: Number(el('kasAwal').value) || 0,
        kasMasuk: Number(el('kasMasuk').value) || 0,
        kasKeluar: Number(el('kasKeluar').value) || 0,
        kasNote: el('kasNote').value.trim(),
        jumatKhatib: el('jumatKhatib').value.trim(),
        jumatImam: el('jumatImam').value.trim(),
        jumatMuadzin: el('jumatMuadzin').value.trim(),
        jumatTema: el('jumatTema').value.trim(),
        announcement: el('announcementInput').value,
        report: el('reportInput').value,
        message: el('message').value,
        times: baseNames.map((_, i) => el(`time${i}`).value || '00:00'),
        iq: baseNames.map((_, i) => el(`iq${i}`)?.value || '0'),
        offsets: baseNames.map((_, i) => el(`off${i}`).value || '0')
      };
      localStorage.setItem(KEY, JSON.stringify(cfg));
      el('saved').textContent = 'Pengaturan berhasil disimpan!';
      setTimeout(() => {
        el('saved').textContent = '';
      }, 4000);
    });
  }

  // --- INISIALISASI ---
  buildAnalogDial();
  renderSettings();
  initAdminEvents();
  loadPhotos().catch(() => {});
  tick();
  setInterval(tick, 1000);
})();
