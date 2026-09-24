/**
 * Kasa ve panelin ORTAK GÖRSEL DİLİ — tek kaynak.
 *
 * NEDEN BURADA: iki uygulamanın stilleri birbirinin kopyasıydı ve kopyalar
 * ayrıştı. Palet (27 renk belirteci) ikisinde de aynıydı, ama kartların köşe
 * yarıçapı, buton ve giriş alanı yükseklikleri, etiket kalınlığı farklıydı;
 * panelde yazı tipi ailesi hiç tanımlı değildi ve tarayıcının varsayılanıyla
 * açılıyordu. Aynı sistemin iki ekranı farklı bir üründen çıkmış gibi duruyordu.
 *
 * NEDEN CSS DEĞİL EKLENTİ: ortak bir `.css` dosyasını `@import` ile paylaşmak
 * denendi ve KASADA SESSİZCE ÇÖKTÜ. Vite, PostCSS'i her dosyaya ayrı uygular ve
 * `@import`'u sonradan gömer; Tailwind paylaşılan dosyanın içini hiç görmediği
 * için `@apply` çözülmeden kalıyor, bileşen sınıfları hiç üretilmiyordu —
 * üstelik hata da vermeden. Eklenti iki derleyicide de Tailwind'in kendi
 * hattından geçer; sıralama sorusu ortadan kalkar.
 *
 * KANONİK DEĞER KASADAKİDİR: kasa gün boyu bakılan asıl ekrandır ve görünümü
 * yerleşmiştir, panel ona uyar.
 *
 * Renkler "R G B" kanal biçiminde tutulur; Tailwind'in saydamlık eki
 * (`bg-yuzey/60`) böyle çalışır.
 */

import plugin from 'tailwindcss/plugin';

const kanal = (ad) => `rgb(var(${ad}) / <alpha-value>)`;
/** Eklenti içindeki düz CSS'te saydamlık eki yok; renk doğrudan yazılır. */
const renk = (ad) => `rgb(var(${ad}))`;

export const temelTema = {
  colors: {
    /** Sayfa arka planı */
    zemin: kanal('--zemin'),
    /** Kart ve yükseltilmiş yüzeyler */
    yuzey: {
      DEFAULT: kanal('--yuzey'),
      2: kanal('--yuzey-2'),
      3: kanal('--yuzey-3'),
      4: kanal('--yuzey-4'),
    },
    cizgi: {
      DEFAULT: kanal('--cizgi'),
      kuvvetli: kanal('--cizgi-kuvvetli'),
      ince: kanal('--cizgi-ince'),
    },
    metin: {
      DEFAULT: kanal('--metin'),
      2: kanal('--metin-2'),
      3: kanal('--metin-3'),
      4: kanal('--metin-4'),
    },
    vurgu: {
      DEFAULT: kanal('--vurgu'),
      koyu: kanal('--vurgu-koyu'),
      yumusak: kanal('--vurgu-yumusak'),
      uzeri: kanal('--vurgu-uzeri'),
    },
    uyari: { DEFAULT: kanal('--uyari'), yumusak: kanal('--uyari-yumusak'), cizgi: kanal('--uyari-cizgi') },
    tehlike: {
      DEFAULT: kanal('--tehlike'),
      koyu: kanal('--tehlike-koyu'),
      yumusak: kanal('--tehlike-yumusak'),
      cizgi: kanal('--tehlike-cizgi'),
    },
    bilgi: { DEFAULT: kanal('--bilgi'), yumusak: kanal('--bilgi-yumusak'), cizgi: kanal('--bilgi-cizgi') },
    /** Diyalog arka perdesi */
    ortu: kanal('--ortu'),
  },
  fontFamily: {
    sans: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
    mono: ['Consolas', 'Menlo', 'monospace'],
  },
  fontSize: {
    // Dokunmatik ve düşük görüşlü kullanıcılar için büyük tutar yazı tipi (§3.3)
    tutar: ['2.75rem', { lineHeight: '1.1', fontWeight: '700' }],
  },
};

/*
 * AÇIK tema varsayılandır: market ortamı genelde aydınlıktır, ekrana gün boyu
 * bakılır ve koyu zeminde parlak metin bu koşullarda daha yorucudur. Koyu tema
 * `<html data-tema="koyu">` ile açılır (Ayarlar → Görünüm).
 */
