/**
 * Renk sistemi CSS değişkenleri üzerinden çalışır (bkz. src/renderer/src/stil.css).
 * Bileşenler sabit bir ton (`slate-700` gibi) kullanmaz; `cizgi`, `metin-3` gibi
 * **anlamsal** adlar kullanır. Böylece açık/koyu tema tek bir yerde,
 * bileşenlere hiç dokunmadan değiştirilebilir.
 *
 * Değişkenler "R G B" kanal biçiminde tutulur ki Tailwind'in saydamlık eki
 * (`bg-yuzey/60`) çalışmaya devam etsin.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** Sayfa arka planı */
        zemin: 'rgb(var(--zemin) / <alpha-value>)',
        /** Kart ve yükseltilmiş yüzeyler */
        yuzey: {
          DEFAULT: 'rgb(var(--yuzey) / <alpha-value>)',
          2: 'rgb(var(--yuzey-2) / <alpha-value>)',
          3: 'rgb(var(--yuzey-3) / <alpha-value>)',
          4: 'rgb(var(--yuzey-4) / <alpha-value>)',
        },
        cizgi: {
          DEFAULT: 'rgb(var(--cizgi) / <alpha-value>)',
          kuvvetli: 'rgb(var(--cizgi-kuvvetli) / <alpha-value>)',
          ince: 'rgb(var(--cizgi-ince) / <alpha-value>)',
        },
        metin: {
          DEFAULT: 'rgb(var(--metin) / <alpha-value>)',
          2: 'rgb(var(--metin-2) / <alpha-value>)',
          3: 'rgb(var(--metin-3) / <alpha-value>)',
          4: 'rgb(var(--metin-4) / <alpha-value>)',
        },
        vurgu: {
          DEFAULT: 'rgb(var(--vurgu) / <alpha-value>)',
          koyu: 'rgb(var(--vurgu-koyu) / <alpha-value>)',
          yumusak: 'rgb(var(--vurgu-yumusak) / <alpha-value>)',
          uzeri: 'rgb(var(--vurgu-uzeri) / <alpha-value>)',
        },
        uyari: {
          DEFAULT: 'rgb(var(--uyari) / <alpha-value>)',
          yumusak: 'rgb(var(--uyari-yumusak) / <alpha-value>)',
          cizgi: 'rgb(var(--uyari-cizgi) / <alpha-value>)',
        },
        tehlike: {
          DEFAULT: 'rgb(var(--tehlike) / <alpha-value>)',
          koyu: 'rgb(var(--tehlike-koyu) / <alpha-value>)',
          yumusak: 'rgb(var(--tehlike-yumusak) / <alpha-value>)',
          cizgi: 'rgb(var(--tehlike-cizgi) / <alpha-value>)',
        },
        bilgi: {
          DEFAULT: 'rgb(var(--bilgi) / <alpha-value>)',
          yumusak: 'rgb(var(--bilgi-yumusak) / <alpha-value>)',
          cizgi: 'rgb(var(--bilgi-cizgi) / <alpha-value>)',
        },
        /** Diyalog arka perdesi */
        ortu: 'rgb(var(--ortu) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Consolas', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Dokunmatik ve düşük görüşlü kullanıcılar için büyük tutar yazı tipi (§3.3)
        tutar: ['2.75rem', { lineHeight: '1.1', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};
