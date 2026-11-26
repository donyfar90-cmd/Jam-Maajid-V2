(() => {
  const KEY = 'jammasjid.digital.v2.settings';
  const DB = 'JamMasjidMediaV2';
  const STORE = 'photos';
  const baseNames = ['Subuh', 'Syuruq', 'Dzuhur', 'Ashar', 'Maghrib', 'Isya'];

  const defaults = {
    displayMode: 'background',
    infoSlideDuration: 12,
    mosque: 'Masjid Nurul Himmah',
    location: 'Surabaya, Jawa Timur',
    scheduleMode: 'auto', // 'auto' (koordinat) | 'manual'
    latitude: -7.2575,
    longitude: 112.7521,
    timezone: 7,
    hijriOffset: 0,
    fridayMode: 'auto',
    times: ['04:05', '05:23', '11:44', '15:07', '17:57', '19:11'],
    iq: ['15', '0', '10', '10', '5', '10'],
    offsets: ['2', '0', '2', '2', '2', '2'], // ihtiyat +2 menit
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
    photoIds: [],
    photoDataUrls: [] // Cadangan foto terkompresi agar tetap jalan di WebView Android
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

  // --- PERHITUNGAN HISAB WAKTU SALAT OTOMATIS (KEMENAG RI: SUBUH 20°, ISYA 18°) ---
  function calculatePrayerTimes(dateObj, lat, lng, tz) {
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const fixAngle = (a) => a - 360 * Math.floor(a / 360);
    const fixHour = (a) => a - 24 * Math.floor(a / 24);

    // Julian Date
    let year = dateObj.getFullYear();
    let month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    if (month <= 2) {
      year -= 1;
      month += 12;
    }
    const A = Math.floor(year / 100);
    const B = 2 - A + Math.floor(A / 4);
    const jd = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + B - 1524.5;

    const sunPosition = (jdVal) => {
      const D = jdVal - 2451545.0;
      const g = fixAngle(357.529 + 0.98560028 * D);
      const q = fixAngle(280.459 + 0.98564736 * D);
      const L = fixAngle(q + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R));
      const e = 23.439 - 0.00000036 * D;
      const RA = fixAngle(Math.atan2(Math.cos(e * D2R) * Math.sin(L * D2R), Math.cos(L * D2R)) * R2D) / 15;
      const eqt = q / 15 - RA;
      const decl = Math.asin(Math.sin(e * D2R) * Math.sin(L * D2R)) * R2D;
      return { decl, eqt };
    };

    const midDay = (time) => {
      const eqt = sunPosition(jd + time).eqt;
      return fixHour(12 - eqt);
    };

    const sunAngleTime = (angle, time, isCCW) => {
      const decl = sunPosition(jd + time).decl;
      const noon = midDay(time);
      const num = -Math.sin(angle * D2R) - Math.sin(decl * D2R) * Math.sin(lat * D2R);
      const den = Math.cos(decl * D2R) * Math.cos(lat * D2R);
      const cosVal = Math.max(-1, Math.min(1, num / den));
      const t = (1 / 15) * (Math.acos(cosVal) * R2D);
      return noon + (isCCW ? -t : t);
    };

    const asrTime = (factor, time) => {
      const decl = sunPosition(jd + time).decl;
      const angle = -Math.atan(1 / (factor + Math.tan(Math.abs(lat - decl) * D2R))) * R2D;
      return sunAngleTime(angle, time, false);
    };

    const fajr = sunAngleTime(20, 5 / 24, true);
    const sunrise = sunAngleTime(0.833, 6 / 24, true);
    const dhuhr = midDay(12 / 24);
    const asr = asrTime(1, 13 / 24);
    const maghrib = sunAngleTime(0.833, 18 / 24, false);
    const isha = sunAngleTime(18, 18 / 24, false);

    const raw = [fajr, sunrise, dhuhr, asr, maghrib, isha];
    return raw.map((t) => {
      const local = fixHour(t + tz - lng / 15);
      const totalMins = Math.round(local * 60);
      const hh = Math.floor(totalMins / 60) % 24;
      const mm = totalMins % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    });
  }

  // --- PENYIMPANAN & KOMPRESI FOTO GALERI ---
  function dbOpen() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function compressImageToDataUrl(file, maxWidth = 1280, quality = 0.78) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveGalleryFiles(files) {
    let savedCount = 0;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const dataUrl = await compressImageToDataUrl(f);
        // Simpan ke IndexedDB
        const db = await dbOpen();
        const id = 'p' + Date.now() + Math.random().toString(16).slice(2);
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ id, dataUrl });
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
        db.close();
        cfg.photoIds.push(id);
        savedCount++;
      } catch (err) {
        console.error('Gagal menyimpan gambar:', err);
      }
    }
    localStorage.setItem(KEY, JSON.stringify(cfg));
    await loadPhotos();
    return savedCount;
  }

  async function photoGet(id) {
    const db = await dbOpen();
    const item = await new Promise((res, rej) => {
      const r = db.transaction(STORE).objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    if (!item) return null;
    if (item.dataUrl) return item.dataUrl;
    if (item.blob) return URL.createObjectURL(item.blob);
    return null;
  }

  async function clearAllPhotos() {
    try {
      const db = await dbOpen();
      await new Promise((res) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = res;
        tx.onerror = res;
      });
      db.close();
    } catch (e) {}
    cfg.photoIds = [];
    cfg.photoDataUrls = [];
    localStorage.setItem(KEY, JSON.stringify(cfg));
    await loadPhotos();
  }

  // --- JAM ANALOG ---
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
      const r = 36;
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

  // --- WAKTU SALAT AKTIF ---
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

  function effectiveTimes(now = new Date()) {
    let base = cfg.times;
    if (cfg.scheduleMode === 'auto' && !isNaN(Number(cfg.latitude)) && !isNaN(Number(cfg.longitude))) {
      base = calculatePrayerTimes(now, Number(cfg.latitude), Number(cfg.longitude), Number(cfg.timezone || 7));
    }
    return base.map((t, i) => adjust(t, cfg.offsets?.[i] || 0));
  }

  function renderTimes(now = new Date()) {
    const times = effectiveTimes(now);
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

  // --- SLIDE INFORMASI ---
  function getInfoSlides() {
    const slides = [];
    const saldoAkhir = (Number(cfg.kasAwal) || 0) + (Number(cfg.kasMasuk) || 0) - (Number(cfg.kasKeluar) || 0);

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

    if (cfg.announcement && cfg.announcement.trim()) {
      slides.push({
        badge: 'PENGUMUMAN MASJID',
        html: `<div style="white-space:pre-wrap">${cfg.announcement}</div>`
      });
    }

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

  function isYoutubeLink(url) {
    return /youtube\.com|youtu\.be/i.test(url || '');
  }

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
    photoUrls = [];
    for (const id of cfg.photoIds || []) {
      const src = await photoGet(id);
      if (src) photoUrls.push(src);
    }
    startBgSlide();
  }

  function startBgSlide() {
    if (bgTimer) clearInterval(bgTimer);
    const sources = [...(photoUrls || [])];
    if (cfg.backgroundUrl && !isYoutubeLink(cfg.backgroundUrl)) {
      sources.push(cfg.backgroundUrl);
    }
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

  // --- DETAK JAM REAL-TIME ---
  function tick() {
    const now = new Date();

    const sec = now.getSeconds();
    const min = now.getMinutes();
    const hr = now.getHours() % 12;
    if (el('secondHand')) el('secondHand').style.transform = `rotate(${sec * 6}deg)`;
    if (el('minuteHand')) el('minuteHand').style.transform = `rotate(${min * 6 + sec * 0.1}deg)`;
    if (el('hourHand')) el('hourHand').style.transform = `rotate(${hr * 30 + min * 0.5}deg)`;

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

    const times = effectiveTimes(now);
    const labels = getPrayerLabels(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let target = -1;
    let delta = Infinity;

    for (let i = 0; i < times.length; i++) {
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

    if (target >= 0) {
      if (el('nextLabel')) el('nextLabel').textContent = labels[target];
      const totalSec = Math.floor(delta * 60);
      const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      if (el('count')) el('count').textContent = `-${hh}:${mm}:${ss}`;

      document.querySelectorAll('.prayer-card').forEach((card, idx) => {
        const nameEl = card.querySelector('.name');
        const timeEl = card.querySelector('.time');
        if (nameEl) nameEl.textContent = labels[idx];
        if (timeEl) timeEl.textContent = times[idx];
        card.classList.toggle('active', idx === target);
      });
    }

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

  function renderSettings() {
    cfg = getSettings();
    if (el('mosque')) el('mosque').textContent = cfg.mosque;
    if (el('locationText')) el('locationText').textContent = cfg.location;
    if (el('tickerText')) el('tickerText').textContent = cfg.message;
    renderTimes();
    setupDisplayMode();
  }

  function refreshAdminTimePreview() {
    const isAuto = el('scheduleMode').value === 'auto';
    const lat = Number(el('latitudeInput').value);
    const lng = Number(el('longitudeInput').value);
    const tz = Number(el('timezoneInput').value || 7);

    const calculated = isAuto && !isNaN(lat) && !isNaN(lng)
      ? calculatePrayerTimes(new Date(), lat, lng, tz)
      : cfg.times;

    baseNames.forEach((_, i) => {
      const inp = el(`time${i}`);
      if (!inp) return;
      if (isAuto) {
        inp.value = calculated[i] || '00:00';
        inp.readOnly = true;
        inp.style.background = '#eef3f8';
      } else {
        inp.readOnly = false;
        inp.style.background = '#fbfdff';
      }
    });
  }

  // --- PANEL ADMIN ---
  function openAdminPanel() {
    el('screen').hidden = true;
    el('admin').hidden = false;

    el('displayMode').value = cfg.displayMode || 'background';
    el('infoSlideDuration').value = cfg.infoSlideDuration || 12;
    el('mosqueInput').value = cfg.mosque;
    el('location').value = cfg.location;
    el('scheduleMode').value = cfg.scheduleMode || 'auto';
    el('latitudeInput').value = cfg.latitude ?? -7.2575;
    el('longitudeInput').value = cfg.longitude ?? 112.7521;
    el('timezoneInput').value = cfg.timezone ?? 7;
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

    refreshAdminTimePreview();
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

    // Pemicu tombol Buka Galeri
    el('pickPhotoBtn')?.addEventListener('click', () => {
      const fileInp = el('backgroundFile');
      if (fileInp) {
        fileInp.value = '';
        fileInp.click();
      }
    });

    // Preset Kota
    el('cityPreset')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const [lat, lng, tz] = e.target.value.split(',');
      el('latitudeInput').value = lat;
      el('longitudeInput').value = lng;
      el('timezoneInput').value = tz;
      el('scheduleMode').value = 'auto';
      const cityName = e.target.options[e.target.selectedIndex].text.split(' (')[0];
      if (!el('location').value.trim()) el('location').value = cityName;
      el('gpsStatus').textContent = `Wilayah diatur ke ${cityName} (${lat}, ${lng})`;
      refreshAdminTimePreview();
    });

    el('scheduleMode')?.addEventListener('change', refreshAdminTimePreview);
    el('latitudeInput')?.addEventListener('input', refreshAdminTimePreview);
    el('longitudeInput')?.addEventListener('input', refreshAdminTimePreview);
    el('timezoneInput')?.addEventListener('change', refreshAdminTimePreview);

    // Deteksi GPS Otomatis
    el('detectGpsBtn')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        el('gpsStatus').textContent = 'Browser/perangkat tidak mendukung GPS.';
        return;
      }
      el('gpsStatus').textContent = 'Mencari koordinat GPS perangkat...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(5));
          const lng = Number(pos.coords.longitude.toFixed(5));
          const tz = Math.round(lng / 15);
          el('latitudeInput').value = lat;
          el('longitudeInput').value = lng;
          if ([7, 8, 9].includes(tz)) el('timezoneInput').value = tz;
          el('scheduleMode').value = 'auto';
          el('gpsStatus').textContent = `Berhasil! Lat: ${lat}, Lng: ${lng}`;
          refreshAdminTimePreview();
        },
        (err) => {
          el('gpsStatus').textContent = `Gagal GPS (${err.message}). Silakan pilih kota atau isi koordinat manual.`;
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    el('clearPhotosBtn')?.addEventListener('click', async () => {
      await clearAllPhotos();
      el('imageStatus').textContent = 'Semua foto lokal telah dihapus.';
    });

    el('backgroundFile')?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      el('imageStatus').textContent = 'Memproses & menyimpan foto ke perangkat...';
      await saveGalleryFiles(files);
      el('imageStatus').textContent = `${cfg.photoIds.length} foto lokal tersimpan.`;
    });

    el('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const bgUrlVal = el('backgroundUrl').value.trim();
      let ytUrlVal = el('youtubeUrl').value.trim();

      // Jika pengguna tidak sengaja menempel link YouTube di kolom URL Background, pindahkan otomatis
      let cleanBgUrl = bgUrlVal;
      if (isYoutubeLink(bgUrlVal)) {
        if (!ytUrlVal) ytUrlVal = bgUrlVal;
        cleanBgUrl = '';
        el('backgroundUrl').value = '';
        el('youtubeUrl').value = ytUrlVal;
      }

      cfg = {
        ...cfg,
        displayMode: el('displayMode').value,
        infoSlideDuration: Math.max(5, Number(el('infoSlideDuration').value) || 12),
        mosque: el('mosqueInput').value.trim() || defaults.mosque,
        location: el('location').value.trim(),
        scheduleMode: el('scheduleMode').value,
        latitude: Number(el('latitudeInput').value) || -7.2575,
        longitude: Number(el('longitudeInput').value) || 112.7521,
        timezone: Number(el('timezoneInput').value) || 7,
        hijriOffset: Number(el('hijriOffset').value) || 0,
        fridayMode: el('fridayMode').value,
        backgroundUrl: cleanBgUrl,
        slideDuration: Math.max(5, Number(el('slideDuration').value) || 15),
        youtube: ytUrlVal,
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

  buildAnalogDial();
  renderSettings();
  initAdminEvents();
  loadPhotos().catch(() => {});
  tick();
  setInterval(tick, 1000);
})();