const ACIK = {
  '--zemin': '246 248 250',
  '--yuzey': '255 255 255',
  '--yuzey-2': '241 245 249',
  '--yuzey-3': '255 255 255',
  '--yuzey-4': '226 232 240',

  '--cizgi': '226 232 240',
  '--cizgi-kuvvetli': '203 213 225',
  '--cizgi-ince': '241 245 249',

  '--metin': '15 23 42',
  '--metin-2': '51 65 85',
  '--metin-3': '100 116 139',
  '--metin-4': '148 163 184',

  /* Açık zeminde yeterli kontrast için koyulaştırılmış yeşil (WCAG AA) */
  '--vurgu': '4 120 87',
  '--vurgu-koyu': '6 95 70',
  '--vurgu-yumusak': '209 250 229',
  '--vurgu-uzeri': '255 255 255',

  '--uyari': '180 83 9',
  '--uyari-yumusak': '254 243 199',
  '--uyari-cizgi': '252 211 77',

  '--tehlike': '185 28 28',
  '--tehlike-koyu': '153 27 27',
  '--tehlike-yumusak': '254 226 226',
  '--tehlike-cizgi': '252 165 165',

  '--bilgi': '3 105 161',
  '--bilgi-yumusak': '224 242 254',
  '--bilgi-cizgi': '125 211 252',

  '--ortu': '15 23 42',
};

const KOYU = {
  '--zemin': '15 23 42',
  '--yuzey': '30 41 59',
  '--yuzey-2': '51 65 85',
  '--yuzey-3': '15 23 42',
  '--yuzey-4': '71 85 105',

  '--cizgi': '51 65 85',
  '--cizgi-kuvvetli': '71 85 105',
  '--cizgi-ince': '30 41 59',

  '--metin': '241 245 249',
  '--metin-2': '203 213 225',
  '--metin-3': '148 163 184',
  '--metin-4': '100 116 139',

  '--vurgu': '16 185 129',
  '--vurgu-koyu': '5 150 105',
  '--vurgu-yumusak': '6 78 59',
  '--vurgu-uzeri': '15 23 42',

  '--uyari': '251 191 36',
  '--uyari-yumusak': '69 26 3',
  '--uyari-cizgi': '180 83 9',

  '--tehlike': '248 113 113',
  '--tehlike-koyu': '220 38 38',
  '--tehlike-yumusak': '69 10 10',
  '--tehlike-cizgi': '153 27 27',

  '--bilgi': '56 189 248',
  '--bilgi-yumusak': '8 47 73',
  '--bilgi-cizgi': '3 105 161',

  '--ortu': '2 6 23',
};

/** Ortalı hizalama tablonun her hücresinde geçerli; ilk sütun istisnadır. */
const ORTALI = { textAlign: 'center' };

