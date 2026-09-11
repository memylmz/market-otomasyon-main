/**
 * Kasa Tailwind yapılandırması.
 *
 * Renkler, yazı tipleri ve bileşen sınıfları `@market/tema` içindeki ORTAK
 * kaynaktan gelir; kasa ve panel aynı eklentiyi kullanır, ayrışamazlar.
 * Bileşenler sabit bir ton (`slate-700` gibi) kullanmaz; `cizgi`, `metin-3`
 * gibi **anlamsal** adlar kullanır — açık/koyu tema tek yerden değişir.
 *
 * @type {import('tailwindcss').Config}
 */
import { temelTema, temaEklentisi } from '@market/tema/tailwind-temel.mjs';

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: { ...temelTema },
  },
  plugins: [temaEklentisi],
};