export const temaEklentisi = plugin(({ addBase, addComponents }) => {
  // Yazı yığını yukarıdaki temadan okunur; `theme()` sürüme göre dizi ya da
  // hazır metin döndürebildiği için kaynağı doğrudan kullanıyoruz.
  const monoYazi = temelTema.fontFamily.mono.join(', ');

  addBase({
    ':root': { colorScheme: 'light', ...ACIK },
    ":root[data-tema='koyu']": { colorScheme: 'dark', ...KOYU },

    body: {
      backgroundColor: renk('--zemin'),
      color: renk('--metin'),
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    },

    // Erişilebilirlik: klavye odağı her zaman görünür olmalı (§3.3 klavye-öncelikli).
    ':focus-visible': {
      outline: 'none',
      boxShadow: `0 0 0 2px ${renk('--zemin')}, 0 0 0 4px ${renk('--vurgu')}`,
    },

    // Yazı boyutu ayarı (§3.3 ergonomi) — iki üründe de aynı iki kademe.
    "html[data-yazi='buyuk']": { fontSize: '18px' },
    "html[data-yazi='cok-buyuk']": { fontSize: '20px' },
  });

  const tus = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    borderRadius: '0.375rem',
    paddingInline: '1rem',
    paddingBlock: '0.5rem',
    fontWeight: '500',
    transitionProperty: 'color, background-color, border-color',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDuration: '150ms',
    '&:disabled': { cursor: 'not-allowed', opacity: '0.4' },
  };

  addComponents({
    '.kart': {
      borderRadius: '0.5rem',
      borderWidth: '1px',
      borderColor: renk('--cizgi'),
      backgroundColor: renk('--yuzey'),
      boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    },

    '.alan': {
      width: '100%',
      borderRadius: '0.375rem',
      borderWidth: '1px',
      borderColor: renk('--cizgi-kuvvetli'),
      backgroundColor: renk('--yuzey-3'),
      paddingInline: '0.75rem',
      paddingBlock: '0.5rem',
      color: renk('--metin'),
      '&::placeholder': { color: renk('--metin-4') },
      '&:focus': { borderColor: renk('--vurgu'), outline: 'none' },
      '&:disabled': { opacity: '0.5' },
    },

    '.etiket': {
      display: 'block',
      marginBottom: '0.25rem',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
      fontWeight: '500',
      color: renk('--metin-2'),
    },

    '.tus': tus,
    '.tus-birincil': {
      ...tus,
      backgroundColor: renk('--vurgu'),
      color: renk('--vurgu-uzeri'),
      '&:hover': { backgroundColor: renk('--vurgu-koyu') },
    },
    '.tus-ikincil': {
      ...tus,
      borderWidth: '1px',
      borderColor: renk('--cizgi-kuvvetli'),
      backgroundColor: renk('--yuzey-2'),
      color: renk('--metin'),
      '&:hover': { backgroundColor: renk('--yuzey-4') },
    },
    '.tus-tehlike': {
      ...tus,
      backgroundColor: renk('--tehlike'),
      color: '#fff',
      '&:hover': { backgroundColor: renk('--tehlike-koyu') },
    },

    /** Klavye kısayolu rozeti (F2, Ctrl+S…) */
    '.kisayol': {
      borderRadius: '0.25rem',
      borderWidth: '1px',
      borderColor: renk('--cizgi-kuvvetli'),
      backgroundColor: renk('--yuzey-2'),
      paddingInline: '0.375rem',
      paddingBlock: '0.125rem',
      fontFamily: monoYazi,
      fontSize: '11px',
      color: renk('--metin-3'),
    },

    '.rozet': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      borderRadius: '9999px',
      borderWidth: '1px',
      paddingInline: '0.5rem',
      paddingBlock: '0.125rem',
      fontSize: '0.75rem',
      lineHeight: '1rem',
      fontWeight: '500',
    },

    /*
     * TABLO HİZALAMASI — kullanıcı kuralı: "her tablo center olsun".
     *
     * Tek istisna İLK SÜTUNDUR ve bilinçlidir: neredeyse her tabloda ürün/kişi
     * adı oradadır ve adlar solda okunur. `text-right` tablo içinde bilinçli
     * olarak ortaya eşlenir — sağa yaslı sayılar dar sütunlarda başlıktan kopuk
     * duruyor ve tablo dağınık görünüyordu.
     */
    '.tablo': {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '0.875rem',
      lineHeight: '1.25rem',
      '& th': {
        borderBottomWidth: '1px',
        borderColor: renk('--cizgi'),
        paddingInline: '0.75rem',
        paddingBlock: '0.5rem',
        fontWeight: '600',
        color: renk('--metin-2'),
        ...ORTALI,
      },
      '& td': {
        borderBottomWidth: '1px',
        borderColor: renk('--cizgi-ince'),
        paddingInline: '0.75rem',
        paddingBlock: '0.5rem',
        ...ORTALI,
      },
      '& th:first-child, & td:first-child': { textAlign: 'left' },
      '& th.text-left, & td.text-left': { textAlign: 'left' },
      '& th.text-center, & td.text-center': ORTALI,
      /*
       * `text-right` GERÇEKTEN sağa yaslar.
       *
       * Eskiden `text-center` ile aynı kurala bağlıydı; sınıfı yazan herkes
       * sağa yaslamayı kastettiği hâlde sütun ortalı çıkıyor, tutar sütununda
       * basamaklar alt alta gelmiyordu. Bileşen seçicisi Tailwind'in kendi
       * `.text-right` yardımcısından daha özgül olduğu için sessizce kazanıyordu.
       */
      '& th.text-right, & td.text-right': { textAlign: 'right' },
      '& tbody tr:hover': { backgroundColor: 'rgb(var(--yuzey-2) / 0.7)' },
    },

    /*
     * Yapışkan tablo başlığı — uzun listelerde sütunun ne olduğu görünür kalır.
     *
     * Sticky `thead`e değil HÜCRELERE verilir: `.tablo` çöken kenarlık
     * (border-collapse: collapse) kullanıyor, bu kipte thead'in arka planı ve
     * alt çizgisi kaydırma sırasında güvenilir biçimde çizilmiyor. Alt çizgi de
     * `inset` gölgeyle hücrenin İÇİNE konur ki başlıkla birlikte kaysın.
     */
    '.tablo-yapiskan thead th': {
      position: 'sticky',
      top: '0',
      zIndex: '10',
      backgroundColor: renk('--yuzey-2'),
      boxShadow: `inset 0 -1px 0 ${renk('--cizgi')}`,
    },

    /*
     * Para ve miktar sütunları. `tabular-nums` sayesinde rakamlar eşit
     * genişlikte olduğundan ortalı hizada da basamaklar alt alta gelir.
     */
    '.sayi': {
      fontFamily: monoYazi,
      fontVariantNumeric: 'tabular-nums',
      ...ORTALI,
    },

    /** Dar ekranda tablolar kendi içinde yatay kayar; sayfa gövdesi asla kaymaz. */
    '.tablo-sarmal': {
      marginInline: '-1rem',
      paddingInline: '1rem',
      overflowX: 'auto',
      '@media (min-width: 640px)': { marginInline: '0', paddingInline: '0' },
    },
  });
});

export default temelTema;
